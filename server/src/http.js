import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { findProducts } from "./catalog.js";
import { ingestLocalFile } from "./ingest.js";
import { createOwnedIndex, listSelectableIndexes, requireOwnedIndex, selectKnownIndex, selectedIndex } from "./index-selection.js";
import { publishJob } from "./publish.js";
import { findLibraryVideo, librarySummary, searchFacets, searchLibrary, streamForLibraryVideo } from "./search.js";
import { listJobs, updateJob } from "./store.js";
import { DIRECT_LOCAL_VIDEO_MAX_BYTES } from "./limits.js";

const JSON_LIMIT = 32 * 1024;

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function publicJob(job) {
  const provider = job.providers?.twelvelabs ?? {};
  return {
    id: job.id,
    stage: job.stage,
    sourceFileName: job.sourceFileName,
    bytes: job.bytes,
    durationSeconds: job.durationSeconds,
    width: job.width,
    height: job.height,
    campaign: job.campaign,
    indexId: provider.indexId ?? null,
    assetId: provider.assetId ?? null,
    indexedAssetId: provider.indexedAssetId ?? null,
    hlsStatus: provider.hlsStatus ?? null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    error: job.error,
    providerCalls: job.usage?.providerCalls ?? 0,
    duplicate: Boolean(job.duplicate),
    enrichmentStatus: job.enrichment?.status ?? "not_started",
    enrichmentFormat: job.enrichment?.format?.value ?? null,
    observationCount: job.enrichment?.observations?.length ?? 0,
    enrichmentError: job.enrichment?.error?.message ?? null,
    searchReady: job.stage === "indexed" && job.enrichment?.status === "ready",
  };
}

function statusFor(error) {
  switch (error.code) {
    case "index_required":
    case "index_not_ours":
    case "index_unknown":
    case "already_on_another_index":
    case "stream_unavailable":
      return 409;
    case "missing_api_key":
      return 503;
    case "invalid_media":
    case "ffprobe_missing":
    case "probe_failed":
    case "missing_file":
    case "not_a_file":
    case "invalid_name":
    case "invalid_json":
    case "invalid_query":
    case "unsupported_filter":
    case "index_name_taken":
      return 400;
    case "body_too_large":
      return 413;
    case "missing_job":
    case "missing_video":
      return 404;
    case "provider_auth":
      return 401;
    case "index_unreadable":
    case "provider_forbidden":
      return 403;
    case "rate_limited":
      return 429;
    case "provider_failed":
    case "search_unavailable":
      return 502;
    default:
      return 500;
  }
}

function sendError(res, error) {
  const status = statusFor(error);
  const body = {
    error: error.code || "unexpected",
    message: status === 500 ? "Request failed." : error.message,
  };
  if (error.code === "invalid_media" && error.details?.length) body.details = error.details;
  sendJson(res, status, body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > JSON_LIMIT) {
      const error = new Error("JSON body is too large.");
      error.code = "body_too_large";
      throw error;
    }
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body is not JSON.");
    error.code = "invalid_json";
    throw error;
  }
}

async function readFileBody(req) {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > DIRECT_LOCAL_VIDEO_MAX_BYTES) {
    const error = new Error("Direct local upload allows up to 200 MB.");
    error.code = "body_too_large";
    throw error;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > DIRECT_LOCAL_VIDEO_MAX_BYTES) {
      const error = new Error("Direct local upload allows up to 200 MB.");
      error.code = "body_too_large";
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function safeName(value) {
  const base = path.basename(String(value || "video.mp4")).replace(/[^A-Za-z0-9._-]+/g, "_");
  return base && base !== "." && base !== ".." ? base : "video.mp4";
}

export function createApiServer({ client = null, probe } = {}) {
  const pending = new Set();
  const track = (promise) => {
    pending.add(promise);
    promise.finally(() => pending.delete(promise));
    return promise;
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const pathname = url.pathname;
    try {
      if (req.method === "GET" && pathname === "/api/index") {
        sendJson(res, 200, await selectedIndex(client));
        return;
      }
      if (req.method === "GET" && pathname === "/api/indexes") {
        sendJson(res, 200, await listSelectableIndexes(client));
        return;
      }
      if (req.method === "POST" && pathname === "/api/indexes") {
        const body = await readJson(req);
        const created = await createOwnedIndex(body.name, client);
        sendJson(res, 201, created);
        return;
      }
      if (req.method === "POST" && pathname === "/api/index") {
        const body = await readJson(req);
        sendJson(res, 200, await selectKnownIndex(body.id, client));
        return;
      }
      if (req.method === "GET" && pathname === "/api/catalog") {
        sendJson(res, 200, { products: await findProducts(url.searchParams.get("q")) });
        return;
      }
      if (req.method === "GET" && pathname === "/api/library") {
        const index = await selectedIndex(client);
        sendJson(res, 200, { index, facets: await searchFacets(index.id), summary: await librarySummary(index.id) });
        return;
      }
      if (req.method === "POST" && pathname === "/api/search") {
        const index = await selectedIndex(client);
        if (!index.id) {
          const error = new Error("Select an index before searching.");
          error.code = "index_required";
          throw error;
        }
        const body = await readJson(req);
        sendJson(res, 200, await searchLibrary(client, index, body));
        return;
      }
      const streamMatch = pathname.match(/^\/api\/videos\/([A-Za-z0-9_-]+)\/stream$/);
      if (streamMatch && req.method === "GET") {
        sendJson(res, 200, await streamForLibraryVideo(client, streamMatch[1]));
        return;
      }
      const videoMatch = pathname.match(/^\/api\/videos\/([A-Za-z0-9_-]+)$/);
      if (videoMatch && req.method === "GET") {
        const video = await findLibraryVideo(videoMatch[1]);
        if (!video) {
          sendJson(res, 404, { error: "missing_video", message: "No local record for that video." });
          return;
        }
        sendJson(res, 200, video);
        return;
      }
      if (req.method === "GET" && pathname === "/api/ingestions") {
        const jobs = await listJobs();
        sendJson(res, 200, { jobs: jobs.map(publicJob) });
        return;
      }
      const jobMatch = pathname.match(/^\/api\/ingestions\/(glz_[0-9a-f]+)(\/retry)?$/);
      if (jobMatch && req.method === "GET" && !jobMatch[2]) {
        const jobs = await listJobs();
        const job = jobs.find((item) => item.id === jobMatch[1]);
        if (!job) {
          sendJson(res, 404, { error: "missing_job", message: "No job with that id." });
          return;
        }
        sendJson(res, 200, publicJob(job));
        return;
      }
      if (jobMatch && req.method === "POST" && jobMatch[2] === "/retry") {
        const jobs = await listJobs();
        const job = jobs.find((item) => item.id === jobMatch[1]);
        if (!job) {
          sendJson(res, 404, { error: "missing_job", message: "No job with that id." });
          return;
        }
        if (job.stage === "indexed" && job.providers.twelvelabs.indexId) {
          sendJson(res, job.enrichment?.status === "ready" ? 200 : 202, publicJob(job));
          if (job.enrichment?.status !== "ready") track(publishJob(job.id, client));
          return;
        }
        const owned = await requireOwnedIndex(client);
        if (job.providers.twelvelabs.indexId && job.providers.twelvelabs.indexId !== owned.id) {
          sendJson(res, 409, {
            error: "already_on_another_index",
            message: "This file was already indexed on a different index created here.",
          });
          return;
        }
        sendJson(res, 202, publicJob(job));
        track(publishJob(job.id, client));
        return;
      }
      if (req.method === "POST" && pathname === "/api/ingestions") {
        const owned = await requireOwnedIndex(client);
        const bytes = await readFileBody(req);
        const dir = await mkdtemp(path.join(tmpdir(), "glaze-upload-"));
        const filename = safeName(url.searchParams.get("name"));
        const campaign = url.searchParams.get("campaign");
        const filePath = path.join(dir, filename);
        try {
          await writeFile(filePath, bytes);
          const saved = await ingestLocalFile(filePath, { campaign: campaign || null, probe });
          const otherIndex = saved.job.providers.twelvelabs.indexId;
          if (saved.duplicate && otherIndex && otherIndex !== owned.id) {
            sendJson(res, 409, {
              error: "already_on_another_index",
              message: "This file was already indexed on a different index created here.",
              job: publicJob(saved.job),
            });
            return;
          }
          if (!otherIndex) {
            await updateJob(saved.job.id, (job) => {
              job.providers.twelvelabs.indexId = owned.id;
              if (campaign) job.campaign = campaign;
              return job;
            });
          }
          const fresh = (await listJobs()).find((job) => job.id === saved.job.id);
          const done = saved.duplicate && fresh.stage === "indexed";
          sendJson(res, done ? 200 : 202, publicJob({ ...fresh, duplicate: saved.duplicate }));
          if (!done) track(publishJob(fresh.id, client));
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
        return;
      }
      sendJson(res, 404, { error: "not_found" });
    } catch (error) {
      if (!res.headersSent) sendError(res, error);
    }
  });

  server.whenIdle = () => Promise.all([...pending]);
  return server;
}
