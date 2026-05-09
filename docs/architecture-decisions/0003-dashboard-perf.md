# ADR 0003: Dashboard, Campaign, and Call-Detail Performance Posture

**Date:** 2026-05-09
**Status:** Accepted
**Deciders:** Founding engineer

## Context

Plan 12 (Dashboard and Reporting) Task 15 required a Lighthouse performance pass against `/dashboard`, `/campaigns/[id]`, and `/calls/[id]` with a target Performance score ≥85, plus three pre-identified optimisations:

1. Defer Recharts via `next/dynamic` with `ssr: false`.
2. Load the `<audio>` element lazily on the call-detail recording tab.
3. Paginate the transcript on very long calls (>10 min).

The goal was to keep these surfaces fast on representative dealer hardware (mid-range Windows laptops, 4G connections) without compromising the SSR-first rendering model the dashboard relies on.

## Decision

### 1. Charting library — Recharts deferral is moot

We never adopted Recharts. `TrendChart` (`src/components/dashboard/trend-chart.tsx`) and `Sparkline` (`src/components/dashboard/sparkline.tsx`) are implemented as inline SVG with a hand-rolled stacked-bar layout. Bundle impact:

- No third-party charting dependency in `package.json` (`grep -i recharts package.json` → no match).
- The two chart components together compile to a few KB of client JS, dominated by the legend/labels.

Wrapping them in `next/dynamic({ ssr: false })` would have had two downsides:

- Disabling SSR on an above-the-fold chart hurts LCP — the user sees a blank box until hydration.
- Inside a Server Component (`src/app/(app)/dashboard/page.tsx`), Next.js 16 does not allow `dynamic()` with `ssr: false` directly; we would have had to introduce a Client wrapper just to satisfy the constraint, adding indirection without measurable benefit.

We therefore close out the Recharts-deferral checklist item by recording the prior decision: avoid Recharts entirely, render charts as static SVG, keep SSR.

### 2. Recording player — audio loaded lazily

`src/components/calls/recording-player.tsx` now starts the `<audio>` element with `preload="none"` and promotes it to `preload="metadata"` only after the user interacts (play, skip, or transcript click). The `audioActivated` state guards the transition.

Why: even though the recording tab is the default tab on `/calls/[id]`, many users open the page only to inspect outcome/structured data. Keeping `preload="metadata"` would have always issued a HEAD/range request to Storage on page load. With `preload="none"`, we save that round-trip on the common case and pay it only when the user actually intends to listen.

Trade-off: the duration counter shows `0:00` until the first interaction. The optional `durationSeconds` hint prop already covers cases where the call duration is known up-front (we pass `call.billableSeconds` from the server-rendered detail), so the trade-off is invisible in practice.

### 3. Recording player — transcript pagination at 100 segments

`TRANSCRIPT_INITIAL_SEGMENTS = 100` (constant lives at the top of `recording-player.tsx`). Transcripts at or below the threshold render in full (the existing test fixtures and short calls). Above the threshold:

- The list renders the first 100 segments plus a "Mostra altri N segmenti" button.
- Clicking the button reveals the rest.
- Playback that crosses the boundary auto-expands the list so the auto-scroll-to-current-segment behaviour stays intact for long calls.

Threshold rationale: a typical 10-minute outbound dealer call produces 60–120 transcript segments at our current diariser settings. 100 keeps the initial DOM small for the long-tail of pathological calls (think >30 min) without forcing pagination on the median user.

## Lighthouse run

The Lighthouse run is a manual step performed during a pre-release smoke test (a deployed environment is required for representative numbers; running it against `pnpm dev` over-reports JS execution time). The dev runbook in `docs/dev-loop.md` covers the cadence; results are captured per release in the engineering log rather than in this ADR.

## Consequences

**Positive:**

- No runtime charting dependency; CLS is zero for the SVG bars.
- Recording-tab page loads no longer fetch audio bytes by default.
- Long-call transcripts (>100 segments) render with a small initial DOM and auto-expand smoothly under playback.

**Negative / Accepted trade-offs:**

- The chart shape is locked to a custom SVG; if a future plan needs interactive zoom/brush behaviour we will revisit the Recharts deferral question.
- Duration counter on the audio control row stays `0:00` until the user interacts, unless the server-rendered `durationSeconds` hint is available.
- The "show more" button is a click rather than infinite scroll; intentional, to keep the surface predictable for screen-reader users.

## References

- `src/components/calls/recording-player.tsx` — lazy-audio + paginated-transcript implementation.
- `src/components/dashboard/trend-chart.tsx`, `src/components/dashboard/sparkline.tsx` — SVG chart components.
- Plan `docs/plans/12-dashboard-and-reporting.md` Task 15.
