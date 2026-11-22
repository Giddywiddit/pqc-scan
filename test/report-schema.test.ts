import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv } from 'ajv';
import { describe, expect, it } from 'vitest';
import { CATEGORIES, STATUSES } from '../src/core/types.ts';
import { SCHEMA_VERSION } from '../src/output/json.ts';

const root = new URL('..', import.meta.url).pathname;
const schema = JSON.parse(readFileSync(join(root, 'schema/report-v1.schema.json'), 'utf8'));
const validate = new Ajv({ allErrors: true }).compile(schema);
const report = (fixture: string) => JSON.parse(spawnSync('npx', ['tsx', 'src/cli.ts', join(root, 'test/fixtures', fixture), '--json'], { cwd: root, encoding: 'utf8' }).stdout);

describe('--json report matches the published schema', () => {
  it.each(['mixed', 'wrapper', 'empty', 'resolve'])('real output for the %s fixture is valid', (fixture) => {
    const output = report(fixture);
    expect(validate(output), JSON.stringify(validate.errors)).toBe(true);
  });

  it('counts in the summary add up to the findings', () => {
    const output = report('mixed');
    expect(output.summary.total).toBe(output.findings.length);
    for (const status of STATUSES) expect(output.summary[status]).toBe(output.findings.filter((item: { status: string }) => item.status === status).length);
  });

  it('is stamped with the schema version and the package version', () => {
    const output = report('empty');
    expect(output.schemaVersion).toBe(SCHEMA_VERSION);
    expect(output.tool.version).toBe(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version);
  });
});

describe('the schema cannot drift from the code', () => {
  it('lists exactly the statuses and categories the code defines', () => {
    expect(schema.definitions.finding.properties.status.enum).toEqual([...STATUSES]);
    expect(schema.definitions.finding.properties.category.enum).toEqual([...CATEGORIES]);
    expect(Object.keys(schema.properties.summary.properties).filter((key) => key !== 'total').sort()).toEqual([...STATUSES].sort());
    expect(schema.properties.schemaVersion.const).toBe(SCHEMA_VERSION);
  });

  it('rejects reports that break the contract', () => {
    const good = report('mixed');
    const broken = (change: (copy: any) => void) => { const copy = structuredClone(good); change(copy); return validate(copy); };
    expect(broken((copy) => { copy.findings[0].status = 'safe'; })).toBe(false);
    expect(broken((copy) => { delete copy.schemaVersion; })).toBe(false);
    expect(broken((copy) => { copy.findings[0].extra = 1; })).toBe(false);
    expect(broken((copy) => { copy.findings[0].line = 0; })).toBe(false);
    expect(broken((copy) => { copy.summary.total = -1; })).toBe(false);
  });
});
