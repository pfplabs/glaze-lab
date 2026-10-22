import { matchObservationProduct } from "./catalog.js";

// One Pegasus 1.6 time_based_metadata request. The catalog is applied later, in this file.
// https://docs.twelvelabs.io/v1.3/docs/get-started/quickstart/segment-videos
export const ENRICHMENT_SCHEMA = "glaze-observe-1";
export const SEGMENT_MODEL = "pegasus1.6";

const FORMAT_VALUES = ["tutorial", "demo", "ad", "before_after", "other"];
const SHOT_VALUES = ["close-up", "packshot", "wide", "other"];
const ACTION_VALUES = ["shown", "applied", "other"];
const LIGHTING_VALUES = ["natural", "studio", "unknown"];

export const SEGMENT_DEFINITIONS = [
  {
    id: "format",
    description: "The form of the whole video: a tutorial, a product demo, an advertisement, a before-and-after, or another kind of piece.",
    fields: [
      {
        name: "format",
        type: "string",
        description: "What kind of piece this is.",
        enum: FORMAT_VALUES,
      },
    ],
  },
  {
    id: "observation",
    description: "An interval where a beauty product is visible or mentioned. Record only what is seen or heard. Do not invent a product code.",
    fields: [
      { name: "product_name", type: "string", description: "Product name as shown or spoken. Empty when none is identifiable." },
      { name: "product_line", type: "string", description: "Product line as shown or spoken. Empty when the line is not identifiable." },
      { name: "shot", type: "string", description: "How the product is framed.", enum: SHOT_VALUES },
      { name: "action", type: "string", description: "Whether the product is only shown or is being applied.", enum: ACTION_VALUES },
      { name: "setting", type: "string", description: "Where the moment happens, in a few words. Empty when unclear." },
      { name: "lighting", type: "string", description: "The light in this moment.", enum: LIGHTING_VALUES },
      { name: "on_screen_text", type: "string", description: "Text read from the screen in this moment. Empty when there is none." },
      { name: "spoken_mention", type: "string", description: "What is said about the product in this moment. Empty when nobody names it." },
      { name: "skin_tone", type: "string", description: "Skin tone only when a person is visible. Empty when no person is visible." },
    ],
  },
];

export class EnrichmentError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "EnrichmentError";
    this.code = code;
  }
}

export async function normalizeEnrichment(raw, context) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new EnrichmentError("schema_invalid", "Segmentation result is not JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new EnrichmentError("schema_invalid", "Segmentation result is not an object.");
  }
  if (!Array.isArray(parsed.format) || !Array.isArray(parsed.observation)) {
    throw new EnrichmentError("schema_invalid", "Segmentation result is missing format or observation.");
  }

  const formatSegments = parsed.format.map((segment, index) => readFormat(segment, index));
  const observations = [];
  for (let index = 0; index < parsed.observation.length; index += 1) {
    observations.push(await readObservation(parsed.observation[index], index, context));
  }

  return {
    schema: ENRICHMENT_SCHEMA,
    modelName: SEGMENT_MODEL,
    analysisMode: "time_based_metadata",
    format: chooseFormat(formatSegments, context),
    observations,
  };
}

function chooseFormat(segments, context) {
  if (!segments.length) return null;
  const best = segments.reduce((chosen, segment) => (
    segment.endTime - segment.startTime > chosen.endTime - chosen.startTime ? segment : chosen
  ));
  return {
    value: best.value,
    startTime: best.startTime,
    endTime: best.endTime,
    chosenBy: segments.length > 1 ? "longest_segment" : "only_segment",
    provenance: provenance("format", best, context),
  };
}

function readFormat(segment, index) {
  const time = readTime(segment, "format", index);
  return { ...time, value: enumValue(segment.metadata.format, FORMAT_VALUES, `format[${index}].format`) };
}

async function readObservation(segment, index, context) {
  const time = readTime(segment, "observation", index);
  const metadata = segment.metadata;
  const productName = textValue(metadata.product_name, `observation[${index}].product_name`);
  const productLine = textValue(metadata.product_line, `observation[${index}].product_line`);
  const onScreenText = textValue(metadata.on_screen_text, `observation[${index}].on_screen_text`);
  const spokenMention = textValue(metadata.spoken_mention, `observation[${index}].spoken_mention`);
  const product = await matchObservationProduct({ productName, productLine, onScreenText, spokenMention });
  return {
    startTime: time.startTime,
    endTime: time.endTime,
    shot: enumValue(metadata.shot, SHOT_VALUES, `observation[${index}].shot`),
    action: enumValue(metadata.action, ACTION_VALUES, `observation[${index}].action`),
    setting: textValue(metadata.setting, `observation[${index}].setting`),
    lighting: enumValue(metadata.lighting, LIGHTING_VALUES, `observation[${index}].lighting`),
    productName,
    productLine,
    onScreenText,
    spokenMention,
    skinTone: textValue(metadata.skin_tone, `observation[${index}].skin_tone`),
    product,
    provenance: provenance("observation", time, context),
  };
}

function readTime(segment, definitionId, index) {
  const metadata = segment?.metadata;
  const startTime = segment?.start_time;
  const endTime = segment?.end_time;
  if (typeof startTime !== "number" || typeof endTime !== "number" || !(endTime > startTime) || !metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new EnrichmentError("schema_invalid", `${definitionId}[${index}] is missing a time range or metadata.`);
  }
  return { startTime, endTime };
}

function enumValue(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new EnrichmentError("schema_invalid", `${label} is not one of the expected values.`);
  }
  return value;
}

function textValue(value, label) {
  if (typeof value !== "string") {
    throw new EnrichmentError("schema_invalid", `${label} is not text.`);
  }
  return value;
}

function provenance(definitionId, time, context) {
  return {
    assetId: context.assetId,
    taskId: context.taskId,
    modelName: SEGMENT_MODEL,
    analysisMode: "time_based_metadata",
    schema: ENRICHMENT_SCHEMA,
    definitionId,
    startTime: time.startTime,
    endTime: time.endTime,
    textSource: "model",
  };
}
