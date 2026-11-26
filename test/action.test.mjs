import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const action = fileURLToPath(new URL('../action/run.mjs', import.meta.url));
const left = 'cid,region,amount\ncustomer-private,US,100.00\nmissing-private,EU,100.00\nthird-private,UK,50.00';
const right = 'id,region\ncustomer-private,US\ncustomer-private,EU\nthird-private,UK';

function run(t, inputs = {}) {
  const workspace = mkdtempSync(join(tmpdir(), 'jointally-action-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  // Leading dashes and shell punctuation are valid filenames.
  const leftFile = '--left; orders.csv';
  const rightFile = 'right customers.csv';
  writeFileSync(join(workspace, leftFile), left);
  writeFileSync(join(workspace, rightFile), right);
  const output = join(workspace, 'output');
  const summary = join(workspace, 'summary');
  writeFileSync(output, '');
  writeFileSync(summary, '');
  const processResult = spawnSync(process.execPath, [action], {
    env: {
      ...process.env, GITHUB_WORKSPACE: workspace, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary,
      INPUT_LEFT: leftFile, INPUT_RIGHT: rightFile, INPUT_MEASURE: 'amount', INPUT_KEYS: 'cid=id',
      INPUT_JOIN: '', INPUT_NULLS: '', 'INPUT_FAIL-ON-DRIFT': '', ...inputs,
    },
    encoding: 'utf8',
  });
  const pairs = readFileSync(output, 'utf8').trim().split('\n').filter(Boolean).map((line) => line.split('='));
  return { ...processResult, outputs: Object.fromEntries(pairs), summary: readFileSync(summary, 'utf8') };
}

test('action fails on offsetting drift after writing all aggregate outputs and summary', (t) => {
  const result = run(t, { INPUT_JOIN: 'inner' });
  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(result.outputs, {
    'has-drift': 'true', before: '250.00', after: '250.00', delta: '0.00', 'output-rows': '3',
  });
  assert.match(result.summary, /\| 3 \| 3 \| 250\.00 \| 250\.00 \| 100\.00 \| 100\.00 \| 0\.00 \|/u);
  assert.doesNotMatch(result.summary + result.stdout + result.stderr, /customer-private|missing-private|third-private/u);
});

test('action succeeds with matching composite keys and its default left join', (t) => {
  const result = run(t, { INPUT_KEYS: 'cid=id\r\nregion\r\n' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.outputs['has-drift'], 'false');
  assert.equal(result.outputs['output-rows'], '3');
  assert.equal(result.outputs.after, '250.00');
});

test('report-only action succeeds with drift and preserves output status', (t) => {
  const result = run(t, { 'INPUT_FAIL-ON-DRIFT': 'false' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.outputs['has-drift'], 'true');
  assert.equal(result.outputs.delta, '100.00');
});

test('invalid action inputs and missing files fail without publishing incomplete reports', (t) => {
  for (const inputs of [{ INPUT_LEFT: 'missing.csv' }, { INPUT_KEYS: '' }, { 'INPUT_FAIL-ON-DRIFT': 'often' }]) {
    const result = run(t, inputs);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /::error::/u);
    assert.deepEqual(result.outputs, {});
    assert.equal(result.summary, '');
  }
});
