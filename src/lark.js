export class LarkDeliveryError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "LarkDeliveryError";
  }
}

export async function sendToLark({ webhookUrl, message, timeoutMs, fetchImpl = fetch }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();

  let response;
  try {
    response = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(message),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new LarkDeliveryError("Lark delivery timed out", { cause: error });
    }
    throw new LarkDeliveryError("Lark delivery request failed", { cause: error });
  } finally {
    clearTimeout(timeout);
  }

  let result;
  try {
    result = await response.json();
  } catch (error) {
    throw new LarkDeliveryError(`Lark returned an invalid response (HTTP ${response.status})`, {
      cause: error,
    });
  }

  if (!response.ok || result?.code !== 0) {
    const code = typeof result?.code === "number" ? result.code : "unknown";
    throw new LarkDeliveryError(`Lark rejected the message (HTTP ${response.status}, code ${code})`);
  }
}
