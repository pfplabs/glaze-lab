// Fills the named catalog out to 10,000 SKUs.
// Matching is a substring check, so every generated line, alias, and id has to
// stay out of the named product text. Ids are fixed width so one SKU cannot
// contain another.

export const CATALOG_SIZE = 10000;

export const CATEGORY_QUOTAS = [
  ["makeup", 4800],
  ["skincare", 3200],
  ["haircare", 2000],
];

const BRANDS = [
  ["Lumen", "LMN"],
  ["Marrow", "MRW"],
  ["Halcyon", "HLC"],
  ["Vesper", "VSP"],
  ["Kindred", "KND"],
  ["Northwind", "NWD"],
  ["Sable", "SBL"],
  ["Pollen", "PLN"],
  ["Keepsake", "KPS"],
  ["Bramble", "BRB"],
  ["Fieldnote", "FLD"],
  ["Copperline", "CPR"],
  ["Juniper", "JNP"],
  ["Solace", "SLC"],
  ["Wisp", "WSP"],
  ["Orchard", "ORC"],
  ["Lark", "LRK"],
  ["Haven", "HVN"],
  ["Mote", "MTE"],
  ["Quill", "QLL"],
];

const FORMS = {
  makeup: [
    ["Cheek Tint", "CT"],
    ["Lip Lacquer", "LL"],
    ["Eye Pigment", "EP"],
    ["Lash Coat", "LC"],
    ["Complexion Balm", "CB"],
    ["Color Wash", "CW"],
    ["Highlight Stick", "HS"],
    ["Lip Oil", "LO"],
    ["Face Mist", "FM"],
    ["Color Pencil", "CP"],
  ],
  skincare: [
    ["Barrier Lotion", "BL"],
    ["Night Oil", "NO"],
    ["Water Gel", "WG"],
    ["Clay Rinse", "CR"],
    ["Peptide Drops", "PD"],
    ["Moisture Milk", "MM"],
    ["Enzyme Polish", "EZ"],
    ["Calming Toner", "TN"],
  ],
  haircare: [
    ["Strand Oil", "SO"],
    ["Scalp Tonic", "ST"],
    ["Wave Balm", "WB"],
    ["Shine Drops", "SD"],
    ["Leave-in Milk", "LK"],
  ],
};

const SHADES = [
  "Rose",
  "Coral",
  "Honey",
  "Plum",
  "Sand",
  "Terra",
  "Wine",
  "Peach",
  "Berry",
  "Cocoa",
  "Amber",
  "Brick",
  "Mauve",
  "Fig",
  "Melon",
  "Ruby",
  "Taupe",
  "Moss",
  "Slate",
  "Ivory",
  "Pearl",
  "Flint",
  "Ochre",
  "Sienna",
];

// Observations the named-product tests already use. A generated phrase that
// sits inside one of these would change a real match.
const PROTECTED_OBSERVATIONS = [
  "creator holds the timeless smoothing primer",
  "a veil compact is on the counter",
  "ash brown on a light skin tone",
  "timeless smoothing primer",
  "tarte cosmetics timeless smoothing primer",
  "micro brow pencil",
  "nyx brow power powder | micro brow pencil in ash brown",
  "nyx micro brow pencil in ash brown",
  "crimson",
];

function assertNoTokenInside(needles, haystacks, label) {
  for (const needle of needles) {
    const lower = needle.toLowerCase();
    for (const hay of haystacks) {
      if (hay === needle) continue;
      if (hay.toLowerCase().includes(lower)) {
        throw new Error(`${label}: "${needle}" is inside "${hay}"`);
      }
    }
  }
}

function assertPhrasesStayOut(phrases, corpus, label) {
  for (const phrase of phrases) {
    const lower = phrase.toLowerCase();
    if (corpus.includes(lower)) {
      throw new Error(`${label} "${phrase}" collides with a named product`);
    }
  }
}

function assertLinesDoNotNest(lines) {
  const sorted = [...lines].sort((a, b) => a.length - b.length);
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      if (sorted[j].includes(sorted[i])) {
        throw new Error(`line "${sorted[i]}" is inside "${sorted[j]}"`);
      }
    }
  }
}

function protectedCorpus(realProducts) {
  const bits = [...PROTECTED_OBSERVATIONS];
  for (const product of realProducts) {
    bits.push(product.id, product.brand, product.line, product.name, product.shade, ...(product.aliases ?? []));
  }
  return bits.filter(Boolean).join("\n").toLowerCase();
}

export function syntheticProducts(realProducts) {
  const brands = BRANDS.map(([name]) => name);
  const forms = Object.values(FORMS).flat().map(([name]) => name);
  assertNoTokenInside(brands, brands, "brand");
  assertNoTokenInside(forms, forms, "form");
  assertNoTokenInside(SHADES, SHADES, "shade");
  assertNoTokenInside(SHADES, [...brands, ...forms], "shade");
  assertNoTokenInside(brands, forms, "brand");

  const named = new Map();
  for (const product of realProducts) {
    const category = String(product.category ?? "");
    named.set(category, (named.get(category) ?? 0) + 1);
  }

  const products = [];
  let serial = 1;
  for (const [category, quota] of CATEGORY_QUOTAS) {
    const have = named.get(category) ?? 0;
    const need = quota - have;
    if (need < 0) throw new Error(`${category} already has ${have} named SKUs, above the ${quota} quota`);
    const formsForCategory = FORMS[category];
    const span = BRANDS.length * formsForCategory.length;
    if (need > span * SHADES.length) throw new Error(`not enough ${category} combinations for ${need} SKUs`);
    for (let n = 0; n < need; n += 1) {
      const [brand, brandCode] = BRANDS[n % BRANDS.length];
      const [form, formCode] = formsForCategory[Math.floor(n / BRANDS.length) % formsForCategory.length];
      const shade = SHADES[Math.floor(n / span) % SHADES.length];
      const id = `${brandCode}-${formCode}-${String(serial).padStart(5, "0")}`;
      serial += 1;
      const line = `${brand} ${form}`;
      products.push({
        id,
        brand,
        line,
        name: form,
        shade,
        category,
        aliases: [`${line} ${shade}`.toLowerCase()],
        synthetic: true,
      });
    }
    named.delete(category);
  }
  if (named.size > 0) {
    throw new Error(`named products use categories outside the quota: ${[...named.keys()].join(", ")}`);
  }

  const corpus = protectedCorpus(realProducts);
  const lines = new Set(products.map((product) => product.line.toLowerCase()));
  assertLinesDoNotNest(lines);
  assertPhrasesStayOut(lines, corpus, "line");
  assertPhrasesStayOut(products.map((product) => product.id), corpus, "id");
  assertPhrasesStayOut(products.flatMap((product) => product.aliases), corpus, "alias");
  return products;
}
