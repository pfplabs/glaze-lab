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

// Match an observed name or line against the catalog.
// A shade word on its own is not a SKU. "Ash Brown" does not become NYX-BROW-ASH.
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

// The named product wins when it identifies one SKU. On-screen text in the same
// moment can name a second product, and that must not discard the one being shown.
export async function matchObservationProduct({ productName, productLine, onScreenText, spokenMention }) {
  const name = String(productName ?? "");
  if (name.trim()) {
    const named = await resolveProduct(name);
    if (named.status === "candidate") return named;
  }
  return resolveProduct([productName, productLine, onScreenText, spokenMention].filter(Boolean).join(" "));
}
