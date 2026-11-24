// Copies the four tree-sitter grammars (.wasm files, with their MIT licences) into grammars/, for the published
// package: users then do not install the grammar packages, or run their install scripts.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const out = fileURLToPath(new URL('../grammars/', import.meta.url));
mkdirSync(out, { recursive: true });
for (const grammar of ['c', 'cpp', 'rust', 'go']) {
  const folder = dirname(require.resolve(`tree-sitter-${grammar}/package.json`));
  copyFileSync(join(folder, `tree-sitter-${grammar}.wasm`), join(out, `tree-sitter-${grammar}.wasm`));
  copyFileSync(join(folder, 'LICENSE'), join(out, `LICENSE-tree-sitter-${grammar}`));
}
