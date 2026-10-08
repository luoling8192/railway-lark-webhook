import test from "node:test";
import assert from "node:assert/strict";
import { LarkDeliveryError, sendToLark } from "../src/lark.js";

const MESSAGE = { msg_type: "text", content: { text: "test" } };

test("sendToLark accepts the custom bot success contract", async () => {
  let request;
  await sendToLark({
    webhookUrl: "https://open.larksuite.com/open-apis/bot/v2/hook/example",
    message: MESSAGE,
    timeoutMs: 100,
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({ code: 0, msg: "success" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.equal(request.url, "https://open.larksuite.com/open-apis/bot/v2/hook/example");
  assert.equal(request.init.method, "POST");
  assert.deepEqual(JSON.parse(request.init.body), MESSAGE);
});

test("sendToLark rejects an HTTP 200 carrying a Lark error", async () => {
  await assert.rejects(
    sendToLark({
      webhookUrl: "https://open.larksuite.com/open-apis/bot/v2/hook/example",
      message: MESSAGE,
      timeoutMs: 100,
      fetchImpl: async () => new Response(JSON.stringify({ code: 19024, msg: "rejected" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    }),
    (error) => error instanceof LarkDeliveryError && /code 19024/.test(error.message),
  );
});
