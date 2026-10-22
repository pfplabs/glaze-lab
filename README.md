# Glaze

Proof of concept for moment search over Glaze marketing video. The screens are the Lovable UI. Search on those screens still uses the six fixture videos in `src/lib/library.ts`. Ingest, so far, is a local command that checks a file and writes a job. It does not call TwelveLabs.

## Prerequisites

- Node.js 22 or newer. Checked on Node v26.9.0.
- Bun 1.4.3 for the UI (`bun.lock`).
- `ffprobe` (from ffmpeg) before a real video ingest. The tests inject a probe and do not need it.

## UI

```sh
bun install
bun run dev
```

Open the URL Vite prints. Try an example query, open a moment, and use the player. That player is still a timer on a colored frame.

## Local ingest

From the repo root:

```sh
node server/cli/ingest.js path/to/video.mp4 --campaign "Second Skin SS26"
node server/cli/ingest.js --show <jobId>
```

The command copies the file under `data/uploads/` and writes `data/jobs/<jobId>.json`. `data/` is gitignored. A second run of the same bytes prints `"duplicate": true` and does not create another job. Nothing is uploaded.

```sh
node --test server/test/ingest.test.js
```

## Configuration

Copy `.env.example` to `.env` when a live TwelveLabs run is approved. The key stays on the server. There is no `VITE_` variable for it.

## Not in this pass

TwelveLabs upload, indexing, segmentation, and wiring search to the API wait until a permitted video and a usage budget are confirmed.
