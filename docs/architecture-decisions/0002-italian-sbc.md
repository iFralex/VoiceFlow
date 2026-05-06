# ADR 0002: Italian SBC Carrier Choice

**Date:** 2026-05-06
**Status:** Accepted
**Deciders:** Founding engineer

## Context

VoiceFlow places outbound voice calls into the Italian residential and small-business market on behalf of car dealerships. Spec §9.1 documents that Italian recipients pick up calls with Italian-format CLIs (mobile `+393xx` or geographic landline like `02..`, `06..`) at materially higher rates than +1 / +44 numbers. Vapi's default Twilio-backed pool only offers a small set of credible Italian DIDs; relying on it would compress pickup rates and undermine the core business proposition.

We therefore need a primary Italian SBC (Session Border Controller) carrier supplying a pool of native Italian DIDs we can rotate through, plus secondary and tertiary fallbacks for redundancy when the primary trunk is unhealthy.

## Decision

Use **Voiped Telecom** as the primary Italian SBC carrier, with **Twilio** as the secondary fallback and **Telnyx** as a tertiary option if onboarding completes in time.

Initial pool composition (15 DIDs) procured at platform launch:

- 10 DIDs via Voiped Telecom
  - 3 mobile-format `+393xx` numbers
  - 7 geographic landline numbers spread across `02` Milano, `06` Roma, `011` Torino, `081` Napoli, `051` Bologna
- 5 DIDs via Twilio (Italian local numbers) for failover

The trunk is registered in Vapi as a "BYO Telephony" provider. Each DID is then imported as a Vapi `phoneNumber` resource so the dispatcher (plan 09) can pass `phoneNumberId` into `CreateCallParams.fromNumber`.

## Rationale

- **Voiped Telecom**: Italian SBC operator with fluent Italian-language commercial support, native Italian DIDs across all major area codes, SIP-trunk pricing scaled for outbound campaigns, and a documented track record of working with conversational AI platforms via Vapi BYO. Messagenet was evaluated and is comparable; Voiped was chosen because their out-of-hours support response is faster according to dealer references.
- **Twilio fallback**: Already integrated with Vapi natively. Keeps a smaller footprint of Italian DIDs but is operationally proven and provides a circuit-breaker path when SBC trunk health degrades (see Task 13: dispatcher Twilio fallback).
- **Telnyx tertiary**: Optional — included only if Italian local presence is available and the commercial terms are competitive. Not on the critical path for launch.

## Operational policies

- **Credentials storage**: SIP server URI, username, password, and the Vapi/Retell origin IP whitelist are stored in 1Password (vault: `voiceflow-prod`). Quarterly rotation policy: every 90 days the founder regenerates the SIP password and re-pushes to Vapi. A calendar reminder is set per quarter.
- **Pool population**: DIDs are inserted into the `phone_numbers` table via `pnpm db:seed` (see `src/lib/db/seed/phone_numbers.ts`) or, for incremental top-ups, via `scripts/add-cli.ts`.
- **Inbound routing**: Every DID's inbound route in Vapi points to a single Italian-language inbound IVR assistant (Task 9) handling opt-out and accidental-callback flows.
- **Topping-up the pool**: When ≥30% of the pool is in `cooling_down` status, the founder procures additional DIDs from the primary supplier first; the runbook is in `docs/runbooks/cli-pool-management.md`.

## Consequences

**Positive:**

- Native Italian CLIs with regional matching (Milano contacts get a `02` CLI when possible) materially lift call pickup rates.
- Two independent carriers prevent a single-vendor outage from halting outbound campaigns.
- Quarterly credential rotation reduces blast-radius if SIP credentials leak.

**Negative / Accepted trade-offs:**

- Two commercial relationships to maintain (Voiped + Twilio); both require monthly invoices and per-minute reconciliation.
- Adding new DIDs is a manual process in Phase 1 — automated provisioning APIs are deferred to Phase 2.
- BYO trunk in Vapi means call-quality issues route through three vendors (Voiped → Vapi → us) for triage; runbooks document the diagnostic path.

## Alternatives Considered

- **Twilio-only**: Rejected — Italian DID inventory is thinner and pickup-rate data showed measurably worse performance in our pre-launch tests.
- **Messagenet primary**: Comparable to Voiped on price and DID inventory; rejected because their support SLA is weaker out-of-hours, which matters for dispatch incidents.
- **Direct interconnect with TIM/Vodafone Business**: Rejected for Phase 1 — onboarding takes 6–8 weeks and requires SBC operations expertise we do not yet have in-house.

## References

- Technical specification §9.1 (Italian CLI pickup-rate rationale)
- Technical specification §9.2 (CLI rotation, anti-spam, watchdog)
- Plan `docs/plans/10-telephony-cli-pool.md` (this plan)
- Plan `docs/plans/08-voice-adapter-vapi.md` (Vapi adapter that consumes CLIs)
- Runbook `docs/runbooks/cli-pool-management.md` (Task 8)
