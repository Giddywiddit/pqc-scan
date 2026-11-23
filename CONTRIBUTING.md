# Contributing

```sh
npm install
npm test            # run all tests
npm run typecheck   # check the TypeScript code for type errors
```

## How the code is organised

- `src/core/`: everything shared by all languages: walking folders, loading and matching rules, the cross-file check, loading tree-sitter parsers, scanning on several threads (`parallel.ts`) and the `--cache` file (`cache.ts`).
- `src/languages/<name>/`: one adapter per language. An adapter does one job: read one file and list its cryptography findings.
- `rules/<name>/`: the rules for that language, one YAML file per library, and a `README.md` describing what is covered.
- `src/output/`: the text and `--json` output. The JSON format is described by `schema/report-v1.schema.json`.

## Adding a library

1. Add `rules/<language>/<library>.yaml`. Rule files are plain text and need no programming: each rule lists function names, and either a fixed algorithm and status or the argument that holds the algorithm and a table of its values. Check every name against the library's own header files or documentation.
2. Add a short example file to `test/fixtures/<language>/` with an `expect:` comment on each line that should produce a finding.
3. Add the library to `rules/<language>/README.md`.

`test/rule-coverage.test.ts` then generates a test for every function and every value in the new file, and the tests fail if the library is missing from the language's README.

## Adding a language

1. Write an adapter in `src/languages/<name>/adapter.ts` that implements `LanguageAdapter` (`src/core/language.ts`), and register it in `src/languages/index.ts`. A tree-sitter grammar is loaded with `createParser('<name>')` from `src/core/tree-sitter.ts`; add the official `tree-sitter-<name>` package, pinned to an exact version.
2. Add `rules/<name>/` with at least one rule file and a `README.md`.
3. Tell `test/rule-coverage.test.ts` how a call is written in the new language (one line in `callIn`, and one in `valueIn` if values are written differently from a quoted string).
4. Add marked example files in `test/fixtures/<name>/`; the fixture test finds the folder on its own.
5. Add a command-line test like the C one in `test/integration.test.ts`.
6. Add one line for the language to the table in the main `README.md`.

The tests fail if a `rules/<name>/` folder has no adapter, an adapter has no rules, or a language has no README.

## How the tests are organised

- `test/fixtures/<folder>/`: short source files. A comment such as `// expect: RSA vulnerable` states what must be reported on that line. A line without one must produce no finding, so both missing and unexpected findings fail.
- `test/rule-coverage.test.ts`: generates a call for every recognised function and algorithm value.
- `test/no-duplicates.test.ts`: one call is never reported twice.
- `test/language-adapter.test.ts`: the shared core works with a made-up language that shares no code with the real adapters.
- `test/unsupported.test.ts`: pins each documented limit, so it cannot change unnoticed.
- `test/report-schema.test.ts`: the `--json` output matches the published schema.
- `test/integration.test.ts`: runs the command-line tool on whole folders, checking exit codes, output and errors.
- `test/docs.test.ts`: every language and rule file is documented.
- `test/parallel.test.ts` and `test/cache.test.ts`: several threads, and results read from the cache, give exactly the result of a plain one-thread scan.

Every fixed bug becomes a permanent test in `test/fixtures/issues/`.

## Commits

Each commit is one complete, tested change with a message in the form `#N short description`.
