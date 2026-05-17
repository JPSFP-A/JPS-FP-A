const fs = require('fs');
const src = fs.readFileSync('fpa_check.js', 'utf8');

let state = 'code';
let templateDepth = 0;
let exprBraceStack = [];
let lineNo = 1;
const templateStarts = [];

// Find the byte offset of JS line 14120 to start tracing from there
const lines = src.split('\n');
let byteOffset = 0;
for (let l = 0; l < 14119; l++) {
  byteOffset += lines[l].length + 1; // +1 for \n
}
const TRACE_FROM_LINE = 14120;
const TRACE_TO_LINE = 14150;

for (let i = 0; i < src.length; i++) {
  const c = src[i];
  const n = (i + 1 < src.length) ? src[i + 1] : '';

  if (c === '\n') {
    lineNo++;
    if (state === 'lineComment') state = 'code';
    else if (state === 'tmplExprLineComment') state = 'tmplExpr';
    continue;
  }

  // Trace mode
  const doTrace = (lineNo >= TRACE_FROM_LINE && lineNo <= TRACE_TO_LINE);
  const prevState = state;
  const prevDepth = templateDepth;
  const prevStack = JSON.stringify(exprBraceStack);

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

  if (doTrace && (state !== prevState || templateDepth !== prevDepth || JSON.stringify(exprBraceStack) !== prevStack)) {
    const cc = c.charCodeAt(0) > 127 ? ('U+' + c.charCodeAt(0).toString(16).toUpperCase()) : c;
    console.log('L' + lineNo + ' char[' + cc + ']: ' + prevState + '(d=' + prevDepth + ',s=' + prevStack + ') -> ' + state + '(d=' + templateDepth + ',s=' + JSON.stringify(exprBraceStack) + ')');
  }
}

console.log('\nFinal: state=' + state + ' depth=' + templateDepth);
if (templateStarts.length > 0) console.log('UNCLOSED at lines: ' + templateStarts.join(', '));
else console.log('All balanced.');
