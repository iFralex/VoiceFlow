# Live Transfer Setup

When the AI assistant cannot resolve a customer's request, it can warm-transfer
the live call to a human agent. This requires the dealership to configure a
transfer destination phone number on each script.

## How it works

1. During a call the AI may invoke the `transfer_to_human_agent` tool.
2. VoiceFlow uses the `transfer_target_phone` variable stored on the script to
   initiate a warm transfer via Vapi.
3. Vapi bridges the active call to the configured number before hanging up the
   AI leg of the call.
4. The VoiceFlow dashboard records `calls.transferred_to_agent = true` and the
   notification system (plan 13) can alert the dealership's CRM.

## Configuring the transfer number on a script

Open the script editor and add `transfer_target_phone` to the **Script
Variables** section using the full E.164 format (country code + number, no
spaces):

```
transfer_target_phone: +390212345678
```

### Rules

- The value **must** start with `+` followed by the country code and number
  (E.164). An invalid format (missing `+`, spaces, dashes) will be ignored and
  live transfer will be disabled for that call.
- If `transfer_target_phone` is absent or empty, the `transfer_to_human_agent`
  tool still fires the VoiceFlow side-effects (outcome update, audit record,
  Inngest event) but Vapi will **not** bridge the call to a human — the AI
  will continue and eventually end the call normally.
- Only one transfer destination is supported per script. If you need to route to
  different departments, create separate scripts.

## Testing the transfer

1. Enable the `internal.test_call` feature flag for your org (plan 15).
2. Open **Scripts → &lt;your script&gt; → Chiamami ora** and call a test number.
3. During the call ask to speak to a human — the AI should confirm it is
   transferring and the call should bridge to the configured number within a few
   seconds.
4. The call record in the dashboard will show **Transferred to agent: Yes**.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Transfer destination never rings | `transfer_target_phone` missing or invalid format |
| `transferred_to_agent` is `true` but phone never rang | Vapi could not reach the destination (check number + Vapi logs) |
| AI says it will transfer but call drops | `transfer_target_phone` not set; Vapi has no destination to bridge to |

For Vapi-level diagnostics open the [Vapi dashboard](https://dashboard.vapi.ai)
→ **Calls** → select the call → **Logs** to inspect transfer events.
