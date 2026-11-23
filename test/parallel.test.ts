import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { scanInParallel } from '../src/core/parallel.ts';
import { loadRules } from '../src/core/rules.ts';
import { loadLanguages, scan } from '../src/core/scan.ts';

const rules = loadRules();
const fixture = (name: string) => join(new URL('.', import.meta.url).pathname, 'fixtures', name);
beforeAll(() => loadLanguages());

// Threads change only how fast a scan runs: the findings and their order must be exactly those of a one-thread scan.
describe('scanning on several threads', () => {
  it.each(['c', 'resolve', 'issues', 'wrapper', 'mixed'])('gives the same result as one thread for %s', async (name) => {
    const serial = scan(fixture(name), rules);
    expect(serial.length).toBeGreaterThan(0);
    expect(await scanInParallel(fixture(name), rules, { threads: 3, bytesPerThread: 1 })).toEqual(serial);
  });

  it('uses one thread when there is too little code to repay starting more', async () => {
    expect(await scanInParallel(fixture('c'), rules)).toEqual(scan(fixture('c'), rules));
  });
});
