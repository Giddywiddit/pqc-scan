import { accessSync, constants, existsSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const skipped = new Set(['.git', 'dist', 'node_modules']);

const readable = (path: string): boolean => {
  try {
    accessSync(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * Source files under `target` (a file or a folder) whose extension is in `extensions`. A source file or folder that
 * cannot be read is added to `unreadable` instead, so the scan can report it rather than stop.
 */
export function sourceFiles(target: string, extensions: ReadonlySet<string>, unreadable: string[] = []): string[] {
  if (!statSync(target).isDirectory()) {
    if (!extensions.has(extname(target))) return [];
    if (readable(target)) return [target];
    unreadable.push(target);
    return [];
  }
  const found: string[] = [];
  const walk = (directory: string): void => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      unreadable.push(directory);
      return;
    }
    for (const entry of entries) {
      if (skipped.has(entry.name)) continue;
      // Cargo's build output (generated code and copies of packaged crates), and Go's copies of dependencies made by
      // `go mod vendor`: not the project's own source, as node_modules is not.
      if (entry.name === 'target' && existsSync(join(directory, 'Cargo.toml'))) continue;
      if (entry.name === 'vendor' && existsSync(join(directory, 'go.mod'))) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && extensions.has(extname(entry.name))) (readable(path) ? found : unreadable).push(path);
    }
  };
  walk(target);
  return found;
}
