import { describe, expect, it } from "vitest";
import { InvalidRailwayEventError, parseRailwayEvent, toLarkMessage } from "../src/railway";

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

describe("Railway event conversion", () => {
  it("keeps routing identity and bounded display details", () => {
    const event = parseRailwayEvent(PAYLOAD);

    expect(event.externalId).toBe("event-123");
    expect(event.project.id).toBe("project-1");
    expect(event.environment.name).toBe("production");
    expect(event.details.commitHash).toBe("abcdef0123456789");
  });

  it("accepts numeric resource monitor values", () => {
    const event = parseRailwayEvent({
      ...PAYLOAD,
      type: "Monitor.alert",
      details: { metric: "memory", threshold: 80, value: 92.4, unit: "%" },
    });

    expect(event.details.threshold).toBe("80");
    expect(event.details.value).toBe("92.4");
  });

  it("creates a red card with concrete Railway fields", () => {
    const message = toLarkMessage(parseRailwayEvent(PAYLOAD)) as {
      card: {
        elements: Array<{ fields?: Array<{ text: { content: string } }>; text?: { content: string } }>;
        header: { template: string; title: { content: string } };
      };
      msg_type: string;
    };

    expect(message.msg_type).toBe("interactive");
    expect(message.card.header.template).toBe("red");
    expect(message.card.header.title.content).toBe("Railway · Deployment.failed");
    expect(message.card.elements[0]?.fields?.[0]?.text.content).toBe("Project\nexample");
    expect(message.card.elements[2]?.text?.content).toMatch(/Commit: abcdef012345/);
  });

  it("rejects payloads without an event type", () => {
    expect(() => parseRailwayEvent({ timestamp: PAYLOAD.timestamp }))
      .toThrow(InvalidRailwayEventError);
  });
});
