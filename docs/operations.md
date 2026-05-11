# Operations Guide

## Health Endpoints

Two endpoints are available for monitoring and readiness checks.

### `/api/health`

A lightweight liveness probe with no database access.

- Method: `GET`
- Always returns HTTP 200 while the process is alive
- Response: `{ "status": "ok", "ts": "<ISO timestamp>" }`

Use this for Vercel's built-in health checks and any load balancer liveness probe where you only need to know the process is running.

### `/api/ready`

A deeper readiness probe that verifies connectivity to all critical upstream dependencies.

- Method: `GET`
- Returns HTTP 200 when all checks pass, HTTP 503 when any check fails
- Response:

```json
{
  "status": "ok" | "degraded",
  "ts": "<ISO timestamp>",
  "checks": {
    "db":     { "ok": true,  "latencyMs": 4 },
    "stripe": { "ok": true,  "latencyMs": 120 },
    "vapi":   { "ok": true,  "latencyMs": 80 },
    "resend": { "ok": true,  "latencyMs": 95 }
  }
}
```

When a check fails the object includes an `"error"` field with a short description:

```json
"db": { "ok": false, "error": "connect ECONNREFUSED 127.0.0.1:5432" }
```

Checks performed:

| Check  | What it does |
|--------|-------------|
| `db`   | `SELECT 1` via the pgBouncer pooler |
| `stripe` | `GET /v1/balance` — verifies the Stripe key is valid |
| `vapi` | `GET /assistant` — verifies the Vapi key is valid (skipped if `VAPI_API_KEY` absent) |
| `resend` | `GET /domains` — verifies the Resend key is valid |

## External Uptime Monitor

Set up an external monitor (Uptime Robot, Better Stack, or equivalent) targeting `/api/ready`:

- **URL:** `https://<your-production-domain>/api/ready`
- **Method:** GET
- **Interval:** 5 minutes
- **Alert threshold:** 2 consecutive failures before paging
- **Region:** EU (Frankfurt or Amsterdam) to minimise latency variance
- **Expected status:** 200

Use `/api/health` for an additional lightweight monitor if the uptime service allows multiple endpoints per site — it verifies the process is alive even when upstream dependencies are unreachable.

### Configuring Uptime Robot (free tier)

1. Log in at <https://uptimerobot.com>
2. Add Monitor → HTTP(S)
3. URL: your `/api/ready` endpoint
4. Monitoring Interval: 5 minutes
5. Alert Contacts: add the founder's email + optionally a Slack webhook
6. Sensitivity: 2 errors before alerting

### Configuring Better Stack (recommended for PagerDuty integration)

1. Log in at <https://betterstack.com>
2. Monitors → Create Monitor
3. URL: your `/api/ready` endpoint, method GET
4. Check frequency: every 5 minutes
5. Regions: EU (Frankfurt)
6. Escalation: integrate with the PagerDuty service used for CRITICAL alerts

The `/api/ready` endpoint is already wired to return 503 on any upstream degradation, so the uptime monitor will catch DB outages, Stripe key rotation mismatches, and Vapi / Resend connectivity failures automatically.
