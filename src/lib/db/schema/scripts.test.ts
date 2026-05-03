import { describe, expect, it } from 'vitest';

import { scriptTemplates } from './script_templates';
import { scripts } from './scripts';

type Col = Record<string, unknown>;
type Tbl = Record<string, Col>;

describe('script_templates schema', () => {
  it('has expected columns', () => {
    const cols = Object.keys(scriptTemplates);
    expect(cols).toContain('id');
    expect(cols).toContain('slug');
    expect(cols).toContain('name');
    expect(cols).toContain('version');
    expect(cols).toContain('system_prompt');
    expect(cols).toContain('variable_schema');
    expect(cols).toContain('default_voice_id');
    expect(cols).toContain('default_language');
    expect(cols).toContain('published_at');
    expect(cols).toContain('created_at');
  });

  it('defaults default_language to it-IT', () => {
    const col = (scriptTemplates as Tbl).default_language;
    expect(col.default).toBe('it-IT');
  });

  it('defaults version to 1', () => {
    const col = (scriptTemplates as Tbl).version;
    expect(col.default).toBe(1);
  });
});

describe('scripts schema', () => {
  it('has expected columns', () => {
    const cols = Object.keys(scripts);
    expect(cols).toContain('id');
    expect(cols).toContain('org_id');
    expect(cols).toContain('template_id');
    expect(cols).toContain('name');
    expect(cols).toContain('variables');
    expect(cols).toContain('voice_id');
    expect(cols).toContain('created_at');
    expect(cols).toContain('updated_at');
  });

  it('voice_id is nullable (override column)', () => {
    const col = (scripts as Tbl).voice_id;
    expect(col.notNull).toBeFalsy();
  });
});
