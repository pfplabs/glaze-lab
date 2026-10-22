import { loadEnv } from "./env.js";
import { createApiServer } from "./http.js";
import { resumeOpenEnrichment } from "./publish.js";
import { liveClient } from "./twelvelabs.js";

loadEnv();

const port = Number(process.env.PORT) || 8787;
const client = liveClient();
const server = createApiServer({ client });

server.listen(port, "127.0.0.1", () => {
  console.log(`API http://127.0.0.1:${port}`);
  resumeOpenEnrichment(client).catch((error) => {
    console.error(error?.code || "enrichment_resume_failed");
  });
});
