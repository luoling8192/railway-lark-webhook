import { describe, expect, it } from "vitest";
import { InvalidRailwayEventError, parseRailwayEvent, toLarkMessage } from "../src/railway";

const PAYLOAD = {
  type: "VolumeAlert.triggered", details: {},
  resource: { project: { id: "project-1", name: "subrelay" }, environment: { id: "environment-1", name: "production" } },
  severity: "INFO", timestamp: "2026-10-08T12:20:52.677Z",
};
interface CardMessage {
  msg_type: string;
  card: {
    header: { template: string; title: { content: string } };
    elements: Array<{ tag: string; text?: { content: string }; elements?: Array<{ content: string }> }>;
  };
}

describe("Railway event conversion", () => {
  it("renders the Chinese alert as a compact single column", () => {
    const message = toLarkMessage(parseRailwayEvent(PAYLOAD), "zh-CN") as CardMessage;
    expect(message.msg_type).toBe("interactive");
    expect(message.card.header).toMatchObject({ template: "orange", title: { content: "Railway · 存储容量告警" } });
    expect(message.card.elements).toEqual([
      { tag: "div", text: { tag: "lark_md", content: "**subrelay / production**" } },
      { tag: "note", elements: [{ tag: "plain_text", content: "2026年10月8日 · 12:20 UTC" }] },
    ]);
    expect(JSON.stringify(message)).not.toMatch(/Not provided|INFO|fields/);
  });
  it("keeps unknown event types readable and supports English dates", () => {
    const message = toLarkMessage(parseRailwayEvent({ ...PAYLOAD, type: "NewEvent.finished" })) as CardMessage;
    expect(message.card.header.title.content).toBe("Railway · New event finished");
    expect(message.card.elements[1]?.elements?.[0]?.content).toBe("8 Oct 2026 · 12:20 UTC");
  });
  it.each(["VolumeAlert.resolved", "Monitor.resolved"])("renders %s in green despite warning severity", (type) => {
    const message = toLarkMessage(parseRailwayEvent({ ...PAYLOAD, type, severity: "WARNING" }), "zh-CN") as CardMessage;
    expect(message.card.header.template).toBe("green");
    expect(message.card.header.title.content).toContain("已恢复");
  });
  it.each([
    ["Deployment.failed", "部署失败"], ["Deployment.crashed", "服务运行崩溃"],
    ["Deployment.oomKilled", "服务因内存不足被终止"],
  ])("renders %s as a red Chinese card", (type, title) => {
    const message = toLarkMessage(parseRailwayEvent({ ...PAYLOAD, type }), "zh-CN") as CardMessage;
    expect(message.card.header.template).toBe("red");
    expect(message.card.header.title.content).toBe(`Railway · ${title}`);
  });
  it("preserves metrics, service names, upstream messages and event identities", () => {
    const event = parseRailwayEvent({ ...PAYLOAD, type: "Monitor.triggered",
      resource: { ...PAYLOAD.resource, service: { id: "service-1", name: "api" } },
      details: { id: "event-123", metric: "memory", threshold: 80, value: 0, unit: "%", message: "Owner text", commitHash: "abcdef0123456789" },
    });
    expect(event.project.id).toBe("project-1");
    expect(event.details.value).toBe("0");
    const message = toLarkMessage(event, "zh-CN") as CardMessage;
    expect(message.card.header.title.content).toBe("Railway · 资源监控告警");
    expect(message.card.elements[0]?.text?.content).toBe("**subrelay / production / api**");
    expect(message.card.elements[1]?.text?.content).toBe("指标: memory\n当前值: 0 %\n告警阈值: 80\n提交: abcdef012345\n详情: Owner text");
    expect(message.card.elements[2]?.elements?.[0]?.content).toContain("事件 ID: event-123");
  });
  it("escapes dynamic names using Lark-compatible entities", () => {
    const message = toLarkMessage(parseRailwayEvent({ ...PAYLOAD, resource: { project: { name: "api_v2 *core* <prod> & &#42;" } } })) as CardMessage;
    expect(message.card.elements[0]?.text?.content).toBe("**api&#95;v2 &#42;core&#42; &#60;prod&#62; &#38; &#38;&#35;42;**");
  });
  it("omits the resource path when no names are supplied", () => {
    const message = toLarkMessage(parseRailwayEvent({ ...PAYLOAD, resource: {} })) as CardMessage;
    expect(message.card.elements).toHaveLength(1);
    expect(message.card.elements[0]?.tag).toBe("note");
  });
  it("rejects missing types and invalid timestamps", () => {
    expect(() => parseRailwayEvent({ timestamp: PAYLOAD.timestamp })).toThrow(InvalidRailwayEventError);
    expect(() => parseRailwayEvent({ ...PAYLOAD, timestamp: "invalid" })).toThrow(InvalidRailwayEventError);
  });
});
