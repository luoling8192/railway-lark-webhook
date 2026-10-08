const MAX_SHORT_TEXT = 160;
const MAX_LONG_TEXT = 800;

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

function display(value: string | undefined): string {
  return value ?? "Not provided";
}

function headerTemplate(event: RailwayEvent): string {
  const type = event.type.toLowerCase();
  if (event.severity === "ERROR" || event.severity === "CRITICAL" || /(failed|crashed)/.test(type)) {
    return "red";
  }
  if (event.severity === "WARNING" || /(warning|alert)/.test(type)) {
    return "orange";
  }
  if (/(success|succeeded|healthy|resolved)/.test(type)) {
    return "green";
  }
  return "blue";
}

function field(label: string, value: string | undefined): Record<string, unknown> {
  return {
    is_short: true,
    text: {
      tag: "plain_text",
      content: `${label}\n${display(value)}`,
    },
  };
}

function detailLines(details: RailwayDetails): string {
  const entries: Array<readonly [string, string | undefined]> = [
    ["Status", details.status],
    ["Source", details.source],
    ["Branch", details.branch],
    ["Commit", details.commitHash?.slice(0, 12)],
    ["Author", details.commitAuthor],
    ["Metric", details.metric],
    ["Threshold", details.threshold],
    ["Observed value", [details.value, details.unit].filter(Boolean).join(" ") || undefined],
    ["Message", details.message ?? details.commitMessage],
  ];

  return entries
    .filter((entry): entry is readonly [string, string] => Boolean(entry[1]))
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
}

export function toLarkMessage(event: RailwayEvent): Record<string, unknown> {
  const elements: Array<Record<string, unknown>> = [
    {
      tag: "div",
      fields: [
        field("Project", event.project.name),
        field("Environment", event.environment.name),
        field("Service", event.service.name),
        field("Severity", event.severity),
        field("Occurred at", event.timestamp),
        field("Event ID", event.externalId),
      ],
    },
  ];

  const details = detailLines(event.details);
  if (details) {
    elements.push(
      { tag: "hr" },
      {
        tag: "div",
        text: {
          tag: "plain_text",
          content: details,
        },
      },
    );
  }

  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: {
        template: headerTemplate(event),
        title: {
          tag: "plain_text",
          content: `Railway · ${event.type}`,
        },
      },
      elements,
    },
  };
}
