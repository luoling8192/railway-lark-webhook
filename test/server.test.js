import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createWebhookServer } from "../src/server.js";

const SECRET = "0123456789abcdef0123456789abcdef";
const PAYLOAD = {
  type: "Deployment.failed",
  details: { id: "event-123", source: "GitHub" },
  resource: {
    project: { id: "project-1", name: "example" },
    environment: { id: "environment-1", name: "production" },
    service: { id: "service-1", name: "api" },
    deployment: { id: "deployment-1" },
  },
  severity: "WARNING",
  timestamp: "2026-10-08T10:30:00.000Z",
};

function config(overrides = {}) {
  return {
    webhookSecret: SECRET,
    larkWebhookUrl: "https://open.larksuite.com/open-apis/bot/v2/hook/example",
    larkTimeoutMs: 100,
    bodyLimitBytes: 64 * 1024,
    deduplicationTtlMs: 60_000,
    trustedProjectIds: new Set(),
    trustedEnvironmentIds: new Set(),
    eventTypes: new Set(),
    ...overrides,
  };
}

async function withServer(options, run) {
  const server = createWebhookServer(options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.notEqual(address, null);
  const origin = `http://127.0.0.1:${address.port}`;

  try {
    await run(origin);
  } finally {
    server.close();
    await once(server, "close");
  }
}

function send(origin, payload = PAYLOAD, secret = SECRET) {
  return fetch(`${origin}/webhooks/railway`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-webhook-secret": secret,
    },
    body: JSON.stringify(payload),
  });
}

test("health check is public and reports readiness", async () => {
  await withServer({ config: config(), deliver: async () => {} }, async (origin) => {
    const response = await fetch(`${origin}/healthz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
  });
});

test("authenticated Railway event is delivered once and duplicate retries are acknowledged", async () => {
  const messages = [];
  await withServer({
    config: config(),
    deliver: async (message) => messages.push(message),
    logger: { info() {}, error() {} },
  }, async (origin) => {
    const first = await send(origin);
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { accepted: true, outcome: "delivered" });

    const duplicate = await send(origin);
    assert.equal(duplicate.status, 200);
    assert.deepEqual(await duplicate.json(), { accepted: true, outcome: "duplicate" });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].card.header.title.content, "Railway · Deployment.failed");
  });
});

test("wrong secret is rejected without invoking Lark", async () => {
  let deliveries = 0;
  await withServer({ config: config(), deliver: async () => { deliveries += 1; } }, async (origin) => {
    const response = await send(origin, PAYLOAD, "wrong-secret");
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "unauthorized" });
    assert.equal(deliveries, 0);
  });
});

test("project allowlist rejects a valid event from another project", async () => {
  await withServer({
    config: config({ trustedProjectIds: new Set(["another-project"]) }),
    deliver: async () => assert.fail("delivery must not run"),
  }, async (origin) => {
    const response = await send(origin);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "untrusted_project" });
  });
});

test("event allowlist acknowledges filtered Railway transitions without sending", async () => {
  await withServer({
    config: config({ eventTypes: new Set(["Deployment.crashed"]) }),
    deliver: async () => assert.fail("delivery must not run"),
    logger: { info() {}, error() {} },
  }, async (origin) => {
    const response = await send(origin);
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { accepted: false, reason: "filtered_event_type" });
  });
});

test("Lark failure returns 502 so Railway can retry", async () => {
  await withServer({
    config: config(),
    deliver: async () => { throw new Error("upstream unavailable"); },
    logger: { info() {}, error() {} },
  }, async (origin) => {
    const response = await send(origin);
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "lark_delivery_failed" });
  });
});
