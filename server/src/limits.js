// Direct local upload is the method this demo will call.
// Its video cap is 200 MB. Marengo 3.0 allows 4 GB and Pegasus 1.6 allows 10 GB,
// so the upload method is the tighter file-size rule.
// https://docs.twelvelabs.io/v1.3/docs/concepts/upload-methods
// Retrieved 2026-10-21.
export const DIRECT_LOCAL_VIDEO_MAX_BYTES = 200 * 1024 * 1024;

// A file has to satisfy both models, because one asset is indexed and segmented.
// Marengo 3.0 duration is 4 seconds to 4 hours.
// https://docs.twelvelabs.io/v1.3/docs/concepts/models/marengo/marengo-3-0
// Pegasus 1.6 full-video analysis is up to 2 hours, and at least 1 second.
// https://docs.twelvelabs.io/v1.3/docs/concepts/models/pegasus/pegasus-1-6
// Retrieved 2026-10-21. Intersection: 4 seconds to 2 hours.
export const MIN_DURATION_SECONDS = 4;
export const MAX_DURATION_SECONDS = 2 * 60 * 60;

// Both model pages state the same frame bounds: 360x360 through 5184x2160,
// and an aspect ratio no wider than 2.4:1 either way.
export const MIN_EDGE = 360;
export const MAX_WIDTH = 5184;
export const MAX_HEIGHT = 2160;
export const MAX_ASPECT = 2.4;

export const VALIDATION_PROFILE = "direct_local_upload";

const NOT_VIDEO = new Set([
  ".txt",
  ".pdf",
  ".json",
  ".md",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".csv",
]);

export function extensionProblem(ext) {
  if (!NOT_VIDEO.has(ext)) return null;
  return {
    code: "not_video",
    message: `${ext} is not a video file for direct upload.`,
  };
}

export function evaluateMedia(file) {
  const problems = [];
  const rejected = extensionProblem(file.ext);
  if (rejected) {
    problems.push(rejected);
    return problems;
  }

  if (!file.video) {
    problems.push({
      code: "not_video",
      message: "No video stream was found.",
    });
    return problems;
  }

  if (file.bytes > DIRECT_LOCAL_VIDEO_MAX_BYTES) {
    problems.push({
      code: "file_too_large",
      message: `File is ${file.bytes} bytes. Direct local upload allows up to ${DIRECT_LOCAL_VIDEO_MAX_BYTES} bytes (200 MB). Multipart upload is not part of this demo.`,
    });
  }

  if (file.durationSeconds == null) {
    problems.push({
      code: "duration_unreadable",
      message: "Duration could not be read, so the file was not accepted.",
    });
  } else if (file.durationSeconds < MIN_DURATION_SECONDS || file.durationSeconds > MAX_DURATION_SECONDS) {
    problems.push({
      code: "duration_out_of_range",
      message: `Duration is ${file.durationSeconds}s. This demo accepts ${MIN_DURATION_SECONDS}s to ${MAX_DURATION_SECONDS}s so the same file can be indexed with Marengo 3.0 and segmented with Pegasus 1.6.`,
    });
  }

  if (file.width == null || file.height == null) {
    problems.push({
      code: "resolution_unreadable",
      message: "Resolution could not be read, so the file was not accepted.",
    });
  } else {
    const shortEdge = Math.min(file.width, file.height);
    const longEdge = Math.max(file.width, file.height);
    if (file.width < MIN_EDGE || file.height < MIN_EDGE || file.width > MAX_WIDTH || file.height > MAX_HEIGHT) {
      problems.push({
        code: "resolution_out_of_range",
        message: `Resolution is ${file.width}x${file.height}. Allowed range is ${MIN_EDGE}x${MIN_EDGE} to ${MAX_WIDTH}x${MAX_HEIGHT}.`,
      });
    } else if (longEdge / shortEdge > MAX_ASPECT + 0.001) {
      problems.push({
        code: "aspect_out_of_range",
        message: `Aspect ratio is wider than ${MAX_ASPECT}:1.`,
      });
    }
  }

  return problems;
}
