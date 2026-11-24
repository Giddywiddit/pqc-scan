# Using pqc-scan in GitHub Actions

The action runs `pqc-scan` on your repository and uploads the findings that need action to GitHub code scanning,
where they appear under **Security → Code scanning** and on pull requests.

```yaml
name: pqc-scan
on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read
  security-events: write   # to upload the findings to code scanning

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: Giddywiddit/pqc-scan@v0.1.0
```

The action runs the version of pqc-scan that matches its tag (`@v0.1.0` runs pqc-scan 0.1.0 from npm). It installs
Node.js 24 for the job.

## Options

| Input | Default | What it does |
|---|---|---|
| `path` | `.` | The folder or file to scan. |
| `sarif` | `pqc-scan.sarif` | Where to write the SARIF file. Empty to write none. |
| `upload-sarif` | `true` | Upload the SARIF file to code scanning. Needs `security-events: write`. |
| `cbom` | empty | Where to write the CycloneDX 1.7 cryptography bill of materials. |
| `baseline` | empty | A file written with `pqc-scan --write-baseline`: the findings it lists do not fail the step. |
| `fail-on-findings` | `true` | Fail the step when there is a new ❌, 🔍 or ⚠️ finding. |
| `args` | empty | More options, such as `--max-file-size 50`. |
| `package` | the action's version | The npm package to run, such as `pqc-scan@0.1.0`. |

The output `exit-code` is 0 when nothing needs action, 1 when something does, and 2 when the scan could not run.

## Starting with a baseline

On a project that already uses RSA or elliptic curves, the first scan finds many things at once. To fail only on new
ones, record the current findings once, commit the file, and pass it to the action:

```sh
npx pqc-scan . --write-baseline pqc-scan-baseline.json
```

```yaml
      - uses: Giddywiddit/pqc-scan@v0.1.0
        with:
          baseline: pqc-scan-baseline.json
```

The findings in the baseline are still uploaded to code scanning; only new ones fail the step.
