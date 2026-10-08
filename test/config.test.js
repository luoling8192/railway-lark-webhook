import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";

const VALID_ENV = {
  LARK_WEBHOOK_URL: "https://open.larksuite.com/open-apis/bot/v2/hook/example",
  WEBHOOK_SECRET: "0123456789abcdef0123456789abcdef",
};

test("loadConfig parses allowlists and documented defaults", () => {
  const config = loadConfig({
    ...VALID_ENV,
    TRUSTED_PROJECT_IDS: "project-a, project-b",
    EVENT_TYPES: "Deployment.failed,Deployment.crashed",
  });

  assert.equal(config.port, 3000);
  assert.deepEqual([...config.trustedProjectIds], ["project-a", "project-b"]);
  assert.deepEqual([...config.eventTypes], ["Deployment.failed", "Deployment.crashed"]);
});

test("loadConfig rejects non-official webhook destinations", () => {
  assert.throws(
    () => loadConfig({ ...VALID_ENV, LARK_WEBHOOK_URL: "https://example.com/collect" }),
    /official Lark or Feishu custom bot URL/,
  );
});

test("loadConfig rejects short inbound secrets", () => {
  assert.throws(
    () => loadConfig({ ...VALID_ENV, WEBHOOK_SECRET: "short" }),
    /at least 32 bytes/,
  );
});
