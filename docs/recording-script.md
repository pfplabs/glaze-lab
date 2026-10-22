# 🎙️ Recording script

About three minutes. Read the paragraphs. Skip the bracketed lines. The stills in [the README](../README.md) match this order if you need B-roll.

Have the API and the UI running, with an index this app created and at least one enriched video. The Gloss Bomb pass below is what `teachingbeauty720p.mp4` returns on `lab-sample-v2`. If your file is one of the short samples, use a sentence you know is in that video and keep the same beats.

## 🏠 Home

[Show the home page. Leave Collections and Taxonomy alone.]

This is Glaze. It searches marketing video for a moment, not for a filename.

The index behind it is TwelveLabs. Marengo makes the picture and the audio searchable. After that, Pegasus writes what is actually on screen: the kind of shot, whether a product is shown or being applied, and the words you can read or hear. We then match that wording to a product in our catalog.

The search box takes a sentence. These four examples are the ones we keep on the counter.

[Click the first example, or type “Fenty Beauty Gloss Bomb” and search.]

## 🔎 Results

[Show the moments list.]

These rows are moments. Each one is a time range inside a video. Rank is TwelveLabs’ order for this query. It is an ordering, not a confidence score.

The chips are ours. Fenty Gloss is a catalog candidate because the enrichment saw that name on screen and heard it spoken. The same row keeps the product line next to the SKU, the format, the close-up, whether it is shown or applied, the setting, and the studio light. The number beside the rank is the 0-to-1 confidence Pegasus returned for that observation. Rank stays the search order. The catalog chip says whether the name matched one SKU. The line under the chips names Pegasus.

[Hover the first thumbnail until it plays. Hold it through a second or two.]

Hover the thumbnail and you get that span, not the opening frame of the file. It plays muted, and it loops until you move away.

## ▶️ The moment

[Click the row. Wait until the player is sitting on the start time.]

Open it, and the player seeks to that moment. The picture is the HLS stream TwelveLabs stores when we index the file with streaming turned on. The list on the right is every observation Pegasus wrote for the whole video, and the one under the player is the observation you are in right now.

## 📥 Ingest

[Open Ingestion.]

A video gets here only if the index was created in this app. That is the name in the top bar. Create is what turns uploads on. Then you add a file, with a campaign name if you have one.

The queue has two finishes. Indexed means Marengo is done and search can run. Enrichment means Pegasus has written the segments. We do not upload the same bytes twice.

## 🎬 Close

[Back on the results, or the home page.]

Two things on the side are not in this demo: Collections and Taxonomy. There is no login. And a filter for format or SKU is applied here, after the search comes back, so an empty page is not proof the moment is missing from the index.

That is the loop. A sentence in, a moment out, and the frame that shows it.
