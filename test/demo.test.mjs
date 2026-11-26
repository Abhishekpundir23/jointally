import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { leftCSV, rightCSV } from '../examples/demo.mjs';
import { parseCSV } from '../src/csv.mjs';
import { analyze } from '../src/analyze.mjs';

test('public example files and the browser demo tell the same story', async () => {
  for (const [file, demo] of [['orders.csv', leftCSV], ['customers.csv', rightCSV]]) {
    const data = await readFile(new URL('../examples/' + file, import.meta.url), 'utf8');
    assert.equal(data, demo);
  }
  const left = parseCSV(leftCSV);
  const right = parseCSV(rightCSV);
  const keys = [{ left: 'customer_id', right: 'customer_id' }];
  const first = analyze(left, right, { keys, measure: 'revenue' });
  assert.equal(first.before, '10316.00');
  assert.equal(first.after, '19766.00');
  assert.equal(first.outputRows, 18);
  assert.equal(first.keys[0].values[0], 'northstar');
  assert.equal(first.keys[0].delta, '8000.00');
  keys.push({ left: 'region', right: 'region' });
  const repaired = analyze(left, right, { keys, measure: 'revenue' });
  assert.equal(repaired.after, first.before);
  assert.equal(repaired.outputRows, 10);
  assert.equal(repaired.unmatchedLeft, 1);
  assert.equal(repaired.hasDrift, false);
});
