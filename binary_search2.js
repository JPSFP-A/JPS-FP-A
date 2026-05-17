// Binary search for exact error location using node --check
// Strategy: test the full file but with everything after line N replaced by '}}}'
// to close any open constructs. If lines 1..N with padding pass, the error is after N.
// If they fail, the error is at or before N.

const fs = require('fs');
const { execSync } = require('child_process');
const lines = fs.readFileSync('fpa_check.js', 'utf8').split('\n');

function testUpTo(n) {
  // Write the first n lines to a temp file, no padding
  // We wrap in try-catch at the beginning to handle partial code
  const content = lines.slice(0, n).join('\n');
  fs.writeFileSync('_bsearch_tmp.js', content);
  try {
    const result = execSync('node --check _bsearch_tmp.js 2>&1', { encoding: 'utf8' });
    return { ok: true, msg: '' };
  } catch (e) {
    const out = e.stdout || e.stderr || '';
    return { ok: false, msg: out.trim().split('\n').slice(0,3).join(' | ') };
  }
}

// We know the full file fails at line 8004.
// The real question: what is the last line where the REPORTED error changes from
// "unexpected end of input" (truncation artifact) to our specific error?
// Let's test bigger chunks to find where we first see the 'missing )' error

console.log('Searching for the point where error appears...');
for (let n = 7800; n <= 8010; n += 20) {
  const r = testUpTo(n);
  if (!r.ok) {
    const errLine = r.msg.match(/_bsearch_tmp\.js:(\d+)/)?.[1];
    console.log('n=' + n + ': FAIL at line ' + errLine + ' | ' + r.msg.substring(0, 80));
  } else {
    console.log('n=' + n + ': OK (truncated at line ' + n + ')');
  }
}
