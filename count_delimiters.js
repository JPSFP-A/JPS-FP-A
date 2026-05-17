const line = `mkChart('cDep',{type:'bar',data:{labels,datasets:_dk.map((k,i)=>({label:_dl[i],data:_pData((_dc[k]||Array(12).fill(0)).map(v=>Math.round(v/1000))),backgroundColor:_dclr[i],stack:'s'}))},options:{...bO(),plugins:{legend:{labels:{color:_TC.muted,font:{size:8},boxWidth:8}}},scales:{x:{ticks:{color:_TC.muted,font:{size:9}},grid:{color:'rgba(255,255,255,.025)'},stacked:true},y:{stacked:true,ticks:{color:_TC.muted,font:{size:9},callback:v=>toK(v)},grid:{color:'rgba(255,255,255,.035)'}}}}}});`;

let parens = 0, braces = 0, brackets = 0;
let inStr = false, strChar = '';

for (let i = 0; i < line.length; i++) {
  const c = line[i];
  if (inStr) {
    if (c === '\\') { i++; continue; }
    if (c === strChar) inStr = false;
    continue;
  }
  if (c === "'" || c === '"') { inStr = true; strChar = c; continue; }
  if (c === '`') { console.log('BACKTICK at pos ' + i + '!'); continue; }
  if (c === '(') parens++;
  else if (c === ')') parens--;
  else if (c === '{') braces++;
  else if (c === '}') braces--;
  else if (c === '[') brackets++;
  else if (c === ']') brackets--;

  if (parens < 0 || braces < 0 || brackets < 0) {
    console.log('NEGATIVE at pos ' + i + ': ' + c + ' parens=' + parens + ' braces=' + braces + ' brackets=' + brackets);
    console.log('Context: ...' + line.substring(Math.max(0,i-20), i+20) + '...');
    break;
  }
}

console.log('Final: parens=' + parens + ' braces=' + braces + ' brackets=' + brackets);
console.log('Line length: ' + line.length);
