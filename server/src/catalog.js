import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const catalogPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/catalog.json");

let cached;

export async function loadCatalog() {
  if (!cached) {
    cached = JSON.parse(await readFile(catalogPath, "utf8"));
  }
  return cached;
}

function includesPhrase(text, phrase) {
  return text.includes(phrase.trim().toLowerCase());
}

// Match an observed name or line against the synthetic catalog.
// A color word on its own is not a shade. "Crimson" does not become VM-LIP-112.
export async function resolveProduct(observationText) {
  const catalog = await loadCatalog();
  const text = String(observationText ?? "").toLowerCase();
  const products = catalog.products;

  if (!text.trim()) {
    return { status: "unresolved", sku: null, line: null, reason: "empty observation" };
  }

  const byId = products.filter((product) => includesPhrase(text, product.id));
  if (byId.length === 1) {
    return { status: "candidate", sku: byId[0].id, line: byId[0].line, reason: "catalog id mentioned" };
  }
  if (byId.length > 1) {
    return { status: "unresolved", sku: null, line: null, reason: "more than one catalog id mentioned" };
  }

  const byAlias = products.filter((product) => product.aliases.some((alias) => includesPhrase(text, alias)));
  if (byAlias.length === 1) {
    return {
      status: "candidate",
      sku: byAlias[0].id,
      line: byAlias[0].line,
      reason: "catalog alias mentioned",
    };
  }
  if (byAlias.length > 1) {
    return { status: "unresolved", sku: null, line: null, reason: "alias matched more than one SKU" };
  }

  const lines = [...new Set(products.filter((product) => includesPhrase(text, product.line)).map((product) => product.line))];
  if (lines.length === 1) {
    return {
      status: "line_only",
      sku: null,
      line: lines[0],
      reason: "product line mentioned, shade not identified",
    };
  }

  return { status: "unresolved", sku: null, line: null, reason: "no catalog match" };
}
