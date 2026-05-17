
// ── Embedded assets (base64) ──────────────────────────
const JPS_LOGO_DATA = 'https://rvtaryvxiryfmurudjcx.supabase.co/storage/v1/object/public/Model/JPS-Logo-2022-Outline-No-Tag-2.png';
const WELCOME_BG_DATA = 'https://rvtaryvxiryfmurudjcx.supabase.co/storage/v1/object/public/Model/Welcome.jpg';

// ═══════════════════════════════════════════════════════
//  SUPABASE CONFIGURATION — Session 12
//  Reads from localStorage so credentials are never
//  hardcoded. Admin sets them once via Settings panel.
// ═══════════════════════════════════════════════════════
const _SB_PROJECT_REF = 'bhrswnbenkvflpdjhfpa'; // from existing storage URL

// Supabase credentials — anon/public key, safe to embed in client code
const _SB_URL     = 'https://bhrswnbenkvflpdjhfpa.supabase.co';
const _SB_ANON_KEY= 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJocnN3bmJlbmt2ZmxwZGpoZnBhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzMTc0OTcsImV4cCI6MjA5MTg5MzQ5N30.JupFs0tnMn3k282PqFOSMi2ch-wtB7Ewv7O8fN16-94';

let _sbConfig = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem('jps_sb_config') || '{}');
    return {
      url:     saved.url     || _SB_URL,
      anonKey: saved.anonKey || _SB_ANON_KEY,
      enabled: saved.enabled !== undefined ? saved.enabled : true,  // ON by default
    };
  } catch(e) { return { url: _SB_URL, anonKey: _SB_ANON_KEY, enabled: true }; }
})();

// Initialise client only when config is present
let _sb = null;
function _sbInit() {
  if (!_sbConfig.enabled || !_sbConfig.anonKey) return null;
  try {
    if (window.supabase && window.supabase.createClient) {
      _sb = window.supabase.createClient(_sbConfig.url, _sbConfig.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true },
        realtime: { params: { eventsPerSecond: 10 } }
      });
      console.log('[Supabase] Client initialised:', _sbConfig.url);
      return _sb;
    }
  } catch(e) { console.warn('[Supabase] Init failed:', e); }
  return null;
}

// Safe wrapper — surfaces errors to user via toast, never swallows silently
async function _sbQ(fn, { silent = false } = {}) {
  if (!_sb) return null;
  try { return await fn(_sb); } catch(e) {
    console.warn('[Supabase] Query error:', e);
    if (!silent) toast('DB error: ' + (e.message || 'Unknown error'), 'err');
    return null;
  }
}

// ═══════════════════════════════════════════════════════
//  FPA DATA-ACCESS LAYER  (Session 10)
//  All platform data loads from Supabase at bootstrap.
//  Hardcoded seed arrays are fallback only (offline mode).
// ═══════════════════════════════════════════════════════
const fpa = {
  // In-memory cache populated by bootstrap()
  versions: [],              // [{ id, code, kind, year, name, is_locked, ... }]
  activeVersionId: null,     // currently-selected version (for edits)
  lines: [],                 // [{ id, code, name, statement, section, ... }]
  facts: {},                 // facts[versionCode][lineId][periodId] = value
  assumptions: {},           // assumptions[versionCode][category][key][subKey][YYYYMM] = value
  leases: [],
  insurance: [],
  impairments: [],
  periods: [],               // [{ id, year, month, ym_label, is_closed }]
  roles: [],                 // [{ role_name, label, description, icon, is_system }]
  rolePermissions: {},       // rolePermissions[role_name][pane_id] = { can_view, can_edit }
  notifications: [],         // unread in-app notifications for current user
  loadedAt: null,
  loadError: null,

  // Lookup helpers ----------------------------------------
  v(code) {
    return this.versions.find(v => v.code === code);
  },
  vid(code) {
    return this.v(code)?.id || null;
  },
  versionsByKind(kind) {
    return this.versions.filter(v => v.kind === kind);
  },
  // Get fact value. (versionCode, lineId, year, month). Returns null if missing.
  fact(versionCode, lineId, year, month) {
    const per = year * 100 + month;
    return this.facts?.[versionCode]?.[lineId]?.[per] ?? null;
  },
  // Get annual fact total for a line/version
  factAnnual(versionCode, lineId, year) {
    const byLine = this.facts?.[versionCode]?.[lineId];
    if (!byLine) return null;
    let sum = 0, any = false;
    for (let m = 1; m <= 12; m++) {
      const v = byLine[year * 100 + m];
      if (v !== undefined) { sum += Number(v); any = true; }
    }
    return any ? sum : null;
  },
  // Get 12-month array for a line/version/year
  factMonthly(versionCode, lineId, year) {
    const byLine = this.facts?.[versionCode]?.[lineId] || {};
    const out = [];
    for (let m = 1; m <= 12; m++) out.push(byLine[year * 100 + m] ?? 0);
    return out;
  },
  // Get assumption 12-month array
  assumpMonthly(versionCode, category, key, subKey, year) {
    const src = this.assumptions?.[versionCode]?.[category]?.[key]?.[subKey || ''];
    if (!src) return null;
    const out = [];
    for (let m = 1; m <= 12; m++) out.push(src[year * 100 + m] ?? 0);
    return out;
  },
  // Get annual-only (year, month=null) assumption
  assumpAnnual(versionCode, category, key, subKey, year) {
    return this.assumptions?.[versionCode]?.[category]?.[key]?.[subKey || '']?.[year * 100] ?? null;
  },
  // Returns true if the period is marked is_closed in fpa_dim_period
  isPeriodClosed(year, month) {
    return this.periods.some(p => p.year === year && p.month === month && p.is_closed);
  },
  // Returns the latest open (not closed) month for a year, or null if all closed/none
  latestClosedMonth(year) {
    const closed = this.periods.filter(p => p.year === year && p.is_closed).map(p => p.month);
    return closed.length ? Math.max(...closed) : 0;
  },
};

// ── Load orchestration ────────────────────────────────
async function fpaBootstrap() {
  if (!_sb) {
    fpa.loadError = 'Supabase client not available — using seed data';
    console.warn('[FPA]', fpa.loadError);
    _updateDbStatusBadge();
    return false;
  }
  const t0 = performance.now();
  try {
    showBootstrapOverlay('Connecting to Supabase...');

    // Parallel fetch everything
    showBootstrapOverlay('Loading versions & lines...');
    const [versionsRes, linesRes, periodsRes, rolesRes, rolePermsRes] = await Promise.all([
      _sb.from('fpa_versions').select('*').order('code'),
      _sb.from('fpa_dim_line').select('*').order('statement').order('sort_order'),
      _sb.from('fpa_dim_period').select('*').order('id'),
      _sb.from('fpa_custom_roles').select('*').order('role_name'),
      _sb.from('fpa_role_permissions').select('*'),
    ]);
    if (versionsRes.error) throw versionsRes.error;
    if (linesRes.error)    throw linesRes.error;
    if (periodsRes.error)  throw periodsRes.error;
    fpa.versions = versionsRes.data || [];
    fpa.lines    = linesRes.data || [];
    fpa.roles    = rolesRes.data  || [];
    // Build rolePermissions lookup: rolePermissions[role][pane] = { can_view, can_edit }
    fpa.rolePermissions = {};
    (rolePermsRes.data || []).forEach(r => {
      (fpa.rolePermissions[r.role_name] ??= {})[r.pane_id] = { can_view: r.can_view, can_edit: r.can_edit };
    });
    fpa.periods  = periodsRes.data || [];

    // Default active version = LE_2026_02
    fpa.activeVersionId = fpa.vid('LE_2026_02') || fpa.versions[0]?.id;

    // ── Load facts: ACTUALS (1 month per upload) + AOP/LE (all 12 months) ──────
    // fpa_v_facts exposes version_code (text), NOT version_id (UUID).
    // ACTUALS_YYYY_MM: one version per closed month — only what user has uploaded.
    // AOP_* and LE_*: full-year planning versions — all months loaded at once.
    // All other kinds (HIST_ACTUAL_*, FORECAST_BASE, SCENARIO_*) stay excluded.
    showBootstrapOverlay('Loading actuals & planning data...');
    const actualsCodes  = fpa.versions
      .filter(v => /^ACTUALS_\d{4}_\d{2}$/.test(v.code))
      .map(v => v.code);
    const planningCodes = fpa.versions
      .filter(v => /^(AOP_|LE_)/.test(v.code))
      .map(v => v.code);
    const allFactCodes  = [...actualsCodes, ...planningCodes];

    fpa.facts = {};
    if (allFactCodes.length > 0) {
      let factsOffset = 0;
      const FACTS_PAGE = 5000;
      while (true) {
        const factsRes = await _sb.from('fpa_v_facts')
          .select('*')
          .in('version_code', allFactCodes)
          .range(factsOffset, factsOffset + FACTS_PAGE - 1);
        if (factsRes.error) throw factsRes.error;
        const rows = factsRes.data || [];
        rows.forEach(r => {
          (fpa.facts[r.version_code] ??= {});
          (fpa.facts[r.version_code][r.line_id] ??= {});
          fpa.facts[r.version_code][r.line_id][r.period_id] = Number(r.value);
        });
        if (rows.length < FACTS_PAGE) break;
        factsOffset += FACTS_PAGE;
      }
    }

    // ── Load assumptions, registers, and historical data in parallel ──────────
    showBootstrapOverlay('Loading planning data & registers...');
    const [assumRes, leasesRes, insRes, impairRes, debtRes, netGenHistRes] = await Promise.all([
      _sb.from('fpa_assumptions').select('*'),
      _sb.from('fpa_leases').select('*'),
      _sb.from('fpa_insurance_policies').select('*'),
      _sb.from('fpa_impairment_events').select('*'),
      _sb.from('fpa_debt_facilities').select('*').order('sort_order'),
      _sb.from('net_gen_historical').select('*').order('year').order('month'),
    ]);
    if (assumRes.error)    console.warn('[FPA] assumptions load error:', assumRes.error.message);
    if (leasesRes.error)   console.warn('[FPA] leases load error:',      leasesRes.error.message);
    if (insRes.error)      console.warn('[FPA] insurance load error:',    insRes.error.message);
    if (impairRes.error)   console.warn('[FPA] impairments load error:',  impairRes.error.message);
    if (debtRes.error)     console.warn('[FPA] debt facilities error:',   debtRes.error.message);

    // ── Build fpa.assumptions[versionCode][category][key][subKey][yearMonth] ─
    fpa.assumptions = {};
    const _vcMap = Object.fromEntries(fpa.versions.map(v => [v.id, v.code]));
    (assumRes.data || []).forEach(r => {
      const vc = _vcMap[r.version_id] || 'UNKNOWN';
      const sk = r.sub_key || '';
      const pk = r.year * 100 + (r.month || 0);
      (fpa.assumptions[vc]                        ??= {});
      (fpa.assumptions[vc][r.category]            ??= {});
      (fpa.assumptions[vc][r.category][r.key]     ??= {});
      (fpa.assumptions[vc][r.category][r.key][sk] ??= {});
      fpa.assumptions[vc][r.category][r.key][sk][pk] = Number(r.value_num);
    });

    // ── Map fpa_leases → ifrs16Leases (camelCase) ───────────────────────────
    ifrs16Leases = (leasesRes.data || []).map(r => ({
      id:               r.id,
      name:             r.name,
      counterparty:     r.counterparty    || '',
      description:      r.description     || '',
      category:         r.category        || '',
      type:             r.lease_type      || 'other',
      treatment:        r.treatment       || 'ifrs16',
      commencementDate: r.commencement_date,
      expiryDate:       r.expiry_date,
      extensionOption:  r.extension_option || false,
      extensionMonths:  r.extension_months || 0,
      currency:         r.currency        || 'USD',
      monthlyPayment:   Number(r.monthly_payment || 0),
      interestRate:     Number(r.interest_rate   || 0),
      rouAssetOpening:  Number(r.rou_opening     || 0),
      liabilityOpening: Number(r.liab_opening    || 0),
    }));

    // ── Map fpa_insurance_policies → insurancePolicies ───────────────────────
    insurancePolicies = (insRes.data || []).map(r => ({
      id:             r.id,
      name:           r.name,
      currency:       r.currency       || 'USD',
      annualPremium:  Number(r.annual_premium  || 0),
      paymentMonths:  r.payment_months  || [],
      paymentAmounts: r.payment_amounts || [],
      notes:          r.notes || '',
    }));

    // ── Map fpa_impairment_events → impairmentEvents ─────────────────────────
    impairmentEvents = (impairRes.data || []).map(r => ({
      id:                 r.id,
      name:               r.name,
      description:        r.description    || '',
      date:               r.event_date,
      chargeAmount:       Number(r.charge_amount   || 0),
      reversalAmount:     Number(r.reversal_amount  || 0),
      triggerType:        r.trigger_type   || 'other',
      isReversible:       r.is_reversible  || false,
      relatedInsuranceId: r.related_insurance_id || null,
      affectsYears:       r.affects_years  || [],
    }));

    // ── Map fpa_debt_facilities → loanRegister ───────────────────────────────
    loanRegister = (debtRes.data || []).map(r => ({
      id:                r.id,
      name:              r.facility_name,
      lender:            r.lender            || '',
      currency:          r.currency          || 'JMD',
      rate:              Number(r.interest_rate      || 0),
      originalPrincipal: Number(r.original_principal || 0),
      maturityDate:      r.maturity_date,
      active:            true,
      drawdowns:         [],
      repayments:        [],
    }));

    // ── Map net_gen_historical → fpa.netGenHist[year][month] ─────────────────
    fpa.netGenHist = {};
    (netGenHistRes.data || []).forEach(r => {
      (fpa.netGenHist[r.year] ??= {})[r.month] = {
        netGenMwh: Number(r.net_gen_mwh || 0),
        peakMw:    Number(r.peak_mw     || 0),
      };
    });

    fpa.loadedAt = new Date();
    const ms = Math.round(performance.now() - t0);
    const totalFactRows = Object.values(fpa.facts).reduce((s,vf)=>s+Object.values(vf).reduce((ss,lf)=>ss+Object.keys(lf).length,0),0);
    console.log(`[FPA] Bootstrap complete in ${ms}ms — ${fpa.versions.length} versions, ${fpa.lines.length} lines, ${Object.keys(fpa.facts).length} ver codes, ${totalFactRows} total fact rows`);
    showBootstrapOverlay(null);  // hide

    // Apply DB data into legacy globals for existing UI compatibility
    fpaApplyToLegacyGlobals();

    // Show active year pills in topbar (non-blocking — DOM may not be fully ready)
    setTimeout(() => _refreshTopBarYearPills?.(), 200);

    // Load unread notifications for current user (non-blocking)
    _loadNotifications();

    return true;
  } catch (e) {
    fpa.loadError = e.message || String(e);
    console.error('[FPA] Bootstrap failed:', e);
    showBootstrapOverlay(null);
    showBootstrapError(fpa.loadError);
    _updateDbStatusBadge();
    return false;
  }
}

// ── Loading overlay ─────────────────────────────────────
function showBootstrapOverlay(msg) {
  let el = document.getElementById('fpaBootstrapOverlay');
  if (!msg) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'fpaBootstrapOverlay';
    el.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(6,9,15,.92);display:flex;flex-direction:column;align-items:center;justify-content:center;color:#cdd8f0;font-family:sans-serif;';
    el.innerHTML = `
      <div style="width:44px;height:44px;border:3px solid rgba(240,180,41,.2);border-top-color:#f0b429;border-radius:50%;animation:fpaSpin 0.8s linear infinite;margin-bottom:20px"></div>
      <div id="fpaBootstrapMsg" style="font-size:13px;font-weight:500;letter-spacing:.03em">Loading...</div>
      <div style="font-size:10px;color:#4a6485;margin-top:8px">JPS FP&A Platform · Supabase</div>
      <style>@keyframes fpaSpin{from{transform:rotate(0)}to{transform:rotate(360deg)}}</style>
    `;
    document.body.appendChild(el);
  }
  document.getElementById('fpaBootstrapMsg').textContent = msg;
}

function showBootstrapError(msg) {
  let el = document.getElementById('fpaBootstrapError');
  if (el) el.remove();
  el = document.createElement('div');
  el.id = 'fpaBootstrapError';
  el.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:99999;background:#451a1a;border:1px solid #ef4444;border-left:4px solid #ef4444;color:#fecaca;padding:10px 16px;border-radius:6px;font-family:sans-serif;font-size:12px;max-width:600px;box-shadow:0 8px 32px rgba(0,0,0,.5)';
  const hdr = document.createElement('div');
  hdr.style.cssText = 'font-weight:700;margin-bottom:4px';
  hdr.textContent = '⚠ Database Connection Issue';
  const body = document.createElement('div');
  body.style.cssText = 'font-size:11px;opacity:.85';
  body.textContent = msg;
  const note = document.createElement('div');
  note.style.cssText = 'font-size:10px;margin-top:6px;color:#f87171';
  note.textContent = 'App is running in offline mode with cached/seed data. Edits will not persist.';
  const btn = document.createElement('button');
  btn.textContent = '✕';
  btn.style.cssText = 'position:absolute;top:6px;right:8px;background:transparent;border:none;color:#fecaca;cursor:pointer;font-size:16px;line-height:1';
  btn.onclick = () => el.remove();
  el.append(hdr, body, note, btn);
  document.body.appendChild(el);
  setTimeout(() => { const e = document.getElementById('fpaBootstrapError'); if (e) e.style.opacity = '.85'; }, 15000);
}

// ── Apply DB data to legacy globals ─────────────────────
// Bridges the new fpa.* layer to the existing UI code that reads
// plLines, bsLines, tariffTable, volumeTable, etc. — no UI rewrite.
function fpaApplyToLegacyGlobals() {
  if (!fpa.versions.length) return;  // no DB data loaded

  // ── UPLOAD-ONLY MODE ─────────────────────────────────────────────────────────
  // plLines / bsLines are populated ONLY from uploaded ACTUALS_YYYY_MM versions.
  // Historical versions (HIST_ACTUAL_*), LE, and FORECAST_BASE are intentionally
  // ignored here so the app shows a clean zero baseline until real data is uploaded.
  // ─────────────────────────────────────────────────────────────────────────────

  // Helper: blended annual total for a P&L line in a year.
  // Only sums months that have a committed ACTUALS_YYYY_MM upload — everything
  // else returns null (stays zero in plLines).
  const blendedAnnual = (lineId, y) => {
    // Historical years (2022-2025): always zero — not populated from HIST_ACTUAL
    if (y <= 2025) return null;
    // 2027+: always zero — not populated from FORECAST_BASE
    if (y >= 2027) return null;
    // 2026: sum only months that have a committed ACTUALS_2026_MM upload
    let sum = 0, any = false;
    for (let m = 1; m <= 12; m++) {
      const monthActCode = `ACTUALS_${y}_${String(m).padStart(2,'0')}`;
      const v = fpa.fact(monthActCode, lineId, y, m);
      if (v !== null && !isNaN(v)) { sum += Number(v); any = true; }
    }
    return any ? sum : null;
  };

  // ── P&L lines ─────────────────────────────────────
  try {
    const plYears = [2022,2023,2024,2025,2026,2027,2028,2029,2030];
    if (typeof plLines !== 'undefined') {
      plLines.forEach(ln => {
        plYears.forEach((y, idx) => {
          const ann = blendedAnnual(ln.id, y);
          if (ann !== null && !isNaN(ann)) ln.vals[idx] = Math.round(ann);
        });
      });
    }
  } catch(e) { console.warn('[FPA] plLines bridge:', e); }

  // ── BS lines ──────────────────────────────────────
  // Only populate 2026 from the latest uploaded ACTUALS_2026_MM.
  // Historical years and future forecasts stay zero until data is uploaded.
  try {
    if (typeof bsLines !== 'undefined') {
      bsLines.forEach(ln => {
        // Only 2026 (index 4) — find the latest month with a committed upload
        const lastClosed = fpa.latestClosedMonth(2026);
        if (lastClosed > 0) {
          const monthActCode = `ACTUALS_2026_${String(lastClosed).padStart(2,'0')}`;
          const v = fpa.fact(monthActCode, ln.id, 2026, lastClosed);
          if (v !== null && !isNaN(v)) ln.vals[4] = Math.round(v);
        }
        // All other year slots stay zero
      });
    }
  } catch(e) { console.warn('[FPA] bsLines bridge:', e); }

  // ── AOP assumption bridges (tariff/volume/FX/generation/OM/CapEx/Collections) ─
  // DISABLED — all assumption data stays zeroed until explicitly uploaded.
  // Tariff, volume, FX and operational planning data will be re-enabled here
  // once the upload mechanism is validated end-to-end.

  // FX, generation, leases, insurance, impairments bridges — disabled.
  // All operational assumption data stays zeroed until upload is validated.

  console.log('[FPA] Legacy globals hydrated from DB');
}

// ── Bridge O&M / CapEx / Collections / Depreciation ───
// These use v28 row-ID conventions that differ slightly from DB line IDs:
//   DB:  om_payroll, om_overtime, ...        v28: payroll, overtime, ...
//   DB:  coll_billing, coll_cr_rt10, ...     v28: billing, cr_rt10, ...
//   DB:  cx_gen, cx_tx, ...                  v28: cx_gen, cx_tx, ... (match)
function fpaApplyOMToLegacy() {
  if (!fpa.versions.length) return;
  try {
    const omSrc = fpa.assumptions?.[_aopCode()]?.om_row || {};
    if (typeof omRows === 'undefined') return;
    const dbIdToLegacy = {
      om_payroll:'payroll',  om_overtime:'overtime',   om_benefits:'benefits',
      om_disc_ben:'disc_ben',om_training:'training',   om_thirdpty:'thirdpty',
      om_supplies:'supplies',om_materials:'materials', om_bdr:'bdr',
      om_tech:'tech',        om_office:'office',       om_transport:'transport',
      om_misc:'misc',        om_insurance:'insurance', om_building:'building',
      om_advert:'advert',    om_bad_debt:'bad_debt',
    };
    [2026,2027,2028,2029,2030].forEach(yr => {
      if (!omRows[yr]) return;
      Object.entries(dbIdToLegacy).forEach(([dbId, legacyId]) => {
        const row = omRows[yr].find(r => r.id === legacyId);
        if (!row) return;
        // Monthly values
        const monthMap = omSrc[dbId]?.value || {};
        for (let m = 1; m <= 12; m++) {
          const v = monthMap[2026 * 100 + m];
          if (v !== undefined && v !== null) row.vals[m-1] = Number(v);
        }
        // Cash lag (annual metadata)
        const lag = omSrc[dbId]?.cashLag?.[2026 * 100];
        if (lag !== undefined && lag !== null) row.cashLag = Number(lag);
      });
    });
  } catch(e) { console.warn('[FPA] om bridge:', e); }
}

function fpaApplyCapexToLegacy() {
  if (!fpa.versions.length) return;
  try {
    const cxSrc = fpa.assumptions?.[_aopCode()]?.capex_row || {};
    if (typeof capexRows === 'undefined') return;
    [2026,2027,2028,2029,2030].forEach(yr => {
      if (!capexRows[yr]) return;
      capexRows[yr].forEach(row => {
        const monthMap = cxSrc[row.id]?.value || {};
        let updated = false;
        for (let m = 1; m <= 12; m++) {
          const v = monthMap[2026 * 100 + m];
          if (v !== undefined && v !== null) { row.vals[m-1] = Number(v); updated = true; }
        }
        // Metadata is stored in meta JSONB — we stored it in the category assumption meta column.
        // To keep the bridge simple, preserve v28 payLag/tLag/dYrs from seed defaults.
      });
    });
  } catch(e) { console.warn('[FPA] capex bridge:', e); }
}
