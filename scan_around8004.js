const fs = require('fs');
const lines = fs.readFileSync('fpa_check.js', 'utf8').split('\n');

// Find template literal activity near line 8004
for (let i = 7850; i < 8005; i++) {
  const line = lines[i];
  const opens = (line.match(/\$\{/g)||[]).length;
  const backticks = (line.match(/`/g)||[]).length;
  if (opens > 0 || backticks > 0) {
    console.log((i+1) + ' [bt=' + backticks + ',${=' + opens + ']: ' + line.substring(0,120));
  }
}
