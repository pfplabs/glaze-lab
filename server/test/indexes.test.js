import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { createApiServer } from "../src/http.js";
import { SAMPLE_SOCIAL_INDEX } from "../src/index-selection.js";

function fakeClient() {
  const calls = [];
  return {
    calls,
    indexes: {
      async list() {
        calls.push("indexes.list");
        const items = [
          { id: "idx_default", indexName: "My Index (Default)", videoCount: 0, models: [] },
          { id: "idx_desk", indexName: "desk-corpus", videoCount: 3, models: [] },
        ];
        return {
          async *[Symbol.asyncIterator]() {
            for (const item of items) yield item;
          },
        };
      },
      async create({ indexName }) {
        calls.push(["indexes.create", indexName]);
        return { id: "idx_ours_1" };
      },
      indexedAssets: {
        async create(indexId, request) {
          calls.push(["indexedAssets.create", indexId, request.assetId, request.enableVideoStream]);
          return { id: "indexed_1", assetId: request.assetId };
        },
        async retrieve() {
          calls.push("indexedAssets.retrieve");
          return { id: "indexed_1", status: "ready", hls: { status: "COMPLETE" } };
        },
      },
    },
    analyzeAsync: {
      tasks: {
        async create(request) {
          calls.push(["analyze.create", request.video.assetId, request.modelName, request.analysisMode]);
          return { taskId: "task_1", status: "processing" };
        },
        async retrieve() {
          calls.push("analyze.retrieve");
          return {
            status: "ready",
            result: {
              data: JSON.stringify({
                format: [{ start_time: 0, end_time: 12, metadata: { format: "tutorial" } }],
                observation: [{
                  start_time: 1,
                  end_time: 4,
                  metadata: {
                    product_name: "Timeless Smoothing Primer",
                    product_line: "Tarte Cosmetics",
                    shot: "close-up",
                    action: "applied",
                    setting: "bathroom",
                    lighting: "natural",
                    on_screen_text: "",
                    spoken_mention: "tarte cosmetics timeless smoothing primer",
                    skin_tone: "medium",
                    confidence: 0.86,
                  },
                }],
              }),
            },
          };
        },
      },
    },
    assets: {
      async create(request) {
        request.file?.destroy?.();
        calls.push("assets.create");
        return { id: "asset_1", status: "processing" };
      },
      async retrieve() {
        calls.push("assets.retrieve");
        return { id: "asset_1", status: "ready" };
      },
    },
  };
}

describe("indexes and ingest", { concurrency: 1 }, () => {
  let dir;
  let server;
  let base;
  let client;

  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "glaze-api-"));
    process.env.GLAZE_DATA_DIR = path.join(dir, "data");
    client = fakeClient();
    server = createApiServer({
      client,
      probe: async () => ({ video: true, width: 1280, height: 720, durationSeconds: 12 }),
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    delete process.env.GLAZE_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  });

  it("defaults to sample_social_media and refuses uploads there", async () => {
    const current = await fetch(`${base}/api/index`);
    assert.deepEqual(await current.json(), {
      id: SAMPLE_SOCIAL_INDEX.id,
      name: SAMPLE_SOCIAL_INDEX.name,
      acceptsVideos: false,
      createdHere: false,
    });

    const listed = await fetch(`${base}/api/indexes`);
    const { indexes } = await listed.json();
    assert.equal(indexes[0].name, "sample_social_media");
    assert.equal(indexes[0].createdHere, false);
    assert.ok(indexes.some((index) => index.name === "desk-corpus" && index.createdHere === false));

    const uploaded = await fetch(`${base}/api/ingestions?name=clip.mp4`, {
      method: "POST",
      body: Buffer.from("video-bytes"),
    });
    assert.equal(uploaded.status, 409);
    assert.equal((await uploaded.json()).error, "index_not_ours");
    assert.equal(client.calls.includes("assets.create"), false);

    const unknown = await fetch(`${base}/api/index`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "not-an-index" }),
    });
    assert.equal(unknown.status, 409);
    assert.equal((await unknown.json()).error, "index_unknown");
  });

  it("refuses a video on an account index this app did not create", async () => {
    const selected = await fetch(`${base}/api/index`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "idx_desk" }),
    });
    assert.equal(selected.status, 200);
    assert.equal((await selected.json()).acceptsVideos, false);

    const response = await fetch(`${base}/api/ingestions?name=clip.mp4`, {
      method: "POST",
      body: Buffer.from("video-bytes"),
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, "index_not_ours");
    assert.equal(client.calls.includes("assets.create"), false);
  });

  it("refuses sample_social_media even if the local registry claims it", async () => {
    await writeFile(
      path.join(process.env.GLAZE_DATA_DIR, "indexes.json"),
      JSON.stringify({
        selectedId: SAMPLE_SOCIAL_INDEX.id,
        indexes: [{
          id: SAMPLE_SOCIAL_INDEX.id,
          name: SAMPLE_SOCIAL_INDEX.name,
          createdAt: "2026-01-01T00:00:00.000Z",
          modelName: "marengo3.0",
          modelOptions: ["visual", "audio"],
        }],
      }),
    );
    const current = await fetch(`${base}/api/index`);
    assert.equal((await current.json()).acceptsVideos, false);
    const uploaded = await fetch(`${base}/api/ingestions?name=clip.mp4`, {
      method: "POST",
      body: Buffer.from("video-bytes"),
    });
    assert.equal(uploaded.status, 409);
    assert.equal((await uploaded.json()).error, "index_not_ours");
    assert.equal(client.calls.includes("assets.create"), false);
  });

  it("creates an index, selects it, and indexes one video into it", async () => {
    const created = await fetch(`${base}/api/indexes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Glaze demo" }),
    });
    assert.equal(created.status, 201);
    const createdBody = await created.json();
    assert.equal(createdBody.index.id, "idx_ours_1");
    assert.equal(createdBody.selected.acceptsVideos, true);
    assert.deepEqual(client.calls.find((call) => Array.isArray(call) && call[0] === "indexes.create"), ["indexes.create", "Glaze demo"]);

    const file = path.join(dir, "clip.mp4");
    await writeFile(file, "a-real-enough-file");
    const uploaded = await fetch(`${base}/api/ingestions?name=clip.mp4&campaign=Second%20Skin`, {
      method: "POST",
      body: await (await import("node:fs/promises")).readFile(file),
    });
    assert.equal(uploaded.status, 202);
    await server.whenIdle();

    const listed = await fetch(`${base}/api/ingestions`);
    const { jobs } = await listed.json();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].stage, "indexed");
    assert.equal(jobs[0].indexId, "idx_ours_1");
    assert.equal(jobs[0].assetId, "asset_1");
    assert.equal(jobs[0].indexedAssetId, "indexed_1");
    assert.equal(jobs[0].campaign, "Second Skin");
    assert.equal(jobs[0].enrichmentStatus, "ready");
    assert.equal(jobs[0].enrichmentFormat, "tutorial");
    assert.equal(jobs[0].observationCount, 1);
    assert.equal(jobs[0].searchReady, true);
    assert.ok(jobs[0].providerCalls >= 4);
    assert.equal(client.calls.filter((call) => call === "assets.create").length, 1);
    assert.equal(client.calls.filter((call) => Array.isArray(call) && call[0] === "analyze.create").length, 1);
    const indexedAt = client.calls.findIndex((call) => call === "indexedAssets.retrieve");
    const analyzeAt = client.calls.findIndex((call) => Array.isArray(call) && call[0] === "analyze.create");
    assert.ok(indexedAt >= 0 && analyzeAt > indexedAt);

    const saved = JSON.parse(await (await import("node:fs/promises")).readFile(path.join(process.env.GLAZE_DATA_DIR, "jobs", `${jobs[0].id}.json`), "utf8"));
    assert.equal(saved.enrichment.observations[0].product.status, "candidate");
    assert.equal(saved.enrichment.observations[0].product.sku, "TARTE-PRIMER");
    assert.equal(typeof saved.enrichment.raw, "string");

    const again = await fetch(`${base}/api/ingestions?name=clip.mp4`, {
      method: "POST",
      body: await (await import("node:fs/promises")).readFile(file),
    });
    assert.equal(again.status, 200);
    await server.whenIdle();
    assert.equal(client.calls.filter((call) => call === "assets.create").length, 1);
    assert.equal(client.calls.filter((call) => Array.isArray(call) && call[0] === "analyze.create").length, 1);
  });
});
