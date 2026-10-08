import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { sendToLark } from "./lark.js";
import { InvalidRailwayEventError, parseRailwayEvent, toLarkMessage } from "./railway.js";

const WEBHOOK_PATH = "/webhooks/railway";
const MAX_COMPLETED_DELIVERIES = 1_000;

class HttpError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function json(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

function secureEqual(actual, expected) {
  const actualBuffer = Buffer.from(actual, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function requestSecret(request) {
  const authorization = request.headers.authorization;
  if (typeof authorization === "string" && authorization.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length);
  }

  const header = request.headers["x-webhook-secret"];
  return typeof header === "string" ? header : "";
}

async function readJsonBody(request, bodyLimitBytes) {
  const contentType = request.headers["content-type"];
  if (typeof contentType !== "string" || !contentType.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "unsupported_media_type", "Content-Type must be application/json");
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > bodyLimitBytes) {
      throw new HttpError(413, "payload_too_large", "Webhook payload is too large");
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    throw new HttpError(400, "invalid_json", "Webhook payload is not valid JSON", { cause: error });
  }
}

function isAllowed(set, value) {
  return set.size === 0 || (value !== undefined && set.has(value));
}

function pruneCompleted(completed, now, ttlMs) {
  for (const [key, deliveredAt] of completed) {
    if (now - deliveredAt >= ttlMs) {
      completed.delete(key);
    }
  }

  while (completed.size > MAX_COMPLETED_DELIVERIES) {
    const oldestKey = completed.keys().next().value;
    completed.delete(oldestKey);
  }
}

export function createWebhookServer({ config, deliver, logger = console }) {
  const completed = new Map();
  const inFlight = new Map();
  const deliverMessage = deliver ?? ((message) => sendToLark({
    webhookUrl: config.larkWebhookUrl,
    message,
    timeoutMs: config.larkTimeoutMs,
  }));

  async function deliverOnce(event) {
    const now = Date.now();
    pruneCompleted(completed, now, config.deduplicationTtlMs);
    if (completed.has(event.key)) {
      return "duplicate";
    }

    const currentDelivery = inFlight.get(event.key);
    if (currentDelivery) {
      await currentDelivery;
      return "duplicate";
    }

    const delivery = deliverMessage(toLarkMessage(event));
    inFlight.set(event.key, delivery);
    try {
      await delivery;
      completed.set(event.key, Date.now());
      return "delivered";
    } finally {
      inFlight.delete(event.key);
    }
  }

  return createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;

    if (request.method === "GET" && pathname === "/healthz") {
      json(response, 200, { status: "ok" });
      return;
    }

    if (request.method !== "POST" || pathname !== WEBHOOK_PATH) {
      json(response, 404, { error: "not_found" });
      return;
    }

    if (!secureEqual(requestSecret(request), config.webhookSecret)) {
      json(response, 401, { error: "unauthorized" });
      return;
    }

    try {
      const payload = await readJsonBody(request, config.bodyLimitBytes);
      const event = parseRailwayEvent(payload);

      if (!isAllowed(config.trustedProjectIds, event.project.id)) {
        throw new HttpError(403, "untrusted_project", "Project is not allowed");
      }
      if (!isAllowed(config.trustedEnvironmentIds, event.environment.id)) {
        throw new HttpError(403, "untrusted_environment", "Environment is not allowed");
      }
      if (!isAllowed(config.eventTypes, event.type)) {
        logger.info(JSON.stringify({ outcome: "filtered", eventType: event.type }));
        json(response, 202, { accepted: false, reason: "filtered_event_type" });
        return;
      }

      const outcome = await deliverOnce(event);
      logger.info(JSON.stringify({
        outcome,
        eventType: event.type,
        projectId: event.project.id,
        environmentId: event.environment.id,
        serviceId: event.service.id,
      }));
      json(response, 200, { accepted: true, outcome });
    } catch (error) {
      if (error instanceof InvalidRailwayEventError) {
        json(response, 400, { error: "invalid_railway_event" });
        return;
      }
      if (error instanceof HttpError) {
        json(response, error.statusCode, { error: error.code });
        return;
      }

      logger.error(JSON.stringify({
        outcome: "delivery_failed",
        error: error instanceof Error ? error.name : "UnknownError",
      }));
      json(response, 502, { error: "lark_delivery_failed" });
    }
  });
}
