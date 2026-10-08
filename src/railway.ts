import { cardTranslations, translatedEvent, type CardLocale } from "./i18n";

const MAX_SHORT_TEXT = 160;
const MAX_LONG_TEXT = 800;
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;
const DISPLAY_ACRONYMS = new Set(["CPU", "OOM", "RAM"]);
const LARK_MARKDOWN_ENTITIES: Readonly<Record<string, string>> = {
  "&": "&#38;",
  ">": "&#62;",
  "<": "&#60;",
  "~": "&sim;",
  "-": "&#45;",
  "!": "&#33;",
  "*": "&#42;",
  "/": "&#47;",
  "\\": "&#92;",
  "[": "&#91;",
  "]": "&#93;",
  "(": "&#40;",
  ")": "&#41;",
  "#": "&#35;",
  ":": "&#58;",
  "+": "&#43;",
  "\"": "&#34;",
  "'": "&#39;",
  "`": "&#96;",
  "$": "&#36;",
  "_": "&#95;",
};

export class InvalidRailwayEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRailwayEventError";
  }
}

interface ResourceIdentity {
  readonly id?: string;
  readonly name?: string;
}

interface RailwayDetails {
  readonly branch?: string;
  readonly commitAuthor?: string;
  readonly commitHash?: string;
  readonly commitMessage?: string;
  readonly message?: string;
  readonly metric?: string;
  readonly source?: string;
  readonly status?: string;
  readonly threshold?: string;
  readonly unit?: string;
  readonly value?: string;
}

export interface RailwayEvent {
  readonly deployment: ResourceIdentity;
  readonly details: RailwayDetails;
  readonly environment: ResourceIdentity;
  readonly externalId?: string;
  readonly project: ResourceIdentity;
  readonly service: ResourceIdentity;
  readonly severity: string;
  readonly timestamp: string;
  readonly type: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optionalRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function optionalString(value: unknown, maximumLength = MAX_SHORT_TEXT): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  return normalized ? normalized.slice(0, maximumLength) : undefined;
}

function optionalDetail(value: unknown, maximumLength = MAX_SHORT_TEXT): string | undefined {
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).slice(0, maximumLength);
  }
  return optionalString(value, maximumLength);
}

function resourceIdentity(resource: Record<string, unknown>, key: string): ResourceIdentity {
  const entry = optionalRecord(resource[key]);
  return Object.freeze({
    id: optionalString(entry.id),
    name: optionalString(entry.name),
  });
}

export function parseRailwayEvent(payload: unknown): RailwayEvent {
  if (!isRecord(payload)) {
    throw new InvalidRailwayEventError("Webhook payload must be a JSON object");
  }

  const type = optionalString(payload.type);
  if (!type) {
    throw new InvalidRailwayEventError("Webhook payload must contain a non-empty type");
  }

  const timestamp = optionalString(payload.timestamp);
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) {
    throw new InvalidRailwayEventError("Webhook payload must contain a valid timestamp");
  }

  const resource = optionalRecord(payload.resource);
  const details = optionalRecord(payload.details);
  const project = resourceIdentity(resource, "project");
  const environment = resourceIdentity(resource, "environment");
  const service = resourceIdentity(resource, "service");
  const deployment = resourceIdentity(resource, "deployment");

  return Object.freeze({
    deployment,
    details: Object.freeze({
      branch: optionalString(details.branch),
      commitAuthor: optionalString(details.commitAuthor),
      commitHash: optionalString(details.commitHash),
      commitMessage: optionalString(details.commitMessage, MAX_LONG_TEXT),
      message: optionalString(details.message, MAX_LONG_TEXT),
      metric: optionalDetail(details.metric),
      source: optionalString(details.source),
      status: optionalDetail(details.status),
      threshold: optionalDetail(details.threshold),
      unit: optionalDetail(details.unit),
      value: optionalDetail(details.value),
    }),
    environment,
    externalId: optionalString(details.id) ?? deployment.id,
    project,
    service,
    severity: optionalString(payload.severity)?.toUpperCase() ?? "INFO",
    timestamp: new Date(timestamp).toISOString(),
    type,
  });
}

function headerTemplate(event: RailwayEvent): string {
  const type = event.type.toLowerCase();
  if (/(success|succeeded|healthy|resolved)/.test(type)) {
    return "green";
  }
  if (event.severity === "ERROR" || event.severity === "CRITICAL" || /(failed|crashed|oomkilled)/.test(type)) {
    return "red";
  }
  if (event.severity === "WARNING" || /(warning|alert|triggered)/.test(type)) {
    return "orange";
  }
  return "blue";
}

function humanizeEventType(eventType: string): string {
  const words = eventType
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((word) => {
      const upper = word.toUpperCase();
      return DISPLAY_ACRONYMS.has(upper) ? upper : word.toLowerCase();
    });

  const phrase = words.join(" ");
  return `${phrase[0]?.toUpperCase()}${phrase.slice(1)}`;
}

function formatTimestamp(timestamp: string, locale: CardLocale): string {
  const date = new Date(timestamp);
  const month = MONTH_NAMES[date.getUTCMonth()];
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return locale === "zh-CN"
    ? `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月${date.getUTCDate()}日 · ${hours}:${minutes} UTC`
    : `${date.getUTCDate()} ${month} ${date.getUTCFullYear()} · ${hours}:${minutes} UTC`;
}

function escapeLarkMarkdown(value: string): string {
  return [...value.replace(/\s+/g, " ")]
    .map((character) => LARK_MARKDOWN_ENTITIES[character] ?? character)
    .join("");
}

function detailLines(details: RailwayDetails, locale: CardLocale): string {
  const labels = cardTranslations(locale);
  const entries: Array<readonly [string, string | undefined]> = [
    [labels.metric, details.metric],
    [labels.value, details.value === undefined ? undefined : [details.value, details.unit].filter(Boolean).join(" ")],
    [labels.threshold, details.threshold],
    [labels.status, details.status],
    [labels.source, details.source],
    [labels.branch, details.branch],
    [labels.commit, details.commitHash?.slice(0, 12)],
    [labels.author, details.commitAuthor],
    [labels.message, details.message ?? details.commitMessage],
  ];

  return entries
    .filter((entry): entry is readonly [string, string] => Boolean(entry[1]))
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
}

export function toLarkMessage(event: RailwayEvent, locale: CardLocale = "en") {
  const title = translatedEvent(event.type, locale) ?? humanizeEventType(event.type);
  const path = [event.project.name, event.environment.name, event.service.name]
    .filter((name): name is string => Boolean(name)).map(escapeLarkMarkdown).join(" / ");
  const elements: Array<{
    tag: "div" | "note";
    text?: { tag: "lark_md" | "plain_text"; content: string };
    elements?: Array<{ tag: "plain_text"; content: string }>;
  }> = [];
  if (path) {
    elements.push({
      tag: "div",
      text: { tag: "lark_md", content: `**${path}**` },
    });
  }

  const details = detailLines(event.details, locale);
  if (details) {
    elements.push(
      {
        tag: "div",
        text: {
          tag: "plain_text",
          content: details,
        },
      },
    );
  }
  const footer = [formatTimestamp(event.timestamp, locale)];
  if (event.externalId) {
    footer.push(`${cardTranslations(locale).eventId}: ${event.externalId}`);
  }
  elements.push({ tag: "note", elements: [{ tag: "plain_text", content: footer.join("\n") }] });

  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: {
        template: headerTemplate(event),
        title: {
          tag: "plain_text",
          content: `Railway · ${title}`,
        },
      },
      elements,
    },
  };
}
