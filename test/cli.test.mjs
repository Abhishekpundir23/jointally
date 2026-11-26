import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/jointally.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
function tables(t, left, right) {
  const dir = mkdtempSync(join(tmpdir(), 'jointally-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return [left, right].map((content, i) => {
    const path = join(dir, `${i}.csv`);
    writeFileSync(path, content);
    return path;
  });
}

test('the built-in demo works in terminal and JSON formats', () => {
  const human = run('demo');
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /Key contributions/u);
  assert.match(human.stdout, /Net change/u);
  const json = run('demo', '--json', '--fail-on-drift');
  assert.equal(json.status, 1, json.stderr);
  assert.equal(JSON.parse(json.stdout).hasDrift, true);
  assert.equal(run('demo', '--scenario', 'regional').stdout, human.stdout);
});

test('balanced scenario reveals offsetting errors under its default inner join', () => {
  const args = ['demo', '--scenario', 'balanced', '--json', '--fail-on-drift'];
  const balanced = run(...args);
  assert.equal(balanced.status, 1, balanced.stderr);
  const { leftRows, outputRows, before, after, repeated, dropped, hasDrift } = JSON.parse(balanced.stdout);
  assert.deepEqual([leftRows, outputRows], [3, 3]);
  assert.deepEqual([before, after, repeated, dropped, hasDrift], ['250.00', '250.00', '100.00', '100.00', true]);
  const override = run(...args, '--join', 'left');
  assert.equal(override.status, 1, override.stderr);
  const left = JSON.parse(override.stdout);
  assert.deepEqual([left.outputRows, left.after, left.dropped], [4, '350.00', '0.00']);
});

test('accepts tab-separated files and independently named composite keys', (t) => {
  const files = tables(t, 'id\tregion\tamount\na\tuk\t2.50\na\tus\t1.25', 'cid\tregion\na\tuk\na\tus');
  const result = run(...files, '--key', 'id=cid', '--key', 'region', '--measure', 'amount',
    '--delimiter', 'tab', '--json', '--fail-on-drift');
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.delta, '0.00');
  assert.equal(report.outputRows, 2);
  assert.equal(report.after, '3.75');
});

test('gate catches repeated and dropped amounts even when the total is unchanged', (t) => {
  const files = tables(t, 'id,amount\na,5\nb,5', 'id\na\na');
  const args = [...files, '--key', 'id', '--measure', 'amount', '--join', 'inner', '--json', '--limit', '0'];
  const result = run(...args, '--fail-on-drift');
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.delta, '0');
  assert.equal(report.repeated, '5');
  assert.equal(report.dropped, '5');
  assert.deepEqual(report.keys, []);
  assert.equal(run(...args).status, 0);
});

test('gate catches offsetting positive and negative source rows within a single key', (t) => {
  const files = tables(t, 'id,amount\na,5\na,-5', 'id\na\na');
  const result = run(...files, '--key', 'id', '--measure', 'amount', '--json', '--fail-on-drift');
  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(result.stdout).repeated, '0');
});

test('zero-only row expansion preserves the measure under the gate', (t) => {
  const files = tables(t, 'id,amount\na,0', 'id\na\na');
  const result = run(...files, '--key', 'id', '--measure', 'amount', '--json', '--fail-on-drift');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).extraRows, 1);
});

test('terminal escapes control characters in user data and JSON round-trips them', (t) => {
  const id = 'x\u001b[9m\u202e';
  const files = tables(t, `id,amount\n${id},1`, `id\n${id}`);
  const args = [...files, '--key', 'id', '--measure', 'amount'];
  const human = run(...args);
  assert.equal(human.status, 0, human.stderr);
  assert.doesNotMatch(human.stdout, /[\x1b\u202e]/u);
  assert.match(human.stdout, /\\u001b/u);
  const json = run(...args, '--json');
  assert.doesNotMatch(json.stdout, /[\x1b\u202e]/u);
  assert.deepEqual(JSON.parse(json.stdout).keys[0].values, [id]);
});

test('malformed input yields a file-specific error and no report', (t) => {
  for (const [content, expected] of [['id,x\n"unclosed', /unclosed quoted field/u], [Buffer.from([255]), /utf-?8/iu]]) {
    const files = tables(t, content, 'id\na');
    const result = run(...files, '--key', 'id', '--measure', 'x');
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /0\.csv/u);
    assert.match(result.stderr, expected);
    assert.equal(result.stdout, '');
  }
});

test('help and invalid arguments have distinct exit codes', () => {
  assert.equal(run('--help').status, 0);
  for (const args of [[], ['demo', '--unknown'], ['left', 'right'], ['demo', '--limit', '-1'],
    ['demo', '--join', 'outer'], ['demo', '--key', 'a=b=c'], ['demo', '--nulls', 'typo'],
    ['demo', '--scenario', 'typo'], ['left', 'right', '--scenario', 'regional']]) {
    const result = run(...args);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /Usage/u);
  }
});
