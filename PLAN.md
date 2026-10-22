# Plan

This was the scope before the live TwelveLabs run. The [README](README.md) describes the demo as it works now.

Approved 2026-10-21. Bedrock is out of this pass. No TwelveLabs call until a video and a budget are confirmed.

## Decisions

- One local video, supplied later. The Playground index is checked only when asked.
- The confidence slider is not a probability. Wire-up will show candidate, confirmed, unresolved, or rejected. Search rank stays a rank.
- Ingest "Add files" will upload. "Mark ingested" goes away when that screen is wired.
- Home page keeps 10,003 SKUs as the fictional catalog size. Video and moment totals become the live demo count when search is wired.
- UI stays on Bun. Backend is Node ESM in `server/`, with no TwelveLabs dependency until the live run.
- One new Marengo index is created on the first paid run.
- Playback will be the local file with range requests. An HLS URL is stored and used only if that file is missing.

## Milestones

1. UI unpacked and running on its fixtures. Done in this checkout.
2. Local validate, hash, and job file. No provider call. Done in this checkout.
3. One real upload and index. Waiting on a video and a budget.
4. One Pegasus segmentation and a catalog match.
5. Search and playback connected to the existing screens.
6. Failure tests, and the four customer queries reported against the real corpus.
