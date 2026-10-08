# Railway Lark Webhook

Convert Railway deployment and resource alert webhooks into readable Lark or Feishu message cards.

The converter runs as a small Cloudflare Worker. It stores no events, has no runtime package dependencies, and never exposes the Lark bot URL to callers. It validates every incoming request with a shared secret header and can restrict events by Railway project, environment, and event type.

## What it handles

- Railway deployment status events, including failed and crashed deployments
- CPU and RAM monitor alerts
- Volume usage alerts
- Lark and Feishu custom bot webhooks

Railway webhook delivery is best-effort and unordered. This converter waits for Lark and returns an error when Lark rejects a message so Railway can retry. Retries can produce duplicate Lark messages because the Worker intentionally has no state or durable incident queue.

## Deploy on Cloudflare Workers

1. Install the development dependencies and authenticate Wrangler:

   ```bash
   npm ci
   npx wrangler login
   ```

2. Store the two secrets. Wrangler prompts for each value without putting it in source control:

   ```bash
   npx wrangler secret put LARK_WEBHOOK_URL
   npx wrangler secret put WEBHOOK_SECRET
   ```

   `WEBHOOK_SECRET` must contain at least 32 bytes. A random 32-byte hex value is a good choice.

3. Deploy the Worker:

   ```bash
   npm run deploy
   ```

4. In the Railway project you want to monitor, open **Settings → Webhooks** and add:

   ```text
   URL: https://railway-lark-webhook.<your-subdomain>.workers.dev/webhooks/railway
   Header: X-Webhook-Secret: <the same WEBHOOK_SECRET>
   ```

5. Select the Railway events you want and use **Test Webhook**. Trigger a real deployment event afterward to confirm the complete production path.

Hosting the converter outside Railway lets it continue receiving alerts during a Railway project-level incident.

## Configuration

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `LARK_WEBHOOK_URL` | Yes | — | Official Lark or Feishu custom bot URL |
| `WEBHOOK_SECRET` | Yes | — | Incoming `X-Webhook-Secret` or Bearer value; minimum 32 bytes |
| `CARD_LOCALE` | No | `en` | Card language: `en` or `zh-CN`; the included Wrangler configuration selects Chinese |
| `TRUSTED_PROJECT_IDS` | No | All | Comma-separated Railway project IDs |
| `TRUSTED_ENVIRONMENT_IDS` | No | All | Comma-separated Railway environment IDs |
| `EVENT_TYPES` | No | All | Comma-separated exact event types, such as `Deployment.failed` |
| `LARK_TIMEOUT_MS` | No | `5000` | Lark request timeout |
| `BODY_LIMIT_BYTES` | No | `65536` | Maximum accepted request body |

The optional non-secret values are declared in `wrangler.jsonc`. Allowlists are additional protection: if a configured event lacks the corresponding ID, it is rejected rather than silently accepted.

Cards use a single-column layout: a translated event title, a bold project/environment/service path, optional details, and a small UTC timestamp. Resource names and upstream messages retain their original text. Unknown event types remain readable in English rather than being assigned an incorrect translation. Resolved events use a green header.

## Run locally

Node.js 22 or newer is required.

Create an ignored `.dev.vars` file from `.env.example`, fill in local-only values, and start Wrangler:

```text
LARK_WEBHOOK_URL=https://open.larksuite.com/open-apis/bot/v2/hook/...
WEBHOOK_SECRET=<at least 32 random characters>
```

```bash
npm run dev
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

Tests run in the Workers runtime and cover configuration validation, Railway payload parsing, card conversion, authentication, allowlists, size limits, and delivery failure behavior.

## Security

- Put `LARK_WEBHOOK_URL` and `WEBHOOK_SECRET` in Cloudflare Worker secrets, never in source control.
- Configure Railway's custom webhook header instead of putting a secret in the URL, because URLs commonly appear in access logs.
- Rotate a Lark or Feishu bot webhook after accidental disclosure.
- Logs contain event routing IDs and types, not full payloads, bot URLs, or shared secrets.

See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## License

MIT
