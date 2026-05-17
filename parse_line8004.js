const fs = require('fs');
const lines = fs.readFileSync('fpa_check.js', 'utf8').split('\n');
const line = lines[8003]; // JS line 8004 (0-indexed)

// Full character-by-character trace of braces, showing context
let parens = 0, braces = 0;
let inStr = false, strChar = '';
let lastBraceEvents = [];

for (let i = 0; i < line.length; i++) {
  const c = line[i];
  if (inStr) {
    if (c === '\\') { i++; continue; }
    if (c === strChar) { inStr = false; }
    continue;
  }
  if (c === "'" || c === '"') { inStr = true; strChar = c; continue; }

  let changed = false;
  if (c === '(') { parens++; changed = true; }
  else if (c === ')') { parens--; changed = true; }
  else if (c === '{') { braces++; changed = true; }
  else if (c === '}') { braces--; changed = true; }

  if (changed) {
    const ctx = line.substring(Math.max(0, i-10), i+10).replace(/\r/g,'');
    lastBraceEvents.push({ pos: i, char: c, parens, braces, ctx });
  }
}

// Show last 15 events
console.log('Last 15 delimiter events:');
lastBraceEvents.slice(-15).forEach(e => {
  const warn = e.braces < 0 ? '  <<<< NEGATIVE' : '';
  console.log('  pos ' + e.pos + ' [' + e.char + '] p=' + e.parens + ' b=' + e.braces + ' ctx: ...' + e.ctx + '...' + warn);
});

console.log('\nFinal: parens=' + parens + ' braces=' + braces);
console.log('The line needs ' + (braces > 0 ? braces + ' more }' : -braces + ' fewer }') + ' and ' + (parens > 0 ? parens + ' more )' : -parens + ' fewer )'));

// Now let's count opens and closes separately for diagnosis
let openCount = 0, closeCount = 0;
inStr = false;
for (let i = 0; i < line.length; i++) {
  const c = line[i];
  if (inStr) {
    if (c === '\\') { i++; continue; }
    if (c === strChar) inStr = false;
    continue;
  }
  if (c === "'" || c === '"') { inStr = true; strChar = c; continue; }
  if (c === '{') openCount++;
  if (c === '}') closeCount++;
}
console.log('\n{ opens: ' + openCount + '  } closes: ' + closeCount + '  net: ' + (openCount - closeCount));
console.log('(Expected net for this line: -1 because the block { on line 8000 is closed here)');
console.log('(If net is -2 or more, there are extra } characters on this line)');
