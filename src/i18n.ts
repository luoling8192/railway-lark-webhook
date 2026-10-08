export type CardLocale = "en" | "zh-CN";

const translations = {
  en: {
    status: "Status", source: "Source", branch: "Branch", commit: "Commit",
    author: "Author", metric: "Metric", threshold: "Threshold",
    value: "Observed value", message: "Message", eventId: "Event ID",
    events: {
      "VolumeAlert.triggered": "Volume alert triggered",
      "VolumeAlert.resolved": "Volume alert resolved",
      "Monitor.triggered": "Resource monitor triggered",
      "Monitor.resolved": "Resource monitor resolved",
      "Deployment.crashed": "Deployment crashed",
      "Deployment.oomKilled": "Deployment killed due to insufficient memory",
      "Deployment.failed": "Deployment failed",
    },
  },
  "zh-CN": {
    status: "状态", source: "来源", branch: "分支", commit: "提交",
    author: "作者", metric: "指标", threshold: "告警阈值",
    value: "当前值", message: "详情", eventId: "事件 ID",
    events: {
      "VolumeAlert.triggered": "存储容量告警",
      "VolumeAlert.resolved": "存储容量告警已恢复",
      "Monitor.triggered": "资源监控告警",
      "Monitor.resolved": "资源监控告警已恢复",
      "Deployment.crashed": "服务运行崩溃",
      "Deployment.oomKilled": "服务因内存不足被终止",
      "Deployment.failed": "部署失败",
    },
  },
} as const;

export function cardTranslations(locale: CardLocale) {
  return translations[locale];
}

export function translatedEvent(type: string, locale: CardLocale): string | undefined {
  const events: Readonly<Record<string, string>> = translations[locale].events;
  return events[type];
}
