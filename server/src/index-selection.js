import { readFile } from "node:fs/promises";
import path from "node:path";

import { dataDir, withLock, writeJsonAtomic } from "./store.js";
import { createSearchIndex, listAccountIndexes, providerError, SEARCH_MODEL } from "./twelvelabs.js";

const ACCOUNT_CACHE_MS = 30_000;

// TwelveLabs sample index. It can be selected, and it can never receive uploads.
export const SAMPLE_SOCIAL_INDEX = {
  id: "691bc2e8a5121a03d0690e9c",
  name: "sample_social_media",
};

let accountCache = null;
let accountCachedAt = 0;

function registryPath() {
  return path.join(dataDir(), "indexes.json");
}

async function readRegistry() {
  try {
    const parsed = JSON.parse(await readFile(registryPath(), "utf8"));
    return {
      selectedId: parsed.selectedId ?? null,
      indexes: Array.isArray(parsed.indexes) ? parsed.indexes : [],
    };
  } catch (error) {
    if (error.code === "ENOENT") return { selectedId: null, indexes: [] };
    throw error;
  }
}

function clearAccountCache() {
  accountCache = null;
  accountCachedAt = 0;
}

async function loadAccount(client, refresh) {
  if (!client) return [];
  if (!refresh && accountCache && Date.now() - accountCachedAt < ACCOUNT_CACHE_MS) return accountCache;
  accountCache = await listAccountIndexes(client);
  accountCachedAt = Date.now();
  return accountCache;
}

function mergeIndexes(account, created) {
  const byId = new Map();
  for (const index of account) {
    if (index.id === SAMPLE_SOCIAL_INDEX.id) continue;
    byId.set(index.id, { ...index, createdHere: false });
  }
  for (const index of created) {
    if (index.id === SAMPLE_SOCIAL_INDEX.id) continue;
    const existing = byId.get(index.id);
    byId.set(index.id, {
      id: index.id,
      name: existing?.name || index.name,
      createdAt: existing?.createdAt ?? index.createdAt ?? null,
      videoCount: existing?.videoCount ?? 0,
      modelName: existing?.modelName ?? index.modelName ?? null,
      modelOptions: existing?.modelOptions ?? index.modelOptions ?? null,
      createdHere: true,
    });
  }
  const listed = account.find((index) => index.id === SAMPLE_SOCIAL_INDEX.id);
  const sample = {
    id: SAMPLE_SOCIAL_INDEX.id,
    name: SAMPLE_SOCIAL_INDEX.name,
    createdAt: listed?.createdAt ?? null,
    videoCount: listed?.videoCount ?? 0,
    modelName: listed?.modelName ?? null,
    modelOptions: listed?.modelOptions ?? null,
    createdHere: false,
  };
  return [sample, ...byId.values()];
}

export function acceptsUploads(index) {
  return Boolean(index?.createdHere) && index.id !== SAMPLE_SOCIAL_INDEX.id;
}

// sample_social_media is the default. Anything created here is chosen only after the user selects it.
export function pickDefaultIndex(indexes) {
  return indexes.find((index) => index.id === SAMPLE_SOCIAL_INDEX.id) ?? indexes[0] ?? null;
}

function selectionOf(index) {
  if (!index) return { id: null, name: null, acceptsVideos: false, createdHere: false };
  const acceptsVideos = acceptsUploads(index);
  return {
    id: index.id,
    name: index.name,
    acceptsVideos,
    createdHere: acceptsVideos,
  };
}

function publicIndex(index) {
  return {
    id: index.id,
    name: index.name,
    videoCount: index.videoCount ?? 0,
    createdHere: Boolean(index.createdHere),
  };
}

async function resolveSelection(client, { refresh = false } = {}) {
  return withLock(async () => {
    const registry = await readRegistry();
    const merged = mergeIndexes(await loadAccount(client, refresh), registry.indexes);
    let selected = merged.find((index) => index.id === registry.selectedId) ?? null;
    if (!selected) {
      selected = pickDefaultIndex(merged);
      registry.selectedId = selected?.id ?? null;
      await writeJsonAtomic(registryPath(), registry);
    }
    return { registry, merged, selected };
  });
}

export async function selectedIndex(client) {
  const { selected } = await resolveSelection(client);
  return selectionOf(selected);
}

export async function listSelectableIndexes(client) {
  const { merged, selected } = await resolveSelection(client, { refresh: true });
  return {
    selected: selectionOf(selected),
    indexes: merged.map(publicIndex),
  };
}

export async function requireOwnedIndex(client) {
  const { registry, selected } = await resolveSelection(client);
  if (!selected) {
    const error = new Error("Create an index in this app before adding a video.");
    error.code = "index_required";
    throw error;
  }
  if (selected.id === SAMPLE_SOCIAL_INDEX.id) {
    const error = new Error("sample_social_media cannot receive videos.");
    error.code = "index_not_ours";
    throw error;
  }
  const owned = registry.indexes.find((index) => index.id === selected.id) ?? null;
  if (!owned) {
    const error = new Error("This index was not created here, so videos cannot be added to it.");
    error.code = "index_not_ours";
    throw error;
  }
  return owned;
}

export function selectKnownIndex(id, client) {
  return withLock(async () => {
    const registry = await readRegistry();
    const merged = mergeIndexes(await loadAccount(client, true), registry.indexes);
    const match = merged.find((index) => index.id === id);
    if (!match) {
      const error = new Error("That index is not on this account.");
      error.code = "index_unknown";
      throw error;
    }
    registry.selectedId = match.id;
    await writeJsonAtomic(registryPath(), registry);
    return selectionOf(match);
  });
}

export async function createOwnedIndex(name, client) {
  const indexName = normalizeName(name);
  if (!client) {
    const error = new Error("Set TWELVELABS_API_KEY before creating an index.");
    error.code = "missing_api_key";
    throw error;
  }
  let id;
  try {
    id = await createSearchIndex(client, indexName);
  } catch (error) {
    const safe = providerError(error);
    const wrapped = new Error(safe.message);
    wrapped.code = safe.code;
    throw wrapped;
  }
  clearAccountCache();
  return withLock(async () => {
    const registry = await readRegistry();
    const record = {
      id,
      name: indexName,
      createdAt: new Date().toISOString(),
      modelName: SEARCH_MODEL.modelName,
      modelOptions: SEARCH_MODEL.modelOptions,
    };
    registry.indexes.push(record);
    registry.selectedId = id;
    await writeJsonAtomic(registryPath(), registry);
    const merged = mergeIndexes(await loadAccount(client, false), registry.indexes);
    const selected = merged.find((index) => index.id === id) ?? { ...record, videoCount: 0, createdHere: true };
    return { index: publicIndex(selected), selected: selectionOf(selected), providerCalls: 1 };
  });
}

function normalizeName(name) {
  const trimmed = String(name ?? "").trim().replace(/\s+/g, " ");
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,48}$/.test(trimmed)) {
    const error = new Error("Index name needs 1–49 letters, numbers, spaces, dots, hyphens, or underscores.");
    error.code = "invalid_name";
    throw error;
  }
  return trimmed;
}
