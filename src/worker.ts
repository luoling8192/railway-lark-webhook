import { InvalidConfigurationError, loadConfig, type RuntimeEnv } from "./config";
import { sendToLark } from "./lark";
import { InvalidRailwayEventError, parseRailwayEvent, toLarkMessage } from "./railway";

const WEBHOOK_PATH = "/webhooks/railway";

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "HttpError";
  }
}

interface Logger {
  error(message: string): void;
  info(message: string): void;
}

interface WorkerDependencies {
  readonly deliver?: (message: unknown, env: RuntimeEnv) => Promise<void>;
  readonly logger?: Logger;
}

function json(status: number, body: unknown): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

async function secureEqual(actual: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [actualDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(actualDigest, expectedDigest);
}

function requestSecret(request: Request): string {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length);
  }
  return request.headers.get("x-webhook-secret") ?? "";
}

async function readJsonBody(request: Request, bodyLimitBytes: number): Promise<unknown> {
  const contentType = request.headers.get("content-type");
  if (!contentType?.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "unsupported_media_type", "Content-Type must be application/json");
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > bodyLimitBytes) {
    await request.body?.cancel();
    throw new HttpError(413, "payload_too_large", "Webhook payload is too large");
  }

  const reader = request.body?.getReader();
  if (!reader) {
    throw new HttpError(400, "invalid_json", "Webhook payload is not valid JSON");
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    totalBytes += value.byteLength;
    if (totalBytes > bodyLimitBytes) {
      await reader.cancel();
      throw new HttpError(413, "payload_too_large", "Webhook payload is too large");
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(combined));
  } catch (error) {
    throw new HttpError(400, "invalid_json", "Webhook payload is not valid JSON", { cause: error });
  }
}

function isAllowed(allowlist: ReadonlySet<string>, value: string | undefined): boolean {
  return allowlist.size === 0 || (value !== undefined && allowlist.has(value));
}

export function createRequestHandler({
  deliver,
  logger = console,
}: WorkerDependencies = {}): (request: Request, env: RuntimeEnv) => Promise<Response> {
  return async (request, env) => {
    const pathname = new URL(request.url).pathname;
    if (request.method === "GET" && pathname === "/healthz") {
      return json(200, { status: "ok" });
    }
    if (request.method !== "POST" || pathname !== WEBHOOK_PATH) {
      return json(404, { error: "not_found" });
    }

    let config;
    try {
      config = loadConfig(env);
    } catch (error) {
      if (error instanceof InvalidConfigurationError) {
        logger.error(JSON.stringify({ outcome: "configuration_failed", error: error.name }));
        return json(500, { error: "invalid_configuration" });
      }
      throw error;
    }

    if (!await secureEqual(requestSecret(request), config.webhookSecret)) {
      return json(401, { error: "unauthorized" });
    }

    let event;
    try {
      event = parseRailwayEvent(await readJsonBody(request, config.bodyLimitBytes));
      if (!isAllowed(config.trustedProjectIds, event.project.id)) {
        throw new HttpError(403, "untrusted_project", "Project is not allowed");
      }
      if (!isAllowed(config.trustedEnvironmentIds, event.environment.id)) {
        throw new HttpError(403, "untrusted_environment", "Environment is not allowed");
      }
      if (!isAllowed(config.eventTypes, event.type)) {
        logger.info(JSON.stringify({ outcome: "filtered", eventType: event.type }));
        return json(202, { accepted: false, reason: "filtered_event_type" });
      }
    } catch (error) {
      if (error instanceof InvalidRailwayEventError) {
        return json(400, { error: "invalid_railway_event" });
      }
      if (error instanceof HttpError) {
        return json(error.statusCode, { error: error.code });
      }
      throw error;
    }

    try {
      const message = toLarkMessage(event, config.cardLocale);
      if (deliver) {
        await deliver(message, env);
      } else {
        await sendToLark({
          webhookUrl: config.larkWebhookUrl,
          message,
          timeoutMs: config.larkTimeoutMs,
        });
      }

      logger.info(JSON.stringify({
        outcome: "delivered",
        eventType: event.type,
        projectId: event.project.id,
        environmentId: event.environment.id,
        serviceId: event.service.id,
      }));
      return json(200, { accepted: true, outcome: "delivered" });
    } catch (error) {
      logger.error(JSON.stringify({
        outcome: "delivery_failed",
        error: error instanceof Error ? error.name : "UnknownError",
      }));
      return json(502, { error: "lark_delivery_failed" });
    }
  };
}
