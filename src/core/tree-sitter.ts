import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Language, Parser } from 'web-tree-sitter';

// Each grammar comes from its official `tree-sitter-<language>` package, which ships a ready-built `.wasm` file. Only
// that file is used: the packages' native Node bindings (and their install scripts) are not needed. Versions are pinned
// exactly in package.json so a grammar update cannot silently change what the scanner finds. The published package
// carries the `.wasm` files themselves in `grammars/` (copied by scripts/copy-grammars.mjs), so users do not install the
// grammar packages at all; when working on the scanner, they are read from node_modules.
const require = createRequire(import.meta.url);
const bundled = (grammar: string) => fileURLToPath(new URL(`../../grammars/tree-sitter-${grammar}.wasm`, import.meta.url));
let initialised: Promise<void> | undefined;

/** Loads one tree-sitter grammar (`c`, `cpp`, `go`, ...) and returns a parser for it. */
export async function createParser(grammar: string): Promise<Parser> {
  initialised ??= Parser.init();
  await initialised;
  const parser = new Parser();
  const file = existsSync(bundled(grammar)) ? bundled(grammar) : require.resolve(`tree-sitter-${grammar}/tree-sitter-${grammar}.wasm`);
  parser.setLanguage(await Language.load(file));
  return parser;
}
