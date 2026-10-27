const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

/**
 * Replaces the first exact occurrence of `search` in `file`.
 *
 * The repository mixes LF and CRLF line endings, so the match is performed on an
 * LF-normalised copy and the index is mapped back to the original buffer. Only
 * the matched span is rewritten, leaving every other byte (and its line ending)
 * untouched.
 */
function patch(file, search, replace) {
  const target = path.join(root, file);
  const original = fs.readFileSync(target, 'utf8');

  const normalised = [];
  const map = [];
  for (let i = 0; i < original.length; i++) {
    const char = original[i];
    if (char === '\r') {
      if (original[i + 1] === '\n') continue;
      // Lone CR: treat as content so nothing is silently dropped.
    }
    map.push(i);
    normalised.push(char);
  }
  const flat = normalised.join('');
  const from = flat.indexOf(search);
  if (from < 0) throw new Error(`anchor not found in ${file}: ${search.slice(0, 60).replace(/\n/g, ' ')}`);

  const start = map[from];
  const end = map[from + search.length - 1] + 1;
  const span = original.slice(start, end);
  const eol = span.includes('\r\n') ? '\r\n' : '\n';
  const output = original.slice(0, start) + replace.split('\n').join(eol) + original.slice(end);
  fs.writeFileSync(target, output, 'utf8');
  console.log('patched', file);
}

module.exports = { patch };


