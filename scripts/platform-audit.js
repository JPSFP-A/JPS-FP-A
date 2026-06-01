#!/usr/bin/env node
// JPS Platform Audit — runs via GitHub Actions daily at 6AM Jamaica
// Writes results to platform_audit_results table in Supabase

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TRIGGERED_BY = process.env.TRIGGERED_BY || 'schedule';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const RUN_ID = crypto.randomUUID();
const RUN_AT = new Date().toISOString();

const APPS = ['fpa', 'sales', 'om', 'capex', 'treasury', 'datamanager', 'admin'];

async function writeResult(checkName, checkType, app, status, message, details = null) {
  const { error } = await sb.from('platform_audit_results').insert({
    run_id: RUN_ID,
    run_at: RUN_AT,
    check_name: checkName,
    check_type: checkType,
    app,
    status,
    message,
    details,
    triggered_by: TRIGGERED_BY,
  });
  if (error) console.error(`[write] ${checkName}: ${error.message}`);
}

// ── Check 1: Login volume (last 24h) ─────────────────────────────────────────
async function checkLoginVolume() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  for (const app of APPS) {
    const { data, error } = await sb
      .from('fpa_audit_log')
      .select('user_id', { count: 'exact', head: false })
      .eq('app', app)
      .eq('action', 'login')
      .gte('created_at', since);

    if (error) {
      await writeResult('Login Volume', 'volume', app, 'warn', `Query error: ${error.message}`);
      continue;
    }
    const count = data?.length ?? 0;
    const status = count === 0 ? 'warn' : 'pass';
    const msg = count === 0
      ? 'No logins in last 24h'
      : `${count} login${count !== 1 ? 's' : ''} in last 24h`;
    await writeResult('Login Volume', 'volume', app, status, msg, { count });
  }
}

// ── Check 2: Null user_role in audit log (last 7d, exclude monitor events) ───
async function checkNullRoles() {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  for (const app of APPS) {
    const { data, error } = await sb
      .from('fpa_audit_log')
      .select('id,user_name,action')
      .eq('app', app)
      .is('user_role', null)
      .not('action', 'like', 'monitor:%')
      .gte('created_at', since)
      .limit(10);

    if (error) {
      await writeResult('Null Role Entries', 'data_quality', app, 'warn', `Query error: ${error.message}`);
      continue;
    }
    const count = data?.length ?? 0;
    const status = count === 0 ? 'pass' : 'warn';
    const msg = count === 0
      ? 'No null-role entries'
      : `${count} entries missing user_role`;
    await writeResult('Null Role Entries', 'data_quality', app, status, msg,
      { count, sample: (data || []).slice(0, 3).map(r => ({ user: r.user_name, action: r.action })) });
  }
}

// ── Check 3: Audit log write health (can we write?) ──────────────────────────
async function checkAuditWriteHealth() {
  const { error } = await sb.from('platform_audit_results').select('id').limit(1);
  const status = error ? 'fail' : 'pass';
  const msg = error ? `DB read failed: ${error.message}` : 'DB read/write accessible';
  await writeResult('DB Connectivity', 'health', 'all', status, msg);
}

// ── Check 4: Duplicate logins (same user, same app, <10s apart) ──────────────
async function checkDuplicateLogins() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from('fpa_audit_log')
    .select('user_id,app,created_at')
    .eq('action', 'login')
    .gte('created_at', since)
    .order('user_id')
    .order('app')
    .order('created_at');

  if (error) {
    await writeResult('Duplicate Logins', 'data_quality', 'all', 'warn', `Query error: ${error.message}`);
    return;
  }

  const dupes = [];
  const rows = data || [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1], curr = rows[i];
    if (prev.user_id === curr.user_id && prev.app === curr.app) {
      const diff = new Date(curr.created_at) - new Date(prev.created_at);
      if (diff < 10000) dupes.push({ user: curr.user_id, app: curr.app, gap_ms: diff });
    }
  }
  const status = dupes.length === 0 ? 'pass' : 'warn';
  const msg = dupes.length === 0 ? 'No duplicate logins detected' : `${dupes.length} duplicate login pairs`;
  await writeResult('Duplicate Logins', 'data_quality', 'all', status, msg, { count: dupes.length, sample: dupes.slice(0, 3) });
}

// ── Check 5: Monitor heartbeat gaps (last 24h) ────────────────────────────────
async function checkMonitorHeartbeats() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  for (const app of APPS) {
    const { data, error } = await sb
      .from('fpa_audit_log')
      .select('created_at')
      .eq('app', app)
      .like('action', 'monitor:%')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) continue;
    const last = data?.[0]?.created_at;
    const gapMin = last ? Math.floor((Date.now() - new Date(last)) / 60000) : null;
    const status = gapMin === null ? 'warn' : gapMin > 1440 ? 'warn' : 'pass';
    const msg = gapMin === null
      ? 'No monitor heartbeat in last 24h'
      : `Last heartbeat ${gapMin}m ago`;
    await writeResult('Monitor Heartbeat', 'health', app, status, msg, { gap_minutes: gapMin });
  }
}

// ── Check 6: fpa_facts data freshness ────────────────────────────────────────
async function checkFpaFactsFreshness() {
  const { data, error } = await sb
    .from('fpa_facts')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1);

  if (error) {
    await writeResult('FPA Facts Freshness', 'data_quality', 'fpa', 'warn', `Query error: ${error.message}`);
    return;
  }
  const last = data?.[0]?.updated_at;
  const ageDays = last ? Math.floor((Date.now() - new Date(last)) / 86400000) : null;
  const status = ageDays === null ? 'warn' : ageDays > 30 ? 'warn' : 'pass';
  const msg = ageDays === null ? 'No fpa_facts rows found' : `Last updated ${ageDays}d ago`;
  await writeResult('FPA Facts Freshness', 'data_quality', 'fpa', status, msg, { age_days: ageDays });
}

// ── Check 7: Unknown app codes in audit log (last 7d) ────────────────────────
async function checkUnknownApps() {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from('fpa_audit_log')
    .select('app')
    .gte('created_at', since)
    .not('app', 'in', `(${APPS.map(a => `"${a}"`).join(',')})`)
    .limit(20);

  if (error) {
    await writeResult('Unknown App Codes', 'data_quality', 'all', 'warn', `Query error: ${error.message}`);
    return;
  }
  const unknown = [...new Set((data || []).map(r => r.app).filter(Boolean))];
  const status = unknown.length === 0 ? 'pass' : 'warn';
  const msg = unknown.length === 0 ? 'All app codes recognised' : `Unknown apps: ${unknown.join(', ')}`;
  await writeResult('Unknown App Codes', 'data_quality', 'all', status, msg, { count: unknown.length, unknown });
}

// ── Check 8: jps_actuals data freshness (uses year+month, no updated_at col) ─
async function checkActualsFreshness() {
  const [countRes, latestRes] = await Promise.all([
    sb.from('jps_actuals').select('*', { count: 'exact', head: true }),
    sb.from('jps_actuals').select('year,month').order('year', { ascending: false }).order('month', { ascending: false }).limit(1),
  ]);

  if (countRes.error || latestRes.error) {
    const msg = (countRes.error || latestRes.error).message;
    await writeResult('Actuals Freshness', 'data_quality', 'fpa', 'warn', `Query error: ${msg}`);
    return;
  }
  const rows = countRes.count ?? 0;
  const last = latestRes.data?.[0];

  // Find the most recent period whose due date (month-end + 5 days) has already passed.
  // e.g. on June 1: May due date = June 5, not yet passed → expected period = April.
  //      on June 6: May due date = June 5, passed          → expected period = May.
  const now = new Date();
  let epYear = now.getFullYear(), epMonth = now.getMonth(); // getMonth() 0-indexed = last calendar month 1-indexed
  if (epMonth === 0) { epYear--; epMonth = 12; }
  const lastMonthEnd = new Date(epYear, epMonth, 0);
  const lastMonthDue = new Date(lastMonthEnd.getTime() + 5 * 86400000);
  if (now < lastMonthDue) {
    // Last month's due date hasn't passed yet; step back one more month
    epMonth--;
    if (epMonth === 0) { epMonth = 12; epYear--; }
  }

  const loadedKey = last ? last.year * 100 + last.month : 0;
  const expectedKey = epYear * 100 + epMonth;

  let status, msg;
  if (rows === 0) {
    status = 'warn';
    msg = 'No jps_actuals rows found';
  } else if (loadedKey < expectedKey) {
    status = 'warn';
    const ep = `${epYear}-${String(epMonth).padStart(2,'0')}`;
    const lp = `${last.year}-${String(last.month).padStart(2,'0')}`;
    msg = `${rows} rows — latest loaded ${lp}, expected ≥ ${ep}`;
  } else {
    const ageDays = Math.floor((now - new Date(last.year, last.month, 0)) / 86400000);
    status = 'pass';
    msg = `${rows} rows, latest period ${last.year}-${String(last.month).padStart(2,'0')} (${ageDays}d since month-end)`;
  }
  await writeResult('Actuals Freshness', 'data_quality', 'fpa', status, msg, { row_count: rows, latest_year: last?.year, latest_month: last?.month, expected_year: epYear, expected_month: epMonth });
}

// ── Check 10: fpa_dim_period — current period close status ───────────────────
async function checkPeriodStatus() {
  const { data, error } = await sb
    .from('fpa_dim_period')
    .select('year,month,is_closed,closed_at')
    .order('year', { ascending: false })
    .order('month', { ascending: false })
    .limit(1);

  if (error) {
    await writeResult('Period Status', 'data_quality', 'fpa', 'warn', `Query error: ${error.message}`);
    return;
  }
  const p = data?.[0];
  if (!p) {
    await writeResult('Period Status', 'data_quality', 'fpa', 'warn', 'No periods found in fpa_dim_period');
    return;
  }
  const today = new Date();
  const dayOfMonth = today.getDate();
  const isCurrent = p.year === today.getFullYear() && p.month === today.getMonth() + 1;
  // Warn if current month is still open after day 10
  const status = (isCurrent && !p.is_closed && dayOfMonth > 10) ? 'warn' : 'pass';
  const label = p.is_closed ? 'closed' : 'open';
  const msg = `${p.year}-${String(p.month).padStart(2,'0')}: ${label}`;
  await writeResult('Period Status', 'data_quality', 'fpa', status, msg, { year: p.year, month: p.month, is_closed: p.is_closed, day_of_month: dayOfMonth });
}

// ── Check 11: fpa_versions — stale drafts ────────────────────────────────────
async function checkDraftVersions() {
  const { data, error } = await sb
    .from('fpa_versions')
    .select('status')
    .eq('status', 'draft');

  if (error) {
    await writeResult('Draft Versions', 'data_quality', 'fpa', 'warn', `Query error: ${error.message}`);
    return;
  }
  const draftCount = data?.length ?? 0;
  const dayOfMonth = new Date().getDate();
  const status = (draftCount > 0 && dayOfMonth > 5) ? 'warn' : 'pass';
  const msg = draftCount === 0 ? 'No draft versions' : `${draftCount} draft version${draftCount !== 1 ? 's' : ''} open`;
  await writeResult('Draft Versions', 'data_quality', 'fpa', status, msg, { count: draftCount, day_of_month: dayOfMonth });
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`[audit] run_id=${RUN_ID} triggered_by=${TRIGGERED_BY}`);
  await Promise.all([
    checkLoginVolume(),
    checkNullRoles(),
    checkAuditWriteHealth(),
    checkDuplicateLogins(),
    checkMonitorHeartbeats(),
    checkFpaFactsFreshness(),
    checkUnknownApps(),
    checkActualsFreshness(),
    checkPeriodStatus(),
    checkDraftVersions(),
  ]);
  console.log('[audit] done');
}

main().catch(e => { console.error('[audit] fatal:', e.message); process.exit(1); });
