# Python rules

Python rules match imported module paths and qualified call paths. An adapter only reports a call when the import can be resolved to a rule module. Dynamic values remain unresolved.

The initial rules cover the `cryptography` package and PyJWT. Add a fixture under `test/fixtures/python/` for every new rule and for ambiguous or unsupported forms.

Rule files:

- `cryptography.yaml`
- `pyjwt.yaml`
