const endpointUrl = process.env.ENDPOINT_URL?.trim();
const webhookSecret = process.env.WEBHOOK_SECRET?.trim();

if (!endpointUrl || !webhookSecret) {
  console.error("ENDPOINT_URL and WEBHOOK_SECRET are required");
  process.exit(1);
}

const response = await fetch(endpointUrl, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-webhook-secret": webhookSecret,
  },
  body: JSON.stringify({
    type: "Deployment.failed",
    details: {
      id: `e2e-${Date.now()}`,
      source: "End-to-end test",
      branch: "main",
      commitHash: "0123456789abcdef",
      commitAuthor: "Railway Lark Webhook",
      commitMessage: "Verify Railway-compatible webhook delivery to Lark",
    },
    resource: {
      workspace: { id: "e2e-workspace", name: "End-to-end verification" },
      project: { id: "e2e-project", name: "railway-lark-webhook" },
      environment: { id: "e2e-environment", name: "production", isEphemeral: false },
      service: { id: "e2e-service", name: "converter" },
      deployment: { id: `e2e-deployment-${Date.now()}` },
    },
    severity: "WARNING",
    timestamp: new Date().toISOString(),
  }),
});

const result = await response.json();
if (!response.ok || result.accepted !== true || result.outcome !== "delivered") {
  console.error(`End-to-end request failed with HTTP ${response.status}: ${JSON.stringify(result)}`);
  process.exit(1);
}

console.log(JSON.stringify({ status: response.status, outcome: result.outcome }));
