# Runbook: Disaster Recovery

**Owner:** Founder / on-call engineer  
**Last reviewed:** 2026-05-11  
**Quarterly DR drill due:** 2026-08-11

---

## Overview

VoxAuto runs on Supabase (managed Postgres) with two backup layers:

1. **Supabase PITR (Point-in-Time Recovery)** — continuous WAL archiving; restores to any second in the retention window. Enabled on paid projects (Pro plan and above).
2. **Daily logical backup** — NDJSON export, gzip-compressed, AES-256-GCM encrypted, uploaded to Backblaze B2 by the `/api/cron/backup` cron at 03:30 Europe/Rome. Retention: 30 days (B2 lifecycle policy).

---

## 1. Confirm Supabase PITR Is Enabled

> **MANUAL STEP** — must be verified in the Supabase dashboard.

1. Open https://supabase.com/dashboard → select the production project.
2. Navigate to **Settings → Database**.
3. Under **Point in Time Recovery**, confirm the toggle is **ON**.
4. Note the **retention window** (default 7 days on Pro; contact support for longer).

If PITR is not enabled, upgrade the Supabase plan before the first paying customer goes live.

---

## 2. Daily Logical Backup

### Configuration

Set these environment variables in Vercel (production and staging):

| Variable | Description |
|---|---|
| `BACKUP_B2_KEY_ID` | Backblaze B2 application key ID |
| `BACKUP_B2_APP_KEY` | Backblaze B2 application key secret |
| `BACKUP_B2_BUCKET_ID` | B2 bucket ID (not bucket name) |
| `BACKUP_ENCRYPTION_KEY` | 64-char hex string (32 bytes) for AES-256-GCM encryption |

Generate an encryption key:

```bash
openssl rand -hex 32
```

Store the output in 1Password under **VoxAuto Production → Backup Encryption Key**. This key is required for decryption — losing it makes backups unrecoverable.

### B2 bucket setup

1. Create a private B2 bucket named `voxauto-backups`.
2. Set a **Lifecycle Rule**: delete files older than 30 days.
3. Create an **Application Key** scoped to that bucket with `readFiles`, `writeFiles`, `deleteFiles` permissions.

### Verifying backup health

```bash
# Trigger manually (replace token and base URL)
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://voiceflow.app/api/cron/backup
```

Expected response:
```json
{
  "ok": true,
  "filename": "voxauto-backup-2026-05-11T02-30-00.ndjson.gz.enc",
  "sizeBytes": 1234567,
  "tablesExported": 28
}
```

If `ok` is `false` with `error: backup_not_configured`, the env vars are missing. Any other error means the backup failed — check Axiom logs for `[backup]` entries.

---

## 3. Restore Procedures

### 3a. Point-in-Time Recovery via Supabase UI

Use this for accidental data loss, corrupted rows, or ransomware — recovers to any point within the PITR window.

1. Open https://supabase.com/dashboard → production project → **Settings → Database → Point in Time Recovery**.
2. Click **Restore** and select the target timestamp (UTC).
3. Supabase creates a new database at the selected point; the current database continues serving traffic until you cut over.
4. Verify the restored database: connect and run `SELECT count(*) FROM organizations;`.
5. Update `DATABASE_URL` and `DATABASE_DIRECT_URL` in Vercel to point to the restored database.
6. Redeploy to pick up the new connection strings.
7. Run `pnpm db:migrate` against the restored database if schema migrations were applied after the restore point.

**RTO estimate:** 30–60 minutes (Supabase restore time + verification).

### 3b. Full Logical Restore from B2 Backup

Use this when PITR is unavailable (e.g., account suspension) or the backup window is older than the PITR window.

#### Step 1: Download the backup

```bash
# Install B2 CLI
pip install b2

# Authorize
b2 authorize-account $BACKUP_B2_KEY_ID $BACKUP_B2_APP_KEY

# List recent backups
b2 ls voxauto-backups

# Download the desired backup
b2 download-file-by-name voxauto-backups \
  voxauto-backup-2026-05-11T02-30-00.ndjson.gz.enc \
  ./backup.ndjson.gz.enc
```

#### Step 2: Decrypt and decompress

```bash
# KEY_HEX is the 64-char value from BACKUP_ENCRYPTION_KEY (in 1Password)
KEY_HEX="<from-1password>"

# Parse the header: [4-byte IV len][12-byte IV][16-byte authTag][ciphertext]
python3 << 'EOF'
import struct, sys

with open('backup.ndjson.gz.enc', 'rb') as f:
    data = f.read()

iv_len = struct.unpack('>I', data[:4])[0]   # = 12
iv = data[4:4+iv_len]
auth_tag = data[4+iv_len:4+iv_len+16]
ciphertext = data[4+iv_len+16:]

with open('iv.bin', 'wb') as f: f.write(iv)
with open('tag.bin', 'wb') as f: f.write(auth_tag)
with open('ciphertext.bin', 'wb') as f: f.write(ciphertext)
print("IV (hex):", iv.hex())
EOF

# Decrypt (requires OpenSSL 1.1+ with GCM support)
openssl enc -d -aes-256-gcm \
  -K "$KEY_HEX" \
  -iv "$(xxd -p iv.bin)" \
  -in ciphertext.bin \
  -out backup.ndjson.gz

# Decompress
gunzip backup.ndjson.gz
```

#### Step 3: Restore to target database

```bash
# Restore NDJSON into a fresh Postgres database
# Each line is a JSON object: { "_table": "...", ...fields }
python3 << 'EOF'
import json, subprocess, sys

# Group rows by table
from collections import defaultdict
tables = defaultdict(list)

with open('backup.ndjson') as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith('--'):
            continue
        row = json.loads(line)
        table = row.pop('_table')
        tables[table].append(row)

print(f"Tables found: {list(tables.keys())}")
print(f"Total rows: {sum(len(rows) for rows in tables.values())}")
EOF

# Insert rows using psql COPY or a script — see scripts/restore-ndjson.ts
# (to be created during the DR drill)
```

The provided backup is a logical snapshot: schema + data. Before restoring to a running Supabase project:
- Run `pnpm db:migrate` on the target database to ensure schema is current.
- Import data table-by-table respecting FK order (same order as `BACKUP_TABLES` in `src/lib/services/backup.ts`).

**RTO estimate:** 2–4 hours depending on data volume.

### 3c. Partial Table Restore

Use this to restore specific rows (e.g., accidentally deleted contacts) without a full restore.

```bash
# After decrypting (steps above), extract rows for one table
python3 << 'EOF'
import json

table = "contacts"  # change as needed
with open('backup.ndjson') as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith('--'):
            continue
        row = json.loads(line)
        if row.get('_table') == table:
            row.pop('_table')
            print(json.dumps(row))
EOF > contacts-restore.ndjson

# Manually review contacts-restore.ndjson, then insert rows via psql or Drizzle REPL
```

---

## 4. DR Drill Procedure

Run quarterly (see schedule at top of this document).

### Prerequisites

- Staging Supabase project provisioned (`VoiceFlow-staging`)
- `STAGING_DATABASE_DIRECT_URL` available in 1Password
- Latest B2 backup downloaded and decrypted (see §3b)

### Steps

1. **Download latest backup** from B2 (`b2 ls voxauto-backups | sort | tail -1`).
2. **Decrypt and decompress** using key from 1Password (§3b steps 1–2).
3. **Restore to staging database**:
   ```bash
   DATABASE_DIRECT_URL=$STAGING_DATABASE_DIRECT_URL pnpm db:migrate
   # Then run the NDJSON import script
   ```
4. **Verify integrity**: run these queries against staging:
   ```sql
   SELECT count(*) FROM organizations;
   SELECT count(*) FROM contacts;
   SELECT count(*) FROM calls;
   SELECT max(created_at) FROM audit_log;  -- should match backup timestamp
   ```
5. **Verify queryability**: connect the staging app and load the dashboard.
6. **Record results**:
   - RTO (time from decision to restored service): ______
   - RPO (data age at restore point): ______
   - Issues encountered: ______
7. **Update next drill date** in the header of this runbook.

### Acceptance criteria

- All tables restore with row counts matching the backup header.
- No FK violation errors during import.
- App connects successfully to staging database.
- RTO < 4 hours.
- RPO < 25 hours (latest backup is never older than one day).

---

## 5. Quarterly Schedule

| Drill date | Outcome | RTO | RPO | Notes |
|---|---|---|---|---|
| 2026-08-11 | Pending | — | — | First drill |

---

## 6. Escalation

If restore fails or RTO is exceeded:

1. Post in `#incident` Slack channel with `@founder`.
2. If Supabase is unresponsive, open a support ticket at https://supabase.com/support.
3. If B2 is unresponsive, check https://status.backblazeb2.com.
4. Consider activating the staging environment as temporary production until primary is restored.
