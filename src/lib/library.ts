export type Moment = {
  start: number;
  end: number;
  label: string;
  attributes: string[];
  skus: string[];
  confidence: number;
  provenance: ("visual" | "speech" | "ocr")[];
  transcript?: string;
  ocr?: string;
};

export type Video = {
  id: string;
  title: string;
  format: "Tutorial" | "Demo" | "Ad" | "Before/After" | "Creator";
  campaign: string;
  channel: string;
  duration: number;
  hue: number;
  moments: Moment[];
};

export const VIDEOS: Video[] = [
  {
    id: "v1", title: "Bold Red Lip in 5 Minutes", format: "Tutorial", campaign: "Velvet Matte FW26", channel: "YouTube", duration: 312, hue: 15,
    moments: [
      { start: 12, end: 34, label: "Creator introduces Velvet Matte Lipstick in Crimson", attributes: ["packshot", "close-up", "red lipstick"], skus: ["VM-LIP-112"], confidence: 0.94, provenance: ["visual", "speech"], transcript: "Today I'm using the Velvet Matte in Crimson…" },
      { start: 88, end: 141, label: "Lipstick applied to lips, medium skin tone, close-up", attributes: ["application", "close-up", "red lipstick", "medium skin tone", "natural lighting"], skus: ["VM-LIP-112"], confidence: 0.91, provenance: ["visual"] },
      { start: 260, end: 290, label: "Final look reveal with on-screen product name", attributes: ["before/after", "red lipstick"], skus: ["VM-LIP-112"], confidence: 0.88, provenance: ["visual", "ocr"], ocr: "VELVET MATTE · CRIMSON 112" },
    ],
  },
  {
    id: "v2", title: "Skin-First Foundation Routine", format: "Tutorial", campaign: "Second Skin SS26", channel: "TikTok", duration: 184, hue: 35,
    moments: [
      { start: 5, end: 22, label: "Moisturizer prep under window light", attributes: ["application", "natural lighting", "bathroom setting"], skus: ["HY-SKN-020"], confidence: 0.86, provenance: ["visual", "speech"] },
      { start: 40, end: 96, label: "Close-up of foundation application with brush, natural lighting", attributes: ["application", "close-up", "foundation", "natural lighting", "medium skin tone"], skus: ["SS-FDN-340"], confidence: 0.95, provenance: ["visual", "speech"], transcript: "Blend it out from the center of the face…" },
      { start: 150, end: 178, label: "Shade card shown on screen", attributes: ["packshot", "foundation"], skus: ["SS-FDN-340"], confidence: 0.82, provenance: ["ocr"], ocr: "SECOND SKIN · 340 WARM" },
    ],
  },
  {
    id: "v3", title: "Second Skin — :30 Hero Spot", format: "Ad", campaign: "Second Skin SS26", channel: "TV / CTV", duration: 30, hue: 28,
    moments: [
      { start: 0, end: 8, label: "Studio packshot of foundation bottle", attributes: ["packshot", "studio setting", "foundation"], skus: ["SS-FDN-340", "SS-FDN-210"], confidence: 0.97, provenance: ["visual", "ocr"], ocr: "SECOND SKIN" },
      { start: 9, end: 21, label: "Model dabs foundation onto cheek, deep skin tone", attributes: ["application", "close-up", "foundation", "deep skin tone", "studio lighting"], skus: ["SS-FDN-510"], confidence: 0.9, provenance: ["visual"] },
    ],
  },
  {
    id: "v4", title: "Creator Collab: Night-Out Glam", format: "Creator", campaign: "Velvet Matte FW26", channel: "Instagram", duration: 412, hue: 345,
    moments: [
      { start: 30, end: 61, label: "Product haul — lipstick shown alongside palette", attributes: ["packshot", "red lipstick", "bedroom setting"], skus: ["VM-LIP-112", "GL-EYE-007"], confidence: 0.78, provenance: ["visual", "speech"] },
      { start: 205, end: 248, label: "Red lipstick applied with lip brush, light skin tone", attributes: ["application", "close-up", "red lipstick", "light skin tone", "warm lighting"], skus: ["VM-LIP-112"], confidence: 0.89, provenance: ["visual"] },
    ],
  },
  {
    id: "v5", title: "Bond Repair Mask — 7 Day Results", format: "Before/After", campaign: "Bond Repair 2026", channel: "E-commerce PDP", duration: 96, hue: 200,
    moments: [
      { start: 3, end: 18, label: "Damaged hair, before state", attributes: ["before/after", "close-up", "haircare"], skus: [], confidence: 0.84, provenance: ["visual", "ocr"], ocr: "DAY 1" },
      { start: 30, end: 62, label: "Hair mask applied in shower", attributes: ["application", "haircare", "bathroom setting"], skus: ["BR-HAIR-001"], confidence: 0.92, provenance: ["visual", "speech"] },
      { start: 70, end: 94, label: "Glossy after result with product shown", attributes: ["before/after", "packshot", "haircare"], skus: ["BR-HAIR-001"], confidence: 0.9, provenance: ["visual", "ocr"], ocr: "DAY 7" },
    ],
  },
  {
    id: "v6", title: "Hydra Serum Texture Demo", format: "Demo", campaign: "Hydra Glow", channel: "Retail screens", duration: 45, hue: 170,
    moments: [
      { start: 2, end: 15, label: "Macro dropper shot of serum texture", attributes: ["close-up", "packshot", "skincare", "studio lighting"], skus: ["HY-SKN-020"], confidence: 0.96, provenance: ["visual"] },
      { start: 16, end: 38, label: "Serum pressed into skin, natural lighting", attributes: ["application", "skincare", "natural lighting", "medium skin tone"], skus: ["HY-SKN-020"], confidence: 0.87, provenance: ["visual", "speech"] },
    ],
  },
];

export const FORMATS = ["Tutorial", "Demo", "Ad", "Before/After", "Creator"] as const;
export const ATTRS = ["application", "close-up", "packshot", "natural lighting", "studio lighting"];
export const SKUS = Array.from(new Set(VIDEOS.flatMap((v) => v.moments.flatMap((m) => m.skus)))).sort();
export const CAMPAIGNS = Array.from(new Set(VIDEOS.map((v) => v.campaign)));

export const EXAMPLES = [
  "tutorials featuring a red lipstick for medium skin tone",
  "close-ups of foundation application with natural lighting",
  "videos featuring IT-CC-FAIR across campaigns",
  "moments where a product is being applied, not just shown",
];

const STOP = new Set("a an the of for with in on me show find where is being just not videos video moments moment featuring across campaigns".split(" "));

export type Hit = { video: Video; moment: Moment; score: number; matched: string[] };

export function search(q: string, f: { formats: string[]; attrs: string[]; skus: string[]; campaigns: string[]; minConf: number }): Hit[] {
  const lower = q.toLowerCase();
  const terms = lower.split(/[^a-z0-9-]+/).filter((t) => t && !STOP.has(t));
  const wantApply = /appl/.test(lower);
  const hits: Hit[] = [];
  for (const v of VIDEOS) {
    if (f.formats.length && !f.formats.includes(v.format)) continue;
    if (f.campaigns.length && !f.campaigns.includes(v.campaign)) continue;
    if (!lower.includes("tutorial") ? false : v.format !== "Tutorial") continue;
    for (const m of v.moments) {
      if (m.confidence < f.minConf) continue;
      if (f.attrs.length && !f.attrs.every((a) => m.attributes.includes(a))) continue;
      if (f.skus.length && !f.skus.some((s) => m.skus.includes(s))) continue;
      if (wantApply && !m.attributes.includes("application")) continue;
      const hay = [m.label, ...m.attributes, ...m.skus, m.transcript ?? "", m.ocr ?? "", v.title, v.format].join(" ").toLowerCase();
      const matched = terms.filter((t) => hay.includes(t.replace(/s$/, "")));
      if (terms.length && matched.length === 0) continue;
      const score = (terms.length ? matched.length / terms.length : 1) * 0.6 + m.confidence * 0.4;
      hits.push({ video: v, moment: m, score, matched });
    }
  }
  return hits.sort((a, b) => b.score - a.score);
}

export const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
