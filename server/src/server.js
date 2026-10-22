import { loadEnv } from "./env.js";
import { createApiServer } from "./http.js";
import { liveClient } from "./twelvelabs.js";

loadEnv();

const port = Number(process.env.PORT) || 8787;
const server = createApiServer({ client: liveClient() });

server.listen(port, "127.0.0.1", () => {
  console.log(`API http://127.0.0.1:${port}`);
});
