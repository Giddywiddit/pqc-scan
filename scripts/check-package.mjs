// Packs the package, installs the tarball into an empty folder as a user would, and checks the installed command
// gives the same JSON report as the source on every fixture folder. Run in CI by the `package` job.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const work = mkdtempSync(join(tmpdir(), 'pqc-package-'));
const run = (command, args, cwd) => execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const tarball = run('npm', ['pack', '--silent', '--pack-destination', work], root).trim().split('\n').pop();
writeFileSync(join(work, 'package.json'), '{ "private": true }\n');
run('npm', ['install', '--silent', join(work, tarball)], work);
const installed = join(work, 'node_modules', '.bin', 'pqc-scan');
// The CLI exits 1 when it finds something to act on; the report on stdout is what is compared.
const report = (command, args, cwd) => {
  try {
    return run(command, args, cwd);
  } catch (error) {
    if (error.status === 1) return error.stdout;
    throw error;
  }
};
let failures = 0;
for (const folder of readdirSync(join(root, 'test/fixtures'))) {
  const target = join(root, 'test/fixtures', folder);
  const fromSource = report('npx', ['tsx', 'src/cli.ts', target, '--json'], root);
  const fromPackage = report(installed, [target, '--json'], work);
  if (fromSource !== fromPackage) {
    failures++;
    console.error(`different report for test/fixtures/${folder}`);
  }
}
console.log(failures === 0 ? `installed ${tarball}: same reports as the source for every fixture folder` : `${failures} folder(s) differ`);
process.exitCode = failures === 0 ? 0 : 1;
