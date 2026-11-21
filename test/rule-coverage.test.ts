import { describe, expect, it } from 'vitest';
import { loadRules } from '../src/rules.ts';
import { scanSource } from '../src/scanner.ts';

const groups = loadRules().filter((group) => group.rules.length > 0);

interface Case { name: string; code: string; expected: { ruleId: string; algorithm: string | null; status: string }[] }

const quote = (text: string) => JSON.stringify(text);
const nested = (path: string, value: string): string => path.split('.').reduceRight((inner, key) => `{ ${key}: ${inner} }`, quote(value));

// Every function and every algorithm value in every rule file is exercised by a synthesized call.
const cases: Case[] = [];
for (const group of groups) {
  const header = `import * as m from ${quote(group.module[0])};\n`;
  for (const rule of group.rules) {
    for (const fn of rule.functions) {
      const call = (args: string[]) => `${header}m.${fn}(${args.join(', ')});`;
      if (rule.ignore) cases.push({ name: `${rule.id}: ${fn} is ignored`, code: call([]), expected: [] });
      else if (rule.algorithm) cases.push({ name: `${rule.id}: ${fn}`, code: call([]), expected: [{ ruleId: rule.id, algorithm: rule.algorithm, status: rule.status! }] });
      else if (!rule.algorithmFrom) cases.push({ name: `${rule.id}: ${fn}`, code: call([]), expected: [{ ruleId: rule.id, algorithm: null, status: 'unresolved' }] });
      else {
        const { arg, property } = rule.algorithmFrom;
        for (const [key, value] of Object.entries(rule.values ?? {})) {
          const args = [...Array(arg).fill('x'), property ? nested(property, key) : quote(key)];
          cases.push({ name: `${rule.id}: ${fn}(${key})`, code: call(args), expected: [{ ruleId: rule.id, algorithm: value.algorithm, status: value.status }] });
        }
      }
    }
  }
}

describe('rule files', () => {
  it('generates a non-trivial number of cases', () => expect(cases.length).toBeGreaterThan(200));

  it('keeps rule ids unique across all rule files', () => {
    const ids = groups.flatMap((group) => group.rules.map((rule) => rule.id));
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
  });

  it('lists each function under only one rule per module (the first match would hide the rest)', () => {
    for (const group of groups) {
      const functions = group.rules.flatMap((rule) => rule.functions);
      expect(functions.filter((fn, index) => functions.indexOf(fn) !== index), group.module.join(',')).toEqual([]);
    }
  });

  it('gives every unresolved or needs-review value an explanatory note', () => {
    const missing = groups.flatMap((group) => group.rules.flatMap((rule) => Object.entries(rule.values ?? {})
      .filter(([, value]) => (value.status === 'unresolved' || value.status === 'needs-review') && !value.note).map(([key]) => `${rule.id}:${key}`)));
    expect(missing).toEqual([]);
  });

  it.each(cases.map((item) => [item.name, item] as const))('%s', (_name, item) => {
    const findings = scanSource(item.code, 'f.ts', loadRules()).map(({ ruleId, algorithm, status }) => ({ ruleId, algorithm, status }));
    expect(findings).toEqual(item.expected);
  });
});
