import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { createApiServer } from "../src/http.js";
import { SAMPLE_SOCIAL_INDEX } from "../src/index-selection.js";

describe("GET /api/index", () => {
  let dir;
  let server;
  let base;

  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "glaze-index-"));
    process.env.GLAZE_DATA_DIR = path.join(dir, "data");
    server = createApiServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    base = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    delete process.env.GLAZE_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  });

  it("defaults to sample_social_media and does not accept uploads", async () => {
    const response = await fetch(`${base}/api/index`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      id: SAMPLE_SOCIAL_INDEX.id,
      name: SAMPLE_SOCIAL_INDEX.name,
      acceptsVideos: false,
      createdHere: false,
    });
  });

  it("does not invent other routes", async () => {
    const response = await fetch(`${base}/api/search`);
    assert.equal(response.status, 404);
  });
});
