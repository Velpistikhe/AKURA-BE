const { readdirSync, readFileSync, writeFileSync, existsSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const requested = process.argv.slice(2);
const files = requested.length ? requested : readdirSync(__dirname).filter(file => file.endsWith('-verification.cjs')).sort();
const results = [];
for (const file of files) {
  if (file === 'run-verification.cjs') continue;
  const started = Date.now();
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 180000 });
  const passed = result.status === 0 && !result.error;
  const entry = { file, passed, checkedAt: new Date().toISOString(), durationMs: Date.now() - started, ...(passed ? {} : { output: `${result.stdout || ''}\n${result.stderr || ''}\n${result.error?.message || ''}`.slice(-7000) }) };
  results.push(entry);
  console.log(`${passed ? 'PASS' : 'FAIL'} ${file} (${entry.durationMs}ms)`);
  if (!passed) console.log(entry.output);
}
const reportPath = path.join(__dirname, 'verification.last-run.json');
const previous = requested.length && existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : [];
const latest = new Map([...previous, ...results].map(result => [result.file, result]));
writeFileSync(reportPath, JSON.stringify([...latest.values()].sort((left, right) => left.file.localeCompare(right.file)), null, 2));
if (results.some(result => !result.passed)) process.exitCode = 1;
