// One thread of `scanInParallel`: loads the parsers once, then scans each file it is sent.
import { parentPort, workerData } from 'node:worker_threads';
import type { Job, Reply } from './parallel.ts';
import { loadLanguages, rulesByAdapter, scanFile } from './scan.ts';
import type { ModuleRules } from './types.ts';
import { languages } from '../languages/index.ts';

const port = parentPort!;
const ready = loadLanguages();
const rulesFor = rulesByAdapter((workerData as { rules: ModuleRules[] }).rules, languages);

port.on('message', async ({ index, path, name, language }: Job) => {
  await ready;
  try {
    const adapter = languages.find((candidate) => candidate.id === language)!;
    port.postMessage({ index, findings: scanFile({ path, name, adapter }, rulesFor) } satisfies Reply);
  } catch (error) {
    port.postMessage({ index, error: error instanceof Error ? error.message : String(error) } satisfies Reply);
  }
});
