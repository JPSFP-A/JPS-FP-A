// Isolated test of JS lines 8000-8004
void function(){
const yr = 2026, labels = [], _pData = x => x, bO = () => ({}), _TC = {muted:'', grid:''}, toK = v => v;
const depreciationComponents = {};
{const _dc=depreciationComponents[yr]||depreciationComponents[2026]||{};
const _dk=['faRegister','sjpc','otherLeases','capexTransfers','capitalSpares','decommissioning','strandedMeters','strandedLights','impairment'];
const _dl=['FA Register','SJPC','Leases','CX Transfers','Cap Spares','Decommission.','Str. Meters','Str. Lights','Impairment'];
const _dclr=['rgba(139,92,246,.8)','rgba(59,130,246,.8)','rgba(16,185,129,.8)','rgba(245,158,11,.8)','rgba(239,68,68,.8)','rgba(20,184,166,.8)','rgba(249,115,22,.8)','rgba(168,85,247,.8)','rgba(236,72,153,.8)'];
mkChart('cDep',{type:'bar',data:{labels,datasets:_dk.map((k,i)=>({label:_dl[i],data:_pData((_dc[k]||Array(12).fill(0)).map(v=>Math.round(v/1000))),backgroundColor:_dclr[i],stack:'s'}))},options:{...bO(),plugins:{legend:{labels:{color:_TC.muted,font:{size:8},boxWidth:8}}},scales:{x:{ticks:{color:_TC.muted,font:{size:9}},grid:{color:'rgba(255,255,255,.025)'},stacked:true},y:{stacked:true,ticks:{color:_TC.muted,font:{size:9},callback:v=>toK(v)},grid:{color:'rgba(255,255,255,.035)'}}}}}});}
}()
