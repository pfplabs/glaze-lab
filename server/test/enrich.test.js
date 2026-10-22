import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeEnrichment } from "../src/enrich.js";

const context = { assetId: "asset_1", taskId: "task_1" };

function payload(observation) {
  return JSON.stringify({
    format: [
      { start_time: 0, end_time: 4, metadata: { format: "ad" } },
      { start_time: 4, end_time: 20, metadata: { format: "tutorial" } },
    ],
    observation: [observation],
  });
}

describe("normalizeEnrichment", () => {
  it("keeps the longest format and resolves an alias to a candidate SKU", async () => {
    const result = await normalizeEnrichment(payload({
      start_time: 4,
      end_time: 9,
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
    }), context);
    assert.equal(result.format.value, "tutorial");
    assert.equal(result.format.chosenBy, "longest_segment");
    assert.equal(result.observations[0].product.status, "candidate");
    assert.equal(result.observations[0].product.sku, "TARTE-PRIMER");
    assert.equal(result.observations[0].action, "applied");
    assert.equal(result.observations[0].modelConfidence, 0.86);
    assert.equal(result.observations[0].provenance.textSource, "model");
    assert.equal(result.observations[0].provenance.modelName, "pegasus1.6");
  });

  it("keeps the named product when on-screen text also names another SKU", async () => {
    const result = await normalizeEnrichment(payload({
      start_time: 197,
      end_time: 224,
      metadata: {
        product_name: "Micro Brow Pencil",
        product_line: "NYX",
        shot: "close-up",
        action: "shown",
        setting: "desk",
        lighting: "studio",
        on_screen_text: "NYX Brow Power Powder | Micro Brow Pencil in Ash Brown",
        spoken_mention: "NYX Micro Brow Pencil in Ash Brown",
        skin_tone: "light",
        confidence: 0.74,
      },
    }), context);
    assert.equal(result.observations[0].product.status, "candidate");
    assert.equal(result.observations[0].product.sku, "NYX-BROW-ASH");
  });

  it("does not turn a color word into a shade SKU", async () => {
    const result = await normalizeEnrichment(payload({
      start_time: 1,
      end_time: 3,
      metadata: {
        product_name: "crimson",
        product_line: "",
        shot: "packshot",
        action: "shown",
        setting: "",
        lighting: "studio",
        on_screen_text: "crimson",
        spoken_mention: "",
        skin_tone: "",
        confidence: 0.2,
      },
    }), context);
    assert.equal(result.observations[0].product.status, "unresolved");
    assert.equal(result.observations[0].product.sku, null);
  });

  it("rejects a percentage in place of a 0 to 1 confidence", async () => {
    await assert.rejects(
      () => normalizeEnrichment(payload({
        start_time: 1,
        end_time: 3,
        metadata: {
          product_name: "",
          product_line: "",
          shot: "close-up",
          action: "shown",
          setting: "",
          lighting: "studio",
          on_screen_text: "",
          spoken_mention: "",
          skin_tone: "",
          confidence: 86,
        },
      }), context),
      (error) => error.code === "schema_invalid",
    );
  });

  it("rejects a segment without metadata", async () => {
    await assert.rejects(
      () => normalizeEnrichment(JSON.stringify({
        format: [{ start_time: 0, end_time: 5 }],
        observation: [],
      }), context),
      (error) => error.code === "schema_invalid",
    );
  });
});