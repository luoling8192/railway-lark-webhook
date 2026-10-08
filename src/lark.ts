const MAX_LARK_RESPONSE_BYTES = 16 * 1024;

export class LarkDeliveryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LarkDeliveryError";
  }
}

async function readBoundedText(response: Response, maximumBytes: number): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > maximumBytes) {
    await response.body?.cancel();
    throw new LarkDeliveryError("Lark response exceeded the size limit");
  }

  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      throw new LarkDeliveryError("Lark response exceeded the size limit");
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

function resultCode(value: unknown): number | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const code = Reflect.get(value, "code");
  return typeof code === "number" ? code : undefined;
}

export interface SendToLarkOptions {
  readonly fetchImpl?: typeof fetch;
  readonly message: unknown;
  readonly timeoutMs: number;
  readonly webhookUrl: string;
}

export async function sendToLark({
  fetchImpl = fetch,
  message,
  timeoutMs,
  webhookUrl,
}: SendToLarkOptions): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(message),
      signal: controller.signal,
    });

    let result: unknown;
    try {
      result = JSON.parse(await readBoundedText(response, MAX_LARK_RESPONSE_BYTES));
    } catch (error) {
      if (error instanceof LarkDeliveryError) {
        throw error;
      }
      throw new LarkDeliveryError(`Lark returned an invalid response (HTTP ${response.status})`, {
        cause: error,
      });
    }

    const code = resultCode(result);
    if (!response.ok || code !== 0) {
      throw new LarkDeliveryError(
        `Lark rejected the message (HTTP ${response.status}, code ${code ?? "unknown"})`,
      );
    }
  } catch (error) {
    if (error instanceof LarkDeliveryError) {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new LarkDeliveryError("Lark delivery timed out", { cause: error });
    }
    throw new LarkDeliveryError("Lark delivery request failed", { cause: error });
  } finally {
    clearTimeout(timeout);
  }
}
