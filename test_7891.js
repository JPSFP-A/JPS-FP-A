// Test the template literal at lines 7891-7898
function test(el, n, actTotal, leYTD, varD, varPct, varGood, actSGA, actMaint) {
  el.innerHTML=`<div style="display:flex;gap:10px;flex-wrap:wrap;padding:8px 12px;border-radius:5px;border:1px solid var(--border);background:var(--card2);font-size:11px">
    <span style="color:var(--muted)">YTD Actuals (${n} mo):</span>
    ${actTotal!=null?`<span><strong style="color:var(--text)">Total OpEx Actual:</strong> <span style="color:var(--green)">$${Math.round(actTotal).toLocaleString()}K</span></span>
    <span><strong style="color:var(--text)">LE:</strong> $${Math.round(leYTD).toLocaleString()}K</span>
    <span style="color:${varGood?'var(--green)':'var(--red)'}"><strong>Var: ${varD!=null?(varD>0?'+':'')+Math.round(varD).toLocaleString()+'K':'-'}</strong> (${varPct||'–'}%${varGood?' Fav':' Adv'})</span>`
    :`<span style="color:var(--muted)">OpEx actuals not available in uploaded file — check P&L sheet rows 15-17.</span>`}
    ${actSGA!=null?`<span style="color:var(--muted)">SG&A: $${Math.round(actSGA).toLocaleString()}K | Maint: $${Math.round(actMaint||0).toLocaleString()}K</span>`:''}
  </div>`;
}
