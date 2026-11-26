/** Parse a delimited UTF-8 text table, retaining every field as a string. */
export function parseCSV(text, delimiter = ',') {
  if (typeof text !== 'string') throw new TypeError('CSV input must be a string.');
  if (typeof delimiter !== 'string' || delimiter.length !== 1 || /["\r\n]/u.test(delimiter)) {
    throw new Error('The delimiter must be one character other than a quote or newline.');
  }
  const rows = [];
  let offset = text.startsWith('\uFEFF') ? 1 : 0;

  const newlineAt = (i) => text[i] === '\r' || text[i] === '\n';
  const nextLine = (i) => i + (text.startsWith('\r\n', i) ? 2 : 1);
  const fail = (message, i) => {
    throw new Error(`CSV record ${rows.length + 1}, character ${i + 1}: ${message}`);
  };

  while (offset < text.length) {
    // A truly empty line is skipped. A quoted empty string is a real field.
    if (newlineAt(offset)) {
      offset = nextLine(offset);
      continue;
    }
    const row = [];
    while (true) {
      if (text[offset] === '"') {
        const openingQuote = offset++;
        let start = offset;
        const pieces = [];
        while (true) {
          const quote = text.indexOf('"', offset);
          if (quote < 0) fail('unclosed quoted field.', openingQuote);
          pieces.push(text.slice(start, quote));
          offset = quote + 1;
          if (text[offset] !== '"') break;
          pieces.push('"');
          start = ++offset;
        }
        if (offset < text.length && text[offset] !== delimiter && !newlineAt(offset)) {
          fail('expected a delimiter or newline after the closing quote.', offset);
        }
        row.push(pieces.join(''));
      } else {
        const start = offset;
        while (offset < text.length && text[offset] !== delimiter && !newlineAt(offset)) {
          if (text[offset] === '"') fail('unexpected quote inside an unquoted field.', offset);
          offset++;
        }
        row.push(text.slice(start, offset));
      }
      if (text[offset] !== delimiter) break;
      offset++;
    }
    rows.push(row);
    if (offset < text.length) offset = nextLine(offset);
  }
  return rows;
}
