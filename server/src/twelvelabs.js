import { createReadStream } from "node:fs";
import { TwelveLabs } from "twelvelabs-js";

// Installed package: twelvelabs-js 1.3.6, checked 2026-10-21.
// indexes.create / list / retrieve:
// https://docs.twelvelabs.io/v1.3/sdk-reference/node-js/manage-indexes
// assets.create / retrieve and indexes.indexedAssets.create / retrieve:
// https://docs.twelvelabs.io/v1.3/sdk-reference/node-js/index-content
// The model on a new index cannot be changed later. This demo always creates Marengo 3.0
// with visual and audio, which is the managed-search model. Pegasus segmentation does not
// use this index.
export const SEARCH_MODEL = {
  modelName: "marengo3.0",
  modelOptions: ["visual", "audio"],
};

export function liveClient() {
  const apiKey = process.env.TWELVELABS_API_KEY;
  if (!apiKey) return null;
  return new TwelveLabs({ apiKey });
}

export function providerError(error) {
  const status = error?.statusCode ?? error?.status;
  const raw = typeof error?.body === "string" ? error.body : JSON.stringify(error?.body ?? "");
  if (status === 401 || status === 403) {
    return { code: "provider_auth", message: "TwelveLabs rejected the API key." };
  }
  if (raw.includes("index_name_already_exists")) {
    return {
      code: "index_name_taken",
      message: "That name is already used. This app will not adopt an index it did not create.",
    };
  }
  if (status === 429) return { code: "rate_limited", message: "TwelveLabs rate limit. Wait and retry." };
  return { code: "provider_failed", message: "TwelveLabs request failed." };
}

export async function listAccountIndexes(client) {
  if (!client) return [];
  const page = await client.indexes.list({ pageLimit: 50, sortBy: "created_at", sortOption: "asc" });
  const indexes = [];
  for await (const index of page) {
    if (!index?.id) continue;
    const model = index.models?.[0] ?? {};
    indexes.push({
      id: index.id,
      name: index.indexName || index.id,
      createdAt: index.createdAt ?? null,
      videoCount: index.videoCount ?? 0,
      modelName: model.modelName ?? null,
      modelOptions: model.modelOptions ?? null,
    });
  }
  return indexes;
}

export async function createSearchIndex(client, indexName) {
  const created = await client.indexes.create({
    indexName,
    models: [SEARCH_MODEL],
  });
  return created.id;
}

export async function uploadAndIndex(client, args) {
  const calls = [];
  const notify = args.onProgress ?? (() => {});
  const asset = await client.assets.create({
    method: "direct",
    file: createReadStream(args.filePath),
    filename: args.filename,
  });
  calls.push("assets.create");
  await notify({ stage: "uploading", assetId: asset.id });
  await pollUntilReady(() => client.assets.retrieve(asset.id), { calls, name: "assets.retrieve", sleep: args.sleep, timeoutMs: args.timeoutMs });
  await notify({ stage: "asset_ready", assetId: asset.id });
  return indexReadyAsset(client, { ...args, assetId: asset.id, calls, notify });
}

export async function resumeIndex(client, args) {
  const notify = args.onProgress ?? (() => {});
  if (args.assetId && args.indexedAssetId) {
    const calls = [];
    const readyIndexed = await pollUntilReady(
      () => client.indexes.indexedAssets.retrieve(args.indexId, args.indexedAssetId),
      { calls, name: "indexedAssets.retrieve", sleep: args.sleep, timeoutMs: args.timeoutMs },
    );
    return {
      assetId: args.assetId,
      indexedAssetId: readyIndexed.id ?? args.indexedAssetId,
      hlsStatus: readyIndexed.hls?.status ?? null,
      calls,
    };
  }
  if (args.assetId) {
    const calls = [];
    await pollUntilReady(() => client.assets.retrieve(args.assetId), { calls, name: "assets.retrieve", sleep: args.sleep, timeoutMs: args.timeoutMs });
    await notify({ stage: "asset_ready", assetId: args.assetId });
    return indexReadyAsset(client, { ...args, calls, notify });
  }
  return uploadAndIndex(client, args);
}

async function indexReadyAsset(client, args) {
  const indexed = await client.indexes.indexedAssets.create(args.indexId, {
    assetId: args.assetId,
    enableVideoStream: true,
    userMetadata: args.userMetadata,
  });
  args.calls.push("indexedAssets.create");
  await args.notify({ stage: "indexing", assetId: args.assetId, indexedAssetId: indexed.id });
  const readyIndexed = await pollUntilReady(
    () => client.indexes.indexedAssets.retrieve(args.indexId, indexed.id),
    { calls: args.calls, name: "indexedAssets.retrieve", sleep: args.sleep, timeoutMs: args.timeoutMs },
  );
  return {
    assetId: args.assetId,
    indexedAssetId: readyIndexed.id ?? indexed.id,
    hlsStatus: readyIndexed.hls?.status ?? null,
    calls: args.calls,
  };
}

async function pollUntilReady(retrieve, { calls, name, sleep = defaultSleep, timeoutMs = 10 * 60 * 1000 }) {
  const started = Date.now();
  for (;;) {
    const current = await retrieve();
    calls.push(name);
    if (current.status === "ready") return current;
    if (current.status === "failed") {
      const error = new Error("provider asset failed");
      error.code = "provider_failed";
      throw error;
    }
    if (Date.now() - started > timeoutMs) {
      const error = new Error("provider timed out");
      error.code = "provider_timeout";
      throw error;
    }
    await sleep(2000);
  }
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
