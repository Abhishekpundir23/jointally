import { execFile } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const invoke = promisify(execFile);
const cli = fileURLToPath(new URL('../bin/jointally.mjs', import.meta.url));

function input(name, fallback) {
  const value = process.env['INPUT_' + name.toUpperCase()]?.trim();
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required input "${name}".`);
}

async function main() {
  const gate = input('fail-on-drift', 'true').toLowerCase();
  if (!['true', 'false'].includes(gate)) throw new Error('fail-on-drift must be true or false.');
  const keys = input('keys').split(/\r?\n/u).map((key) => key.trim()).filter(Boolean);
  const args = [
    cli, '--json', '--limit=0', '--measure=' + input('measure'),
    '--join=' + input('join', 'left'), '--nulls=' + input('nulls', 'distinct'),
    ...keys.map((key) => '--key=' + key),
    '--', input('left'), input('right'),
  ];
  let result;
  try {
    // No shell. Paths and keys are individual arguments, including leading dashes.
    result = await invoke(process.execPath, args, { cwd: process.env.GITHUB_WORKSPACE || process.cwd() });
  } catch (error) {
    throw new Error(error.stderr?.split('\n')[0] || 'The JoinTally analysis could not run.');
  }
  const report = JSON.parse(result.stdout);
  const outputs = [
    `has-drift=${report.hasDrift}`, `before=${report.before}`, `after=${report.after}`,
    `delta=${report.delta}`, `output-rows=${report.outputRows}`,
  ];
  const status = report.hasDrift ? 'Nonzero source amounts were repeated or dropped.' : 'Every nonzero source amount was counted once.';
  const summary = [
    '## JoinTally', '', status, '',
    '| Left rows | Output rows | Before | After | Repeated | Dropped | Net change |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    `| ${report.leftRows} | ${report.outputRows} | ${report.before} | ${report.after} | ${report.repeated} | ${report.dropped} | ${report.delta} |`,
    '',
  ];
  await appendFile(process.env.GITHUB_OUTPUT, outputs.join('\n') + '\n');
  await appendFile(process.env.GITHUB_STEP_SUMMARY, summary.join('\n'));
  console.log(`JoinTally: ${status}`);
  if (gate === 'true' && report.hasDrift) process.exitCode = 1;
}

main().catch((error) => {
  const message = error.message.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  console.error('::error::' + message);
  process.exitCode = 2;
});
