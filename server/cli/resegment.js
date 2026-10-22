import { ENRICHMENT_SCHEMA } from "../src/enrich.js";
import { loadEnv } from "../src/env.js";
import { resegmentJob } from "../src/publish.js";
import { listJobs } from "../src/store.js";
import { liveClient } from "../src/twelvelabs.js";

loadEnv();

const client = liveClient();
if (!client) {
  console.error("Set TWELVELABS_API_KEY before segmenting again.");
  process.exit(1);
}

const jobs = (await listJobs()).filter((job) => {
  const assetId = job.providers?.twelvelabs?.assetId;
  return job.stage === "indexed" && assetId && job.enrichment?.schema !== ENRICHMENT_SCHEMA;
});

if (!jobs.length) {
  console.log(`No indexed videos are waiting for ${ENRICHMENT_SCHEMA}.`);
  process.exit(0);
}

console.log(`Segmenting ${jobs.length} videos again with ${ENRICHMENT_SCHEMA}.`);

for (const job of jobs) {
  console.log(`start ${job.sourceFileName} ${job.id}`);
  try {
    const saved = await resegmentJob(job.id, client, { timeoutMs: 20 * 60 * 1000 });
    const ready = saved.enrichment?.status === "ready" && saved.enrichment?.schema === ENRICHMENT_SCHEMA;
    const scores = (saved.enrichment?.observations ?? []).map((item) => item.modelConfidence);
    console.log(JSON.stringify({
      file: job.sourceFileName,
      ready,
      schema: saved.enrichment?.schema ?? null,
      observations: saved.enrichment?.observations?.length ?? 0,
      confidence: scores.slice(0, 3),
      rejected: saved.enrichment?.rejected ?? null,
    }));
  } catch (error) {
    console.log(JSON.stringify({
      file: job.sourceFileName,
      ready: false,
      error: error.code || "resegment_failed",
    }));
  }
}
