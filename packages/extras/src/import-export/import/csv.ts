/**
 * The rows of a CSV file as exports write them (RFC 4180): commas between values, and quotes
 * around a value with commas, quotes or line breaks in it, its quotes doubled. Blank lines are
 * left out.
 */
export function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  const endRow = () => {
    row.push(value);
    if (row.length > 1 || value !== '') rows.push(row);
    row = [];
    value = '';
  };
  for (let at = 0; at < text.length; at += 1) {
    const char = text.charAt(at);
    if (quoted) {
      if (char !== '"') value += char;
      else if (text.charAt(at + 1) === '"') {
        value += '"';
        at += 1;
      } else quoted = false;
    } else if (char === '"' && value === '') quoted = true;
    else if (char === ',') {
      row.push(value);
      value = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text.charAt(at + 1) === '\n') at += 1;
      endRow();
    } else value += char;
  }
  if (value !== '' || row.length > 0) endRow();
  return rows;
}
