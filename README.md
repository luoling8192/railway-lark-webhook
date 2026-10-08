# Railway Lark Webhook

Convert Railway deployment and resource alert webhooks into readable Lark or Feishu message cards.

The service has no runtime dependencies, stores no events, and never exposes the Lark bot URL to callers. It validates every incoming request with a shared secret header and can restrict events by Railway project, environment, and event type.

## What it handles

- Railway deployment status events, including failed and crashed deployments
- CPU and RAM monitor alerts
- Volume usage alerts
- Lark and Feishu custom bot webhooks
- Short-term retry deduplication within one running instance

Railway webhook delivery is best-effort and unordered. This converter returns an error when Lark rejects a message so Railway can retry, but it is not a durable incident queue.

## Deploy on Railway

1. Create a Railway service from this GitHub repository.
2. Add these service variables:

   ```text
   LARK_WEBHOOK_URL=<your Lark or Feishu custom bot webhook URL>
   WEBHOOK_SECRET=<at least 32 random characters>
   ```

3. Generate a public domain for the service. Railway uses `/healthz` as its deployment health check.
4. In the project you want to monitor, open **Settings → Webhooks** and add:

   ```text
   URL: https://<converter-domain>/webhooks/railway
   Header: X-Webhook-Secret: <the same WEBHOOK_SECRET>
   ```

5. Select the Railway events you want and use **Test Webhook**. Trigger a real deployment event afterward to confirm the complete production path.

Keep the converter in a separate Railway project from the services it monitors so one project-level outage does not disable its own alerts.

## Configuration

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `LARK_WEBHOOK_URL` | Yes | — | Official Lark or Feishu custom bot URL |
| `WEBHOOK_SECRET` | Yes | — | Incoming `X-Webhook-Secret` or Bearer value; minimum 32 bytes |
| `TRUSTED_PROJECT_IDS` | No | All | Comma-separated Railway project IDs |
| `TRUSTED_ENVIRONMENT_IDS` | No | All | Comma-separated Railway environment IDs |
| `EVENT_TYPES` | No | All | Comma-separated exact event types, such as `Deployment.failed` |
| `LARK_TIMEOUT_MS` | No | `5000` | Lark request timeout |
| `DEDUPLICATION_TTL_MS` | No | `600000` | In-memory duplicate suppression period |
| `BODY_LIMIT_BYTES` | No | `65536` | Maximum accepted request body |
| `PORT` | No | `3000` | HTTP listener; Railway injects this automatically |

Optional allowlists are additional protection. If a configured event lacks the corresponding ID, it is rejected rather than silently accepted.

## Run locally

Node.js 22 or newer is required.

```bash
export LARK_WEBHOOK_URL='https://open.larksuite.com/open-apis/bot/v2/hook/...'
export WEBHOOK_SECRET="$(openssl rand -hex 32)"
npm start
```

Verify the public health endpoint:

```bash
curl http://localhost:3000/healthz
```

Send the included Railway-shaped sample event:

```bash
ENDPOINT_URL=http://localhost:3000/webhooks/railway \
WEBHOOK_SECRET="$WEBHOOK_SECRET" \
node scripts/send-sample.js
```

## Test

```bash
npm test
npm run check
```

Tests cover configuration validation, Railway payload parsing, card conversion, authentication, allowlists, delivery failure behavior, and retry deduplication.

## Security

- Put `LARK_WEBHOOK_URL` and `WEBHOOK_SECRET` in Railway service variables, never in source control.
- Configure Railway's custom webhook header instead of putting a secret in the URL, because URLs commonly appear in access logs.
- Rotate a Lark or Feishu bot webhook after accidental disclosure.
- Logs contain event routing IDs and types, not full payloads, bot URLs, or shared secrets.

See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## License

MIT
