import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Finding } from './types.ts';

interface Stored { version: string; files: Record<string, Finding[]> }

const projectRoot = new URL('../../', import.meta.url).pathname;

/**
 * A fingerprint of everything that decides what a scan finds: the scanner's own code, its rules and the exact
 * dependency versions. When any of them changes, every cached result is thrown away.
 */
function toolVersion(): string {
  const hash = createHash('sha256');
  const add = (directory: string): void => {
    for (const entry of readdirSync(join(projectRoot, directory), { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) add(path);
      else hash.update(path).update(readFileSync(join(projectRoot, path)));
    }
  };
  add('src');
  add('rules');
  hash.update(readFileSync(join(projectRoot, 'package-lock.json')));
  return hash.digest('hex');
}

/**
 * Per-file findings saved between runs, keyed by a SHA-256 fingerprint of the file's name and contents. Only the
 * files of the latest scan are kept, so the cache does not grow without limit.
 */
export class ResultCache {
  private readonly version = toolVersion();
  private readonly previous: Record<string, Finding[]>;
  private readonly current: Record<string, Finding[]> = {};

  constructor(private readonly path: string) {
    let stored: Stored | undefined;
    try {
      stored = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
    } catch {
      stored = undefined; // An unreadable cache is ignored and rewritten.
    }
    this.previous = stored?.version === this.version ? stored.files : {};
  }

  static key(name: string, text: string): string {
    return createHash('sha256').update(name).update('\0').update(text).digest('hex');
  }

  get(key: string): Finding[] | undefined {
    const found = Object.hasOwn(this.previous, key) ? this.previous[key] : undefined;
    if (found) this.current[key] = found;
    return found;
  }

  set(key: string, findings: Finding[]): void {
    this.current[key] = findings;
  }

  /** Writes to a temporary file first, so an interrupted run never leaves a half-written cache. */
  save(): void {
    const temporary = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify({ version: this.version, files: this.current } satisfies Stored));
    renameSync(temporary, this.path);
  }
}
