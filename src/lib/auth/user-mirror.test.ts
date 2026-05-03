/**
 * Validates the user mirror trigger migration (0010_user_mirror_trigger.sql).
 *
 * The trigger lives on auth.users (Supabase-managed schema) and cannot be
 * exercised in the plain-PostgreSQL test Docker container. These tests verify
 * that the migration file:
 *   - exists and is registered in the Drizzle journal
 *   - contains the expected PL/pgSQL function and trigger DDL
 *   - inserts the correct columns with the correct defaults
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const MIGRATION_DIR = path.resolve(process.cwd(), 'drizzle/migrations');
const MIGRATION_FILE = path.join(MIGRATION_DIR, '0010_user_mirror_trigger.sql');
const JOURNAL_FILE = path.join(MIGRATION_DIR, 'meta/_journal.json');

describe('user mirror trigger migration', () => {
  it('migration file exists', () => {
    expect(fs.existsSync(MIGRATION_FILE)).toBe(true);
  });

  it('migration is registered in the Drizzle journal', () => {
    const journal = JSON.parse(fs.readFileSync(JOURNAL_FILE, 'utf-8')) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    const entry = journal.entries.find((e) => e.tag === '0010_user_mirror_trigger');
    expect(entry).toBeDefined();
    expect(entry?.idx).toBe(10);
  });

  it('defines handle_new_auth_user() function', () => {
    const sql = fs.readFileSync(MIGRATION_FILE, 'utf-8');
    expect(sql).toContain('handle_new_auth_user');
    expect(sql).toContain('RETURNS TRIGGER');
    expect(sql).toContain('LANGUAGE plpgsql');
  });

  it('trigger fires AFTER INSERT ON auth.users', () => {
    const sql = fs.readFileSync(MIGRATION_FILE, 'utf-8');
    expect(sql).toContain('AFTER INSERT ON auth.users');
    expect(sql).toContain('FOR EACH ROW');
  });

  it('inserts into public.users with id, email, full_name from metadata, and locale it', () => {
    const sql = fs.readFileSync(MIGRATION_FILE, 'utf-8');
    expect(sql).toContain('INSERT INTO public.users');
    expect(sql).toContain('NEW.id');
    expect(sql).toContain('NEW.email');
    expect(sql).toContain("raw_user_meta_data ->> 'full_name'");
    expect(sql).toContain("'it'");
  });

  it('uses ON CONFLICT DO NOTHING for idempotency', () => {
    const sql = fs.readFileSync(MIGRATION_FILE, 'utf-8');
    expect(sql).toContain('ON CONFLICT');
    expect(sql).toContain('DO NOTHING');
  });

  it('trigger uses SECURITY DEFINER to run with elevated privileges', () => {
    const sql = fs.readFileSync(MIGRATION_FILE, 'utf-8');
    expect(sql).toContain('SECURITY DEFINER');
  });
});
