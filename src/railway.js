import { createHash } from "node:crypto";

const MAX_SHORT_TEXT = 160;
const MAX_LONG_TEXT = 800;

export class InvalidRailwayEventError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidRailwayEventError";
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optionalRecord(value) {
  return isRecord(value) ? value : {};
}

function optionalString(value, maximumLength = MAX_SHORT_TEXT) {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.slice(0, maximumLength);
}

function resourceIdentity(resource, key) {
  const entry = optionalRecord(resource[key]);
  return {
    id: optionalString(entry.id),
    name: optionalString(entry.name),
  };
}

export function parseRailwayEvent(payload) {
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
  const detailId = optionalString(details.id);

  const fingerprintSource = [
    type,
    timestamp,
    detailId,
    deployment.id,
    project.id,
    environment.id,
    service.id,
  ].filter(Boolean).join("\u0000");

  return Object.freeze({
    key: createHash("sha256").update(fingerprintSource).digest("hex"),
    externalId: detailId ?? deployment.id,
    type,
    timestamp: new Date(timestamp).toISOString(),
    severity: optionalString(payload.severity)?.toUpperCase() ?? "INFO",
    project,
    environment,
    service,
    deployment,
    details: Object.freeze({
      source: optionalString(details.source),
      status: optionalString(details.status),
      branch: optionalString(details.branch),
      commitHash: optionalString(details.commitHash),
      commitAuthor: optionalString(details.commitAuthor),
      commitMessage: optionalString(details.commitMessage, MAX_LONG_TEXT),
      metric: optionalString(details.metric),
      threshold: optionalString(details.threshold),
      value: optionalString(details.value),
      unit: optionalString(details.unit),
      message: optionalString(details.message, MAX_LONG_TEXT),
    }),
  });
}

function display(value) {
  return value ?? "Not provided";
}

function headerTemplate(event) {
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

function field(label, value) {
  return {
    is_short: true,
    text: {
      tag: "plain_text",
      content: `${label}\n${display(value)}`,
    },
  };
}

function detailLines(details) {
  const entries = [
    ["Status", details.status],
    ["Source", details.source],
    ["Branch", details.branch],
    ["Commit", details.commitHash?.slice(0, 12)],
    ["Author", details.commitAuthor],
    ["Metric", details.metric],
    ["Threshold", details.threshold],
    ["Observed value", [details.value, details.unit].filter(Boolean).join(" ") || undefined],
    ["Message", details.message ?? details.commitMessage],
  ].filter(([, value]) => value);

  return entries.map(([label, value]) => `${label}: ${value}`).join("\n");
}

export function toLarkMessage(event) {
  const elements = [
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
