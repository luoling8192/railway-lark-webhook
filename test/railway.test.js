import test from "node:test";
import assert from "node:assert/strict";
import { InvalidRailwayEventError, parseRailwayEvent, toLarkMessage } from "../src/railway.js";

const PAYLOAD = {
  type: "Deployment.failed",
  details: {
    id: "event-123",
    source: "GitHub",
    branch: "main",
    commitHash: "abcdef0123456789",
    commitAuthor: "octocat",
    commitMessage: "fix: recover deployment",
  },
  resource: {
    project: { id: "project-1", name: "example" },
    environment: { id: "environment-1", name: "production" },
    service: { id: "service-1", name: "api" },
    deployment: { id: "deployment-1" },
  },
  severity: "WARNING",
  timestamp: "2026-10-08T10:30:00.000Z",
};

test("parseRailwayEvent keeps routing identity and bounded display details", () => {
  const event = parseRailwayEvent(PAYLOAD);

  assert.equal(event.externalId, "event-123");
  assert.equal(event.project.id, "project-1");
  assert.equal(event.environment.name, "production");
  assert.equal(event.details.commitHash, "abcdef0123456789");
});

test("different transitions for one deployment have different deduplication keys", () => {
  const failed = parseRailwayEvent(PAYLOAD);
  const crashed = parseRailwayEvent({
    ...PAYLOAD,
    type: "Deployment.crashed",
    timestamp: "2026-10-08T10:31:00.000Z",
  });

  assert.notEqual(failed.key, crashed.key);
  assert.equal(failed.externalId, crashed.externalId);
});

test("toLarkMessage creates a red card with concrete Railway fields", () => {
  const message = toLarkMessage(parseRailwayEvent(PAYLOAD));

  assert.equal(message.msg_type, "interactive");
  assert.equal(message.card.header.template, "red");
  assert.equal(message.card.header.title.content, "Railway · Deployment.failed");
  assert.equal(message.card.elements[0].fields[0].text.content, "Project\nexample");
  assert.match(message.card.elements[2].text.content, /Commit: abcdef012345/);
});

test("parseRailwayEvent rejects payloads without an event type", () => {
  assert.throws(
    () => parseRailwayEvent({ timestamp: PAYLOAD.timestamp }),
    InvalidRailwayEventError,
  );
});
