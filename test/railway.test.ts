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
    expect(message.card.header.title.content).toBe("Railway · Deployment failed");
    expect(message.card.elements[0]?.fields?.map(({ text }) => text.content)).toEqual([
      "Project\n**example**",
      "Environment\n**production**",
      "Service\n**api**",
      "Severity\n**WARNING**",
      "Occurred\n**8 Oct 2026, 10&#58;30 UTC**",
      "Event ID\n**event&#45;123**",
    ]);
    expect(message.card.elements[2]?.text?.content).toMatch(/Commit: abcdef012345/);
  });

  it("omits missing resource fields from compact alert cards", () => {
    const message = toLarkMessage(parseRailwayEvent({
      type: "VolumeAlert.triggered",
      details: {},
      resource: {
        project: { id: "project-1", name: "subrelay" },
        environment: { id: "environment-1", name: "production" },
      },
      severity: "INFO",
      timestamp: "2026-10-08T12:20:52.677Z",
    })) as {
      card: {
        elements: Array<{ fields?: Array<{ text: { content: string } }> }>;
        header: { template: string; title: { content: string } };
      };
    };

    expect(message.card.header.template).toBe("orange");
    expect(message.card.header.title.content).toBe("Railway · Volume alert triggered");
    expect(message.card.elements).toHaveLength(1);
    expect(message.card.elements[0]?.fields?.map(({ text }) => text.content)).toEqual([
      "Project\n**subrelay**",
      "Environment\n**production**",
      "Severity\n**INFO**",
      "Occurred\n**8 Oct 2026, 12&#58;20 UTC**",
    ]);
    expect(JSON.stringify(message)).not.toContain("Not provided");
  });

  it("escapes dynamic field values using Lark-compatible HTML entities", () => {
    const message = toLarkMessage(parseRailwayEvent({
      ...PAYLOAD,
      resource: {
        ...PAYLOAD.resource,
        project: { id: "project-1", name: "api_v2 *core* <prod> & &#42;" },
      },
    })) as {
      card: { elements: Array<{ fields?: Array<{ text: { content: string } }> }> };
    };

    expect(message.card.elements[0]?.fields?.[0]?.text.content).toBe(
      "Project\n**api&#95;v2 &#42;core&#42; &#60;prod&#62; &#38; &#38;&#35;42;**",
    );
  });

  it("rejects payloads without an event type", () => {
    expect(() => parseRailwayEvent({ timestamp: PAYLOAD.timestamp }))
      .toThrow(InvalidRailwayEventError);
  });
});
