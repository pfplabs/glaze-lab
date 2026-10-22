import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { resolveProduct } from "../src/catalog.js";
import { ingestLocalFile, IngestError, showJob } from "../src/ingest.js";
import { evaluateMedia } from "../src/limits.js";

const videoProbe = {
  video: true,
  width: 1920,
  height: 1080,
  durationSeconds: 30,
};

let dir;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "glaze-ingest-"));
  process.env.GLAZE_DATA_DIR = path.join(dir, "data");
});

afterEach(async () => {
  delete process.env.GLAZE_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

async function fixtureFile(name, contents = "not-a-real-video") {
  const file = path.join(dir, name);
  await writeFile(file, contents);
  return file;
}

describe("ingestLocalFile", { concurrency: 1 }, () => {
  it("stores a job and reads it back", async () => {
    const file = await fixtureFile("hero.mp4");
    const first = await ingestLocalFile(file, {
      campaign: "Second Skin SS26",
      probe: async () => videoProbe,
    });

    assert.equal(first.duplicate, false);
    assert.equal(first.job.stage, "stored");
    assert.equal(first.job.campaign, "Second Skin SS26");
    assert.equal(first.job.usage.providerCalls, 0);
    assert.equal(first.job.providers.twelvelabs.assetId, null);
    assert.match(first.job.contentHash, /^[0-9a-f]{64}$/);

    const again = await showJob(first.job.id);
    assert.equal(again.id, first.job.id);
    assert.equal(again.mediaPath, `uploads/${first.job.id}/hero.mp4`);
  });

  it("returns the same job for the same bytes", async () => {
    const file = await fixtureFile("once.mp4", "same-bytes");
    const probe = async () => videoProbe;
    const first = await ingestLocalFile(file, { probe });
    const second = await ingestLocalFile(file, { probe });

    assert.equal(second.duplicate, true);
    assert.equal(second.job.id, first.job.id);
  });

  it("rejects a missing file", async () => {
    await assert.rejects(ingestLocalFile(path.join(dir, "nope.mp4")), (error) => {
      assert.ok(error instanceof IngestError);
      assert.equal(error.code, "missing_file");
      return true;
    });
  });

  it("rejects a text file before treating it as video", async () => {
    const file = await fixtureFile("notes.txt", "hello");
    await assert.rejects(ingestLocalFile(file, { probe: async () => videoProbe }), (error) => {
      assert.equal(error.code, "invalid_media");
      assert.equal(error.details[0].code, "not_video");
      return true;
    });
  });
});

describe("evaluateMedia", { concurrency: 1 }, () => {
  const ok = {
    ext: ".mp4",
    bytes: 1000,
    video: true,
    width: 1280,
    height: 720,
    durationSeconds: 12,
  };

  it("accepts a short 720p file", () => {
    assert.deepEqual(evaluateMedia(ok), []);
  });

  it("rejects a file over the direct-upload cap", () => {
    const problems = evaluateMedia({ ...ok, bytes: 200 * 1024 * 1024 + 1 });
    assert.equal(problems[0].code, "file_too_large");
  });

  it("rejects a clip shorter than Marengo's minimum", () => {
    const problems = evaluateMedia({ ...ok, durationSeconds: 3 });
    assert.equal(problems[0].code, "duration_out_of_range");
  });

  it("rejects a video longer than Pegasus full-video analysis", () => {
    const problems = evaluateMedia({ ...ok, durationSeconds: 3 * 60 * 60 });
    assert.equal(problems[0].code, "duration_out_of_range");
  });
});

describe("resolveProduct", { concurrency: 1 }, () => {
  it("matches a catalog alias to one SKU", async () => {
    const match = await resolveProduct("Creator holds the Velvet Matte Crimson lipstick");
    assert.equal(match.status, "candidate");
    assert.equal(match.sku, "VM-LIP-112");
  });

  it("keeps a product line when the shade is not identified", async () => {
    const match = await resolveProduct("A Second Skin bottle is on the counter");
    assert.equal(match.status, "line_only");
    assert.equal(match.sku, null);
    assert.equal(match.line, "Second Skin");
  });

  it("does not turn a color word into a shade SKU", async () => {
    const match = await resolveProduct("red lipstick on a medium skin tone");
    assert.equal(match.status, "unresolved");
    assert.equal(match.sku, null);
  });
});
