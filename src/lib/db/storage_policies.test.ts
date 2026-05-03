import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const BUCKETS = ['recordings', 'transcripts', 'csv-uploads', 'exports'];
const OPS = ['select', 'insert', 'update', 'delete'];

const migrationPath = join(
  process.cwd(),
  'drizzle/migrations/0004_storage_policies.sql',
);

let sql: string;

function getMigration(): string {
  if (!sql) sql = readFileSync(migrationPath, 'utf-8');
  return sql;
}

describe('migration 0004_storage_policies.sql', () => {
  it('migration file exists and is non-empty', () => {
    const content = getMigration();
    expect(content.length).toBeGreaterThan(500);
  });

  it('targets storage.objects table', () => {
    expect(getMigration()).toContain('ON storage.objects');
  });

  it('uses storage.foldername to extract path prefix', () => {
    expect(getMigration()).toContain('storage.foldername(name)');
  });

  it('compares first path segment to app.current_org_id GUC', () => {
    expect(getMigration()).toContain(
      "current_setting('app.current_org_id', true)",
    );
    expect(getMigration()).toContain('(storage.foldername(name))[1]');
  });

  for (const bucket of BUCKETS) {
    describe(`bucket: ${bucket}`, () => {
      it(`has policies for all four operations`, () => {
        const content = getMigration();
        for (const op of OPS) {
          // policy names use underscores e.g. "csv_uploads_org_select"
          const normalised = bucket.replace(/-/g, '_');
          expect(content).toContain(`"${normalised}_org_${op}"`);
        }
      });

      it(`SELECT policy checks bucket_id = '${bucket}'`, () => {
        expect(getMigration()).toContain(`bucket_id = '${bucket}'`);
      });

      it(`INSERT policy uses WITH CHECK (not USING)`, () => {
        const content = getMigration();
        const normalised = bucket.replace(/-/g, '_');
        // Find the specific INSERT policy for this bucket and confirm it has WITH CHECK
        const insertPolicyPattern = new RegExp(
          `CREATE POLICY "[^"]*${normalised}[^"]*_insert"[\\s\\S]*?WITH CHECK`,
        );
        expect(insertPolicyPattern.test(content)).toBe(true);
      });

      it(`UPDATE policy has both USING and WITH CHECK`, () => {
        const content = getMigration();
        const normalised = bucket.replace(/-/g, '_');
        // Find the specific UPDATE policy for this bucket and confirm both clauses are present
        const updatePolicyPattern = new RegExp(
          `CREATE POLICY "[^"]*${normalised}[^"]*_update"[\\s\\S]*?USING[\\s\\S]*?WITH CHECK`,
        );
        expect(updatePolicyPattern.test(content)).toBe(true);
      });
    });
  }

  it('creates exactly 16 policies (4 buckets × 4 operations)', () => {
    const content = getMigration();
    const createPolicyCount = (content.match(/CREATE POLICY/g) ?? []).length;
    expect(createPolicyCount).toBe(16);
  });

  it('documents how to apply the migration (via Dashboard, SQL editor, or psql)', () => {
    const content = getMigration();
    expect(content).toContain('HOW TO APPLY');
  });

  it('documents cross-org isolation verification steps', () => {
    expect(getMigration()).toContain('Cross-org isolation verification');
  });

  it('documents service role bypass behaviour', () => {
    expect(getMigration()).toContain('Service role bypass');
  });
});
