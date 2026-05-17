const fs = require('fs');
const lines = fs.readFileSync('fpa_check.js', 'utf8').split('\n');
const line = lines[8003]; // JS line 8004 (0-indexed)

console.log('Line length:', line.length);
console.log('Last 80 chars:', JSON.stringify(line.slice(-80)));

let parens = 0, braces = 0, brackets = 0;
let inStr = false, strChar = '';

for (let i = 0; i < line.length; i++) {
  const c = line[i];
  if (inStr) {
    if (c === '\\') { i++; continue; } // escape next char
    if (c === strChar) { inStr = false; }
    continue;
  }
  if (c === "'" || c === '"') { inStr = true; strChar = c; continue; }
  if (c === '`') {
    console.log('BACKTICK at pos ' + i + '!');
    continue;
  }
  if (c === '(') parens++;
  else if (c === ')') { parens--; if (parens < 0) { console.log('PAREN NEGATIVE at pos ' + i + ' context: ...' + line.substring(Math.max(0,i-20),i+20) + '...'); } }
  else if (c === '{') braces++;
  else if (c === '}') {
    braces--;
    if (braces < 0) {
      console.log('BRACE NEGATIVE at pos ' + i + ':');
      console.log('  Context: ...' + line.substring(Math.max(0,i-30),i+30) + '...');
      console.log('  parens=' + parens + ' braces=' + braces + ' brackets=' + brackets);
      // Don't break - keep going to get full picture
    }
  }
  else if (c === '[') brackets++;
  else if (c === ']') { brackets--; }
}

console.log('\nFinal: parens=' + parens + ' braces=' + braces + ' brackets=' + brackets);

// Count all { and } separately
let totalOpen = (line.match(/\{/g)||[]).length;
let totalClose = (line.match(/\}/g)||[]).length;
let strippedLine = line.replace(/'[^']*'/g, "''"); // strip single-quoted strings
let openInCode = (strippedLine.match(/\{/g)||[]).length;
let closeInCode = (strippedLine.match(/\}/g)||[]).length;
console.log('Raw { count:', totalOpen, '} count:', totalClose);
console.log('After stripping single-quoted strings: { =', openInCode, '} =', closeInCode);
