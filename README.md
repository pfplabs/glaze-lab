# Glaze

Proof of concept for moment search over Glaze marketing video. The screens are the Lovable UI. Search on those screens still uses the six fixture videos in `src/lib/library.ts`. Ingest, so far, is a local command that checks a file and writes a job. It does not call TwelveLabs.

## Prerequisites

- Node.js 22 or newer. Checked on Node v26.9.0.
- Bun 1.4.3 for the UI (`bun.lock`).
- `ffprobe` (from ffmpeg) before a real video ingest. The tests inject a probe and do not need it.

## UI

In one terminal:

```sh
node server/src/server.js
```

In another:

```sh
bun install
bun run dev
```

Open the URL Vite prints. The top bar lists the indexes on the account, plus `sample_social_media`, which is selected by default. Add files stays off for that index and for any other index this app did not create. Creating an index from the bar calls TwelveLabs, records the id locally, and is the only way a video can be uploaded. Search still uses the six fixture videos. Enrichment does not run yet. The player is still a timer on a colored frame.

## Local ingest

From the repo root:

```sh
node server/cli/ingest.js path/to/video.mp4 --campaign "Second Skin SS26"
node server/cli/ingest.js --show <jobId>
```

The command copies the file under `data/uploads/` and writes `data/jobs/<jobId>.json`. `data/` is gitignored. A second run of the same bytes prints `"duplicate": true` and does not create another job. Nothing is uploaded.

`ingest-assets/` holds sample videos for a newly created index. Point the ingest command at them to simulate a drop without a production file:

```sh
node server/cli/ingest.js ingest-assets/ingest-sample-1.mp4 --campaign "Second Skin SS26"
node server/cli/ingest.js ingest-assets/ingest-sample-2.mp4 --campaign "Second Skin SS26"
node server/cli/ingest.js ingest-assets/ingest-sample-3.mp4 --campaign "Second Skin SS26"
node server/cli/ingest.js ingest-assets/false-asset.mp4 --campaign "Second Skin SS26"
```

```sh
node --test server/test/ingest.test.js
```

## Configuration

Copy `.env.example` to `.env` when a live TwelveLabs run is approved. The key stays on the server. There is no `VITE_` variable for it.

## Not in this pass

TwelveLabs upload, indexing, segmentation, and wiring search to the API wait until a permitted video and a usage budget are confirmed.
