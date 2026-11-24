# Python rules

Python rules match imported module paths and qualified call paths. An adapter only reports a call when the import can be resolved to a rule module. Dynamic values remain unresolved.

The initial rules cover the `cryptography` package and PyJWT. Add a fixture under `test/fixtures/python/` for every new rule and for ambiguous or unsupported forms.

Current limits are explicit: Python calls are resolved within one file only. Cross-file wrappers, dynamic imports, wildcard imports, and values selected through runtime state remain unresolved or unreported. Add a rule and fixture before claiming support for another library.

Rule files:

- `cryptography.yaml`
- `pyjwt.yaml`
