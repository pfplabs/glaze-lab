import path from "node:path";

import { requireOwnedIndex } from "./index-selection.js";
import { dataDir, readJob, updateJob } from "./store.js";
import { providerError, resumeIndex } from "./twelvelabs.js";

const running = new Set();

// Upload and index a stored file. Successful provider ids are kept, so a retry
// does not create a second asset for the same job.
export function publishJob(jobId, client, options = {}) {
  if (running.has(jobId)) return Promise.resolve(readJob(jobId));
  running.add(jobId);
  const work = publish(jobId, client, options).finally(() => running.delete(jobId));
  return work;
}

async function publish(jobId, client, options) {
  const owned = await requireOwnedIndex();
  const initial = await readJob(jobId);
  if (!initial) {
    const error = new Error("No job with that id.");
    error.code = "missing_job";
    throw error;
  }
  if (initial.stage === "indexed" && initial.providers.twelvelabs.indexedAssetId) return initial;
  if (!client) {
    return fail(jobId, "missing_api_key", "Set TWELVELABS_API_KEY before adding a video.");
  }

  const filePath = path.join(dataDir(), initial.mediaPath);
  const metadata = { glaze_asset_id: initial.id };
  if (initial.campaign) metadata.campaign = initial.campaign;

  try {
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
  } catch (error) {
    const safe = error.code === "provider_timeout"
      ? { code: "provider_timeout", message: "TwelveLabs did not finish in time. Retry continues from the last successful step." }
      : error.code === "provider_failed"
        ? { code: "provider_failed", message: "TwelveLabs could not process this video." }
        : providerError(error);
    return fail(jobId, safe.code, safe.message);
  }
}

function fail(jobId, code, message) {
  return updateJob(jobId, (job) => {
    job.stage = "failed";
    job.error = { code, message };
    return job;
  });
}
