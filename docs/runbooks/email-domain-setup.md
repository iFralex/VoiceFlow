# Email Domain Setup

Covers DNS configuration for the sending domain used by VoiceFlow transactional emails (Resend provider).

## Prerequisites

- Access to the domain registrar / DNS control panel for the sending domain (e.g. `voiceflow.it`)
- Access to the Resend dashboard (resend.com) with a verified account
- `RESEND_API_KEY` and `EMAIL_FROM_ADDRESS` env vars ready

## Steps

### 1. Add domain in Resend

1. Go to Resend dashboard → Domains → Add Domain
2. Enter the sending domain (e.g. `voiceflow.it`)
3. Select the region closest to your infrastructure (e.g. `eu-west-1` for EU)
4. Resend will display the required DNS records — keep this page open

### 2. Configure DNS records

Add the following records to the domain's DNS zone. Exact values are shown in the Resend dashboard.

**SPF (TXT record)**
```
Name:  @  (or blank, represents root domain)
Type:  TXT
Value: v=spf1 include:amazonses.com ~all
TTL:   3600
```

**DKIM (CNAME records — Resend provides 3)**
```
Name:  resend._domainkey
Type:  CNAME
Value: <value from Resend dashboard>
TTL:   3600
```
Repeat for the other two DKIM records Resend provides.

**DMARC (TXT record)**
```
Name:  _dmarc
Type:  TXT
Value: v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@voiceflow.it; adkim=s; aspf=s
TTL:   3600
```
Adjust `rua` to a monitored mailbox that receives DMARC aggregate reports.

**Return-Path (MX record for bounce handling — optional but recommended)**
```
Name:  bounces
Type:  MX
Value: feedback-smtp.eu-west-1.amazonses.com
TTL:   3600
Priority: 10
```

### 3. Verify in Resend

1. After adding the DNS records, return to the Resend dashboard → Domains
2. Click "Verify" next to the domain — DNS propagation can take up to 48 hours
3. All records should show status "Verified" before sending production emails

### 4. Set environment variables

```
RESEND_API_KEY=re_xxxxxxxxxxxx
EMAIL_FROM_ADDRESS=noreply@voiceflow.it
EMAIL_REPLY_TO=support@voiceflow.it   # optional
```

### 5. Test

Send a test email from the Resend dashboard or via the API:
```bash
curl -X POST 'https://api.resend.com/emails' \
  -H 'Authorization: Bearer re_xxxxxxxxxxxx' \
  -H 'Content-Type: application/json' \
  -d '{"from":"noreply@voiceflow.it","to":"you@example.com","subject":"Test","html":"<p>OK</p>"}'
```

## Troubleshooting

- **SPF fail**: ensure no conflicting SPF TXT records exist on the root domain
- **DKIM fail**: CNAME propagation can be slow; wait 24h and re-verify
- **DMARC quarantine**: check the `rua` mailbox for aggregate reports to diagnose alignment failures
- **Emails going to spam**: verify DKIM + SPF both pass and DMARC policy is aligned; check Resend dashboard for bounce/complaint rates
