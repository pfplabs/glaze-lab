import { loadCatalog } from "./catalog.js";
import { listJobs } from "./store.js";
import { providerError } from "./twelvelabs.js";

// twelvelabs-js 1.3.6 exposes search.create and search.retrieve.
// The search guide calls the same request search.query.
// https://docs.twelvelabs.io/v1.3/docs/guides/search
const SEARCH_OPTIONS = ["visual", "audio"];
const PAGE_LIMIT = 12;
const FILTERED_PAGE_LIMIT = 50;

const FORMAT_TO_VALUE = {
  Tutorial: "tutorial",
  "Before/After": "before_after",
  Ad: "ad",
  Demo: "demo",
};

const ATTRIBUTE_TO_FIELD = {
  application: ["action", "applied"],
  "close-up": ["shot", "close-up"],
  packshot: ["shot", "packshot"],
  "natural lighting": ["lighting", "natural"],
  "studio lighting": ["lighting", "studio"],
};

const PRODUCT_STATUSES = new Set(["candidate", "line_only", "unresolved"]);

export class SearchError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SearchError";
    this.code = code;
  }
}

function jobIndexId(job) {
  return job.providers?.twelvelabs?.indexId ?? null;
}

function catalogSkus(query, skus) {
  const match = String(query ?? "").match(/videos featuring\s+([A-Za-z0-9-]+)\s+across campaigns/i);
  if (match) return [match[1].toUpperCase()];
  if (!String(query ?? "").trim() && skus.length > 0) return skus;
  return null;
}

function wantsAppliedOnly(query) {
  return /being applied, not just shown|applied, not just shown/i.test(String(query ?? ""));
}

function bestObservation(observations, start, end) {
  let chosen = null;
  let best = 0;
  for (const observation of observations ?? []) {
    const span = Math.min(end, observation.endTime) - Math.max(start, observation.startTime);
    if (span > best) {
      chosen = observation;
      best = span;
    }
  }
  return best > 0 ? chosen : null;
}

function jobsByVideoId(jobs) {
  const byId = new Map();
  for (const job of jobs) {
    const provider = job.providers?.twelvelabs ?? {};
    if (provider.indexedAssetId) byId.set(provider.indexedAssetId, job);
    if (provider.assetId) byId.set(provider.assetId, job);
    byId.set(job.id, job);
  }
  return byId;
}

function httpsUrl(value) {
  return typeof value === "string" && value.startsWith("https://") ? value : null;
}

async function fillThumbnails(client, hits, jobs) {
  if (!client?.indexes?.indexedAssets?.retrieve) return;
  const byVideo = jobsByVideoId(jobs);
  const lookups = new Map();
  for (const hit of hits) {
    if (hit.thumbnailUrl || !hit.videoId || lookups.has(hit.videoId)) continue;
    const provider = byVideo.get(hit.videoId)?.providers?.twelvelabs ?? {};
    if (!provider.indexId || !provider.indexedAssetId) continue;
    lookups.set(hit.videoId, client.indexes.indexedAssets.retrieve(provider.indexId, provider.indexedAssetId)
      .then((indexed) => httpsUrl(indexed?.hls?.thumbnailUrls?.[0]))
      .catch(() => null));
  }
  const found = new Map(await Promise.all([...lookups].map(async ([id, promise]) => [id, await promise])));
  for (const hit of hits) {
    if (!hit.thumbnailUrl && found.get(hit.videoId)) hit.thumbnailUrl = found.get(hit.videoId);
  }
}

function clipRows(result) {
  const rows = [];
  for (const item of result?.data ?? []) {
    if (Array.isArray(item.clips) && item.clips.length) {
      for (const clip of item.clips) {
        rows.push({
          videoId: clip.videoId ?? item.id ?? item.videoId ?? null,
          start: clip.start ?? null,
          end: clip.end ?? null,
          rank: clip.rank ?? null,
          transcription: clip.transcription ?? "",
          thumbnailUrl: httpsUrl(clip.thumbnailUrl),
          userMetadata: clip.userMetadata ?? item.userMetadata ?? null,
        });
      }
      continue;
    }
    rows.push({
      videoId: item.videoId ?? item.id ?? null,
      start: item.start ?? null,
      end: item.end ?? null,
      rank: item.rank ?? null,
      transcription: item.transcription ?? "",
      thumbnailUrl: httpsUrl(item.thumbnailUrl),
      userMetadata: item.userMetadata ?? null,
    });
  }
  return rows;
}

function productOf(observation) {
  if (!observation) return { status: null, sku: null, line: null, name: null, reason: null };
  const product = observation.product ?? {};
  return {
    status: product.status ?? "unresolved",
    sku: product.sku ?? null,
    line: product.line ?? null,
    name: observation.productName || null,
    reason: product.reason ?? null,
  };
}

function provenanceOf(observation) {
  const source = observation?.provenance;
  if (!source) return null;
  return {
    modelName: source.modelName ?? null,
    textSource: source.textSource ?? null,
    schema: source.schema ?? null,
  };
}

function hitFromJob(job, observation, extra) {
  return {
    videoId: job.providers?.twelvelabs?.indexedAssetId ?? job.id,
    jobId: job.id,
    filename: job.sourceFileName ?? job.filename ?? job.id,
    campaign: job.campaign ?? null,
    format: job.enrichment?.format?.value ?? null,
    start: extra.start ?? observation?.startTime ?? null,
    end: extra.end ?? observation?.endTime ?? null,
    rank: extra.rank ?? null,
    confidence: typeof observation?.modelConfidence === "number" ? observation.modelConfidence : (observation ? null : undefined),
    transcription: extra.transcription ?? "",
    thumbnailUrl: extra.thumbnailUrl ?? null,
    product: productOf(observation),
    observedLine: observation?.productLine ?? "",
    action: observation?.action ?? null,
    shot: observation?.shot ?? null,
    setting: observation?.setting ?? "",
    lighting: observation?.lighting ?? null,
    skinTone: observation?.skinTone ?? "",
    onScreenText: observation?.onScreenText ?? "",
    spokenMention: observation?.spokenMention ?? "",
    provenance: provenanceOf(observation),
    enrichment: extra.enrichment,
  };
}

function passesLocalFilters(hit, filters) {
  if (filters.formats.length && !filters.formats.includes(hit.format)) return false;
  if (filters.campaigns.length && !filters.campaigns.includes(hit.campaign)) return false;
  if (filters.skus.length && !filters.skus.includes(hit.product.sku)) return false;
  if (filters.productStatus && hit.product.status !== filters.productStatus) return false;
  if (filters.appliedOnly && hit.action !== "applied") return false;
  for (const attribute of filters.attributes) {
    const pair = ATTRIBUTE_TO_FIELD[attribute];
    if (pair && hit[pair[0]] !== pair[1]) return false;
  }
  return true;
}

function normalizeFilters(body) {
  const formats = [];
  for (const label of body.formats ?? []) {
    if (label === "Creator") {
      throw new SearchError("unsupported_filter", "Creator is not an enrichment format. The model uses tutorial, demo, ad, before/after, or other.");
    }
    const value = FORMAT_TO_VALUE[label];
    if (!value) throw new SearchError("unsupported_filter", `${label} is not an enrichment format.`);
    formats.push(value);
  }
  const attributes = [];
  for (const attribute of body.attributes ?? []) {
    if (!ATTRIBUTE_TO_FIELD[attribute]) {
      throw new SearchError("unsupported_filter", `${attribute} cannot be filtered. Enrichment did not store that field.`);
    }
    attributes.push(attribute);
  }
  const productStatus = body.productStatus ?? null;
  if (productStatus && !PRODUCT_STATUSES.has(productStatus)) {
    throw new SearchError("unsupported_filter", "Product status must be candidate, line_only, or unresolved.");
  }
  return {
    formats,
    attributes,
    skus: [...(body.skus ?? [])],
    campaigns: [...(body.campaigns ?? [])].filter(Boolean),
    productStatus,
    appliedOnly: wantsAppliedOnly(body.query),
  };
}

function throwProvider(error) {
  const safe = providerError(error);
  const wrapped = new Error(safe.message);
  wrapped.code = safe.code;
  throw wrapped;
}

async function catalogHits(indexId, skus) {
  const wanted = new Set(skus);
  const jobs = (await listJobs()).filter((job) => jobIndexId(job) === indexId && job.enrichment?.status === "ready");
  const hits = [];
  for (const job of jobs) {
    for (const observation of job.enrichment.observations ?? []) {
      if (observation.product?.status === "candidate" && wanted.has(observation.product.sku)) {
        hits.push(hitFromJob(job, observation, { rank: null, transcription: "", enrichment: "joined" }));
      }
    }
  }
  return { jobsScanned: jobs.length, hits, jobs };
}

export async function searchFacets(indexId) {
  const jobs = (await listJobs()).filter((job) => jobIndexId(job) === indexId);
  const campaigns = [...new Set(jobs.map((job) => job.campaign).filter(Boolean))].sort();
  return {
    formats: Object.keys(FORMAT_TO_VALUE).filter((label) => label !== "Creator"),
    disabledFormats: ["Creator"],
    attributes: Object.keys(ATTRIBUTE_TO_FIELD),
    campaigns,
    productStatuses: [...PRODUCT_STATUSES],
  };
}

export async function librarySummary(indexId) {
  const catalog = await loadCatalog();
  const jobs = indexId
    ? (await listJobs()).filter((job) => jobIndexId(job) === indexId && job.stage === "indexed")
    : [];
  let momentCount = 0;
  let syncedAt = null;
  const channels = new Set();
  for (const job of jobs) {
    if (job.channel) channels.add(String(job.channel));
    if (job.updatedAt && (!syncedAt || String(job.updatedAt) > syncedAt)) syncedAt = String(job.updatedAt);
    if (job.enrichment?.status === "ready") momentCount += job.enrichment.observations?.length ?? 0;
  }
  const categoryCounts = new Map();
  for (const product of catalog.products) {
    const name = String(product.category ?? "").trim();
    if (!name) continue;
    categoryCounts.set(name, (categoryCounts.get(name) ?? 0) + 1);
  }
  return {
    skuCount: catalog.products.length,
    videoCount: jobs.length,
    momentCount,
    channels: [...channels].sort(),
    categories: [...categoryCounts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, skuCount]) => ({ name, skuCount })),
    syncedAt,
  };
}

export async function searchLibrary(client, index, body) {
  const query = String(body.query ?? "").trim();
  const filters = normalizeFilters({ ...body, query });
  const enrichedHere = index.createdHere === true;
  const localFilters = Boolean(
    filters.formats.length
    || filters.attributes.length
    || filters.skus.length
    || filters.campaigns.length
    || filters.productStatus
    || filters.appliedOnly,
  );
  const skuList = catalogSkus(query, filters.skus);

  if (skuList) {
    if (!enrichedHere) {
      return {
        mode: "catalog",
        indexId: index.id,
        enrichedHere: false,
        postFiltered: false,
        note: "This index was not enriched by this app, so it has no SKU observations to list.",
        pageToken: null,
        hits: [],
      };
    }
    const found = await catalogHits(index.id, skuList);
    const hits = found.hits.filter((hit) => passesLocalFilters(hit, filters));
    await fillThumbnails(client, hits, found.jobs);
    return {
      mode: "catalog",
      indexId: index.id,
      enrichedHere: true,
      postFiltered: hits.length !== found.hits.length,
      note: `Listed from ${found.jobsScanned} videos whose enrichment finished on this index. A video still indexing, or one whose enrichment failed, is not here. This list has no search rank.`,
      pageToken: null,
      hits,
    };
  }

  if (!query) throw new SearchError("invalid_query", "Enter a description of the moment.");
  if (query.length > 1000) throw new SearchError("invalid_query", "Keep the query under 1000 characters.");
  if (!client?.search?.create) throw new SearchError("search_unavailable", "Search is not configured.");

  const providerFilter = filters.campaigns.length === 1 ? JSON.stringify({ campaign: filters.campaigns[0] }) : undefined;
  let result;
  try {
    result = body.pageToken
      ? await client.search.retrieve(body.pageToken, { includeUserMetadata: true })
      : await client.search.create({
          indexId: index.id,
          queryText: query,
          searchOptions: SEARCH_OPTIONS,
          operator: "or",
          groupBy: "clip",
          pageLimit: localFilters ? FILTERED_PAGE_LIMIT : PAGE_LIMIT,
          includeUserMetadata: true,
          ...(providerFilter ? { filter: providerFilter } : {}),
        });
  } catch (error) {
    throwProvider(error);
  }

  const jobs = enrichedHere ? (await listJobs()).filter((job) => jobIndexId(job) === index.id) : [];
  const byVideo = jobsByVideoId(jobs);
  const hits = [];
  let dropped = 0;
  for (const row of clipRows(result)) {
    const job = row.videoId ? byVideo.get(row.videoId) : null;
    const observation = job?.enrichment?.status === "ready"
      ? bestObservation(job.enrichment.observations, row.start ?? 0, row.end ?? 0)
      : null;
    const hit = job
      ? hitFromJob(job, observation, {
          start: row.start,
          end: row.end,
          rank: row.rank,
          transcription: row.transcription,
          thumbnailUrl: row.thumbnailUrl,
          enrichment: observation ? "joined" : "missing",
        })
      : {
          videoId: row.videoId,
          jobId: null,
          filename: row.userMetadata?.filename ?? row.videoId,
          campaign: row.userMetadata?.campaign ?? null,
          format: null,
          start: row.start,
          end: row.end,
          rank: row.rank,
          transcription: row.transcription ?? "",
          thumbnailUrl: row.thumbnailUrl ?? null,
          product: { status: null, sku: null, line: null, name: null, reason: null },
          observedLine: "",
          action: null,
          shot: null,
          setting: "",
          lighting: null,
          skinTone: "",
          onScreenText: "",
          spokenMention: "",
          provenance: null,
          enrichment: "not_ours",
        };
    if (job && hit.campaign == null && row.userMetadata?.campaign) hit.campaign = row.userMetadata.campaign;
    if (localFilters && !passesLocalFilters(hit, filters)) {
      dropped += 1;
      continue;
    }
    hits.push(hit);
  }
  await fillThumbnails(client, hits, jobs);

  const notes = [];
  if (!enrichedHere) notes.push("This index was not enriched by this app. Each moment has a rank and a time range, and no product observation.");
  if (providerFilter) notes.push("Campaign was sent to TwelveLabs as metadata on the indexed video.");
  if (filters.campaigns.length > 1) notes.push("More than one campaign was kept locally. The search itself was not narrowed to those campaigns.");
  if (filters.appliedOnly) notes.push("Kept only moments whose overlapping observation says the product is applied.");
  if (dropped || filters.formats.length || filters.attributes.length || filters.skus.length || filters.productStatus) {
    notes.push("Format, shot, lighting, action, and SKU were applied after the search, on this page. A missing moment is not proof it is absent from the index.");
  }
  if (result?.pageInfo?.nextPageToken) notes.push("The next page reads this same search. It is not a new query.");

  return {
    mode: "moments",
    indexId: index.id,
    enrichedHere,
    postFiltered: dropped > 0 || filters.campaigns.length > 1 || Boolean(filters.formats.length || filters.attributes.length || filters.skus.length || filters.productStatus || filters.appliedOnly),
    note: notes.filter(Boolean).join(" ") || null,
    pageToken: result?.pageInfo?.nextPageToken ?? null,
    hits,
  };
}

function libraryJob(jobs, id) {
  return jobs.find((item) => {
    const provider = item.providers?.twelvelabs ?? {};
    return item.id === id || provider.indexedAssetId === id || provider.assetId === id;
  }) ?? null;
}

export async function streamForLibraryVideo(client, id) {
  const job = libraryJob(await listJobs(), id);
  if (!job) {
    const error = new Error("No local record for that video.");
    error.code = "missing_video";
    throw error;
  }
  const provider = job.providers?.twelvelabs ?? {};
  if (!provider.indexId || !provider.indexedAssetId) {
    const error = new Error("This video is not indexed yet.");
    error.code = "stream_unavailable";
    throw error;
  }
  if (!client?.indexes?.indexedAssets?.retrieve) {
    const error = new Error("Playback is not configured.");
    error.code = "search_unavailable";
    throw error;
  }
  let indexed;
  try {
    indexed = await client.indexes.indexedAssets.retrieve(provider.indexId, provider.indexedAssetId);
  } catch (error) {
    throwProvider(error);
  }
  const status = indexed?.hls?.status ?? null;
  const videoUrl = status === "COMPLETE" ? indexed?.hls?.videoUrl ?? null : null;
  if (!videoUrl) {
    const error = new Error(status === "PROCESSING"
      ? "The TwelveLabs stream is still encoding."
      : "TwelveLabs did not return a stream for this video.");
    error.code = "stream_unavailable";
    throw error;
  }
  return { videoUrl, status };
}

export async function findLibraryVideo(id) {
  const job = libraryJob(await listJobs(), id);
  if (!job) return null;
  return {
    id: job.providers?.twelvelabs?.indexedAssetId ?? job.id,
    jobId: job.id,
    filename: job.sourceFileName,
    campaign: job.campaign,
    format: job.enrichment?.format?.value ?? null,
    duration: job.durationSeconds,
    enrichmentStatus: job.enrichment?.status ?? "not_started",
    confidence: null,
    observations: job.enrichment?.status === "ready" ? job.enrichment.observations ?? [] : [],
  };
}
