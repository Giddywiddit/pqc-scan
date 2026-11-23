import { readFileSync, statSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { ResultCache } from './cache.ts';
import { finishScan, planScan, rulesByAdapter, scanFile } from './scan.ts';
import type { PlannedFile } from './scan.ts';
import type { Finding, ModuleRules } from './types.ts';
import { languages } from '../languages/index.ts';

export interface ParallelOptions {
  /** Most threads to use. Defaults to the number of CPU cores. */
  threads?: number;
  /** One extra thread per this many bytes of source, since each thread costs about half a second to start. */
  bytesPerThread?: number;
  /** Reuse the findings of files unchanged since the last run, and record the new ones. */
  cache?: ResultCache;
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
  const findings: Finding[][] = new Array(files.length);
  const { cache } = options;
  const keys = cache ? files.map((file) => ResultCache.key(file.name, readFileSync(file.path, 'utf8'))) : [];
  const pending: number[] = [];
  files.forEach((_, index) => {
    const cached = cache?.get(keys[index]);
    if (cached) findings[index] = cached;
    else pending.push(index);
  });
  const sizes = files.map((file) => statSync(file.path).size);
  const total = pending.reduce((sum, index) => sum + sizes[index], 0);
  const threads = Math.min(options.threads ?? availableParallelism(), pending.length, Math.floor(total / (options.bytesPerThread ?? 8_000_000)));
  if (threads < 2) {
    const rulesFor = rulesByAdapter(rules, languages);
    for (const index of pending) findings[index] = scanFile(files[index], rulesFor);
  } else {
    await scanOnThreads(files, pending, sizes, rules, threads, findings);
  }
  if (cache) for (const index of pending) cache.set(keys[index], findings[index]);
  return finishScan(root, files, findings);
}

/** Scans the `pending` files on `threads` worker threads, writing each file's findings into `findings`. */
async function scanOnThreads(files: PlannedFile[], pending: number[], sizes: number[], rules: ModuleRules[], threads: number, findings: Finding[][]): Promise<void> {
  // Largest files first, handed out one at a time as threads finish, so no thread is left with a long tail.
  const queue = [...pending].sort((left, right) => sizes[right] - sizes[left]);
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
}
