import type { Finding, Status } from '../core/types.ts';

/** Each status as a word at the start of its row, and its colour when the output is a terminal. */
const LABELS: Record<Status, { word: string; colour: number }> = {
  vulnerable: { word: 'VULNERABLE', colour: 31 },
  'needs-review': { word: 'REVIEW', colour: 33 },
  unresolved: { word: 'UNRESOLVED', colour: 35 },
  'observed-resistant': { word: 'RESISTANT', colour: 32 },
};

// Colour only on a terminal, and never when NO_COLOR is set (https://no-color.org).
const useColour = () => Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (text: string, colour: number) => (useColour() ? `\x1b[${colour}m${text}\x1b[0m` : text);
const dim = (text: string) => (useColour() ? `\x1b[2m${text}\x1b[0m` : text);

export const MASCOT_BANNER = [
  ' /\\_/\\',
  '( 0.1 )    [ pqc-scan • Post-Quantum Cryptography Scanner ]',
  ' > ^ <     Finds the cryptography in your JavaScript, TypeScript, C, C++, Rust and Go',
  '           ---------------------------------------------------------',
  '           Looks for what quantum computers will break (NIST FIPS 203/204/205)\n',
].join('\n');

export function printTable(findings: Finding[], known = 0): void {
  if (known > 0) console.log(`${known} finding(s) already in the baseline are not shown.\n`);
  if (findings.length === 0 && known > 0) {
    console.log('No new findings since the baseline.\n');
    return;
  }
  if (findings.length === 0) {
    console.log('No recognised cryptography found. This is not a security conclusion.\n');
    return;
  }
  console.log('Cryptography found:');
  console.log(''.padEnd(76, '-'));
  for (const item of findings) {
    const { word, colour } = LABELS[item.status];
    console.log(`${paint(word.padEnd(10), colour)}  ${`${item.file}:${item.line}`.padEnd(40)} ${item.algorithm ?? 'unknown algorithm'}`);
    if (item.note) console.log(dim(`            ${item.note}`));
  }
  console.log(''.padEnd(76, '-'));
  const count = (status: Status) => findings.filter((item) => item.status === status).length;
  console.log(`${findings.length} finding(s): ${count('vulnerable')} vulnerable, ${count('needs-review')} needs review, ${count('unresolved')} unresolved, ${count('observed-resistant')} resistant.\n`);
  if (count('vulnerable') > 0) console.log('Quantum risk found: the VULNERABLE items use cryptography a quantum computer could break. Plan their migration.');
  else if (count('needs-review') + count('unresolved') > 0) console.log('Review needed: some items need a human decision. This scan cannot prove readiness.');
  else console.log('Nothing risky found in the code that could be read. This is not a guarantee of quantum readiness.');
  console.log();
}
