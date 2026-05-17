const fs = require('fs');
const src = fs.readFileSync('fpa_check.js', 'utf8');

let state = 'code';
let templateDepth = 0;
let exprBraceStack = [];
let lineNo = 1;
const templateStarts = [];

// Debug: log transitions around line 14155-14166
const DEBUG_START = 14155;
const DEBUG_END = 14166;

for (let i = 0; i < src.length; i++) {
  const c = src[i];
  const n = (i + 1 < src.length) ? src[i + 1] : '';

  if (c === '\n') {
    lineNo++;
    if (state === 'lineComment') state = 'code';
    else if (state === 'tmplExprLineComment') state = 'tmplExpr';
    continue;
  }

  const prevState = state;
  const prevDepth = templateDepth;

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
        templateStarts.pop();
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

  // Log significant transitions in debug range
  if (lineNo >= DEBUG_START && lineNo <= DEBUG_END) {
    if (state !== prevState || templateDepth !== prevDepth) {
      console.log('Line ' + lineNo + ' char [' + c + ']: ' + prevState + '(d=' + prevDepth + ') -> ' + state + '(d=' + templateDepth + ')  stack=' + JSON.stringify(exprBraceStack));
    }
  }
}

console.log('\nFinal: state=' + state + ' depth=' + templateDepth + ' stack=' + JSON.stringify(exprBraceStack));
if (templateStarts.length > 0) {
  console.log('UNCLOSED at lines: ' + templateStarts.join(', '));
}
