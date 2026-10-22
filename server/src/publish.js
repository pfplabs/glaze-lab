import path from "node:path";

import { EnrichmentError, normalizeEnrichment } from "./enrich.js";
import { findCreatedIndex, requireOwnedIndex } from "./index-selection.js";
import { listJobs, dataDir, readJob, updateJob } from "./store.js";
import { providerError, resumeEnrichment, resumeIndex } from "./twelvelabs.js";

const running = new Set();

// Upload and index a stored file, then segment it. Segmentation waits until the
// indexed asset is ready. A saved provider id is reused, so a retry does not
// pay for a step that already succeeded.
export function publishJob(jobId, client, options = {}) {
  if (running.has(jobId)) return Promise.resolve(readJob(jobId));
  running.add(jobId);
  const work = publish(jobId, client, options).finally(() => running.delete(jobId));
  return work;
}

export async function resumeOpenEnrichment(client) {
  if (!client) return;
  const jobs = await listJobs();
  for (const job of jobs) {
    const status = job.enrichment?.status;
    const assetId = job.providers?.twelvelabs?.assetId;
    if (job.stage === "indexed" && assetId && status !== "ready" && status !== "failed") {
      publishJob(job.id, client);
    }
  }
}

async function publish(jobId, client, options) {
  const initial = await readJob(jobId);
  if (!initial) {
    const error = new Error("No job with that id.");
    error.code = "missing_job";
    throw error;
  }
  if (initial.stage === "indexed" && initial.enrichment?.status === "ready") return initial;
  if (!client) {
    return fail(jobId, "missing_api_key", "Set TWELVELABS_API_KEY before adding a video.");
  }

  let owned;
  try {
    owned = initial.stage === "indexed" && initial.providers.twelvelabs.indexId
      ? await findCreatedIndex(initial.providers.twelvelabs.indexId)
      : await requireOwnedIndex(client);
  } catch (error) {
    return fail(jobId, error.code || "index_required", error.message);
  }

  const filePath = path.join(dataDir(), initial.mediaPath);
  const metadata = { glaze_asset_id: initial.id };
  if (initial.campaign) metadata.campaign = initial.campaign;

  let indexed;
  try {
    indexed = await runIndex(jobId, client, { owned, initial, filePath, metadata, options });
  } catch (error) {
    const safe = error.code === "provider_timeout"
      ? { code: "provider_timeout", message: "TwelveLabs did not finish in time. Retry continues from the last successful step." }
      : error.code === "provider_failed"
        ? { code: "provider_failed", message: "TwelveLabs could not process this video." }
        : providerError(error);
    await fail(jobId, safe.code, safe.message);
    return readJob(jobId);
  }

  const assetId = indexed?.providers?.twelvelabs?.assetId;
  if (indexed?.stage !== "indexed" || !assetId) return indexed;

  try {
    await runEnrichment(jobId, client, assetId, options);
  } catch (error) {
    const safe = enrichmentFailure(error);
    await updateJob(jobId, (job) => {
      job.enrichment = {
        ...(job.enrichment ?? {}),
        status: "failed",
        error: { code: safe.code, message: safe.message },
      };
      return job;
    });
  }
  return readJob(jobId);
}

async function runIndex(jobId, client, { owned, initial, filePath, metadata, options }) {
  if (initial.stage === "indexed" && initial.providers.twelvelabs.indexedAssetId) {
    return initial;
  }
  await updateJob(jobId, (job) => {
    job.stage = job.providers.twelvelabs.assetId ? "indexing" : "uploading";
    job.error = null;
    job.providers.twelvelabs.indexId = owned.id;
    return job;
  });
  const result = await resumeIndex(client, {
    indexId: owned.id,
    assetId: initial.providers.twelvelabs.assetId,
    indexedAssetId: initial.providers.twelvelabs.indexedAssetId,
    filePath,
    filename: initial.sourceFileName,
    userMetadata: metadata,
    sleep: options.sleep,
    timeoutMs: options.timeoutMs,
    onProgress: (patch) => updateJob(jobId, (job) => {
      job.stage = patch.stage;
      job.providers.twelvelabs.indexId = owned.id;
      if (patch.assetId) job.providers.twelvelabs.assetId = patch.assetId;
      if (patch.indexedAssetId) job.providers.twelvelabs.indexedAssetId = patch.indexedAssetId;
      return job;
    }),
  });
  return updateJob(jobId, (job) => {
    job.stage = "indexed";
    job.error = null;
    job.providers.twelvelabs = {
      assetId: result.assetId,
      indexId: owned.id,
      indexedAssetId: result.indexedAssetId,
      hlsStatus: result.hlsStatus,
    };
    job.usage.providerCalls += result.calls.length;
    for (const call of result.calls) {
      if (!job.usage.stagesExecuted.includes(call)) job.usage.stagesExecuted.push(call);
    }
    return job;
  });
}

async function runEnrichment(jobId, client, assetId, options) {
  const current = await readJob(jobId);
  if (current?.enrichment?.status === "ready") return current;
  await updateJob(jobId, (job) => {
    job.enrichment = {
      status: "running",
      taskId: job.enrichment?.taskId ?? null,
      raw: job.enrichment?.raw ?? null,
      format: null,
      observations: [],
      error: null,
    };
    return job;
  });
  const result = await resumeEnrichment(client, {
    assetId,
    taskId: current?.enrichment?.taskId ?? null,
    sleep: options.sleep,
    timeoutMs: options.timeoutMs,
    onTask: (taskId) => updateJob(jobId, (job) => {
      job.enrichment = { ...(job.enrichment ?? {}), status: "running", taskId };
      return job;
    }),
  });
  let normalized;
  try {
    normalized = await normalizeEnrichment(result.raw, { assetId, taskId: result.taskId });
  } catch (error) {
    await updateJob(jobId, (job) => {
      job.enrichment = {
        ...(job.enrichment ?? {}),
        status: "failed",
        taskId: result.taskId,
        raw: result.raw,
        error: {
          code: error.code || "schema_invalid",
          message: error instanceof EnrichmentError ? error.message : "Segmentation result could not be read.",
        },
      };
      addCalls(job, result.calls);
      return job;
    });
    throw error;
  }
  return updateJob(jobId, (job) => {
    job.enrichment = {
      status: "ready",
      taskId: result.taskId,
      raw: result.raw,
      schema: normalized.schema,
      modelName: normalized.modelName,
      analysisMode: normalized.analysisMode,
      format: normalized.format,
      observations: normalized.observations,
      error: null,
    };
    addCalls(job, result.calls);
    return job;
  });
}

function addCalls(job, calls) {
  job.usage.providerCalls += calls.length;
  for (const call of calls) {
    if (!job.usage.stagesExecuted.includes(call)) job.usage.stagesExecuted.push(call);
  }
}

function enrichmentFailure(error) {
  if (error instanceof EnrichmentError) return { code: error.code, message: error.message };
  if (error.code === "provider_timeout") {
    return { code: "provider_timeout", message: "Segmentation did not finish in time. Retry continues the same task." };
  }
  if (error.statusCode || error.status) return providerError(error);
  if (error.code && error.code !== "provider_failed") {
    return { code: error.code, message: error.message || "TwelveLabs could not segment this video." };
  }
  return { code: "provider_failed", message: "TwelveLabs could not segment this video." };
}

function fail(jobId, code, message) {
  return updateJob(jobId, (job) => {
    job.stage = "failed";
    job.error = { code, message };
    return job;
  });
}
