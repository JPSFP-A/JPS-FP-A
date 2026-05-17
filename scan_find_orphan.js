const fs = require('fs');
const src = fs.readFileSync('fpa_check.js', 'utf8');

let state = 'code';
let templateDepth = 0;
let exprBraceStack = [];
let lineNo = 1;
const templateStarts = [];

// Track every time depth changes, collect in a history
const history = []; // { lineNo, event, depth }

for (let i = 0; i < src.length; i++) {
  const c = src[i];
  const n = (i + 1 < src.length) ? src[i + 1] : '';

  if (c === '\n') {
    lineNo++;
    if (state === 'lineComment') state = 'code';
    else if (state === 'tmplExprLineComment') state = 'tmplExpr';
    continue;
  }

  switch (state) {
    case 'code':
      if (c === '/' && n === '/') { state = 'lineComment'; break; }
      if (c === '/' && n === '*') { state = 'blockComment'; break; }
      if (c === '"')  { state = 'dblStr'; break; }
      if (c === "'")  { state = 'sglStr'; break; }
      if (c === '`') {
        templateDepth++;
        exprBraceStack.push(0);
        templateStarts.push(lineNo);
        state = 'template';
        history.push({ line: lineNo, event: 'OPEN', depth: templateDepth });
      }
      break;

    case 'lineComment': break;
    case 'blockComment':
      if (c === '*' && n === '/') { state = 'code'; i++; }
      break;

    case 'dblStr':
      if (c === '\\') { i++; break; }
      if (c === '"') state = 'code';
      break;

    case 'sglStr':
      if (c === '\\') { i++; break; }
      if (c === "'") state = 'code';
      break;

    case 'template':
      if (c === '\\') { i++; break; }
      if (c === '`') {
        const openedAt = templateStarts.pop();
        templateDepth--;
        exprBraceStack.pop();
        history.push({ line: lineNo, event: 'CLOSE (opened line ' + openedAt + ')', depth: templateDepth });
        state = (exprBraceStack.length > 0 && exprBraceStack[exprBraceStack.length-1] > 0) ? 'tmplExpr' : 'code';
      } else if (c === '$' && n === '{') {
        i++;
        exprBraceStack.push(1);
        state = 'tmplExpr';
      }
      break;

    case 'tmplExpr':
      if (c === '/' && n === '/') { state = 'tmplExprLineComment'; break; }
      if (c === '/' && n === '*') { state = 'tmplExprBlockComment'; break; }
      if (c === '"')  { state = 'tmplExprDblStr'; break; }
      if (c === "'")  { state = 'tmplExprSglStr'; break; }
      if (c === '`') {
        templateDepth++;
        exprBraceStack.push(0);
        templateStarts.push(lineNo);
        state = 'template';
        history.push({ line: lineNo, event: 'OPEN (nested)', depth: templateDepth });
        break;
      }
      if (c === '{') {
        exprBraceStack[exprBraceStack.length - 1]++;
      } else if (c === '}') {
        exprBraceStack[exprBraceStack.length - 1]--;
        if (exprBraceStack[exprBraceStack.length - 1] === 0) {
          exprBraceStack.pop();
          state = 'template';
        }
      }
      break;

    case 'tmplExprLineComment': break;
    case 'tmplExprBlockComment':
      if (c === '*' && n === '/') { state = 'tmplExpr'; i++; }
      break;
    case 'tmplExprDblStr':
      if (c === '\\') { i++; break; }
      if (c === '"') state = 'tmplExpr';
      break;
    case 'tmplExprSglStr':
      if (c === '\\') { i++; break; }
      if (c === "'") state = 'tmplExpr';
      break;
  }
}

// Find the "orphaned" template: an OPEN that never got a matching CLOSE before line 14163
// Print last 30 events before line 14163 to see the pattern
const before14163 = history.filter(h => h.line < 14163);
console.log('Last 40 open/close events before line 14163:');
before14163.slice(-40).forEach(h => {
  console.log('  Line ' + h.line + ': ' + h.event + '  (depth now=' + h.depth + ')');
});

// Find any opens that don't have matching closes (depth stays > 0 after CLOSE)
// The "orphaned" one is the last OPEN that brought depth to 1 without a subsequent CLOSE to 0
const opens = before14163.filter(h => h.event.startsWith('OPEN'));
const closes = before14163.filter(h => h.event.startsWith('CLOSE'));
console.log('\nTotal OPENs before 14163: ' + opens.length);
console.log('Total CLOSEs before 14163: ' + closes.length);
console.log('Net open: ' + (opens.length - closes.length));

if (opens.length > closes.length) {
  // Find the unmatched opens
  let net = 0;
  const stack = [];
  before14163.forEach(h => {
    if (h.event.startsWith('OPEN')) { net++; stack.push(h); }
    else { net--; stack.pop(); }
  });
  console.log('\nUnmatched open(s):');
  stack.forEach(h => console.log('  Opened at JS line ' + h.line));
}
