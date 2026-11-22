import { createRequire } from 'node:module';
import { Language, Parser } from 'web-tree-sitter';

// Each grammar comes from its official `tree-sitter-<language>` package, which ships a ready-built `.wasm` file. Only
// that file is used: the packages' native Node bindings (and their install scripts) are not needed. Versions are pinned
// exactly in package.json so a grammar update cannot silently change what the scanner finds.
const require = createRequire(import.meta.url);
let initialised: Promise<void> | undefined;

/** Loads one tree-sitter grammar (`c`, `cpp`, `go`, ...) and returns a parser for it. */
export async function createParser(grammar: string): Promise<Parser> {
  initialised ??= Parser.init();
  await initialised;
  const parser = new Parser();
  parser.setLanguage(await Language.load(require.resolve(`tree-sitter-${grammar}/tree-sitter-${grammar}.wasm`)));
  return parser;
}
