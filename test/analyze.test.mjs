import assert from 'node:assert/strict';
import test from 'node:test';
import { analyze } from '../src/analyze.mjs';

const options = { keys: [{ left: 'id', right: 'key' }], measure: 'amount' };
const run = (left, right, changes = {}) =>
  analyze([['id', 'amount'], ...left], [['key'], ...right], { ...options, ...changes });

test('explains a balanced inner join even when the overall sum and row count look correct', () => {
  const result = run([['a', '35.25'], ['b', '35.25'], ['c', '5']], [['a'], ['a'], ['c']], { join: 'inner' });
  assert.deepEqual(result, {
    leftRows: 3, rightRows: 3, outputRows: 3,
    matchedLeft: 2, unmatchedLeft: 1, duplicatedLeft: 1, extraRows: 1, hasDrift: true,
    before: '75.50', after: '75.50', repeated: '35.25', dropped: '35.25', delta: '0.00',
    keys: [
      { values: ['a'], leftRows: 1, rightRows: 2, outputRows: 2,
        before: '35.25', after: '70.50', repeated: '35.25', dropped: '0.00', delta: '35.25' },
      { values: ['b'], leftRows: 1, rightRows: 0, outputRows: 0,
        before: '35.25', after: '0.00', repeated: '0.00', dropped: '35.25', delta: '-35.25' },
      { values: ['c'], leftRows: 1, rightRows: 1, outputRows: 1,
        before: '5.00', after: '5.00', repeated: '0.00', dropped: '0.00', delta: '0.00' },
    ], keyCount: 3,
  });
});

test('left join retains unmatched left records and multiplies each matched measure', () => {
  const result = run([['dup', '2'], ['dup', '3'], ['missing', '9']], [['dup'], ['other'], ['dup'], ['dup']]);
  assert.deepEqual([
    result.before, result.repeated, result.dropped, result.after, result.duplicatedLeft,
    result.matchedLeft, result.unmatchedLeft, result.extraRows, result.outputRows, result.keyCount,
  ], ['14', '10', '0', '24', 2, 2, 1, 4, 7, 2]);
});

test('treats composite keys as literal tuples and only empty strings as null-like', () => {
  const left = [['part1', 'part2', 'sum'], ['a,b', 'c', '1'], ['a', 'b,c', '2'],
    ['', 'c', '3'], [' ', 'c', '4'], ['01', 'c', '5'], ['1', 'c', '6'], ['__proto__', 'c', '7']];
  const right = [['x', 'y'], ['c', 'a,b'], ['c', ''], ['c', ' '], ['c', '01'], ['c', '__proto__']];
  const opts = { keys: [{ left: 'part1', right: 'y' }, { left: 'part2', right: 'x' }], measure: 'sum', join: 'inner' };
  const distinct = analyze(left, right, opts);
  assert.equal(distinct.after, '17');
  assert.equal(distinct.matchedLeft, 4);
  assert.equal(distinct.keyCount, 7);
  assert.equal(distinct.keys.find(row => row.values[0] === '').rightRows, 0);
  const match = analyze(left, right, { ...opts, nulls: 'match' });
  assert.equal(match.after, '20');
  assert.equal(match.matchedLeft, 5);
  assert.equal(match.keys.find(row => row.values[0] === '').rightRows, 1);
});

test('carries the input precision through huge integers, signed fractions and negative totals', () => {
  const result = run([['a', ' +9007199254740993.01 '], ['a', '-9007199254740994.'], ['b', '-.0000010']],
    [['a'], ['a']], { join: 'inner' });
  assert.deepEqual([result.before, result.after, result.repeated, result.dropped, result.delta],
    ['-0.9900010', '-1.9800000', '-0.9900000', '-0.0000010', '-0.9899990']);
  assert.equal(run([['a', '-0.00']], []).before, '0.00');
});

test('detects repeated and dropped nonzero rows even if signed amounts cancel within a key', () => {
  const left = [['a', '10.5'], ['a', '-10.5']];
  for (const right of [[['a'], ['a']], []]) {
    const report = run(left, right, { join: 'inner', limit: 0 });
    assert.equal(report.hasDrift, true);
    assert.equal(report.delta, '0.0');
    assert.deepEqual(report.keys, []);
    assert.equal(report.keyCount, 1);
  }
  assert.equal(run([['a', '0'], ['b', '0']], [['a'], ['a']], { join: 'inner' }).hasDrift, false);
  assert.equal(run(left, [['a']]).hasDrift, false);
});

test('ranks by magnitude, additional rows and lexical key with a default limit of 30', () => {
  const left = [['z', '10'], ['b', '5'], ['a', '5'], ['c', '0'], ['q', '-12']];
  const right = [['q'], ['q'], ['z'], ['z'], ['a'], ['a'], ['a'], ['b'], ['b'], ['b']];
  const report = run(left, right, { limit: 4 });
  assert.deepEqual(report.keys.map(group => group.values[0]), ['q', 'a', 'b', 'z']);
  assert.equal(report.keyCount, 5);
  assert.equal(run(Array.from({ length: 31 }, (_, i) => [String(i), '0']), []).keys.length, 30);
});

test('accepts empty data tables with headers', () => {
  const report = run([], [['a']]);
  assert.equal(report.outputRows, 0);
  assert.equal(report.before, '0');
  assert.equal(report.hasDrift, false);
  assert.deepEqual(report.keys, []);
});

test('rejects invalid decimal input with the source row and measure', () => {
  for (const amount of ['', '  ', 'USD 1', '1,000', '1e4', 'NaN', 'Infinity', '--2', '.', '1.0.0']) {
    assert.throws(() => run([['a', '1'], ['b', amount]], []), /row 3.*amount.*decimal/i);
  }
});

test('rejects invalid headers, field counts, unknown columns and ambiguous key mappings', () => {
  assert.throws(() => analyze([], [['key']], options), /header row/);
  assert.throws(() => analyze([['id', '']], [['key']], options), /header/);
  assert.throws(() => analyze([['id', 'amount']], [['key', 'key']], options), /duplicate header/);
  assert.throws(() => run([['x']], []), /left row 2.*2 fields/i);
  assert.throws(() => run([], [['1', '2']]), /right row 2.*1 fields/i);
  assert.throws(() => run([['x', 2]], []), /non-string/);
  assert.throws(() => run([], [], { measure: 'missing' }), /left measure column/);
  assert.throws(() => run([], [], { keys: [{ left: 'id', right: 'missing' }] }), /right column/);
  assert.throws(() => run([], [], { keys: [] }), /at least one/);
  assert.throws(() => run([], [], { keys: [options.keys[0], options.keys[0]] }), /more than once/);
  assert.throws(() => run([], [], { keys: [options.keys[0], { left: 'amount', right: 'key' }] }), /more than once/);
  for (const change of [{ join: 'full' }, { nulls: 'sql' }, { limit: -1 }, { limit: 0.5 }]) {
    assert.throws(() => run([], [], change));
  }
});

test('matches a direct join over small generated tables', () => {
  let seed = 17;
  function next(max) {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed % max;
  }
  const labels = ['', ' ', '1', '01', 'a'];
  for (let trial = 0; trial < 80; trial++) {
    const left = Array.from({ length: next(12) }, () => [labels[next(labels.length)], String(next(11) - 5)]);
    const right = Array.from({ length: next(12) }, () => [labels[next(labels.length)]]);
    for (const join of ['left', 'inner']) {
      for (const nulls of ['distinct', 'match']) {
        const report = run(left, right, { join, nulls });
        let after = 0, outputRows = 0, hasDrift = false;
        for (const [key, amount] of left) {
          const matches = right.filter(([other]) => key === other && (key !== '' || nulls === 'match'));
          const joined = matches.length || join === 'inner' ? matches : [[null]];
          outputRows += joined.length;
          for (const _row of joined) after += Number(amount);
          hasDrift ||= joined.length !== 1 && Number(amount) !== 0;
        }
        assert.equal(report.after, String(after));
        assert.equal(report.outputRows, outputRows);
        assert.equal(report.hasDrift, hasDrift);
      }
    }
  }
});
