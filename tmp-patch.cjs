const fs = require('fs');
const path = require('path');
function patch(file, fn) {
  const p = path.normalize(file);
  const c = fs.readFileSync(p, 'utf8');
  const n = fn(c);
  if (n === c) { console.log('NO-CHANGE ' + p); return; }
  fs.writeFileSync(p, n, 'utf8');
  console.log('patched ' + p);
}
module.exports = { patch };