import { describe, expect, it } from "vitest";
import { LarkDeliveryError, sendToLark } from "../src/lark";

const MESSAGE = { msg_type: "text", content: { text: "test" } };

describe("sendToLark", () => {
  it("accepts the custom bot success contract", async () => {
    let request: { input: RequestInfo | URL; init?: RequestInit } | undefined;
    const fetchImpl: typeof fetch = async (input, init) => {
      request = { input, init };
      return new Response(JSON.stringify({ code: 0, msg: "success" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await sendToLark({
      webhookUrl: "https://open.larksuite.com/open-apis/bot/v2/hook/example",
      message: MESSAGE,
      timeoutMs: 100,
      fetchImpl,
    });

    expect(request?.input).toBe("https://open.larksuite.com/open-apis/bot/v2/hook/example");
    expect(request?.init?.method).toBe("POST");
    expect(JSON.parse(String(request?.init?.body))).toEqual(MESSAGE);
  });

  it("rejects an HTTP 200 carrying a Lark error", async () => {
    const fetchImpl: typeof fetch = async () => new Response(
      JSON.stringify({ code: 19024, msg: "rejected" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

    await expect(sendToLark({
      webhookUrl: "https://open.larksuite.com/open-apis/bot/v2/hook/example",
      message: MESSAGE,
      timeoutMs: 100,
      fetchImpl,
    })).rejects.toMatchObject({
      name: "LarkDeliveryError",
      message: expect.stringContaining("code 19024"),
    } satisfies Partial<LarkDeliveryError>);
  });

  it("rejects oversized upstream responses", async () => {
    const fetchImpl: typeof fetch = async () => new Response("x".repeat(16_385), {
      headers: { "content-length": "16385" },
    });

    await expect(sendToLark({
      webhookUrl: "https://open.larksuite.com/open-apis/bot/v2/hook/example",
      message: MESSAGE,
      timeoutMs: 100,
      fetchImpl,
    })).rejects.toThrow(/size limit/);
  });
});
