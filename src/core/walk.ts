import { existsSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const skipped = new Set(['.git', 'dist', 'node_modules']);

/** Source files under `target` (a file or a folder) whose extension is in `extensions`. */
export function sourceFiles(target: string, extensions: ReadonlySet<string>): string[] {
  if (!statSync(target).isDirectory()) return extensions.has(extname(target)) ? [target] : [];
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (skipped.has(entry.name)) continue;
      // Cargo's build output (generated code and copies of packaged crates), and Go's copies of dependencies made by
      // `go mod vendor`: not the project's own source, as node_modules is not.
      if (entry.name === 'target' && existsSync(join(directory, 'Cargo.toml'))) continue;
      if (entry.name === 'vendor' && existsSync(join(directory, 'go.mod'))) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && extensions.has(extname(entry.name))) found.push(path);
    }
  };
  walk(target);
  return found;
}
