# Integrations Roadmap

## Slack and Microsoft Teams (Deferred — post-MVP)

Slack and Teams integrations are explicitly out of scope for MVP. They will be added in a future release.

### Planned approach

Both integrations will be implemented as special-cased `webhooks_outgoing` rows with a format-specific render template. The core delivery engine (HMAC signing, retry/backoff, failure tracking) already handles the generic case. The only addition per integration is:

1. A `channel_type` column (or a discriminating URL pattern) on `webhooks_outgoing` to identify the destination format.
2. A format adapter that transforms the canonical VoiceFlow envelope into the channel-specific payload before delivery:
   - Slack: `POST https://hooks.slack.com/services/…` with a `{"text": "…", "blocks": […]}` body.
   - Teams: `POST https://…outlook.webhook.office.com/…` with an Adaptive Card payload.
3. A UI variant in the "Crea webhook" dialog that lets users paste an Incoming Webhook URL and pick a channel type, hiding the raw HMAC secret (not applicable for Incoming Webhooks).

### Why deferred

- Dealers' primary integration path is the generic outbound webhook (CRM, Zapier, Make), which covers 95% of use cases without requiring OAuth app review.
- Slack and Teams apps require App Directory review or org-level admin approval, adding friction and review time that is not justified for MVP.
- The generic webhook design is forwards-compatible: Slack/Teams rows will be first-class citizens of the same `webhooks_outgoing` table with zero schema changes.

### Path to implementation

1. Add `channel_type enum('generic','slack','teams') DEFAULT 'generic'` to `webhooks_outgoing` (one migration).
2. Create `src/lib/inngest/notifications/webhook-deliver-slack.ts` and `webhook-deliver-teams.ts` with channel-specific envelope rendering.
3. Route delivery fanout to the appropriate function based on `channel_type`.
4. Add Slack and Teams sections to the integrations settings UI.
5. Document OAuth scopes needed for the full Slack Bot Token path (if richer features like DM delivery are desired later).
