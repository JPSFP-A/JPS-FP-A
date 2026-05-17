const fs = require('fs');
const src = fs.readFileSync('fpa_check.js', 'utf8');

let state = 'code';
let templateDepth = 0;
let exprBraceStack = [];
let lineNo = 1;
const history = [];

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
        state = 'template';
        history.push({ line: lineNo, event: 'OPEN', depth: templateDepth, stack: JSON.stringify(exprBraceStack) });
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
        templateDepth--;
        const oldStack = JSON.stringify(exprBraceStack);
        exprBraceStack.pop();
        state = (exprBraceStack.length > 0 && exprBraceStack[exprBraceStack.length-1] > 0) ? 'tmplExpr' : 'code';
        history.push({ line: lineNo, event: 'CLOSE', depth: templateDepth, stack: oldStack });
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
        state = 'template';
        history.push({ line: lineNo, event: 'OPEN(nested)', depth: templateDepth, stack: JSON.stringify(exprBraceStack) });
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

// Find the net-open point by simulation
let netDepth = 0;
let lastUnclosedLine = 0;
const stack = [];
for (const ev of history) {
  if (ev.event.startsWith('OPEN')) {
    netDepth++;
    stack.push(ev.line);
    if (netDepth === 1) lastUnclosedLine = ev.line;
  } else {
    netDepth--;
    const matched = stack.pop();
    if (netDepth < 0) {
      console.log('EXTRA CLOSE at line ' + ev.line + ' (matching: ' + matched + ')');
      netDepth = 0;
    }
  }
  // When net depth goes back to 0, the chain resets cleanly; track when it next goes to 1
}

console.log('Final net depth: ' + netDepth);
if (stack.length > 0) {
  console.log('Unmatched opens: ' + stack.join(', '));
}

// Find where depth STAYS at 1 for a long time without closing
// (the first point where the scanner enters a template and doesn't exit)
let runningDepth = 0;
let runStart = 0;
let longestRun = 0;
let longestRunStart = 0;
let longestRunEnd = 0;

for (const ev of history) {
  if (ev.event.startsWith('OPEN')) {
    runningDepth++;
    if (runningDepth === 1) runStart = ev.line;
  } else {
    runningDepth--;
    if (runningDepth === 0) {
      const run = ev.line - runStart;
      if (run > longestRun) {
        longestRun = run;
        longestRunStart = runStart;
        longestRunEnd = ev.line;
      }
    }
  }
}

console.log('\nLongest template run: lines ' + longestRunStart + '-' + longestRunEnd + ' (' + longestRun + ' lines)');
console.log('(This is likely the unclosed template context)');

// Show all opens that span > 5 lines
console.log('\nLong-running opens (>5 lines):');
const opens = [];
for (const ev of history) {
  if (ev.event.startsWith('OPEN')) {
    opens.push(ev.line);
  } else {
    const openLine = opens.pop();
    const span = ev.line - openLine;
    if (span > 5) {
      console.log('  Opens at ' + openLine + ', closes at ' + ev.line + ' (' + span + ' lines)');
    }
  }
}
