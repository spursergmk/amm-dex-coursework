// Rebuilds the plain-text evidence logs byte-exactly.
// PowerShell's Tee-Object writes UTF-16LE and decodes native stdout with the console code page,
// which mangles the Chinese text and the ✓ marks; Node captures the raw bytes instead.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const npm = 'npm.cmd';

function capture(cwd, args, out, {appendStderr = false} = {}) {
  const result = spawnSync(npm, args, {cwd, shell: true, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024});
  const stdout = result.stdout ?? Buffer.alloc(0);
  const stderr = result.stderr ?? Buffer.alloc(0);
  const body = appendStderr && stderr.length ? Buffer.concat([stdout, Buffer.from('\n'), stderr]) : stdout;
  fs.writeFileSync(path.join(root, out), body);
  console.log(`${out}  ${body.length} bytes  exit=${result.status}`);
  if (result.status !== 0) process.exitCode = 1;
  return result;
}

capture(path.join(root, 'contracts'), ['run', 'typecheck'], 'evidence/typecheck.txt', {appendStderr: true});
capture(path.join(root, 'web'), ['run', 'build'], 'evidence/web-build.txt', {appendStderr: true});
capture(root, ['test'], 'evidence/all-checks.txt', {appendStderr: true});

// The browser log is a formatted copy of the machine-written JSON, which is already UTF-8.
const checks = fs.readFileSync(path.join(root, 'evidence/browser-checks.json'), 'utf8');
const browserLog = [
  '',
  '> amm-dex-web@1.0.0 test:e2e',
  '> node tests/browser.mjs',
  '',
  JSON.stringify(JSON.parse(checks), null, 2),
  '',
].join('\n');
fs.writeFileSync(path.join(root, 'evidence/browser-log.txt'), browserLog);

// These two were captured by the runner; only their encoding needs normalising.
for (const file of ['evidence/simulation-log.txt', 'evidence/verification-log.txt']) {
  const target = path.join(root, file);
  const bytes = fs.readFileSync(target);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    const text = bytes.subarray(2).toString('utf16le');
    fs.writeFileSync(target, text.replace(/\r\n/g, '\n'));
    console.log(`${file}  re-encoded UTF-16LE -> UTF-8`);
  }
}

// environment.json was written by PowerShell with a BOM; drop it for consistency.
const envPath = path.join(root, 'evidence/environment.json');
const envBytes = fs.readFileSync(envPath);
if (envBytes[0] === 0xef && envBytes[1] === 0xbb && envBytes[2] === 0xbf) {
  fs.writeFileSync(envPath, envBytes.subarray(3));
  console.log('evidence/environment.json  BOM removed');
}
