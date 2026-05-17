// Start from line 8004 and work backwards.
// Check if the 'missing ) after argument list' error appears in lines [start..8004]
// by wrapping in a function.

const fs = require('fs');
const { execSync } = require('child_process');
const lines = fs.readFileSync('fpa_check.js', 'utf8').split('\n');

const ERROR_LINE = 8004; // 1-indexed

function testRange(start, end) {
  // Wrap in a function to provide some context closure
  const chunk = 'void function(){\n' + lines.slice(start - 1, end).join('\n') + '\n}()';
  fs.writeFileSync('_range_tmp.js', chunk);
  try {
    execSync('node --check _range_tmp.js 2>&1', { encoding: 'utf8', stdio: 'pipe' });
    return { ok: true };
  } catch (e) {
    const out = (e.stdout || '') + (e.stderr || '');
    // Check if it's the specific 'missing )' error
    if (out.includes('missing ) after argument list')) {
      const errLine = out.match(/_range_tmp\.js:(\d+)/)?.[1];
      return { ok: false, type: 'MISSING_PAREN', line: errLine, msg: out.trim().split('\n').slice(0,5).join(' | ') };
    }
    return { ok: false, type: 'other', msg: out.trim().split('\n').slice(0,2).join(' | ') };
  }
}

// First verify: does a small window at line 8004 show the error?
console.log('Testing window ending at 8004...');
for (let start = 7800; start <= 8004; start += 100) {
  const r = testRange(start, 8004);
  console.log('  [' + start + '-8004]: ' + (r.ok ? 'OK' : r.type + ' ' + (r.line || '') + ' | ' + (r.msg||'').substring(0,60)));
}

// If MISSING_PAREN shows up: binary search for earliest start that triggers it
console.log('\nNarrowing down start of problem...');
let lo = 7700, hi = 8004;
// First find a range that triggers MISSING_PAREN
const full = testRange(1, 8004);
console.log('Full [1-8004] result:', full.type, full.line);
