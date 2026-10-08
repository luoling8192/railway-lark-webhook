import type { CardLocale } from "./i18n";

const DEFAULT_BODY_LIMIT_BYTES = 64 * 1024;
const DEFAULT_LARK_TIMEOUT_MS = 5_000;

export class InvalidConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigurationError";
  }
}

export interface Config {
  readonly cardLocale: CardLocale;
  readonly bodyLimitBytes: number;
  readonly eventTypes: ReadonlySet<string>;
  readonly larkTimeoutMs: number;
  readonly larkWebhookUrl: string;
  readonly trustedEnvironmentIds: ReadonlySet<string>;
  readonly trustedProjectIds: ReadonlySet<string>;
  readonly webhookSecret: string;
}

export interface RuntimeEnv {
  readonly CARD_LOCALE?: string;
  readonly BODY_LIMIT_BYTES?: string;
  readonly EVENT_TYPES?: string;
  readonly LARK_TIMEOUT_MS?: string;
  readonly LARK_WEBHOOK_URL?: string;
  readonly TRUSTED_ENVIRONMENT_IDS?: string;
  readonly TRUSTED_PROJECT_IDS?: string;
  readonly WEBHOOK_SECRET?: string;
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new InvalidConfigurationError(`${name} is required`);
  }
  return normalized;
}

function positiveInteger(value: string | undefined, name: string, fallback: number): number {
  const raw = value?.trim();
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new InvalidConfigurationError(`${name} must be a positive integer`);
  }
  return parsed;
}

function commaSeparatedSet(value: string | undefined): ReadonlySet<string> {
  if (!value?.trim()) {
    return new Set();
  }

  return new Set(
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

function larkWebhookUrl(value: string | undefined): string {
  const raw = required(value, "LARK_WEBHOOK_URL");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new InvalidConfigurationError("LARK_WEBHOOK_URL must be a valid URL");
  }

  const officialHosts = new Set(["open.larksuite.com", "open.feishu.cn"]);
  if (
    url.protocol !== "https:"
    || !officialHosts.has(url.hostname)
    || !/^\/open-apis\/bot\/v2\/hook\/[^/]+$/.test(url.pathname)
    || url.search
    || url.hash
  ) {
    throw new InvalidConfigurationError(
      "LARK_WEBHOOK_URL must be an official Lark or Feishu custom bot URL",
    );
  }

  return url.toString();
}

export function loadConfig(env: RuntimeEnv): Config {
  const cardLocale = env.CARD_LOCALE?.trim() || "en";
  if (cardLocale !== "en" && cardLocale !== "zh-CN") {
    throw new InvalidConfigurationError("CARD_LOCALE must be en or zh-CN");
  }
  const webhookSecret = required(env.WEBHOOK_SECRET, "WEBHOOK_SECRET");
  if (new TextEncoder().encode(webhookSecret).byteLength < 32) {
    throw new InvalidConfigurationError("WEBHOOK_SECRET must be at least 32 bytes");
  }

  return Object.freeze({
    cardLocale,
    bodyLimitBytes: positiveInteger(env.BODY_LIMIT_BYTES, "BODY_LIMIT_BYTES", DEFAULT_BODY_LIMIT_BYTES),
    eventTypes: commaSeparatedSet(env.EVENT_TYPES),
    larkTimeoutMs: positiveInteger(env.LARK_TIMEOUT_MS, "LARK_TIMEOUT_MS", DEFAULT_LARK_TIMEOUT_MS),
    larkWebhookUrl: larkWebhookUrl(env.LARK_WEBHOOK_URL),
    trustedEnvironmentIds: commaSeparatedSet(env.TRUSTED_ENVIRONMENT_IDS),
    trustedProjectIds: commaSeparatedSet(env.TRUSTED_PROJECT_IDS),
    webhookSecret,
  });
}
