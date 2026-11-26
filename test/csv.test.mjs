import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCSV } from '../src/csv.mjs';

test('BOM, newline variants, delimiters, escaped quotes and literal whitespace', () => {
  const csv = '\uFEFFid,value\r\n1,"two,\r\n""words"""\r2,  raw  \n3,';
  assert.deepEqual(parseCSV(csv), [
    ['id', 'value'], ['1', 'two,\r\n"words"'], ['2', '  raw  '], ['3', ''],
  ]);
});

test('empty physical lines are distinct from records containing empty fields', () => {
  assert.deepEqual(parseCSV('\n\r\n\r'), []);
  assert.deepEqual(parseCSV('\n""\n\r,\r\n\r \n,,'), [[''], ['', ''], [' '], ['', '', '']]);
  assert.deepEqual(parseCSV('\uFEFF'), []);
  assert.deepEqual(parseCSV('a\n\uFEFFb'), [['a'], ['\uFEFFb']]);
});

test('accepts tab-separated text including quoted tabs', () => {
  assert.deepEqual(parseCSV('name\tv\nOxford, UK\t"2\t3"', '\t'), [
    ['name', 'v'], ['Oxford, UK', '2\t3'],
  ]);
});

test('rejects unterminated quotes, stray quotes and text after a quoted field', () => {
  assert.throws(() => parseCSV('id\n"one\nline'), /record 2, character 4: unclosed/u);
  assert.throws(() => parseCSV('id\nabc"x'), /record 2, character 7: unexpected quote/u);
  assert.throws(() => parseCSV('id\n"a" x'), /record 2, character 7: expected a delimiter/u);
});

test('rejects unusable delimiters and non-text inputs', () => {
  for (const delimiter of ['', null, 'ab', '"', '\n', '\r']) {
    assert.throws(() => parseCSV('a', delimiter), /delimiter/u);
  }
  assert.throws(() => parseCSV(new Uint8Array()), /string/u);
});

test('round-trips pairs of punctuation-heavy fields', () => {
  const cells = ['', '""', 'a,b', 'x\ny', '🌾', '\r\n', 'x"y,z\r', '0', '\t', '  '];
  const rows = cells.flatMap((a) => cells.map((b) => [a, b]));
  const csv = rows.map((row) => row.map((v) => '"' + v.replaceAll('"', '""') + '"').join(',')).join('\r\n');
  assert.deepEqual(parseCSV(csv), rows);
});
