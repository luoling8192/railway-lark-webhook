import { loadConfig } from "./config.js";
import { createWebhookServer } from "./server.js";

const config = loadConfig();
const server = createWebhookServer({ config });

server.listen(config.port, "0.0.0.0", () => {
  console.log(JSON.stringify({ outcome: "listening", port: config.port }));
});

function shutdown(signal) {
  console.log(JSON.stringify({ outcome: "shutdown", signal }));
  server.close((error) => {
    if (error) {
      console.error(JSON.stringify({ outcome: "shutdown_failed", error: error.name }));
      process.exitCode = 1;
    }
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
