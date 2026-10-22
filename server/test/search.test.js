import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { CATALOG_SIZE, CATEGORY_QUOTAS } from "../src/synthetic-catalog.js";
import { createApiServer } from "../src/http.js";
import { SAMPLE_SOCIAL_INDEX } from "../src/index-selection.js";

const QUERY = "close-ups of foundation application with natural lighting";

function observation(start, end, action, sku) {
  return {
    startTime: start,
    endTime: end,
    shot: "close-up",
    action,
    setting: "bathroom",
    lighting: "natural",
    productName: sku ? "Second Skin Foundation" : "",
    productLine: sku ? "Second Skin" : "",
    onScreenText: "SECOND SKIN",
    spokenMention: "",
    skinTone: "medium",
    modelConfidence: 0.86,
    product: sku
      ? { status: "candidate", sku, line: "Second Skin", reason: "catalog alias mentioned" }
      : { status: "unresolved", sku: null, line: null, reason: "no catalog match" },
    provenance: {
      modelName: "pegasus1.6",
      textSource: "model",
      schema: "glaze-observe-1",
    },
  };
}

function fakeClient() {
  const calls = [];
  return {
    calls,
    indexes: {
      indexedAssets: {
        async retrieve(indexId, indexedAssetId) {
          calls.push(["stream.retrieve", indexId, indexedAssetId]);
          return { hls: { status: "COMPLETE", videoUrl: "https://stream.example/playlist.m3u8", thumbnailUrls: ["https://stream.example/asset-thumb.jpg"] } };
        },
      },
      async list() {
        return { async *[Symbol.asyncIterator]() { /* account list stays empty */ } };
      },
      async create() {
        return { id: "idx_ours_1" };
      },
    },
    search: {
      async create(request) {
        calls.push(["search.create", request]);
        return {
          data: [
            { videoId: "indexed_1", start: 1.2, end: 3.5, rank: 2, transcription: "blend the foundation", thumbnailUrl: "https://stream.example/thumb.jpg" },
            { videoId: "indexed_1", start: 10, end: 12, rank: 5, transcription: "later" },
            { videoId: "indexed_other", start: 0, end: 2, rank: 1, transcription: "someone else" },
          ],
          pageInfo: { nextPageToken: "page_2" },
        };
      },
      async retrieve(token) {
        calls.push(["search.retrieve", token]);
        return { data: [{ videoId: "indexed_1", start: 1.2, end: 3.5, rank: 2 }], pageInfo: {} };
      },
    },
  };
}

describe("search", { concurrency: 1 }, () => {
  let dir;
  let server;
  let base;
  let client;

  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "glaze-search-"));
    process.env.GLAZE_DATA_DIR = path.join(dir, "data");
    client = fakeClient();
    server = createApiServer({ client, probe: async () => ({ video: true, width: 1280, height: 720, durationSeconds: 12 }) });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    await mkdir(path.join(dir, "data", "jobs"), { recursive: true });
    await writeFile(path.join(dir, "data", "jobs", "glz_abc123.json"), JSON.stringify({
      id: "glz_abc123",
      stage: "indexed",
      sourceFileName: "foundation.mp4",
      durationSeconds: 20,
      campaign: "Second Skin",
      channel: "YouTube",
      providers: { twelvelabs: { assetId: "asset_1", indexId: "idx_ours_1", indexedAssetId: "indexed_1" } },
      enrichment: {
        status: "ready",
        format: { value: "tutorial" },
        observations: [
          observation(1, 4, "applied", "SS-FDN-340"),
          observation(8, 9, "shown", null),
        ],
      },
    }));
  });

  after(async () => {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    delete process.env.GLAZE_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  });

  it("searches the sample index without borrowing enrichment from an owned job", async () => {
    const response = await fetch(`${base}/api/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: QUERY }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.indexId, SAMPLE_SOCIAL_INDEX.id);
    assert.equal(body.enrichedHere, false);
    assert.equal(body.hits[0].enrichment, "not_ours");
    assert.equal(body.hits[0].product.sku, null);
    assert.equal(client.calls[0][1].queryText, QUERY);
    assert.deepEqual(client.calls[0][1].searchOptions, ["visual", "audio"]);
    assert.equal(client.calls[0][1].groupBy, "clip");
  });

  it("keeps the query text and joins only the overlapping observation", async () => {
    const created = await fetch(`${base}/api/indexes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "lab-search" }),
    });
    assert.equal(created.status, 201);
    const response = await fetch(`${base}/api/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: QUERY }),
    });
    const body = await response.json();
    const joined = body.hits.find((hit) => hit.start === 1.2);
    const later = body.hits.find((hit) => hit.start === 10);
    assert.equal(joined.product.sku, "SS-FDN-340");
    assert.equal(joined.product.line, "Second Skin");
    assert.equal(joined.product.name, "Second Skin Foundation");
    assert.equal(joined.product.status, "candidate");
    assert.equal(joined.product.reason, "catalog alias mentioned");
    assert.equal(joined.setting, "bathroom");
    assert.equal(joined.action, "applied");
    assert.equal(joined.rank, 2);
    assert.equal(joined.confidence, 0.86);
    assert.equal(joined.provenance.modelName, "pegasus1.6");
    assert.equal(joined.provenance.textSource, "model");
    assert.equal(joined.thumbnailUrl, "https://stream.example/thumb.jpg");
    assert.equal(later.thumbnailUrl, "https://stream.example/asset-thumb.jpg");
    assert.equal(later.confidence, undefined);
    assert.equal(later.provenance, null);
    assert.equal(later.product.sku, null);
    assert.equal(later.enrichment, "missing");
    assert.equal(body.hits.some((hit) => hit.videoId === "indexed_other"), true);
    const request = client.calls.findLast((call) => call[0] === "search.create")[1];
    assert.equal(request.queryText, QUERY);
    assert.equal(request.indexId, "idx_ours_1");
  });

  it("lists a SKU across campaigns from enrichment and does not search", async () => {
    const before = client.calls.filter((call) => call[0] === "search.create").length;
    const response = await fetch(`${base}/api/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "videos featuring SS-FDN-340 across campaigns" }),
    });
    const body = await response.json();
    assert.equal(body.mode, "catalog");
    assert.equal(client.calls.filter((call) => call[0] === "search.create").length, before);
    assert.equal(body.hits.length, 1);
    assert.equal(body.hits[0].product.sku, "SS-FDN-340");
    assert.equal(body.hits[0].rank, null);
    assert.match(body.note, /enrichment finished/);
    const catalog = await fetch(`${base}/api/catalog?q=inda`);
    const products = await catalog.json();
    assert.equal(catalog.status, 200);
    assert.equal(products.products.some((item) => item.id === "FENTY-INDA"), true);
    assert.equal(products.products.every((item) => item.aliases === undefined), true);
    const narrowed = await fetch(`${base}/api/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "", skus: ["SS-FDN-340", "FENTY-INDA"], formats: ["Tutorial"] }),
    });
    const narrowedBody = await narrowed.json();
    assert.equal(narrowedBody.mode, "catalog");
    assert.equal(narrowedBody.hits.length, 1);
    assert.equal(narrowedBody.hits[0].product.sku, "SS-FDN-340");
    assert.equal(client.calls.filter((call) => call[0] === "search.create").length, before);
  });

  it("sends one campaign as metadata and keeps an applied-only phrase intact", async () => {
    const response = await fetch(`${base}/api/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "moments where a product is being applied, not just shown",
        campaigns: ["Second Skin"],
      }),
    });
    const body = await response.json();
    const request = client.calls.findLast((call) => call[0] === "search.create")[1];
    assert.equal(request.queryText, "moments where a product is being applied, not just shown");
    assert.equal(request.filter, JSON.stringify({ campaign: "Second Skin" }));
    assert.equal(body.hits.length, 1);
    assert.equal(body.hits[0].action, "applied");
    assert.equal(body.postFiltered, true);
  });

  it("does not send two campaigns to TwelveLabs", async () => {
    await fetch(`${base}/api/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: QUERY, campaigns: ["Second Skin", "Other"] }),
    });
    assert.equal(client.calls.findLast((call) => call[0] === "search.create")[1].filter, undefined);
  });

  it("refuses a format the enrichment does not store", async () => {
    const response = await fetch(`${base}/api/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: QUERY, formats: ["Creator"] }),
    });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.error, "unsupported_filter");
    assert.match(body.message, /Creator/);
  });

  it("reads a later page without starting another search", async () => {
    const before = client.calls.filter((call) => call[0] === "search.create").length;
    const response = await fetch(`${base}/api/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: QUERY, pageToken: "page_2" }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    const retrieved = client.calls.findLast((call) => call[0] === "search.retrieve");
    assert.equal(retrieved[1], "page_2");
    assert.equal(client.calls.filter((call) => call[0] === "search.create").length, before);
    assert.equal(body.hits[0].product.sku, "SS-FDN-340");
  });

  it("does not describe an unreadable index as a rejected API key", async () => {
    client.search.create = async () => {
      const error = new Error("forbidden");
      error.statusCode = 403;
      error.body = { code: "read_not_allowed", message: "The caller is not authorized to read entity." };
      throw error;
    };
    const response = await fetch(`${base}/api/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: QUERY }),
    });
    const body = await response.json();
    assert.equal(response.status, 403);
    assert.equal(body.error, "index_unreadable");
    assert.match(body.message, /read_not_allowed/);
    assert.doesNotMatch(body.message, /rejected/);
  });

  it("returns the saved video without a confidence number", async () => {
    const response = await fetch(`${base}/api/videos/indexed_1`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.filename, "foundation.mp4");
    assert.equal(body.observations[0].product.sku, "SS-FDN-340");
    assert.equal(body.observations[0].confidence, undefined);
    assert.equal(body.confidence, null);
    assert.equal(body.observations[0].provenance.modelName, "pegasus1.6");
    const stream = await fetch(`${base}/api/videos/indexed_1/stream`);
    const streamBody = await stream.json();
    assert.equal(stream.status, 200);
    assert.equal(streamBody.status, "COMPLETE");
    assert.equal(streamBody.videoUrl, "https://stream.example/playlist.m3u8");
    assert.deepEqual(client.calls.at(-1), ["stream.retrieve", "idx_ours_1", "indexed_1"]);
    const missing = await fetch(`${base}/api/videos/does-not-exist`);
    assert.equal(missing.status, 404);
  });

  it("counts catalog SKUs and only videos indexed on the selected index", async () => {
    const listed = await fetch(`${base}/api/indexes`);
    const listing = await listed.json();
    if (!listing.indexes.some((index) => index.id === "idx_ours_1")) {
      const created = await fetch(`${base}/api/indexes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "lab-library" }),
      });
      assert.equal(created.status, 201);
    }
    const selected = await fetch(`${base}/api/index`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "idx_ours_1" }),
    });
    assert.equal(selected.status, 200);
    const response = await fetch(`${base}/api/library`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.summary.skuCount, CATALOG_SIZE);
    assert.equal(body.summary.videoCount, 1);
    assert.equal(body.summary.momentCount, 2);
    assert.deepEqual(body.summary.channels, ["YouTube"]);
    assert.deepEqual(
      body.summary.categories,
      CATEGORY_QUOTAS.map(([name, skuCount]) => ({ name, skuCount })).sort((a, b) => a.name.localeCompare(b.name)),
    );

    const sample = await fetch(`${base}/api/index`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: SAMPLE_SOCIAL_INDEX.id }),
    });
    assert.equal(sample.status, 200);
    const empty = await (await fetch(`${base}/api/library`)).json();
    assert.equal(empty.summary.skuCount, CATALOG_SIZE);
    assert.equal(empty.summary.videoCount, 0);
    assert.equal(empty.summary.momentCount, 0);
    assert.deepEqual(empty.summary.channels, []);
  });
});
