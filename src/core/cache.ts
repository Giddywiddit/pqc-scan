import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Finding } from './types.ts';

interface Stored { version: string; files: Record<string, Finding[]> }
/** The file on disk: the stored results as JSON text, and, when a key is set, an HMAC-SHA256 of that exact text. */
interface Saved { body: string; mac?: string }

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
/** The scanner's own code: `src` when working on it, `dist` in the published package. */
const codeFolder = fileURLToPath(new URL('../', import.meta.url)).slice(projectRoot.length).replace(/[\\/]$/, '');

const require = createRequire(import.meta.url);

/**
 * A fingerprint of everything that decides what a scan finds: the scanner's own code, its rules, the grammars and the
 * exact versions of the packages it reads code with. When any of them changes, every cached result is thrown away.
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
  add(codeFolder);
  add('rules');
  if (existsSync(join(projectRoot, 'grammars'))) add('grammars');
  hash.update(readFileSync(join(projectRoot, 'package.json')));
  for (const name of ['typescript', 'web-tree-sitter', 'yaml', 'tree-sitter-c', 'tree-sitter-cpp', 'tree-sitter-rust', 'tree-sitter-go']) {
    try {
      hash.update(`${name}@${(JSON.parse(readFileSync(require.resolve(`${name}/package.json`), 'utf8')) as { version: string }).version}`);
    } catch {
      // The grammar packages are not installed with the published package, which carries their files in grammars/.
    }
  }
  return hash.digest('hex');
}

/**
 * Per-file findings saved between runs, keyed by a SHA-256 fingerprint of the file's name and contents. Only the
 * files of the latest scan are kept, so the cache does not grow without limit.
 *
 * Whoever can write the cache file can change what a scan reports, so a cache is only as trustworthy as the place it
 * is kept. With a key, the cache is signed (HMAC-SHA256) and a cache that was changed, or signed with another key, is
 * thrown away: then only someone who has the key can write a cache this scanner will use.
 */
export class ResultCache {
  private readonly version = toolVersion();
  private readonly path: string;
  private readonly key: string | undefined;
  private readonly previous: Record<string, Finding[]>;
  private readonly current: Record<string, Finding[]> = {};
  /** Why an existing cache file was not used, if it was not. */
  readonly warning: string | undefined;

  constructor(path: string, key?: string) {
    this.path = path;
    this.key = key || undefined;
    let stored: Stored | undefined;
    let warning: string | undefined;
    try {
      const saved = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Saved) : undefined;
      if (saved && this.key && (typeof saved.mac !== 'string' || !this.signatureMatches(saved.body, saved.mac))) {
        warning = `the cache ${path} is not signed with this PQC_SCAN_CACHE_KEY, so it was not used.`;
      } else if (saved) {
        stored = JSON.parse(saved.body);
      }
    } catch {
      stored = undefined; // An unreadable cache is ignored and rewritten.
    }
    this.warning = warning;
    this.previous = stored?.version === this.version ? stored.files : {};
  }

  private sign(body: string): string {
    return createHmac('sha256', this.key!).update(body).digest('hex');
  }

  private signatureMatches(body: unknown, mac: string): boolean {
    if (typeof body !== 'string') return false;
    const expected = Buffer.from(this.sign(body), 'hex');
    const given = Buffer.from(mac, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
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
    const body = JSON.stringify({ version: this.version, files: this.current } satisfies Stored);
    writeFileSync(temporary, JSON.stringify({ body, ...(this.key ? { mac: this.sign(body) } : {}) } satisfies Saved));
    renameSync(temporary, this.path);
  }
}
