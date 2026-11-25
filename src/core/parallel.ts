import { readFileSync, statSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { ResultCache } from './cache.ts';
import { DEFAULT_MAX_FILE_BYTES, finishScan, planScan, rulesByAdapter, scanFile, tooLargeFinding, wrapperCallerFiles } from './scan.ts';
import type { CallSite } from './wrappers.ts';
import type { Finding, ModuleRules } from './types.ts';
import { languages } from '../languages/index.ts';

export interface ParallelOptions {
  /** Most threads to use. Defaults to the number of CPU cores. */
  threads?: number;
  /** One extra thread per this many bytes of source, since each thread costs about half a second to start. */
  bytesPerThread?: number;
  /** Reuse the findings of files unchanged since the last run, and record the new ones. */
  cache?: ResultCache;
  /** Files larger than this are reported as not scanned instead of being read. */
  maxFileBytes?: number;
}

/** A job sent to a worker: scan a file, or list its calls (for following wrappers, see wrappers.ts). */
export interface Job { kind: 'scan' | 'calls'; index: number; path: string; name: string; language: string; maxBytes: number }
export type Reply = { index: number; findings: Finding[] } | { index: number; sites: CallSite[] } | { index: number; error: string };

/**
 * Same result as `scan` for the registered languages, with the files parsed on several threads when there is enough
 * code to repay starting them. Results are put back in the same order, so the output is identical to `scan`.
 */
export async function scanInParallel(target: string, rules: ModuleRules[], options: ParallelOptions = {}): Promise<Finding[]> {
  const { root, files, unreadable } = planScan(target, languages);
  const findings: Finding[][] = new Array(files.length);
  const { cache } = options;
  const maxBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const sizes = files.map((file) => statSync(file.path).size);
  // A file over the limit is never read, not even to look it up in the cache.
  const keys = cache ? files.map((file, index) => (sizes[index] > maxBytes ? '' : ResultCache.key(file.name, readFileSync(file.path, 'utf8')))) : [];
  const pending: number[] = [];
  files.forEach((file, index) => {
    const cached = keys[index] ? cache?.get(keys[index]) : undefined;
    if (sizes[index] > maxBytes) findings[index] = [tooLargeFinding(file.name, sizes[index], maxBytes)];
    else if (cached) findings[index] = cached;
    else pending.push(index);
  });
  const total = pending.reduce((sum, index) => sum + sizes[index], 0);
  const threads = Math.min(options.threads ?? availableParallelism(), pending.length, Math.floor(total / (options.bytesPerThread ?? 8_000_000)));
  if (threads < 2) {
    const rulesFor = rulesByAdapter(rules, languages);
    for (const index of pending) findings[index] = scanFile(files[index], rulesFor, maxBytes);
    if (cache) for (const index of pending) cache.set(keys[index], findings[index]);
    return finishScan(root, files, findings, rules, undefined, unreadable);
  }
  const pool = new Pool(threads, rules);
  try {
    await pool.run(pending, sizes, (index) => ({ kind: 'scan', index, path: files[index].path, name: files[index].name, language: files[index].adapter.id, maxBytes }),
      (reply) => { if ('findings' in reply) findings[reply.index] = reply.findings; });
    if (cache) for (const index of pending) cache.set(keys[index], findings[index]);
    // The files the first round of following wrappers will read are parsed on the threads too.
    const sites = new Map<string, CallSite[]>();
    await pool.run(wrapperCallerFiles(files, findings, rules), sizes, (index) => ({ kind: 'calls', index, path: files[index].path, name: files[index].name, language: files[index].adapter.id, maxBytes }),
      (reply) => { if ('sites' in reply) sites.set(files[reply.index].path, reply.sites); });
    return finishScan(root, files, findings, rules, sites, unreadable);
  } finally {
    await pool.close();
  }
}

/** Worker threads that each load the parsers once and then take jobs, largest file first, as they finish. */
class Pool {
  private readonly workers: Worker[];

  constructor(threads: number, rules: ModuleRules[]) {
    // `.ts` when run from source, `.js` once built.
    const worker = new URL(import.meta.url.endsWith('.ts') ? './scan-worker.ts' : './scan-worker.js', import.meta.url);
    this.workers = Array.from({ length: threads }, () => new Worker(worker, { workerData: { rules } }));
  }

  /** Runs one job per index on the threads, largest file first, so no thread is left with a long tail. */
  async run(indexes: number[], sizes: number[], job: (index: number) => Job, onReply: (reply: Reply) => void): Promise<void> {
    const queue = [...indexes].sort((left, right) => sizes[right] - sizes[left]);
    await Promise.all(this.workers.map((worker) => new Promise<void>((resolve, reject) => {
      const next = (): void => {
        const index = queue.shift();
        if (index === undefined) {
          worker.off('message', receive);
          worker.off('error', reject);
          return resolve();
        }
        worker.postMessage(job(index));
      };
      const receive = (reply: Reply): void => {
        if ('error' in reply) return reject(new Error(reply.error));
        onReply(reply);
        next();
      };
      worker.on('message', receive);
      worker.on('error', reject);
      next();
    })));
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.terminate()));
  }
}
