import { describe, expect, it } from "vitest";
import { loadConfig, type RuntimeEnv } from "../src/config";

function env(overrides: Partial<RuntimeEnv> = {}): RuntimeEnv {
  return {
    BODY_LIMIT_BYTES: "65536",
    EVENT_TYPES: "",
    LARK_TIMEOUT_MS: "5000",
    LARK_WEBHOOK_URL: "https://open.larksuite.com/open-apis/bot/v2/hook/example",
    TRUSTED_ENVIRONMENT_IDS: "",
    TRUSTED_PROJECT_IDS: "",
    WEBHOOK_SECRET: "0123456789abcdef0123456789abcdef",
    ...overrides,
  };
}

describe("loadConfig", () => {
  it("parses allowlists and documented defaults", () => {
    const config = loadConfig(env({
      BODY_LIMIT_BYTES: "",
      EVENT_TYPES: "Deployment.failed,Deployment.crashed",
      LARK_TIMEOUT_MS: "",
      TRUSTED_PROJECT_IDS: "project-a, project-b",
    }));

    expect(config.bodyLimitBytes).toBe(65_536);
    expect(config.larkTimeoutMs).toBe(5_000);
    expect([...config.trustedProjectIds]).toEqual(["project-a", "project-b"]);
    expect([...config.eventTypes]).toEqual(["Deployment.failed", "Deployment.crashed"]);
  });

  it("rejects non-official webhook destinations", () => {
    expect(() => loadConfig(env({ LARK_WEBHOOK_URL: "https://example.com/collect" })))
      .toThrow(/official Lark or Feishu custom bot URL/);
  });

  it("rejects short inbound secrets", () => {
    expect(() => loadConfig(env({ WEBHOOK_SECRET: "short" }))).toThrow(/at least 32 bytes/);
  });
});
