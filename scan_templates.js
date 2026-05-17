const fs = require('fs');
const src = fs.readFileSync('fpa_check.js', 'utf8');

let state = 'code';
let templateDepth = 0;
let exprBraceStack = []; // per-open-template: current brace depth inside ${ }
let lineNo = 1;
let maxTemplateDepth = 0;
let deepestAt = 0;
const anomalies = [];
const templateStarts = [];

for (let i = 0; i < src.length; i++) {
  const c = src[i];
  const n = (i + 1 < src.length) ? src[i + 1] : '';

  // Newline — always increment line counter and handle state transitions
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
        if (templateDepth > maxTemplateDepth) { maxTemplateDepth = templateDepth; deepestAt = lineNo; }
        if (templateDepth > 3) anomalies.push('Line ' + lineNo + ': opened template at depth=' + templateDepth);
      }
      break;

    case 'lineComment':
      // newlines handled above
      break;

    case 'blockComment':
      if (c === '*' && n === '/') { state = 'code'; i++; }
      break;

    case 'dblStr':
      if (c === '\\') { i++; break; }  // skip escaped char
      if (c === '"') state = 'code';
      break;

    case 'sglStr':
      if (c === '\\') { i++; break; }
      if (c === "'") state = 'code';
      break;

    case 'template':
      if (c === '\\') { i++; break; }  // escaped char inside template
      if (c === '`') {
        // Close this template
        templateStarts.pop();
        templateDepth--;
        exprBraceStack.pop();
        if (templateDepth < 0) {
          anomalies.push('Line ' + lineNo + ': EXTRA closing backtick (depth went negative)');
          templateDepth = 0;
          state = 'code';
        } else {
          // If we were in a nested template inside a ${...} expression, go back to tmplExpr
          state = (exprBraceStack.length > 0) ? 'tmplExpr' : 'code';
        }
      } else if (c === '$' && n === '{') {
        i++; // consume the '{'
        // Push a new brace depth counter for this expression
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
        // Nested template literal inside ${...}
        templateDepth++;
        exprBraceStack.push(0);
        templateStarts.push(lineNo);
        state = 'template';
        if (templateDepth > maxTemplateDepth) { maxTemplateDepth = templateDepth; deepestAt = lineNo; }
        if (templateDepth > 3) anomalies.push('Line ' + lineNo + ': nested template at depth=' + templateDepth);
        break;
      }
      if (c === '{') {
        exprBraceStack[exprBraceStack.length - 1]++;
      } else if (c === '}') {
        exprBraceStack[exprBraceStack.length - 1]--;
        if (exprBraceStack[exprBraceStack.length - 1] === 0) {
          // This '}' closes the ${ ... } expression
          exprBraceStack.pop();
          state = 'template';
        }
      }
      break;

    case 'tmplExprLineComment':
      // newlines handled above
      break;
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

console.log('=== Template Literal Scan Results ===');
console.log('Final state     : ' + state);
console.log('templateDepth   : ' + templateDepth);
console.log('exprBraceStack  : ' + JSON.stringify(exprBraceStack));
console.log('Max depth reached: ' + maxTemplateDepth + ' at JS line ' + deepestAt);

if (templateStarts.length > 0) {
  console.log('\nUNCLOSED template literals (still open at EOF):');
  templateStarts.forEach(l => console.log('  Opened at JS line ' + l));
} else {
  console.log('\nAll template literals balanced (none left open).');
}

if (anomalies.length > 0) {
  console.log('\nAnomalies (depth > 3):');
  anomalies.forEach(a => console.log('  ' + a));
} else {
  console.log('No depth-4+ anomalies.');
}
