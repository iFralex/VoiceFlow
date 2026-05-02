# Plan: Scripts and Templates

**Branch:** `feat/07-scripts-and-templates`
**Wave:** 2
**Depends on:** 01, 02, 03, 04
**Estimated effort:** 2–4 days

## Overview
Authors and ships the five Italian-language script templates described in spec §8.3 (lead-reactivation, appointment-confirm, car-renewal, post-sale-followup, csi-survey), defines the JSON-Schema-driven variable wizard the dealer uses to customise each template, ensures the immutable AI Act disclosure preamble is enforced at template assembly time per spec §12.3, and builds the script management UI. After this plan merges, dealers can configure scripts ready to be plugged into campaigns in Wave 3.

## Context
Scripts are versioned at template level (`script_templates.version`). A per-org `scripts` row references a specific template version, holding the customised variables. The conversation system prompt is assembled at call dispatch time by combining: (1) the canonical AI Act preamble (forced, cannot be removed), (2) the template's `system_prompt` text with `{{variables}}` interpolated, (3) outcome-classification instructions (forced). This three-part assembly is the single point where compliance is enforced at the prompt level.

## Validation Commands
- `pnpm typecheck`
- `pnpm test src/lib/services/scripts src/lib/services/templates src/lib/voice/prompt`
- `pnpm test:integration src/lib/services/scripts`
- `pnpm db:seed` (re-runs idempotently, must not duplicate templates)
- `pnpm test:e2e e2e/scripts.spec.ts`

### Task 1: Variable JSON Schema definitions
- [ ] Create `src/lib/voice/templates/schemas/` with one TS file per template exporting a JSON Schema (Zod-derived where convenient):
  - `lead-reactivation.schema.ts`: `dealership_name`, `brand`, `salesperson_first_name`, `available_slots` (array of "DD/MM HH:MM"), `lead_origin_context` (free text), `incentive_to_offer` (optional string)
  - `appointment-confirm.schema.ts`: `dealership_name`, `appointment_date`, `appointment_time`, `service_type` (`test_drive` | `service_appointment` | `delivery`), `vehicle_model` (optional), `salesperson_first_name`
  - `car-renewal.schema.ts`: `dealership_name`, `salesperson_first_name`, `current_vehicle_model`, `years_since_purchase`, `available_slots`, `trade_in_offer_summary` (optional)
  - `post-sale-followup.schema.ts`: `dealership_name`, `vehicle_model`, `delivery_date`, `salesperson_first_name`, `service_reminder_window` ("3 mesi" | "6 mesi" | "12 mesi")
  - `csi-survey.schema.ts`: `dealership_name`, `manufacturer_brand`, `vehicle_model`, `service_type` (`sales` | `service`), `last_interaction_date`
- [ ] Each schema enforces required fields, max length per field (256 chars), and patterns where applicable (Italian time format)
- [ ] Mark completed

### Task 2: System prompt authoring — `lead-reactivation`
- [ ] Author the Italian-language system prompt in `src/lib/voice/templates/prompts/lead-reactivation.txt`
- [ ] Required content blocks:
  - **Persona**: "Sei [salesperson_first_name], assistente vocale automatico per [dealership_name], concessionario [brand]"
  - **Mandatory disclosure** (in addition to the canonical preamble enforced separately): explicit AI nature in first sentence
  - **Goal**: capire se il contatto è ancora interessato a un veicolo della marca, e in caso fissare appuntamento
  - **Conversation style**: tono cordiale, italiano commerciale standard, gestione interruzioni, brevità
  - **Hard rules**: mai inventare offerte non listate; mai pressione su numeri/prezzi specifici; rispetto immediato di "non chiamarmi più"
  - **Slot availability**: usare `{{available_slots}}` quando si propone appuntamento
  - **Outcome triggers**: quando invocare quale tool
- [ ] Length target: 800–1200 words for stable LLM behaviour
- [ ] Mark completed

### Task 3: System prompts — remaining four templates
- [ ] Author `appointment-confirm.txt`: focus on conferma, gestione richiesta sposta/disdici, riepilogo dati appuntamento
- [ ] Author `car-renewal.txt`: tono consultivo, riferimento al veicolo attuale, soglia di interesse esplicita
- [ ] Author `post-sale-followup.txt`: focus su soddisfazione, escalation a umano in caso di problema, programmazione tagliando
- [ ] Author `csi-survey.txt`: questionario strutturato a domande con scala 1–10, tono neutrale (no commerciale), termina richiamando l'importanza per la casa madre
- [ ] All five files committed in the repo and read by the seed runner
- [ ] Mark completed

### Task 4: Canonical AI Act disclosure preamble
- [ ] Create `src/lib/voice/prompt/preamble.ts` exporting:
```typescript
export const AI_ACT_PREAMBLE_IT = `Devi rispettare scrupolosamente la seguente regola di trasparenza all'inizio di ogni chiamata:

Nella primissima frase, prima di qualsiasi altra cosa, devi dichiarare di essere un assistente vocale automatico (intelligenza artificiale) che chiama per conto del concessionario. Esempio: "Buongiorno, sono [nome] un assistente vocale automatico per conto di [concessionario]. La chiamata sarà gestita da un sistema di intelligenza artificiale."

Non puoi mai negare di essere un'intelligenza artificiale. Se ti viene chiesto direttamente "sei una persona o un computer?", rispondi sempre con onestà che sei un sistema automatico.

Non puoi proseguire la conversazione finché non hai eseguito questa dichiarazione iniziale.`;

export const OUTCOME_CLASSIFICATION_INSTRUCTIONS_IT = `Al termine della conversazione devi aver chiaro l'esito da uno dei seguenti:
- interessato (l'interlocutore vuole essere ricontattato o ricevere materiale)
- non_interessato (l'interlocutore declina cortesemente)
- appuntamento_fissato (è stato concordato data e ora)
- numero_errato (la persona dice di non aver mai avuto rapporti col concessionario)
- richiamare (chiede di essere richiamato in altro momento)
- segreteria (è scattata una segreteria)
- non_chiamare_piu (ha chiesto esplicitamente di non essere più contattato)

Quando l'esito è chiaro, invoca lo strumento appropriato senza ulteriori commenti.`;

export function assembleSystemPrompt(args: {
  templateBody: string;
  variables: Record<string, string>;
}): string {
  const interpolated = interpolate(args.templateBody, args.variables);
  return [
    AI_ACT_PREAMBLE_IT,
    "---",
    interpolated,
    "---",
    OUTCOME_CLASSIFICATION_INSTRUCTIONS_IT,
  ].join("\n\n");
}
```
- [ ] `interpolate` validates that every `{{var}}` placeholder is present in the variables map; throws if missing
- [ ] Sanitize variable values: strip control chars, cap to 256 chars, escape any `{{` sequences in the values themselves
- [ ] Add unit tests covering: missing variable, injection attempt (e.g. `{{var}}` value contains "Ignore previous instructions"), preamble always first
- [ ] Mark completed

### Task 5: First-message templates
- [ ] Each template has a separate `first-message.txt` rendering the literal first utterance the agent speaks (the disclosure)
- [ ] These are the `firstMessage` parameters passed to the voice provider in plan 08
- [ ] Variables interpolated the same way as system prompts
- [ ] Mark completed

### Task 6: Tool definitions per template
- [ ] Create `src/lib/voice/templates/tools/`:
  - `book_appointment.ts`: `{ date: ISO; time: string; contact_confirmation_text: string }`
  - `mark_not_interested.ts`: `{ reason?: string }`
  - `mark_wrong_number.ts`: `{}`
  - `request_callback.ts`: `{ preferred_window: string }`
  - `transfer_to_human_agent.ts`: `{ reason: string }`
  - `register_opt_out.ts`: `{ confirmation_text: string }`
- [ ] Each tool exports JSON Schema for the LLM and a TS handler stub `(orgId, callId, args) => Promise<void>` that plan 08 wires up
- [ ] Per-template tool selection: lead-reactivation uses all six; appointment-confirm uses transfer/callback/opt-out plus a custom `confirm_appointment` and `reschedule_appointment`; csi-survey uses `submit_survey_response` and minimal others
- [ ] Mark completed

### Task 7: Seed updater
- [ ] Update `src/lib/db/seed/script_templates.ts` (started in plan 02) to read each template's three components from disk (system prompt, first message, schema/tools) at seed time
- [ ] Idempotent UPSERT on `(slug, version)`; bumping a template's version creates a new row and leaves old versions intact
- [ ] Add a CLI flag `--bump <slug>` to bump a specific template's version when authoring iteratively
- [ ] Mark completed

### Task 8: Script service
- [ ] Create `src/lib/services/scripts.ts` exposing:
```typescript
export async function listScripts(orgId: string): Promise<Script[]>;

export async function getScript(orgId: string, scriptId: string): Promise<(Script & { template: ScriptTemplate }) | null>;

export async function createScript(orgId: string, byUserId: string, input: {
  templateSlug: string;
  templateVersion?: number; // default: latest published
  name: string;
  variables: Record<string, string>;
  voiceIdOverride?: string;
}): Promise<Script>;

export async function updateScript(orgId: string, byUserId: string, scriptId: string, patch: Partial<Pick<Script, "name" | "variables" | "voiceId">>): Promise<Script>;

export async function deleteScript(orgId: string, byUserId: string, scriptId: string): Promise<void>;

export async function previewSystemPrompt(orgId: string, scriptId: string): Promise<{ systemPrompt: string; firstMessage: string }>;
```
- [ ] `createScript` and `updateScript` validate variables against the template's `variable_schema` using AJV (or Zod via JSON Schema)
- [ ] `deleteScript` blocked if the script is referenced by any non-completed campaign (emit a typed error consumed by the UI)
- [ ] Mark completed

### Task 9: Scripts list page
- [ ] Create `src/app/(app)/scripts/page.tsx`:
  - empty state: "Nessuno script configurato — inizia da uno dei nostri template"
  - grid of template cards (5 cards) with: template name, description, list of required variables, "Crea da questo template" CTA
  - section below: "I tuoi script" — list of org-owned scripts with template badge, last updated, action buttons
- [ ] Mark completed

### Task 10: Script editor wizard
- [ ] Create `src/app/(app)/scripts/new/page.tsx` with two steps:
  1. **Template selection**: pre-selected via query param `?template=<slug>` from the previous page
  2. **Variables**: form auto-generated from the template's variable schema; field types map JSON Schema → input components (string→input, enum→select, array→repeatable rows, etc.)
- [ ] Live preview pane showing the assembled system prompt below (read-only) so the dealer can verify the result
- [ ] "Salva" button calls `createScript`; redirects to `/scripts/<id>`
- [ ] Mark completed

### Task 11: Script detail/edit page
- [ ] Create `src/app/(app)/scripts/[id]/page.tsx` with:
  - editable variables (pre-populated from `getScript`)
  - voice override picker (lists the available voices for the template's language; voice catalogue managed in plan 08)
  - "Salva modifiche" / "Elimina"
  - "Copia per modifiche" duplicates the script under a new name
  - "Usa in nuova campagna" CTA → routes to campaign wizard (built in plan 09) preselecting this script
- [ ] Mark completed

### Task 12: Voice catalogue table (foundation; population in plan 08)
- [ ] Migration `0009_voice_catalogue.sql`: create `voice_catalogue` (`id` uuid PK, `provider` enum same as calls, `external_voice_id`, `display_name`, `language` default `it-IT`, `gender`, `style`, `sample_url`, `active`, `default_for_templates` text array, `created_at`)
- [ ] Drizzle schema, no RLS (system-owned)
- [ ] Seed two placeholder ElevenLabs Italian voices (real IDs filled in plan 08); plan 07 only ensures the table exists and templates' `default_voice_id` references it
- [ ] Mark completed

### Task 13: Compliance verification at script save
- [ ] On every `createScript` and `updateScript`:
  - call `assembleSystemPrompt` and confirm the AI Act preamble is the first 200+ chars
  - confirm the first-message contains the literal phrase "assistente vocale automatico" (case-insensitive substring check) — guards against template editors removing the disclosure inline
  - if either check fails, reject the save with a clear error
- [ ] Add unit tests for the verification helper
- [ ] Mark completed

### Task 14: Sample preview generation (optional, defer if time-tight)
- [ ] Add Server Action `previewVoiceSample(scriptId)` that calls ElevenLabs to synthesise the first 60 characters of the first message and returns an audio URL
- [ ] Result cached for 24h to avoid burning ElevenLabs credits
- [ ] Surfaces in the script editor as a "Ascolta un esempio" button
- [ ] If ElevenLabs key not configured (early local dev) returns a typed `not_configured` error and the UI hides the button
- [ ] Mark completed

### Task 15: E2E
- [ ] Playwright `e2e/scripts.spec.ts`:
  - from `/scripts` click "Crea da template" on `lead-reactivation`
  - fill all variables; verify live preview updates
  - save; assert redirect to detail page
  - edit one variable, save, verify history reflects update
  - attempt to save with empty `dealership_name`: form rejects
- [ ] Mark completed

### Task 16: Definition of Done
- [ ] Five templates seeded into all three Supabase environments (dev, staging, production)
- [ ] System prompts authored, ≥800 words each, reviewed for tone and compliance
- [ ] AI Act preamble enforced at assembly and rejected if missing
- [ ] Variable wizard generates correctly from JSON Schema
- [ ] Script CRUD works end to end
- [ ] Voice catalogue table exists (full population deferred to plan 08)
- [ ] Mark completed
