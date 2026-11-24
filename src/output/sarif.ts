import { readFileSync } from 'node:fs';
import type { Finding, Status } from '../core/types.ts';

// SARIF 2.1.0 (OASIS), the format GitHub code scanning reads. Only findings that need action are included: a ✅
// finding is part of the inventory (see --json and --cbom), not an alert.

const version = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version;

interface RuleText { name: string; short: string; full: string; help: string; level: 'error' | 'warning'; severity: string }

/** One SARIF rule per status, so alert titles and help stay the same whichever library a finding comes from. */
const RULES: Record<Exclude<Status, 'observed-resistant'>, RuleText> = {
  vulnerable: {
    name: 'QuantumVulnerableCryptography',
    short: 'Cryptography a quantum computer could break',
    full: "RSA, DSA, elliptic-curve methods (such as ECDSA, Ed25519, ECDH and X25519) or Diffie-Hellman. Shor's algorithm, run on a large enough quantum computer, breaks these.",
    help: 'Plan to replace it with a NIST post-quantum method: ML-KEM (FIPS 203) for agreeing on keys, ML-DSA (FIPS 204) or SLH-DSA (FIPS 205) for signatures, or a hybrid of a classical and a post-quantum method. NIST IR 8547 deprecates these classical methods after 2030 and disallows them after 2035.',
    level: 'error',
    severity: '6.0',
  },
  'needs-review': {
    name: 'CryptographyNeedsReview',
    short: 'Cryptography that is acceptable only by judgement',
    full: 'The algorithm is known exactly, but whether it is acceptable is a policy decision: for example 128-bit AES, SHA-224, or MD5 and SHA-1, which are weak even against ordinary computers.',
    help: 'A person decides whether this use is acceptable under your policy. The finding message says why it was flagged.',
    level: 'warning',
    severity: '3.0',
  },
  unresolved: {
    name: 'CryptographyNotDetermined',
    short: 'Cryptography whose algorithm could not be determined',
    full: 'The code chooses the algorithm in a way the scanner cannot read, such as a setting read at run time or a value passed into a function, or the code could not be read at all.',
    help: 'Look at this line by hand to find which algorithm is used. The finding message says what could not be read.',
    level: 'warning',
    severity: '2.0',
  },
};

const ruleId = (status: Exclude<Status, 'observed-resistant'>) => `pqc-scan/${status}`;

/** The SARIF log for `findings`, with each finding's fingerprint (see baseline.ts) and, given a baseline, its state. */
export function toSarif(findings: Finding[], prints: string[], baseline?: Set<string>): object {
  const included = findings.map((item, index) => ({ item, print: prints[index] })).filter(({ item }) => item.status !== 'observed-resistant');
  const statuses = Object.keys(RULES) as (keyof typeof RULES)[];
  return {
    $schema: 'https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: 'pqc-scan',
          version,
          semanticVersion: version,
          informationUri: 'https://github.com/Giddywiddit/pqc-scan',
          rules: statuses.map((status) => ({
            id: ruleId(status),
            name: RULES[status].name,
            shortDescription: { text: RULES[status].short },
            fullDescription: { text: RULES[status].full },
            help: { text: RULES[status].help },
            defaultConfiguration: { level: RULES[status].level },
            properties: { tags: ['security', 'cryptography', 'post-quantum'], 'security-severity': RULES[status].severity, precision: 'high' },
          })),
        },
      },
      results: included.map(({ item, print }) => {
        const status = item.status as keyof typeof RULES;
        return {
          ruleId: ruleId(status),
          ruleIndex: statuses.indexOf(status),
          level: RULES[status].level,
          message: { text: `${item.algorithm ?? 'Unknown algorithm'} (${item.status}).${item.note ? ` ${item.note}` : ''}` },
          locations: [{ physicalLocation: { artifactLocation: { uri: item.file.split('\\').join('/') }, region: { startLine: item.line } } }],
          partialFingerprints: { 'pqcScan/v1': print },
          ...(baseline ? { baselineState: baseline.has(print) ? 'unchanged' : 'new' } : {}),
          properties: { algorithm: item.algorithm, category: item.category, pqcScanRule: item.ruleId },
        };
      }),
    }],
  };
}
