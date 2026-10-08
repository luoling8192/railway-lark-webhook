const DEFAULT_PORT = 3000;
const DEFAULT_BODY_LIMIT_BYTES = 64 * 1024;
const DEFAULT_LARK_TIMEOUT_MS = 5_000;
const DEFAULT_DEDUPLICATION_TTL_MS = 10 * 60 * 1_000;

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function positiveInteger(env, name, fallback) {
  const raw = env[name]?.trim();
  if (!raw) {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function commaSeparatedSet(env, name) {
  const raw = env[name]?.trim();
  if (!raw) {
    return new Set();
  }

  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return new Set(values);
}

function larkWebhookUrl(env) {
  const value = required(env, "LARK_WEBHOOK_URL");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("LARK_WEBHOOK_URL must be a valid URL");
  }

  const officialHosts = new Set(["open.larksuite.com", "open.feishu.cn"]);
  if (
    url.protocol !== "https:"
    || !officialHosts.has(url.hostname)
    || !/^\/open-apis\/bot\/v2\/hook\/[^/]+$/.test(url.pathname)
    || url.search
    || url.hash
  ) {
    throw new Error("LARK_WEBHOOK_URL must be an official Lark or Feishu custom bot URL");
  }

  return url.toString();
}

export function loadConfig(env = process.env) {
  const webhookSecret = required(env, "WEBHOOK_SECRET");
  if (Buffer.byteLength(webhookSecret, "utf8") < 32) {
    throw new Error("WEBHOOK_SECRET must be at least 32 bytes");
  }

  return Object.freeze({
    port: positiveInteger(env, "PORT", DEFAULT_PORT),
    bodyLimitBytes: positiveInteger(env, "BODY_LIMIT_BYTES", DEFAULT_BODY_LIMIT_BYTES),
    larkTimeoutMs: positiveInteger(env, "LARK_TIMEOUT_MS", DEFAULT_LARK_TIMEOUT_MS),
    deduplicationTtlMs: positiveInteger(
      env,
      "DEDUPLICATION_TTL_MS",
      DEFAULT_DEDUPLICATION_TTL_MS,
    ),
    larkWebhookUrl: larkWebhookUrl(env),
    webhookSecret,
    trustedProjectIds: commaSeparatedSet(env, "TRUSTED_PROJECT_IDS"),
    trustedEnvironmentIds: commaSeparatedSet(env, "TRUSTED_ENVIRONMENT_IDS"),
    eventTypes: commaSeparatedSet(env, "EVENT_TYPES"),
  });
}
