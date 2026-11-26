import { analyze } from '../src/analyze.mjs';
import { parseCSV } from '../src/csv.mjs';
import { leftCSV, rightCSV, balancedLeftCSV, balancedRightCSV } from '../examples/demo.mjs';

const byId = (id) => document.getElementById(id);
const integer = new Intl.NumberFormat('en-US');
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const tableSides = ['left', 'right'];
const state = { left: [], right: [], names: {}, keys: [], limit: 30, demo: false, report: null };
const draftNames = {};
// A textarea normalizes CRLF to LF, including inside quoted data. Preserve
// original file text until someone intentionally edits the pasted preview.
const uploadedText = {};
const readSequence = { left: 0, right: 0 };
const pending = new Set();
const dialog = byId('import-dialog');

function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}

function amount(value, signed = false) {
  const raw = String(value);
  const [whole, fraction] = raw.replace(/^[-+]/, '').split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = raw.startsWith('-') ? '−' : signed && /[1-9]/.test(raw) ? '+' : '';
  return sign + grouped + (fraction ? '.' + fraction : '');
}

function count(value, singular, plural = singular + 's') {
  return integer.format(value) + ' ' + (value === 1 ? singular : plural);
}

function options(select, headers, value) {
  select.replaceChildren(...headers.map((header) => new Option(header, header)));
  select.value = value;
}

function validateRows(rows, side) {
  if (!rows.length || !rows[0].length || rows[0].some(header => !header.trim())) {
    throw new Error(side + ' table needs a non-empty name for each column.');
  }
  if (new Set(rows[0]).size !== rows[0].length) {
    throw new Error(side + ' table contains duplicate column names.');
  }
  const bad = rows.findIndex(row => row.length !== rows[0].length);
  if (bad !== -1) throw new Error(side + ' table record ' + (bad + 1) + ' has a different number of fields than the header.');
}

function nextKey() {
  const unused = (side) => state[side][0].filter(header => !state.keys.some(key => key[side] === header));
  const left = unused('left');
  const right = unused('right');
  if (!left.length || !right.length) return null;
  const shared = left.find(name => right.includes(name));
  return { left: shared ?? left[0], right: shared ?? right[0] };
}

function loadTables(left, right, names, demo) {
  validateRows(left, 'Left');
  validateRows(right, 'Right');
  Object.assign(state, { left, right, names, demo, keys: [], limit: 30 });
  state.keys = [demo ? { left: 'customer_id', right: 'customer_id' } : nextKey()];
  const numericMeasure = left[0].filter((header, idx) =>
    left.length > 1 && left.slice(1, 26).every(row => decimal.test(row[idx].trim()))
  );
  const priority = /^(revenue|amount|total|sales|price|quantity|cost)$/i;
  const measure = demo ? 'revenue' : numericMeasure.find(name => priority.test(name))
    ?? numericMeasure.find(name => name !== state.keys[0].left)
    ?? numericMeasure[0] ?? left[0].find(name => name !== state.keys[0].left) ?? left[0][0];
  options(byId('measure'), left[0], measure);
  const join = demo === 'balanced' ? 'inner' : 'left';
  document.querySelector('input[name="join"][value="' + join + '"]').checked = true;
  byId('nulls').value = 'distinct';
  byId('example').value = demo || 'custom';
  const sourceNodes = tableSides.map((side) => {
    const source = element('div', 'source');
    const label = element('div');
    label.append(element('span', 'source-name', names[side]), element('span', 'source-detail', count(state[side].length - 1, 'row')));
    const sideName = side === 'left' ? 'Left' : 'Right';
    const tag = element('span', 'side-tag', sideName);
    source.append(tag, label);
    return source;
  });
  byId('sources').replaceChildren(...sourceNodes);
  renderKeys();
  update();
}

function renderKeys() {
  const nodes = state.keys.map((key, index) => {
    const canRemove = state.keys.length > 1;
    const line = element('div', 'key-line' + (canRemove ? ' removable' : ''));
    const pair = element('div', 'key-pair');
    for (const side of tableSides) {
      const select = element('select');
      select.setAttribute('aria-label', (side === 'left' ? 'Left' : 'Right') + ' join column ' + (index + 1));
      options(select, state[side][0], key[side]);
      for (const option of select.options) {
        option.disabled = state.keys.some((existing, i) => i !== index && existing[side] === option.value);
      }
      select.addEventListener('change', () => {
        key[side] = select.value;
        renderKeys();
        byId('key-inputs').querySelectorAll('select')[index * 2 + (side === 'right' ? 1 : 0)].focus();
        update(true);
      });
      if (side === 'right') {
        const arrow = element('span', 'key-arrow', '→');
        arrow.setAttribute('aria-hidden', 'true');
        pair.append(arrow);
      }
      pair.append(select);
    }
    line.append(pair);
    if (canRemove) {
      const remove = element('button', 'remove-key', 'Remove');
      remove.type = 'button';
      remove.setAttribute('aria-label', 'Remove key pair ' + (index + 1));
      remove.addEventListener('click', () => {
        state.keys.splice(index, 1);
        renderKeys();
        byId('add-key').focus();
        update(true);
      });
      line.append(remove);
    }
    return line;
  });
  byId('key-inputs').replaceChildren(...nodes);
  byId('add-key').disabled = !nextKey();
}

function settings() {
  return {
    keys: state.keys,
    measure: byId('measure').value,
    join: document.querySelector('input[name="join"]:checked').value,
    nulls: byId('nulls').value,
    limit: state.limit
  };
}

// Compare magnitudes as scaled integers, so even very large decimal strings
// produce finite chart widths. Displayed numbers retain their original precision.
function barWidths(before, after) {
  const values = [before, after].map(value => String(value).replace(/^[-+]/, '').split('.'));
  const precision = Math.max(...values.map(([, frac = '']) => frac.length));
  const magnitudes = values.map(([whole, frac = '']) => BigInt(whole + frac.padEnd(precision, '0')));
  const max = magnitudes[0] > magnitudes[1] ? magnitudes[0] : magnitudes[1];
  return magnitudes.map(n => max === 0n ? '0%' : Number((10000n * n) / max) / 100 + '%');
}

function renderResult(result, config) {
  byId('metric-label').textContent = 'Net change in ' + config.measure;
  const net = byId('delta');
  net.textContent = amount(result.delta, true);
  const zero = !/[1-9]/.test(result.delta);
  net.classList.toggle('zero', zero && !result.hasDrift);
  net.classList.toggle('long', net.textContent.length > 13);
  byId('offset-detail').hidden = !(zero && result.hasDrift);
  for (const field of ['before', 'after', 'dropped', 'repeated']) byId(field).textContent = amount(result[field]);
  const [beforeWidth, afterWidth] = barWidths(result.before, result.after);
  byId('before-bar').style.width = beforeWidth;
  byId('after-bar').style.width = afterWidth;
  byId('output-rows').textContent = integer.format(result.outputRows);
  byId('repeat-detail').textContent = count(result.extraRows, 'extra row');
  byId('drop-detail').textContent = count(result.unmatchedLeft, 'unmatched row') + (config.join === 'inner' ? ' removed' : ' kept');
  byId('input-detail').textContent = 'From ' + count(result.leftRows, 'left row');
  byId('suggestion').hidden = !(state.demo === 'regional' && state.keys.length === 1 &&
    state.keys[0].left === 'customer_id' && state.keys[0].right === 'customer_id');
  byId('key-count').textContent = (result.keys.length < result.keyCount
    ? 'Top ' + integer.format(result.keys.length) + ' of ' : '') + count(result.keyCount, 'key');
  byId('key-header').textContent = state.keys.map(key => key.left).join(' + ');
  const rows = result.keys.map((key) => {
    const tr = element('tr', /[1-9]/.test(key.delta) ? 'drift-row' : '');
    const keyCell = element('td');
    key.values.forEach((value, i) => {
      if (i) keyCell.append(element('span', 'key-part-separator', '·'));
      keyCell.append(element('span', 'key-value', value === '' ? '(empty)' : value));
    });
    tr.append(keyCell);
    for (const value of [key.leftRows, key.rightRows, key.outputRows]) tr.append(element('td', '', integer.format(value)));
    tr.append(element('td', '', amount(key.delta, true)));
    return tr;
  });
  byId('key-body').replaceChildren(...rows);
  byId('no-keys').hidden = result.keyCount !== 0;
  byId('more').hidden = result.keys.length >= result.keyCount;
  byId('analysis-error').hidden = true;
  byId('report').hidden = false;
  byId('export').disabled = false;
  byId('status').textContent = 'Net change ' + net.textContent + ' across ' + count(result.outputRows, 'output row') + '.';
}

function update(resetLimit = false) {
  if (resetLimit) state.limit = 30;
  const config = settings();
  try {
    const result = analyze(state.left, state.right, config);
    renderResult(result, config);
    state.report = result;
  } catch (error) {
    state.report = null;
    byId('report').hidden = true;
    byId('export').disabled = true;
    byId('analysis-error').textContent = error.message;
    byId('analysis-error').hidden = false;
    byId('status').textContent = '';
  }
}

function loadDemo(which) {
  const balanced = which === 'balanced';
  loadTables(parseCSV(balanced ? balancedLeftCSV : leftCSV), parseCSV(balanced ? balancedRightCSV : rightCSV),
    { left: 'orders.csv', right: 'customers.csv' }, balanced ? 'balanced' : 'regional');
}

function setDemoLink(which) {
  const url = new URL(location.href);
  url.hash = which === 'balanced' ? 'balanced' : '';
  // Some hosts restrict history updates for local files. The current view
  // remains usable there and the original #balanced link still opens.
  try { history.replaceState(null, '', url.href); } catch { /* local-only fallback */ }
}

byId('measure').addEventListener('change', () => update(true));
byId('nulls').addEventListener('change', () => update(true));
for (const radio of document.querySelectorAll('input[name="join"]')) radio.addEventListener('change', () => update(true));
byId('add-key').addEventListener('click', () => {
  const key = nextKey();
  if (!key) return;
  state.keys.push(key);
  renderKeys();
  byId('key-inputs').lastElementChild.querySelector('select').focus();
  update(true);
});
byId('region-key').addEventListener('click', () => {
  state.keys.push({ left: 'region', right: 'region' });
  renderKeys();
  update(true);
  byId('export').focus({ preventScroll: true });
});
byId('more').addEventListener('click', () => { state.limit += 30; update(); });
byId('example').addEventListener('change', () => {
  const which = byId('example').value;
  loadDemo(which);
  setDemoLink(which);
});
window.addEventListener('hashchange', () => loadDemo(location.hash === '#balanced' ? 'balanced' : 'regional'));
byId('toggle-settings').addEventListener('click', () => {
  const open = byId('setup-body').classList.toggle('open');
  byId('toggle-settings').setAttribute('aria-expanded', String(open));
  byId('toggle-settings').textContent = open ? 'Hide setup' : 'Edit setup';
});

byId('export').addEventListener('click', () => {
  if (!state.report) return;
  const config = settings();
  const fullConfig = { ...config, limit: Math.max(1, state.report.keyCount) };
  const result = state.report.keyCount > state.report.keys.length ? analyze(state.left, state.right, fullConfig) : state.report;
  const content = { sources: state.names, options: fullConfig, report: result };
  const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2) + '\n'], { type: 'application/json' }));
  const link = element('a');
  link.href = url;
  link.download = 'jointally-report.json';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

function importError(message = '') {
  byId('import-error').textContent = message;
  byId('import-error').hidden = !message;
}

byId('import').addEventListener('click', () => {
  byId('import-form').reset();
  importError();
  pending.clear();
  byId('load').disabled = false;
  for (const side of tableSides) {
    draftNames[side] = side + '.csv';
    uploadedText[side] = null;
    readSequence[side]++;
  }
  dialog.showModal();
});
byId('cancel').addEventListener('click', () => dialog.close());
byId('import-cancel').addEventListener('click', () => dialog.close());
for (const side of tableSides) {
  const fileInput = byId(side + '-file');
  const text = byId(side + '-text');
  text.addEventListener('input', () => {
    readSequence[side]++;
    fileInput.value = '';
    draftNames[side] = side + '.csv';
    uploadedText[side] = null;
    pending.delete(side);
    byId('load').disabled = pending.size > 0;
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const sequence = ++readSequence[side];
    uploadedText[side] = null;
    text.value = '';
    pending.add(side);
    byId('load').disabled = true;
    importError();
    try {
      const contents = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      if (sequence !== readSequence[side]) return;
      text.value = contents;
      uploadedText[side] = contents;
      draftNames[side] = file.name;
    } catch {
      if (sequence === readSequence[side]) importError('Could not read ' + file.name + ' as UTF-8. Choose a UTF-8 CSV or paste its contents.');
    } finally {
      if (sequence === readSequence[side]) {
        pending.delete(side);
        byId('load').disabled = pending.size > 0;
      }
    }
  });
}
byId('import-form').addEventListener('submit', event => {
  event.preventDefault();
  if (pending.size) return;
  try {
    const parsed = tableSides.map((side) => {
      try { return parseCSV(uploadedText[side] ?? byId(side + '-text').value); }
      catch (error) { throw new Error((side === 'left' ? 'Left' : 'Right') + ' CSV: ' + error.message); }
    });
    loadTables(parsed[0], parsed[1], { ...draftNames }, false);
    setDemoLink(false);
    dialog.close();
  } catch (error) {
    importError(error.message);
  }
});

loadDemo(location.hash === '#balanced' ? 'balanced' : 'regional');
