import { beforeAll, describe, expect, it } from 'vitest';
import { loadRules } from '../src/core/rules.ts';
import { loadLanguages, rulesByAdapter } from '../src/core/scan.ts';
import { languages } from '../src/languages/index.ts';

const groups = loadRules().filter((group) => group.rules.length > 0);
const adapterFor = (language: string) => languages.find((adapter) => adapter.id === language)!;
const rulesFor = rulesByAdapter(loadRules());
beforeAll(() => loadLanguages());

interface Case { name: string; language: string; code: string; expected: { ruleId: string; algorithm: string | null; status: string }[] }

const quote = (text: string) => JSON.stringify(text);
const nested = (path: string, value: string): string => path.split('.').reduceRight((inner, key) => `{ ${key}: ${inner} }`, quote(value));

// Every function and every algorithm value in every rule file is exercised by a synthesized call.
const cases: Case[] = [];
// How a call to `fn` is written in each language. In C and C++, a key with an underscore is a constant
// (EVP_PKEY_RSA, PSA_ALG_SHA_256) and is passed as a bare upper-case name; other keys are strings or numbers.
// C++ rule names are relative to the rule file's namespace; C rules are called from C++ as they are from C. Rust rule
// names are full paths from the crate.
const callIn: Record<string, (module: string, fn: string, args: string[], ruleLanguage: string) => string> = {
  javascript: (module, fn, args) => `import * as m from ${quote(module)};\nm.${fn}(${args.join(', ')});`,
  c: (_module, fn, args) => `void f(void) { ${fn}(${args.join(', ')}); }`,
  cpp: (module, fn, args, ruleLanguage) => `void f() { ${ruleLanguage === 'cpp' ? `${module}::` : ''}${fn}(${args.join(', ')}); }`,
  rust: (_module, fn, args) => `fn f() { ${fn}(${args.join(', ')}); }`,
};
const valueIn: Record<string, (key: string) => string> = {
  javascript: quote,
  c: (key) => (key.includes('_') ? key.toUpperCase() : quote(key)),
  cpp: (key) => (key.includes('_') ? key.toUpperCase() : quote(key)),
  rust: quote,
};
// How a rule's name is used, for languages with name rules: a C++ variable of the type, or a Rust path below the name
// (a crate-root name such as `md5` is always used through something inside it).
const declareIn: Record<string, (module: string, name: string) => string> = {
  cpp: (module, type) => `void f() { ${module}::${type} x; }`,
  rust: (_module, name) => `fn f() { let _ = ${name}::new(); }`,
};
// Each rule is exercised in every language that reads its folder (C rules in C and in C++ files).
for (const group of groups) for (const adapter of languages.filter((item) => [item.id, ...(item.alsoUsesRulesOf ?? [])].includes(group.language))) {
  const language = adapter.id;
  for (const rule of group.rules) {
    for (const name of rule.names ?? []) {
      cases.push({ name: `${language} ${rule.id}: name ${name}`, language, code: declareIn[language](group.module[0], name), expected: [{ ruleId: rule.id, algorithm: rule.algorithm ?? null, status: rule.status ?? 'unresolved' }] });
    }
    for (const fn of rule.functions) {
      const call = (args: string[]) => callIn[language](group.module[0], fn, args, group.language);
      if (rule.ignore) cases.push({ name: `${language} ${rule.id}: ${fn} is ignored`, language, code: call([]), expected: [] });
      else if (rule.algorithm) cases.push({ name: `${language} ${rule.id}: ${fn}`, language, code: call([]), expected: [{ ruleId: rule.id, algorithm: rule.algorithm, status: rule.status! }] });
      else if (!rule.algorithmFrom) cases.push({ name: `${language} ${rule.id}: ${fn}`, language, code: call([]), expected: [{ ruleId: rule.id, algorithm: null, status: 'unresolved' }] });
      else {
        const { arg, property } = rule.algorithmFrom;
        for (const [key, value] of Object.entries(rule.values ?? {})) {
          const args = [...Array(arg).fill('x'), property ? nested(property, key) : valueIn[language](key)];
          cases.push({ name: `${language} ${rule.id}: ${fn}(${key})`, language, code: call(args), expected: [{ ruleId: rule.id, algorithm: value.algorithm, status: value.status }] });
        }
      }
    }
  }
}

describe('rule files', () => {
  it('generates a non-trivial number of cases for every language with rules', () => {
    expect(cases.length).toBeGreaterThan(200);
    for (const language of new Set(groups.map((group) => group.language))) expect(cases.filter((item) => item.language === language).length, language).toBeGreaterThan(50);
  });

  it('keeps rule ids unique across all rule files', () => {
    const ids = groups.flatMap((group) => group.rules.map((rule) => rule.id));
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
  });

  it('lists each function or name under only one rule per module (the first match would hide the rest)', () => {
    for (const group of groups) {
      const functions = group.rules.flatMap((rule) => [...rule.functions, ...(rule.names ?? [])]);
      expect(functions.filter((fn, index) => functions.indexOf(fn) !== index), group.module.join(',')).toEqual([]);
    }
  });

  it('lists each C function in only one rule file (a C call does not name its library, so the first file would win)', () => {
    const functions = groups.filter((group) => group.language === 'c').flatMap((group) => group.rules.flatMap((rule) => rule.functions));
    expect(functions.filter((fn, index) => functions.indexOf(fn) !== index)).toEqual([]);
  });

  it('gives every unresolved or needs-review value an explanatory note', () => {
    const missing = groups.flatMap((group) => group.rules.flatMap((rule) => Object.entries(rule.values ?? {})
      .filter(([, value]) => (value.status === 'unresolved' || value.status === 'needs-review') && !value.note).map(([key]) => `${rule.id}:${key}`)));
    expect(missing).toEqual([]);
  });

  it.each(cases.map((item) => [item.name, item] as const))('%s', (_name, item) => {
    const rules = rulesFor.get(adapterFor(item.language))!;
    const findings = adapterFor(item.language).scanSource(item.code, 'f', rules).map(({ ruleId, algorithm, status }) => ({ ruleId, algorithm, status }));
    expect(findings).toEqual(item.expected);
  });
});
