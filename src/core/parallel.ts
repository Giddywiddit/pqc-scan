import { statSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { finishScan, planScan, rulesByAdapter, scanFile } from './scan.ts';
import type { Finding, ModuleRules } from './types.ts';
import { languages } from '../languages/index.ts';

export interface ParallelOptions {
  /** Most threads to use. Defaults to the number of CPU cores. */
  threads?: number;
  /** One extra thread per this many bytes of source, since each thread costs about half a second to start. */
  bytesPerThread?: number;
}

/** A job sent to a worker, and what it sends back. */
export interface Job { index: number; path: string; name: string; language: string }
export type Reply = { index: number; findings: Finding[] } | { index: number; error: string };

/**
 * Same result as `scan` for the registered languages, with the files parsed on several threads when there is enough
 * code to repay starting them. Results are put back in the same order, so the output is identical to `scan`.
 */
export async function scanInParallel(target: string, rules: ModuleRules[], options: ParallelOptions = {}): Promise<Finding[]> {
  const { root, files } = planScan(target, languages);
  const sizes = files.map((file) => statSync(file.path).size);
  const total = sizes.reduce((sum, size) => sum + size, 0);
  const threads = Math.min(options.threads ?? availableParallelism(), files.length, Math.floor(total / (options.bytesPerThread ?? 8_000_000)));
  if (threads < 2) {
    const rulesFor = rulesByAdapter(rules, languages);
    return finishScan(root, files, files.map((file) => scanFile(file, rulesFor)));
  }

  // Largest files first, handed out one at a time as threads finish, so no thread is left with a long tail.
  const queue = files.map((_, index) => index).sort((left, right) => sizes[right] - sizes[left]);
  const findings: Finding[][] = new Array(files.length);
  const workers = Array.from({ length: threads }, () => new Worker(new URL('./scan-worker.ts', import.meta.url), { workerData: { rules } }));
  try {
    await Promise.all(workers.map((worker) => new Promise<void>((resolve, reject) => {
      const next = (): void => {
        const index = queue.shift();
        if (index === undefined) return resolve();
        const { path, name, adapter } = files[index];
        worker.postMessage({ index, path, name, language: adapter.id } satisfies Job);
      };
      worker.on('message', (reply: Reply) => {
        if ('error' in reply) return reject(new Error(reply.error));
        findings[reply.index] = reply.findings;
        next();
      });
      worker.on('error', reject);
      next();
    })));
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
  }
  return finishScan(root, files, findings);
}
