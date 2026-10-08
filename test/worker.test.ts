import { describe, expect, it, vi } from "vitest";
import type { RuntimeEnv } from "../src/config";
import { createRequestHandler } from "../src/worker";

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

function env(overrides: Partial<RuntimeEnv> = {}): RuntimeEnv {
  return {
    BODY_LIMIT_BYTES: "65536",
    EVENT_TYPES: "",
    LARK_TIMEOUT_MS: "5000",
    LARK_WEBHOOK_URL: "https://open.larksuite.com/open-apis/bot/v2/hook/example",
    TRUSTED_ENVIRONMENT_IDS: "",
    TRUSTED_PROJECT_IDS: "",
    WEBHOOK_SECRET: SECRET,
    ...overrides,
  };
}

function request(payload: unknown = PAYLOAD, secret = SECRET): Request {
  return new Request("https://worker.example/webhooks/railway", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-webhook-secret": secret,
    },
    body: JSON.stringify(payload),
  });
}

const silentLogger = { info: vi.fn(), error: vi.fn() };

describe("Worker request handler", () => {
  it("publishes a public health check", async () => {
    const handle = createRequestHandler();
    const response = await handle(new Request("https://worker.example/healthz"), env());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("delivers every authenticated Railway attempt", async () => {
    const messages: unknown[] = [];
    const handle = createRequestHandler({
      deliver: async (message) => { messages.push(message); },
      logger: silentLogger,
    });

    const first = await handle(request(), env());
    const retry = await handle(request(), env());

    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toEqual({ accepted: true, outcome: "delivered" });
    expect(retry.status).toBe(200);
    expect(messages).toHaveLength(2);
  });

  it("rejects a wrong secret without invoking Lark", async () => {
    const deliver = vi.fn(async () => undefined);
    const handle = createRequestHandler({ deliver });
    const response = await handle(request(PAYLOAD, "wrong-secret"), env());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    expect(deliver).not.toHaveBeenCalled();
  });

  it("uses the configured locale on the authenticated delivery path", async () => {
    const deliver = vi.fn(async (_message: unknown) => undefined);
    const handle = createRequestHandler({ deliver, logger: silentLogger });
    const response = await handle(request(), env({ CARD_LOCALE: "zh-CN" }));
    expect(response.status).toBe(200);
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({
      card: expect.objectContaining({
        header: expect.objectContaining({ title: { tag: "plain_text", content: "Railway · 部署失败" } }),
      }),
    }), expect.any(Object));
  });

  it("rejects a valid event from an untrusted project", async () => {
    const deliver = vi.fn(async () => undefined);
    const handle = createRequestHandler({ deliver });
    const response = await handle(request(), env({ TRUSTED_PROJECT_IDS: "another-project" }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "untrusted_project" });
    expect(deliver).not.toHaveBeenCalled();
  });

  it("acknowledges filtered Railway transitions without sending", async () => {
    const deliver = vi.fn(async () => undefined);
    const handle = createRequestHandler({ deliver, logger: silentLogger });
    const response = await handle(request(), env({ EVENT_TYPES: "Deployment.crashed" }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      accepted: false,
      reason: "filtered_event_type",
    });
    expect(deliver).not.toHaveBeenCalled();
  });

  it("returns 502 so Railway can retry a failed Lark delivery", async () => {
    const handle = createRequestHandler({
      deliver: async () => { throw new Error("upstream unavailable"); },
      logger: silentLogger,
    });
    const response = await handle(request(), env());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "lark_delivery_failed" });
  });

  it("enforces the request body limit while streaming", async () => {
    const handle = createRequestHandler({ deliver: async () => undefined });
    const response = await handle(request(PAYLOAD), env({ BODY_LIMIT_BYTES: "16" }));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: "payload_too_large" });
  });
});
