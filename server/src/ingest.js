import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  DIRECT_LOCAL_VIDEO_MAX_BYTES,
  evaluateMedia,
  extensionProblem,
  MAX_DURATION_SECONDS,
  MIN_DURATION_SECONDS,
  VALIDATION_PROFILE,
} from "./limits.js";
import { dataDir, findJobIdByHash, newAssetId, readJob, saveNewJob } from "./store.js";

const execFileAsync = promisify(execFile);

export class IngestError extends Error {
  constructor(code, message, details = []) {
    super(message);
    this.name = "IngestError";
    this.code = code;
    this.details = details;
  }
}

// ffprobe is how we read duration and frame size before any provider call.
// https://docs.twelvelabs.io/v1.3/docs/concepts/models/marengo/marengo-3-0
// https://docs.twelvelabs.io/v1.3/docs/concepts/models/pegasus/pegasus-1-6
export async function probeWithFfprobe(filePath) {
  let stdout;
  try {
    const result = await execFileAsync(
      process.env.FFPROBE_PATH || "ffprobe",
      ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", filePath],
      { timeout: 20_000, maxBuffer: 2 * 1024 * 1024 },
    );
    stdout = result.stdout;
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new IngestError("ffprobe_missing", "ffprobe is required to check duration and resolution. Install ffmpeg and retry.");
    }
    throw new IngestError("probe_failed", "ffprobe could not read this file.");
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new IngestError("probe_failed", "ffprobe returned data this demo could not parse.");
  }

  const video = (parsed.streams ?? []).find((stream) => stream.codec_type === "video" && stream.width && stream.height);
  const duration = Number(parsed.format?.duration);
  if (!video) return { video: false, width: null, height: null, durationSeconds: null };
  return {
    video: true,
    width: Number(video.width),
    height: Number(video.height),
    durationSeconds: Number.isFinite(duration) ? duration : null,
  };
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function safeFileName(filePath) {
  const base = path.basename(filePath).replace(/[^A-Za-z0-9._-]+/g, "_");
  return base && base !== "." && base !== ".." ? base : "video";
}

export async function ingestLocalFile(filePath, options = {}) {
  const probe = options.probe ?? probeWithFfprobe;
  const resolved = path.resolve(filePath);

  let info;
  try {
    info = await stat(resolved);
  } catch (error) {
    if (error.code === "ENOENT") throw new IngestError("missing_file", "File not found.");
    throw error;
  }
  if (!info.isFile()) throw new IngestError("not_a_file", "Path is not a file.");

  const ext = path.extname(resolved).toLowerCase();
  const rejectedExt = extensionProblem(ext);
  if (rejectedExt) throw new IngestError("invalid_media", rejectedExt.message, [rejectedExt]);

  const probed = await probe(resolved);
  const media = {
    ext,
    bytes: info.size,
    video: probed.video,
    width: probed.width ?? null,
    height: probed.height ?? null,
    durationSeconds: probed.durationSeconds ?? null,
  };
  const problems = evaluateMedia(media);
  if (problems.length) {
    throw new IngestError("invalid_media", problems.map((problem) => problem.message).join(" "), problems);
  }

  const contentHash = await sha256File(resolved);
  const priorId = await findJobIdByHash(contentHash);
  if (priorId) {
    const prior = await readJob(priorId);
    if (prior) return { job: prior, duplicate: true };
  }

  const id = newAssetId();
  const relativeMedia = path.join("uploads", id, safeFileName(resolved));
  const absoluteMedia = path.join(dataDir(), relativeMedia);
  await mkdir(path.dirname(absoluteMedia), { recursive: true });
  await copyFile(resolved, absoluteMedia);

  const now = new Date().toISOString();
  const job = {
    id,
    stage: "stored",
    duplicate: false,
    contentHash,
    sourceFileName: path.basename(resolved),
    mediaPath: relativeMedia.split(path.sep).join("/"),
    bytes: info.size,
    durationSeconds: media.durationSeconds,
    width: media.width,
    height: media.height,
    campaign: options.campaign ?? null,
    channel: options.channel ?? null,
    createdAt: now,
    updatedAt: now,
    validation: {
      profile: VALIDATION_PROFILE,
      maxBytes: DIRECT_LOCAL_VIDEO_MAX_BYTES,
      minDurationSeconds: MIN_DURATION_SECONDS,
      maxDurationSeconds: MAX_DURATION_SECONDS,
    },
    providers: {
      twelvelabs: {
        assetId: null,
        indexId: null,
        indexedAssetId: null,
        hlsStatus: null,
      },
    },
    enrichment: null,
    usage: {
      providerCalls: 0,
      stagesExecuted: ["validate", "store"],
    },
    error: null,
  };

  const saved = await saveNewJob(job);
  return saved;
}

export async function showJob(id) {
  const job = await readJob(id);
  if (!job) throw new IngestError("missing_job", "No job with that id.");
  return job;
}
