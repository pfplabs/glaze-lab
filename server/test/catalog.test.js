import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findProducts, loadCatalog, resolveProduct } from "../src/catalog.js";
import { CATALOG_SIZE, CATEGORY_QUOTAS } from "../src/synthetic-catalog.js";

const NAMED_IDS = [
  "TARTE-PRIMER",
  "IT-CC-FAIR",
  "CATRICE-005",
  "HG-VEIL",
  "NYX-BROW-ASH",
  "IT-BROW-POWDER",
  "IT-OMBRE-WARM",
  "FENTY-INDA",
  "FENTY-GLOSS",
  "UD-ALL-NIGHTER",
  "TF-MASCARA",
  "ALAMAR-BLUSH",
  "HG-AMBIENT",
  "TARTE-BLOOM",
];

describe("catalog scale", () => {
  it("keeps the named products and fills the catalog to 10,000 SKUs", async () => {
    const catalog = await loadCatalog();
    assert.equal(catalog.products.length, CATALOG_SIZE);
    assert.equal(CATEGORY_QUOTAS.reduce((sum, [, count]) => sum + count, 0), CATALOG_SIZE);
    for (const id of NAMED_IDS) {
      assert.equal(catalog.products.filter((product) => product.id === id).length, 1);
    }
    const synthetic = catalog.products.filter((product) => product.synthetic === true);
    assert.equal(synthetic.length, CATALOG_SIZE - NAMED_IDS.length);
    assert.equal(new Set(catalog.products.map((product) => product.id)).size, CATALOG_SIZE);

    const aliases = synthetic.map((product) => product.aliases[0]);
    assert.equal(new Set(aliases).size, aliases.length);
    const byBrand = new Map();
    for (const alias of aliases) {
      const brand = alias.slice(0, alias.indexOf(" "));
      byBrand.set(brand, [...(byBrand.get(brand) ?? []), alias]);
    }
    for (const group of byBrand.values()) {
      const sorted = [...group].sort((a, b) => a.length - b.length);
      for (let i = 0; i < sorted.length; i += 1) {
        for (let j = i + 1; j < sorted.length; j += 1) {
          assert.equal(sorted[j].includes(sorted[i]), false, `${sorted[i]} is inside ${sorted[j]}`);
        }
      }
    }
  });

  it("resolves a synthetic shade and still resolves the named products", async () => {
    const catalog = await loadCatalog();
    const sample = catalog.products.find((product) => product.synthetic === true);
    const match = await resolveProduct(sample.aliases[0]);
    assert.equal(match.status, "candidate");
    assert.equal(match.sku, sample.id);

    const line = await resolveProduct(sample.line);
    assert.equal(line.status, "line_only");
    assert.equal(line.line, sample.line);

    const named = await resolveProduct("Creator holds the Timeless Smoothing Primer");
    assert.equal(named.status, "candidate");
    assert.equal(named.sku, "TARTE-PRIMER");

    const veil = await resolveProduct("A Veil compact is on the counter");
    assert.equal(veil.status, "line_only");
    assert.equal(veil.line, "Veil");

    const shade = await resolveProduct("ash brown on a light skin tone");
    assert.equal(shade.status, "unresolved");
    assert.equal(shade.sku, null);
  });

  it("still finds the named Fenty shade ahead of the filler", async () => {
    const products = await findProducts("inda");
    assert.equal(products[0]?.id, "FENTY-INDA");
    assert.ok(products.length <= 8);
  });
});
