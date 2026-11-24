# Schemas used by the tests

- `sarif-schema-2.1.0.json`: the SARIF 2.1.0 JSON Schema (errata 01), © OASIS Open, unchanged, from
  https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json. `test/sarif.test.ts`
  checks the `--sarif` output against it.
- `bom-1.7.schema.json`, `spdx.schema.json`, `jsf-0.82.schema.json` and `cryptography-defs.schema.json`: the CycloneDX
  1.7 JSON Schemas (Apache License 2.0), unchanged, from https://github.com/CycloneDX/specification/tree/1.7.2/schema.
  `test/cbom.test.ts` checks the `--cbom` output against them.
