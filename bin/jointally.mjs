#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { analyze } from '../src/analyze.mjs';
import { parseCSV } from '../src/csv.mjs';
import { balancedLeftCSV, balancedRightCSV, leftCSV, rightCSV } from '../examples/demo.mjs';

const usage = `Usage
  jointally demo [options]
  jointally LEFT.csv RIGHT.csv --key COLUMN --measure COLUMN [options]

Options
  --key COLUMN          Join on a column shared by both tables. Repeat for a composite key.
  --key LEFT=RIGHT      Map column names when the headers differ.
  --measure COLUMN      Sum this decimal-valued column from the left table.
  --join left|inner     Keep all left rows or only matched rows. Default: left (balanced demo: inner).
  --nulls distinct|match
                        Empty key fields never match by default. Use match to equate them.
  --delimiter comma|tab Select the input separator. Default: comma.
  --scenario regional|balanced
                        Pick a demo. Regional shows duplication. Balanced shows offsetting changes.
  --limit N             Show up to N keys in the report. Default: 30.
  --json                Write the report as JSON.
  --fail-on-drift       Exit 1 if a nonzero source amount is repeated or dropped.
  -h, --help            Show this help.

Examples
  jointally demo
  jointally demo --scenario balanced --fail-on-drift
  jointally orders.csv customers.csv --key customer_id --key region --measure revenue
  jointally orders.csv people.csv --key customer_id=id --measure revenue --json --fail-on-drift

Exit codes: 0 success, 1 drift with --fail-on-drift, 2 invalid arguments or input.`;

const options = {
  key: { type: 'string', multiple: true },
  measure: { type: 'string' },
  join: { type: 'string' },
  nulls: { type: 'string', default: 'distinct' },
  delimiter: { type: 'string', default: 'comma' },
  scenario: { type: 'string' },
  limit: { type: 'string', default: '30' },
  json: { type: 'boolean' },
  'fail-on-drift': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
};

const unicodeControls = /[\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/gu;
const escapeChar = (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0');

// Escape untrusted labels, paths, and errors before they reach the terminal.
function printable(text) {
  return text.replace(/[\u0000-\u001f]/gu, escapeChar).replace(unicodeControls, escapeChar);
}

function keyPair(value) {
  const names = value.split('=');
  if (names.length > 2 || names.some((name) => !name.length)) {
    throw new Error('Use --key COLUMN or --key LEFT=RIGHT with nonempty column names.');
  }
  return { left: names[0], right: names[1] ?? names[0] };
}

function checkChoice(name, value, accepted) {
  if (!accepted.includes(value)) throw new Error(`--${name} must be ${accepted.join(' or ')}.`);
}

async function readTable(path, delimiter) {
  try {
    const bytes = await readFile(path);
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    return parseCSV(text, delimiter);
  } catch (error) {
    throw new Error(`${path}: ${error.message}`);
  }
}

const counts = new Intl.NumberFormat('en-US');
function amount(raw, sign = false) {
  const [whole, fraction] = raw.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
  const positive = sign && !raw.startsWith('-') && /[1-9]/u.test(raw);
  return (positive ? '+' : '') + grouped + (fraction === undefined ? '' : '.' + fraction);
}

function render(report, config) {
  const keyLabels = config.keys.map(({ left, right }) =>
    left === right ? JSON.stringify(left) : `${JSON.stringify(left)} → ${JSON.stringify(right)}`);
  const lines = [
    `JoinTally · ${config.join} join`,
    `Keys      ${printable(keyLabels.join(', '))}`,
    `Measure   ${printable(JSON.stringify(config.measure))}`,
    '',
    `Before join   ${amount(report.before)}`,
    `After join    ${amount(report.after)}`,
    `Net change    ${amount(report.delta, true)}`,
    `Repeated      ${amount(report.repeated)}`,
    `Dropped       ${amount(report.dropped)}`,
    '',
    `Rows    ${counts.format(report.leftRows)} left · ${counts.format(report.rightRows)} right · ${counts.format(report.outputRows)} output`,
    `Left    ${counts.format(report.matchedLeft)} matched · ${counts.format(report.unmatchedLeft)} unmatched · ${counts.format(report.duplicatedLeft)} matched multiple times`,
  ];
  if (report.hasDrift && !/[1-9]/u.test(report.delta)) {
    lines.push('Nonzero amounts were repeated or dropped. Their changes sum to zero.');
  }
  if (report.keys.length) {
    lines.push('', `Key contributions (showing ${report.keys.length} of ${counts.format(report.keyCount)})`);
    const table = [
      ['Key', 'Left', 'Right', 'Output', 'Repeated', 'Dropped', 'Change'],
      ...report.keys.map((row) => [
        printable(JSON.stringify(row.values)), counts.format(row.leftRows), counts.format(row.rightRows),
        counts.format(row.outputRows), amount(row.repeated), amount(row.dropped), amount(row.delta, true),
      ]),
    ];
    const widths = table[0].map((_, col) => table.reduce((width, row) => Math.max(width, row[col].length), 0));
    for (const row of table) {
      lines.push(row.map((cell, col) => col ? cell.padStart(widths[col]) : cell.padEnd(widths[col])).join('  '));
    }
  }
  return lines.join('\n');
}

async function main() {
  const { values, positionals } = parseArgs({ options, allowPositionals: true });
  if (values.help) {
    console.log(usage);
    return;
  }
  const demo = positionals.length === 1 && positionals[0] === 'demo';
  if (!demo && positionals.length !== 2) throw new Error('Supply a left and a right CSV file, or run "jointally demo".');
  if (!demo && values.scenario !== undefined) throw new Error('--scenario is available only with the demo command.');
  const scenario = values.scenario ?? 'regional';
  checkChoice('scenario', scenario, ['regional', 'balanced']);
  const join = values.join ?? (scenario === 'balanced' ? 'inner' : 'left');
  const keyArgs = values.key ?? (demo ? ['customer_id'] : []);
  const measure = values.measure ?? (demo ? 'revenue' : undefined);
  if (!keyArgs.length || !measure) throw new Error('A join needs at least one --key and a --measure.');
  checkChoice('join', join, ['left', 'inner']);
  checkChoice('nulls', values.nulls, ['distinct', 'match']);
  checkChoice('delimiter', values.delimiter, ['comma', 'tab']);
  if (demo && values.delimiter !== 'comma') throw new Error('The built-in demo uses comma-separated input.');
  if (!/^\d+$/u.test(values.limit) || !Number.isSafeInteger(Number(values.limit))) {
    throw new Error('--limit must be a nonnegative safe integer.');
  }
  const config = {
    keys: keyArgs.map(keyPair), measure, join, nulls: values.nulls, limit: Number(values.limit),
  };
  const delimiter = values.delimiter === 'tab' ? '\t' : ',';
  const demoTables = scenario === 'balanced' ? [balancedLeftCSV, balancedRightCSV] : [leftCSV, rightCSV];
  const [left, right] = demo ? demoTables.map((table) => parseCSV(table))
    : await Promise.all(positionals.map((path) => readTable(path, delimiter)));
  const report = analyze(left, right, config);
  // Escaping non-ASCII terminal controls preserves the JSON values after parsing.
  const output = values.json ? JSON.stringify(report, null, 2).replace(unicodeControls, escapeChar) : render(report, config);
  console.log(output);
  if (values['fail-on-drift'] && report.hasDrift) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`jointally: ${printable(error.message)}\n\n${usage}`);
  process.exitCode = 2;
});
