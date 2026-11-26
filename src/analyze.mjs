const decimalPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

function headersOf(records, side) {
  if (!Array.isArray(records) || !Array.isArray(records[0]) || !records[0].length) {
    throw new Error(`${side} input needs a header row.`);
  }
  const columns = new Map();
  for (const [index, name] of records[0].entries()) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error(`${side} header at column ${index + 1} is empty or invalid.`);
    }
    if (columns.has(name)) throw new Error(`${side} has a duplicate header: ${JSON.stringify(name)}.`);
    columns.set(name, index);
  }
  return columns;
}

function columnIndex(columns, name, side) {
  if (!columns.has(name)) {
    throw new Error(`Unknown ${side} column: ${JSON.stringify(name)}.`);
  }
  return columns.get(name);
}

function keyIndices(keys, columns, side) {
  const indices = keys.map(pair => columnIndex(columns, pair?.[side], side));
  if (new Set(indices).size !== indices.length) {
    throw new Error(`A ${side} key column is mapped more than once.`);
  }
  return indices;
}

function validateRow(row, width, side, rowNumber) {
  if (!Array.isArray(row) || row.length !== width) {
    throw new Error(`${side} row ${rowNumber} must have ${width} fields.`);
  }
  for (const value of row) {
    if (typeof value !== 'string') throw new Error(`${side} row ${rowNumber} contains a non-string field.`);
  }
}

function decimal(text, rowNumber, measure) {
  const trimmed = text.trim();
  if (!decimalPattern.test(trimmed)) {
    throw new Error(`Left row ${rowNumber}, measure ${JSON.stringify(measure)} must contain a decimal number.`);
  }
  const point = trimmed.indexOf('.');
  const scale = point === -1 ? 0 : trimmed.length - point - 1;
  return { units: BigInt(trimmed.replace('.', '')), scale };
}

function rescale(units, places) {
  return places === 0 || units === 0n ? units : units * (10n ** BigInt(places));
}

function display(units, scale) {
  const digits = (units < 0n ? -units : units).toString().padStart(scale + 1, '0');
  const unsigned = scale ? digits.slice(0, -scale) + '.' + digits.slice(-scale) : digits;
  return units < 0n ? '-' + unsigned : unsigned;
}

function safeCount(count) {
  if (!Number.isSafeInteger(count)) throw new Error('The join exceeds the safe integer row-count limit.');
  return count;
}

function compareGroups(a, b) {
  if (a.absDelta !== b.absDelta) return a.absDelta > b.absDelta ? -1 : 1;
  if (a.extraRows !== b.extraRows) return b.extraRows - a.extraRows;
  for (let i = 0; i < a.values.length; i++) {
    if (a.values[i] !== b.values[i]) return a.values[i] < b.values[i] ? -1 : 1;
  }
  return 0;
}

function amounts(before, repeated, dropped, scale) {
  const delta = repeated - dropped;
  return {
    before: display(before, scale),
    after: display(before + delta, scale),
    repeated: display(repeated, scale),
    dropped: display(dropped, scale),
    delta: display(delta, scale),
  };
}

/**
 * Tally a left-side CSV measure without materializing the joined rows.
 * Both tables include a header as their first row. Columns contain strings.
 */
export function analyze(leftRows, rightRows, options = {}) {
  const { keys, measure, join = 'left', nulls = 'distinct', limit = 30 } = options;
  if (join !== 'left' && join !== 'inner') throw new Error('Join must be "left" or "inner".');
  if (nulls !== 'distinct' && nulls !== 'match') throw new Error('Nulls must be "distinct" or "match".');
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('Limit must be a nonnegative safe integer.');
  if (!Array.isArray(keys) || !keys.length) throw new Error('Provide at least one join key mapping.');

  const leftColumns = headersOf(leftRows, 'left');
  const rightColumns = headersOf(rightRows, 'right');
  const leftIndices = keyIndices(keys, leftColumns, 'left');
  const rightIndices = keyIndices(keys, rightColumns, 'right');
  const measureIndex = columnIndex(leftColumns, measure, 'left measure');
  const groups = new Map();
  let scale = 0;
  for (let i = 1; i < leftRows.length; i++) {
    const row = leftRows[i];
    validateRow(row, leftColumns.size, 'left', i + 1);
    const amount = decimal(row[measureIndex], i + 1, measure);
    scale = Math.max(scale, amount.scale);
    const values = leftIndices.map(index => row[index]);
    const id = JSON.stringify(values);
    let group = groups.get(id);
    if (!group) {
      group = { values, leftRows: 0, rightRows: 0, before: 0n, scale: 0, nonzero: false };
      groups.set(id, group);
    }
    group.leftRows++;
    group.nonzero ||= amount.units !== 0n;
    const groupScale = Math.max(group.scale, amount.scale);
    group.before = rescale(group.before, groupScale - group.scale) + rescale(amount.units, groupScale - amount.scale);
    group.scale = groupScale;
  }

  for (let i = 1; i < rightRows.length; i++) {
    const row = rightRows[i];
    validateRow(row, rightColumns.size, 'right', i + 1);
    const values = rightIndices.map(index => row[index]);
    if (nulls === 'distinct' && values.includes('')) continue;
    const group = groups.get(JSON.stringify(values));
    if (group) group.rightRows++;
  }

  let matchedLeft = 0, duplicatedLeft = 0, extraRows = 0, outputRows = 0;
  let before = 0n, repeated = 0n, dropped = 0n;
  let hasDrift = false;
  const ranked = [];
  for (const group of groups.values()) {
    const left = group.leftRows, right = group.rightRows;
    const multiplicity = right || (join === 'left' ? 1 : 0);
    const output = safeCount(left * multiplicity);
    const extra = Math.max(0, output - left);
    if (right) matchedLeft += left;
    if (right > 1) duplicatedLeft += left;
    outputRows = safeCount(outputRows + output);
    extraRows = safeCount(extraRows + extra);

    const value = rescale(group.before, scale - group.scale);
    const gain = value * BigInt(Math.max(0, multiplicity - 1));
    const loss = multiplicity === 0 ? value : 0n;
    before += value;
    repeated += gain;
    dropped += loss;
    hasDrift ||= multiplicity !== 1 && group.nonzero;
    if (limit) {
      const delta = gain - loss;
      ranked.push({ values: group.values, leftRows: left, rightRows: right, outputRows: output,
        before: value, repeated: gain, dropped: loss, absDelta: delta < 0n ? -delta : delta, extraRows: extra });
    }
  }
  const top = ranked.sort(compareGroups).slice(0, limit).map(group => ({
    values: group.values, leftRows: group.leftRows, rightRows: group.rightRows, outputRows: group.outputRows,
    ...amounts(group.before, group.repeated, group.dropped, scale),
  }));
  return {
    leftRows: leftRows.length - 1, rightRows: rightRows.length - 1, outputRows,
    matchedLeft, unmatchedLeft: leftRows.length - 1 - matchedLeft, duplicatedLeft, extraRows, hasDrift,
    ...amounts(before, repeated, dropped, scale),
    keys: top, keyCount: groups.size,
  };
}
