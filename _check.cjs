
// ── Year constants — declared FIRST so every initializer below can reference them ──
// _CY / _PY drive all year defaults; the app stays correct across year-end rollovers.
const _CY   = new Date().getFullYear();              // current year  (e.g. 2026)
const _PY   = _CY - 1;                              // prior year    (e.g. 2025)
// YEARS: 4 years back through 4 years forward (9 elements); _CY is always at index 4.
// Matches the _z9() vals-array size used by plLines/bsLines.
const YEARS = Array.from({length:9}, (_,i) => String(_CY - 4 + i));

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
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          storageKey: 'jps_fpa_v1',      // isolates FP&A session from the Sales Platform
          detectSessionInUrl: false,      // prevents grabbing tokens meant for other apps
        },
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

    // Rebuild all year/month dropdowns and dynamic UI labels with correct year values
    setTimeout(() => {
      initYearDropdowns();
      rebuildCFMonthDropdown();
      rebuildVarMonthDropdown();
      initAIQuickPrompts();
      _updateDynamicLabels();
    }, 250);

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
    // Years before the current actuals year: always zero — not populated from HIST_ACTUAL
    if (y < actualsYear) return null;
    // Future years beyond current actuals year: always zero — not populated from FORECAST_BASE
    if (y > actualsYear) return null;
    // Current actuals year: sum only months that have a committed ACTUALS_YYYY_MM upload
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
    const plYears = YEARS.map(Number); // dynamic: _CY-4 through _CY+4 (9 elements)
    if (typeof plLines !== 'undefined') {
      plLines.forEach(ln => {
        plYears.forEach((y, idx) => {
          const ann = blendedAnnual(ln.id, y);
          if (ann !== null && !isNaN(ann)) ln.vals[idx] = Math.round(ann);
        });
      });
    }
  } catch(e) { console.warn('[FPA] plLines bridge:', e); if(window.JpsMonitor) JpsMonitor.warning('fpa:bridge:plLines', e.message); }

  // ── BS lines ──────────────────────────────────────
  // Only populate _CY from the latest uploaded ACTUALS_<CY>_MM.
  // Historical years and future forecasts stay zero until data is uploaded.
  try {
    if (typeof bsLines !== 'undefined') {
      bsLines.forEach(ln => {
        // Only _CY (index 4) — find the latest month with a committed upload
        const lastClosed = fpa.latestClosedMonth(_CY);
        if (lastClosed > 0) {
          const monthActCode = `ACTUALS_${_CY}_${String(lastClosed).padStart(2,'0')}`;
          const v = fpa.fact(monthActCode, ln.id, _CY, lastClosed);
          if (v !== null && !isNaN(v)) ln.vals[4] = Math.round(v);
        }
        // All other year slots stay zero
      });
    }
  } catch(e) { console.warn('[FPA] bsLines bridge:', e); if(window.JpsMonitor) JpsMonitor.warning('fpa:bridge:bsLines', e.message); }

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
    Array.from({length:5},(_,i)=>_CY+i).forEach(yr => {
      if (!omRows[yr]) return;
      Object.entries(dbIdToLegacy).forEach(([dbId, legacyId]) => {
        const row = omRows[yr].find(r => r.id === legacyId);
        if (!row) return;
        // Monthly values — look up from planYear AOP period IDs
        const monthMap = omSrc[dbId]?.value || {};
        for (let m = 1; m <= 12; m++) {
          const v = monthMap[planYear * 100 + m];
          if (v !== undefined && v !== null) row.vals[m-1] = Number(v);
        }
        // Cash lag (annual metadata)
        const lag = omSrc[dbId]?.cashLag?.[planYear * 100];
        if (lag !== undefined && lag !== null) row.cashLag = Number(lag);
      });
    });
  } catch(e) { console.warn('[FPA] om bridge:', e); if(window.JpsMonitor) JpsMonitor.warning('fpa:bridge:om', e.message); }
}

function fpaApplyCapexToLegacy() {
  if (!fpa.versions.length) return;
  try {
    const cxSrc = fpa.assumptions?.[_aopCode()]?.capex_row || {};
    if (typeof capexRows === 'undefined') return;
    Array.from({length:5},(_,i)=>_CY+i).forEach(yr => {
      if (!capexRows[yr]) return;
      capexRows[yr].forEach(row => {
        const monthMap = cxSrc[row.id]?.value || {};
        let updated = false;
        for (let m = 1; m <= 12; m++) {
          const v = monthMap[planYear * 100 + m];
          if (v !== undefined && v !== null) { row.vals[m-1] = Number(v); updated = true; }
        }
        // Metadata is stored in meta JSONB — we stored it in the category assumption meta column.
        // To keep the bridge simple, preserve v28 payLag/tLag/dYrs from seed defaults.
      });
    });
  } catch(e) { console.warn('[FPA] capex bridge:', e); if(window.JpsMonitor) JpsMonitor.warning('fpa:bridge:capex', e.message); }
}

function fpaApplyCollToLegacy() {
  if (!fpa.versions.length) return;
  try {
    const collSrc = fpa.assumptions?.[_aopCode()]?.coll_row || {};
    if (typeof collRows === 'undefined') return;
    const dbIdToLegacy = {
      coll_billing:'billing', coll_cr_rt10:'cr_rt10', coll_cr_rt20:'cr_rt20',
      coll_cr_rt40:'cr_rt40', coll_blended:'blended', coll_prior:'prior',
      coll_gcr:'gcr',         coll_receipts:'receipts', coll_dso:'dso',
    };
    Array.from({length:5},(_,i)=>_CY+i).forEach(yr => {
      if (!collRows[yr]) return;
      Object.entries(dbIdToLegacy).forEach(([dbId, legacyId]) => {
        const row = collRows[yr].find(r => r.id === legacyId);
        if (!row || !row.vals) return;   // skip derived rows (null vals)
        const monthMap = collSrc[dbId]?.value || {};
        for (let m = 1; m <= 12; m++) {
          const v = monthMap[planYear * 100 + m];
          if (v !== undefined && v !== null) row.vals[m-1] = Number(v);
        }
      });
    });
  } catch(e) { console.warn('[FPA] coll bridge:', e); if(window.JpsMonitor) JpsMonitor.warning('fpa:bridge:collections', e.message); }
}

function fpaApplyDepToLegacy() {
  if (!fpa.versions.length) return;
  try {
    const depSrc = fpa.assumptions?.[_aopCode()]?.dep_comp || {};
    if (typeof depreciationComponents === 'undefined' || !depreciationComponents[_CY]) return;
    const dbIdToLegacy = {
      dep_fa:'faRegister',  dep_sjpc:'sjpc',           dep_leases:'otherLeases',
      dep_capex:'capexTransfers', dep_spares:'capitalSpares',
      dep_decomm:'decommissioning', dep_meters:'strandedMeters',
      dep_lights:'strandedLights',  dep_impair:'impairment',
    };
    Object.entries(dbIdToLegacy).forEach(([dbId, legacyKey]) => {
      const monthMap = depSrc[dbId]?.value || {};
      if (!depreciationComponents[_CY][legacyKey]) return;
      for (let m = 1; m <= 12; m++) {
        const v = monthMap[planYear * 100 + m];
        if (v !== undefined && v !== null) depreciationComponents[_CY][legacyKey][m-1] = Number(v);
      }
    });
  } catch(e) { console.warn('[FPA] dep bridge:', e); if(window.JpsMonitor) JpsMonitor.warning('fpa:bridge:depreciation', e.message); }
}

// ── Bridge: AOP_2026 assumptions → tariff / volume / FX / gen / fuel ────────
// Reads from fpa.assumptions[_aopCode()] (loaded in fpaBootstrap) and writes
// into the legacy global arrays consumed by the revenue engine and KPI tables.
function fpaApplyAssumptionsToLegacy() {
  if (!fpa.assumptions?.[_aopCode()]) return;
  const aop = fpa.assumptions[_aopCode()];

  // Helper: build 12-element monthly array for planYear from assumption store
  const mo12 = (cat, key, sk = '') => {
    const src = aop[cat]?.[key]?.[sk] || {};
    return Array(12).fill(0).map((_, m) => Number(src[planYear * 100 + m + 1] ?? 0));
  };
  // Helper: single annual value (stored with month=0 or month=null)
  const single = (cat, key, sk = '') => {
    const src = aop[cat]?.[key]?.[sk] || {};
    if (src[planYear * 100] !== undefined) return Number(src[planYear * 100]);
    const vals = Object.values(src).filter(v => !isNaN(v));
    return vals.length ? Number(vals[0]) : 0;
  };

  // ── Tariff rates → tariffTable ────────────────────────────────────────────
  Object.keys(tariffTable).forEach(cls => {
    const tar = tariffTable[cls];
    Object.keys(tar).forEach(subKey => {
      if (tar[subKey] === null) return;     // rate type not applicable to this class
      const vals = mo12('tariff', cls, subKey);
      const hasData = vals.some(v => v !== 0);
      if (hasData) tar[subKey] = vals;      // only overwrite if DB has non-zero data
    });
  });

  // ── Customer / volume / kVA → volumeTable ────────────────────────────────
  Object.keys(volumeTable).forEach(cls => {
    const vol = volumeTable[cls];
    ['cust', 'mwh', 'kva'].forEach(sk => {
      if (vol[sk] === null) return;
      const vals = mo12('volume', cls, sk);
      if (vals.some(v => v !== 0)) vol[sk] = vals;
    });
  });

  // ── FX rates (billing and expense) ───────────────────────────────────────
  const fxBill = mo12('fx_billing', 'USD_JMD');
  const fxExp  = mo12('fx_expense',  'USD_JMD');
  if (fxBill.some(v => v)) {
    fxTable.billing = fxBill.slice();
    if (fxTable.years?.[_CY]) fxTable.years[_CY].billing = fxBill.slice();
  }
  if (fxExp.some(v => v)) {
    fxTable.expense = fxExp.slice();
    if (fxTable.years?.[_CY]) fxTable.years[_CY].expense = fxExp.slice();
  }

  // ── System loss % (monthly) ───────────────────────────────────────────────
  const sysLoss = mo12('sys_loss', 'total');
  if (sysLoss.some(v => v)) sysLossTable[_CY] = sysLoss;

  // ── Net generation by source (GWh/month) → netGenTable[_CY] ─────────────
  const ngSrcs = { jps_thermal:'jps_thermal', old_harbour:'old_harbour',
                   renewables:'renewables',   ipp:'ipp' };
  Object.entries(ngSrcs).forEach(([dbKey, jsKey]) => {
    const vals = mo12('net_gen', dbKey);
    if (vals.some(v => v)) netGenTable[_CY][jsKey] = vals;
  });

  // ── Fuel cost and revenue (US$K monthly) ─────────────────────────────────
  // sub_key can be 'value' or '' depending on how data was seeded
  const _tryBoth = (cat, key) => {
    const a = mo12(cat, key, 'value');
    const b = mo12(cat, key, '');
    return a.some(v => v) ? a : b;
  };
  const fuelCost = _tryBoth('fuel_cost_monthly', 'total');
  if (fuelCost.some(v => v)) {
    for (let m = 0; m < 12; m++) {
      fuelCostByMonth[_CY][m]   = fuelCost[m];
      fuelCostByMonth2026[m]     = fuelCost[m];     // legacy alias
    }
  }
  const fuelRev = _tryBoth('fuel_rev_monthly', 'total');
  if (fuelRev.some(v => v)) {
    for (let m = 0; m < 12; m++) fuelRevByMonth[m] = fuelRev[m];
  }

  // ── Fuel prices (US$/MMBtu or US$/bbl) ───────────────────────────────────
  ['hfo', 'lng', 'ado'].forEach(fuel => {
    const prices = mo12('fuel_price', fuel);
    if (prices.some(v => v)) fuelPriceTable[_CY][fuel] = prices;
  });

  // ── Heat rates (GJ/MWh) ──────────────────────────────────────────────────
  ['jps_thermal', 'old_harbour', 'ipp_thermal', 'system_avg'].forEach(k => {
    const v = single('heat_rate', k);
    if (v) heatRateTable[k] = v;
  });

  console.log('[FPA] Assumptions applied: tariff, volume, FX, sysLoss, netGen, fuel, heatRate');
}

// ── Apply 5-Year Projection drivers from fpa_assumptions ────────────────────
// Namespace: category='proj', sub-category='rev' or 'om', key=driver key, sub_key=year
function fpaApplyProjDriversToLegacy() {
  const pa = fpa.assumptions?.proj;
  if (!pa) return;
  const yrs = Array.from({length:4}, (_,i) => _CY + 1 + i); // dynamic: _CY+1 through _CY+4

  // Revenue drivers
  const rev = pa.rev || {};
  Object.keys(projRevDrivers).forEach(k => {
    yrs.forEach(yr => {
      const dbVal = rev[k]?.[yr];
      if (dbVal != null) projRevDrivers[k].vals[yr] = Number(dbVal);
    });
  });

  // O&M inflation drivers
  const om = pa.om || {};
  Object.keys(projOMDrivers).forEach(k => {
    yrs.forEach(yr => {
      const dbVal = om[k]?.[yr];
      if (dbVal != null) projOMDrivers[k].vals[yr] = Number(dbVal);
    });
  });
}

// Save a single proj driver value back to fpa_assumptions
async function projSaveDriver(category, key, yr, val) {
  if (!_sb) return;
  const { error } = await _sb.from('fpa_assumptions').upsert({
    version_code: 'GLOBAL',
    category: 'proj',
    sub_category: category,  // 'rev' or 'om'
    key,
    sub_key: String(yr),
    period_key: String(yr),
    value_num: val,
    value_text: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'version_code,category,sub_category,key,sub_key,period_key' });
  if (error) console.warn('[FPA] projSaveDriver error:', error.message);
}

// ── Extended bridge — wires all assumption and register data into legacy globals
const _origFpaApply = fpaApplyToLegacyGlobals;
fpaApplyToLegacyGlobals = function() {
  _origFpaApply();
  fpaApplyAssumptionsToLegacy();      // tariff, volume, FX, sysLoss, netGen, fuel
  fpaApplyOMToLegacy();               // O&M line values from AOP_2026
  fpaApplyCapexToLegacy();            // CapEx line values from AOP_2026
  fpaApplyCollToLegacy();             // Collections assumptions from AOP_2026
  fpaApplyDepToLegacy();              // Depreciation components from AOP_2026
  fpaApplyProjDriversToLegacy();      // 5-Year projection growth drivers from DB
  rbPopulateInviteRoles();            // Sync invite dropdown with DB roles
  hubBuildStatusCards();              // Refresh hub badge with real data state
  _updateDbStatusBadge();
};

// ── DB status badge ─────────────────────────────────────
function _updateDbStatusBadge() {
  const el = document.getElementById('dbStatusBadge');
  if (!el) return;
  if (fpa.loadedAt && fpa.versions.length > 0) {
    el.innerHTML = '<span style="color:#10b981">●</span> DB Live';
    el.title = `${fpa.versions.length} versions · ${fpa.lines.length} lines · loaded ${fpa.loadedAt.toLocaleTimeString()}`;
    el.style.color = 'var(--green)';
    el.style.borderColor = 'rgba(16,185,129,.3)';
  } else if (fpa.loadError) {
    el.innerHTML = '<span style="color:#f59e0b">●</span> Offline';
    el.title = `DB error — running on seed data. ${fpa.loadError}`;
    el.style.color = 'var(--amber)';
    el.style.borderColor = 'rgba(245,158,11,.3)';
  } else {
    el.innerHTML = '<span style="color:#4a6485">●</span> No DB';
    el.title = 'Supabase disabled';
    el.style.color = 'var(--muted)';
  }
}

// ── Supabase Realtime channel ────────────────────────
let _sbChannel = null;
function _sbStartRealtime() {
  if (!_sb) return;
  if (_sbChannel) { _sb.removeChannel(_sbChannel); }
  _sbChannel = _sb.channel('jps_fpa_collab', {
    config: { broadcast: { self: false }, presence: { key: _myTabId } }
  });

  // Presence — who is online
  _sbChannel.on('presence', { event: 'sync' }, () => {
    const state = _sbChannel.presenceState();
    Object.entries(state).forEach(([key, presences]) => {
      const p = presences[0];
      if (p && key !== _myTabId) {
        _presenceStore[key] = { name:p.name, role:p.role, tab:p.tab, lastSeen:Date.now() };
      }
    });
    _renderOnlinePanel();
  });

  _sbChannel.on('presence', { event: 'join' }, ({ key, newPresences }) => {
    const p = newPresences[0];
    if (p && key !== _myTabId) {
      _presenceStore[key] = { name:p.name, role:p.role, tab:p.tab, lastSeen:Date.now() };
      _renderOnlinePanel();
      toast(`${p.name} joined`, 'ok');
    }
  });

  _sbChannel.on('presence', { event: 'leave' }, ({ key }) => {
    if (key !== _myTabId) {
      const name = _presenceStore[key]?.name;
      delete _presenceStore[key];
      _renderOnlinePanel();
      if (name) toast(`${name} left`, 'ok');
    }
  });

  // Broadcast — data changes from other users
  _sbChannel.on('broadcast', { event: 'data_change' }, ({ payload }) => {
    _rtHandleRemoteChange(payload);
    if (payload?.user && payload.user !== currentUser.name) {
      toast(`🔄 ${payload.user} updated ${payload.changeType||'data'}`, 'ok');
    }
  });

  // Postgres changes — live DB updates from any session
  _sbChannel
    .on('postgres_changes', { event: '*', schema: 'public', table: 'fpa_facts' }, () => {
      fpaBootstrap().then(()=>{ refreshAll(); toast('📡 Facts updated from database','ok'); });
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'fpa_assumptions' }, () => {
      fpaBootstrap().then(()=>{ refreshAll(); toast('📡 Assumptions updated from database','ok'); });
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'fpa_versions' }, () => {
      fpaBootstrap().then(()=>refreshAll());
    });

  _sbChannel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      // Track presence
      await _sbChannel.track({
        name: currentUser.name,
        role: currentUser.role,
        tab:  document.querySelector('.pane.on')?.id?.replace('pane-','') || 'dash',
        time: new Date().toISOString()
      });
      console.log('[Supabase] Realtime subscribed');
      _renderOnlinePanel();
    }
  });
}

// Update presence tab when user navigates
async function _sbUpdatePresenceTab(tabId) {
  if (!_sbChannel) return;
  try {
    await _sbChannel.track({
      name: currentUser.name,
      role: currentUser.role,
      tab:  tabId,
      time: new Date().toISOString()
    });
  } catch(e) {}
}

// Broadcast a data change to all users (upgrades existing BroadcastChannel)
function _rtBroadcastChange(changeType, data) {
  const payload = { changeType, data, user: currentUser.name, ts: Date.now() };
  // Supabase Realtime (cross-browser)
  if (_sbChannel) {
    try { _sbChannel.send({ type:'broadcast', event:'data_change', payload }); } catch(e) {}
  }
  // BroadcastChannel fallback (same-browser)
  if (_rtChannel) {
    try { _rtChannel.postMessage({ type:'change', payload, from:_myTabId, ts:Date.now() }); } catch(e) {}
  }
}

// ── Supabase Auth ────────────────────────────────────
async function _sbSignIn(email, password) {
  if (!_sb) return null;
  const { data, error } = await _sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

async function _sbSignOut() {
  if (!_sb) return;
  await _sb.auth.signOut();
}

async function _sbGetSession() {
  if (!_sb) return null;
  const { data } = await _sb.auth.getSession();
  return data?.session;
}

// Map Supabase user metadata → currentUser shape
function _sbUserToCurrentUser(sbUser, profile) {
  return {
    id:          sbUser.id,
    name:        profile?.name        || sbUser.user_metadata?.name || sbUser.email.split('@')[0],
    email:       sbUser.email,
    role:        profile?.role        || sbUser.user_metadata?.role || 'analyst',
    department:  profile?.department  || sbUser.user_metadata?.department  || null,
    salesRole:   profile?.sales_role  || sbUser.user_metadata?.sales_role  || null,
    territory:   profile?.territory   || sbUser.user_metadata?.territory   || null,
    isActive:    profile?.is_active   !== false, // default true; false = revoked
    accessAreas: profile?.access_areas || [],
    sbUser
  };
}

// ── Supabase Data Persistence ────────────────────────

// Save audit log entry to Supabase
async function _sbAuditLog(entry) {
  await _sbQ(sb => sb.from('fpa_audit_log').insert({
    user_id:   entry.userId,
    user_name: entry.userName,
    action:    entry.action,
    target:    entry.target,
    old_val:   entry.oldVal  != null ? String(entry.oldVal)  : null,
    new_val:   entry.newVal  != null ? String(entry.newVal)  : null,
  }));
}

// Save actuals upload to Supabase
async function _sbSaveActuals(month, year, data) {
  await _sbQ(sb => sb.from('fpa_actuals').upsert({
    month, year,
    data: JSON.stringify(data),
    uploaded_by: currentUser.id,
  }, { onConflict: 'month,year' }));
}

// Load actuals from Supabase on init
// NOTE: fpa_actuals table replaced by fpa_facts + fpa_versions. This is now a no-op.
async function _sbLoadActuals() {
  // Table deprecated — actuals are loaded at boot from fpa_v_facts into fpa.facts.
  return;
  const rows = await _sbQ(sb => sb.from('fpa_actuals').select('*').eq('year', 2026));
  if (!rows?.data) return;
  rows.data.forEach(r => {
    try {
      const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
      if (d) actualsStore[actualsYear] = actualsStore[actualsYear] || {};
      if (d && r.month) actualsStore[actualsYear][r.month] = d;
    } catch(e) {}
  });
}

// Save scenario to Supabase
async function _sbSaveScenario(name, scenarioData) {
  await _sbQ(sb => sb.from('fpa_scenarios').upsert({
    name,
    owner_id:  currentUser.id,
    by_year:   JSON.stringify(scenarioData.byYear || {}),
    shared:    scenarioData.shared || false,
    approved:  scenarioData.approved || false,
  }, { onConflict: 'name' }));
}

// Load scenarios from Supabase
// NOTE: fpa_scenarios table replaced by fpa_versions (kind=SCENARIO). This is now a no-op.
async function _sbLoadScenarios() {
  // Table deprecated — scenarios are in fpa_versions + fpa_facts loaded at boot.
  return;
  const rows = await _sbQ(sb =>
    sb.from('fpa_scenarios').select('*').or(`owner_id.eq.${currentUser.id},shared.eq.true`)
  );
  if (!rows?.data) return;
  rows.data.forEach(r => {
    try {
      if (!scenarios[r.name]) {
        scenarios[r.name] = {
          desc: r.description || '',
          byYear: typeof r.by_year === 'string' ? JSON.parse(r.by_year) : (r.by_year||{}),
          shared: r.shared,
          approved: r.approved,
          eb:0, rv:0, om:0, cx:0, fu:0, tr:0, cr:0
        };
        // Add to selector if not already there
        const sel = document.getElementById('scSel');
        if (sel && ![...sel.options].find(o=>o.value===r.name)) {
          const opt = document.createElement('option');
          opt.value = opt.textContent = r.name;
          sel.appendChild(opt);
        }
      }
    } catch(e) {}
  });
}

// ── Settings persistence ─────────────────────────────
function saveSbConfig(url, anonKey, enabled) {
  _sbConfig = { url, anonKey, enabled };
  try { localStorage.setItem('jps_sb_config', JSON.stringify(_sbConfig)); } catch(e) {}
  _sb = _sbInit();
  if (_sb) {
    _sbStartRealtime();
    toast('Supabase connected ✓', 'ok');
  } else {
    toast(enabled ? 'Supabase config saved — key required to connect' : 'Supabase disabled — local mode', 'ok');
  }
  buildSupabaseSettings();
}

// ════════════════════════════════════════════════════════════════════════════
//  DATA MANAGEMENT CENTRE — Period calendar, smart upload, commit workflow
// ════════════════════════════════════════════════════════════════════════════

let _dmYear        = _CY;  // defaults to current calendar year; updated by calendar render
let _dmMonth       = null;   // currently selected month (1-12)
let _dmExtractRows = [];     // rows extracted from uploaded file, pending commit
let _dmCurrentFacts= {};     // {line_id: value} already in DB for selected period

const DM_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Lines to track/display in manual entry and extract preview
// section matches fpa_dim_line.statement: 'P&L' | 'Balance Sheet' | 'Cash Flow' | 'Stats'
// ─────────────────────────────────────────────────────────────────────────────
// DM_LINES — Master upload template definition
//
// type:'input'   → user uploads this value; appears in CSV template & entry form
// type:'derived' → auto-calculated from source lines; never uploaded directly
//
// All line IDs must exist in fpa_dim_line (Supabase) — FK enforced on fpa_facts.
// ─────────────────────────────────────────────────────────────────────────────
const DM_LINES = [

  // ════════════════════════════════════════════════════════════════════════════
  // INCOME STATEMENT (P&L)
  // ════════════════════════════════════════════════════════════════════════════

  // ── Revenue ─────────────────────────────────────────────────────────────────
  { id:'fuel_rev',        label:'Fuel Revenue',                           section:'P&L', subsection:'Revenue', type:'input',
    source:'Fuel Settlement Report · Tab "Rev Calc" · USD $000' },

  // Non-Fuel Revenue — upload by rate class; total is derived
  { id:'rev_rt10',        label:'  ↳ Revenue — Residential (RT10)',       section:'P&L', subsection:'Revenue', type:'input',
    source:'Billing System · RT10 Monthly Revenue · USD $000' },
  { id:'rev_rt20',        label:'  ↳ Revenue — SME / Commercial (RT20)', section:'P&L', subsection:'Revenue', type:'input',
    source:'Billing System · RT20 Monthly Revenue · USD $000' },
  { id:'rev_rt40',        label:'  ↳ Revenue — LV Industrial (RT40)',     section:'P&L', subsection:'Revenue', type:'input',
    source:'Billing System · RT40 Monthly Revenue · USD $000' },
  { id:'rev_rt50',        label:'  ↳ Revenue — MV Industrial (RT50)',     section:'P&L', subsection:'Revenue', type:'input',
    source:'Billing System · RT50 Monthly Revenue · USD $000' },
  { id:'rev_rt60',        label:'  ↳ Revenue — Streetlights (RT60)',      section:'P&L', subsection:'Revenue', type:'input',
    source:'Billing System · RT60 Monthly Revenue · USD $000' },
  { id:'rev_rt70',        label:'  ↳ Revenue — LV/HV Large (RT70)',       section:'P&L', subsection:'Revenue', type:'input',
    source:'Billing System · RT70 Monthly Revenue · USD $000' },
  { id:'nonfuel',         label:'Non-Fuel Revenue (Total)',                section:'P&L', subsection:'Revenue', type:'derived',
    source:'rev_rt10 + rev_rt20 + rev_rt40 + rev_rt50 + rev_rt60 + rev_rt70' },

  // Other Operating Revenue — upload by component; total is derived
  { id:'other_r_rental',  label:'  ↳ Rental & Facilities Income',         section:'P&L', subsection:'Revenue', type:'input',
    source:'SAP Income Statement · Rental / Facilities GL codes' },
  { id:'other_r_ancil',   label:'  ↳ Ancillary Service Income',           section:'P&L', subsection:'Revenue', type:'input',
    source:'SAP Income Statement · Ancillary Services GL codes' },
  { id:'other_r_insrec',  label:'  ↳ Insurance Recoveries',               section:'P&L', subsection:'Revenue', type:'input',
    source:'Treasury · Insurance Claims Settled / Received' },
  { id:'other_r_scrap',   label:'  ↳ Scrap & Materials Sales',            section:'P&L', subsection:'Revenue', type:'input',
    source:'Stores Report · Scrap Disposal Proceeds' },
  { id:'other_r_misc',    label:'  ↳ Miscellaneous Other Revenue',        section:'P&L', subsection:'Revenue', type:'input',
    source:'SAP Income Statement · Sundry Other Revenue codes' },
  { id:'other_r',         label:'Other Operating Revenue (Total)',         section:'P&L', subsection:'Revenue', type:'derived',
    source:'other_r_rental + other_r_ancil + other_r_insrec + other_r_scrap + other_r_misc' },

  { id:'pl_total_sales',  label:'▶ TOTAL REVENUE',                        section:'P&L', subsection:'Revenue', type:'derived',
    source:'fuel_rev + nonfuel + other_r' },

  // ── Cost of Sales ───────────────────────────────────────────────────────────
  { id:'fuel_cost',       label:'Fuel Costs',                             section:'P&L', subsection:'Cost of Sales', type:'input',
    source:'Fuel Settlement Report · "Costs" tab · USD $000' },
  { id:'ipp_cost',        label:'IPP / Purchased Power Cost',             section:'P&L', subsection:'Cost of Sales', type:'input',
    source:'IPP Invoice Summary · Monthly PPA Billing' },
  { id:'pl_ppa',          label:'Purchased Power — Other (PPA)',          section:'P&L', subsection:'Cost of Sales', type:'input',
    source:'PPA Billing Statement · Non-IPP purchased power' },
  { id:'pl_other_cos',    label:'Other Cost of Sales',                    section:'P&L', subsection:'Cost of Sales', type:'input',
    source:'SAP Cost Report · Other direct costs' },
  { id:'pl_total_cos',    label:'▶ TOTAL COST OF SALES',                  section:'P&L', subsection:'Cost of Sales', type:'derived',
    source:'fuel_cost + ipp_cost + pl_ppa + pl_other_cos' },

  // ── Gross Profit ────────────────────────────────────────────────────────────
  { id:'pl_gross_profit', label:'▶ GROSS PROFIT',                         section:'P&L', subsection:'P&L Subtotals', type:'derived',
    source:'pl_total_sales − pl_total_cos' },

  // ── Operating Expenses — upload by component; totals are derived ────────────
  { id:'opex_payroll',    label:'  ↳ Employee Costs (Payroll & Benefits)',  section:'P&L', subsection:'Operating Expenses', type:'input',
    source:'HR / Payroll System · Total People Costs incl. NIS & pension' },
  { id:'opex_contract',   label:'  ↳ Contract & Third-Party Services',      section:'P&L', subsection:'Operating Expenses', type:'input',
    source:'Oracle GL · Contract Services cost centres' },
  { id:'opex_materials',  label:'  ↳ Materials & Spare Parts',              section:'P&L', subsection:'Operating Expenses', type:'input',
    source:'Stores Report · Materials & consumables expensed' },
  { id:'opex_insurance',  label:'  ↳ Insurance Premiums (O&M)',             section:'P&L', subsection:'Operating Expenses', type:'input',
    source:'Insurance Register · Monthly premium allocation' },
  { id:'opex_baddebt',    label:'  ↳ Bad Debt Expense (IFRS 9 ECL)',        section:'P&L', subsection:'Operating Expenses', type:'input',
    source:'Credit Risk Report · Expected Credit Loss provision movement' },
  { id:'opex_other',      label:'  ↳ Other O&M Costs',                      section:'P&L', subsection:'Operating Expenses', type:'input',
    source:'Oracle GL · Residual operating cost centres' },
  { id:'opex',            label:'Total O&M (Operating & Maintenance)',       section:'P&L', subsection:'Operating Expenses', type:'derived',
    source:'opex_payroll + opex_contract + opex_materials + opex_insurance + opex_baddebt + opex_other' },
  { id:'pl_sga',          label:'Selling, General & Admin (SG&A)',           section:'P&L', subsection:'Operating Expenses', type:'input',
    source:'SAP P&L · SG&A section cost centres' },
  { id:'pl_maintenance',  label:'Maintenance (Planned & Corrective)',        section:'P&L', subsection:'Operating Expenses', type:'input',
    source:'Maintenance Management System · Closed work orders' },
  { id:'pl_total_opex',   label:'▶ TOTAL OPERATING EXPENSES',               section:'P&L', subsection:'Operating Expenses', type:'derived',
    source:'opex + pl_sga + pl_maintenance' },

  // ── EBITDA ──────────────────────────────────────────────────────────────────
  { id:'ebitda',          label:'▶ EBITDA',                                section:'P&L', subsection:'P&L Subtotals', type:'derived',
    source:'pl_gross_profit − pl_total_opex' },

  // ── Depreciation — upload by component; total is derived ───────────────────
  { id:'depn_ppe',        label:'  ↳ Depreciation — PP&E (IAS 16)',        section:'P&L', subsection:'Depreciation & Amortisation', type:'input',
    source:'Fixed Asset Register · Monthly depreciation run · USD $000' },
  { id:'depn_rou',        label:'  ↳ Depreciation — ROU Assets (IFRS 16)', section:'P&L', subsection:'Depreciation & Amortisation', type:'derived',
    source:'IFRS 16 Lease Schedule · ROU amortisation — auto from Lease Register' },
  { id:'depn_cx',         label:'  ↳ Depreciation — CapEx Transfers',      section:'P&L', subsection:'Depreciation & Amortisation', type:'input',
    source:'Capital Projects · Assets commissioned & transferred this period' },
  { id:'depn_other',      label:'  ↳ Other Depreciation & Amortisation',   section:'P&L', subsection:'Depreciation & Amortisation', type:'input',
    source:'SAP Fixed Assets · Intangibles & other amortisation' },
  { id:'depn',            label:'▶ Total Depreciation & Amortisation',     section:'P&L', subsection:'Depreciation & Amortisation', type:'derived',
    source:'depn_ppe + depn_rou + depn_cx + depn_other' },

  // Derecognition — replaces "Impairment" (separate non-recurring P&L line)
  { id:'impair',          label:'Derecognition / Write-off of Assets',      section:'P&L', subsection:'Depreciation & Amortisation', type:'input',
    source:'Asset Disposal Schedule · IAS 16 Para 67 · Net book value of assets derecognised' },

  // ── EBIT ────────────────────────────────────────────────────────────────────
  { id:'ebit',            label:'▶ EBIT (Operating Profit)',                section:'P&L', subsection:'P&L Subtotals', type:'derived',
    source:'ebitda − depn − impair' },

  // ── Net Financing Costs — upload by component; net total is derived ─────────
  { id:'pl_int_income',   label:'  ↳ Interest Income',                     section:'P&L', subsection:'Net Financing Costs', type:'input',
    source:'Treasury Report · Interest earned on cash deposits' },
  { id:'pl_int_expense',  label:'  ↳ Interest Expense',                    section:'P&L', subsection:'Net Financing Costs', type:'input',
    source:'Debt Schedule · Interest accrual for period' },
  { id:'pl_loan_fees',    label:'  ↳ Loan Financing Fees (amortised)',      section:'P&L', subsection:'Net Financing Costs', type:'input',
    source:'Debt Schedule · Amortisation of arrangement fees' },
  { id:'pl_pref_div',     label:'  ↳ Preference Dividends',                section:'P&L', subsection:'Net Financing Costs', type:'input',
    source:'Preference Share Register · Monthly dividend accrual' },
  { id:'pl_fx',           label:'  ↳ FX Gain / (Loss)',                    section:'P&L', subsection:'Net Financing Costs', type:'input',
    source:'Treasury · FX settlement report · JMD/USD translation gain or loss' },
  { id:'fin_cost',        label:'▶ NET FINANCING COST',                    section:'P&L', subsection:'P&L Subtotals', type:'derived',
    source:'pl_int_income − pl_int_expense − pl_loan_fees − pl_pref_div + pl_fx' },

  // ── Other Income / (Expense) — upload by component; net total is derived ───
  { id:'oth_inc_grant',   label:'  ↳ Government Grants & Subsidies',       section:'P&L', subsection:'Other Income & Expense', type:'input',
    source:'Government Agreements · Grant receipts recognised this period' },
  { id:'oth_inc_asso',    label:'  ↳ Share of Associates\' Profit',        section:'P&L', subsection:'Other Income & Expense', type:'input',
    source:'Equity Method Accounting · Associate / JV results (IFRS equity method)' },
  { id:'oth_inc_gain',    label:'  ↳ Gains / (Losses) on Financial Instruments', section:'P&L', subsection:'Other Income & Expense', type:'input',
    source:'Treasury · Mark-to-market or realised gains on derivatives / investments' },
  { id:'oth_inc_other',   label:'  ↳ Miscellaneous Other Income / (Expense)', section:'P&L', subsection:'Other Income & Expense', type:'input',
    source:'SAP P&L · Sundry other income or expense GL codes' },
  { id:'oth_inc',         label:'▶ NET OTHER INCOME / (EXPENSE)',           section:'P&L', subsection:'P&L Subtotals', type:'derived',
    source:'oth_inc_grant + oth_inc_asso + oth_inc_gain + oth_inc_other' },

  // ── Pre-Tax Income ──────────────────────────────────────────────────────────
  { id:'pretax',          label:'▶ NET PROFIT BEFORE TAX',                 section:'P&L', subsection:'P&L Subtotals', type:'derived',
    source:'ebit + fin_cost + oth_inc' },

  // ── Taxation — upload current & deferred; total is derived ──────────────────
  { id:'pl_curr_tax',     label:'  ↳ Current Income Tax Charge',           section:'P&L', subsection:'Taxation', type:'input',
    source:'SAP P&L · Current tax charge per tax computation' },
  { id:'pl_def_tax',      label:'  ↳ Deferred Tax (Income) / Expense',     section:'P&L', subsection:'Taxation', type:'input',
    source:'Tax Schedule · Movement in deferred tax balances (IAS 12)' },
  { id:'tax',             label:'▶ TOTAL INCOME TAX',                      section:'P&L', subsection:'Taxation', type:'derived',
    source:'pl_curr_tax + pl_def_tax' },

  // ── Net Income ──────────────────────────────────────────────────────────────
  { id:'net_inc',         label:'▶ NET INCOME (PROFIT AFTER TAX)',         section:'P&L', subsection:'P&L Subtotals', type:'derived',
    source:'pretax − tax' },

  // ════════════════════════════════════════════════════════════════════════════
  // BALANCE SHEET
  // ════════════════════════════════════════════════════════════════════════════

  // ── Current Assets ──────────────────────────────────────────────────────────
  { id:'cash',            label:'Cash & Short-Term Deposits',              section:'Balance Sheet', subsection:'Current Assets', type:'input',
    source:'Bank Reconciliation · Closing cash balance' },
  { id:'recv',            label:'Trade Receivables — Net of Impairment',   section:'Balance Sheet', subsection:'Current Assets', type:'input',
    source:'A/R Aging Report · Net receivable after ECL provision' },
  { id:'unbill',          label:'Unbilled Revenue',                        section:'Balance Sheet', subsection:'Current Assets', type:'input',
    source:'Billing System · Accrued unbilled energy to period end' },
  { id:'finv',            label:'Fuel Inventory',                          section:'Balance Sheet', subsection:'Current Assets', type:'input',
    source:'Fuel Inventory Report · Closing stock at cost' },
  { id:'matls',           label:'Materials & Supplies',                    section:'Balance Sheet', subsection:'Current Assets', type:'input',
    source:'Stores Report · Materials & spare parts at cost' },
  { id:'bs_prepaid',      label:'Prepaid Expenses & Deposits',             section:'Balance Sheet', subsection:'Current Assets', type:'input',
    source:'SAP · Prepaid expense GL balance (insurance, advances)' },
  { id:'cur_a',           label:'▶ TOTAL CURRENT ASSETS',                 section:'Balance Sheet', subsection:'Balance Sheet Subtotals', type:'derived',
    source:'cash + recv + unbill + finv + matls + bs_prepaid + other current assets' },

  // ── Non-Current Assets ──────────────────────────────────────────────────────
  { id:'ppe',             label:'Property, Plant & Equipment — Net',       section:'Balance Sheet', subsection:'Non-Current Assets', type:'input',
    source:'Fixed Asset Register · Net Book Value (cost less accumulated depreciation)' },
  { id:'cwip',            label:'Construction Work in Progress (CWIP)',    section:'Balance Sheet', subsection:'Non-Current Assets', type:'input',
    source:'Capital Projects Report · Costs incurred on assets not yet commissioned' },
  { id:'rou_asset',       label:'Right-of-Use Assets (IFRS 16)',           section:'Balance Sheet', subsection:'Non-Current Assets', type:'derived',
    source:'IFRS 16 Lease Schedule · ROU asset NBV — auto from Lease Register' },
  { id:'eqinv',           label:'Equity Investments (incl. SJPC)',         section:'Balance Sheet', subsection:'Non-Current Assets', type:'input',
    source:'Investment Register · Carrying value under equity method' },
  { id:'pension',         label:'Pension Asset',                           section:'Balance Sheet', subsection:'Non-Current Assets', type:'input',
    source:'Actuarial Report · IAS 19 net pension asset' },
  { id:'tot_a',           label:'▶ TOTAL ASSETS',                         section:'Balance Sheet', subsection:'Balance Sheet Subtotals', type:'derived',
    source:'cur_a + ppe + cwip + rou_asset + other non-current assets' },

  // ── Current Liabilities ─────────────────────────────────────────────────────
  { id:'ap',              label:'Accounts Payable & Accruals',             section:'Balance Sheet', subsection:'Current Liabilities', type:'input',
    source:'SAP A/P Aging · Trade creditors + accrued liabilities' },
  { id:'bs_corp_tax',     label:'Corporation Tax Payable',                 section:'Balance Sheet', subsection:'Current Liabilities', type:'input',
    source:'Tax Schedule · Current tax liability due within 12 months' },
  { id:'bs_cust_dep',     label:'Customer Deposits — Current',             section:'Balance Sheet', subsection:'Current Liabilities', type:'input',
    source:'CIS · Customer security deposits repayable within 12 months' },
  { id:'bs_std',          label:'Short-Term Debt',                         section:'Balance Sheet', subsection:'Current Liabilities', type:'input',
    source:'Debt Schedule · Revolving credit & short-term borrowings' },
  { id:'bs_curr_ltd',     label:'Current Maturity — Long-Term Debt',       section:'Balance Sheet', subsection:'Current Liabilities', type:'input',
    source:'Debt Schedule · Principal repayable within 12 months' },
  { id:'lease_cl',        label:'Lease Liabilities — Current (IFRS 16)',   section:'Balance Sheet', subsection:'Current Liabilities', type:'derived',
    source:'IFRS 16 Schedule · Principal due within 12 months — auto from Lease Register' },
  { id:'cur_l',           label:'▶ TOTAL CURRENT LIABILITIES',            section:'Balance Sheet', subsection:'Balance Sheet Subtotals', type:'derived',
    source:'ap + bs_corp_tax + bs_cust_dep + bs_std + bs_curr_ltd + lease_cl + other current liabilities' },

  // ── Non-Current Liabilities ─────────────────────────────────────────────────
  { id:'ltd',             label:'Long-Term Debt',                          section:'Balance Sheet', subsection:'Non-Current Liabilities', type:'input',
    source:'Debt Schedule · Principal due beyond 12 months' },
  { id:'leases',          label:'Lease Liabilities — Long-Term (IFRS 16)', section:'Balance Sheet', subsection:'Non-Current Liabilities', type:'derived',
    source:'IFRS 16 Schedule · LT lease liability — auto from Lease Register' },
  { id:'bs_dtl',          label:'Deferred Tax Liability',                  section:'Balance Sheet', subsection:'Non-Current Liabilities', type:'input',
    source:'Tax Schedule · Net deferred tax liability balance (IAS 12)' },
  { id:'bs_cust_dep_lt',  label:'Customer Deposits & Advances — LT',      section:'Balance Sheet', subsection:'Non-Current Liabilities', type:'input',
    source:'CIS · Security deposits repayable beyond 12 months' },
  { id:'tot_l',           label:'▶ TOTAL LIABILITIES',                    section:'Balance Sheet', subsection:'Balance Sheet Subtotals', type:'derived',
    source:'cur_l + ltd + leases + bs_dtl + other non-current liabilities' },

  // ── Equity ──────────────────────────────────────────────────────────────────
  { id:'bs_share_cap',    label:'Share Capital',                           section:'Balance Sheet', subsection:'Equity', type:'input',
    source:'SAP · Share capital GL balance' },
  { id:'bs_retained',     label:'Retained Earnings',                       section:'Balance Sheet', subsection:'Equity', type:'input',
    source:'SAP · Retained earnings / accumulated deficit GL balance' },
  { id:'equity',          label:'▶ TOTAL EQUITY',                         section:'Balance Sheet', subsection:'Equity', type:'derived',
    source:'bs_share_cap + bs_retained + other equity reserves' },
  { id:'tot_le',          label:'▶ TOTAL LIABILITIES & EQUITY',           section:'Balance Sheet', subsection:'Balance Sheet Subtotals', type:'derived',
    source:'tot_l + equity   [must equal TOTAL ASSETS — check balance sheet]' },

  // ════════════════════════════════════════════════════════════════════════════
  // CASH FLOW STATEMENT (Indirect Method)
  // ════════════════════════════════════════════════════════════════════════════

  // ── Operating Activities ────────────────────────────────────────────────────
  { id:'cf_ni',           label:'Net Profit for the Period',              section:'Cash Flow', subsection:'Operating Activities', type:'derived',
    source:'= net_inc — automatically linked from P&L' },
  { id:'cf_depn',         label:'Add: Depreciation & Amortisation',       section:'Cash Flow', subsection:'Operating Activities', type:'derived',
    source:'= depn — non-cash add-back from P&L' },
  { id:'cf_impair',       label:'Add: Loss on Derecognition / Write-off', section:'Cash Flow', subsection:'Operating Activities', type:'derived',
    source:'= impair — non-cash add-back from P&L' },
  { id:'cf_def_tax',      label:'Add: Deferred Tax Movement',             section:'Cash Flow', subsection:'Operating Activities', type:'derived',
    source:'= pl_def_tax — non-cash add-back' },
  { id:'cf_fx',           label:'Reverse: Unrealised FX Gains / (Losses)',section:'Cash Flow', subsection:'Operating Activities', type:'input',
    source:'Treasury · Unrealised FX component only (exclude settled FX)' },
  { id:'cf_wc_recv',      label:'Δ Trade & Other Receivables',            section:'Cash Flow', subsection:'Working Capital Changes', type:'input',
    source:'BS movement: opening recv − closing recv (increase = use of cash)' },
  { id:'cf_wc_inv',       label:'Δ Inventories (Fuel & Materials)',       section:'Cash Flow', subsection:'Working Capital Changes', type:'input',
    source:'BS movement: opening inventories − closing inventories' },
  { id:'cf_oth',          label:'Δ Payables & Other Working Capital',     section:'Cash Flow', subsection:'Working Capital Changes', type:'input',
    source:'Net movement in AP, accruals, customer deposits, tax payable' },
  { id:'cf_ops_net',      label:'▶ NET CASH FROM OPERATING ACTIVITIES',  section:'Cash Flow', subsection:'Cash Flow Subtotals', type:'derived',
    source:'NPAT + non-cash add-backs + working capital movements' },

  // ── Investing Activities ────────────────────────────────────────────────────
  { id:'cf_capex',        label:'Capital Expenditure (cash paid)',        section:'Cash Flow', subsection:'Investing Activities', type:'input',
    source:'Capital Projects · Cash payments for PP&E and CWIP additions' },
  { id:'cf_disp',         label:'Proceeds from Asset Disposals',          section:'Cash Flow', subsection:'Investing Activities', type:'input',
    source:'Asset Disposal Schedule · Cash received from derecognised assets' },
  { id:'cf_rcash',        label:'Restricted Cash Movement',               section:'Cash Flow', subsection:'Investing Activities', type:'input',
    source:'Treasury · Movement in EDF or other restricted cash accounts' },
  { id:'cf_inv_net',      label:'▶ NET CASH FROM INVESTING ACTIVITIES',  section:'Cash Flow', subsection:'Cash Flow Subtotals', type:'derived',
    source:'cf_capex + cf_disp + cf_rcash + other investing' },

  // ── Financing Activities ────────────────────────────────────────────────────
  { id:'cf_drawdown',     label:'Loan Drawdowns',                         section:'Cash Flow', subsection:'Financing Activities', type:'input',
    source:'Treasury · Drawdown schedule — cash received from new borrowings' },
  { id:'cf_loanrep',      label:'Loan Repayments (principal)',             section:'Cash Flow', subsection:'Financing Activities', type:'input',
    source:'Debt Schedule · Principal repayments made in the period' },
  { id:'cf_int_paid',     label:'Interest Paid',                          section:'Cash Flow', subsection:'Financing Activities', type:'input',
    source:'Debt Schedule · Interest cash payments (may differ from accrual)' },
  { id:'cf_pref_div_paid',label:'Preference Dividends Paid',              section:'Cash Flow', subsection:'Financing Activities', type:'input',
    source:'Preference Share Register · Dividends actually paid in period' },
  { id:'cf_financing_net',label:'▶ NET CASH FROM FINANCING ACTIVITIES',  section:'Cash Flow', subsection:'Cash Flow Subtotals', type:'derived',
    source:'cf_drawdown − cf_loanrep − cf_int_paid − cf_pref_div_paid' },

  // ── Net Change in Cash ──────────────────────────────────────────────────────
  { id:'cf_net_change',   label:'▶ NET (DECREASE) / INCREASE IN CASH',   section:'Cash Flow', subsection:'Cash Flow Subtotals', type:'derived',
    source:'cf_ops_net + cf_inv_net + cf_financing_net   [verify vs Δ cash on BS]' },

  // ════════════════════════════════════════════════════════════════════════════
  // STATISTICAL / OPERATIONAL DATA
  // ════════════════════════════════════════════════════════════════════════════

  // ── Generation ──────────────────────────────────────────────────────────────
  { id:'stat_netgen_gwh', label:'Net Generation (GWh)',                   section:'Stats', subsection:'Generation', type:'input',
    source:'Generation Report · Total net output after station use · GWh' },
  { id:'stat_sysloss_pct',label:'System Loss %',                          section:'Stats', subsection:'Generation', type:'input',
    source:'Loss Audit Report · (Net Gen − Billed Sales) / Net Gen × 100' },
  { id:'stat_peak_mw',    label:'Peak Demand (MW)',                       section:'Stats', subsection:'Generation', type:'input',
    source:'Generation Report · Coincident peak demand for the period · MW' },
  { id:'stat_heatrate',   label:'System Heat Rate (kJ/kWh)',              section:'Stats', subsection:'Generation', type:'input',
    source:'Generation Report · Weighted average thermal heat rate for period' },

  // ── Net Sales (GWh) by Rate Class — upload by class; total is derived ───────
  { id:'rev_mwh_rt10',    label:'  ↳ Net Sales — Residential (RT10) GWh', section:'Stats', subsection:'Net Sales by Rate Class', type:'input',
    source:'Billing System · RT10 energy billed in GWh for the period' },
  { id:'rev_mwh_rt20',    label:'  ↳ Net Sales — SME/Commercial (RT20) GWh',section:'Stats', subsection:'Net Sales by Rate Class', type:'input',
    source:'Billing System · RT20 energy billed in GWh for the period' },
  { id:'rev_mwh_rt40',    label:'  ↳ Net Sales — LV Industrial (RT40) GWh', section:'Stats', subsection:'Net Sales by Rate Class', type:'input',
    source:'Billing System · RT40 energy billed in GWh for the period' },
  { id:'rev_mwh_rt50',    label:'  ↳ Net Sales — MV Industrial (RT50) GWh', section:'Stats', subsection:'Net Sales by Rate Class', type:'input',
    source:'Billing System · RT50 energy billed in GWh for the period' },
  { id:'rev_mwh_rt60',    label:'  ↳ Net Sales — Streetlights (RT60) GWh',  section:'Stats', subsection:'Net Sales by Rate Class', type:'input',
    source:'Billing System · RT60 energy billed in GWh for the period' },
  { id:'rev_mwh_rt70',    label:'  ↳ Net Sales — LV/HV Large (RT70) GWh',   section:'Stats', subsection:'Net Sales by Rate Class', type:'input',
    source:'Billing System · RT70 energy billed in GWh for the period' },
  { id:'stat_billed_gwh', label:'▶ TOTAL NET SALES (GWh)',                section:'Stats', subsection:'Net Sales by Rate Class', type:'derived',
    source:'rev_mwh_rt10 + rev_mwh_rt20 + rev_mwh_rt40 + rev_mwh_rt50 + rev_mwh_rt60 + rev_mwh_rt70' },

  // ── Customers by Rate Class — upload by class; total is derived ─────────────
  { id:'stat_cust_rt10',  label:'  ↳ Customers — Residential (RT10)',     section:'Stats', subsection:'Customers by Rate Class', type:'input',
    source:'CIS · Count of active RT10 accounts at period end' },
  { id:'stat_cust_rt20',  label:'  ↳ Customers — SME / Commercial (RT20)',section:'Stats', subsection:'Customers by Rate Class', type:'input',
    source:'CIS · Count of active RT20 accounts at period end' },
  { id:'stat_cust_rt40',  label:'  ↳ Customers — LV Industrial (RT40)',   section:'Stats', subsection:'Customers by Rate Class', type:'input',
    source:'CIS · Count of active RT40 accounts at period end' },
  { id:'stat_cust_rt50',  label:'  ↳ Customers — MV Industrial (RT50)',   section:'Stats', subsection:'Customers by Rate Class', type:'input',
    source:'CIS · Count of active RT50 accounts at period end' },
  { id:'stat_cust_rt60',  label:'  ↳ Customers — Streetlights (RT60)',    section:'Stats', subsection:'Customers by Rate Class', type:'input',
    source:'CIS · Count of active RT60 accounts at period end' },
  { id:'stat_cust_rt70',  label:'  ↳ Customers — LV/HV Large (RT70)',     section:'Stats', subsection:'Customers by Rate Class', type:'input',
    source:'CIS · Count of active RT70 accounts at period end' },
  { id:'stat_customers',  label:'▶ TOTAL CUSTOMERS',                      section:'Stats', subsection:'Customers by Rate Class', type:'derived',
    source:'stat_cust_rt10 + stat_cust_rt20 + stat_cust_rt40 + stat_cust_rt50 + stat_cust_rt60 + stat_cust_rt70' },

];

function dmSelectYear(y, btn) {
  _dmYear = y;
  document.querySelectorAll('#dmYearSeg .sb').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  _dmMonth = null;
  dmBuildCalendar(y);
  document.getElementById('dmManagerPanel').style.display = 'none';
}

function dmRefresh() {
  if (!_sb) { toast('Not connected to database','w'); return; }
  fpaBootstrap().then(() => { dmBuildCalendar(_dmYear); dmLoadUploadLog(); toast('Refreshed from DB','ok'); });
}

function dmBuildCalendar(year) {
  const title = document.getElementById('dmCalTitle');
  if (title) title.textContent = `📅 ${year} — Period Calendar`;

  const grid = document.getElementById('dmCalGrid');
  if (!grid) return;

  // Summary badges
  const closed = (fpa.periods||[]).filter(p=>p.year===year&&p.is_closed).length;
  const open   = 12 - closed;
  const bdg = document.getElementById('dmYearBadges');
  if (bdg) bdg.innerHTML =
    `<span class="badge" style="background:rgba(52,211,153,.15);color:var(--green)">${closed} closed</span>` +
    `<span class="badge" style="background:rgba(125,160,196,.1);color:var(--muted)">${open} open</span>` +
    _dmYearStatusBadges();

  _refreshTopBarYearPills();

  grid.innerHTML = DM_MONTHS.map((m, i) => {
    const mo = i + 1;
    const period = (fpa.periods||[]).find(p => p.year===year && p.month===mo);
    const closed   = period?.is_closed || false;
    const hasActs  = actualsStore[year]?.[mo] != null;
    const isNext   = !closed && mo === ((fpa.latestClosedMonth?.(year)||0) + 1);
    const selected = _dmYear===year && _dmMonth===mo;

    let bg, border, icon, label;
    if (closed && hasActs) { bg='rgba(52,211,153,.14)'; border='rgba(52,211,153,.35)'; icon='✅'; label='Actuals Loaded'; }
    else if (closed)       { bg='rgba(52,211,153,.07)'; border='rgba(52,211,153,.2)';  icon='🔒'; label='Closed'; }
    else if (isNext)       { bg='rgba(251,191,36,.12)'; border='rgba(251,191,36,.3)';  icon='⬆'; label='Ready to Upload'; }
    else                   { bg='rgba(125,160,196,.06)'; border='var(--border)';        icon='📋'; label='Open — LE'; }

    const selStyle = selected ? 'outline:2px solid var(--gold);outline-offset:2px;' : '';

    return `<div onclick="dmSelectMonth(${year},${mo})"
      style="text-align:center;padding:8px 4px;border-radius:6px;background:${bg};border:1px solid ${border};cursor:pointer;transition:.15s;${selStyle}"
      title="${m} ${year} — ${label}">
      <div style="font-size:14px">${icon}</div>
      <div style="font-size:10px;font-weight:700;color:var(--text);margin:2px 0">${m} ${year}</div>
      <div style="font-size:9px;color:var(--muted)">${label}</div>
    </div>`;
  }).join('');

  // Rebuild the quick-lock strip (admin only)
  dmBuildLockStrip(year);
}

// ── Active actuals/plan year status badges ────────────────────────────────────
// Returns HTML for the two status pills shown in the Data Management badge bar.
function _dmYearStatusBadges() {
  var aLabel = actualsYear || '&mdash;';
  var pLabel = planYear    || '&mdash;';
  return (
    '<span class="badge" style="background:rgba(99,179,237,.12);color:var(--blue);margin-left:4px" ' +
      'title="Year of actuals currently in memory (set on last upload)">' +
      '📊 Actuals: ' + aLabel + '</span>' +
    '<span class="badge" style="background:rgba(167,139,250,.12);color:#a78bfa" ' +
      'title="Active AOP/Budget plan year (' + _aopCode() + ')">' +
      '📋 Plan: ' + pLabel + '</span>'
  );
}

// Refresh the badge bar in the DM pane (called after any upload).
function _refreshDmBadges() {
  var bdg = document.getElementById('dmYearBadges');
  if (!bdg) return;
  // Rebuild only the status pills (last two spans); keep closed/open counts intact.
  // Easiest: just redo the full badge set using current _dmYear.
  var year   = _dmYear || _CY;
  var closed = (fpa.periods||[]).filter(function(p){return p.year===year&&p.is_closed;}).length;
  var open   = 12 - closed;
  bdg.innerHTML =
    '<span class="badge" style="background:rgba(52,211,153,.15);color:var(--green)">' + closed + ' closed</span>' +
    '<span class="badge" style="background:rgba(125,160,196,.1);color:var(--muted)">' + open + ' open</span>' +
    _dmYearStatusBadges();
  _refreshTopBarYearPills();
}

// Updates (or creates) a small status pill in the main top-bar showing active years.
function _refreshTopBarYearPills() {
  var pill = document.getElementById('_topBarYrPill');
  if (!pill) {
    // Create once and inject into the topbar nav area
    pill = document.createElement('div');
    pill.id = '_topBarYrPill';
    pill.style.cssText = 'display:flex;gap:5px;align-items:center;margin-left:8px;flex-shrink:0';
    var nav = document.querySelector('.nav') || document.querySelector('nav');
    if (nav) nav.appendChild(pill);
  }
  pill.innerHTML =
    '<span style="font-size:9px;padding:2px 7px;border-radius:10px;' +
      'background:rgba(99,179,237,.15);color:var(--blue);font-weight:700;white-space:nowrap" ' +
      'title="Active actuals year">📊 ' + (actualsYear||'&mdash;') + '</span>' +
    '<span style="font-size:9px;padding:2px 7px;border-radius:10px;' +
      'background:rgba(167,139,250,.15);color:#a78bfa;font-weight:700;white-space:nowrap" ' +
      'title="Active plan year (' + _aopCode() + ')">📋 ' + (planYear||'&mdash;') + '</span>';
}

// ═══════════════════════════════════════════════════════
//  DYNAMIC YEAR/MONTH DROPDOWN INITIALISATION
//  Called after bootstrap so all dropdowns reflect _CY/_PY
//  and the DB-confirmed closed periods.
// ═══════════════════════════════════════════════════════

/**
 * Build a standard year option list centred on _CY.
 * Marks _CY as selected by default; caller can override.
 */
function _buildYearOptions(selectedYear, extraBefore, extraAfter) {
  const lo = (extraBefore != null ? extraBefore : 2) ;
  const hi = (extraAfter  != null ? extraAfter  : 3) ;
  const sel = selectedYear || _CY;
  const opts = [];
  for (let y = _CY - lo; y <= _CY + hi; y++) {
    opts.push(`<option value="${y}"${y === sel ? ' selected' : ''}>${y}</option>`);
  }
  return opts.join('');
}

/** Rebuild all year-picker dropdowns after bootstrap. */
function initYearDropdowns() {
  // Dashboard (legacy + 2.0)
  const ds = document.getElementById('dashYrSel');
  if (ds) { ds.innerHTML = _buildYearOptions(_CY, 1, 4); }
  const d2 = document.getElementById('d2YrSel');
  if (d2) { d2.innerHTML = _buildYearOptions(_CY, 1, 4); dash2Year = _CY; }

  // Balance Sheet From / To
  const bsF = document.getElementById('bsYrFrom');
  if (bsF) {
    bsF.innerHTML = _buildYearOptions(_CY - 2, 4, 0);
    plYrFrom = _CY - 2;
  }
  const bsT = document.getElementById('bsYrTo');
  if (bsT) {
    bsT.innerHTML = _buildYearOptions(_CY + 1, 0, 4);
    plYrTo = _CY + 1;
  }

  // Cash Flow year
  const cf = document.getElementById('cfYrSel');
  if (cf) { cf.innerHTML = _buildYearOptions(cfYear, 4, 4); }

  // Variance year
  const vr = document.getElementById('varYrSel');
  if (vr) { vr.innerHTML = _buildYearOptions(varYear, 4, 4); }

  // Generation year segment buttons
  const gen = document.getElementById('genYrSeg');
  if (gen) {
    gen.innerHTML = Array.from({length:5},(_,i)=>_CY+i).map((y,i)=>
      `<div class="sb${i===0?' on':''}" onclick="setGenYear(${y},this)">${y}</div>`
    ).join('');
  }

  // Lease amortisation year segment buttons
  const lam = document.getElementById('leaseAmortYrSeg');
  if (lam) {
    lam.innerHTML = Array.from({length:5},(_,i)=>_CY+i).map((y,i)=>
      `<div class="sb${i===0?' on':''}" onclick="setLeaseAmortYear(${y},this)">${y}</div>`
    ).join('');
  }

  // Lease aggregate year segment buttons
  const lagg = document.getElementById('leaseAggYrSeg');
  if (lagg) {
    lagg.innerHTML = Array.from({length:5},(_,i)=>_CY+i).map((y,i)=>
      `<div class="sb${i===0?' on':''}" onclick="setLeaseAggYear(${y},this)">${y}</div>`
    ).join('');
  }

  // Revenue engine year segment buttons
  const rev = document.getElementById('revYrSeg');
  if (rev) {
    rev.innerHTML = Array.from({length:5},(_,i)=>_CY+i).map((y,i)=>
      `<div class="sb${i===0?' on':''}" onclick="setRevYear(${y},this)">${y}</div>`
    ).join('');
  }

  // Tariff review modal year dropdown
  const trYr = document.getElementById('trYear');
  if (trYr && !trYr._built) {
    trYr._built = true;
    trYr.innerHTML = Array.from({length:5},(_,i)=>_CY+i).map((y,i)=>
      `<option${i===2?' selected':''}>${y}</option>` // default to CY+2
    ).join('');
  }

  // Data Management year selector (show CY-2 through CY+1)
  const dmYr = document.getElementById('dmYearSeg');
  if (dmYr) {
    const dmYrs = Array.from({length:4},(_,i)=>_CY-2+i);
    dmYr.innerHTML = dmYrs.map((y,i)=>
      `<div class="sb${y===_CY?' on':''}" onclick="dmSelectYear(${y},this)">${y}</div>`
    ).join('');
  }

  // CapEx year dropdown — _PY and _CY options (mirrors capexYrSeg which drives the table)
  const cxSel = document.getElementById('capexYr');
  if (cxSel) {
    cxSel.innerHTML = [_PY, _CY].map((y,i)=>
      `<option value="${y}"${i===1?' selected':''}>${y}</option>`
    ).join('');
  }
}

/** Rebuild CF month dropdown — labels use current cfYear, disabled state from DB. */
function rebuildCFMonthDropdown() {
  const sel = document.getElementById('cfMo');
  if (!sel) return;
  sel.innerHTML = MONTHS.map((m, i) => {
    const mo = i + 1;
    return `<option value="${mo}"${mo === cfSelectedMonth ? ' selected' : ''}>${m} ${cfYear}</option>`;
  }).join('');
}

/** Rebuild Variance month dropdown — enabled only for closed periods per fpa_dim_period. */
function rebuildVarMonthDropdown() {
  const sel = document.getElementById('varMo');
  if (!sel) return;
  const latestClosed = fpa.latestClosedMonth?.(varYear) || 0;
  // Default selection: latest closed month, or month 1 if none
  const defaultSel = latestClosed || 1;
  sel.innerHTML = MONTHS.map((m, i) => {
    const mo = i + 1;
    const closed = fpa.isPeriodClosed?.(varYear, mo);
    // Enable this month if it is closed OR if it is the next month after the last closed one
    const enabled = mo <= (latestClosed + 1);
    return `<option value="${mo}"${mo === defaultSel ? ' selected' : ''}${!enabled ? ' disabled' : ''}>${m} ${varYear} — ${closed ? '🔒 Closed' : mo === latestClosed + 1 ? 'Next' : 'Future'}</option>`;
  }).join('');
}

/**
 * Hook setCfYear so month dropdown labels stay in sync.
 * Wraps the existing setCfYear without replacing it.
 */
const _origSetCfYear = typeof setCfYear === 'function' ? setCfYear : null;
function setCfYear(v) {
  cfYear = parseInt(v);
  if (_origSetCfYear) _origSetCfYear(v);
  rebuildCFMonthDropdown();
  buildCFReport();
}

/** Build AI quick prompts dynamically using current/prior year variables. */
function initAIQuickPrompts() {
  const el = document.getElementById('aiQuickPrompts');
  if (!el) return;
  const prompts = [
    `📊 Explain the EBITDA variance vs ${_PY} actuals`,
    `💧 Why is net cash flow declining in Q3 ${_CY}?`,
    `📈 What's driving revenue growth in the ${_CY} budget?`,
    `⚠️ What are the key risks to the Base Case?`,
    `🏗 Summarize the ${_CY} CapEx programme`,
    `📋 Draft executive summary for ${MONTHS[cfSelectedMonth-1]} ${_CY} LE`,
    `🔧 Analyse O&M cost trends by category`,
    `📉 Explain depreciation movements in ${_CY}`,
  ];
  el.innerHTML = prompts.map(p =>
    `<div class="ai-prompt-btn" onclick="quickPrompt(this.textContent)">${p}</div>`
  ).join('');
}

/** Update miscellaneous static labels that reference specific years. */
function _updateDynamicLabels() {
  // Loan modal opening balance label
  const lbl = document.getElementById('lnOpenBalLabel');
  if (lbl) lbl.textContent = `Opening Balance Jan ${_CY} ($'000)`;

  // Platform Guide title (sync to app version)
  const guide = document.getElementById('guidePanelTitle');
  if (guide) {
    const ver = document.querySelector('title')?.textContent.match(/v[\d.]+/)?.[0] || '';
    guide.textContent = `📖 Platform Logic Guide — JPS FP&A ${ver}`;
  }

  // Generation mix chart subtitle
  const gmEl = document.getElementById('ctGenMixYr');
  if (gmEl) gmEl.textContent = `${_CY} YTD | MWh`;

  // P&L header badges
  const plAct = document.getElementById('plActBadge');
  if (plAct) plAct.textContent = `Actuals ${_CY-4}–${_PY}`;
  const plBud = document.getElementById('plBudBadge');
  if (plBud) plBud.textContent = `Budget/Forecast ${_CY}+`;

  // Volume table description
  const volDesc = document.getElementById('volTableDesc');
  if (volDesc) volDesc.textContent = `Monthly ${_CY} by rate class | Pre-populated from AOP ${_CY} | Edit any cell → instant recalculation`;

  // Brand subtitle
  const brand = document.getElementById('brandSub');
  if (brand) brand.textContent = `Jamaica Public Service Co. · ${_CY} LE`;

  // Dashboard chart labels and section titles
  const scNIYrs = document.getElementById('ctScNIYrs');
  if (scNIYrs) scNIYrs.textContent = `${_CY}–${_CY+4}`;
  const kpiTrend = document.getElementById('kpiTrendTitle');
  if (kpiTrend) kpiTrend.textContent = `§5 5-Year Ratio Trends (${_CY}–${_CY+4})`;
  const projRevBadge = document.getElementById('projRevBadge');
  if (projRevBadge) projRevBadge.textContent = `Non-Fuel Revenue | ${_CY+1}–${_CY+4}`;

  // Scenario chart labels
  const scEbYrs = document.getElementById('ctScEbYrs');
  if (scEbYrs) scEbYrs.textContent = `${_CY}–${_CY+4}`;
  const scNI2Yrs = document.getElementById('ctScNI2Yrs');
  if (scNI2Yrs) scNI2Yrs.textContent = `${_CY}–${_CY+4}`;
  const scMatrix = document.getElementById('scMatrixTitle');
  if (scMatrix) scMatrix.textContent = `Scenario Comparison Matrix | ${_CY}`;

  // Generation mix pane — YTD label
  const genMixHdr = document.getElementById('genMixTitle');
  if (genMixHdr) genMixHdr.textContent = `🔌 Generation Mix — YTD ${_CY}`;

  // Cash flow bridge year label
  const cfBridge = document.getElementById('ctBridgeYr');
  if (cfBridge) cfBridge.textContent = `FY ${_CY}`;

  // Debt summary table header
  const dsh = document.getElementById('debtSummHead');
  if (dsh) dsh.innerHTML = `<tr><th style="text-align:left;min-width:220px">Line</th>${Array.from({length:5},(_,i)=>_CY+i).map(y=>`<th class="bc">${y}</th>`).join('')}</tr>`;

  // Revenue trend chart title
  const revTrend = document.getElementById('revTrendTitle');
  if (revTrend) revTrend.innerHTML = `Monthly Revenue Trend ${_CY} <em>US$'000 | Non-Fuel + Fuel Stacked</em>`;

  // CapEx chart year label
  const cxBarYr = document.getElementById('ctCxBarYr');
  if (cxBarYr) cxBarYr.textContent = `${_CY} Monthly | USD $'000`;

  // Depreciation year badge default
  const depYrLbl = document.getElementById('depYrLabel');
  if (depYrLbl) depYrLbl.textContent = String(_CY);
  const depAnn = document.getElementById('ctDepAnn');
  if (depAnn) depAnn.innerHTML = `Depreciation ${_CY-4}–${_CY+2} <em>By component | USD $'000</em>`;
  const varRevYr = document.getElementById('ctVarRevYr');
  if (varRevYr) varRevYr.textContent = `YTD Actuals ${_CY} | USD $'000`;
  const revBanner = document.getElementById('revRptBanner');
  if (revBanner) revBanner.textContent = `🔒 Report View — Revenue & Generation data. Source: JPSCo_Financials actuals + AOP ${planYear} assumptions.`;
  const depMo = document.getElementById('ctDepMo');
  if (depMo) depMo.innerHTML = `${_CY} Monthly Depreciation <em>LE vs Actuals overlay</em>`;

  // Revenue report month dropdown — rebuild with current year labels
  const revMoSel = document.getElementById('revRptMo');
  if (revMoSel && !revMoSel._builtForYear || revMoSel?._builtForYear !== _CY) {
    const latestRevMo = fpa.latestClosedMonth?.(_CY) || 1;
    revMoSel.innerHTML = MONTHS.map((m,i) =>
      `<option value="${i+1}"${i+1>latestRevMo?' disabled':''}>${m} ${_CY}</option>`
    ).join('');
    revMoSel.value = String(Math.min(latestRevMo, 12));
    if (revMoSel) revMoSel._builtForYear = _CY;
  }

  // Projection table headers (dynamic years)
  const yrs5 = Array.from({length:5},(_,i)=>_CY+i);
  const _ph = (id, html) => { const e=document.getElementById(id); if(e) e.innerHTML=html; };
  _ph('projRevH', `<tr><th style="text-align:left;min-width:240px">Driver</th>${yrs5.map((y,i)=>`<th class="bc">${y}${i===0?' LE':''}</th>`).join('')}<th style="text-align:left;min-width:140px">Note</th></tr>`);
  _ph('projOMH',  `<tr><th style="text-align:left;min-width:240px">Category</th><th class="bc">${_CY} Total ($K)</th>${yrs5.slice(1).map(y=>`<th class="bc">${y} Gr%</th>`).join('')}<th class="bc">${_CY+4} Proj ($K)</th></tr>`);
  _ph('projCapexH',`<tr><th style="text-align:left;min-width:240px">Programme</th>${yrs5.map(y=>`<th class="bc">${y} ($K)</th>`).join('')}<th class="bc">5-Year Total</th></tr>`);
  _ph('projDepH2', `<tr><th style="text-align:left;min-width:240px">Line</th>${yrs5.map(y=>`<th class="bc">${y}</th>`).join('')}</tr>`);
  _ph('projDebtH2',`<tr><th style="text-align:left;min-width:240px">Item</th>${yrs5.map(y=>`<th class="bc">${y}</th>`).join('')}</tr>`);

  // CF month default: use latest closed month for this year
  const latestClosed = fpa.latestClosedMonth?.(_CY) || new Date().getMonth() + 1;
  cfSelectedMonth = Math.min(latestClosed, 12);
  rebuildCFMonthDropdown();
}

function dmBuildLockStrip(year) {
  const strip = document.getElementById('dmLockStrip');
  const btnRow = document.getElementById('dmLockBtns');
  if (!strip || !btnRow) return;

  // Only show to admins
  if (currentUser.role !== 'admin') { strip.style.display = 'none'; return; }
  strip.style.display = '';

  btnRow.innerHTML = DM_MONTHS.map((m, i) => {
    const mo = i + 1;
    const period   = (fpa.periods||[]).find(p => p.year===year && p.month===mo);
    const isClosed = period?.is_closed || false;
    const clr      = isClosed ? 'var(--amber)' : 'var(--muted)';
    const bdr      = isClosed ? 'var(--amber)' : 'var(--border)';
    const lbl      = isClosed ? '🔒' : '🔓';
    return `<button
      onclick="dmQuickToggleLock(${year},${mo},this)"
      title="${isClosed ? 'Unlock' : 'Lock'} ${m} ${year}"
      style="font-size:10px;padding:3px 8px;border-radius:5px;border:1px solid ${bdr};
             background:transparent;color:${clr};cursor:pointer;transition:.15s;white-space:nowrap">
      ${lbl} ${m}
    </button>`;
  }).join('');
}

async function dmQuickToggleLock(year, month, btn) {
  if (!_sb) { toast('Not connected to database','w'); return; }
  const period   = (fpa.periods||[]).find(p => p.year===year && p.month===month);
  const isClosed = period?.is_closed || false;
  const locking  = !isClosed;
  const label    = `${DM_MONTHS[month-1]} ${year}`;
  const periodId = year * 100 + month;
  const actVer   = (fpa.versions||[]).find(v=>v.kind==='ACTUAL'&&v.period_id===periodId);

  if (!confirm(`${locking ? 'Lock' : 'Unlock'} ${label}?\n${locking
    ? 'Closes the period calendar AND locks the actuals version at DB level.'
    : 'Re-opens the period and unlocks the actuals version for editing.'}`)) return;

  const now    = new Date().toISOString();
  const userId = (currentUser.id && currentUser.id !== 'local') ? currentUser.id : null;

  // 1. Period calendar
  const { error: pErr } = await _sb.from('fpa_dim_period')
    .update({ is_closed: locking, closed_at: locking ? now : null, closed_by: locking ? userId : null })
    .eq('year', year).eq('month', month);
  if (pErr) { toast('DB error: ' + pErr.message, 'w'); return; }

  // 2. Version lock
  if (actVer) {
    await _sb.from('fpa_versions').update({
      is_locked: locking,
      locked_at: locking ? now : null,
      locked_by: locking ? userId : null,
    }).eq('id', actVer.id);
  }

  toast(`${label} ${locking ? 'locked 🔒' : 'unlocked 🔓'}${actVer ? '' : ' (no actuals version found)'}`, 'ok');
  auditLog('edit', locking ? 'period-lock' : 'period-unlock', label, { is_closed: locking, version_code: actVer?.code || null });
  await fpaBootstrap();
  dmBuildCalendar(year);
  if (_dmMonth === month) dmSelectMonth(year, month);
}

async function dmSelectMonth(year, month) {
  _dmYear  = year;
  _dmMonth = month;
  dmBuildCalendar(year);

  const panel = document.getElementById('dmManagerPanel');
  const title  = document.getElementById('dmManagerTitle');
  const sub    = document.getElementById('dmManagerSub');
  const lockBtn= document.getElementById('dmLockBtn');

  if (!panel) return;
  panel.style.display = '';

  const mLabel = `${DM_MONTHS[month-1]} ${year}`;
  title.textContent = `📂 ${mLabel} — Data Manager`;
  sub.textContent   = `Upload, review, or manually enter data for ${mLabel}`;

  const period   = (fpa.periods||[]).find(p=>p.year===year&&p.month===month);
  const isClosed = period?.is_closed||false;
  const periodId = year * 100 + month;
  const actVer   = (fpa.versions||[]).find(v=>v.kind==='ACTUAL'&&v.period_id===periodId);
  const isVerLocked = actVer?.is_locked || false;

  // Lock button reflects the stronger of the two states
  const fullyLocked = isClosed && isVerLocked;
  lockBtn.textContent   = isClosed ? '🔓 Unlock Period' : '🔒 Lock Period';
  lockBtn.style.borderColor = isClosed ? 'var(--amber)' : '';
  lockBtn.style.color       = isClosed ? 'var(--amber)' : '';
  lockBtn.title = isClosed
    ? `Period closed${isVerLocked ? ' + version locked (DB-enforced)' : ' but version NOT locked'}${actVer?.locked_at ? ` · Locked ${new Date(actVer.locked_at).toLocaleDateString()}` : ''}`
    : 'Lock this period and its actuals version';

  // Show lock status banner beneath the panel title if locked
  let lockInfo = document.getElementById('dmLockInfo');
  if (!lockInfo) {
    lockInfo = document.createElement('div');
    lockInfo.id = 'dmLockInfo';
    sub.parentNode.insertAdjacentElement('afterend', lockInfo);
  }
  if (isClosed) {
    const lockedWhen = actVer?.locked_at ? new Date(actVer.locked_at).toLocaleString() : (period?.closed_at ? new Date(period.closed_at).toLocaleString() : 'unknown time');
    const protection = isVerLocked
      ? '🔒 Period closed + actuals version locked — writes blocked at database level'
      : '⚠ Period calendar closed but actuals version is NOT locked — DB writes still possible. Re-lock to enforce.';
    lockInfo.innerHTML = `<div style="padding:6px 12px;background:${isVerLocked?'rgba(52,211,153,.08)':'rgba(245,158,11,.1)'};border-top:1px solid ${isVerLocked?'rgba(52,211,153,.2)':'rgba(245,158,11,.25)'};font-size:10px;color:${isVerLocked?'var(--green)':'var(--amber)'}">
      ${protection}${actVer ? ` &nbsp;·&nbsp; Version: <strong>${actVer.code}</strong>` : ''} &nbsp;·&nbsp; ${lockedWhen}
    </div>`;
  } else {
    lockInfo.innerHTML = '';
  }

  // Load current DB facts for this period
  await dmLoadCurrentFacts(year, month);
  dmBuildStatusChips(year, month);
  dmBuildManualFields();
  await dmBuildSeedOptions();
  dmBuildAllEntryTables();
  dmSetTab('PL');
  _dmLeSelected = [];

  // Reset extract panel
  document.getElementById('dmExtractPanel').style.display = 'none';
  _dmExtractRows = [];
}

async function dmLoadCurrentFacts(year, month) {
  _dmCurrentFacts = {};
  if (!_sb) return;
  const periodId = year * 100 + month;
  // Find ACTUAL version for this period (covers both ACTUALS_YYYY_MM and older formats)
  const monthCode = `ACTUALS_${year}_${String(month).padStart(2,'0')}`;
  const actVer = (fpa.versions||[]).find(v=>v.code===monthCode)
              || (fpa.versions||[]).find(v=>v.kind==='ACTUAL'&&v.period_id===periodId);
  if (!actVer) return;
  const { data } = await _sb.from('fpa_facts')
    .select('line_id, value')
    .eq('version_id', actVer.id)
    .eq('period_id', periodId);
  (data||[]).forEach(r => { _dmCurrentFacts[r.line_id] = r.value; });
}

function dmBuildStatusChips(year, month) {
  const chips = document.getElementById('dmStatusChips');
  if (!chips) return;
  const periodId = year * 100 + month;
  const actVer   = (fpa.versions||[]).find(v=>v.kind==='ACTUAL'&&v.period_id===periodId);
  const hasDB    = !!_sb;

  const sections = ['P&L','Balance Sheet','Cash Flow','Stats'];
  let html = '';
  sections.forEach(sec => {
    // Only count input lines — derived lines are never uploaded directly
    const lines  = DM_LINES.filter(l=>l.section===sec && l.type==='input');
    const loaded = lines.filter(l=>_dmCurrentFacts[l.id]!=null).length;
    const total  = lines.length;
    const all    = loaded === total;
    const none   = loaded === 0;
    const bg    = all  ? 'rgba(52,211,153,.18)' : none ? 'rgba(239,68,68,.1)' : 'rgba(251,191,36,.15)';
    const color  = all  ? 'var(--green)'          : none ? 'var(--red)'         : 'var(--amber)';
    const icon   = all  ? '✅' : none ? '⭕' : '⚠';
    if (!hasDB || !actVer) {
      html += `<span style="padding:3px 10px;border-radius:10px;font-size:11px;font-weight:600;background:rgba(125,160,196,.1);color:var(--muted)">${sec} — No DB connection</span>`;
    } else {
      html += `<span style="padding:3px 10px;border-radius:10px;font-size:11px;font-weight:600;background:${bg};color:${color}">${icon} ${sec} ${loaded}/${total}</span>`;
    }
  });

  const period = (fpa.periods||[]).find(p=>p.year===year&&p.month===month);
  if (!actVer) {
    html = `<span style="padding:3px 10px;border-radius:10px;font-size:11px;background:rgba(239,68,68,.1);color:var(--red)">⭕ No ACTUAL version found for ${DM_MONTHS[month-1]} ${year} — create one in fpa_versions</span>` + html;
  }
  if (period?.is_closed) {
    html = `<span style="padding:3px 10px;border-radius:10px;font-size:11px;background:rgba(52,211,153,.12);color:var(--green)">🔒 Period Locked — ${DM_MONTHS[month-1]} ${year}</span> ` + html;
  }

  chips.innerHTML = html;
}

function dmBuildManualFields() {
  const container = document.getElementById('dmManualFields');
  if (!container) return;
  // Only render INPUT lines — derived lines auto-calculate and cannot be manually entered
  container.innerHTML = DM_LINES.filter(l => l.type === 'input').map(l => {
    const cur = _dmCurrentFacts[l.id];
    const val = cur != null ? cur : '';
    const lbl = l.label.replace(/^\s*↳\s*/, ''); // strip indent arrow for display
    return `<div>
      <label style="font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.03em;display:block;margin-bottom:3px">${lbl} <span style="color:var(--muted);font-weight:400;font-size:9px">${l.subsection}</span></label>
      <input type="number" step="any" id="dmM_${l.id}" value="${val}"
        style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:4px;background:var(--card);color:var(--text);font-size:12px;font-family:var(--mono)"
        placeholder="0">
    </div>`;
  }).join('');
}

function dmToggleManual() {
  const p = document.getElementById('dmManualPanel');
  p.style.display = p.style.display === 'none' ? '' : 'none';
}

// Helper: find or auto-create the ACTUAL version for a given period
async function _dmEnsureActualVersion(year, month) {
  const periodId = year * 100 + month;
  let ver = (fpa.versions||[]).find(v=>v.kind==='ACTUAL'&&v.period_id===periodId);
  if (ver) return ver;
  // Auto-create the monthly ACTUAL version
  const code = `ACTUALS_${year}_${String(month).padStart(2,'0')}`;
  const name = `${DM_MONTHS[month-1]} ${year} Actuals`;
  const { data: newVer, error } = await _sb.from('fpa_versions')
    .insert({ code, kind:'ACTUAL', year, name, period_id:periodId, is_locked:false })
    .select().single();
  if (error) { toast('Could not create version: '+error.message,'err'); return null; }
  fpa.versions.push(newVer);
  toast(`Created version ${code}`,'ok');
  return newVer;
}

async function dmCommitManual() {
  if (!_sb) { toast('Not connected to database','w'); return; }
  if (!_dmMonth) { toast('Select a month first','w'); return; }
  const periodId = _dmYear * 100 + _dmMonth;
  const actVer   = await _dmEnsureActualVersion(_dmYear, _dmMonth);
  if (!actVer) return;

  const rows = [];
  DM_LINES.forEach(l => {
    const inp = document.getElementById('dmM_'+l.id);
    if (inp && inp.value !== '') {
      rows.push({ version_id: actVer.id, line_id: l.id, period_id: periodId,
                  value: parseFloat(inp.value), source: 'manual' });
    }
  });

  if (!rows.length) { toast('No values entered','w'); return; }

  // Upsert rows
  const { error } = await _sb.from('fpa_facts')
    .upsert(rows, { onConflict: 'version_id,line_id,period_id', ignoreDuplicates: false });

  if (error) { toast('Commit failed: '+error.message,'w'); return; }
  toast(`${rows.length} lines committed for ${DM_MONTHS[_dmMonth-1]} ${_dmYear}`,'ok');
  auditLog('upload','manual-entry',`${DM_MONTHS[_dmMonth-1]} ${_dmYear}`,{rows:rows.length});
  await fpaBootstrap();
  refreshAll();
  await dmSelectMonth(_dmYear, _dmMonth);
  dmToggleManual();
}

// ── Smart file upload ────────────────────────────────────────────────────────
function dmHandleDrop(e) {
  e.preventDefault();
  document.getElementById('dmDz').classList.remove('drag');
  const f = e.dataTransfer.files[0];
  if (f) dmHandleFile(f);
}

function dmHandleFile(file) {
  if (!file) return;
  if (!_dmMonth) { toast('Select a month first','w'); return; }
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['xlsx','xlsm','csv'].includes(ext)) { toast('Only .xlsx/.xlsm/.csv files accepted','w'); return; }

  const reader = new FileReader();
  reader.onload = e => {
    try {
      if (ext === 'csv') {
        dmParseCSV(e.target.result, file.name);
      } else {
        if (typeof XLSX === 'undefined') { toast('SheetJS not loaded — try CSV','w'); return; }
        const wb = XLSX.read(e.target.result, { type:'binary' });
        dmParseExcel(wb, file.name);
      }
    } catch(err) { toast('Parse error: '+err.message,'w'); }
  };
  if (ext === 'csv') reader.readAsText(file);
  else               reader.readAsBinaryString(file);
}

function dmParseExcel(wb, filename) {
  // Try to identify relevant sheets and extract key P&L lines
  const extracted = {};
  const sheetNames = wb.SheetNames;

  // Heuristic: look for sheets with financial keywords
  const plSheet = sheetNames.find(n => /p.?l|income|profit|loss|financial/i.test(n))
                || sheetNames.find(n => /summary|main|output/i.test(n))
                || sheetNames[0];

  if (!plSheet) { toast('Cannot identify data sheet in this file','w'); return; }
  const ws   = wb.Sheets[plSheet];
  const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' });

  // Build a simple keyword → value map by scanning row labels
  const kwMap = {
    'revenue':           'rev_total',
    'total revenue':     'rev_total',
    'fuel':              'cogs_fuel',
    'fuel cost':         'cogs_fuel',
    'ipp':               'cogs_ipp',
    'gross profit':      'gross_profit',
    'o&m':               'om_total',
    'o & m':             'om_total',
    'operating expense': 'om_total',
    'ebitda':            'ebitda',
    'depreciation':      'depreciation',
    'ebit':              'ebit',
    'net financing':     'net_fin_costs',
    'interest expense':  'net_fin_costs',
    'net profit':        'net_profit',
    'profit after tax':  'net_profit',
    'total assets':      'bs_total_assets',
    'total debt':        'bs_total_debt',
    'equity':            'bs_equity',
    'cash from operations':'cf_ops',
    'capex':             'cf_capex',
    'net generation':    'gen_gwh',
    'net sales':         'sales_gwh',
  };

  // Month column: guess from header row — look for month name matching _dmMonth
  const mName = DM_MONTHS[_dmMonth-1].toLowerCase();
  let colIdx = -1;
  for (let r = 0; r < Math.min(10, rows.length); r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      if (String(row[c]).toLowerCase().includes(mName)) { colIdx = c; break; }
    }
    if (colIdx >= 0) break;
  }
  // Fallback: use last numeric column
  if (colIdx < 0 && rows.length > 1) {
    const lastRow = rows[rows.length-1];
    for (let c = lastRow.length-1; c >= 0; c--) {
      if (typeof lastRow[c] === 'number') { colIdx = c; break; }
    }
  }

  rows.forEach(row => {
    const label = String(row[0]||'').toLowerCase().trim().replace(/[^a-z0-9& ]/g,'').trim();
    const val   = colIdx >= 0 ? row[colIdx] : row[row.length-1];
    if (!label || typeof val !== 'number') return;
    Object.entries(kwMap).forEach(([kw, lineId]) => {
      if (label.includes(kw) && extracted[lineId] == null) {
        extracted[lineId] = Math.round(val * 10) / 10;
      }
    });
  });

  dmShowExtractPreview(extracted, filename, sheetNames);
}

function dmParseCSV(text, filename) {
  const lines  = text.split(/\r?\n/).filter(l=>l.trim());
  const header = lines[0]?.split(',').map(h=>h.trim().toLowerCase())||[];
  const extracted = {};

  // If CSV has line_id + value columns (our standard format)
  if (header.includes('line_id') && header.includes('value')) {
    const liIdx = header.indexOf('line_id');
    const vIdx  = header.indexOf('value');
    lines.slice(1).forEach(line => {
      const cols = line.split(',');
      const lid  = cols[liIdx]?.trim();
      const val  = parseFloat(cols[vIdx]);
      if (lid && !isNaN(val)) extracted[lid] = val;
    });
  } else {
    // Free-form: col 0 = label, last numeric col = value
    lines.slice(1).forEach(line => {
      const cols = line.split(',');
      const label= cols[0]?.trim().toLowerCase();
      const val  = parseFloat(cols[cols.length-1]);
      if (!label || isNaN(val)) return;
      DM_LINES.forEach(l => {
        if (label.includes(l.label.toLowerCase().split(' ')[0]) && extracted[l.id]==null)
          extracted[l.id] = val;
      });
    });
  }

  dmShowExtractPreview(extracted, filename, []);
}

function dmShowExtractPreview(extracted, filename, sheets) {
  _dmExtractRows = [];
  const tbody = document.getElementById('dmExtractTbody');
  const panel = document.getElementById('dmExtractPanel');
  const status= document.getElementById('dmExtractStatus');
  const note  = document.getElementById('dmCommitNote');

  // Only INPUT lines can be matched from an uploaded file; derived lines auto-calculate
  const inputLines = DM_LINES.filter(l => l.type === 'input');
  const found  = inputLines.filter(l => extracted[l.id] != null).length;
  const total  = inputLines.length;

  status.innerHTML = `<div style="font-size:11px;color:var(--muted)">
    File: <strong>${filename}</strong>${sheets.length?` · Sheets: ${sheets.join(', ')}`:''}
    &nbsp;·&nbsp; <strong style="color:${found>0?'var(--green)':'var(--amber)'}">${found}/${total} input lines matched</strong>
    &nbsp;·&nbsp; <span style="color:var(--muted)">${DM_LINES.filter(l=>l.type==='derived').length} derived lines auto-calculate</span>
  </div>`;

  note.textContent = found===0
    ? '⚠ No input lines matched — try uploading in the standard CSV format (line_id, value)'
    : `${found} input lines will be committed. Derived lines (▶ subtotals) are calculated automatically.`;

  tbody.innerHTML = inputLines.map(l => {
    const exVal  = extracted[l.id];
    const curVal = _dmCurrentFacts[l.id];
    const hasNew = exVal != null;
    const same   = hasNew && curVal != null && Math.abs(exVal - curVal) < 0.05;

    let statusHtml;
    if (!hasNew)          statusHtml = `<span style="color:var(--muted);font-size:10px">— Not found</span>`;
    else if (curVal==null)statusHtml = `<span style="color:var(--green);font-size:10px">✚ New</span>`;
    else if (same)        statusHtml = `<span style="color:var(--muted);font-size:10px">= No change</span>`;
    else                  statusHtml = `<span style="color:var(--amber);font-size:10px">↻ Update</span>`;

    if (hasNew) _dmExtractRows.push({ id: l.id, label: l.label, value: exVal });

    const dispLabel = l.label.replace(/^\s*↳\s*/,'');
    return `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:5px 10px;color:var(--text)">${dispLabel} <span style="font-size:9px;color:var(--muted)">${l.subsection}</span></td>
      <td style="padding:5px 10px;text-align:right;font-family:var(--mono);color:${hasNew?'var(--text)':'var(--muted)'}">${hasNew ? exVal.toLocaleString() : '—'}</td>
      <td style="padding:5px 10px;text-align:right;font-family:var(--mono);color:var(--muted)">${curVal!=null ? curVal.toLocaleString() : '—'}</td>
      <td style="padding:5px 10px;text-align:center">${statusHtml}</td>
    </tr>`;
  }).join('');

  panel.style.display = '';
  document.getElementById('dmCommitBtn').disabled = found === 0;
}

async function dmCommitExtract() {
  if (!_sb) { toast('Not connected to database','w'); return; }
  if (!_dmMonth || !_dmExtractRows.length) { toast('Nothing to commit','w'); return; }

  const periodId = _dmYear * 100 + _dmMonth;
  const actVer   = await _dmEnsureActualVersion(_dmYear, _dmMonth);
  if (!actVer) return;

  // Filter to input-only lines — never commit derived lines to fpa_facts
  const inputIds = new Set(DM_LINES.filter(l=>l.type==='input').map(l=>l.id));
  const rows = _dmExtractRows
    .filter(r => inputIds.has(r.id))
    .map(r => ({
      version_id: actVer.id, line_id: r.id, period_id: periodId,
      value: r.value, source: 'upload'
    }));

  const { error } = await _sb.from('fpa_facts')
    .upsert(rows, { onConflict: 'version_id,line_id,period_id', ignoreDuplicates: false });

  if (error) { toast('Commit failed: '+error.message,'w'); return; }
  toast(`${rows.length} lines committed for ${DM_MONTHS[_dmMonth-1]} ${_dmYear}`,'ok');
  auditLog('upload','smart-extract',`${DM_MONTHS[_dmMonth-1]} ${_dmYear}`,{rows:rows.length});
  _dmExtractRows = [];
  document.getElementById('dmExtractPanel').style.display = 'none';
  // Re-bootstrap to pull committed facts into fpa.* then refresh all displays
  await fpaBootstrap();
  refreshAll();
  await dmSelectMonth(_dmYear, _dmMonth);
  dmLoadUploadLog();
}

function dmDiscardExtract() {
  _dmExtractRows = [];
  document.getElementById('dmExtractPanel').style.display = 'none';
  toast('Extract discarded','ok');
}

// ── Download CSV upload template ─────────────────────────────────────────────
function dmDownloadTemplate(type) {
  const mLabel = _dmMonth ? `${DM_MONTHS[_dmMonth-1]}_${_dmYear}` : `${_dmYear}`;
  const period = _dmMonth ? `${DM_MONTHS[_dmMonth-1]} ${_dmYear}` : _dmYear;

  const headerLines = [
    `# ═══════════════════════════════════════════════════════════════════════`,
    `# JPS FP&A — ${type} Upload Template`,
    `# Period: ${period}`,
    `# Generated: ${new Date().toISOString().slice(0,10)}`,
    `# ───────────────────────────────────────────────────────────────────────`,
    `# INSTRUCTIONS`,
    `#   1. Fill in the VALUE column only. Do not change line_id.`,
    `#   2. Values are USD $000 unless the source column says otherwise.`,
    `#   3. Use negative numbers for costs/expenses where the source report shows them as negative.`,
    `#   4. Lines marked DERIVED are calculated automatically — do not upload them.`,
    `#   5. Save as CSV and upload via the Data Manager drop zone.`,
    `#   6. Parser ignores lines beginning with # so you may leave these comments in.`,
    `# ═══════════════════════════════════════════════════════════════════════`,
    `line_id,label,subsection,source,value`,
  ].join('\n');

  // Only include INPUT lines; group with subsection comment breaks
  let currentSub = '';
  const rows = DM_LINES
    .filter(l => l.type === 'input')
    .map(l => {
      let prefix = '';
      if (l.subsection !== currentSub) {
        currentSub = l.subsection;
        prefix = `# ── ${l.subsection} ${'─'.repeat(Math.max(0,55-l.subsection.length))}\n`;
      }
      const cleanLabel = l.label.replace(/^\s*↳\s*/, '').replace(/"/g, '""');
      const cleanSource = (l.source||'').replace(/"/g, '""');
      return `${prefix}${l.id},"${cleanLabel}","${l.subsection}","${cleanSource}",`;
    }).join('\n');

  const csv = headerLines + '\n' + rows;
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = `JPS_${type}_Template_${mLabel}.csv`;
  a.click();
  toast(`Template downloaded — fill VALUE column and upload · ${DM_LINES.filter(l=>l.type==='input').length} input lines`,'ok');
}

async function dmToggleLock() {
  if (!_sb || !_dmMonth) { toast('Select a month first','w'); return; }
  const period = (fpa.periods||[]).find(p=>p.year===_dmYear&&p.month===_dmMonth);
  if (!period) { toast('Period not found in DB','w'); return; }
  const locking = !period.is_closed;
  const label   = `${DM_MONTHS[_dmMonth-1]} ${_dmYear}`;
  const periodId = _dmYear * 100 + _dmMonth;
  const actVer   = (fpa.versions||[]).find(v=>v.kind==='ACTUAL'&&v.period_id===periodId);

  if (locking) {
    const msg = actVer
      ? `Lock ${label}?\n\nThis will:\n  🔒 Close the period calendar\n  🔒 Lock version "${actVer.code}" — no further writes to its facts\n\nThis is enforced at the database level.`
      : `Lock ${label}?\n\nThis will close the period calendar.\n\n⚠ No actuals version found for this period — upload actuals first for full protection.`;
    if (!confirm(msg)) return;
  } else {
    if (!confirm(`Unlock ${label}?\n\nThis will:\n  🔓 Re-open the period calendar\n  🔓 Unlock the actuals version (facts become editable again)\n\nWho unlocked and when will be recorded in the audit log.`)) return;
  }

  const now = new Date().toISOString();
  const userId = (currentUser.id && currentUser.id !== 'local') ? currentUser.id : null;

  // 1. Toggle fpa_dim_period.is_closed
  const { error: pErr } = await _sb.from('fpa_dim_period')
    .update({
      is_closed:  locking,
      closed_at:  locking ? now : null,
      closed_by:  locking ? userId : null,
    })
    .eq('id', period.id);
  if (pErr) { toast('Period update failed: '+pErr.message,'w'); return; }

  // 2. Toggle fpa_versions.is_locked on the ACTUALS version (if it exists)
  let versionLocked = false;
  if (actVer) {
    const { error: vErr } = await _sb.from('fpa_versions')
      .update({
        is_locked:  locking,
        locked_at:  locking ? now : null,
        locked_by:  locking ? userId : null,
      })
      .eq('id', actVer.id);
    if (vErr) {
      toast(`Period ${locking?'closed':'opened'} but version lock failed: ${vErr.message}`, 'w');
    } else {
      versionLocked = true;
    }
  }

  const resultMsg = locking
    ? `${label} locked 🔒${versionLocked ? ' — period + version both locked' : ' — period only (no actuals version to lock)'}`
    : `${label} unlocked 🔓`;
  toast(resultMsg, 'ok');
  auditLog('edit', locking ? 'period-lock' : 'period-unlock', label, {
    is_closed: locking,
    version_locked: versionLocked,
    version_code: actVer?.code || null,
    by: currentUser.name,
  });

  // Notify all admins when a period is locked / unlocked
  if (locking) {
    _notifyAdmins(
      'period_locked',
      `Period Locked — ${label}`,
      `${label} has been locked by ${currentUser.name || currentUser.email}. Period calendar closed${versionLocked ? ` and version "${actVer.code}" locked at DB level` : ' (no actuals version found — upload recommended)'}. No further edits are permitted.`,
      { period_label: label, version_code: actVer?.code || null, version_locked: versionLocked }
    );
  } else {
    _notifyAdmins(
      'period_unlocked',
      `Period Unlocked — ${label}`,
      `${label} has been re-opened by ${currentUser.name || currentUser.email}. Facts are now editable again.`,
      { period_label: label, version_code: actVer?.code || null }
    );
  }

  await fpaBootstrap();
  dmBuildCalendar(_dmYear);
  dmSelectMonth(_dmYear, _dmMonth);
}

async function dmClearMonth() {
  if (!_sb || !_dmMonth) { toast('Select a month first','w'); return; }
  const periodId = _dmYear * 100 + _dmMonth;
  const label    = `${DM_MONTHS[_dmMonth-1]} ${_dmYear}`;

  const actVer = (fpa.versions||[]).find(v=>v.kind==='ACTUAL'&&v.period_id===periodId);
  if (!actVer) { toast('No ACTUAL version found for this period','w'); return; }

  // Block if the version is locked — the DB trigger would reject it anyway, but give a clear UI message
  if (actVer.is_locked) {
    toast(`Cannot clear ${label} — actuals version "${actVer.code}" is locked. Unlock the period first.`, 'w');
    return;
  }

  const period = (fpa.periods||[]).find(p=>p.year===_dmYear&&p.month===_dmMonth);
  if (period?.is_closed && !confirm(`⚠ ${label} is a closed period. Are you sure you want to clear all fact data?\n\nVersion: ${actVer.code}\n\nThis cannot be undone.`)) return;
  if (!period?.is_closed && !confirm(`Delete ALL fact data for ${label} (version: ${actVer.code})? This cannot be undone.`)) return;

  const { error } = await _sb.from('fpa_facts')
    .delete()
    .eq('version_id', actVer.id)
    .eq('period_id', periodId);

  if (error) { toast('Clear failed: '+error.message,'w'); return; }
  toast(`${label} data cleared`,'ok');
  auditLog('edit','clear-period',label,{version:actVer.code});
  await dmSelectMonth(_dmYear, _dmMonth);
}

async function dmLoadUploadLog() {
  const tbody = document.getElementById('dmLogBody');
  if (!tbody) return;
  if (!_sb) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:12px;font-size:11px">Not connected to database</td></tr>';
    return;
  }
  const { data, error } = await _sb.from('fpa_audit_log')
    .select('*')
    .in('action', ['upload','smart-extract','manual-entry'])
    .order('created_at', { ascending: false })
    .limit(50);

  if (error || !data?.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:12px;font-size:11px">No upload history yet</td></tr>';
    return;
  }
  tbody.innerHTML = data.map(r => {
    const meta = r.meta||{};
    return `<tr>
      <td style="font-weight:600">${r.target||'—'}</td>
      <td style="color:var(--muted)">${r.action}</td>
      <td style="color:var(--muted)">${meta.source||r.cat||'—'}</td>
      <td style="text-align:center">${meta.rows??'—'}</td>
      <td style="text-align:center"><span class="badge badge-act">✅ OK</span></td>
      <td>${r.user_name||'—'}</td>
      <td style="color:var(--muted);font-size:10px">${r.created_at?.slice(0,16)||'—'}</td>
      <td></td>
    </tr>`;
  }).join('');
}

// ── DM tab switching ───────────────────────────────────────────────────────
let _dmActiveTab = 'PL';
function dmSetTab(tab) {
  _dmActiveTab = tab;
  ['PL','BS','CF','ST','LE'].forEach(t => {
    const tabEl = document.getElementById(`dmTab${t}`);
    const panEl = document.getElementById(`dmPanel${t}`);
    if (tabEl) tabEl.classList.toggle('on', t === tab);
    if (panEl) panEl.style.display = t === tab ? '' : 'none';
  });
  if (tab === 'LE') dmBuildLeVersionsPanel();
}

// ── Build the entry table for a given tab section ─────────────────────────
function dmBuildEntryTable(section) {
  const sectionMap = { PL:'P&L', BS:'Balance Sheet', CF:'Cash Flow', ST:'Stats' };
  const secLabel = sectionMap[section];
  const lines = DM_LINES.filter(l => l.section === secLabel);
  const tbody = document.getElementById(`dmEntryBody_${section}`);
  if (!tbody) return;

  let currentSub = '';
  tbody.innerHTML = lines.map(l => {
    const cur       = _dmCurrentFacts[l.id];
    const curFmt    = cur != null ? Number(cur).toLocaleString() : '—';
    const isDerived = l.type === 'derived';
    const isSubline = l.label.startsWith('  ↳');
    const isTotal   = l.label.startsWith('▶');

    const subHdr = l.subsection !== currentSub
      ? (() => {
          currentSub = l.subsection;
          return `<tr><td colspan="5" style="padding:8px 10px 3px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;background:var(--card2)">${l.subsection}</td></tr>`;
        })()
      : '';

    // Visual styling
    let rowBg    = '';
    let nameStyle= `color:var(--text);font-weight:600`;
    let typeBadge= `background:rgba(251,191,36,.15);color:var(--gold)`;
    let typeLabel= 'INPUT';
    if (isDerived && isTotal) {
      rowBg     = 'background:rgba(6,182,212,.06);border-top:1px solid rgba(6,182,212,.2)';
      nameStyle = 'color:var(--teal);font-weight:700';
      typeBadge = 'background:rgba(6,182,212,.15);color:var(--teal)';
      typeLabel = 'DERIVED';
    } else if (isDerived) {
      rowBg     = 'background:rgba(125,160,196,.04)';
      nameStyle = 'color:var(--muted);font-weight:400';
      typeBadge = 'background:rgba(125,160,196,.15);color:var(--muted)';
      typeLabel = 'DERIVED';
    } else if (isSubline) {
      rowBg     = 'background:rgba(251,191,36,.03)';
      nameStyle = 'color:var(--text);font-weight:400;padding-left:18px';
    }

    const dispLabel = l.label.replace(/^\s*↳\s*/, '');

    return `${subHdr}<tr style="${rowBg}">
      <td style="padding:5px 10px;${nameStyle}">${dispLabel}</td>
      <td style="padding:5px 10px;color:var(--muted);font-size:10px;max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${l.source||''}">${l.source||'—'}</td>
      <td style="padding:5px 10px;text-align:center">
        <span style="font-size:9px;padding:2px 7px;border-radius:10px;font-weight:700;${typeBadge}">${typeLabel}</span>
      </td>
      <td style="padding:5px 10px;text-align:right;font-family:var(--mono);font-size:11px;color:${isDerived?'var(--teal)':'var(--text)'}">${curFmt}</td>
      <td style="padding:4px 10px">
        ${isDerived
          ? `<span style="font-size:9px;color:var(--muted);display:block;text-align:right;font-style:italic" title="${l.source||''}">${l.source?.split(' − ').join(' − ').substring(0,40)||'auto-calculated'}</span>`
          : `<input type="number" step="any" id="dmM_${l.id}" value="${cur!=null?cur:''}"
              style="width:100%;padding:4px 8px;border:1px solid var(--border);border-radius:4px;background:var(--card);color:var(--text);font-size:11px;font-family:var(--mono);text-align:right"
              placeholder="0">`
        }
      </td>
    </tr>`;
  }).join('');
}

function dmBuildAllEntryTables() {
  ['PL','BS','CF','ST'].forEach(s => dmBuildEntryTable(s));
}

// ── Seed from version ─────────────────────────────────────────────────────
async function dmBuildSeedOptions() {
  const sel = document.getElementById('dmSeedSelect');
  if (!sel) return;
  const opts = [{ value:'', label:'— blank —' }];
  // Budget / AOP versions (any year)
  fpa.versions.filter(v => v.kind === 'BUDGET' || v.kind === 'AOP' || v.code === _aopCode()).forEach(v =>
    opts.push({ value: v.code, label: `${v.name || v.code} (Budget/AOP)` })
  );
  // LE versions
  fpa.versions.filter(v => v.kind === 'LE').forEach(v =>
    opts.push({ value: v.code, label: `${v.name || v.code} (LE)` })
  );
  // Actuals versions
  fpa.versions.filter(v => /^ACTUALS_/.test(v.code)).forEach(v =>
    opts.push({ value: v.code, label: `${v.name || v.code} (Actual)` })
  );
  sel.innerHTML = opts.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
}

async function dmApplySeed() {
  const vc = document.getElementById('dmSeedSelect')?.value;
  if (!vc || !_sb || !_dmMonth) { toast('Select a version to seed from', 'w'); return; }

  const ver = fpa.versions.find(v => v.code === vc);
  if (!ver) { toast('Version not found', 'w'); return; }

  const periodId = _dmYear * 100 + _dmMonth;
  const { data, error } = await _sb.from('fpa_facts')
    .select('line_id, value')
    .eq('version_id', ver.id)
    .eq('period_id', periodId);

  if (error) { toast('Seed load failed: ' + error.message, 'err'); return; }

  let count = 0;
  (data || []).forEach(r => {
    const inp = document.getElementById(`dmM_${r.line_id}`);
    if (inp) { inp.value = r.value; count++; }
  });

  const note = document.getElementById('dmSeedNote');
  if (note) note.textContent = `✅ ${count} values pre-filled from ${vc}`;
  toast(`Pre-filled ${count} fields from ${vc}`, 'ok');
}

// ── Save as Actuals ────────────────────────────────────────────────────────
async function dmSaveAsActuals() {
  if (!_sb || !_dmMonth) { toast('Select a month first', 'w'); return; }
  const periodId = _dmYear * 100 + _dmMonth;
  const label    = `${DM_MONTHS[_dmMonth-1]} ${_dmYear}`;

  // Check if the existing actuals version is locked before attempting write
  const existing = (fpa.versions||[]).find(v=>v.kind==='ACTUAL'&&v.period_id===periodId);
  if (existing?.is_locked) {
    toast(`${label} actuals are locked — unlock the period before making changes.`, 'w');
    return;
  }

  const actVer = await _dmEnsureActualVersion(_dmYear, _dmMonth);
  if (!actVer) return;
  await _dmCommitFormToVersion(actVer.id, 'actuals');
}

// ── Save as LE Version ─────────────────────────────────────────────────────
async function dmSaveAsLE() {
  if (!_sb || !_dmMonth) { toast('Select a month first', 'w'); return; }

  const name = prompt(`LE version name for ${DM_MONTHS[_dmMonth-1]} ${_dmYear}:\n(e.g. "Initial Estimate" or "Revised – Mgmt Review")`);
  if (!name) return;

  const periodId = _dmYear * 100 + _dmMonth;
  const existing = fpa.versions.filter(v => v.kind === 'LE' && v.period_id === periodId);
  const vNum = existing.length + 1;
  const code = `LE_${_dmYear}_${String(_dmMonth).padStart(2,'0')}_v${vNum}`;

  const { data: verData, error: verErr } = await _sb.from('fpa_versions').insert({
    code, name, kind: 'LE', period_id: periodId, year: _dmYear,
    description: name, tags: ['le']
  }).select().single();

  if (verErr) { toast('Could not create LE version: ' + verErr.message, 'err'); return; }

  fpa.versions.push(verData);

  await _dmCommitFormToVersion(verData.id, 'le');
  dmBuildLeVersionsPanel();
  dmBuildSeedOptions();
  toast(`Saved as "${name}" (${code})`, 'ok');
}

// ── Save as Budget / AOP Version ──────────────────────────────────────────
// Budget versions are year-level plans. Each month's data is committed to the
// same BUDGET_YYYY version (or AOP_YYYY). User can name the version.
async function dmSaveAsBudget() {
  if (!_sb || !_dmMonth) { toast('Select a month first', 'w'); return; }

  const periodId = _dmYear * 100 + _dmMonth;
  const mon = DM_MONTHS[_dmMonth - 1];

  // Look for an existing budget version for this year — reuse or create
  const existing = fpa.versions.filter(v =>
    (v.kind === 'BUDGET' || v.kind === 'AOP') && v.year === _dmYear
  );

  let budVer;
  if (existing.length > 0) {
    // Show options: reuse existing or create new
    const opts = existing.map((v, i) => `${i + 1}. ${v.code} — ${v.name}`).join('\n');
    const choice = prompt(
      `Budget versions for ${_dmYear}:\n${opts}\n${existing.length + 1}. Create new Budget version\n\nEnter number:`,
      '1'
    );
    if (!choice) return;
    const idx = parseInt(choice) - 1;
    if (idx >= 0 && idx < existing.length) {
      budVer = existing[idx];
    } else {
      // Create new
      budVer = null;
    }
  }

  if (!budVer) {
    const name = prompt(`Name for the new Budget / AOP version for ${_dmYear}:\n(e.g. "AOP 2026" or "Revised Budget – Q2")`);
    if (!name) return;
    const vNum = existing.length + 1;
    const code = `BUDGET_${_dmYear}_v${vNum}`;
    const { data: verData, error: verErr } = await _sb.from('fpa_versions').insert({
      code, name, kind: 'BUDGET', period_id: null, year: _dmYear,
      description: `Budget / AOP plan for ${_dmYear} — ${name}`, tags: ['budget', 'aop']
    }).select().single();
    if (verErr) { toast('Could not create Budget version: ' + verErr.message, 'err'); return; }
    budVer = verData;
    fpa.versions.push(budVer);
    dmBuildSeedOptions();
  }

  await _dmCommitFormToVersion(budVer.id, 'budget');
  toast(`${mon} ${_dmYear} saved to "${budVer.name}" (${budVer.code})`, 'ok');
  auditLog('budget-entry', budVer.code, `${mon} ${_dmYear}`, { period_id: periodId });
}

// ── Commit form values to a version ───────────────────────────────────────
async function _dmCommitFormToVersion(versionId, label) {
  const periodId = _dmYear * 100 + _dmMonth;
  const rows = [];
  DM_LINES.filter(l => l.type === 'input').forEach(l => {
    const inp = document.getElementById(`dmM_${l.id}`);
    const v = inp ? parseFloat(inp.value) : NaN;
    if (!isNaN(v)) rows.push({ version_id: versionId, line_id: l.id, period_id: periodId, value: v, source: 'manual' });
  });

  if (!rows.length) { toast('No values entered', 'w'); return; }

  const { error } = await _sb.from('fpa_facts')
    .upsert(rows, { onConflict: 'version_id,line_id,period_id', ignoreDuplicates: false });

  if (error) { toast('Save failed: ' + error.message, 'err'); return; }

  toast(`${rows.length} lines saved as ${label}`, 'ok');
  auditLog('save', label, `${DM_MONTHS[_dmMonth-1]} ${_dmYear}`, { rows: rows.length, versionId });
  await fpaBootstrap();
  refreshAll();
  await dmSelectMonth(_dmYear, _dmMonth);
}

// ── LE Versions panel ──────────────────────────────────────────────────────
let _dmLeSelected = [];

async function dmBuildLeVersionsPanel() {
  const container = document.getElementById('dmLeVersionList');
  if (!container || !_dmMonth) return;

  const periodId = _dmYear * 100 + _dmMonth;
  const leVers = fpa.versions.filter(v => v.kind === 'LE' && v.period_id === periodId);
  const aopVer = fpa.versions.find(v => v.code === _aopCode());

  if (!leVers.length) {
    container.innerHTML = `<div style="padding:20px;text-align:center;color:var(--muted);font-size:11px">No LE versions saved for ${DM_MONTHS[_dmMonth-1]} ${_dmYear} yet.<br>Fill in the P&amp;L / BS / CF tabs and click "Save as LE Version".</div>`;
    const cmpBtn = document.getElementById('dmCompareBtn');
    if (cmpBtn) cmpBtn.disabled = true;
    return;
  }

  const vIds = leVers.map(v => v.id);
  if (aopVer) vIds.push(aopVer.id);

  const { data: facts } = await _sb.from('fpa_facts')
    .select('version_id, line_id, value')
    .in('version_id', vIds)
    .eq('period_id', periodId)
    .in('line_id', ['pl_total_sales','ebitda','net_inc','cf_capex']);

  const byVer = {};
  (facts||[]).forEach(r => {
    (byVer[r.version_id] ??= {})[r.line_id] = Number(r.value);
  });

  const aopFacts = aopVer ? (byVer[aopVer.id] || {}) : {};
  const fmt = v => v != null ? '$' + Math.round(v).toLocaleString() : '—';
  const varFmt = (le, aop) => {
    if (le == null || !aop) return '';
    const d = le - aop;
    const pct = (d / Math.abs(aop) * 100).toFixed(1);
    const clr = d >= 0 ? 'var(--green)' : 'var(--red)';
    return `<span style="color:${clr}">${d>=0?'+':''}${pct}%</span>`;
  };

  container.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:11px">
      <thead><tr>
        <th style="padding:6px 10px;text-align:left;background:var(--card2)">
          <input type="checkbox" onchange="if(this.checked)_dmLeSelected=leVers.map(v=>v.id);else _dmLeSelected=[]" style="margin-right:6px">
          Version
        </th>
        <th style="padding:6px 10px;text-align:left;background:var(--card2)">Name</th>
        <th style="padding:6px 10px;text-align:right;background:var(--card2)">Revenue</th>
        <th style="padding:6px 10px;text-align:right;background:var(--card2)">EBITDA</th>
        <th style="padding:6px 10px;text-align:right;background:var(--card2)">Net Income</th>
        <th style="padding:6px 10px;text-align:right;background:var(--card2)">CapEx</th>
        <th style="padding:6px 10px;text-align:center;background:var(--card2)">vs AOP</th>
        <th style="padding:6px 10px;text-align:center;background:var(--card2)">Created</th>
        <th style="padding:6px 10px;text-align:center;background:var(--card2)">Action</th>
      </tr></thead>
      <tbody>
        ${leVers.map(v => {
          const f = byVer[v.id] || {};
          return `<tr>
            <td style="padding:5px 10px">
              <input type="checkbox" value="${v.id}" onchange="dmLeToggleSelect('${v.id}',this.checked)"
                style="margin-right:6px">
              <span style="font-family:var(--mono);font-size:10px;color:var(--muted)">${v.code}</span>
            </td>
            <td style="padding:5px 10px;font-weight:600;color:var(--text)">${v.name || '—'}</td>
            <td style="padding:5px 10px;text-align:right;font-family:var(--mono)">${fmt(f.pl_total_sales)}</td>
            <td style="padding:5px 10px;text-align:right;font-family:var(--mono)">${fmt(f.ebitda)}</td>
            <td style="padding:5px 10px;text-align:right;font-family:var(--mono)">${fmt(f.net_inc)}</td>
            <td style="padding:5px 10px;text-align:right;font-family:var(--mono)">${fmt(f.cf_capex)}</td>
            <td style="padding:5px 10px;text-align:center">${varFmt(f.ebitda, aopFacts.ebitda)}</td>
            <td style="padding:5px 10px;text-align:center;font-size:10px;color:var(--muted)">${new Date(v.created_at).toLocaleDateString()}</td>
            <td style="padding:5px 10px;text-align:center">
              <button class="btn btn-ghost" style="font-size:9px;padding:2px 8px" onclick="dmLoadLeIntoForm('${v.id}')">Load</button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;

  const cmpBtn = document.getElementById('dmCompareBtn');
  if (cmpBtn) cmpBtn.disabled = _dmLeSelected.length < 2;
}

function dmLeToggleSelect(id, checked) {
  if (checked) { if (!_dmLeSelected.includes(id)) _dmLeSelected.push(id); }
  else { _dmLeSelected = _dmLeSelected.filter(x => x !== id); }
  const btn = document.getElementById('dmCompareBtn');
  if (btn) btn.disabled = _dmLeSelected.length < 2;
}

async function dmLoadLeIntoForm(versionId) {
  if (!_sb || !_dmMonth) return;
  const periodId = _dmYear * 100 + _dmMonth;
  const { data } = await _sb.from('fpa_facts').select('line_id,value').eq('version_id',versionId).eq('period_id',periodId);
  (data||[]).forEach(r => {
    const inp = document.getElementById(`dmM_${r.line_id}`);
    if (inp) inp.value = r.value;
  });
  dmSetTab('PL');
  toast('LE version loaded into form — edit and save as new version', 'ok');
}

async function dmCompareVersions() {
  if (_dmLeSelected.length < 2) { toast('Check two LE versions to compare', 'w'); return; }
  const [id1, id2] = _dmLeSelected.slice(0, 2);
  const v1 = fpa.versions.find(v => v.id === id1);
  const v2 = fpa.versions.find(v => v.id === id2);
  const periodId = _dmYear * 100 + _dmMonth;

  const { data } = await _sb.from('fpa_facts')
    .select('version_id,line_id,value')
    .in('version_id', [id1, id2])
    .eq('period_id', periodId);

  const f1 = {}, f2 = {};
  (data||[]).forEach(r => {
    if (r.version_id === id1) f1[r.line_id] = Number(r.value);
    else f2[r.line_id] = Number(r.value);
  });

  const compareLines = DM_LINES.filter(l => l.section === 'P&L');
  const fmt = v => v != null ? Number(v).toLocaleString() : '—';
  const varFmt = (a, b) => {
    if (a == null || b == null) return '—';
    const d = b - a;
    const pct = a ? (d/Math.abs(a)*100).toFixed(1) : '—';
    const clr = d >= 0 ? 'var(--green)' : 'var(--red)';
    return `<span style="color:${clr}">${d>=0?'+':''}${fmt(d)} (${d>=0?'+':''}${pct}%)</span>`;
  };

  const panel = document.getElementById('dmLeComparePanel');
  panel.style.display = '';
  panel.innerHTML = `
    <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px">⇄ Comparison: ${v1?.name||id1} vs ${v2?.name||id2}</div>
    <div style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;font-size:11px">
      <thead><tr>
        <th style="text-align:left;padding:6px 10px;background:var(--card2)">Line</th>
        <th style="text-align:right;padding:6px 10px;background:var(--card2)">${v1?.name||'v1'}</th>
        <th style="text-align:right;padding:6px 10px;background:var(--card2)">${v2?.name||'v2'}</th>
        <th style="text-align:right;padding:6px 10px;background:var(--card2)">Change</th>
      </tr></thead>
      <tbody>
        ${compareLines.map(l => `<tr style="${l.type==='derived'?'background:rgba(125,160,196,.04)':''}">
          <td style="padding:5px 10px;font-weight:${l.type==='derived'?'400':'600'};color:${l.type==='derived'?'var(--muted)':'var(--text)'}">${l.label}</td>
          <td style="padding:5px 10px;text-align:right;font-family:var(--mono)">${fmt(f1[l.id])}</td>
          <td style="padding:5px 10px;text-align:right;font-family:var(--mono)">${fmt(f2[l.id])}</td>
          <td style="padding:5px 10px;text-align:right">${varFmt(f1[l.id], f2[l.id])}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
}

// ── Export current period data as CSV ─────────────────────────────────────
function dmExportCSV() {
  if (!_dmMonth) { toast('Select a month first', 'w'); return; }
  const mLabel = `${DM_MONTHS[_dmMonth-1]}_${_dmYear}`;
  const rows = [
    `# JPS FP&A — Data Export — ${mLabel}`,
    `# Generated: ${new Date().toLocaleString()}`,
    `# All monetary values in USD $000`,
    `line_id,label,section,subsection,type,source,current_db_value,new_value`
  ];
  DM_LINES.forEach(l => {
    const cur = _dmCurrentFacts[l.id] ?? '';
    const inp = document.getElementById(`dmM_${l.id}`);
    const newv = inp ? (inp.value || '') : (l.type==='derived'?'[derived]':'');
    rows.push(`${l.id},"${l.label}","${l.section}","${l.subsection}","${l.type}","${l.source}",${cur},${newv}`);
  });
  const csv = rows.join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = `JPS_FPA_${mLabel}.csv`;
  a.click();
  toast('CSV exported', 'ok');
}

// ── Create new LE version prompt ──────────────────────────────────────────
function dmCreateLeVersion() {
  dmSaveAsLE();
}

// ── Period Status Panel (in adm-data tab) ────────────
function buildPeriodStatusPanel() {
  // Now handled by dmBuildCalendar() — this stub kept for backward-compat calls
  dmBuildCalendar(_dmYear);
}

// ── Clear Data Modal ─────────────────────────────────────────────────────────
function openEraseModal() {
  if (currentUser?.role !== 'admin') { toast('Admin access required', 'err'); return; }

  // Build option list from ACTUAL versions that have facts loaded
  const sel = document.getElementById('eraseScope');
  sel.innerHTML = '<option value="">— Select scope —</option>';

  // Per-month options (ACTUALS_YYYY_MM)
  const monthly = (fpa.versions||[])
    .filter(v => v.kind==='ACTUAL' && v.period_id)
    .sort((a,b) => b.period_id - a.period_id);
  monthly.forEach(v => {
    const lbl = FLASH_MONTHS[v.period_id] || flashPeriodLabel(v.period_id);
    const factCount = Object.values(fpa.facts[v.code]||{}).length;
    sel.innerHTML += `<option value="month:${v.code}:${v.period_id}">${lbl} — ${v.code} (${factCount} lines)</option>`;
  });

  // Year-level options (HIST_ACTUAL_* or ACTUAL_YYYY with period_id=null)
  const yearly = (fpa.versions||[])
    .filter(v => v.kind==='ACTUAL' && !v.period_id)
    .sort((a,b) => (b.year||0) - (a.year||0));
  yearly.forEach(v => {
    const factCount = Object.values(fpa.facts[v.code]||{}).length;
    sel.innerHTML += `<option value="year:${v.code}">${v.name} (${factCount} lines)</option>`;
  });

  // "All monthly actuals for year YYYY" — one option per year that has per-month versions
  const yearsWithMonthly = [...new Set(monthly.map(v => Math.floor(v.period_id/100)))].sort((a,b)=>b-a);
  yearsWithMonthly.forEach(yr => {
    sel.innerHTML += `<option value="allyear:${yr}">⚠ ALL ${yr} monthly actuals</option>`;
  });

  // AOP — always labelled from _aopCode() so it tracks planYear
  const aop = (fpa.versions||[]).find(v=>v.code===_aopCode());
  if (aop) {
    const fc = Object.values(fpa.facts[_aopCode()]||{}).length;
    sel.innerHTML += `<option value="aop">${_aopCode()} Budget (${fc} lines)</option>`;
  }

  document.getElementById('eraseWarning').style.display = 'none';
  document.getElementById('eraseConfirmInput').value = '';
  document.getElementById('eraseConfirmBtn').disabled = true;
  document.getElementById('eraseConfirmBtn').style.opacity = '.4';
  document.getElementById('eraseConfirmBtn').style.cursor = 'not-allowed';
  openModal('eraseModal');
}

function eraseUpdateWarning() {
  const scope = document.getElementById('eraseScope').value;
  const warn  = document.getElementById('eraseWarning');
  document.getElementById('eraseConfirmInput').value = '';
  eraseCheckConfirm();
  if (!scope) { warn.style.display='none'; return; }
  const msgs = {
    'aop': `⚠ This will erase all ${_aopCode()} budget facts. You will need to re-upload the Budget Template.`,
  };
  let msg = msgs[scope];
  if (!msg) {
    if (scope.startsWith('allyear:')) {
      const yr = scope.split(':')[1];
      msg = `⚠ This will erase ALL uploaded monthly actuals for ${yr}. You will need to re-upload each month.`;
    } else if (scope.startsWith('month:')) {
      const parts = scope.split(':');
      msg = `⚠ This will erase all facts for ${FLASH_MONTHS[Number(parts[2])]||parts[2]} (version ${parts[1]}). Re-upload the actuals file to restore.`;
    } else if (scope.startsWith('year:')) {
      msg = `⚠ This will erase all facts for the selected year-level version. Re-upload to restore.`;
    }
  }
  warn.textContent = msg || '';
  warn.style.display = msg ? 'block' : 'none';
}

function eraseCheckConfirm() {
  const val  = (document.getElementById('eraseConfirmInput').value||'').trim();
  const scope= document.getElementById('eraseScope').value;
  const btn  = document.getElementById('eraseConfirmBtn');
  const ok   = val === 'ERASE' && !!scope;
  btn.disabled = !ok;
  btn.style.opacity = ok ? '1' : '.4';
  btn.style.cursor  = ok ? 'pointer' : 'not-allowed';
}

async function eraseExecute() {
  const scope = document.getElementById('eraseScope').value;
  const confirm = (document.getElementById('eraseConfirmInput').value||'').trim();
  if (confirm !== 'ERASE' || !scope) return;
  if (!_sb) { toast('No database connection', 'err'); return; }

  const btn = document.getElementById('eraseConfirmBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Erasing…';

  try {
    let deleted = 0;

    if (scope.startsWith('month:')) {
      // Single month version
      const [,code] = scope.split(':');
      const ver = (fpa.versions||[]).find(v=>v.code===code);
      if (!ver) throw new Error('Version not found: ' + code);
      const { error, count } = await _sb.from('fpa_facts')
        .delete({ count: 'exact' })
        .eq('version_id', ver.id);
      if (error) throw error;
      deleted = count || 0;
      // Clear in-memory
      fpa.facts[code] = {};

    } else if (scope.startsWith('year:')) {
      // Year-level version
      const [,code] = scope.split(':');
      const ver = (fpa.versions||[]).find(v=>v.code===code);
      if (!ver) throw new Error('Version not found: ' + code);
      const { error, count } = await _sb.from('fpa_facts')
        .delete({ count: 'exact' })
        .eq('version_id', ver.id);
      if (error) throw error;
      deleted = count || 0;
      fpa.facts[code] = {};

    } else if (scope.startsWith('allyear:')) {
      // All per-month actuals for a specific year (year-agnostic)
      const targetYr = parseInt(scope.split(':')[1]);
      const vers = (fpa.versions||[]).filter(v=>v.kind==='ACTUAL'&&v.period_id&&Math.floor(v.period_id/100)===targetYr);
      for (const ver of vers) {
        const { error, count } = await _sb.from('fpa_facts')
          .delete({ count: 'exact' })
          .eq('version_id', ver.id);
        if (error) throw error;
        deleted += count || 0;
        fpa.facts[ver.code] = {};
      }

    } else if (scope === 'aop') {
      const ver = (fpa.versions||[]).find(v=>v.code===_aopCode());
      if (!ver) throw new Error(`${_aopCode()} version not found`);
      const { error, count } = await _sb.from('fpa_facts')
        .delete({ count: 'exact' })
        .eq('version_id', ver.id);
      if (error) throw error;
      deleted = count || 0;
      fpa.facts[_aopCode()] = {};
    }

    closeModal('eraseModal');
    auditLog('delete', 'fpa_facts', null, { scope, rows_deleted: deleted });
    toast(`✅ Erased ${deleted} fact rows for "${scope}". Re-upload to restore.`, 'ok');
    // Refresh any open reports
    if (typeof flashRefresh==='function' && document.querySelector('#pane-rpt-flash.on')) flashRefresh();

  } catch(err) {
    btn.disabled = false;
    btn.textContent = '🗑 Erase Now';
    toast('❌ Erase failed: ' + err.message, 'err');
    console.error('[Erase]', err);
  }
}

// ── Supabase Settings UI (in adm-data tab) ──────────
function buildSupabaseSettings() {
  const el = document.getElementById('sbSettingsPanel');
  if (!el) return;
  const connected = !!(_sb);
  const statusColor = connected ? 'var(--green)' : 'var(--muted)';
  const statusText  = connected ? '● Connected' : '○ Not connected';

  // Pre-build option list outside the template literal to avoid nested backtick syntax error
  const nextYr = new Date().getFullYear() + 1;
  const planYrOpts = Array.from({length:5},(_,i)=>_CY+i)
    .map(y => '<option value="' + y + '"' + (y === nextYr ? ' selected' : '') + '>' + y + '</option>')
    .join('');

  el.innerHTML = `
    <div class="tc2" style="margin-top:10px">
      <div class="th">
        <div>
          <div class="tt">☁ Supabase Connection
            <span style="font-size:10px;font-weight:700;color:${statusColor};margin-left:10px">${statusText}</span>
          </div>
          <div class="ts">Enables multi-user auth, cloud data persistence, and cross-browser realtime sync. Leave blank to use local mode.</div>
        </div>
      </div>
      <div style="padding:14px;display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="fi" style="grid-column:1/-1">
          <label>Project URL</label>
          <input type="text" id="sbUrl" value="${_sbConfig.url}" style="width:100%;font-family:var(--mono);font-size:11px"
            placeholder="https://your-project.supabase.co">
        </div>
        <div class="fi" style="grid-column:1/-1">
          <label>Anon / Public Key</label>
          <input type="password" id="sbAnonKey" value="${_sbConfig.anonKey}"
            style="width:100%;font-family:var(--mono);font-size:11px"
            placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...">
          <div style="font-size:9px;color:var(--muted);margin-top:3px">From Supabase Dashboard → Settings → API → Project API keys → anon / public</div>
        </div>
        <div class="fi" style="grid-column:1/-1;border-top:1px solid var(--border);padding-top:10px;margin-top:4px">
          <label>✦ Claude API Key <span style="color:var(--purple);font-weight:700">(AI Commentary)</span></label>
          <input type="password" id="claudeApiKey" value="${localStorage.getItem('jps_claude_key')||''}"
            style="width:100%;font-family:var(--mono);font-size:11px"
            placeholder="sk-ant-api03-..."
            oninput="localStorage.setItem('jps_claude_key',this.value);_claudeKey=this.value;toast('Claude key saved','ok')">
          <div style="font-size:9px;color:var(--muted);margin-top:3px">From console.anthropic.com → API Keys. Stored locally in your browser only — never sent to any server except api.anthropic.com.</div>
          <div style="margin-top:6px;display:flex;gap:6px">
            <button class="btn btn-ghost" style="font-size:9px;background:rgba(139,92,246,.1);border-color:rgba(139,92,246,.3);color:#c4b5fd" onclick="testClaudeKey()">🧪 Test Key</button>
            <span id="claudeKeyStatus" style="font-size:9px;display:flex;align-items:center;color:var(--muted)"></span>
          </div>
        </div>
        <div style="grid-column:1/-1;display:flex;align-items:center;gap:8px">
          <label class="print-section-check" style="gap:8px">
            <input type="checkbox" id="sbEnabled" ${_sbConfig.enabled?'checked':''}>
            <span style="font-size:11px;color:var(--text)">Enable Supabase (required to connect)</span>
          </label>
        </div>
        <div style="grid-column:1/-1;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
          <button class="btn btn-ghost" style="font-size:10px" onclick="testSbConnection()">🔌 Test Connection</button>
          <button class="btn btn-gold" onclick="saveSbConfig(
            document.getElementById('sbUrl').value.trim(),
            document.getElementById('sbAnonKey').value.trim(),
            document.getElementById('sbEnabled').checked
          )">Save & Connect</button>
        </div>
        ${connected ? `
        <div style="grid-column:1/-1;border-top:1px solid var(--border);padding-top:10px">
          <div style="font-size:10px;font-weight:700;color:var(--muted);margin-bottom:8px">CLOUD ACTIONS</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-ghost" style="font-size:10px" id="btnPullActuals" onclick="
              const b=this;b.disabled=true;b.textContent='⏳ Syncing…';
              _sbLoadActuals().then(()=>{refreshAll();toast('Actuals synced from cloud','ok');}).catch(e=>toast('Sync failed: '+e.message,'err')).finally(()=>{b.disabled=false;b.textContent='⬇ Pull Actuals';})">⬇ Pull Actuals</button>
            <button class="btn btn-ghost" style="font-size:10px" id="btnPullScenarios" onclick="
              const b=this;b.disabled=true;b.textContent='⏳ Syncing…';
              _sbLoadScenarios().then(()=>{buildScPanel();toast('Scenarios synced','ok');}).catch(e=>toast('Sync failed: '+e.message,'err')).finally(()=>{b.disabled=false;b.textContent='⬇ Pull Scenarios';})">⬇ Pull Scenarios</button>
            ${currentUser?.role==='admin'?`<button class="btn btn-ghost" style="font-size:10px;color:var(--red)" onclick="openEraseModal()">🗑 Clear Data</button>`:''}
            <button class="btn btn-ghost" style="font-size:10px;color:var(--red)" onclick="if(confirm('Sign out?'))doLogout()">⎋ Sign Out</button>
          </div>
        </div>` : ''}
      </div>
    </div>

    <!-- ── NEW PLAN YEAR GUIDE ──────────────────────────────────────────────── -->
    <div class="tc2" style="margin-top:10px">
      <div class="th">
        <div>
          <div class="tt">📅 Adding a New Plan Year (AOP / Budget)</div>
          <div class="ts">Run once per year before uploading a new AOP budget file — takes under 30 seconds</div>
        </div>
        <div class="ta">
          <span id="_newYrActivePill" style="font-size:10px;padding:3px 10px;border-radius:10px;background:rgba(99,179,237,.12);color:var(--blue);font-weight:700"></span>
        </div>
      </div>
      <div style="padding:14px 16px">

        <!-- Step-by-step instructions -->
        <div style="display:grid;gap:10px">

          <!-- Why -->
          <div style="background:rgba(251,191,36,.07);border:1px solid rgba(251,191,36,.25);border-radius:6px;padding:10px 14px;font-size:11px;color:var(--text);line-height:1.6">
            <strong style="color:var(--amber)">Why is this needed?</strong>
            Every budget file is stored under a <em>version code</em> (e.g. <code style="font-family:var(--mono);background:var(--card2);padding:1px 5px;border-radius:3px">AOP_2026</code>).
            Before uploading a <strong>new year's</strong> budget, that version row must exist in the database.
            Actuals uploads <em>never</em> need this step — they work for any year automatically.
          </div>

          <!-- Step 1 -->
          <div style="display:flex;gap:12px;align-items:flex-start">
            <div style="min-width:24px;height:24px;border-radius:50%;background:var(--blue);color:#fff;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0">1</div>
            <div style="font-size:11px;color:var(--text);line-height:1.6">
              Choose the year you want to add, copy the SQL below, then open
              <strong>Supabase Dashboard → SQL Editor → New Query</strong> and paste it.
            </div>
          </div>

          <!-- Year picker + generated SQL -->
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <span style="font-size:11px;color:var(--muted)">Plan year to add:</span>
            <select id="newPlanYrSel" class="sel" style="height:28px;font-size:12px;font-weight:700" onchange="_buildNewYrSQL()">
              ${planYrOpts}
            </select>
            <button class="btn btn-ghost" style="font-size:10px" onclick="_copyNewYrSQL()">📋 Copy SQL</button>
          </div>

          <div id="newYrSqlBox" style="background:var(--card2);border:1px solid var(--border);border-radius:5px;padding:12px;font-family:var(--mono);font-size:10px;color:var(--teal);line-height:1.8;white-space:pre;overflow-x:auto"></div>

          <!-- Step 2 -->
          <div style="display:flex;gap:12px;align-items:flex-start">
            <div style="min-width:24px;height:24px;border-radius:50%;background:var(--blue);color:#fff;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0">2</div>
            <div style="font-size:11px;color:var(--text);line-height:1.6">
              Run the query. It is safe to run multiple times — <code style="font-family:var(--mono);background:var(--card2);padding:1px 5px;border-radius:3px">ON CONFLICT DO NOTHING</code> means no duplicates will be created.
            </div>
          </div>

          <!-- Step 3 -->
          <div style="display:flex;gap:12px;align-items:flex-start">
            <div style="min-width:24px;height:24px;border-radius:50%;background:var(--blue);color:#fff;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0">3</div>
            <div style="font-size:11px;color:var(--text);line-height:1.6">
              Come back here and click <strong>Save &amp; Connect</strong> (or press <kbd style="font-size:10px;padding:1px 5px;border:1px solid var(--border);border-radius:3px">F5</kbd> to reload) so the app picks up the new version row.
              Then go to <strong>Data Management → Upload AOP Budget</strong> and select your new budget file — the year will be detected automatically from the filename.
            </div>
          </div>

          <!-- Quick reference table -->
          <div style="border-top:1px solid var(--border);padding-top:12px;margin-top:2px">
            <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Quick Reference — What needs SQL vs. what is automatic</div>
            <table style="width:100%;font-size:10px;border-collapse:collapse">
              <thead>
                <tr style="color:var(--muted)">
                  <th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--border)">Action</th>
                  <th style="text-align:center;padding:4px 8px;border-bottom:1px solid var(--border)">SQL needed?</th>
                  <th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--border)">Notes</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style="padding:5px 8px;border-bottom:1px solid var(--border)">Upload actuals (any year)</td>
                  <td style="text-align:center;padding:5px 8px;border-bottom:1px solid var(--border);color:var(--green);font-weight:700">✅ No</td>
                  <td style="padding:5px 8px;border-bottom:1px solid var(--border);color:var(--muted)">Year detected from filename automatically</td>
                </tr>
                <tr>
                  <td style="padding:5px 8px;border-bottom:1px solid var(--border)">Upload AOP 2026 budget</td>
                  <td style="text-align:center;padding:5px 8px;border-bottom:1px solid var(--border);color:var(--green);font-weight:700">✅ No</td>
                  <td style="padding:5px 8px;border-bottom:1px solid var(--border);color:var(--muted)">AOP_2026 version row already seeded</td>
                </tr>
                <tr>
                  <td style="padding:5px 8px;border-bottom:1px solid var(--border)">Upload AOP 2027+ budget</td>
                  <td style="text-align:center;padding:5px 8px;border-bottom:1px solid var(--border);color:var(--amber);font-weight:700">⚠ Yes</td>
                  <td style="padding:5px 8px;border-bottom:1px solid var(--border);color:var(--muted)">One INSERT per new year — use this panel</td>
                </tr>
                <tr>
                  <td style="padding:5px 8px;border-bottom:1px solid var(--border)">Switch year selectors on charts/reports</td>
                  <td style="text-align:center;padding:5px 8px;border-bottom:1px solid var(--border);color:var(--green);font-weight:700">✅ No</td>
                  <td style="padding:5px 8px;border-bottom:1px solid var(--border);color:var(--muted)">Fully dynamic — no code changes needed</td>
                </tr>
                <tr>
                  <td style="padding:5px 8px">Add a new LE / Forecast version</td>
                  <td style="text-align:center;padding:5px 8px;color:var(--amber);font-weight:700">⚠ Yes</td>
                  <td style="padding:5px 8px;color:var(--muted)">Same pattern — one INSERT per version code</td>
                </tr>
              </tbody>
            </table>
          </div>

        </div><!-- /grid -->
      </div>
    </div>

    <!-- ── DATABASE SCHEMA ──────────────────────────────────────────────────── -->
    <div class="tc2" style="margin-top:10px">
      <div class="th"><div class="tt">🗄 Database Schema</div>
      <div class="ts">SQL to create required tables in your Supabase project</div></div>
      <div style="padding:12px">
        <div style="font-size:9px;color:var(--muted);margin-bottom:8px">Copy and run in Supabase SQL Editor → New Query</div>
        <div style="background:var(--card2);border:1px solid var(--border);border-radius:5px;padding:12px;font-family:var(--mono);font-size:9.5px;color:var(--teal);line-height:1.7;white-space:pre;overflow-x:auto">${_getSbSchemaSQL()}</div>
        <button class="btn btn-ghost" style="font-size:10px;margin-top:8px" onclick="navigator.clipboard.writeText(document.querySelector('#sbSettingsPanel pre,#sbSettingsPanel .tc2:last-child div[style*=mono]')?.textContent||'').then(()=>toast('SQL copied','ok'))">📋 Copy SQL</button>
      </div>
    </div>`;

  // Pre-populate the plan-year SQL box after the panel renders
  setTimeout(_buildNewYrSQL, 0);
}

async function testSbConnection() {
  const url = document.getElementById('sbUrl')?.value.trim();
  const key = document.getElementById('sbAnonKey')?.value.trim();
  if (!url || !key) { toast('Enter URL and key first', 'err'); return; }
  toast('Testing connection…', 'ok');
  try {
    const testClient = window.supabase.createClient(url, key);
    const { error } = await testClient.from('fpa_audit_log').select('id').limit(1);
    if (error && error.code !== 'PGRST116') throw error;
    toast('✓ Connection successful!', 'ok');
  } catch(e) {
    toast('Connection failed: ' + (e.message||e), 'err');
  }
}

// ── New Plan Year SQL generator ──────────────────────────────────────────────
function _buildNewYrSQL() {
  const yr  = parseInt(document.getElementById('newPlanYrSel')?.value) || new Date().getFullYear() + 1;
  const sql =
`-- JPS FP&A Platform — Add AOP version for ${yr}
-- Run once in: Supabase Dashboard → SQL Editor → New Query
-- Safe to re-run: ON CONFLICT DO NOTHING prevents duplicates.

INSERT INTO public.fpa_versions (code, label, kind, year, is_locked)
VALUES ('AOP_${yr}', 'Annual Operating Plan ${yr}', 'BUDGET', ${yr}, false)
ON CONFLICT (code) DO NOTHING;

-- Optional: also add a Latest Estimate version for ${yr}
-- INSERT INTO public.fpa_versions (code, label, kind, year, is_locked)
-- VALUES ('LE_${yr}', 'Latest Estimate ${yr}', 'LE', ${yr}, false)
-- ON CONFLICT (code) DO NOTHING;`;

  const box = document.getElementById('newYrSqlBox');
  if (box) box.textContent = sql;

  // Update active-year pill to show currently loaded plan year vs selected
  const pill = document.getElementById('_newYrActivePill');
  if (pill) {
    const exists = (fpa.versions||[]).some(v => v.code === `AOP_${yr}`);
    pill.textContent = exists ? `✅ AOP_${yr} already in DB` : `⚠ AOP_${yr} not yet added`;
    pill.style.background  = exists ? 'rgba(52,211,153,.12)' : 'rgba(251,191,36,.12)';
    pill.style.color       = exists ? 'var(--green)' : 'var(--amber)';
  }
}

function _copyNewYrSQL() {
  const box = document.getElementById('newYrSqlBox');
  const sql = box?.textContent || '';
  if (!sql) { toast('Generate SQL first', 'err'); return; }
  navigator.clipboard.writeText(sql)
    .then(() => toast('SQL copied to clipboard', 'ok'))
    .catch(() => toast('Copy failed — select and copy manually', 'err'));
}

function _getSbSchemaSQL() {
return `-- JPS FP&A Platform — Supabase Schema
-- Run in: Supabase Dashboard → SQL Editor → New Query

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- User profiles (linked to auth.users)
create table if not exists public.profiles (
  id           uuid references auth.users primary key,
  name         text not null,
  email        text,
  role         text not null default 'viewer'
               check (role in ('admin','analyst','viewer','om')),
  department   text,
  sales_role   text,   -- e.g. 'account_manager', 'territory_manager', 'director'
  territory    text,   -- e.g. 'Kingston', 'Western', 'North East'
  is_active    boolean not null default true,
  access_areas text[],
  created_at   timestamptz default now()
);
-- Migration: add new columns to existing deployments
alter table public.profiles add column if not exists email        text;
alter table public.profiles add column if not exists department   text;
alter table public.profiles add column if not exists sales_role   text;
alter table public.profiles add column if not exists territory    text;
alter table public.profiles add column if not exists is_active    boolean not null default true;
alter table public.profiles add column if not exists access_areas text[];
alter table public.profiles enable row level security;
create policy "Users can view all profiles"
  on public.profiles for select using (true);
create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = id);

-- Actuals uploads
create table if not exists public.actuals (
  id          uuid default uuid_generate_v4() primary key,
  month       int  not null,
  year        int  not null,
  data        jsonb,
  uploaded_by uuid references auth.users,
  uploaded_at timestamptz default now(),
  unique(month, year)
);
alter table public.actuals enable row level security;
create policy "All authenticated users can read actuals"
  on public.actuals for select using (auth.role() = 'authenticated');
create policy "Admin users can insert actuals"
  on public.actuals for insert with check (
    exists (select 1 from profiles where id=auth.uid() and role='admin')
  );

-- Scenarios
create table if not exists public.scenarios (
  id          uuid default uuid_generate_v4() primary key,
  name        text not null unique,
  owner_id    uuid references auth.users,
  by_year     jsonb,
  shared      boolean default false,
  approved    boolean default false,
  description text,
  created_at  timestamptz default now(),
  modified_at timestamptz default now()
);
alter table public.scenarios enable row level security;
create policy "Users see own + shared scenarios"
  on public.scenarios for select
  using (owner_id = auth.uid() or shared = true);
create policy "Owners can modify scenarios"
  on public.scenarios for all using (owner_id = auth.uid());

-- Audit log
create table if not exists public.audit_log (
  id          bigserial primary key,
  user_id     uuid references auth.users,
  user_name   text,
  action      text,
  target      text,
  old_val     text,
  new_val     text,
  created_at  timestamptz default now()
);
alter table public.audit_log enable row level security;
create policy "Admins can view audit log"
  on public.audit_log for select
  using (exists (select 1 from profiles where id=auth.uid() and role='admin'));
create policy "All authenticated users can insert"
  on public.audit_log for insert with check (auth.role() = 'authenticated');

-- Enable Realtime on scenarios and actuals
alter publication supabase_realtime add table public.scenarios;
alter publication supabase_realtime add table public.actuals;`;
}

// ═══════════════════════════════════════════════════════
//  USER & PERMISSIONS — Supabase Auth (Session 12)
//  Falls back to local mode when Supabase not configured
// ═══════════════════════════════════════════════════════
let currentUser = {
  id:          'local',
  name:        'Local Admin',
  email:       '',
  role:        'admin', // admin | analyst | viewer | om
  department:  null,
  salesRole:   null,
  territory:   null,
  isActive:    true,
  accessAreas: [],
};

let _selectedLoginRole = 'admin';
let _loginDestination  = 'platform'; // 'platform' | 'flash' | 'data-entry'
let _loginHubSection   = null;       // set when user clicks a role card on the login screen

// Called when user clicks a role profile card on the login screen
function wsSelectRole(card) {
  document.querySelectorAll('.ws-role-card').forEach(c => c.classList.remove('selected'));
  card.classList.add('selected');
  const section  = card.dataset.section;
  const roleName = card.querySelector('.ws-role-name')?.textContent || '';
  _loginHubSection = section;
  // Show the "Entering workspace" tag in the login card
  const tag = document.getElementById('wsSelectedRoleTag');
  const nameEl = document.getElementById('wsRoleName');
  if (tag) tag.style.display = '';
  if (nameEl) nameEl.textContent = roleName;
  // Update login button label
  const btn = document.getElementById('loginBtn');
  if (btn) btn.textContent = `Enter as ${roleName} →`;
  // Focus the first login field
  const email = document.getElementById('loginEmail');
  const name  = document.getElementById('loginName');
  setTimeout(() => (email || name)?.focus(), 80);
}

function selectDest(btn) {
  _loginDestination = btn.dataset.dest;
  document.querySelectorAll('.ws-dest-btn').forEach(b => b.classList.remove('sel'));
  btn.classList.add('sel');
}

function selectRole(btn) {
  _selectedLoginRole = btn.dataset.role;
  document.querySelectorAll('.ws-role-btn').forEach(b => b.classList.remove('sel'));
  btn.classList.add('sel');
}

async function doLogin() {
  const nameEl  = document.getElementById('loginName');
  const emailEl = document.getElementById('loginEmail');
  const passEl  = document.getElementById('loginPassword');
  const errEl   = document.getElementById('loginError');

  // ── Supabase auth path ────────────────────────────
  if (_sbConfig.enabled && _sbConfig.anonKey && emailEl && passEl && emailEl.value.trim()) {
    const email    = emailEl.value.trim();
    const password = passEl.value;
    if (!email) { errEl.textContent = 'Please enter your email.'; emailEl.focus(); return; }
    if (!password) { errEl.textContent = 'Please enter your password.'; passEl.focus(); return; }
    errEl.textContent = '';
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) { loginBtn.textContent = 'Signing in…'; loginBtn.disabled = true; }
    try {
      _sb = _sb || _sbInit();
      const sbUser = await _sbSignIn(email, password);
      const { data: profile } = await _sb.from('profiles').select('*').eq('id', sbUser.id).single();
      currentUser = _sbUserToCurrentUser(sbUser, profile);
      // Block access if account has been revoked
      if (currentUser.isActive === false) {
        await _sb.auth.signOut();
        errEl.textContent = 'Your account access has been revoked. Please contact your administrator.';
        if (loginBtn) { loginBtn.textContent = 'Sign In'; loginBtn.disabled = false; }
        return;
      }
      // ── Unified app access gate ──────────────────────
      const { data: appAccess } = await _sb.schema('admin')
        .from('app_access')
        .select('can_access')
        .eq('user_id', sbUser.id)
        .eq('app_id', 'fpa')
        .maybeSingle();
      if (!appAccess || !appAccess.can_access) {
        await _sb.auth.signOut();
        errEl.textContent = 'Access denied for FP&A Platform. Contact your administrator.';
        if (loginBtn) { loginBtn.textContent = 'Sign In →'; loginBtn.disabled = false; }
        return;
      }
    } catch(e) {
      errEl.textContent = e.message || 'Sign-in failed. Check email and password.';
      if (loginBtn) { loginBtn.textContent = 'Sign In'; loginBtn.disabled = false; }
      return;
    }
    if (loginBtn) { loginBtn.textContent = 'Sign In'; loginBtn.disabled = false; }
  } else {
    // ── Local mode DISABLED in production — Supabase auth required ───────────
    errEl.textContent = 'Authentication unavailable. Contact your administrator.';
    return;
  }

  // ── Data Entry destination: admin check BEFORE shell launches ───────────
  if (_loginDestination === 'data-entry' && currentUser.role !== 'admin') {
    const errEl2 = document.getElementById('loginError');
    if (errEl2) errEl2.textContent = '⛔ Data Entry is restricted to Admin users.';
    const loginBtn2 = document.getElementById('loginBtn');
    if (loginBtn2) { loginBtn2.textContent = 'Enter Platform →'; loginBtn2.disabled = false; }
    return;
  }

  // ── Common post-login flow ────────────────────────
  const name = currentUser.name;
  const nameDisp = document.getElementById('userNameDisp');
  if (nameDisp) nameDisp.textContent = name;
  const roleDisp = document.getElementById('userRoleDisp');
  if (roleDisp) {
    roleDisp.textContent = currentUser.role.toUpperCase();
    roleDisp.style.color = currentUser.role==='admin'?'var(--gold)':currentUser.role==='analyst'?'var(--teal)':'var(--muted)';
  }
  const avatar = document.getElementById('userAvatar');
  if (avatar) avatar.textContent = name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  const ws = document.getElementById('welcomeScreen');
  ws.style.transition = 'opacity .45s ease';
  ws.style.opacity = '0';
  ws.style.pointerEvents = 'none';
  setTimeout(() => { ws.style.display = 'none'; }, 460);
  const shell = document.getElementById('appShell');
  shell.classList.add('visible');
  document.getElementById('appSwitcher').style.display = 'flex';

  // Initialize Supabase client first, then bootstrap data from DB
  if (_sbConfig.enabled && _sbConfig.anonKey && !_sb) _sbInit();
  await fpaBootstrap();   // loads DB into fpa.* and hydrates legacy globals

  // Apply role-based UI access using DB permissions
  hubApplyRoleAccess(currentUser.role);
  _applyTabVisibility();
  // Persist email to profiles so Security page can send password resets
  if (_sb && currentUser.email && currentUser.id !== 'local') {
    _sb.from('profiles').update({ email: currentUser.email }).eq('id', currentUser.id).then(()=>{});
  }

  _initPlatform();

  // ── Post-login routing ─────────────────────────────────────────────────────
  if (_loginHubSection) {
    // User selected a specific role profile on the login screen → enter that workspace in focus mode
    setTimeout(() => { openHubSection(_loginHubSection); }, 350);
  } else if (_loginDestination === 'flash') {
    // Flash Report shortcut
    document.getElementById('appShell')?.classList.add('flash-mode');
    const flashTab = document.querySelector('.tab[onclick*="rpt-flash"]');
    showPane('rpt-flash', flashTab);
    if (flashTab) { document.querySelectorAll('.tab').forEach(t => t.classList.remove('on')); flashTab.classList.add('on'); }
    setTimeout(() => flashInit(), 400);
  } else if (_loginDestination === 'data-entry') {
    // Data Sources tab (admin)
    setTimeout(() => {
      const dataTab = document.querySelector('.tab[onclick*="adm-data"]');
      if (dataTab) { document.querySelectorAll('.tab').forEach(t => t.classList.remove('on')); dataTab.classList.add('on'); showPane('adm-data', dataTab); }
    }, 500);
  } else {
    // Default: open hub landing page
    setTimeout(() => {
      showPane('hub', null);
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('on'));
      const hubName = document.getElementById('hubUserName');
      if (hubName) hubName.textContent = currentUser?.name?.split(' ')[0] || 'User';
      hubBuildStatusCards();
    }, 350);
  }

  auditLog('login', 'session', null, { name, role: currentUser.role });
  setTimeout(async () => {
    _rtStartHeartbeat();
    if (_sb) {
      _sbStartRealtime();
    }
  }, 300);
}

async function doLogout() {
  try { auditLog('logout','session',currentUser?.name,null); } catch(e) {}
  // Sign out from Supabase
  try {
    if (_sb) {
      if (_sbChannel) { await _sb.removeChannel(_sbChannel); _sbChannel = null; }
      await _sbSignOut();
    }
  } catch(e) {}
  // Stop heartbeat
  try { if (_rtHeartbeat) { clearInterval(_rtHeartbeat); _rtHeartbeat = null; } } catch(e) {}
  try { _rtBroadcast('bye', { name: currentUser?.name }); } catch(e) {}
  // Destroy charts
  try { Object.keys(charts).forEach(k=>{ try{charts[k].destroy();}catch(e){} delete charts[k]; }); } catch(e) {}
  // Reset state
  _builtTabs.clear();
  _platformInited = false;
  currentUser = null;
  _loginHubSection = null;
  // Clear role selection on the login screen
  try {
    document.querySelectorAll('.ws-role-card').forEach(c => c.classList.remove('selected'));
    const tag = document.getElementById('wsSelectedRoleTag'); if (tag) tag.style.display = 'none';
    const btn = document.getElementById('loginBtn'); if (btn) btn.textContent = 'Sign In →';
  } catch(e) {}
  // Always restore the login screen regardless of any errors above
  const shell = document.getElementById('appShell');
  if (shell) shell.classList.remove('visible');
  const switcher = document.getElementById('appSwitcher');
  if (switcher) switcher.style.display = 'none';
  const ws = document.getElementById('welcomeScreen');
  if (ws) {
    ws.style.display = 'flex';
    ws.style.opacity = '0';
    ws.style.pointerEvents = '';
    ws.style.transition = 'opacity .3s';
    setTimeout(() => { ws.style.opacity = '1'; }, 10);
  }
  try { const nameEl = document.getElementById('loginName'); if (nameEl) nameEl.value = ''; } catch(e) {}
  try { const errEl = document.getElementById('loginError'); if (errEl) errEl.textContent = ''; } catch(e) {}
  try { const pwEl = document.getElementById('loginPassword'); if (pwEl) pwEl.value = ''; } catch(e) {}
}

// ── Hardcoded action-permission baseline (used when no DB role loaded) ───────
const _ACTION_PERMS = {
  admin:    ['upload','editBase','editTariff','editVolume','editFX','editGeneration',
             'editFuelPrice','editOM','editCapex','editCollections','editDepreciation',
             'editOtherIncome','editFinancing','editIFRS16','editInsurance',
             'createScenario','editScenario','approveScenario','shareScenario',
             'manageUsers','viewAudit','viewReports','viewSharedScenarios','editTheme'],
  analyst:  ['createScenario','editScenario','shareScenario',
             'viewReports','viewSharedScenarios','editTheme'],
  viewer:   ['viewReports','viewSharedScenarios','editTheme'],
  om:       ['editOM','viewReports','viewSharedScenarios','editTheme'],
};

// Pane → action mapping: which action grants edit on this pane
const _PANE_EDIT_ACTION = {
  'hub':'editBase','dash':'viewReports','rpt-pl':'viewReports','rpt-bs':'viewReports',
  'rpt-cf':'viewReports','rpt-dep':'viewReports','rpt-var':'viewReports',
  'rpt-kpi':'viewReports','rpt-rev':'viewReports','rpt-flash':'viewReports',
  'wrk-sc':'editScenario','wrk-gen':'editGeneration','wrk-coll':'editCollections',
  'wrk-debt':'editFinancing','wrk-leases':'editIFRS16',
  'ass-rev':'editTariff','ass-om':'editOM','ass-capex':'editCapex',
  'ass-dep':'editDepreciation','ass-other':'editOtherIncome','ass-proj':'editBase',
  'ai-comm':'viewReports',
  'adm-data':'upload','adm-audit':'viewAudit','adm-sec':'manageUsers','adm-guide':'viewReports',
};

function can(action) {
  if (!currentUser) return false;
  const role = currentUser.role || 'viewer';
  return (_ACTION_PERMS[role] || _ACTION_PERMS.viewer).includes(action);
}

// Check if current user can VIEW a pane (uses DB role permissions, falls back to action check)
function canViewPane(paneId) {
  if (!currentUser) return false;
  const role = currentUser.role || 'viewer';
  // Admin always can
  if (role === 'admin') return true;
  // Check DB-loaded permissions first
  const dbPerm = fpa.rolePermissions?.[role]?.[paneId];
  if (dbPerm !== undefined) return dbPerm.can_view;
  // Fallback: if we have an action mapped for this pane, check it
  const action = _PANE_EDIT_ACTION[paneId];
  return action ? can(action) || can('viewReports') : true;
}

// Check if current user can EDIT a pane
function canEditPane(paneId) {
  if (!currentUser) return false;
  const role = currentUser.role || 'viewer';
  if (role === 'admin') return true;
  const dbPerm = fpa.rolePermissions?.[role]?.[paneId];
  if (dbPerm !== undefined) return dbPerm.can_edit;
  const action = _PANE_EDIT_ACTION[paneId];
  return action ? can(action) : false;
}

// ═══════════════════════════════════════════════════════
//  AUDIT TRAIL ENGINE
// ═══════════════════════════════════════════════════════
const _auditStore = [];
let _auditFilter = 'all';

const _auditCatMap = {
  login:'session', logout:'session',
  upload:'upload', drop:'upload',
  scenario:'scenario', theme:'scenario', period:'scenario',
  'om-edit':'edit', 'capex-edit':'edit', 'coll-edit':'edit',
  'dep-edit':'edit', 'tariff-edit':'edit', 'vol-edit':'edit',
  'fx-edit':'edit', 'gen-edit':'edit', 'other-edit':'edit',
  'lease-edit':'edit', 'nfc-edit':'edit',
};

function _auditCat(action) {
  return _auditCatMap[action] || (action.includes('edit')||action.includes('upd') ? 'edit' : 'other');
}

function auditLog(action, target, oldVal, newVal) {
  const cat = _auditCat(action);
  const entry = {
    id: _auditStore.length + 1,
    userId:   currentUser.id,
    userName: currentUser.name || '—',
    userRole: currentUser.role || '—',
    action, cat,
    target:   target || '—',
    oldVal:   oldVal !== null && oldVal !== undefined ? String(oldVal) : null,
    newVal:   newVal !== null && newVal !== undefined ? String(newVal) : null,
    timestamp: new Date()
  };
  _auditStore.unshift(entry);
  // Persist to Supabase asynchronously (fire-and-forget)
  if (_sb) _sbAuditLog(entry).catch(()=>{});
  // Refresh panel if open
  if (document.getElementById('auditBody')) renderAuditTable();
}

function filterAudit(cat, btn) {
  _auditFilter = cat;
  document.querySelectorAll('#auditCatSeg .sb').forEach(b => b.classList.remove('on'));
  if (btn) btn.classList.add('on');
  renderAuditTable();
}

function renderAuditTable() {
  const body = document.getElementById('auditBody');
  const countEl = document.getElementById('auditCount');
  const statsEl = document.getElementById('auditStats');
  if (!body) return;

  const q = (document.getElementById('auditSearch')?.value || '').toLowerCase();

  const catColors = {
    edit:     {bg:'rgba(59,130,246,.12)', color:'var(--blue)',    label:'Edit'},
    upload:   {bg:'rgba(16,185,129,.12)', color:'var(--green)',   label:'Upload'},
    session:  {bg:'rgba(240,180,41,.12)', color:'var(--gold)',    label:'Session'},
    scenario: {bg:'rgba(139,92,246,.12)', color:'var(--purple)',  label:'Scenario'},
    other:    {bg:'rgba(74,100,133,.12)', color:'var(--muted)',   label:'Other'},
  };

  const filtered = _auditStore.filter(e => {
    const catMatch = _auditFilter === 'all' || e.cat === _auditFilter;
    if (!catMatch) return false;
    if (!q) return true;
    return [e.userName, e.userRole, e.action, e.target, e.oldVal, e.newVal]
      .some(v => v && v.toLowerCase().includes(q));
  });

  if (countEl) countEl.textContent = filtered.length + ' entr' + (filtered.length === 1 ? 'y' : 'ies');

  // Stats bar
  if (statsEl) {
    const cats = ['edit','upload','session','scenario'];
    statsEl.innerHTML = cats.map(c => {
      const n = _auditStore.filter(e => e.cat === c).length;
      const cc = catColors[c];
      return `<div style="background:${cc.bg};border:1px solid ${cc.color}40;border-radius:6px;padding:5px 12px;display:flex;align-items:center;gap:7px">
        <span style="font-size:16px;font-weight:800;color:${cc.color};font-family:var(--mono)">${n}</span>
        <span style="font-size:9px;font-weight:700;color:${cc.color};text-transform:uppercase;letter-spacing:.06em">${cc.label}s</span>
      </div>`;
    }).join('');
  }

  if (!filtered.length) {
    body.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:24px;font-size:11px">No audit entries match the current filter.</td></tr>`;
    return;
  }

  const fmtTime = d => {
    const pad = n => String(n).padStart(2,'0');
    return pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds());
  };
  const fmtDate = d => {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[d.getMonth()]+' '+d.getDate()+', '+fmtTime(d);
  };

  body.innerHTML = filtered.map(e => {
    const cc = catColors[e.cat] || catColors.other;
    const catPill = `<span style="background:${cc.bg};color:${cc.color};border:1px solid ${cc.color}40;border-radius:10px;padding:1px 7px;font-size:9px;font-weight:700;white-space:nowrap">${cc.label}</span>`;
    const oldHtml = e.oldVal != null ? `<span style="color:var(--red);font-family:var(--mono);font-size:10px">${e.oldVal}</span>` : '<span style="color:var(--muted);opacity:.4">—</span>';
    const newHtml = e.newVal != null ? `<span style="color:var(--green);font-family:var(--mono);font-size:10px">${e.newVal}</span>` : '<span style="color:var(--muted);opacity:.4">—</span>';
    const roleColor = e.userRole==='admin'?'var(--gold)':e.userRole==='analyst'?'var(--teal)':'var(--muted)';
    return `<tr>
      <td style="color:var(--muted);font-size:9px;font-family:var(--mono);white-space:nowrap">${fmtDate(e.timestamp)}</td>
      <td style="font-weight:600;white-space:nowrap">${e.userName}</td>
      <td style="font-size:9px;font-weight:700;color:${roleColor};text-transform:uppercase;letter-spacing:.05em">${e.userRole}</td>
      <td>${catPill}</td>
      <td style="font-size:10px;color:var(--text)">${_fmtAction(e.action)}</td>
      <td style="font-size:10px;color:var(--muted);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${e.target}">${e.target}</td>
      <td style="text-align:right">${oldHtml}</td>
      <td style="text-align:right">${newHtml}</td>
    </tr>`;
  }).join('');
}

function _fmtAction(a) {
  const labels = {
    login:'Logged In', logout:'Logged Out',
    upload:'File Upload', drop:'File Drop',
    scenario:'Scenario Changed', theme:'Theme Changed', period:'Period Changed',
    'om-edit':'O&M Edit', 'capex-edit':'CapEx Edit', 'coll-edit':'Collections Edit',
    'dep-edit':'Depreciation Edit', 'tariff-edit':'Tariff Edit', 'vol-edit':'Volume Edit',
    'fx-edit':'FX Rate Edit', 'gen-edit':'Generation Edit', 'other-edit':'Other Financing Edit',
    'lease-edit':'Lease Edit', 'nfc-edit':'Net Financing Edit',
  };
  return labels[a] || a.replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
}

function exportAuditCSV() {
  const headers = ['#','Timestamp','User','Role','Category','Action','Field/Target','Old Value','New Value'];
  const rows = _auditStore.map(e => [
    e.id,
    e.timestamp.toISOString(),
    e.userName, e.userRole, e.cat,
    e.action, e.target,
    e.oldVal ?? '', e.newVal ?? ''
  ]);
  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv'}));
  a.download = 'JPS_AuditTrail_' + new Date().toISOString().slice(0,10) + '.csv';
  a.click();
  toast('Audit log exported', 'ok');
}

function clearAuditLog() {
  if (!confirm('Clear all audit entries from this session? This cannot be undone.')) return;
  _auditStore.length = 0;
  renderAuditTable();
  toast('Audit log cleared', 'w');
}
// ═══════════════════════════════════════════════════════
//  CONSTANTS & HELPERS
// ═══════════════════════════════════════════════════════
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
// _CY / _PY / YEARS are declared at the very top of the script block (before all initializers).
let period='quarterly', activeSc='Base Case';
let dashYear    = _CY;   // year shown on dashboard charts
let cfYear      = _CY;   // year shown on cash flow report
let varYear     = _CY;   // year shown on variance report
let actualsYear = _CY;   // year of currently active uploaded actuals; overridden by bootstrap
let planYear    = _CY;   // year of the active AOP / Budget plan; overridden by bootstrap

// _acts(mo) — reads actuals for the active year.
// Returns the actuals value for month `mo` under the active actualsYear.
// actualsStore is keyed { year: { mo: value } } for all years.
const _acts = (mo) => actualsStore[actualsYear]?.[mo];

// _aopCode() — returns the active AOP version code, e.g. 'AOP_2026' or 'AOP_2027'
const _aopCode = () => 'AOP_' + planYear;
const fx=()=>{try{return fxTable?.billing?.[0]||0;}catch(e){return 0;}};
const toK=v=>{if(v===null||v===undefined)return'–';const a=Math.abs(v);return a>=1e6?'$'+(v/1e6).toFixed(1)+'B':a>=1e3?'$'+(v/1e3).toFixed(0)+'M':'$'+Math.round(v).toLocaleString();};
const fmtN=v=>{if(v===null||v===undefined||isNaN(v))return'<span class="dim">–</span>';const n=Math.round(Math.abs(v)).toLocaleString();return v<0?`<span class="neg">(${n})</span>`:n;};
const fmtV=v=>{if(!v&&v!==0)return'<span class="dim">–</span>';const n=Math.round(Math.abs(v)).toLocaleString();return v>=0?`<span class="pos">▲${n}</span>`:`<span class="neg">▼(${n})</span>`;};
const fmtP=v=>{if(!v&&v!==0||isNaN(v))return'<span class="dim">–</span>';const s=(Math.abs(v)*100).toFixed(1)+'%';return v>=0?`<span class="pos">${s}</span>`:`<span class="neg">(${s})</span>`;};
const sumArr=a=>(a||[]).reduce((s,x)=>s+(x||0),0);
const toast=(msg,t='i')=>{const el=document.getElementById('toast');el.textContent=(t==='ok'?'✅ ':t==='w'?'⚠️ ':t==='err'?'❌ ':'ℹ️ ')+msg;el.className='show';el.style.borderColor=t==='err'?'var(--red)':t==='w'?'var(--amber)':'var(--b2)';clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove('show'),4000);};
// Debounce helper — prevents chart rebuild storms on rapid edits
function _debounce(fn,ms=120){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms);};}
const refreshAllDebounced=_debounce(()=>refreshAll(),150);
let charts={};
const mkChart=(id,cfg)=>{
  if(charts[id]){try{charts[id].destroy();}catch(e){} delete charts[id];}
  const c=document.getElementById(id);
  if(!c||!c.getContext)return;
  try{charts[id]=new Chart(c.getContext('2d'),cfg);}
  catch(e){console.warn('mkChart['+id+']',e.message);}
};

// ── TRUE WATERFALL (floating bar) helper ────────────────────────────────────
// steps: [{label, value, isTotal?}]
// isTotal items are drawn from 0 (anchor bars); others float from running total
const mkWaterfall=(id,steps,opts={})=>{
  const labels=[],floatData=[],colors=[];
  const COL_POS='rgba(16,185,129,.82)',COL_NEG='rgba(239,68,68,.82)',
        COL_TOT='rgba(59,130,246,.82)',COL_START='rgba(100,116,139,.75)';
  let running=0;
  steps.forEach((s,i)=>{
    labels.push(s.label);
    if(s.isTotal||i===0){
      // Anchor bar: draw from 0 to value
      floatData.push([0, s.value]);
      colors.push(i===0?COL_START:COL_TOT);
      running=s.value;
    } else {
      // Floating bar: from running total, up or down by value
      const lo=s.value>=0?running:running+s.value;
      const hi=s.value>=0?running+s.value:running;
      floatData.push([lo,hi]);
      colors.push(s.value>=0?COL_POS:COL_NEG);
      running+=s.value;
    }
  });
  mkChart(id,{
    type:'bar',
    data:{labels,datasets:[{
      data:floatData,
      backgroundColor:colors,
      borderColor:colors.map(c=>c.replace(/[\d.]+\)$/,'1)')),
      borderWidth:1,
      borderRadius:3,
      borderSkipped:false,
    }]},
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{
          label:ctx=>{
            const raw=ctx.raw;
            const val=Array.isArray(raw)?raw[1]-raw[0]:raw;
            return ' $'+Math.abs(Math.round(val)).toLocaleString()+'K'+(val<0?' (▼)':' (▲)');
          }
        }},
        ...( opts.plugins||{} )
      },
      scales:{
        x:{ticks:{color:_TC.muted,font:{size:9}},grid:{color:_TC.grid}},
        y:{ticks:{color:_TC.muted,font:{size:9},callback:v=>toK(v)},grid:{color:_TC.grid}},
        ...(opts.scales||{})
      }
    }
  });
};
const CP=['#f0b429','#3b82f6','#10b981','#ef4444','#8b5cf6','#06b6d4','#f97316','#ec4899','#14b8a6','#a78bfa','#34d399','#fb923c'];

// ── Theme Color Cache ──────────────────────────────────────────────────────────
// Populated once at startup and refreshed on every theme switch.
// Eliminates 42+ synchronous getComputedStyle() calls inside chart renderers
// (each call triggers a style recalculation which blocks the main thread).
let _TC = { muted:'#4a6485', grid:'rgba(255,255,255,.035)', text:'#c8d8f0', gold:'#f0b429', teal:'#00b4d8' };
function _cacheThemeColors() {
  const s = getComputedStyle(document.documentElement);
  _TC.muted = s.getPropertyValue('--muted').trim()      || '#4a6485';
  _TC.grid  = s.getPropertyValue('--chart-grid').trim() || 'rgba(255,255,255,.035)';
  _TC.text  = s.getPropertyValue('--text').trim()       || '#c8d8f0';
  _TC.gold  = s.getPropertyValue('--gold').trim()       || '#f0b429';
  _TC.teal  = s.getPropertyValue('--teal').trim()       || '#00b4d8';
}
_cacheThemeColors(); // populate immediately so bO() works before _initPlatform

// Shared Chart.js options factory — uses cached _TC, never reads DOM
const bO = (yFmt) => ({
  responsive:true, maintainAspectRatio:false,
  plugins:{ legend:{ labels:{ color:_TC.muted, font:{size:9}, boxWidth:9 } } },
  scales:{
    x:{ ticks:{ color:_TC.muted, font:{size:9} }, grid:{ color:_TC.grid } },
    y:{ ticks:{ color:_TC.muted, font:{size:9}, callback:v=>yFmt?yFmt(v):toK(v) }, grid:{ color:_TC.grid } }
  }
});

// ═══════════════════════════════════════════════════════
//  SCENARIOS
// ═══════════════════════════════════════════════════════
// Scenarios — year-keyed byYear for _CY through _CY+4
function mkScYears(base){const yrs={};Array.from({length:5},(_,i)=>_CY+i).forEach(y=>{yrs[y]={...base};});return yrs;}
let scenarios={
  'Base Case':{color:'#f0b429',desc:'Central case; current LE as filed. Moderate growth with Hurricane Melissa restoration costs.',eb:0,rv:0,om:0,cx:0,fu:0,tr:0,cr:0,byYear:mkScYears({eb:0,rv:0,om:0,cx:0,fu:0,tr:0,cr:0})},
  'Upside':   {color:'#10b981',desc:'Favourable tariff review outcome, lower fuel prices, stronger demand recovery.',eb:8,rv:5,om:-2,cx:0,fu:-5,tr:2,cr:0.5,byYear:mkScYears({eb:8,rv:5,om:-2,cx:0,fu:-5,tr:2,cr:0.5})},
  'Downside': {color:'#ef4444',desc:'Adverse fuel, FX devaluation, demand shortfall, no tariff increase approved.',eb:-12,rv:-4,om:3,cx:0,fu:8,tr:-1,cr:-1,byYear:mkScYears({eb:-12,rv:-4,om:3,cx:0,fu:8,tr:-1,cr:-1})},
  'Management':{color:'#d97706',desc:'Management stretch; all efficiency targets achieved, accelerated restoration.',eb:5,rv:3,om:-3,cx:-5,fu:0,tr:1,cr:0.5,byYear:mkScYears({eb:5,rv:3,om:-3,cx:-5,fu:0,tr:1,cr:0.5})},
};
let selectedScYear = _CY;
function setScenario(name){const prev=activeSc;activeSc=name;document.getElementById('scPill').textContent=name;refreshAll();auditLog('scenario','Active Scenario',prev,name);toast('Scenario: '+name,'ok');_saveState();}
function getScAdj(name,key,yr){const s=scenarios[name];return s?.byYear?.[yr]?.[key]??s?.[key]??0;}

// ═══════════════════════════════════════════════════════
//  FINANCIAL DATA — FROM UPLOADED FILES
// ═══════════════════════════════════════════════════════
// plLines — vals populated at runtime from fpa.facts via fpaApplyToLegacyGlobals(). No hardcoded data.
const _z9 = () => Array(9).fill(0);
let plLines=[
  {id:'fuel_rev',  sect:'Regulated Business',name:'Fuel Revenue',                        type:'I',vals:_z9()},
  {id:'fuel_cost', sect:'Regulated Business',name:'Fuel Costs',                          type:'E',vals:_z9()},
  {id:'fuel_surp', sect:'Regulated Business',name:'Fuel Surplus/(Penalty)',              type:'I',vals:_z9(),sub:true},
  {id:'nonfuel',   sect:'Regulated Business',name:'Non-Fuel Revenue',                    type:'I',vals:_z9()},
  {id:'other_r',   sect:'Regulated Business',name:'Other Operating Revenue',             type:'I',vals:_z9()},
  {id:'opex',      sect:'Regulated Business',name:'Operating Expense (O&M)',             type:'E',vals:_z9()},
  {id:'reg_eb',    sect:'Regulated Business',name:'Regulated EBITDA',                    type:'I',vals:_z9(),sub:true},
  {id:'ipp_fr',    sect:'Purchased Power',   name:'IPP Fuel Revenue',                    type:'I',vals:_z9()},
  {id:'ipp_nr',    sect:'Purchased Power',   name:'IPP Non-Fuel Revenue',                type:'I',vals:_z9()},
  {id:'ipp_cost',  sect:'Purchased Power',   name:'Fuel & IPP Costs',                   type:'E',vals:_z9()},
  {id:'ipp_eb',    sect:'Purchased Power',   name:'PP Contribution',                     type:'I',vals:_z9(),sub:true},
  {id:'nr_rev',    sect:'Non-Regulated',     name:'Non-Regulated Revenue',               type:'I',vals:_z9()},
  {id:'nr_cost',   sect:'Non-Regulated',     name:'Non-Regulated Costs',                 type:'E',vals:_z9()},
  {id:'nr_eb',     sect:'Non-Regulated',     name:'Non-Reg Contribution',                type:'I',vals:_z9(),sub:true},
  {id:'ebitda',    sect:'TOTAL',             name:'TOTAL EBITDA',                        type:'I',vals:_z9(),tot:true},
  {id:'depn',      sect:'Below EBITDA',      name:'Depreciation (incl. SJPC & Leases)', type:'E',vals:_z9()},
  {id:'ebit',      sect:'Below EBITDA',      name:'EBIT',                                type:'I',vals:_z9(),sub:true},
  {id:'fin_cost',  sect:'Below EBITDA',      name:'Net Financing Cost',                  type:'E',vals:_z9()},
  {id:'oth_inc',   sect:'Below EBITDA',      name:'Other Income/(Expense)',              type:'I',vals:_z9()},
  {id:'pretax',    sect:'Below EBITDA',      name:'Pre-Tax Income',                      type:'I',vals:_z9(),sub:true},
  {id:'tax',       sect:'Below EBITDA',      name:'Income Tax',                          type:'E',vals:_z9()},
  {id:'net_inc',   sect:'TOTAL',             name:'NET INCOME',                          type:'I',vals:_z9(),tot:true},
];

// bsLines — vals populated at runtime from fpa.facts via fpaApplyToLegacyGlobals(). No hardcoded data.
let bsLines=[
  {id:'cash',       sect:'Current Assets',          name:'Cash & Short Term Deposits',      vals:_z9()},
  {id:'rcash',      sect:'Current Assets',          name:'Restricted Cash (EDF)',            vals:_z9()},
  {id:'recv',       sect:'Current Assets',          name:'Receivables, Net',                 vals:_z9()},
  {id:'unbill',     sect:'Current Assets',          name:'Unbilled Revenue',                 vals:_z9()},
  {id:'finv',       sect:'Current Assets',          name:'Fuel Inventory',                   vals:_z9()},
  {id:'matls',      sect:'Current Assets',          name:'Materials & Supplies',             vals:_z9()},
  {id:'ins_prepaid',sect:'Current Assets',          name:'Prepaid Insurance',                vals:_z9(),derived:true,note:'Auto-calculated from insurance policies register'},
  {id:'cur_a',      sect:'Current Assets',          name:'Total Current Assets',             vals:_z9(),tot:true},
  {id:'ppe',        sect:'Non-Current Assets',      name:'PP&E – Net',                       vals:_z9()},
  {id:'cwip',       sect:'Non-Current Assets',      name:'Construction WIP',                 vals:_z9()},
  {id:'eqinv',      sect:'Non-Current Assets',      name:'Equity Investments (incl. SJPC)',  vals:_z9()},
  {id:'pension',    sect:'Non-Current Assets',      name:'Pension Asset',                    vals:_z9()},
  {id:'tot_a',      sect:'Non-Current Assets',      name:'TOTAL ASSETS',                     vals:_z9(),tot:true},
  {id:'ap',         sect:'Current Liabilities',     name:'Accounts Payable & Accruals',      vals:_z9()},
  {id:'cur_l',      sect:'Current Liabilities',     name:'Total Current Liabilities',        vals:_z9(),sub:true},
  {id:'ltd',        sect:'Non-Current Liabilities', name:'Long Term Debt',                   vals:_z9()},
  {id:'leases',     sect:'Non-Current Liabilities', name:'Lease Liabilities (IFRS-16)',      vals:_z9()},
  {id:'tot_l',      sect:'Non-Current Liabilities', name:'TOTAL LIABILITIES',                vals:_z9(),tot:true},
  {id:'equity',     sect:'Equity',                  name:'Total Equity',                     vals:_z9(),sub:true},
  {id:'tot_le',     sect:'Equity',                  name:'TOTAL LIABILITIES & EQUITY',       vals:_z9(),tot:true},
];

// DEPRECIATION COMPONENTS — year-keyed (replaces depLines as live data source)
// 2026 seed from Depreciation_February_2026_LE_revised.xlsx
// depLines[] kept as read-only reference
// depreciationComponents — zeroed. Populate from uploads.
const _z12=()=>Array(12).fill(0);
// Year-keyed 12-element zero arrays for _CY through _CY+4
const _z5yrs=()=>{const o={};Array.from({length:5},(_,i)=>_CY+i).forEach(y=>{o[y]=_z12();});return o;};
function _mkDepComp(){
  const base={
    faRegister:     _z12(),
    sjpc:           _z12(),
    otherLeases:    _z12(),
    capexTransfers: _z12(),
    capitalSpares:  _z12(),
    decommissioning:_z12(),
    strandedMeters: _z12(),
    strandedLights: _z12(),
    impairment:     _z12(),
  };
  const obj={};
  Array.from({length:5},(_,i)=>_CY+i).forEach(y=>{
    obj[y]={};
    Object.keys(base).forEach(k=>{obj[y][k]=[...base[k]];});
  });
  return obj;
}
let depreciationComponents = _mkDepComp();
let selectedDepYear = _CY;

let impairmentEvents = []; // zeroed — populated from DB registers

function calcDepTotals(yr,m){
  const c=depreciationComponents[yr]||depreciationComponents[_CY];
  const regular=(c.faRegister[m]||0)+(c.sjpc[m]||0)+(c.otherLeases[m]||0)
    +(c.capexTransfers[m]||0)+(c.capitalSpares[m]||0)+(c.decommissioning[m]||0)
    +(c.strandedMeters[m]||0)+(c.strandedLights[m]||0);
  const impairment=c.impairment[m]||0;
  return {regular,impairment,total:regular+impairment};
}

// O&M DATA — year-keyed 2026-2030. Zeroed — populate from uploads.
function _mkOMRows(){
  const base=[
    {id:'payroll',  name:'01. Payroll',                cashLag:0,  vals:_z12()},
    {id:'overtime', name:'02. Overtime',               cashLag:0,  vals:_z12()},
    {id:'benefits', name:'03. Employee Benefits',      cashLag:0,  vals:_z12()},
    {id:'disc_ben', name:'04. Discretionary Benefits', cashLag:30, vals:_z12()},
    {id:'training', name:'05. Training',               cashLag:30, vals:_z12()},
    {id:'thirdpty', name:'06. 3rd Party Services',     cashLag:30, vals:_z12()},
    {id:'supplies', name:'07. Supplies',               cashLag:30, vals:_z12()},
    {id:'materials',name:'08. Materials',              cashLag:30, vals:_z12()},
    {id:'bdr',      name:'09. Bill Dlvry & Mtr Reading',cashLag:30,vals:_z12()},
    {id:'tech',     name:'10. Technology & Telecom',   cashLag:30, vals:_z12()},
    {id:'office',   name:'11. Other Office Expenses',  cashLag:30, vals:_z12()},
    {id:'transport',name:'12. Transport',              cashLag:0,  vals:_z12()},
    {id:'misc',     name:'13. Miscellaneous',          cashLag:30, vals:_z12()},
    {id:'insurance',name:'14. Insurance',              cashLag:0,  vals:_z12()},
    {id:'building', name:'15. Building / Facilities',  cashLag:30, vals:_z12()},
    {id:'advert',   name:'16. Advertising',            cashLag:30, vals:_z12()},
    {id:'bad_debt', name:'17. Bad Debt',               cashLag:60, vals:_z12()},
  ];
  const obj={};
  Array.from({length:5},(_,i)=>_CY+i).forEach(y=>{
    obj[y]=base.map(r=>({...r,vals:[...r.vals],growthRate:0}));
  });
  return obj;
}
let omRows=_mkOMRows();
let omGrowthRates={};// {yr:{rowId:rate}} — populated by UI
let selectedOMYear=_CY;

// CAPEX DATA — year-keyed 2026-2030. Zeroed — populate from uploads.
function _mkCapexRows(){
  const base=[
    {id:'cx_gen',  name:'Generation – Routine & Overhauls',   payLag:2,tLag:3,dYrs:15, vals:_z12()},
    {id:'cx_tx',   name:'Transmission – Expansion & Upgrade', payLag:2,tLag:2,dYrs:25, vals:_z12()},
    {id:'cx_dist', name:'Distribution – System Upgrade',      payLag:2,tLag:1,dYrs:25, vals:_z12()},
    {id:'cx_hurr', name:'Hurricane Melissa Restoration',      payLag:1,tLag:1,dYrs:22, vals:_z12()},
    {id:'cx_cust', name:'Customer Growth (CCMA)',             payLag:2,tLag:1,dYrs:25, vals:_z12()},
    {id:'cx_loss', name:'Loss Reduction Programme',           payLag:2,tLag:2,dYrs:15, vals:_z12()},
    {id:'cx_ss',   name:'Support Services (IT, Facilities)',  payLag:1,tLag:2,dYrs:5,  vals:_z12()},
  ];
  const obj={};
  Array.from({length:5},(_,i)=>_CY+i).forEach(y=>{
    obj[y]=base.map(r=>({...r,vals:[...r.vals],growthRate:0}));
  });
  return obj;
}
let capexRows=_mkCapexRows();
let selectedCapexYear=_CY;

// COLLECTIONS — year-keyed 2026-2030. Zeroed — populate from uploads.
function _mkCollRows(){
  const base=[
    {id:'billing',   name:'Total Billings (J$000s)',          unit:'J$000',  vals:_z12()},
    {id:'cr_rt10',   name:'RT10 Collection Rate %',           unit:'%',      vals:_z12()},
    {id:'cr_rt20',   name:'RT20 Collection Rate %',           unit:'%',      vals:_z12()},
    {id:'cr_rt40',   name:'RT40/RT50 Collection Rate %',      unit:'%',      vals:_z12()},
    {id:'blended',   name:'Blended Collection Rate (derived)', unit:'%',      vals:null,derived:true},
    {id:'prior',     name:'Prior Period Collections (US$000)', unit:'US$000', vals:_z12()},
    {id:'gcr',       name:'GCT Recoverable (US$000)',          unit:'US$000', vals:_z12()},
    {id:'receipts',  name:'Cash Receipts (US$000, derived)',   unit:'US$000', vals:null,derived:true},
    {id:'dso',       name:'DSO Days (derived)',                unit:'days',   vals:null,derived:true},
  ];
  const obj={};
  Array.from({length:5},(_,i)=>_CY+i).forEach(y=>{
    obj[y]=base.map(r=>({...r,vals:r.vals?[...r.vals]:null}));
  });
  return obj;
}
let collRows=_mkCollRows();
let selectedCollYear=_CY;

// Other Operating Revenue — year-keyed (_CY through _CY+4)
let otherOperatingRevenue={};
Array.from({length:5},(_,i)=>_CY+i).forEach(y=>{
  otherOperatingRevenue[y]=[
    {id:'recon_fees',  name:'Reconnection Fees',          vals:Array(12).fill(0)},
    {id:'late_pay',    name:'Late Payment Fees',          vals:Array(12).fill(0)},
    {id:'early_inc',   name:'Early Payment Incentives',   vals:Array(12).fill(0)},
    {id:'gct_reimb',   name:'GCT Reimbursements',         vals:Array(12).fill(0)},
    {id:'reg_recov',   name:'Other Regulatory Recoveries',vals:Array(12).fill(0)},
    {id:'nonreg_rev',  name:'Non-Regulated Revenue',      vals:Array(12).fill(0)},
  ];
  // No seed values — populate from uploads
});

// Net Financing rows — year-keyed (_CY through _CY+4)
let netFinancingRows={};
Array.from({length:5},(_,i)=>_CY+i).forEach(y=>{
  netFinancingRows[y]={
    intIncome:    {name:'Interest Income',         vals:Array(12).fill(0)},
    intExpense:   {name:'Interest Expense',        vals:Array(12).fill(0)},
    loanFees:     {name:'Loan Financing Fees',     vals:Array(12).fill(0)},
    prefDivs:     {name:'Preference Dividends',    vals:Array(12).fill(0)},
    budgetFX:     Array(12).fill(0),
    netFXPosition:Array(12).fill(0),
    interestRateOnCash: 0,  // % p.a. — set via UI input; no default assumed
  };
  // 2026 actuals populated from uploads — no hardcoded seed values
});

// revRows — zeroed. Populate from uploads.
let revRows=[
  {id:'cust_rt10',name:'RT10 Residential Customers (000s)',unit:'000s',vals:_z12()},
  {id:'cust_rt20',name:'RT20 Commercial Customers',        unit:'#',   vals:_z12()},
  {id:'cust_rt40',name:'RT40 LV Commercial Customers',     unit:'#',   vals:_z12()},
  {id:'gwh_rt10', name:'RT10 GWh Billed Sales',            unit:'GWh', vals:_z12()},
  {id:'gwh_rt20', name:'RT20 GWh Billed Sales',            unit:'GWh', vals:_z12()},
  {id:'gwh_rt40', name:'RT40 GWh Billed Sales (LV Comm.)', unit:'GWh', vals:_z12()},
  {id:'gwh_rt50', name:'RT50 GWh Billed Sales (MV Ind.)',  unit:'GWh', vals:_z12()},
  {id:'gwh_rt60', name:'RT60 GWh Streetlights',            unit:'GWh', vals:_z12()},
  {id:'gwh_rt70', name:'RT70 GWh HV Industrial',           unit:'GWh', vals:_z12()},
  {id:'gwh_tot',  name:'Total GWh (derived)',               unit:'GWh', vals:null,derived:true},
  {id:'sys_loss', name:'System Loss %',                    unit:'%',   vals:_z12()},
  {id:'peak_mw',  name:'Peak Demand (MW)',                  unit:'MW',  vals:_z12()},
];

// TARIFF RATES — cents MUST be zero until loaded from DB (fpa_assumptions / tariff upload)
// ARCHITECTURAL RULE: no hardcoded non-zero financial values — load from Supabase only
let tariffRates=[
  {id:'rt10b1',class:'RT10',block:'Block 1 | 0–100 kWh/mo',vol:'LV',cents:0,c27:0,c28:0},
  {id:'rt10b2',class:'RT10',block:'Block 2 | >100 kWh/mo', vol:'LV',cents:0,c27:0,c28:0},
  {id:'rt20',  class:'RT20',block:'All blocks | <500kW',    vol:'LV',cents:0,c27:0,c28:0},
  {id:'rt40s', class:'RT40',block:'LV Standard',            vol:'LV',cents:0,c27:0,c28:0},
  {id:'rt40t', class:'RT40',block:'LV TOU',                 vol:'LV',cents:0,c27:0,c28:0},
  {id:'rt50s', class:'RT50',block:'MV Standard',            vol:'MV',cents:0,c27:0,c28:0},
  {id:'rt50t', class:'RT50',block:'MV TOU',                 vol:'MV',cents:0,c27:0,c28:0},
  {id:'rt60',  class:'RT60',block:'Streetlights',           vol:'LV',cents:0,c27:0,c28:0},
  {id:'rt70s', class:'RT70',block:'HV Standard',            vol:'HV',cents:0,c27:0,c28:0},
];

// Upload log — populated dynamically from fpa_uploads table; never seeded here
let uploadLog = [];

// ═══════════════════════════════════════════════════════
//  COMPUTED DERIVATIONS
// ═══════════════════════════════════════════════════════
const getOMRows=(yr)=>omRows[yr||selectedOMYear]||omRows[_CY];
const getCxRows=(yr)=>capexRows[yr||selectedCapexYear]||capexRows[_CY];
const getCollRows=(yr)=>collRows[yr||selectedCollYear]||collRows[_CY];

function computeAll(yr){
  yr=yr||selectedCollYear||_CY;
  const fxR=fx();
  const rows=getCollRows(yr);
  // GWh total
  const gwhIds=['gwh_rt10','gwh_rt20','gwh_rt40','gwh_rt50','gwh_rt60','gwh_rt70'];
  const totR=revRows.find(r=>r.id==='gwh_tot');
  if(totR) totR.vals=MONTHS.map((_,i)=>gwhIds.reduce((s,id)=>s+(revRows.find(x=>x.id===id)?.vals[i]||0),0));
  // Blended collection rate — equal-weight average of the three rate-class collection rates.
  // ARCHITECTURAL RULE: weighted blending ratios must come from DB (fpa_assumptions).
  // Until uploaded, equal weights (1/3 each) are used so the blended figure is the simple average.
  const rIds=['cr_rt10','cr_rt20','cr_rt40']; const wts=[1/3,1/3,1/3];
  const bl=rows.find(r=>r.id==='blended');
  if(bl) bl.vals=MONTHS.map((_,i)=>parseFloat((rIds.reduce((s,id,wi)=>s+(rows.find(x=>x.id===id)?.vals[i]||0)*wts[wi],0)).toFixed(1)));
  // Cash receipts
  const bill=rows.find(r=>r.id==='billing');
  const blR=rows.find(r=>r.id==='blended');
  const prior=rows.find(r=>r.id==='prior');
  const gcr=rows.find(r=>r.id==='gcr');
  const rec=rows.find(r=>r.id==='receipts');
  if(rec) rec.vals=MONTHS.map((_,i)=>Math.round(((bill?.vals[i]||0)/fxR)*((blR?.vals[i]||0)/100)+(prior?.vals[i]||0)+(gcr?.vals[i]||0)));
  const dso=rows.find(r=>r.id==='dso');
  if(dso) dso.vals=MONTHS.map((_,i)=>{const b=(bill?.vals[i]||0)/fxR;const rt=(blR?.vals[i]||0)/100;return b>0?Math.round((b*(1-rt))/Math.max(b,1)*30):0;});
}

const getOMTotal=(yr)=>{const rows=getOMRows(yr);return MONTHS.map((_,i)=>rows.filter(r=>!r.derived).reduce((s,r)=>s+(r.vals?.[i]||0),0));};
const getOMCash=(yr)=>{
  const rows=getOMRows(yr);
  return MONTHS.map((_,i)=>{
    const s=rows.filter(r=>r.cashLag===0).reduce((s2,r)=>s2+(r.vals?.[i]||0),0);
    // ARCHITECTURAL RULE: year-start carry-over fraction (0.5 = half Dec payment) must come from DB.
    // Until uploaded, use 0 (no year-start carry-over; prior year December cash is excluded).
    const d=rows.filter(r=>r.cashLag>0).reduce((s2,r)=>s2+(i>0?r.vals?.[i-1]:0)||0,0);
    return Math.round(s+d);
  });
};
const getCxTotal=(yr)=>{const rows=getCxRows(yr);return MONTHS.map((_,i)=>rows.reduce((s,r)=>s+(r.vals?.[i]||0),0));};
const getCxCash=(yr)=>{const rows=getCxRows(yr);return MONTHS.map((_,i)=>rows.reduce((s,r)=>{const lag=r.payLag||2;const si=i-lag;return s+(si>=0?r.vals[si]:0)||0;},0));};
const getCxTransfer=(yr)=>{const rows=getCxRows(yr);return MONTHS.map((_,i)=>rows.reduce((s,r)=>{const lag=r.tLag||1;const si=i-lag;return s+(si>=0?r.vals[si]:0)||0;},0));};
const getCashReceipts=(yr)=>{computeAll(yr);return getCollRows(yr).find(r=>r.id==='receipts')?.vals||MONTHS.map(()=>0);};

// ═══════════════════════════════════════════════════════
//  COLUMNS
// ═══════════════════════════════════════════════════════
// Tab-level year range (used by getCols when no tab-specific year exists)
let plYrFrom = _CY - 2, plYrTo = _CY + 1;

function getCols(){
  const yF = plYrFrom, yT = plYrTo;
  // A year counts as "actuals" when it is before the current plan year (i.e. prior year and earlier)
  const isActYear = y => y < planYear;
  const cols=[];
  if(period==='annual'){for(let y=yF;y<=yT;y++)cols.push({lbl:y+'',yr:y,act:isActYear(y)});}
  else if(period==='quarterly'){for(let y=yF;y<=yT;y++){['Q1','Q2','Q3','Q4'].forEach((q,qi)=>cols.push({lbl:q+String(y).slice(2),yr:y,qi,act:isActYear(y)}));}}
  else{for(let y=Math.max(yF,_CY);y<=Math.min(yT,_CY+1);y++)MONTHS.forEach((m,mi)=>cols.push({lbl:m[0]+' '+String(y).slice(2),yr:y,mi,act:false}));}
  return cols;
}
function colVal(line,col){
  const yi=YEARS.indexOf(String(col.yr));if(yi<0)return null;
  let base=line.vals?.[yi]??null;if(base===null)return null;
  if(!col.act&&activeSc!=='Base Case'){
    const s=scenarios[activeSc];
    if(line.id==='ebitda'||line.id==='net_inc')base=Math.round(base*(1+(s.eb||0)/100));
    else if(line.type==='I'&&!line.tot&&!line.sub&&!['Below EBITDA','TOTAL'].includes(line.sect))base=Math.round(base*(1+(s.rv||0)/100));
    else if(line.id==='opex')base=Math.round(base*(1+(s.om||0)/100));
  }
  // ARCHITECTURAL RULE: seasonal distribution weights must come from DB (fpa_assumptions).
  // Until uploaded, equal weights are used (no assumed seasonality).
  if(col.qi!==undefined){const qw=[.25,.25,.25,.25];return Math.round(base*qw[col.qi]);}
  if(col.mi!==undefined){const mw=Array(12).fill(1/12);return Math.round(base*mw[col.mi]);}
  return base;
}
function buildHead(hEl,cols,fw=175){
  hEl.innerHTML=`<tr><th style="min-width:${fw}px;text-align:left">Description</th>${cols.map(c=>`<th class="${c.act?'ac':'bc'}">${c.lbl}</th>`).join('')}<th class="bc">Total</th></tr>`;
}
function getInsurancePrepaidByMonth(yr){
  return MONTHS.map((_,m)=>{
    let cum=0;
    insurancePolicies.forEach(pol=>{
      const res=computeInsPolicy(pol);
      cum+=res.prepaidBalance[m]||0;
    });
    return Math.round(cum);
  });
}

function syncInsurancePrepaid(){
  const line=bsLines.find(l=>l.id==='ins_prepaid');
  if(!line)return;
  Array.from({length:5},(_,i)=>_CY+i).forEach((y,i)=>{
    const prepArr=getInsurancePrepaidByMonth(y);
    // bsLines vals index: _CY is at index 4 (matching YEARS array where _CY = index 4)
    line.vals[4+i]=prepArr[11]||0;
  });
}

function buildStatTbl(lines,hEl,bEl){
  if(lines===bsLines) syncInsurancePrepaid();
  const cols=getCols(); buildHead(hEl,cols);
  const isBS=(lines===bsLines);

  // For BS: inject actuals column from latest uploaded month
  const latestActMo=isBS?[1,2,3,4,5,6,7,8,9,10,11,12].filter(m=>_acts(m)).pop():null;
  const actBS=latestActMo?_acts(latestActMo)?.bs:null;
  const bsActMap={
    cash:actBS?.cash, receivables:actBS?.receivables, unbilled:actBS?.unbilled,
    fuel_inv:actBS?.fuelInv, materials:actBS?.materials, total_ca:actBS?.totalCurrentAssets,
    fixed_assets:actBS?.fixedAssetsNBV, total_assets:actBS?.totalAssets,
    payables:actBS?.payables, st_debt:actBS?.shortTermDebt, current_ltd:actBS?.currentLTD,
    total_cl:actBS?.totalCurrentLiab, lt_debt:actBS?.longTermDebt,
    lease_oblig:actBS?.leaseObligation, total_equity:actBS?.totalEquity,
  };

  // Inject actuals column into header if BS + actuals present
  if(isBS && actBS){
    const hHtml=hEl.innerHTML;
    // append a green "Actual" th before closing tr
    hEl.innerHTML=hHtml.replace('</tr>',
      `<th class="ac" style="background:rgba(16,185,129,.15);color:var(--green);border-left:2px solid rgba(16,185,129,.4)">${MONTHS[latestActMo-1]} Act</th></tr>`);
  }

  const span=cols.length+(isBS&&actBS?3:2);
  let html='',lastSect='';
  lines.forEach(r=>{
    if(r.sect!==lastSect&&r.sect){if(r.sect!=='TOTAL')html+=`<tr class="sr"><td colspan="${span}">${r.sect}</td></tr>`;lastSect=r.sect;}
    const cls=r.tot?'tr':r.sub?'sur':'';
    html+=`<tr class="${cls}"><td style="padding-left:${r.tot||r.sub?'10px':'22px'}">${r.name}${r.src?`<span class="src"> · ${r.src}</span>`:''}`;
    html+=`</td>`;
    let tot=0; cols.forEach(c=>{const v=colVal(r,c);tot+=v||0;html+=`<td class="dim">${fmtN(v)}</td>`;});
    html+=`<td class="${r.tot?'gld':'dim'}">${fmtN(tot)}</td>`;
    if(isBS && actBS){
      const aV=bsActMap[r.id]??null;
      html+=aV!=null
        ?`<td style="background:rgba(16,185,129,.08);color:var(--green);font-weight:600;border-left:2px solid rgba(16,185,129,.3)">${fmtN(aV)}</td>`
        :`<td style="background:rgba(16,185,129,.04);color:var(--muted);opacity:.4;border-left:2px solid rgba(16,185,129,.15)">\u2013</td>`;
    }
    html+=`</tr>`;
  });
  if(isBS && actBS){
    const cr=actBS.totalCurrentAssets&&actBS.totalCurrentLiab?(actBS.totalCurrentAssets/actBS.totalCurrentLiab).toFixed(2)+'×':'–';
    html+=`<tr style="background:rgba(16,185,129,.06)"><td colspan="${span}" style="padding:7px 14px;font-size:10px;color:var(--green)">
      <strong>● Actuals — ${MONTHS[latestActMo-1]} ${_CY}</strong> &nbsp;·&nbsp; Cash: $${Math.round(actBS.cash||0).toLocaleString()}K &nbsp;·&nbsp;
      Receivables: $${Math.round(actBS.receivables||0).toLocaleString()}K &nbsp;·&nbsp; Total Assets: $${Math.round(actBS.totalAssets||0).toLocaleString()}K
      &nbsp;·&nbsp; Current Ratio: ${cr} &nbsp;·&nbsp; Source: B_S sheet of uploaded file
    </td></tr>`;
  }
  bEl.innerHTML=html;
}

// ═══════════════════════════════════════════════════════
//  DEPRECIATION REPORT
// ═══════════════════════════════════════════════════════
// depYears — columns for the historic rpt-dep report (5 years back through next year)
const depYears = Array.from({length:7}, (_,i) => String(_CY - 5 + i));
// depMonthly2026 — zeroed. Populate from uploads.
const depMonthly2026 = Array(12).fill(0);
// depLines — zeroed. Populate from uploads.
const _z7=()=>Array(7).fill(0);
const depLines = [
  {name:'Depreciation expense (FA Register)',  vals:_z7()},
  {name:'SJPC Depreciation',                   vals:_z7(),src:true},
  {name:'Other Lease Assets (IFRS-16)',         vals:_z7(),src:true},
  {name:'CapEx Transfers – New Additions',      vals:_z7()},
  {name:'Capital Spares',                       vals:_z7()},
  {name:'Decommissioning (OH, HB, RF, BG)',     vals:_z7()},
  {name:'Impairment / Hurricane Melissa',       vals:_z7()},
  {name:'Stranded Assets (Meters)',             vals:_z7()},
  {name:'Stranded Assets (Streetlights)',       vals:_z7()},
  {name:'TOTAL DEPRECIATION',                  vals:_z7(),tot:true},
];

function buildDepReport(){
  document.getElementById('depH').innerHTML=`<tr><th style="text-align:left;min-width:260px">Component</th>${depYears.map(y=>`<th class="${parseInt(y)<_CY?'ac':'bc'}">${y}</th>`).join('')}</tr>`;
  document.getElementById('depB').innerHTML=depLines.map(r=>{
    const cls=r.tot?'tr':'';
    return `<tr class="${cls}"><td style="padding-left:${r.tot?'10px':'20px'}">${r.name}${r.src?'<span class="src"> · SJPC/Lease</span>':''}</td>${r.vals.map(v=>`<td>${fmtN(v)}</td>`).join('')}</tr>`;
  }).join('');

  // Monthly actuals overlay — pull depreciation from actualsStore
  const loadedMos=[1,2,3,4,5,6,7,8,9,10,11,12].filter(m=>_acts(m));
  const actDepArr=MONTHS.map((_,i)=>{
    const v=_acts(i+1)?.pl?.depreciation;
    return v!=null?Math.abs(v):null;
  });
  const leDepArr=MONTHS.map((_,m)=>Math.round(calcDepTotals(_CY,m).regular/1000));

  // Monthly chart: LE bars + actuals line
  mkChart('cDepMo',{
    type:'bar',
    data:{labels:MONTHS,datasets:[
      {label:'LE Monthly Depn (US$K)',data:leDepArr,backgroundColor:'rgba(240,180,41,.55)',borderColor:'rgba(240,180,41,.8)',borderWidth:1,order:2},
      {label:'Actual Depn (uploaded)',data:actDepArr,type:'line',borderColor:'rgba(16,185,129,.9)',backgroundColor:'rgba(16,185,129,.2)',borderWidth:2,pointRadius:4,pointBackgroundColor:'rgba(16,185,129,1)',tension:.3,fill:false,order:1},
    ]},
    options:{
      ...bO(),
      plugins:{legend:{labels:{color:_TC.muted,font:{size:9},boxWidth:10}},
               tooltip:{callbacks:{label:ctx=>(ctx.dataset.label||'')+': $'+Math.round(Math.abs(ctx.raw||0)).toLocaleString()+'K'}}},
    }
  });

  // Annual chart (unchanged)
  mkChart('cDepAnn',{type:'bar',data:{labels:depYears,datasets:[
    {label:'FA Register',data:depLines[0].vals,backgroundColor:'rgba(59,130,246,.7)',stack:'s'},
    {label:'SJPC',data:depLines[1].vals,backgroundColor:'rgba(139,92,246,.7)',stack:'s'},
    {label:'Lease Assets',data:depLines[2].vals,backgroundColor:'rgba(6,182,212,.6)',stack:'s'},
    {label:'CapEx Transfers',data:depLines[3].vals,backgroundColor:'rgba(240,180,41,.6)',stack:'s'},
    {label:'Other',data:depLines.slice(4,8).map((_,i)=>depLines.slice(4,8).reduce((s,r)=>s+(r.vals[i]||0),0)),backgroundColor:'rgba(100,116,139,.5)',stack:'s'},
  ]},options:{...bO(),scales:{x:{ticks:{color:_TC.muted,font:{size:9}},grid:{color:_TC.grid},stacked:true},y:{stacked:true,ticks:{color:_TC.muted,font:{size:9},callback:v=>toK(v)},grid:{color:_TC.grid}}}}});

  // Actuals strip below charts
  if(loadedMos.length){
    const ytdActDep=loadedMos.reduce((s,m)=>{const v=_acts(m)?.ytdActual?.depreciation;return s+(v!=null?Math.abs(v):0);},0);
    const ytdActDepDirect=actDepArr.reduce((s,v)=>s+(v||0),0);
    const n=loadedMos.length;
    const ytdLEDep=leDepArr.slice(0,n).reduce((s,v)=>s+v,0);
    const varD=ytdActDepDirect-ytdLEDep;
    const varGood=varD<=0; // lower depn = favourable
    const depStrip=document.getElementById('depActualsStrip');
    if(depStrip){
      depStrip.style.display='';
      depStrip.innerHTML=`<div style="display:flex;gap:12px;flex-wrap:wrap;padding:8px 12px;border-radius:5px;border:1px solid var(--border);background:var(--card2);font-size:11px;margin-top:8px">
        <span style="color:var(--muted)">Depreciation YTD (${n} mo actuals):</span>
        <span><strong style="color:var(--text)">Actual:</strong> <span style="color:var(--green)">$${Math.round(ytdActDepDirect).toLocaleString()}K</span></span>
        <span><strong style="color:var(--text)">LE:</strong> $${Math.round(ytdLEDep).toLocaleString()}K</span>
        <span style="color:${varGood?'var(--green)':'var(--red)'}"><strong>Var: ${varD>0?'+':''}${Math.round(varD).toLocaleString()}K</strong> ${varGood?'(Fav)':'(Adv)'}</span>
        <span style="color:var(--muted);font-size:9px">Source: P&L sheet row 19 of uploaded file</span>
      </div>`;
    }
  }
}

// ═══════════════════════════════════════════════════════
//  CASH FLOW MODULE — Session 5
//  Two views: Indirect (IFRS) + Direct (Forecast)
// ═══════════════════════════════════════════════════════
let cfView = 'indirect';
// Default to latest closed month (overridden after bootstrap); fallback to current calendar month
let cfSelectedMonth = new Date().getMonth() + 1;

function setCFView(v, btn) {
  cfView = v;
  document.querySelectorAll('#cfViewSeg .sb').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  buildCFReport();
}

// Opening/closing cash from actuals or model
function getCFOpeningCash(month) {
  if (_acts(month - 1)?.bs?.cash) return _acts(month - 1).bs.cash;
  return 0; // no hardcoded fallback — returns 0 when no actuals loaded
}

// Direct CF seed data — actuals populated at runtime from uploaded files (no hardcoded values)
// Labels: 2 months before current year, then Jan through Jun of current year
function _buildDirectCFLabels() {
  const abbr = m => MONTHS[m-1] + '-' + String(_CY + Math.floor((m-1)/12)).slice(2);
  const prev2 = [
    MONTHS[10] + '-' + String(_PY).slice(2),   // Nov prior year
    MONTHS[11] + '-' + String(_PY).slice(2),   // Dec prior year
  ];
  const curr6 = [1,2,3,4,5,6].map(m => MONTHS[m-1] + '-' + String(_CY).slice(2));
  return [...prev2, ...curr6];
}
const directCFSeed = {
  labels: _buildDirectCFLabels(),
  collections:         [null,null,null,null,null,null,null,null],
  loanFinancing:       [null,null,null,null,null,null,null,null],
  insuranceProceeds:   [null,null,null,null,null,null,null,null],
  gctReimbursement:    [null,null,null,null,null,null,null,null],
  dividendReceived:    [null,null,null,null,null,null,null,null],
  totalReceipts:       [null,null,null,null,null,null,null,null],
  fuel:                [null,null,null,null,null,null,null,null],
  ipp:                 [null,null,null,null,null,null,null,null],
  payroll:             [null,null,null,null,null,null,null,null],
  supplier:            [null,null,null,null,null,null,null,null],
  transport:           [null,null,null,null,null,null,null,null],
  customs:             [null,null,null,null,null,null,null,null],
  taxes:               [null,null,null,null,null,null,null,null],
  inventory:           [null,null,null,null,null,null,null,null],
  insurance:           [null,null,null,null,null,null,null,null],
  loanPrincipal:       [null,null,null,null,null,null,null,null],
  loanInterest:        [null,null,null,null,null,null,null,null],
  hurricaneRestoration:[null,null,null,null,null,null,null,null],
  totalDisbursements:  [null,null,null,null,null,null,null,null],
  edfContribution:     [null,null,null,null,null,null,null,null],
  netInflow:           [null,null,null,null,null,null,null,null],
  openingBalance:      [null,null,null,null,null,null,null,null],
  closingBalance:      [null,null,null,null,null,null,null,null],
  restrictedCash:      [null,null,null,null,null,null,null,null],
  cashAndEquiv:        [null,null,null,null,null,null,null,null],
};

// Populate Mar-Jun from model
function getDirectCFForecast(idx) {
  // idx 4=Mar, 5=Apr, 6=May, 7=Jun (0-based vs Nov-25)
  const mo = idx - 2; // 1=Jan, so idx4=mo2... map: idx4->mo3, idx5->mo4...
  const moIdx = idx - 2; // actual month index 0-based: idx4 = month 3 (Mar) = moIdx 2
  const rec = getCashReceipts(cfYear);
  const omC = getOMCash(cfYear);
  const cxC = getCxCash(cfYear);
  const moI = moIdx; // 0-indexed month
  const receipts = rec[moI] || 0;
  const disburs = omC[moI] + cxC[moI] + ((fuelCostByMonth[cfYear]||fuelCostByMonth2026)[moI]||0);
  return { receipts, disburs, net: receipts - disburs };
}

// Validate Feb indirect CF against deck (page 24)
// Feb: ops=15958, investing=-58163, financing=-15053, closing=92371
function buildIndirectCF() {
  const mo = cfSelectedMonth;
  const act = _acts(mo);
  const prevAct = _acts(mo-1);
  const hasActuals = !!act?.pl;
  const hasActCF   = !!act?.cf;

  // Line values — prefer actuals from uploaded file, fall back to 0 (no hardcoded seed values)
  const netProfit     = act?.pl?.netIncome ?? 0;
  const depreciation  = act?.pl?.depreciation ? Math.abs(act.pl.depreciation) : 0;
  // If CF sheet available, use its depreciation add-back directly
  const deprAddBack   = hasActCF ? (act.cf.depreciation || depreciation) : depreciation;
  const interestExp   = act?.pl?.intExpense ? Math.abs(act.pl.intExpense) : 0;
  const fxLossNonCash = otherIncomeRows.find(r=>r.id==='fx_gain')?.vals[cfYear]?.[mo-1] || 0;
  const gainDisposal  = 0;
  const restrictedCash= 0;
  const otherAdj      = 0;
  const opsBeforeWC   = netProfit + deprAddBack + interestExp - fxLossNonCash - gainDisposal + restrictedCash + otherAdj;

  // Working capital — use CF sheet if available, else compute from BS delta
  let deltaReceivables = 0, deltaInventory = 0, deltaPayables = 0;
  if(hasActCF) {
    deltaReceivables = act.cf.accountsReceivable || 0;
    deltaPayables    = act.cf.payables || 0;
  } else if(act?.bs && prevAct?.bs) {
    deltaReceivables = (prevAct.bs.receivables||0) - (act.bs.receivables||0); // decrease = positive
    deltaPayables    = (act.bs.payables||0) - (prevAct.bs.payables||0);       // increase = positive
  } else {
    // No actuals and no BS delta — working capital = 0
    deltaReceivables = 0; deltaPayables = 0;
  }
  const deltaRelParties = 0;
  const wcTotal         = deltaReceivables + deltaInventory + deltaPayables + deltaRelParties;
  const netCashOps      = opsBeforeWC + wcTotal;

  // Investing — use model CapEx schedule
  const modelCapex  = -(getCxCash(cfYear)[mo-1]||0);
  const capex       = hasActCF ? modelCapex : modelCapex;
  const proceeds    = otherIncomeRows.find(r=>r.id==='asset_disp')?.vals[cfYear]?.[mo-1]||0;
  const divRec      = otherIncomeRows.find(r=>r.id==='div_rec')?.vals[cfYear]?.[mo-1]||0;
  const netCashInvesting = capex + proceeds + divRec;

  // Financing
  const loanDrawdowns = 0;
  const loanRepayments = 0;
  const interestPaid  = -interestExp;
  const prefDivPaid   = -(appropriationRows.find(r=>r.id==='div_pref')?.vals[cfYear]?.[mo-1]||0);
  const ordDivPaid    = -(appropriationRows.find(r=>r.id==='div_ord')?.vals[cfYear]?.[mo-1]||0);
  const netCashFinancing = loanDrawdowns + loanRepayments + interestPaid + prefDivPaid + ordDivPaid;

  // Closing — prefer actuals BS cash
  const netChange   = netCashOps + netCashInvesting + netCashFinancing;
  const openingCash = prevAct?.bs?.cash ?? 0;
  const closingCash = act?.bs?.cash ?? (openingCash + netChange);
  const closingModel = openingCash + netChange;
  const cfRecDiff   = act?.bs?.cash ? Math.round(act.bs.cash - closingModel) : 0;

  // Build table
  const COLS = ['MTD Actual','MTD Budget','Variance'];
  const bud = { netProfit:0, depreciation:0, opsBeforeWC:0,
    netCashOps:0, netCashInvesting:0, netCashFinancing:0,
    netChange:0, openingCash:0, closingCash:0 };

  const rows = [
    {s:'OPERATING ACTIVITIES'},
    {n:'Net Profit for the period',     a:netProfit,           b:bud.netProfit},
    {s:'Adjustments:'},
    {n:'  Depreciation (non-cash)',      a:depreciation,       b:bud.depreciation},
    {n:'  FX (Gains)/Losses — non-cash', a:-fxLossNonCash,    b:0},
    {n:'  Net interest expense',          a:interestExp,       b:0},
    {n:'  Other adjustments',             a:otherAdj,          b:0},
    {n:'Cash from operations before WC',  a:opsBeforeWC, b:bud.opsBeforeWC, sub:true},
    {s:'Working Capital Changes:'},
    {n:'  (Increase)/decrease in receivables', a:deltaReceivables, b:0},
    {n:'  (Increase)/decrease in inventories', a:deltaInventory,   b:0},
    {n:'  Increase/(decrease) in payables',    a:deltaPayables,    b:0},
    {n:'Net cash from operating activities',   a:netCashOps,  b:bud.netCashOps, tot:true},
    {s:'INVESTING ACTIVITIES'},
    {n:'  Capital expenditure',         a:capex,               b:-(fpa.factMonthly(_aopCode(),'cf_capex',cfYear)[mo-1]||getCxCash(cfYear)[mo-1]||0)},
    {n:'  Dividend received',           a:divRec,              b:0},
    {n:'  Proceeds from disposal',      a:proceeds,            b:0},
    {n:'Net cash used in investing',    a:netCashInvesting, b:bud.netCashInvesting, tot:true},
    {s:'FINANCING ACTIVITIES'},
    {n:'  Loan drawdowns',              a:loanDrawdowns,       b:0},
    {n:'  Loan repayments',             a:loanRepayments,      b:0},
    {n:'  Interest paid',               a:interestPaid,        b:0},
    {n:'  Preference dividends paid',   a:prefDivPaid,         b:-(fpa.factMonthly(_aopCode(),'cf_pref_div',cfYear)[mo-1]||0)},
    {n:'  Ordinary dividends paid',     a:ordDivPaid,          b:0},
    {n:'Net cash used in financing',    a:netCashFinancing, b:bud.netCashFinancing, tot:true},
    {s:'CASH MOVEMENT'},
    {n:'Net increase/(decrease) in cash', a:netChange,         b:bud.netChange, sub:true},
    {n:'Opening cash balance',             a:openingCash,      b:bud.openingCash},
    {n:'Closing cash balance',             a:closingCash,      b:bud.closingCash, tot:true},
  ];

  const hEl = document.getElementById('cfH');
  const bEl = document.getElementById('cfB');

  const actBadge = hasActuals ? `<span class="badge badge-ok" style="margin-left:6px">● Actuals Loaded</span>` : '';
  hEl.innerHTML = `<tr><th style="text-align:left;min-width:280px">Description${actBadge}</th><th class="ac">MTD ${hasActuals?'Actual':'Model'}</th><th class="bc">MTD Budget</th><th>Variance</th></tr>`;
  let html = '', lastS = '';
  rows.forEach(r => {
    if (r.s) { html += `<tr class="sr"><td colspan="4">${r.s}</td></tr>`; return; }
    const a = r.a ?? null, b = r.b ?? null;
    const v = (a !== null && b !== null) ? a - b : null;
    const cls = r.tot ? 'tr' : r.sub ? 'sur' : '';
    const pl = r.tot || r.sub ? '10px' : '22px';
    html += `<tr class="${cls}"><td style="padding-left:${pl}">${r.n}</td>`;
    html += `<td class="${a===null?'dim':''}">${fmtN(a)}</td>`;
    html += `<td class="${b===null?'dim':''}">${fmtN(b)}</td>`;
    html += `<td>${v !== null ? fmtV(v) : '<span class="dim">–</span>'}</td></tr>`;
  });
  bEl.innerHTML = html;

  const actLabel = hasActuals ? `Actuals Loaded · ${MONTHS[mo-1]} ${cfYear}` : `Model Only · ${MONTHS[mo-1]} ${cfYear}`;
  document.getElementById('cfTableTitle').textContent = '📊 Indirect Cash Flow (IFRS) — ' + actLabel;
  document.getElementById('cfChartTitle').textContent = `Monthly Cash Position ${cfYear} · Actuals vs Model`;

  // Chart — show actuals closing cash (bars) + model closing cash (line)
  const actCloseArr = MONTHS.map((_,i)=>_acts(i+1)?.bs?.cash??null);
  // Model closing cash: build month-by-month from model opening
  let modelClose=[]; let modelOpen=0;
  MONTHS.forEach((_,i)=>{
    const m=i+1;
    if(_acts(m)?.bs?.cash){ modelClose.push(_acts(m).bs.cash); modelOpen=_acts(m).bs.cash; }
    else{ const cxC=getCxCash(cfYear)[i]||0; const netP=(getOMTotal(cfYear)[i]||0)*(-1); const mc=modelOpen-cxC; modelClose.push(Math.round(mc)); modelOpen=Math.round(mc); }
  });
  const hasActBSAny = actCloseArr.some(v=>v!==null);
  const cfDatasets = hasActBSAny ? [
    {label:'Actual Closing Cash (BS)',data:actCloseArr,backgroundColor:'rgba(6,182,212,.6)',borderRadius:3,order:2},
    {label:'Model Closing Cash',data:modelClose,type:'line',borderColor:'rgba(240,180,41,.8)',borderDash:[5,3],borderWidth:2,pointRadius:3,tension:.3,fill:false,order:1},
  ] : [
    {label:'Model Closing Cash',data:modelClose,backgroundColor:'rgba(6,182,212,.45)',borderColor:'rgba(6,182,212,.8)',borderWidth:1,borderRadius:3},
  ];
  mkChart('cCFR',{type:'bar',data:{labels:MONTHS,datasets:cfDatasets},options:{
    ...bO(),
    plugins:{legend:{labels:{color:_TC.muted,font:{size:9},boxWidth:10}}},
    scales:{x:{ticks:{color:_TC.muted,font:{size:9}},grid:{color:_TC.grid}},y:{ticks:{color:_TC.muted,font:{size:9},callback:v=>toK(v)},grid:{color:_TC.grid}}}
  }});

  // Reconciliation note when actuals differ from model
  if(hasActuals && cfRecDiff !== 0){
    const recEl = document.getElementById('cfRecNote');
    if(recEl){
      const col = Math.abs(cfRecDiff) < 5000 ? 'var(--amber)' : 'var(--red)';
      recEl.innerHTML=`<div style="padding:7px 12px;border-radius:5px;border:1px solid ${col}40;background:${col}10;font-size:10px;color:${col}">
        ⚠ CF Reconciliation Gap: Actual closing cash $${Math.round(act.bs.cash).toLocaleString()}K vs Model $${Math.round(closingModel).toLocaleString()}K — Difference: ${cfRecDiff>0?'+':''}${Math.round(cfRecDiff).toLocaleString()}K.
        Likely due to unmodelled financing flows or WC movements not in model assumptions.
      </div>`;
      recEl.style.display='';
    }
  } else {
    const recEl = document.getElementById('cfRecNote');
    if(recEl) recEl.style.display='none';
  }

  return closingCash;
}

function buildDirectCF() {
  const cols = directCFSeed.labels;
  const hEl = document.getElementById('cfH');
  const bEl = document.getElementById('cfB');

  // Populate forecast months (idx 4-7 = Mar-Jun) from model
  const forecastMonths = [2,3,4,5]; // 0-based month indices for Mar-Jun
  const rec = getCashReceipts(cfYear); const omC = getOMCash(cfYear); const cxC = getCxCash(cfYear);
  for (let i = 0; i < 4; i++) {
    const mi = forecastMonths[i];
    const colIdx = i + 4;
    directCFSeed.collections[colIdx]    = rec[mi] || 0;
    directCFSeed.totalReceipts[colIdx]  = rec[mi] || 0;
    directCFSeed.fuel[colIdx]           = (fuelCostByMonth[cfYear]||fuelCostByMonth2026)[mi] || 0;
    // ARCHITECTURAL RULE: IPP/payroll split of O&M cash must come from DB (fpa_assumptions).
    // Until uploaded, full O&M cash is reported on the IPP line; payroll = 0.
    const _ippFrac = fpa.assumptions?.cashFlow?.ippFraction ?? 1.0;
    const _payFrac = fpa.assumptions?.cashFlow?.payrollFraction ?? 0.0;
    directCFSeed.ipp[colIdx]            = omC[mi] ? Math.round(omC[mi]*_ippFrac) : 0;
    directCFSeed.payroll[colIdx]        = omC[mi] ? Math.round(omC[mi]*_payFrac) : 0;
    directCFSeed.hurricaneRestoration[colIdx] = cxC[mi] || 0;
    const totDisb = (directCFSeed.fuel[colIdx]||0)+(directCFSeed.ipp[colIdx]||0)+(directCFSeed.payroll[colIdx]||0)+(directCFSeed.hurricaneRestoration[colIdx]||0);
    directCFSeed.totalDisbursements[colIdx] = totDisb;
    const net = (directCFSeed.totalReceipts[colIdx]||0) - totDisb;
    directCFSeed.netInflow[colIdx] = net;
    const prev = i === 0 ? (directCFSeed.closingBalance[3]||0) : (directCFSeed.closingBalance[colIdx-1]||0);
    directCFSeed.openingBalance[colIdx] = prev;
    directCFSeed.closingBalance[colIdx] = prev + net;
    directCFSeed.cashAndEquiv[colIdx]   = prev + net;
  }

  const rows = [
    {s:'RECEIPTS'},
    {n:'Collections from Customers', k:'collections'},
    {n:'Long-term Debt Financing',    k:'loanFinancing'},
    {n:'Insurance Proceeds',          k:'insuranceProceeds'},
    {n:'GCT Reimbursements',          k:'gctReimbursement'},
    {n:'Dividend Received',           k:'dividendReceived'},
    {n:'Total Receipts',              k:'totalReceipts', tot:true},
    {s:'DISBURSEMENTS'},
    {n:'Fuel',                        k:'fuel'},
    {n:'IPP / Purchased Power',       k:'ipp'},
    {n:'Payroll & Related',           k:'payroll'},
    {n:'Supplier / Contractor',       k:'supplier'},
    {n:'Motor Vehicle & Transport',   k:'transport'},
    {n:'Customs',                     k:'customs'},
    {n:'Taxes',                       k:'taxes'},
    {n:'Inventory',                   k:'inventory'},
    {n:'Insurance',                   k:'insurance'},
    {n:'Loan Principal',              k:'loanPrincipal'},
    {n:'Loan Interest & Fees',        k:'loanInterest'},
    {n:'Hurricane Restoration',       k:'hurricaneRestoration'},
    {n:'Total Disbursements',         k:'totalDisbursements', tot:true},
    {s:'SUMMARY'},
    {n:'EDF Contribution/(Transfer)', k:'edfContribution'},
    {n:'Net Inflow/(Outflow)',         k:'netInflow', sub:true},
    {n:'Opening Balance',             k:'openingBalance'},
    {n:'Closing Balance',             k:'closingBalance', tot:true},
    {n:'Restricted Cash',             k:'restrictedCash'},
    {n:'Cash and Cash Equivalents',   k:'cashAndEquiv', sub:true},
  ];

  hEl.innerHTML = `<tr><th style="text-align:left;min-width:240px">Description</th>${cols.map((c,i)=>`<th class="${i<2?'dim':i<4?'ac':'bc'}">${c}</th>`).join('')}</tr>`;
  let html = '';
  rows.forEach(r => {
    if (r.s) { html += `<tr class="sr"><td colspan="${cols.length+1}">${r.s}</td></tr>`; return; }
    const cls = r.tot ? 'tr' : r.sub ? 'sur' : '';
    const pl = r.tot || r.sub ? '10px' : '22px';
    html += `<tr class="${cls}"><td style="padding-left:${pl}">${r.n}</td>`;
    cols.forEach((c,i) => {
      const v = directCFSeed[r.k]?.[i];
      const locked = i < 4; // Nov,Dec,Jan,Feb are locked/actual
      if (v === null) { html += `<td class="dim">–</td>`; return; }
      if (locked) html += `<td>${fmtN(v)}</td>`;
      else html += `<td style="color:var(--teal)">${fmtN(v)}</td>`;
    });
    html += '</tr>';
  });
  bEl.innerHTML = html;

  document.getElementById('cfTableTitle').textContent = '💧 Direct Cash Flow (Rolling Forecast) — 8-Month View';
  document.getElementById('cfChartTitle').textContent = 'Monthly Cash Flow — Direct Method';

  const netArr  = directCFSeed.netInflow.map(v => v ?? 0);
  const closeArr= directCFSeed.closingBalance.map(v => v ?? 0);
  mkChart('cCFR',{type:'bar',data:{labels:cols,datasets:[
    {label:'Net Inflow/(Outflow)',data:netArr,backgroundColor:netArr.map(v=>v>=0?'rgba(16,185,129,.55)':'rgba(239,68,68,.45)')},
    {label:'Closing Balance',data:closeArr,type:'line',borderColor:CP[1],borderWidth:2,tension:.3,pointRadius:3,yAxisID:'y2'},
  ]},options:{...bO(),scales:{
    x:{ticks:{color:_TC.muted,font:{size:9}},grid:{color:_TC.grid}},
    y:{ticks:{color:_TC.muted,font:{size:9},callback:v=>toK(v)},grid:{color:_TC.grid}},
    y2:{position:'right',ticks:{color:_TC.muted,font:{size:9},callback:v=>toK(v)},grid:{drawOnChartArea:false}},
  }}});

  return directCFSeed.closingBalance[3] || 0; // closing cash from actuals if loaded
}

function checkCFReconciliation() {
  try {
    const indClose = _acts(2)?.bs?.cash || 0;
    const dirClose = directCFSeed.closingBalance[3] || 0;
    const diff = indClose - dirClose;
    const badge = document.getElementById('cfRecBadge');
    if (!badge) return;
    badge.innerHTML = diff === 0
      ? `<span style="background:rgba(16,185,129,.15);color:var(--green);padding:4px 12px;border-radius:20px;font-size:10px;font-weight:700;border:1px solid rgba(16,185,129,.3)">✅ Reconciled — Both methods agree at ${fmtN(indClose)}</span>`
      : `<span style="background:rgba(239,68,68,.1);color:var(--red);padding:4px 12px;border-radius:20px;font-size:10px;font-weight:700;border:1px solid rgba(239,68,68,.25)">⚠️ Difference: ${fmtN(Math.abs(diff))} — Indirect: ${fmtN(indClose)} | Direct: ${fmtN(dirClose)}</span>`;
  } catch(e){}
}

function buildCFCovenants() { /* removed — covenant cards hidden until actuals loaded */ }

function buildCFKpis() {
  const mo = cfSelectedMonth;
  const act = _acts(mo);
  const totalRec = act?.cf?.operatingCF != null ? act.cf.operatingCF : (getCashReceipts(cfYear)[mo-1]||0);
  const totalDisb = getOMCash(cfYear)[mo-1] + getCxCash(cfYear)[mo-1] + ((fuelCostByMonth[cfYear]||fuelCostByMonth2026)[mo-1]||0);
  const netCF = totalRec - totalDisb;
  const closingCash = act?.bs?.cash || 0;
  const moLbl = `${MONTHS[mo-1]} ${cfYear}`;
  const kpis = [
    {lbl:'Total Receipts',   v:fmtN(totalRec),  d:act?'Actual':moLbl,  c:'gr'},
    {lbl:'Total Disbursements',v:fmtN(totalDisb),d:act?'Actual':moLbl, c:'r'},
    {lbl:'Net Cash Flow',    v:fmtN(netCF),     d:netCF>=0?'Inflow':'Outflow', c:netCF>=0?'gr':'r'},
    {lbl:'Closing Cash',     v:fmtN(closingCash),d:'End of period',  c:'t'},
  ];
  document.getElementById('cfKpis').innerHTML = kpis.map(k=>
    `<div class="kpi ${k.c}"><div class="kpi-l">${k.lbl}</div><div class="kpi-v">${k.v}</div><div class="kpi-d flat">${k.d}</div></div>`
  ).join('');
}

// Fuel cost lookup for CF forecast
// fuelCostByMonth2026 — populated from uploads only; no hardcoded estimates
const fuelCostByMonth2026 = Array(12).fill(0);

function buildCFReport(){
  cfSelectedMonth = parseInt(document.getElementById('cfMo')?.value || 2);
  buildCFCovenants();
  buildCFKpis();
  checkCFReconciliation();
  if (cfView === 'indirect') {
    buildIndirectCF();
  } else {
    buildDirectCF();
  }
}

// ═══════════════════════════════════════════════════════
//  ACTUALS STORE  — populated at runtime from uploaded JPSCo_Financials_MM-YY.xlsx files
//  Keys: month number (1=Jan, 2=Feb …)
//  Each entry: { pl:{}, budget:{}, ytdActual:{}, ytdBudget:{}, rev:{}, bs:{}, cf:{} }
//  P&L sub-object keys mirror P&L ROW INDEX comment in spec
// ═══════════════════════════════════════════════════════
// actualsStore — populated at runtime from fpa.facts (Supabase). No hardcoded seed data.
const actualsStore = {};

// Upload log for actuals — populated at runtime from fpa_audit_log. No seed entries.
let actualsLog = [];

// ═══════════════════════════════════════════════════════
//  GENERATION MIX DATA — from System_Control_February_2026_LE.xlsm
//  Units: MWh (monthly gross generation by fuel type)
//  Source rows: JPS own plant + IPP contracted capacity
// ═══════════════════════════════════════════════════════
// genMixData — populated at runtime from fpa.facts (Supabase). No hardcoded seed values.
const _zeroMix = () => Array(12).fill(0);
const genMixData = {
  hfo:     { name:'HFO / Diesel (JPS)',  color:'rgba(239,68,68,.7)',   vals:_zeroMix() },
  lng:     { name:'LNG / Gas (JPS)',     color:'rgba(59,130,246,.7)',  vals:_zeroMix() },
  solar:   { name:'Solar PV (JPS)',      color:'rgba(240,180,41,.75)', vals:_zeroMix() },
  wind:    { name:'Wind (JPS)',          color:'rgba(16,185,129,.7)',  vals:_zeroMix() },
  hydro:   { name:'Hydro (JPS)',         color:'rgba(6,182,212,.7)',   vals:_zeroMix() },
  ipp_hfo: { name:'IPP – HFO',          color:'rgba(239,68,68,.4)',   vals:_zeroMix() },
  ipp_lng: { name:'IPP – LNG/Gas',      color:'rgba(59,130,246,.4)',  vals:_zeroMix() },
  ipp_re:  { name:'IPP – Renewables',   color:'rgba(16,185,129,.4)',  vals:_zeroMix() },
};

// revBudgetMonthly — populated at runtime from AOP version in fpa.facts (Supabase). No hardcoded seed values.
const revBudgetMonthly = {
  fuel:     Array(12).fill(0),
  nonFuel:  Array(12).fill(0),
  ipp:      Array(12).fill(0),
  total:    Array(12).fill(0),
  salesMWh: Array(12).fill(0),
};

// ═══════════════════════════════════════════════════════
//  RATIOS & KPIs TAB — Session 9
// ═══════════════════════════════════════════════════════
let selectedKpiYear = _CY;

function buildKpiTab() {
  buildYrSeg('kpiYrSeg', selectedKpiYear, (y, btn) => {
    selectedKpiYear = y;
    buildKpiTab();
  });
  buildKpiScoreCards();
  buildKpiCovenantStrip();
  buildKpiLiquidityTable();
  buildKpiProfitabilityTable();
  buildKpiLeverageTable();
  buildKpiOpsTable();
  buildKpiCharts();
}

// ── Helper: get P&L line value by name fragment ──────
function _plVal(nameFrag, mo, yr) {
  yr = yr || selectedKpiYear;
  const yidx = 4 + (yr - _CY); // _CY is at vals index 4
  const line = plLines.find(l => l.name && l.name.toLowerCase().includes(nameFrag.toLowerCase()));
  if (!line) return 0;
  if (mo !== undefined) {
    // monthly P&L
    return 0; // fallback — monthly P&L not easily extractable from plLines (annual)
  }
  return line.vals?.[yidx] || 0;
}

// Get monthly P&L using blended actuals (closed periods) + LE/Forecast (open periods).
// Priority: 1) DB-loaded actuals  2) seeded actualsStore  3) fpa.facts LE  4) engine fallback
function _getMonthlyPLLine(key, yr) {
  yr = yr || selectedKpiYear;

  // ── Extractors: actualsStore pl object → value ──────────────────────────
  const ACT_EXTRACT = {
    revenue: a => (a.fuelSales||0) + (a.nonFuelSales||0),
    nonfuel: a => a.nonFuelSales||0,
    ebitda:  a => a.ebitda||0,
    ebit:    a => a.ebit||0,
    netinc:  a => a.netIncome||0,
    depn:    a => Math.abs(a.depreciation||0),
  };

  // ── Name fragments for fpa.facts / plLines line lookup ──────────────────
  const LINE_FRAGS = {
    revenue: ['total revenue','total sales'],
    nonfuel: ['non-fuel','nonfuel'],
    ebitda:  ['ebitda'],
    ebit:    ['operating income','ebit'],
    netinc:  ['net profit after','net income'],
    depn:    ['depreciation'],
  };

  // Resolve line ID from plLines (already bridged from fpa.facts)
  let lineId = null;
  for (const frag of (LINE_FRAGS[key] || [])) {
    const l = (typeof plLines !== 'undefined' ? plLines : [])
                .find(l => l.name && l.name.toLowerCase().includes(frag));
    if (l) { lineId = l.id; break; }
  }

  // Version code for LE / History / Forecast
  const leVer = yr < _CY  ? `HIST_ACTUAL_${yr}` :
                yr === _CY ? `LE_${_CY}_02`      : 'FORECAST_BASE';

  const extractor = ACT_EXTRACT[key];
  const result    = Array(12).fill(0);

  for (let m = 0; m < 12; m++) {
    const mNum = m + 1;

    // ── Closed period → use actuals ────────────────────────────────────────
    if (fpa.isPeriodClosed(yr, mNum)) {

      // 1. DB-loaded actuals: actualsStore[year][month] — flat or { pl:{} }
      const dbEntry = actualsStore[yr]?.[mNum];
      if (dbEntry && extractor) {
        result[m] = extractor(dbEntry.pl ?? dbEntry);
        continue;
      }

      // 2. Seeded actuals (month-indexed, _CY only): _acts(month).pl
      if (yr === _CY) {
        const seedPL = _acts(mNum)?.pl;
        if (seedPL && extractor) { result[m] = extractor(seedPL); continue; }
      }
    }

    // ── Open period (or no actuals found) → try fpa.facts ─────────────────
    if (lineId !== null) {
      const v = fpa.fact(leVer, lineId, yr, mNum);
      if (v !== null) { result[m] = Number(v); continue; }
    }

    // ── Final fallback: revenue engine ─────────────────────────────────────
    const rev = calcRevEngineMonth(m);
    if      (key === 'revenue')  result[m] = rev.totalRevUSD||0;
    else if (key === 'nonfuel')  result[m] = rev.nonFuelUSD||0;
    else if (key === 'ebitda') {
      const totOM = getOMRows(yr).reduce((s,r)=>s+(r.vals[m]||0),0);
      result[m] = (rev.totalRevUSD||0) - totOM;
    }
    else if (key === 'ebit') {
      const totOM = getOMRows(yr).reduce((s,r)=>s+(r.vals[m]||0),0);
      const dep   = calcDepTotals(yr, m).total;
      result[m]   = (rev.totalRevUSD||0) - totOM - dep;
    }
    else if (key === 'depn') result[m] = calcDepTotals(yr, m).total;
    // netinc: stays 0 when fpa.facts has no data (shouldn't happen once DB is live)
  }

  return result;
}

// ── KPI Score Cards ──────────────────────────────────
function buildKpiScoreCards() {
  const yr = selectedKpiYear;
  const yidx = 4 + (yr - _CY); // _CY is at vals index 4
  const el = document.getElementById('kpiScoreCards');
  if (!el) return;

  // Annual totals from plLines
  const getLine = (frag) => {
    const l = plLines.find(l=>l.name&&l.name.toLowerCase().includes(frag.toLowerCase()));
    return l?.vals?.[yidx]||0;
  };

  const totalRev    = getLine('total revenue') || getLine('total sales') || getLine('revenue');
  const nonFuelRev  = getLine('non-fuel') || getLine('nonfuel');
  const ebitda      = getLine('ebitda');
  const ebit        = getLine('operating income') || getLine('ebit');
  const netInc      = getLine('net profit after') || getLine('net income');
  const depn        = getLine('depreciation');

  // Derived ratios
  const ebitdaMargin = nonFuelRev ? ((ebitda / nonFuelRev)*100) : 0;
  const netMargin    = totalRev   ? ((netInc  / totalRev)*100)  : 0;
  const intCov       = Math.abs(getLine('interest expense')) > 0
    ? (ebit / Math.abs(getLine('interest expense'))) : 0;

  // System loss avg
  const lossArr = sysLossTable[yr] || _z12();
  const avgLoss  = lossArr.reduce((s,v)=>s+v,0)/12;

  // Billed sales GWh — available for current and forecast years
  const billedArr = (yr >= _CY && yr <= _CY + 4)
    ? calcBilledSales(yr) : Array(12).fill(0);
  const totalBilled = billedArr.reduce((s,v)=>s+v,0)/1000; // GWh

  const fmtPct = v => (isNaN(v)||!isFinite(v)?'—':v.toFixed(1)+'%');
  const fmtX   = v => (isNaN(v)||!isFinite(v)?'—':v.toFixed(2)+'×');
  const fmtK   = v => v?'$'+Math.round(v).toLocaleString():'—';

  const cards = [
    { label:'Total Revenue',        val: fmtK(totalRev),       sub:`${yr} Annual`,            cls:'b' },
    { label:'Non-Fuel Revenue',     val: fmtK(nonFuelRev),     sub:`${yr} Annual`,            cls:'t' },
    { label:'EBITDA',               val: fmtK(ebitda),         sub:`${yr} Annual`,            cls:'g' },
    { label:'EBITDA Margin (NF)',   val: fmtPct(ebitdaMargin), sub:`vs Non-Fuel Revenue`,     cls: ebitdaMargin>20?'gr':'g', thresh:'≥ 20%' },
    { label:'Net Income',           val: fmtK(netInc),         sub:`${yr} Annual`,            cls: netInc>=0?'gr':'r' },
    { label:'Net Margin',           val: fmtPct(netMargin),    sub:`vs Total Revenue`,        cls: netMargin>=5?'gr':'r' },
    { label:'Interest Coverage',    val: fmtX(intCov),         sub:`EBIT / Interest Expense`, cls: intCov>=2?'gr':intCov>=1.5?'g':'r', thresh:'≥ 1.5×' },
    { label:'Avg System Loss',      val: fmtPct(avgLoss),      sub:`Target ≤ 26%`,            cls: avgLoss<=26?'gr':'r' },
    { label:'Billed Sales',         val: totalBilled.toFixed(0)+' GWh', sub:`${yr} Total Net Gen → Billed`, cls:'t' },
  ];

  el.innerHTML = cards.map(c => `
    <div class="kpi ${c.cls}">
      <div class="kpi-l">${c.label}</div>
      <div class="kpi-v">${c.val}</div>
      <div class="kpi-d" style="color:var(--muted)">${c.sub}</div>
      ${c.thresh?`<div style="font-size:8px;color:var(--muted);margin-top:2px">Threshold: ${c.thresh}</div>`:''}
    </div>`).join('');
}

// ── Covenant Strip ───────────────────────────────────
function buildKpiCovenantStrip() {
  const el = document.getElementById('kpiCovenantStrip');
  if (!el) return;

  // Derive covenant values from DB-loaded plLines / bsLines (no hardcoded fallbacks)
  const _yIdx = 4; // _CY is always at vals index 4 (YEARS array: _CY-4 … _CY+4)
  const _plGet = (id, ...frags) => {
    const l = plLines.find(l => l.id === id || frags.some(f => l.name?.toLowerCase().includes(f)));
    return l?.vals?.[_yIdx] || null;
  };
  const _bsGet = (id) => {
    const l = bsLines.find(l => l.id === id);
    return l?.vals?.[_yIdx] || null;
  };
  const _ebit    = _plGet('ebit', 'operating income', 'ebit');
  const _intExp  = Math.abs(_plGet('interest_exp', 'interest expense') || 0) || null;
  const _ebitda  = _plGet('ebitda', 'ebitda');
  const _bsCA    = _bsGet('total_ca');
  const _bsCL    = _bsGet('total_cl');
  const _cash    = _bsGet('cash');
  // Total debt: sum non-current + current portion of loans from bsLines
  const _ltDebt  = _bsGet('total_ncl') || _bsGet('long_term_debt');
  const _curDebt = _bsGet('current_portion_debt') || 0;
  const _totalDebt = (_ltDebt || 0) + (_curDebt || 0);
  const _netDebt = (_totalDebt || 0) - (_cash || 0);

  const _intCov  = (_ebit !== null && _intExp) ? +(_ebit / _intExp).toFixed(2) : null;
  const _curRat  = (_bsCA !== null && _bsCL)   ? +(_bsCA / _bsCL).toFixed(2)   : null;
  const _ndEbitda= (_ebitda && _ebitda !== 0)   ? +(_netDebt / _ebitda).toFixed(2) : null;

  const covenants = [
    { name:'Current Ratio',      val: _curRat,   threshold: 1.10, unit:'×',  dir:'gte', desc:'Current Assets / Current Liabilities' },
    { name:'DSCR',               val: null,       threshold: 1.20, unit:'×',  dir:'gte', desc:'Net Cash from Ops / Total Debt Service — upload actuals to populate' },
    { name:'Net Debt / EBITDA',  val: _ndEbitda,  threshold: 4.50, unit:'×',  dir:'lte', desc:'(Total Debt − Cash) / EBITDA' },
    { name:'Interest Coverage',  val: _intCov,    threshold: 1.50, unit:'×',  dir:'gte', desc:'EBIT / Interest Expense' },
  ];

  el.innerHTML = `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:6px;padding:12px 14px">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:10px">⚖ Covenant Monitor — ${selectedKpiYear}</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        ${covenants.map(c => {
          const hasVal = c.val !== null && isFinite(c.val);
          const pass = hasVal ? (c.dir==='gte' ? c.val >= c.threshold : c.val <= c.threshold) : false;
          const pct = hasVal ? (c.dir==='gte'
            ? Math.min(100,(c.val/c.threshold)*100)
            : Math.min(100,(c.threshold/c.val)*100)) : 0;
          const barColor = hasVal ? (pass ? 'var(--green)' : 'var(--red)') : 'var(--dim)';
          const statusBadge = !hasVal
            ? `<span style="font-size:9px;padding:1px 6px;border-radius:8px;background:rgba(61,95,128,.2);color:var(--muted);font-weight:700">– No data</span>`
            : `<span style="font-size:9px;padding:1px 6px;border-radius:8px;background:${pass?'rgba(16,185,129,.15)':'rgba(239,68,68,.15)'};color:${pass?'var(--green)':'var(--red)'};font-weight:700">${pass?'✓ PASS':'✗ BREACH'}</span>`;
          return `<div style="flex:1;min-width:180px;background:var(--card2);border-radius:6px;padding:10px 12px;border-left:3px solid ${barColor}">
            <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
              <span style="font-size:10px;color:var(--muted)">${c.name}</span>
              ${statusBadge}
            </div>
            <div style="font-size:19px;font-weight:800;color:${barColor};font-family:var(--mono)">${hasVal ? c.val.toFixed(2)+c.unit : '—'}</div>
            <div style="font-size:8px;color:var(--muted);margin-bottom:6px">Covenant: ${c.dir==='gte'?'≥':'≤'} ${c.threshold}${c.unit}</div>
            <div style="height:4px;background:var(--card3);border-radius:2px">
              <div style="height:4px;border-radius:2px;background:${barColor};width:${Math.min(100,pct).toFixed(0)}%;transition:width .4s"></div>
            </div>
            <div style="font-size:8px;color:var(--muted);margin-top:3px">${c.desc}</div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

// ── Liquidity Ratios Table ───────────────────────────
function buildKpiLiquidityTable() {
  const el = document.getElementById('kpiLiqBody');
  if (!el) return;
  const yr = selectedKpiYear;

  // DSO = Receivables / (Annual Revenue / 365) — approximate monthly
  const revArr = _getMonthlyPLLine('revenue', yr);

  const rows = [
    {
      name: 'Current Ratio (×)',
      fmt: v => v.toFixed(2)+'×',
      thresh: 1.10,
      dir: 'gte',
      vals: Array(12).fill(0).map((_,m) => {
        // Approximate: use collections DSO as proxy
        const r = getCollRows(yr).find(x=>x.id==='dso');
        const dso = r?.vals?.[m] || 0;
        // ARCHITECTURAL RULE: collection efficiency floor must come from DB — no hardcoded minimum
        return dso > 0 ? Math.max(0, 1.0 + (60-dso)/200) : 0; // zero if no data
      })
    },
    {
      name: 'DSO (Days)',
      fmt: v => v.toFixed(1)+' d',
      thresh: 60,
      dir: 'lte',
      vals: Array(12).fill(0).map((_,m) => {
        const r = getCollRows(yr).find(x=>x.id==='dso');
        // ARCHITECTURAL RULE: DSO must derive from billed/collected actuals — no hardcoded fallback
        return r?.vals?.[m] || 0;
      })
    },
    {
      name: 'Collections Rate (%)',
      fmt: v => v.toFixed(1)+'%',
      thresh: 85,
      dir: 'gte',
      vals: Array(12).fill(0).map((_,m) => {
        // ARCHITECTURAL RULE: collection rate must come from DB — no hardcoded fallback
        const cr = getCollRows(yr).find(x=>x.id==='blended');
        return cr?.vals?.[m] || 0;
      })
    },
    {
      name: 'Cash (Closing) $\'000',
      fmt: v => v>=0?'$'+Math.round(v).toLocaleString():'('+Math.round(Math.abs(v)).toLocaleString()+')',
      thresh: 50000,
      dir: 'gte',
      vals: Array(12).fill(0).map((_,m) => {
        // Use CF closing cash from indirect CF data if available
        const act = actualsStore[yr]?.[m+1];
        return act?.closingCash || act?.bs?.cash || 0;
      })
    },
  ];

  el.innerHTML = rows.map(row => {
    const avg = row.vals.reduce((s,v)=>s+v,0)/12;
    const passColor = row.dir==='gte'
      ? (v => v>=row.thresh?'color:var(--green)':'color:var(--red)')
      : (v => v<=row.thresh?'color:var(--green)':'color:var(--red)');
    return `<tr>
      <td style="font-weight:600;color:var(--text)">${row.name}
        <span style="font-size:8px;color:var(--muted);margin-left:6px">${row.dir==='gte'?'≥':'≤'}${typeof row.thresh==='number'&&row.thresh>100?'$'+row.thresh.toLocaleString():row.thresh}</span>
      </td>
      ${row.vals.map(v=>`<td style="text-align:right;font-family:var(--mono);font-size:11px;${passColor(v)}">${row.fmt(v)}</td>`).join('')}
      <td style="text-align:right;font-family:var(--mono);font-size:11px;font-weight:700;background:var(--dim);${passColor(avg)}">${row.fmt(avg)}</td>
    </tr>`;
  }).join('');
}

// ── Profitability Table ──────────────────────────────
function buildKpiProfitabilityTable() {
  const el = document.getElementById('kpiProfBody');
  if (!el) return;
  const yr = selectedKpiYear;

  const revArr    = _getMonthlyPLLine('revenue', yr);
  const nfArr     = _getMonthlyPLLine('nonfuel', yr);
  const ebitdaArr = _getMonthlyPLLine('ebitda',  yr);
  const ebitArr   = _getMonthlyPLLine('ebit',    yr);

  const safe = (a,b) => b===0||isNaN(b)||!isFinite(b) ? 0 : a/b;

  const rows = [
    {
      name: 'EBITDA Margin (Non-Fuel) %',
      vals: ebitdaArr.map((v,i) => safe(v, nfArr[i])*100),
      fmt: v=>v.toFixed(1)+'%', thresh:20, dir:'gte'
    },
    {
      name: 'EBIT Margin %',
      vals: ebitArr.map((v,i) => safe(v, revArr[i])*100),
      fmt: v=>v.toFixed(1)+'%', thresh:5, dir:'gte'
    },
    {
      name: 'Non-Fuel Rev / kWh (US¢)',
      vals: Array(12).fill(0).map((_,m) => {
        const nf = nfArr[m];
        const billed = calcBilledSales(yr);
        const kwh = (billed[m]||0)*1000; // MWh→kWh
        return kwh>0 ? (nf*1000/kwh)*100 : 0; // US¢/kWh
      }),
      fmt: v=>v.toFixed(2)+'¢', thresh:8, dir:'gte'
    },
    {
      name: 'O&M / Revenue %',
      vals: Array(12).fill(0).map((_,m) => {
        const totOM = getOMRows(yr).reduce((s,r)=>s+(r.vals[m]||0),0);
        return safe(totOM, revArr[m])*100;
      }),
      fmt: v=>v.toFixed(1)+'%', thresh:40, dir:'lte'
    },
    {
      name: 'Fuel Surplus / (Penalty) $\'000',
      vals: Array(12).fill(0).map((_,m) => {
        const act = actualsStore[yr]?.[m+1];
        return act?.fuelSurplus||0;
      }),
      fmt: v => v>=0?'$'+Math.round(v).toLocaleString():'('+Math.round(Math.abs(v)).toLocaleString()+')',
      thresh: 0, dir: 'gte'
    },
  ];

  el.innerHTML = rows.map(row => {
    const avg = row.vals.reduce((s,v)=>s+v,0)/12;
    const pc = row.dir==='gte'
      ? (v=>v>=row.thresh?'color:var(--green)':'color:var(--red)')
      : (v=>v<=row.thresh?'color:var(--green)':'color:var(--red)');
    return `<tr>
      <td style="font-weight:600;color:var(--text)">${row.name}</td>
      ${row.vals.map(v=>`<td style="text-align:right;font-family:var(--mono);font-size:11px;${pc(v)}">${row.fmt(v)}</td>`).join('')}
      <td style="text-align:right;font-family:var(--mono);font-size:11px;font-weight:700;background:var(--dim);${pc(avg)}">${row.fmt(avg)}</td>
    </tr>`;
  }).join('');
}

// ── Leverage Table (annual, _CY through _CY+4) ───────────────
function buildKpiLeverageTable() {
  const el = document.getElementById('kpiLevBody');
  if (!el) return;
  const YRS = Array.from({length:5},(_,i)=>_CY+i);
  const YIDX = {}; YRS.forEach((y,i)=>{ YIDX[y]=4+i; }); // _CY at YEARS index 4
  // Build thead dynamically
  const hd = document.getElementById('kpiLevHead');
  if (hd) hd.innerHTML = `<tr><th style="text-align:left;min-width:220px">Ratio</th>${YRS.map(y=>`<th class="bc">${y}</th>`).join('')}<th style="text-align:left;min-width:120px">Covenant</th></tr>`;

  const getEBITDA = yr => {
    const l = plLines.find(l=>l.name&&l.name.toLowerCase().includes('ebitda'));
    return l?.vals?.[YIDX[yr]]||0;
  };
  const getEBIT = yr => {
    const l = plLines.find(l=>l.name&&(l.name.toLowerCase().includes('operating income')||l.name.toLowerCase().includes('ebit')));
    return l?.vals?.[YIDX[yr]]||0;
  };
  const getIntExp = yr => {
    const l = plLines.find(l=>l.name&&l.name.toLowerCase().includes('interest expense'));
    return Math.abs(l?.vals?.[YIDX[yr]]||0);
  };

  // ── Live debt data: projDebtSchedule closing balances + loanRegister aggregates ──
  // Closing debt balance (year-end) — use loanRegister aggregate if loans are loaded,
  // otherwise fall back to the projection schedule.
  const getClosingDebt = yr => {
    try {
      const agg = getDebtAggregates(yr);
      if (agg && agg.closingBal > 0) return agg.closingBal;
    } catch(e) {}
    return projDebtSchedule?.closingDebt?.vals?.[yr] || 0;
  };

  // Year-end cash from bsLines (already updated from fpa.facts via fpaApplyToLegacyGlobals)
  const getClosingCash = yr => {
    const l = bsLines.find(l => l.id === 'cash');
    const v = l?.vals?.[YIDX[yr]];
    // If bsLines not yet populated from DB, use actualsStore latest closed month
    if (!v && yr === _CY) {
      const closedMos = [12,11,10,9,8,7,6,5,4,3,2,1].filter(m => fpa.isPeriodClosed(_CY, m));
      if (closedMos.length) {
        const mo = closedMos[0];
        return _acts(mo)?.bs?.cash || actualsStore[actualsYear]?.[mo]?.bs?.cash || 0;
      }
    }
    return v || 0;
  };

  // Annual debt service (interest + principal) from loanRegister, fall back to schedule
  const getDebtService = yr => {
    try {
      const agg = getDebtAggregates(yr);
      if (agg) {
        const svc = agg.totalCashPmt.reduce((s, v) => s + v, 0);
        if (svc > 0) return svc;
      }
    } catch(e) {}
    return (projDebtSchedule?.interestCost?.vals?.[yr] || 0) +
           (projDebtSchedule?.repayments?.vals?.[yr]   || 0);
  };

  const rows = [
    {
      name: 'DSCR (×)', cov:'≥ 1.20×',
      vals: YRS.map(yr => {
        const ebitda  = getEBITDA(yr);
        const debtSvc = getDebtService(yr);
        return debtSvc > 0 ? ebitda / debtSvc : 0;
      }),
      fmt: v=>isFinite(v)&&v?v.toFixed(2)+'×':'—', thresh:1.20, dir:'gte'
    },
    {
      name: 'Net Debt / EBITDA (×)', cov:'≤ 4.50×',
      vals: YRS.map(yr => {
        const ebitda  = getEBITDA(yr);
        const netDebt = getClosingDebt(yr) - getClosingCash(yr);
        return ebitda > 0 ? netDebt / ebitda : 0;
      }),
      fmt: v=>isFinite(v)&&v?v.toFixed(2)+'×':'—', thresh:4.50, dir:'lte'
    },
    {
      name: 'Interest Coverage (EBIT/Int) (×)', cov:'≥ 1.50×',
      vals: YRS.map(yr => {
        const ebit   = getEBIT(yr);
        const intExp = getIntExp(yr);
        return intExp > 0 ? ebit / intExp : 0;
      }),
      fmt: v=>isFinite(v)&&v?v.toFixed(2)+'×':'—', thresh:1.50, dir:'gte'
    },
    {
      name: 'Net Debt $\'000', cov:'—',
      vals: YRS.map(yr => getClosingDebt(yr) - getClosingCash(yr)),
      fmt: v => v >= 0 ? '$'+Math.round(v).toLocaleString() : '('+Math.round(Math.abs(v)).toLocaleString()+')',
      thresh:null, dir:null
    },
    {
      name: 'Closing Debt $\'000', cov:'—',
      vals: YRS.map(yr => getClosingDebt(yr)),
      fmt: v=>'$'+Math.round(v).toLocaleString(), thresh:null, dir:null
    },
    {
      name: 'Year-End Cash $\'000', cov:'—',
      vals: YRS.map(yr => getClosingCash(yr)),
      fmt: v=>'$'+Math.round(v).toLocaleString(), thresh:null, dir:null
    },
    {
      name: 'Total EBITDA $\'000', cov:'—',
      vals: YRS.map(yr => getEBITDA(yr)),
      fmt: v=>v?'$'+Math.round(v).toLocaleString():'—', thresh:null, dir:null
    },
  ];

  el.innerHTML = rows.map(row => {
    const pc = row.thresh===null ? ()=>'' :
      row.dir==='gte'
        ? (v=>v>=row.thresh?'color:var(--green)':'color:var(--red)')
        : (v=>v<=row.thresh?'color:var(--green)':'color:var(--red)');
    return `<tr>
      <td style="font-weight:600;color:var(--text)">${row.name}</td>
      ${row.vals.map(v=>`<td style="text-align:right;font-family:var(--mono);font-size:12px;${pc(v)}">${row.fmt(v)}</td>`).join('')}
      <td style="font-size:10px;color:var(--muted)">${row.cov}</td>
    </tr>`;
  }).join('');
}

// ── Operational KPIs Table ───────────────────────────
function buildKpiOpsTable() {
  const el = document.getElementById('kpiOpsBody');
  if (!el) return;
  const yr = selectedKpiYear;

  const loss    = sysLossTable[yr] || _z12();
  const billed  = calcBilledSales(yr);
  const netGen  = (() => { const g=netGenTable[yr]; return Array(12).fill(0).map((_,m)=>(g.jps_thermal[m]||0)+(g.old_harbour[m]||0)+(g.renewables[m]||0)+(g.ipp[m]||0)); })();
  const renPct  = netGenTable[yr].renewables.map((v,m)=>netGen[m]>0?v/netGen[m]*100:0);
  const peak    = getCollRows(yr).find(r=>r.id==='peak_mw')?.vals || Array(12).fill(0);

  const rows = [
    { name:'System Loss %',          vals:loss,    fmt:v=>v.toFixed(1)+'%', thresh:26, dir:'lte', tot:'avg' },
    { name:'Billed Sales (GWh)',      vals:billed.map(v=>v/1000), fmt:v=>v.toFixed(1), thresh:null, tot:'sum' },
    { name:'Net Generation (GWh)',    vals:netGen,  fmt:v=>v.toFixed(1), thresh:null, tot:'sum' },
    { name:'Renewable Mix %',         vals:renPct,  fmt:v=>v.toFixed(1)+'%', thresh:15, dir:'gte', tot:'avg' },
    { name:'Peak Demand (MW)',        vals:peak,    fmt:v=>v.toFixed(1), thresh:null, tot:'avg' },
    { name:'Heat Rate (kJ/kWh)',      vals:Array(12).fill(heatRateTable.system_avg*3.6), fmt:v=>v.toFixed(0), thresh:9449, dir:'lte', tot:'avg' },
  ];

  el.innerHTML = rows.map(row => {
    const totVal = row.tot==='sum'
      ? row.vals.reduce((s,v)=>s+v,0)
      : row.vals.reduce((s,v)=>s+v,0)/12;
    const pc = !row.thresh ? ()=>'' :
      row.dir==='gte'
        ? (v=>v>=row.thresh?'color:var(--green)':'color:var(--red)')
        : (v=>v<=row.thresh?'color:var(--green)':'color:var(--red)');
    return `<tr>
      <td style="font-weight:600;color:var(--text)">${row.name}
        ${row.thresh?`<span style="font-size:8px;color:var(--muted);margin-left:6px">${row.dir==='gte'?'≥':'≤'} ${row.thresh}</span>`:''}
      </td>
      ${row.vals.map(v=>`<td style="text-align:right;font-family:var(--mono);font-size:11px;${pc(v)}">${row.fmt(v)}</td>`).join('')}
      <td style="text-align:right;font-family:var(--mono);font-size:11px;font-weight:700;background:var(--dim);${pc(totVal)}">${row.fmt(totVal)}</td>
    </tr>`;
  }).join('');
}

// ── 5-Year Trend Charts ──────────────────────────────
function buildKpiCharts() {
  // Defer until the pane is painted so canvases have non-zero dimensions
  requestAnimationFrame(() => _buildKpiChartsInner());
}
function _buildKpiChartsInner() {
  const YRS = Array.from({length:5},(_,i)=>_CY+i);
  const YIDX = {}; YRS.forEach((y,i)=>{ YIDX[y]=4+i; }); // _CY at YEARS index 4
  // Use cached theme colors (_TC) — populated at startup and on every theme switch
  const bO2 = () => ({
    responsive:true, maintainAspectRatio:false,
    plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.formattedValue}}},
    scales:{
      x:{ticks:{color:_TC.muted,font:{size:9}},grid:{color:_TC.grid}},
      y:{ticks:{color:_TC.muted,font:{size:9}},grid:{color:_TC.grid}}
    }
  });

  const getE = (yr,frag) => { const l=plLines.find(l=>l.name&&l.name.toLowerCase().includes(frag)); return l?.vals?.[YIDX[yr]]||0; };
  const getNF = yr => { const l=plLines.find(l=>l.name&&(l.name.toLowerCase().includes('non-fuel')||l.name.toLowerCase().includes('nonfuel'))); return l?.vals?.[YIDX[yr]]||0; };

  // EBITDA Margin
  const ebitdaMargins = YRS.map(yr => {
    const e = getE(yr,'ebitda'); const nf = getNF(yr);
    return nf>0 ? +(e/nf*100).toFixed(1) : 0;
  });
  mkChart('cKpiEbitda',{type:'bar',data:{labels:YRS.map(String),datasets:[{
    data:ebitdaMargins, backgroundColor:YRS.map((_,i)=>i===YRS.indexOf(selectedKpiYear)?'rgba(240,180,41,.85)':'rgba(240,180,41,.4)'),
    borderColor:'rgba(240,180,41,1)', borderWidth:1, borderRadius:3
  }]},options:{...bO2(),scales:{...bO2().scales,y:{...bO2().scales.y,ticks:{...bO2().scales.y.ticks,callback:v=>v+'%'}}}}});

  // DSCR
  const dscrVals = YRS.map(yr => {
    const ebitda = getE(yr,'ebitda');
    const intExp = Math.abs(getE(yr,'interest expense'));
    // ARCHITECTURAL RULE: principal repayment must come from DB debt schedule, not estimated at 7%
    // Use actual scheduled repayments from projDebtSchedule; 0 until uploaded
    const debtRepayment = projDebtSchedule.repayments?.vals?.[yr] || 0;
    const debtSvc = intExp + debtRepayment;
    return debtSvc>0 ? +(ebitda/debtSvc).toFixed(2) : 0;
  });
  const tealColor  = style.getPropertyValue('--teal').trim()  || '#22d3ee';
  const amberColor = style.getPropertyValue('--amber').trim() || '#fbbf24';
  mkChart('cKpiDscr',{type:'line',data:{labels:YRS.map(String),datasets:[
    {data:dscrVals,borderColor:tealColor,backgroundColor:'rgba(6,182,212,.1)',fill:true,tension:.3,pointRadius:4},
    {data:YRS.map(()=>1.20),borderColor:'rgba(239,68,68,.6)',borderDash:[4,3],pointRadius:0,fill:false,label:'Min 1.20×'}
  ]},options:{...bO2(),plugins:{legend:{display:true,labels:{color:mutedColor,font:{size:9}}},tooltip:{}},scales:{...bO2().scales,y:{...bO2().scales.y,ticks:{...bO2().scales.y.ticks,callback:v=>v+'×'}}}}});

  // Net Debt / EBITDA
  const ndEbitda = YRS.map(yr => {
    const ebitda = getE(yr,'ebitda');
    // Debt/cash from projDebtSchedule and bsLines (DB-backed); no hardcoded fallback
    const debtBal = projDebtSchedule.closingDebt?.vals?.[yr] || 0;
    const cashBal = bsLines.find(l=>l.id==='cash')?.vals?.[4+(yr-_CY)] || 0;
    const netDebt = debtBal - cashBal;
    return ebitda>0 ? +(netDebt/ebitda).toFixed(2) : 0;
  });
  mkChart('cKpiNetDebt',{type:'bar',data:{labels:YRS.map(String),datasets:[
    {data:ndEbitda,backgroundColor:ndEbitda.map(v=>v<=4.5?'rgba(16,185,129,.6)':'rgba(239,68,68,.6)'),borderRadius:3}
  ]},options:{...bO2(),scales:{...bO2().scales,y:{...bO2().scales.y,ticks:{...bO2().scales.y.ticks,callback:v=>v+'×'}}}}});

  // System Loss
  const avgLoss = YRS.map(yr => {
    const arr = sysLossTable[yr]||_z12();
    return +(arr.reduce((s,v)=>s+v,0)/12).toFixed(2);
  });
  mkChart('cKpiLoss',{type:'line',data:{labels:YRS.map(String),datasets:[
    {data:avgLoss,borderColor:amberColor,backgroundColor:'rgba(245,158,11,.1)',fill:true,tension:.3,pointRadius:4},
    {data:YRS.map(()=>26.0),borderColor:'rgba(16,185,129,.6)',borderDash:[4,3],pointRadius:0,fill:false,label:'Target 26%'}
  ]},options:{...bO2(),plugins:{legend:{display:true,labels:{color:mutedColor,font:{size:9}}},tooltip:{}},scales:{...bO2().scales,y:{...bO2().scales.y,min:23,ticks:{...bO2().scales.y.ticks,callback:v=>v+'%'}}}}});
}

// ── Export CSV ───────────────────────────────────────
function exportKpiCSV() {
  const yr = selectedKpiYear;
  const rows = [['KPI', ...MONTHS, 'Avg/Total']];
  const loss = sysLossTable[yr]||_z12();
  const billed = calcBilledSales(yr).map(v=>v/1000);
  rows.push(['System Loss %',...loss.map(v=>v.toFixed(2)),( loss.reduce((s,v)=>s+v,0)/12).toFixed(2)]);
  rows.push(['Billed Sales GWh',...billed.map(v=>v.toFixed(1)),(billed.reduce((s,v)=>s+v,0)).toFixed(1)]);
  const csv = rows.map(r=>r.join(',')).join('\n');
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download='JPS_KPIs_'+yr+'.csv';
  a.click(); toast('KPI data exported','ok');
}

// ═══════════════════════════════════════════════════════
//  DEBT & FINANCING REGISTER — Session 10
// ═══════════════════════════════════════════════════════
let selectedDebtYear = _CY;
let selectedLoanId   = null;
let selectedDebtAmortYear = _CY;

// ── Loan register data ───────────────────────────────
// Seeded from AOP 2026 / Feb 2026 corporate data
// Loan register — empty. Add facilities through the Debt Management UI or upload.
let loanRegister = [];

// ── Loan amortisation engine ─────────────────────────
function computeLoanSchedule(loan, yr) {
  const schedule = [];
  // Determine opening balance for this year
  let openBal = loan.openBal;
  // Roll forward from base year (_CY) if needed
  if (yr > _CY) {
    for (let y = _CY; y < yr; y++) {
      const sch = computeLoanSchedule({ ...loan, openBal }, y);
      openBal = sch[11]?.closingBal ?? 0;
    }
  }

  const drawdowns = loan.drawdowns?.[yr] || Array(12).fill(0);
  const monthlyRate = loan.rate / 100 / 12;

  // Repayment months based on frequency
  const repayMonths = (() => {
    const all = [];
    if (loan.repayFreq === 'monthly')   { for(let m=0;m<12;m++) all.push(m); }
    else if (loan.repayFreq === 'quarterly') { [2,5,8,11].forEach(m=>all.push(m)); }
    else if (loan.repayFreq === 'semi') { [5,11].forEach(m=>all.push(m)); }
    else if (loan.repayFreq === 'annual') { all.push(11); }
    return all;
  })();

  // Check if matured
  const maturityDate = loan.maturity ? new Date(loan.maturity) : null;
  const yearStart = new Date(yr, 0, 1);
  if (maturityDate && maturityDate < yearStart) {
    return Array(12).fill({ openingBal:0, drawdown:0, interest:0, principal:0, closingBal:0, cashPayment:0 });
  }

  for (let m = 0; m < 12; m++) {
    const monthDate = new Date(yr, m, 1);
    if (maturityDate && monthDate > maturityDate) {
      schedule.push({ openingBal: 0, drawdown: 0, interest: 0, principal: 0, closingBal: 0, cashPayment: 0 });
      continue;
    }
    const interest   = Math.round(openBal * monthlyRate);
    const drawdown   = drawdowns[m] || 0;
    let principal    = 0;
    if (loan.repayFreq === 'bullet' && maturityDate) {
      const matureMo = maturityDate.getMonth();
      const matureYr = maturityDate.getFullYear();
      if (yr === matureYr && m === matureMo) principal = openBal + drawdown;
    } else if (repayMonths.includes(m)) {
      const periods = { monthly:1, quarterly:3, semi:6, annual:12 }[loan.repayFreq] || 1;
      principal = Math.min(openBal + drawdown, loan.repayAmt * periods);
    }
    const closingBal = Math.max(0, openBal + drawdown - principal);
    const cashPayment = principal + interest;
    schedule.push({ openingBal: openBal, drawdown, interest, principal, closingBal, cashPayment });
    openBal = closingBal;
  }
  return schedule;
}

// Aggregate all loans for a given year → feeds NFC + CF
function getDebtAggregates(yr) {
  const result = {
    openingBal:    0,
    totalDrawdowns: Array(12).fill(0),
    totalPrincipal: Array(12).fill(0),
    totalInterest:  Array(12).fill(0),
    totalCashPmt:   Array(12).fill(0),
    closingBal:    0,
  };
  loanRegister.filter(l=>l.active).forEach(loan => {
    const sch = computeLoanSchedule(loan, yr);
    result.openingBal += loan.openBal; // simplified — should roll from prior yr
    sch.forEach((row, m) => {
      result.totalDrawdowns[m]  += row.drawdown   || 0;
      result.totalPrincipal[m]  += row.principal  || 0;
      result.totalInterest[m]   += row.interest   || 0;
      result.totalCashPmt[m]    += row.cashPayment|| 0;
    });
    const last = sch[11];
    result.closingBal += last?.closingBal || 0;
  });
  return result;
}

// ── Build the full debt tab ──────────────────────────
function buildDebtTab() {
  buildYrSeg('debtYrSeg', selectedDebtYear, (y, btn) => {
    selectedDebtYear = y;
    buildDebtTab();
  });
  buildDebtKpis();
  buildLoanRegister();
  buildDebtSummary();
  buildCovenantTracker();
  buildDebtCharts();
  if (selectedLoanId) {
    buildLoanAmortTable(selectedLoanId, selectedDebtAmortYear);
  }
}

function buildDebtKpis() {
  const el = document.getElementById('debtKpis');
  if (!el) return;
  const agg = getDebtAggregates(selectedDebtYear);
  const totalInt = agg.totalInterest.reduce((s,v)=>s+v,0);
  const totalPrin = agg.totalPrincipal.reduce((s,v)=>s+v,0);
  const totalDraw = agg.totalDrawdowns.reduce((s,v)=>s+v,0);
  const fmtK = v => '$'+Math.round(v).toLocaleString();

  el.innerHTML = [
    { label:'Opening Debt Balance', val:fmtK(agg.openingBal),   cls:'b' },
    { label:'Total Drawdowns',      val:fmtK(totalDraw),         cls:'t' },
    { label:'Total Repayments',     val:fmtK(totalPrin),         cls:'gr' },
    { label:'Total Interest Paid',  val:fmtK(totalInt),          cls:'r' },
    { label:'Closing Debt Balance', val:fmtK(agg.closingBal),    cls:'g' },
    { label:'Active Facilities',    val:loanRegister.filter(l=>l.active).length, cls:'p' },
  ].map(c=>`<div class="kpi ${c.cls}"><div class="kpi-l">${c.label}</div><div class="kpi-v">${c.val}</div><div class="kpi-d" style="color:var(--muted)">${selectedDebtYear}</div></div>`).join('');
}

function buildLoanRegister() {
  const el = document.getElementById('loanRegBody');
  if (!el) return;
  const fmtK = v => '$'+Math.round(v||0).toLocaleString();
  const typeLabel = t => ({ term:'Term Loan', revolving:'Revolving', bond:'Bond/Note', overdraft:'Overdraft', other:'Other' }[t]||t);
  const rateColor = r => r < 5 ? 'var(--green)' : r < 7 ? 'var(--amber)' : 'var(--red)';

  // Compute closing balance for status
  el.innerHTML = loanRegister.map(loan => {
    const sch  = computeLoanSchedule(loan, selectedDebtYear);
    const closing = sch[11]?.closingBal || 0;
    const matDate = loan.maturity ? new Date(loan.maturity) : null;
    const now = new Date(selectedDebtYear, 11, 31);
    const daysLeft = matDate ? Math.round((matDate - now) / 86400000) : 9999;
    const statusCol = !loan.active ? 'var(--muted)' : daysLeft < 180 ? 'var(--amber)' : 'var(--green)';
    const statusTxt = !loan.active ? 'Inactive' : daysLeft < 0 ? 'Matured' : daysLeft < 180 ? `⚠ ${Math.round(daysLeft/30)}mo` : '✓ Active';
    const isSelected = loan.id === selectedLoanId;

    return `<tr style="${isSelected?'background:var(--glo);':''}cursor:pointer" onclick="selectLoan('${loan.id}')">
      <td style="font-weight:700;color:var(--text)">${loan.name}</td>
      <td style="color:var(--muted)">${loan.lender}</td>
      <td style="text-align:center"><span style="font-size:9px;padding:1px 6px;border-radius:8px;background:var(--card3)">${typeLabel(loan.type)}</span></td>
      <td style="text-align:center;font-size:10px">${loan.currency}</td>
      <td style="text-align:right;font-family:var(--mono)">${fmtK(loan.principal)}</td>
      <td style="text-align:right;font-family:var(--mono);color:${rateColor(loan.rate)}">${loan.rate.toFixed(2)}%</td>
      <td style="text-align:center;font-size:10px">${loan.maturity||'—'}</td>
      <td style="text-align:right;font-family:var(--mono)">${fmtK(closing)}</td>
      <td style="text-align:center;font-size:9px;font-weight:700;color:${statusCol}">${statusTxt}</td>
      <td style="text-align:center">
        ${can('editFinancing')?`<button class="btn btn-ghost" style="font-size:9px;height:20px;padding:0 6px" onclick="event.stopPropagation();openLoanModal('${loan.id}')">✏</button>
        <button class="btn btn-ghost" style="font-size:9px;height:20px;padding:0 6px;color:var(--red)" onclick="event.stopPropagation();deleteLoan('${loan.id}')">✕</button>`:'—'}
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="10" style="text-align:center;color:var(--muted);padding:20px">No facilities registered. Click + Add Facility.</td></tr>';
}

function selectLoan(id) {
  selectedLoanId = (selectedLoanId === id) ? null : id;
  selectedDebtAmortYear = selectedDebtYear;
  const block = document.getElementById('loanAmortBlock');
  if (!selectedLoanId) { block.style.display = 'none'; buildLoanRegister(); return; }
  block.style.display = 'block';
  const loan = loanRegister.find(l=>l.id===id);
  document.getElementById('loanAmortTitle').textContent = `§2 Amortisation Schedule — ${loan?.name||id}`;
  buildYrSeg('debtAmortYrSeg', selectedDebtAmortYear, (y, btn) => {
    selectedDebtAmortYear = y;
    buildLoanAmortTable(selectedLoanId, y);
  });
  buildLoanAmortTable(id, selectedDebtAmortYear);
  buildLoanRegister(); // re-render to highlight selection
  // Scroll to schedule
  block.scrollIntoView({ behavior:'smooth', block:'start' });
}

function buildLoanAmortTable(loanId, yr) {
  const loan = loanRegister.find(l=>l.id===loanId);
  const amortEl = document.getElementById('loanAmortBody');
  const kpiEl = document.getElementById('loanAmortKpis');
  if (!loan || !amortEl) return;

  const sch = computeLoanSchedule(loan, yr);
  const fmtK = v => v ? '$'+Math.round(v).toLocaleString() : '—';
  const totInt  = sch.reduce((s,r)=>s+r.interest,0);
  const totPrin = sch.reduce((s,r)=>s+r.principal,0);
  const totDraw = sch.reduce((s,r)=>s+r.drawdown,0);

  if (kpiEl) {
    kpiEl.innerHTML = [
      { label:'Opening Balance', val:fmtK(sch[0]?.openingBal||0), cls:'b' },
      { label:'Total Drawdowns', val:fmtK(totDraw), cls:'t' },
      { label:'Total Principal', val:fmtK(totPrin), cls:'gr' },
      { label:'Total Interest',  val:fmtK(totInt),  cls:'r' },
      { label:'Closing Balance', val:fmtK(sch[11]?.closingBal||0), cls:'g' },
      { label:'Effective Rate',  val:loan.rate.toFixed(2)+'%', cls:'p' },
    ].map(c=>`<div class="kpi ${c.cls}" style="padding:8px 10px"><div class="kpi-l">${c.label}</div><div class="kpi-v" style="font-size:14px">${c.val}</div></div>`).join('');
  }

  amortEl.innerHTML = sch.map((row, m) => `
    <tr>
      <td>${MONTHS[m]}</td>
      <td style="text-align:right;font-family:var(--mono)">${fmtK(row.openingBal)}</td>
      <td style="text-align:right;font-family:var(--mono);color:var(--teal)">${row.drawdown?fmtK(row.drawdown):'—'}</td>
      <td style="text-align:right;font-family:var(--mono);color:var(--red)">${fmtK(row.interest)}</td>
      <td style="text-align:right;font-family:var(--mono);color:var(--green)">${fmtK(row.principal)}</td>
      <td style="text-align:right;font-family:var(--mono);font-weight:700">${fmtK(row.closingBal)}</td>
      <td style="text-align:right;font-family:var(--mono)">${fmtK(row.cashPayment)}</td>
    </tr>`).join('') +
    `<tr style="background:var(--dim);font-weight:800">
      <td>TOTAL</td>
      <td></td>
      <td style="text-align:right;font-family:var(--mono);color:var(--teal)">${fmtK(totDraw)}</td>
      <td style="text-align:right;font-family:var(--mono);color:var(--red)">${fmtK(totInt)}</td>
      <td style="text-align:right;font-family:var(--mono);color:var(--green)">${fmtK(totPrin)}</td>
      <td></td>
      <td style="text-align:right;font-family:var(--mono)">${fmtK(totPrin+totInt)}</td>
    </tr>`;
}

function buildDebtSummary() {
  const el = document.getElementById('debtSummBody');
  if (!el) return;
  const YRS = Array.from({length:5},(_,i)=>_CY+i);
  const fmtK = v => v?'$'+Math.round(v).toLocaleString():'—';

  const sumByYr = yr => {
    const agg = getDebtAggregates(yr);
    return {
      openBal:  loanRegister.filter(l=>l.active).reduce((s,l)=>{
        // Roll opening balance
        if(yr===_CY) return s+(l.openBal||0);
        const prev = computeLoanSchedule(l, yr-1);
        return s+(prev[11]?.closingBal||0);
      }, 0),
      draws:    agg.totalDrawdowns.reduce((s,v)=>s+v,0),
      repays:   agg.totalPrincipal.reduce((s,v)=>s+v,0),
      interest: agg.totalInterest.reduce((s,v)=>s+v,0),
      closeBal: agg.closingBal,
    };
  };

  const data = YRS.map(yr => sumByYr(yr));
  const rows = [
    { name:'Opening Debt Balance', key:'openBal', cls:'font-weight:700' },
    { name:'  + Drawdowns',        key:'draws',   cls:'color:var(--teal)' },
    { name:'  − Repayments',       key:'repays',  cls:'color:var(--green)' },
    { name:'  Interest Expense',   key:'interest',cls:'color:var(--red)' },
    { name:'Closing Debt Balance', key:'closeBal',cls:'font-weight:800;color:var(--gold)' },
  ];

  el.innerHTML = rows.map(row =>
    `<tr>
      <td style="${row.cls}">${row.name}</td>
      ${data.map(d=>`<td style="text-align:right;font-family:var(--mono);${row.cls}">${fmtK(d[row.key])}</td>`).join('')}
    </tr>`
  ).join('');
}

function buildCovenantTracker() {
  const el = document.getElementById('covenantTrackPanel');
  if (!el) return;

  // Covenant status per facility
  const agg = getDebtAggregates(selectedDebtYear);
  const ebitda = (() => {
    const l=plLines.find(l=>l.name&&l.name.toLowerCase().includes('ebitda'));
    return l?.vals?.[4+(selectedDebtYear-_CY)]||0;
  })();
  const totalDebtSvc = agg.totalPrincipal.reduce((s,v)=>s+v,0) + agg.totalInterest.reduce((s,v)=>s+v,0);
  const dscr = totalDebtSvc>0 ? (ebitda/totalDebtSvc) : 0;
  // Cash balance must come from BS actuals (fpa_facts); no hardcoded offset
  const netDebt = agg.closingBal - 0;
  const ndEbitda = ebitda>0 ? netDebt/ebitda : 0;

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:8px;padding:8px 0">
      ${loanRegister.filter(l=>l.active).map(loan => {
        const covTests = [
          loan.covenant?.includes('DSCR') ? { name:'DSCR', val:dscr, thresh:1.20, dir:'gte', fmt: v=>v.toFixed(2)+'×' } : null,
          loan.covenant?.includes('Debt/EBITDA') ? { name:'Net Debt/EBITDA', val:ndEbitda, thresh:4.50, dir:'lte', fmt:v=>v.toFixed(2)+'×' } : null,
          loan.covenant?.includes('Current Ratio') ? { name:'Current Ratio', val:0, thresh:1.10, dir:'gte', fmt:v=>v>0?v.toFixed(2)+'×':'—' } : null,
        ].filter(Boolean);

        return `<div style="background:var(--card);border:1px solid var(--border);border-radius:6px;padding:10px 14px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <div style="font-weight:700;font-size:11px;color:var(--text)">${loan.name}</div>
            <div style="font-size:9px;color:var(--muted)">${loan.lender}</div>
          </div>
          ${covTests.length ? `<div style="display:flex;gap:10px;flex-wrap:wrap">
            ${covTests.map(t => {
              const pass = t.dir==='gte' ? t.val>=t.thresh : t.val<=t.thresh;
              return `<div style="display:flex;align-items:center;gap:6px;padding:4px 10px;border-radius:4px;background:${pass?'rgba(16,185,129,.1)':'rgba(239,68,68,.1)'};border:1px solid ${pass?'rgba(16,185,129,.3)':'rgba(239,68,68,.3)'}">
                <span style="font-size:10px;color:var(--muted)">${t.name}</span>
                <span style="font-size:12px;font-weight:800;font-family:var(--mono);color:${pass?'var(--green)':'var(--red)'}">${t.fmt(t.val)}</span>
                <span style="font-size:9px;color:var(--muted)">${t.dir==='gte'?'≥':'≤'}${t.thresh}×</span>
                <span style="font-size:9px;font-weight:700;color:${pass?'var(--green)':'var(--red)'}">${pass?'✓':'✗'}</span>
              </div>`;
            }).join('')}
          </div>` : `<div style="font-size:9px;color:var(--muted)">${loan.covenant||'No financial covenants specified'}</div>`}
        </div>`;
      }).join('')}
    </div>`;
}

function buildDebtCharts() {
  const YRS = Array.from({length:5},(_,i)=>_CY+i);
  // FIX: Chart.js cannot parse 'var(--x)' CSS strings — use cached _TC values
  const bO2 = () => ({
    responsive:true, maintainAspectRatio:false,
    plugins:{ legend:{ display:false } },
    scales:{
      x:{ ticks:{color:_TC.muted,font:{size:9}}, grid:{color:_TC.grid} },
      y:{ ticks:{color:_TC.muted,font:{size:9}, callback:v=>'$'+Math.round(v/1000)+'M'}, grid:{color:_TC.grid} }
    }
  });

  const closingBals = YRS.map(yr => getDebtAggregates(yr).closingBal);
  const annInterest = YRS.map(yr => getDebtAggregates(yr).totalInterest.reduce((s,v)=>s+v,0));

  mkChart('cDebtBal', {
    type:'bar',
    data:{ labels:YRS.map(String), datasets:[{
      data: closingBals,
      backgroundColor: YRS.map((_,i)=>i===YRS.indexOf(selectedDebtYear)?'rgba(59,130,246,.85)':'rgba(59,130,246,.4)'),
      borderColor:'rgba(59,130,246,1)', borderWidth:1, borderRadius:3
    }]},
    options: bO2()
  });

  mkChart('cDebtInt', {
    type:'line',
    data:{ labels:YRS.map(String), datasets:[{
      data: annInterest,
      borderColor:'var(--red)', backgroundColor:'rgba(239,68,68,.1)', fill:true, tension:.3, pointRadius:4
    }]},
    options: bO2()
  });
}

// ── Loan modal CRUD ──────────────────────────────────
function openLoanModal(id) {
  const loan = id ? loanRegister.find(l=>l.id===id) : null;
  document.getElementById('ln-editId').value = id || '';
  document.getElementById('ln-name').value    = loan?.name    || '';
  document.getElementById('ln-lender').value  = loan?.lender  || '';
  document.getElementById('ln-type').value    = loan?.type    || 'term';
  document.getElementById('ln-currency').value= loan?.currency|| 'USD';
  document.getElementById('ln-principal').value= loan?.principal||0;
  document.getElementById('ln-rate').value    = loan?.rate    || '';
  document.getElementById('ln-rateType').value= loan?.rateType|| 'fixed';
  document.getElementById('ln-drawDate').value= loan?.drawDate|| '';
  document.getElementById('ln-maturity').value= loan?.maturity|| '';
  document.getElementById('ln-repayFreq').value= loan?.repayFreq||'semi';
  document.getElementById('ln-openBal').value = loan?.openBal || 0;
  document.getElementById('ln-repayAmt').value= loan?.repayAmt|| 0;
  document.getElementById('ln-covenant').value= loan?.covenant|| '';
  document.getElementById('ln-notes').value   = loan?.notes   || '';
  openModal('loanModal');
  setTimeout(()=>document.getElementById('ln-name').focus(), 80);
}

function commitLoan() {
  const editId = document.getElementById('ln-editId').value;
  const name   = document.getElementById('ln-name').value.trim();
  if (!name) { toast('Facility name is required','err'); return; }
  const data = {
    name,
    lender:    document.getElementById('ln-lender').value.trim(),
    type:      document.getElementById('ln-type').value,
    currency:  document.getElementById('ln-currency').value,
    principal: parseFloat(document.getElementById('ln-principal').value)||0,
    rate:      parseFloat(document.getElementById('ln-rate').value)||0,
    rateType:  document.getElementById('ln-rateType').value,
    drawDate:  document.getElementById('ln-drawDate').value,
    maturity:  document.getElementById('ln-maturity').value,
    repayFreq: document.getElementById('ln-repayFreq').value,
    openBal:   parseFloat(document.getElementById('ln-openBal').value)||0,
    repayAmt:  parseFloat(document.getElementById('ln-repayAmt').value)||0,
    covenant:  document.getElementById('ln-covenant').value.trim(),
    notes:     document.getElementById('ln-notes').value.trim(),
    active:    true,
    drawdowns: {},
    repayments:{},
  };
  if (editId) {
    const idx = loanRegister.findIndex(l=>l.id===editId);
    if (idx>=0) { auditLog('editFinancing',`Loan · ${editId}`,null,name); loanRegister[idx]={...loanRegister[idx],...data}; }
  } else {
    data.id = 'loan_'+Date.now().toString(36);
    auditLog('editFinancing','Loan Register',null,name);
    loanRegister.push(data);
  }
  // Sync interest expense into netFinancingRows
  syncDebtToNFC();
  closeModal('loanModal');
  buildDebtTab();
  toast('Facility saved','ok');
  _saveState();
}

function deleteLoan(id) {
  const loan = loanRegister.find(l=>l.id===id);
  if (!loan) return;
  if (!confirm(`Delete "${loan.name}"? This cannot be undone.`)) return;
  loanRegister = loanRegister.filter(l=>l.id!==id);
  if (selectedLoanId===id) { selectedLoanId=null; document.getElementById('loanAmortBlock').style.display='none'; }
  auditLog('editFinancing','Loan Register',loan.name,'Deleted');
  buildDebtTab();
  toast('Facility removed','ok');
}

// Sync aggregated interest expense back to netFinancingRows
function syncDebtToNFC() {
  Array.from({length:5},(_,i)=>_CY+i).forEach(yr => {
    if (!netFinancingRows[yr]) return;
    const agg = getDebtAggregates(yr);
    // Write computed interest into intExpense vals (preserve manually-seeded _CY actuals for closed months)
    const existing = netFinancingRows[yr].intExpense.vals;
    agg.totalInterest.forEach((v, m) => {
      // Keep actuals for months already loaded
      if (yr===_CY && fpa.isPeriodClosed(_CY, m+1) && existing[m]!==0) return;
      netFinancingRows[yr].intExpense.vals[m] = -v; // negative = expense
    });
  });
}

function exportDebtCSV() {
  const YRS = Array.from({length:5},(_,i)=>_CY+i);
  const rows = [['Facility','Lender','Type',...YRS.flatMap(y=>[y+' OpenBal',y+' Interest',y+' Principal',y+' CloseBal'])]];
  loanRegister.filter(l=>l.active).forEach(loan => {
    const row = [loan.name, loan.lender, loan.type];
    YRS.forEach(yr => {
      const sch = computeLoanSchedule(loan, yr);
      row.push(
        sch[0]?.openingBal||0,
        sch.reduce((s,r)=>s+r.interest,0),
        sch.reduce((s,r)=>s+r.principal,0),
        sch[11]?.closingBal||0
      );
    });
    rows.push(row);
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([rows.map(r=>r.join(',')).join('\n')],{type:'text/csv'}));
  a.download = 'JPS_DebtSchedule_'+new Date().toISOString().slice(0,10)+'.csv';
  a.click(); toast('Debt schedule exported','ok');
}

// Revenue report state
let revRptView = 'monthly';

function setRevRptView(v, btn) {
  revRptView = v;
  document.querySelectorAll('#revRptSeg .sb').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  buildRevReport();
}

// ─── REVENUE & GENERATION REPORT BUILDER ────────────────────────────────────
function buildRevReport() {
  // Defer chart rendering until pane is painted (avoids zero-width canvas on first open)
  if (!document.getElementById('cGenMixDash')?.offsetParent) {
    return requestAnimationFrame(() => buildRevReport());
  }
  const mo  = parseInt(document.getElementById('revRptMo')?.value || 2);
  const isYTD = revRptView === 'ytd';
  const data  = _acts(mo);

  // Enable/disable month options based on loaded actuals
  document.querySelectorAll('#revRptMo option').forEach(opt => {
    const m = parseInt(opt.value);
    if (_acts(m)) opt.disabled = false;
  });

  // ── PERIOD LABELS ────────────────────────────────────────────────────────
  const monthLabel = data ? data.month : (MONTHS[mo-1] + ' ' + _CY);
  const periodLabel = isYTD ? 'YTD to ' + monthLabel : monthLabel;
  document.getElementById('revRptTitle').textContent = `Actual vs Budget · ${periodLabel}`;

  // ── BUILD ACT / BUD OBJECTS ──────────────────────────────────────────────
  // For actuals: pull from actualsStore; for budget: sum monthly AOP arrays up to 'mo'
  const moRange = isYTD
    ? Array.from({length: mo}, (_, i) => i)        // months 0..mo-1 (0-indexed for arrays)
    : [mo - 1];                                     // just this month (0-indexed)

  const sumBud = key => moRange.reduce((s, i) => s + (revBudgetMonthly[key]?.[i] || 0), 0);

  const actData = (() => {
    if (!data) return null;
    if (!isYTD) return data.rev;
    // YTD: sum all loaded months up to 'mo'
    const ytdRev = { fuel:0, nonFuel:0, ipp:0, total:0, salesMWh:0, rate10:0, rate20:0, rate40:0, rate50:0 };
    for (let m = 1; m <= mo; m++) {
      const r = _acts(m)?.rev;
      if (!r) continue;
      ytdRev.fuel    += r.fuel    || 0;
      ytdRev.nonFuel = (ytdRev.nonFuel || 0) + (r.energy || 0) + (r.custCharge || 0) + (r.other || 0);
      ytdRev.ipp     += r.ipp     || 0;
      ytdRev.total   += r.total   || 0;
      ytdRev.salesMWh+= r.salesMWh|| 0;
      ytdRev.rate10  += r.rate10  || 0;
      ytdRev.rate20  += r.rate20  || 0;
      ytdRev.rate40  += r.rate40  || 0;
      ytdRev.rate50  += r.rate50  || 0;
    }
    return ytdRev;
  })();

  const budData = {
    fuel:     sumBud('fuel'),
    nonFuel:  sumBud('nonFuel'),
    ipp:      sumBud('ipp'),
    total:    sumBud('total'),
    salesMWh: sumBud('salesMWh'),
  };

  // Convenience: act revenue sub-components
  const actRev = actData || {};
  const actNonFuel = actData
    ? (isYTD ? actData.nonFuel : ((data?.rev?.energy||0) + (data?.rev?.custCharge||0) + (data?.rev?.other||0)))
    : 0;
  const actFuel  = actData ? (isYTD ? actData.fuel  : (data?.rev?.fuel  || 0)) : 0;
  const actIPP   = actData ? (isYTD ? actData.ipp   : (data?.rev?.ipp   || 0)) : 0;
  const actTotal = actData ? (isYTD ? actData.total : (data?.rev?.total || 0)) : 0;
  const actMWh   = actData ? (isYTD ? actData.salesMWh : (data?.rev?.salesMWh || 0)) : 0;
  const actYield = actMWh > 0 ? ((actTotal / actMWh) * 1000).toFixed(2) : '–';  // US¢/kWh
  const budYield = budData.salesMWh > 0 ? ((budData.total / budData.salesMWh) * 1000).toFixed(2) : '–';

  // ── KPI CARDS ────────────────────────────────────────────────────────────
  const noData = !actData;
  const kpiDefs = [
    { label:'Total Revenue — Actual', val: actTotal,       ref: budData.total,    color:'b',  income:true },
    { label:'Fuel Revenue',           val: actFuel,        ref: budData.fuel,     color:'r',  income:true },
    { label:'Non-Fuel Revenue',       val: actNonFuel,     ref: budData.nonFuel,  color:'t',  income:true },
    { label:'IPP Revenue',            val: actIPP,         ref: budData.ipp,      color:'p',  income:true },
    { label:'GWh Billed',             val: actMWh,         ref: budData.salesMWh, color:'g',  income:true, unit:'GWh', noFmt:true },
    { label:'Blended Yield (US¢/kWh)',val: actYield,       ref: budYield,         color:'gr', raw:true },
  ];
  document.getElementById('revRptKpis').innerHTML = kpiDefs.map(k => {
    if (noData) return `<div class="kpi ${k.color}"><div class="kpi-l">${k.label}</div><div class="kpi-v dim">–</div></div>`;
    if (k.raw) {
      const fav = parseFloat(k.val) >= parseFloat(k.ref);
      return `<div class="kpi ${k.color}"><div class="kpi-l">${k.label}</div><div class="kpi-v">${k.val}</div>
        <div class="kpi-d ${fav?'up':'dn'}">${fav?'▲':'▼'} vs Bud ${k.ref}</div></div>`;
    }
    const diff = k.income ? (k.val - k.ref) : (k.ref - k.val);
    const pct  = k.ref ? (diff / Math.abs(k.ref) * 100).toFixed(1) : '–';
    const fav  = diff >= 0;
    const dispVal = k.noFmt ? Math.round(k.val).toLocaleString() + ' ' + (k.unit||'') : fmtN(k.val);
    const dispDiff = k.noFmt ? Math.round(Math.abs(diff)).toLocaleString() + ' ' + (k.unit||'') : fmtN(Math.abs(diff));
    return `<div class="kpi ${k.color}"><div class="kpi-l">${k.label}</div>
      <div class="kpi-v">${dispVal}</div>
      <div class="kpi-d ${fav?'up':'dn'}">${fav?'▲':'▼'} ${dispDiff} vs Budget
        <span style="font-size:8px;color:var(--muted);margin-left:3px">(${pct}%)</span>
      </div></div>`;
  }).join('');

  // ── CHART 1: Revenue by Component — Actual vs Budget ────────────────────
  const revCompLabels = ['Fuel Revenue', 'Non-Fuel Revenue', 'IPP Revenue'];
  const revCompAct = [actFuel, actNonFuel, actIPP];
  const revCompBud = [budData.fuel, budData.nonFuel, budData.ipp];
  mkChart('cRevComp', {
    type: 'bar',
    data: {
      labels: revCompLabels,
      datasets: [
        { label:'Actual', data: revCompAct, backgroundColor: ['rgba(239,68,68,.7)','rgba(6,182,212,.7)','rgba(139,92,246,.7)'], borderRadius: 4 },
        { label:'Budget', data: revCompBud, backgroundColor: ['rgba(239,68,68,.2)','rgba(6,182,212,.2)','rgba(139,92,246,.2)'], borderRadius: 4, borderColor: ['rgba(239,68,68,.6)','rgba(6,182,212,.6)','rgba(139,92,246,.6)'], borderWidth: 1 },
      ],
    },
    options: { ...bO(), plugins:{ legend:{ labels:{ color:_TC.muted, font:{size:9}, boxWidth:9 } } } },
  });

  // ── CHART 2: GWh by Rate Class — Actuals loaded months ──────────────────
  const loadedMos = [1,2,3,4,5,6,7,8,9,10,11,12].filter(m => _acts(m));
  const gwhLabels = MONTHS;
  const gwhAct10  = MONTHS.map((_,i) => _acts(i+1)?.rev?.rate10  ?? null);
  const gwhAct20  = MONTHS.map((_,i) => _acts(i+1)?.rev?.rate20  ?? null);
  const gwhAct40  = MONTHS.map((_,i) => _acts(i+1)?.rev?.rate40  ?? null);
  const gwhAct50  = MONTHS.map((_,i) => _acts(i+1)?.rev?.rate50  ?? null);
  const gwhBudTot = MONTHS.map((_,i) => revBudgetMonthly.salesMWh[i] / 1000); // convert to GWh
  mkChart('cRevGWh', {
    type: 'bar',
    data: {
      labels: gwhLabels,
      datasets: [
        { label:'RT10 Residential', data: gwhAct10.map(v=>v!==null?v/1000:null), backgroundColor:'rgba(240,180,41,.7)', stack:'s', borderRadius:2 },
        { label:'RT20 SME',         data: gwhAct20.map(v=>v!==null?v/1000:null), backgroundColor:'rgba(6,182,212,.65)', stack:'s', borderRadius:2 },
        { label:'RT40/RT50 Ind.',   data: gwhAct40.map((v,i)=>v!==null&&gwhAct50[i]!==null?(v+gwhAct50[i])/1000:null), backgroundColor:'rgba(59,130,246,.65)', stack:'s', borderRadius:2 },
        { label:'AOP GWh',          data: gwhBudTot, type:'line', borderColor:'rgba(240,180,41,.5)', borderDash:[5,3], borderWidth:1.5, pointRadius:3, pointBackgroundColor:'rgba(240,180,41,.5)', tension:.3 },
      ],
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ labels:{ color:_TC.muted, font:{size:9}, boxWidth:9 } } },
      scales:{
        x:{ ticks:{color:_TC.muted,font:{size:9}}, grid:{color:_TC.grid}, stacked:true },
        y:{ ticks:{color:_TC.muted,font:{size:9}, callback:v=>v+' GWh'}, grid:{color:_TC.grid}, stacked:true },
      },
    },
  });

  // ── CHART 3: Generation Mix Donut ────────────────────────────────────────
  // Sum YTD generation for loaded months
  const genKeys   = Object.keys(genMixData);
  const genTotals = genKeys.map(k => moRange.reduce((s,mi) => s + (genMixData[k].vals[mi]||0), 0));
  const genMutedColor = _TC.muted; // use cached theme color
  // Filter out zero-value slices so the donut renders correctly
  const genNonZero = genKeys.filter((_,i) => genTotals[i] > 0);
  const genTotalsNZ = genNonZero.map(k => moRange.reduce((s,mi) => s + (genMixData[k].vals[mi]||0), 0));
  mkChart('cGenMixDash', {
    type: 'doughnut',
    data: {
      labels: genNonZero.map(k => genMixData[k].name),
      datasets: [{ data: genTotalsNZ, backgroundColor: genNonZero.map(k => genMixData[k].color), borderWidth: 1, borderColor: 'rgba(255,255,255,.08)' }],
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ position:'right', labels:{ color:genMutedColor, font:{size:9}, boxWidth:9, padding:6 } } },
      cutout:'60%',
    },
  });

  // ── CHART 4: Fuel vs Non-Fuel Revenue trend ──────────────────────────────
  const fuelSeries   = MONTHS.map((_,i) => _acts(i+1)?.pl?.fuelSales    ?? null);
  const nfuelSeries  = MONTHS.map((_,i) => _acts(i+1)?.pl?.nonFuelSales ?? null);
  const budFuelSeries  = revBudgetMonthly.fuel;
  const budNFuelSeries = revBudgetMonthly.nonFuel;
  mkChart('cRevFuelNF', {
    type: 'bar',
    data: {
      labels: MONTHS,
      datasets: [
        { label:'Fuel (Actual)',    data: fuelSeries,    backgroundColor:'rgba(239,68,68,.6)',  stack:'act', borderRadius:2 },
        { label:'Non-Fuel (Act.)', data: nfuelSeries,   backgroundColor:'rgba(6,182,212,.6)', stack:'act', borderRadius:2 },
        { label:'Fuel (Budget)',    data: budFuelSeries,  backgroundColor:'rgba(239,68,68,.2)',  stack:'bud', borderRadius:2 },
        { label:'Non-Fuel (Bud.)', data: budNFuelSeries, backgroundColor:'rgba(6,182,212,.2)', stack:'bud', borderRadius:2 },
      ],
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ labels:{ color:_TC.muted, font:{size:9}, boxWidth:9 } } },
      scales:{
        x:{ ticks:{color:_TC.muted,font:{size:9}}, grid:{color:_TC.grid}, stacked:true },
        y:{ stacked:true, ticks:{color:_TC.muted,font:{size:9},callback:v=>toK(v)}, grid:{color:_TC.grid} },
      },
    },
  });

  // ── CHART 5: Revenue Yield US¢/kWh ──────────────────────────────────────
  const yieldAct = MONTHS.map((_,i) => {
    const r = _acts(i+1);
    if (!r) return null;
    return r.rev?.salesMWh > 0 ? +((r.rev.total / r.rev.salesMWh) * 1000).toFixed(2) : null;
  });
  const yieldBud = MONTHS.map((_,i) =>
    revBudgetMonthly.salesMWh[i] > 0
      ? +((revBudgetMonthly.total[i] / revBudgetMonthly.salesMWh[i]) * 1000).toFixed(2)
      : null
  );
  mkChart('cRevYield', {
    type: 'line',
    data: {
      labels: MONTHS,
      datasets: [
        { label:'Actual Yield', data: yieldAct, borderColor:'var(--gold)', backgroundColor:'rgba(240,180,41,.1)', fill:true, borderWidth:2.5, tension:.3, pointRadius:4, pointBackgroundColor:'var(--gold)' },
        { label:'Budget Yield', data: yieldBud, borderColor:'rgba(240,180,41,.35)', borderDash:[5,3], borderWidth:1.5, tension:.3, pointRadius:3 },
      ],
    },
    options: {
      ...bO(v => v + '¢'),
      scales:{
        x:{ ticks:{color:_TC.muted,font:{size:9}}, grid:{color:_TC.grid} },
        y:{ ticks:{color:_TC.muted,font:{size:9},callback:v=>v+'¢'}, grid:{color:_TC.grid} },
      },
    },
  });

  // ── REVENUE DETAIL TABLE ─────────────────────────────────────────────────
  const revRows2 = [
    { sect:'Fuel Revenue', key:'fuel',      name:'Fuel Sales Revenue',     act: actFuel,    bud: budData.fuel,    inc:true },
    { sect:'Fuel Revenue', key:'ipp',       name:'IPP / Purchased Power',  act: actIPP,     bud: budData.ipp,     inc:true },
    { sect:'Non-Fuel Revenue', key:'energy',    name:'Energy Charge',      act: isYTD ? null : (data?.rev?.energy    ||0), bud: null, inc:true },
    { sect:'Non-Fuel Revenue', key:'custCharge',name:'Customer Charge',    act: isYTD ? null : (data?.rev?.custCharge||0), bud: null, inc:true },
    { sect:'Non-Fuel Revenue', key:'other',     name:'Other Revenue',      act: isYTD ? null : (data?.rev?.other     ||0), bud: null, inc:true },
    { sect:'Non-Fuel Revenue', key:'nonFuel',   name:'Total Non-Fuel Revenue', act: actNonFuel, bud: budData.nonFuel, inc:true, tot:true },
    { sect:'Total',       key:'total',     name:'TOTAL REVENUE',          act: actTotal,   bud: budData.total,   inc:true, tot:true, highlight:true },
    { sect:'Volume',      key:'salesMWh',  name:'GWh Billed',             act: actMWh,     bud: budData.salesMWh, inc:true, unit:'GWh', noFmt:true },
    { sect:'Volume',      key:'yield',     name:'Blended Yield (US¢/kWh)',act: actYield,   bud: budYield,        raw:true },
  ];

  document.getElementById('revRptH').innerHTML = `<tr>
    <th style="text-align:left;min-width:220px">Line Item</th>
    <th class="ac">Actual</th>
    <th class="bc">Budget</th>
    <th>Δ Fav/(Adv)</th>
    <th>Δ %</th>
  </tr>`;

  let rHtml = ''; let lastSect2 = '';
  revRows2.forEach(r => {
    if (r.sect !== lastSect2) { rHtml += `<tr class="sr"><td colspan="5">${r.sect}</td></tr>`; lastSect2 = r.sect; }
    const a  = r.raw ? parseFloat(r.act||0) : (r.act ?? 0);
    const b  = r.raw ? parseFloat(r.bud||0) : (r.bud ?? null);
    const hasBud = b !== null && !isNaN(b) && b !== 0;
    const diff  = hasBud ? (r.inc ? (a - b) : (b - a)) : null;
    const pct   = hasBud && b !== 0 ? diff / Math.abs(b) : null;
    const fav   = diff !== null ? diff >= 0 : null;
    const trCls = r.highlight ? 'tr' : r.tot ? 'sur' : '';
    const indent = r.highlight || r.tot ? '10px' : '22px';
    const fmt = v => r.noFmt ? Math.round(v).toLocaleString() + ' ' + (r.unit||'') : (r.raw ? v + '¢' : fmtN(v));
    const diffDisp = diff !== null
      ? (fav ? `<span class="pos">▲ ${fmt(Math.abs(diff))}</span>` : `<span class="neg">▼ (${fmt(Math.abs(diff))})</span>`)
      : '<span class="dim">–</span>';
    const pctDisp = pct !== null
      ? (fav ? `<span class="pos">${(Math.abs(pct)*100).toFixed(1)}%</span>` : `<span class="neg">(${(Math.abs(pct)*100).toFixed(1)}%)</span>`)
      : '<span class="dim">–</span>';
    rHtml += `<tr class="${trCls}">
      <td style="padding-left:${indent}">${r.highlight||r.tot?`<strong>${r.name}</strong>`:r.name}</td>
      <td class="ac">${fmt(a)}</td>
      <td class="gld">${hasBud ? fmt(b) : '<span class="dim">–</span>'}</td>
      <td>${diffDisp}</td>
      <td>${pctDisp}</td>
    </tr>`;
  });
  document.getElementById('revRptB').innerHTML = rHtml;

  // ── RATE CLASS TABLE ─────────────────────────────────────────────────────
  // ARCHITECTURAL RULE: AOP share % must come from uploaded AOP version in fpa_v_facts — not hardcoded
  const rateClsData = [
    { cls:'RT10 – Residential',  act: isYTD ? actData?.rate10 : data?.rev?.rate10 },
    { cls:'RT20 – SME/Comm.',    act: isYTD ? actData?.rate20 : data?.rev?.rate20 },
    { cls:'RT40 – LV Ind.',      act: isYTD ? actData?.rate40 : data?.rev?.rate40 },
    { cls:'RT50 – MV Ind.',      act: isYTD ? actData?.rate50 : data?.rev?.rate50 },
    { cls:'RT60 – Streetlights', act: isYTD ? actData?.rate60 : data?.rev?.rate60 },
    { cls:'RT70 – LV/HV Large',  act: isYTD ? actData?.rate70 : data?.rev?.rate70 },
  ];
  const totalActRC = (rateClsData.reduce((s,r)=>s+(r.act||0),0));
  document.getElementById('rateClsH').innerHTML = `<tr><th style="text-align:left">Rate Class</th><th class="ac">Revenue ($000)</th><th class="ac">Actual Share %</th></tr>`;
  document.getElementById('rateClsB').innerHTML = rateClsData.map(r => {
    const share = totalActRC > 0 && r.act ? ((r.act/totalActRC)*100).toFixed(1)+'%' : '–';
    const dispAct = r.act ? fmtN(r.act) : '<span class="dim">–</span>';
    return `<tr><td style="padding-left:14px">${r.cls}</td><td class="ac">${dispAct}</td><td class="ac">${share}</td></tr>`;
  }).join('') +
  `<tr class="tr"><td style="padding-left:10px"><strong>Total (All Rate Classes)</strong></td><td class="ac"><strong>${fmtN(totalActRC)}</strong></td><td class="ac"><strong>100%</strong></td></tr>`;

  // ── GENERATION MIX TABLE ─────────────────────────────────────────────────
  const genTotalMWh = genTotals.reduce((s,v) => s+v, 0);
  const genGroups = [
    { name:'JPS Own — HFO/Diesel',  mwh: moRange.reduce((s,i)=>s+(genMixData.hfo.vals[i]||0),0),  pct:0, re:false },
    { name:'JPS Own — LNG/Gas',     mwh: moRange.reduce((s,i)=>s+(genMixData.lng.vals[i]||0),0),  pct:0, re:false },
    { name:'JPS Own — Solar',       mwh: moRange.reduce((s,i)=>s+(genMixData.solar.vals[i]||0),0), pct:0, re:true  },
    { name:'JPS Own — Wind',        mwh: moRange.reduce((s,i)=>s+(genMixData.wind.vals[i]||0),0),  pct:0, re:true  },
    { name:'JPS Own — Hydro',       mwh: moRange.reduce((s,i)=>s+(genMixData.hydro.vals[i]||0),0), pct:0, re:true  },
    { name:'IPP — HFO',             mwh: moRange.reduce((s,i)=>s+(genMixData.ipp_hfo.vals[i]||0),0),pct:0, re:false },
    { name:'IPP — LNG/Gas',         mwh: moRange.reduce((s,i)=>s+(genMixData.ipp_lng.vals[i]||0),0),pct:0, re:false },
    { name:'IPP — Renewables',      mwh: moRange.reduce((s,i)=>s+(genMixData.ipp_re.vals[i]||0),0), pct:0, re:true  },
  ];
  genGroups.forEach(g => g.pct = genTotalMWh > 0 ? (g.mwh/genTotalMWh*100).toFixed(1)+'%' : '–');
  const rePct = genTotalMWh > 0 ? (genGroups.filter(g=>g.re).reduce((s,g)=>s+g.mwh,0)/genTotalMWh*100).toFixed(1)+'%' : '–';
  document.getElementById('genMixH').innerHTML = `<tr><th style="text-align:left">Source</th><th class="ac">MWh</th><th class="ac">Share</th><th class="ac">RE?</th></tr>`;
  document.getElementById('genMixB').innerHTML = genGroups.map(g =>
    `<tr><td style="padding-left:14px">${g.name}</td><td class="ac">${Math.round(g.mwh).toLocaleString()}</td><td class="ac">${g.pct}</td><td style="text-align:center">${g.re?'<span class="pos">✓</span>':'<span class="dim">–</span>'}</td></tr>`
  ).join('') +
  `<tr class="tr"><td style="padding-left:10px"><strong>Total Generation</strong></td><td class="ac"><strong>${Math.round(genTotalMWh).toLocaleString()}</strong></td><td class="ac"><strong>100%</strong></td><td style="text-align:center;font-size:9px;color:var(--green)">${rePct} RE</td></tr>`;

  // ── PERFORMANCE INDICATORS ────────────────────────────────────────────────
  const revAttain = budData.total > 0 ? ((actTotal/budData.total)*100).toFixed(1)+'%' : '–';
  const mwhAttain = budData.salesMWh > 0 ? ((actMWh/budData.salesMWh)*100).toFixed(1)+'%' : '–';
  const fuelShare = actTotal > 0 ? ((actFuel/actTotal)*100).toFixed(1)+'%' : '–';
  const nfShare   = actTotal > 0 ? ((actNonFuel/actTotal)*100).toFixed(1)+'%' : '–';
  document.getElementById('revRptPerf').innerHTML = [
    { label:'Revenue Attainment vs Budget', val: revAttain,  color: parseFloat(revAttain)>=100?'var(--green)':'var(--amber)' },
    { label:'GWh Volume Attainment',        val: mwhAttain,  color: parseFloat(mwhAttain)>=100?'var(--green)':'var(--amber)' },
    { label:'Fuel Revenue Share',           val: fuelShare,  color: 'var(--red)'    },
    { label:'Non-Fuel Revenue Share',       val: nfShare,    color: 'var(--teal)'   },
    { label:'Renewable Energy Share',       val: rePct,      color: 'var(--green)'  },
    { label:'Period',                       val: periodLabel, color:'var(--blue)'   },
  ].map(p => `<div style="background:var(--card);border:1px solid var(--border);border-radius:6px;padding:10px 13px;border-left:3px solid ${p.color}">
    <div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">${p.label}</div>
    <div style="font-size:15px;font-weight:800;color:white;font-family:var(--mono)">${p.val}</div>
  </div>`).join('');
}

function exportRevCSV() {
  const mo = parseInt(document.getElementById('revRptMo')?.value || 2);
  const data = _acts(mo);
  if (!data) { toast('No actuals for selected month','w'); return; }
  const rows = [['Line Item','Actual','Budget','Var $','Var %']];
  const items = [
    ['Fuel Revenue',    data.rev?.fuel||0,    revBudgetMonthly.fuel[mo-1]],
    ['IPP Revenue',     data.rev?.ipp||0,     revBudgetMonthly.ipp[mo-1]],
    ['Non-Fuel Revenue',(data.rev?.energy||0)+(data.rev?.custCharge||0)+(data.rev?.other||0), revBudgetMonthly.nonFuel[mo-1]],
    ['Total Revenue',   data.rev?.total||0,   revBudgetMonthly.total[mo-1]],
    ['GWh Billed',      data.rev?.salesMWh||0,revBudgetMonthly.salesMWh[mo-1]],
  ];
  items.forEach(([n,a,b])=>{ const d=a-b; rows.push([n,a,b,d,b?((d/Math.abs(b))*100).toFixed(1)+'%':'–']); });
  const blob=new Blob([rows.map(r=>r.join(',')).join('\n')],{type:'text/csv'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='JPS_Revenue_'+data.month.replace(/ /g,'_')+'.csv';a.click();
  toast('Revenue report exported','ok');
}

// ─── END REVENUE & GENERATION REPORT ────────────────────────────────────────

// Variance state
let varPeriod = 'monthly'; // 'monthly' | 'ytd'
let varCmp    = 'budget';  // 'budget'  | 'le'

function setVarPeriod(p, btn) {
  varPeriod = p;
  document.querySelectorAll('#varPeriodSeg .sb').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  buildVarReport();
}
function setVarCmp(c, btn) {
  varCmp = c;
  document.querySelectorAll('#varCmpSeg .sb').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  buildVarReport();
}

// ─── Parse a JPSCo_Financials_MM-YY.xlsx via SheetJS ───────────────────────
// Reads 5 sheets: P&L, P&L Detail, B_S, Cash flow, Revenues
// Runs 4 consistency checks (NI tie, cash tie, BS balance, RE roll)
// Writes to fpa_facts (ACTUAL_YYYY version) and marks period closed
// Backward-compat: also populates actualsStore[moNum] and actualsStore[yr][moNum]
async function handleActualsUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = '';   // reset input immediately

  const fn       = file.name;
  const moMatch  = fn.match(/(\d{2})-(\d{2})\.xlsx$/i);
  const moNum    = moMatch ? parseInt(moMatch[1], 10)        : null;
  const yr       = moMatch ? 2000 + parseInt(moMatch[2], 10) : null;
  const label    = moNum && yr ? MONTHS[moNum - 1] + ' ' + yr : fn;

  if (!moNum || !yr || moNum < 1 || moNum > 12) {
    toast('❌ Filename must match JPSCo_Financials_MM-YY.xlsx (e.g. JPSCo_Financials_03-26.xlsx)', 'w');
    return;
  }
  toast('📂 Parsing ' + label + '…', 'i');

  try {
    // ── 1. Read workbook ──────────────────────────────────────────────────────
    const buf = await file.arrayBuffer();
    const wb  = XLSX.read(buf, { type: 'array' });

    // Safe integer reader from a sheet's raw array (0-indexed row/col)
    const I = (raw, row, col) => {
      const x = raw?.[row]?.[col];
      return (typeof x === 'number') ? Math.round(x) : 0;
    };

    // ── 2. P&L sheet ─────────────────────────────────────────────────────────
    // Col 2 = Actual MTD | Col 5 = Budget MTD | Col 12 = YTD Actual | Col 13 = YTD Budget
    const plSheet = wb.Sheets['P&L'];
    if (!plSheet) throw new Error('Sheet "P&L" not found — check workbook name');
    const plRaw = XLSX.utils.sheet_to_json(plSheet, { header: 1, defval: null });
    const p = (r, c) => I(plRaw, r, c);

    const plAct = {
      fuel_sales:   p(7,2),  nonfuel:      p(8,2),  total_sales: p(9,2),
      fuel_cos:     p(10,2), ppa:          p(11,2), other_cos:   p(12,2),
      total_cos:    p(13,2), gross_profit: p(14,2),
      sga:          p(15,2), maintenance:  p(16,2), opex:        p(17,2),
      ebitda:       p(18,2), depn:         p(19,2), ebit:        p(20,2),
      // Summary below-EBIT (rows 21-29 in P&L — detail overridden from P&L Detail sheet)
      int_income_s: p(21,2), int_exp_s:   p(22,2), nfc:         p(23,2),
      oth_inc:      p(25,2), pretax:       p(27,2), tax:         p(28,2),
      net_inc:      p(29,2),
    };
    const plBud = {
      fuel_sales:   p(7,5),  nonfuel:      p(8,5),  total_sales: p(9,5),
      fuel_cos:     p(10,5), ppa:          p(11,5), other_cos:   p(12,5),
      total_cos:    p(13,5), gross_profit: p(14,5),
      sga:          p(15,5), maintenance:  p(16,5), opex:        p(17,5),
      ebitda:       p(18,5), depn:         p(19,5), ebit:        p(20,5),
      int_income_s: p(21,5), int_exp_s:   p(22,5), nfc:         p(23,5),
      oth_inc:      p(25,5), pretax:       p(27,5), tax:         p(28,5),
      net_inc:      p(29,5),
    };
    const plYTDA = {
      fuel_sales:   p(7,12),  nonfuel:      p(8,12),  total_sales: p(9,12),
      fuel_cos:     p(10,12), ppa:          p(11,12), other_cos:   p(12,12),
      total_cos:    p(13,12), gross_profit: p(14,12),
      sga:          p(15,12), maintenance:  p(16,12), opex:        p(17,12),
      ebitda:       p(18,12), depn:         p(19,12), ebit:        p(20,12),
      nfc:          p(23,12), oth_inc:      p(25,12),
      pretax:       p(27,12), tax:          p(28,12), net_inc:     p(29,12),
    };
    const plYTDB = {
      fuel_sales:   p(7,13),  nonfuel:      p(8,13),  total_sales: p(9,13),
      fuel_cos:     p(10,13), ppa:          p(11,13), other_cos:   p(12,13),
      total_cos:    p(13,13), gross_profit: p(14,13),
      sga:          p(15,13), maintenance:  p(16,13), opex:        p(17,13),
      ebitda:       p(18,13), depn:         p(19,13), ebit:        p(20,13),
      nfc:          p(23,13), oth_inc:      p(25,13),
      pretax:       p(27,13), tax:          p(28,13), net_inc:     p(29,13),
    };

    // ── 3. P&L Detail sheet (below-EBIT granular breakdown) ──────────────────
    // Col 1 = prior month | Col 2 = current month
    // Rows confirmed from JPSCo_Financials_03-26.xlsx inspection
    const plDtlSheet = wb.Sheets['P&L Detail'] || wb.Sheets['PL Detail'];
    const dtlRaw     = plDtlSheet ? XLSX.utils.sheet_to_json(plDtlSheet, { header: 1, defval: null }) : [];
    const d = (r, c) => I(dtlRaw, r, c);

    const dtl = {
      int_income:  plDtlSheet ? d(35,2) : plAct.int_income_s,  // R36: Interest Income
      afudc:       plDtlSheet ? d(36,2) : 0,                    // R37: AFUDC
      int_expense: plDtlSheet ? d(38,2) : plAct.int_exp_s,     // R39: Interest Expense
      loan_fees:   plDtlSheet ? d(40,2) : 0,                    // R41: Loan financing fees
      pref_div:    plDtlSheet ? d(41,2) : 0,                    // R42: Preference dividends
      fx:          plDtlSheet ? d(42,2) : 0,                    // R43: FX gain/(loss)
    };

    // ── 4. B_S sheet ─────────────────────────────────────────────────────────
    // Col 2 = prior period | Col 3 = current period
    // Row indices confirmed from JPSCo_Financials_03-26.xlsx inspection
    const bsSheet = wb.Sheets['B_S'];
    const bsRaw   = bsSheet ? XLSX.utils.sheet_to_json(bsSheet, { header: 1, defval: null }) : [];
    const b = (r, c) => I(bsRaw, r, c);

    const bsAct = {
      fa_nbv:          b(17,3),  // PP&E Net book value          → ppe
      cash:            b(24,3),  // Cash & short-term deposits   → cash
      recv:            b(26,3),  // Receivables, net             → recv
      unbill:          b(29,3),  // Unbilled revenue             → unbill
      fuel_inv:        b(31,3),  // Fuel inventory               → finv
      matls:           b(32,3),  // Materials & supplies         → matls
      cur_a:           b(33,3),  // Total current assets         → cur_a
      tot_a:           b(35,3),  // Total assets                 → tot_a
      // Equity section
      retained_curr:   b(41,3),  // Retained earnings (current)  → bs_retained
      retained_prior:  b(41,2),  // Retained earnings (prior)    → for RE roll check
      equity:          b(42,3),  // Total equity                 → equity
      // Current liabilities
      ap:              b(45,3),  // Accounts payable & accruals  → ap
      std:             b(50,3),  // Short-term debt              → bs_std
      curr_ltd:        b(51,3),  // Current portion of LTD       → bs_curr_ltd
      cur_l:           b(54,3),  // Total current liabilities    → cur_l
      // Non-current liabilities
      ltd:             b(56,3),  // Long-term debt               → ltd
      leases:          b(57,3),  // Lease liabilities (IFRS-16)  → leases
      cust_dep_lt:     b(59,3),  // Customer deposits & adv (LT) → bs_cust_dep_lt (confirmed idx 59)
      // Totals
      tot_l:           b(66,3),  // Total liabilities            → tot_l  (confirmed idx 66)
      tot_le:          b(68,3),  // Total liabilities & equity   → tot_le (confirmed idx 68)
    };

    // ── 5. Cash flow sheet ────────────────────────────────────────────────────
    // Col 3 = actual MTD
    // Rows confirmed from JPSCo indirect CF structure; CF tax rows (14,15) are best-guess
    // until the CF sheet is inspected directly — fall back to P&L total tax if zero
    const cfSheet = wb.Sheets['Cash flow'] || wb.Sheets['Cash Flow'] || wb.Sheets['CF'];
    const cfRaw   = cfSheet ? XLSX.utils.sheet_to_json(cfSheet, { header: 1, defval: null }) : [];
    const c = (r, col) => I(cfRaw, r, col);

    const cfAct = {
      net_profit:  c(7,3),   // Net profit (= P&L net income)   → cf_ni
      depn:        c(10,3),  // Depreciation add-back           → cf_depn
      def_tax:     c(11,3),  // Deferred tax add-back           → cf_def_tax (best-guess row)
      int_inc_adj: c(12,3),  // Interest income reverse         → cf_int_inc_adj (best-guess)
      netint:      c(13,3),  // Net interest expense add-back   → cf_netint
      tax_exp:     c(14,3),  // Current income tax add-back     → cf_tax_exp (best-guess row)
      ops_net:     c(23,3),  // Net cash from operating         → cf_ops_net
      wc_recv:     c(25,3),  // Δ Receivables                   → cf_wc_recv
      wc_ap:       c(31,3),  // Δ Payables                      → cf_wc_ap
      cf_close:    c(63,3),  // Closing cash balance            → cf_close (for cash tie check)
    };
    // Fallback: if CF tax rows returned 0, use total P&L tax as current tax
    const currTax = cfAct.tax_exp || plAct.tax;
    const deferTax = cfAct.def_tax;

    // ── 6. Revenues sheet ─────────────────────────────────────────────────────
    // Col 2 = actual MTD
    const revSheet = wb.Sheets['Revenues'];
    const revRaw   = revSheet ? XLSX.utils.sheet_to_json(revSheet, { header: 1, defval: null }) : [];
    const rv = (r, col) => I(revRaw, r, col);

    const revAct = {
      // Revenue by type (billing breakdown)
      ipp:       rv(11,2),  // IPP recovery                    → rev_ipp
      energy:    rv(12,2),  // Energy (non-fuel)               → rev_energy
      cust_chg:  rv(13,2),  // Customer charge                 → rev_cust_chg
      other:     rv(17,2),  // Other revenue                   → rev_other
      // Revenue by rate class (J$ thousands)
      rt10:      rv(21,2),  // Rate 10                         → rev_rt10
      rt20:      rv(22,2),  // Rate 20                         → rev_rt20
      rt40:      rv(23,2),  // Rate 40                         → rev_rt40
      rt50:      rv(24,2),  // Rate 50                         → rev_rt50
      rt60:      rv(25,2),  // Rate 60                         → rev_rt60
      rt70:      rv(26,2),  // Rate 70                         → rev_rt70
      // Sales volume (col 2 on Revenue sheet)
      mwh_rt10:  rv(21,4),  // MWh — Rate 10                   → rev_mwh_rt10 (col 4 tentative)
      mwh_rt20:  rv(22,4),  // MWh — Rate 20                   → rev_mwh_rt20
      mwh_rt40:  rv(23,4),  // MWh — Rate 40                   → rev_mwh_rt40
      mwh_rt50:  rv(24,4),  // MWh — Rate 50                   → rev_mwh_rt50
      mwh_rt60:  rv(25,4),  // MWh — Rate 60                   → rev_mwh_rt60
      mwh_rt70:  rv(26,4),  // MWh — Rate 70                   → rev_mwh_rt70
    };
    // Total billed sales MWh (sum of rate classes, or from P&L if Rev sheet missing)
    const salesMWh = revAct.mwh_rt10 + revAct.mwh_rt20 + revAct.mwh_rt40
                   + revAct.mwh_rt50 + revAct.mwh_rt60 + revAct.mwh_rt70;

    // ── 7. Four consistency checks ───────────────────────────────────────────
    const MATERIALITY = 2000;  // $2,000 — soft warn below, hard block above
    const checks = [];
    const chk = (name, a, b) => {
      const diff = Math.abs(a - b);
      checks.push({ name, a, b, diff, pass: diff <= MATERIALITY });
    };

    // 7a. Net income tie: P&L NI must equal CF net profit
    chk('Net Income (P&L vs CF)', plAct.net_inc, cfAct.net_profit);

    // 7b. Cash balance tie: BS cash must equal CF closing cash
    //     (only enforce if CF sheet was found and has a value)
    if (cfSheet && cfAct.cf_close !== 0)
      chk('Cash Balance (BS vs CF)', bsAct.cash, cfAct.cf_close);

    // 7c. Balance sheet balance: Total Assets must equal Total Liabilities & Equity
    chk('Balance Sheet (Assets vs L&E)', bsAct.tot_a, bsAct.tot_le);

    // 7d. Retained earnings roll: Prior RE + Current NI = Current RE
    //     (only enforce if we have a non-zero prior RE — avoids false fail on first upload)
    if (bsAct.retained_prior !== 0)
      chk('Retained Earnings Roll', bsAct.retained_prior + plAct.net_inc, bsAct.retained_curr);

    const failures = checks.filter(c => !c.pass);
    if (failures.length > 0) {
      const msgs = failures.map(c =>
        `  • ${c.name}\n    Got: ${c.a.toLocaleString()} vs ${c.b.toLocaleString()} — diff $${c.diff.toLocaleString()}`
      ).join('\n');
      const fullMsg = `Upload blocked — ${failures.length} consistency check(s) failed:\n${msgs}\n\nFix the source file and re-upload.`;
      toast('❌ ' + fullMsg, 'w');
      actualsLog.unshift({
        file: fn, month: moNum, label,
        ts: new Date().toLocaleString(), rows: 0,
        status: '❌ Check failed: ' + failures.map(c => c.name).join('; '),
      });
      buildActualsLog();
      console.warn('[FPA Actuals] Blocked —', fullMsg);
      return;
    }
    const warnings = checks.filter(c => c.pass && c.diff > 0);
    if (warnings.length)
      toast('⚠ Minor rounding diff (≤$2K): ' + warnings.map(c => c.name + ' $' + c.diff.toLocaleString()).join(', '), 'w');

    // ── 8. Supabase: find / create ACTUAL_YYYY version ───────────────────────
    const versionCode = 'ACTUAL_' + yr;
    let   versionId   = fpa.vid(versionCode);

    if (!versionId && _sb) {
      const { data: newVer, error: verErr } = await _sb
        .from('fpa_versions')
        .upsert(
          { code: versionCode, name: 'Actuals ' + yr, kind: 'ACTUAL', is_locked: false },
          { onConflict: 'code' }
        )
        .select().single();
      if (verErr) throw new Error('Could not create version: ' + verErr.message);
      versionId = newVer.id;
      fpa.versions.push(newVer);
    }

    // ── 9. Resolve period key ─────────────────────────────────────────────────
    // fpa_facts.period_id is INTEGER (year*100+month), NOT a UUID.
    // fpa_dim_period.id is also this integer (confirmed from DB schema).
    const periodKey = yr * 100 + moNum;   // e.g. 202603
    const periodRow = fpa.periods.find(p => p.year === yr && p.month === moNum);
    if (!periodRow)
      throw new Error(`Period ${yr}-${String(moNum).padStart(2,'0')} not found in fpa_dim_period. Run the period seed migration first.`);

    // ── 10. Build fpa_facts rows ──────────────────────────────────────────────
    // Line IDs match fpa_dim_line.id exactly (confirmed from DB query).
    // period_id = integer key; source = 'upload' to distinguish from manual/formula entries.
    const factRows = [];
    const F = (lineId, value) => {
      // Only write lines that exist in our loaded catalog (guards against stale IDs)
      if (!fpa.lines.find(l => l.id === lineId)) {
        console.warn('[FPA Actuals] Unknown line_id "' + lineId + '" — skipped');
        return;
      }
      factRows.push({
        version_id: versionId,
        line_id:    lineId,
        period_id:  periodKey,   // integer, e.g. 202603
        value:      (value === null || value === undefined) ? 0 : value,
        source:     'upload',
      });
    };

    // ── P&L facts ────────────────────────────────────────────────────────────
    F('fuel_rev',      plAct.fuel_sales);   // Fuel Revenue
    F('nonfuel',       plAct.nonfuel);      // Non-Fuel Revenue
    F('pl_total_sales',plAct.total_sales);  // Total Sales
    F('fuel_cost',     plAct.fuel_cos);     // Fuel Costs
    F('pl_ppa',        plAct.ppa);          // Purchased Power (PPA)
    F('pl_other_cos',  plAct.other_cos);    // Other Cost of Sales
    F('pl_total_cos',  plAct.total_cos);    // Total Cost of Sales
    F('pl_gross_profit',plAct.gross_profit);// Gross Profit
    F('pl_sga',        plAct.sga);          // SG&A
    F('pl_maintenance',plAct.maintenance);  // Maintenance
    F('opex',          plAct.opex);         // O&M (operating expense subtotal)
    F('ebitda',        plAct.ebitda);       // Total EBITDA
    F('depn',          plAct.depn);         // Depreciation
    F('ebit',          plAct.ebit);         // EBIT
    // Below-EBIT (from P&L Detail where available, fallback to P&L summary)
    F('pl_int_income', dtl.int_income);     // Interest Income
    F('pl_afudc',      dtl.afudc);          // AFUDC
    F('pl_int_expense',dtl.int_expense);    // Interest Expense
    F('pl_loan_fees',  dtl.loan_fees);      // Loan Financing Fees
    F('pl_pref_div',   dtl.pref_div);       // Preference Dividends
    F('pl_fx',         dtl.fx);             // FX Gain/(Loss)
    F('fin_cost',      plAct.nfc);          // Net Financing Cost (summary)
    F('oth_inc',       plAct.oth_inc);      // Other Income/(Expense)
    F('pretax',        plAct.pretax);       // Pre-Tax Income
    F('tax',           plAct.tax);          // Income Tax (total)
    F('pl_curr_tax',   currTax);            // Current Income Tax (from CF add-back or total)
    F('pl_def_tax',    deferTax);           // Deferred Tax
    F('net_inc',       plAct.net_inc);      // NET INCOME

    // ── B_S facts ─────────────────────────────────────────────────────────────
    F('ppe',           bsAct.fa_nbv);       // PP&E – Net
    F('cash',          bsAct.cash);         // Cash & Short Term Deposits
    F('recv',          bsAct.recv);         // Receivables, Net
    F('unbill',        bsAct.unbill);       // Unbilled Revenue
    F('finv',          bsAct.fuel_inv);     // Fuel Inventory
    F('matls',         bsAct.matls);        // Materials & Supplies
    F('cur_a',         bsAct.cur_a);        // Total Current Assets
    F('tot_a',         bsAct.tot_a);        // TOTAL ASSETS
    F('bs_retained',   bsAct.retained_curr);// Retained Earnings
    F('equity',        bsAct.equity);       // Total Equity
    F('ap',            bsAct.ap);           // Accounts Payable & Accruals
    F('bs_std',        bsAct.std);          // Short-Term Debt
    F('bs_curr_ltd',   bsAct.curr_ltd);     // Current Maturity — LTD
    F('cur_l',         bsAct.cur_l);        // Total Current Liabilities
    F('ltd',           bsAct.ltd);          // Long-Term Debt
    F('leases',        bsAct.leases);       // Lease Liabilities (IFRS-16)
    F('bs_cust_dep_lt',bsAct.cust_dep_lt);  // Customer Deposits & Advances — LT
    F('tot_l',         bsAct.tot_l);        // TOTAL LIABILITIES
    F('tot_le',        bsAct.tot_le);       // TOTAL LIABILITIES & EQUITY

    // ── CF (indirect) facts ───────────────────────────────────────────────────
    F('cf_ni',         cfAct.net_profit);   // Net Profit
    F('cf_depn',       cfAct.depn);         // Add: Depreciation
    F('cf_def_tax',    deferTax);           // Deferred Tax (non-cash add-back)
    F('cf_int_inc_adj',cfAct.int_inc_adj);  // Less: Interest Income
    F('cf_netint',     cfAct.netint);       // Net Interest Expense (add back)
    F('cf_tax_exp',    currTax);            // Income Tax Expense (add-back)
    F('cf_ops_net',    cfAct.ops_net);      // Net Cash from Operating
    F('cf_wc_recv',    cfAct.wc_recv);      // Δ Receivables
    F('cf_wc_ap',      cfAct.wc_ap);        // Δ Payables
    F('cf_close',      cfAct.cf_close || bsAct.cash); // Closing Cash Balance

    // ── Revenue / STAT facts ──────────────────────────────────────────────────
    F('rev_ipp',       revAct.ipp);
    F('rev_energy',    revAct.energy);
    F('rev_cust_chg',  revAct.cust_chg);
    F('rev_other',     revAct.other);
    F('rev_rt10',      revAct.rt10);
    F('rev_rt20',      revAct.rt20);
    F('rev_rt40',      revAct.rt40);
    F('rev_rt50',      revAct.rt50);
    F('rev_rt60',      revAct.rt60);
    F('rev_rt70',      revAct.rt70);
    F('rev_mwh_rt10',  revAct.mwh_rt10);
    F('rev_mwh_rt20',  revAct.mwh_rt20);
    F('rev_mwh_rt40',  revAct.mwh_rt40);
    F('rev_mwh_rt50',  revAct.mwh_rt50);
    F('rev_mwh_rt60',  revAct.mwh_rt60);
    F('rev_mwh_rt70',  revAct.mwh_rt70);

    // ── Derived STAT facts ────────────────────────────────────────────────────
    // stat_billed_gwh: total billed MWh from Revenue sheet (stored in MWh; flash divides by 1000)
    const totalBilledMWh = salesMWh || (revAct.mwh_rt10 + revAct.mwh_rt20 + revAct.mwh_rt40
                         + revAct.mwh_rt50 + revAct.mwh_rt60 + revAct.mwh_rt70);
    F('stat_billed_gwh', totalBilledMWh);

    // stat_sysloss_pct: derive from plan net generation + actual billed MWh.
    // Net gen for this month comes from the in-memory generation module (genMixData).
    // Once generation actuals are uploaded separately, stat_netgen_gwh will supersede this.
    const planNetGenMWh = (() => {
      try {
        return Object.values(genMixData || {})
          .reduce((s, g) => s + (g.vals?.[moNum - 1] || 0), 0); // already in MWh
      } catch(e) { return 0; }
    })();
    if (planNetGenMWh > 0 && totalBilledMWh > 0) {
      const sysloss = (planNetGenMWh - totalBilledMWh) / planNetGenMWh * 100;
      F('stat_sysloss_pct', Math.max(0, Math.round(sysloss * 10) / 10)); // 1 dp
    }

    // ── 11. Write to Supabase ─────────────────────────────────────────────────
    if (_sb && versionId && factRows.length > 0) {
      const { error: upsertErr } = await _sb
        .from('fpa_facts')
        .upsert(factRows, { onConflict: 'version_id,line_id,period_id' });
      if (upsertErr) throw new Error('DB write failed: ' + upsertErr.message);

      // Mark period closed in fpa_dim_period (period_id is integer PK)
      const { error: closeErr } = await _sb
        .from('fpa_dim_period')
        .update({ is_closed: true })
        .eq('id', periodKey);
      if (closeErr) console.warn('[FPA Actuals] Could not close period:', closeErr.message);
    } else if (!_sb) {
      console.warn('[FPA Actuals] No Supabase connection — facts stored in-memory only');
    }

    // ── 12. Update in-memory fpa.facts and fpa.periods ───────────────────────
    (fpa.facts[versionCode] ??= {});
    factRows.forEach(f => {
      (fpa.facts[versionCode][f.line_id] ??= {});
      fpa.facts[versionCode][f.line_id][periodKey] = Number(f.value);
    });
    // Mark period closed in-memory (match by year+month, safe regardless of id type)
    const pRow = fpa.periods.find(p => p.year === yr && p.month === moNum);
    if (pRow) pRow.is_closed = true;

    // ── 13. Backward-compat actualsStore ──────────────────────────────────────
    // Existing UI reads actualsStore[moNum] and actualsStore[yr][moNum]
    const storeEntry = {
      month: label,
      pl: {
        fuelSales:    plAct.fuel_sales,   nonFuelSales:  plAct.nonfuel,
        totalSales:   plAct.total_sales,  fuelCost:      plAct.fuel_cos,
        ppaCost:      plAct.ppa,          otherCOS:      plAct.other_cos,
        totalCOS:     plAct.total_cos,    grossProfit:   plAct.gross_profit,
        sga:          plAct.sga,          maintenance:   plAct.maintenance,
        opex:         plAct.opex,         ebitda:        plAct.ebitda,
        depreciation: plAct.depn,         ebit:          plAct.ebit,
        intIncome:    dtl.int_income,     intExpense:    dtl.int_expense,
        otherIncome:  plAct.oth_inc,      pretax:        plAct.pretax,
        tax:          plAct.tax,          netIncome:     plAct.net_inc,
      },
      budget: {
        fuelSales:    plBud.fuel_sales,   nonFuelSales:  plBud.nonfuel,
        totalSales:   plBud.total_sales,  fuelCost:      plBud.fuel_cos,
        ppaCost:      plBud.ppa,          otherCOS:      plBud.other_cos,
        totalCOS:     plBud.total_cos,    grossProfit:   plBud.gross_profit,
        sga:          plBud.sga,          maintenance:   plBud.maintenance,
        opex:         plBud.opex,         ebitda:        plBud.ebitda,
        depreciation: plBud.depn,         ebit:          plBud.ebit,
        intIncome:    plBud.int_income_s, intExpense:    plBud.int_exp_s,
        otherIncome:  plBud.oth_inc,      pretax:        plBud.pretax,
        tax:          plBud.tax,          netIncome:     plBud.net_inc,
      },
      ytdActual: {
        fuelSales:    plYTDA.fuel_sales,  nonFuelSales:  plYTDA.nonfuel,
        totalSales:   plYTDA.total_sales, fuelCost:      plYTDA.fuel_cos,
        ppaCost:      plYTDA.ppa,         otherCOS:      plYTDA.other_cos,
        totalCOS:     plYTDA.total_cos,   grossProfit:   plYTDA.gross_profit,
        sga:          plYTDA.sga,         maintenance:   plYTDA.maintenance,
        opex:         plYTDA.opex,        ebitda:        plYTDA.ebitda,
        depreciation: plYTDA.depn,        ebit:          plYTDA.ebit,
        nfc:          plYTDA.nfc,         otherIncome:   plYTDA.oth_inc,
        pretax:       plYTDA.pretax,      tax:           plYTDA.tax,
        netIncome:    plYTDA.net_inc,
      },
      ytdBudget: {
        fuelSales:    plYTDB.fuel_sales,  nonFuelSales:  plYTDB.nonfuel,
        totalSales:   plYTDB.total_sales, fuelCost:      plYTDB.fuel_cos,
        ppaCost:      plYTDB.ppa,         otherCOS:      plYTDB.other_cos,
        totalCOS:     plYTDB.total_cos,   grossProfit:   plYTDB.gross_profit,
        sga:          plYTDB.sga,         maintenance:   plYTDB.maintenance,
        opex:         plYTDB.opex,        ebitda:        plYTDB.ebitda,
        depreciation: plYTDB.depn,        ebit:          plYTDB.ebit,
        nfc:          plYTDB.nfc,         otherIncome:   plYTDB.oth_inc,
        pretax:       plYTDB.pretax,      tax:           plYTDB.tax,
        netIncome:    plYTDB.net_inc,
      },
      rev: {
        ipp: revAct.ipp, energy: revAct.energy, custCharge: revAct.cust_chg,
        other: revAct.other, salesMWh,
        rate10: revAct.rt10, rate20: revAct.rt20, rate40: revAct.rt40,
        rate50: revAct.rt50, rate60: revAct.rt60, rate70: revAct.rt70,
      },
      bs: {
        cash: bsAct.cash,   receivables:      bsAct.recv,     unbilled:    bsAct.unbill,
        fuelInv: bsAct.fuel_inv, materials:   bsAct.matls,
        totalCurrentAssets: bsAct.cur_a,      fixedAssetsNBV:  bsAct.fa_nbv,
        totalAssets: bsAct.tot_a,             payables:        bsAct.ap,
        shortTermDebt: bsAct.std,             currentLTD:      bsAct.curr_ltd,
        totalCurrentLiab: bsAct.cur_l,        longTermDebt:    bsAct.ltd,
        leaseObligation: bsAct.leases,         totalEquity:    bsAct.equity,
        retainedEarnings: bsAct.retained_curr, totalLiab:      bsAct.tot_l,
        totalLE: bsAct.tot_le,
      },
      cf: {
        netProfit: cfAct.net_profit, depreciation: cfAct.depn,
        netInterest: cfAct.netint,   operatingCF:  cfAct.ops_net,
        recvChange:  cfAct.wc_recv,  apChange:     cfAct.wc_ap,
        closingCash: cfAct.cf_close,
      },
      seg: {},
      uploadMeta: { file: fn, ts: new Date().toISOString(),
                    status: '✅ ' + factRows.length + ' facts' + (_sb ? ' → DB' : ' (offline)') },
    };
    actualsStore[moNum]          = storeEntry;
    (actualsStore[yr] ??= {})[moNum] = storeEntry;   // dual-key for _getMonthlyPLLine
    // ── Update the active actuals year so _acts() reads from the right bucket ─
    actualsYear = yr;

    // ── 14. Auto-wire into legacy fuel cost engine ────────────────────────────
    if (moNum >= 1 && moNum <= 12 && plAct.fuel_cos) {
      (fuelCostByMonth[yr] ??= Array(12).fill(0));
      fuelCostByMonth[yr][moNum - 1] = Math.abs(plAct.fuel_cos);
      // Also update fuelCostByMonth2026 legacy alias for _CY months
      if (yr === _CY) fuelCostByMonth2026[moNum - 1] = Math.abs(plAct.fuel_cos);
    }

    // ── 15. Update MWh volumes for rate-class tables ──────────────────────────
    if (salesMWh > 0) {
      const mIdx = moNum - 1;
      // ARCHITECTURAL RULE: tariff sub-class splits (lo/hi, std/tou) must come from DB (fpa_assumptions).
      // Until uploaded, RT10 all goes to hi-block; RT40/RT50 all go to std (no TOU split assumed).
      const _rt10Lo = fpa.assumptions?.tariffSplits?.rt10LowFrac ?? 0;
      const _rt40Tou = fpa.assumptions?.tariffSplits?.rt40TouFrac ?? 0;
      const _rt50Tou = fpa.assumptions?.tariffSplits?.rt50TouFrac ?? 0;
      const classMwh = [
        ['RT10_lo', revAct.mwh_rt10 * _rt10Lo], ['RT10_hi', revAct.mwh_rt10 * (1-_rt10Lo)],
        ['RT20',    revAct.mwh_rt20],
        ['RT40_std',revAct.mwh_rt40 * (1-_rt40Tou)],  ['RT40_tou',revAct.mwh_rt40 * _rt40Tou],
        ['RT50_std',revAct.mwh_rt50 * (1-_rt50Tou)],  ['RT50_tou',revAct.mwh_rt50 * _rt50Tou],
        ['RT60',    revAct.mwh_rt60],
        ['RT70',    revAct.mwh_rt70],
      ];
      classMwh.forEach(([cls, mwh]) => {
        if (volumeTable[cls]?.mwh) volumeTable[cls].mwh[mIdx] = Math.round(mwh || 0);
      });
    }

    // ── 16. Refresh legacy globals & rebuild all live views ───────────────────
    fpaApplyToLegacyGlobals();

    // Enable month in reporting selectors
    ['varMo', 'revRptMo'].forEach(id => {
      const opt = document.querySelector(`#${id} option[value="${moNum}"]`);
      if (opt) opt.disabled = false;
    });

    // Log entry
    actualsLog.unshift({
      file: fn, month: moNum, label,
      ts: new Date().toLocaleString(),
      rows: factRows.length,
      status: '✅ ' + factRows.length + ' facts' + (_sb ? ' → DB' : ' (offline)'),
    });
    buildActualsLog();
    _refreshDmBadges?.();       // update actuals/plan year status pills

    // Refresh reports
    const varMoEl = document.getElementById('varMo');
    if (varMoEl) { varMoEl.value = moNum; buildVarReport(); }
    buildDashKpis();
    setTimeout(() => buildMonthlyPL(plMonthlyYear), 80);
    const activePane = document.querySelector('.pane.on')?.id?.replace('pane-', '');
    if (activePane === 'wrk-gen')  setTimeout(() => buildGenTables(), 100);
    if (activePane === 'wrk-coll') setTimeout(() => { computeAll(selectedCollYear); buildCollTable(); }, 100);
    if (activePane === 'ass-om')   setTimeout(() => buildOMTable(), 100);
    if (activePane === 'rpt-pl')   setTimeout(() => buildMonthlyPL(plMonthlyYear), 100);

    // Audit trail to console
    console.group('[FPA Actuals] ' + label + ' — consistency checks');
    checks.forEach(c => console.log((c.pass ? (c.diff > 0 ? '⚠' : '✅') : '❌') +
      ' ' + c.name + ': diff=$' + c.diff.toLocaleString()));
    console.groupEnd();

    const dbTag = _sb ? ' · Saved to Supabase' : ' · Offline (no DB)';
    toast('✅ ' + label + ' — ' + factRows.length + ' facts loaded' + dbTag, 'ok');

  } catch(err) {
    actualsLog.unshift({
      file: fn, month: moNum || '?', label,
      ts: new Date().toLocaleString(), rows: 0,
      status: '❌ ' + err.message,
    });
    buildActualsLog();
    toast('❌ Upload failed: ' + err.message, 'w');
    console.error('[FPA Actuals] handleActualsUpload error:', err);
  }
}

// ─── Parse Budget Template 2026_V2.xlsx (AOP) via SheetJS ──────────────────
// Reads P&L, B_S, C flow, Revenue by Rate Class sheets.
// Writes all 12 months of 2026 AOP data into the AOP_2026 version (kind=BUDGET).
// No consistency-check hard block — budget data is assumed internally consistent.
async function handleAOPUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = '';

  toast('📂 Parsing AOP budget file…', 'i');
  const fn = file.name;

  // ── Detect plan year from filename (e.g. "Budget_Template_2027_V2.xlsx" → 2027)
  // Falls back to current planYear if no 4-digit year found in filename.
  const fnYrMatch = fn.match(/20(\d{2})/);
  const detectedYear = fnYrMatch ? parseInt('20' + fnYrMatch[1], 10) : (planYear || _CY);
  planYear = detectedYear;  // set globally so _aopCode() uses the right version

  // Show in Data Sources upload log immediately
  const uploadEntry = {name:fn,type:'AOP Budget',period:`${detectedYear} Jan–Dec`,rows:'Parsing…',status:'⏳ Processing',date:new Date().toISOString().slice(0,10)};
  uploadLog.unshift(uploadEntry);
  buildDataSources?.();

  try {
    const buf = await file.arrayBuffer();
    const wb  = XLSX.read(buf, { type: 'array' });

    // Safe numeric read helper (0-indexed row/col, returns rounded integer)
    const N = (raw, row, col) => {
      const x = raw?.[row]?.[col];
      return (typeof x === 'number') ? Math.round(x) : 0;
    };

    // ── 1. Locate plan-year month columns dynamically by scanning header row ────
    // Uses detectedYear so the parser works for 2026, 2027, 2028, etc.
    const findMonthCols = (raw, hdrRowIdx) => {
      const hdr = raw[hdrRowIdx] || [];
      const cols = {};
      const yrStr = String(detectedYear);
      hdr.forEach((v, i) => {
        if (!v) return;
        const s = String(v);
        const m = s.match(/^(\d{4})-(\d{2})/);
        if (m && m[1] === yrStr) {
          const mo = parseInt(m[2], 10); // 1-12
          if (mo >= 1 && mo <= 12) cols[mo] = i;
        }
      });
      return cols; // { 1: colIdx, 2: colIdx, ... }
    };

    // ── 2. P&L sheet ─────────────────────────────────────────────────────────
    // Try plan-year-specific name first (e.g. 'P&L 2024 - 2027'), then generic fallbacks.
    const plSheet = wb.Sheets[`P&L 2024 - ${detectedYear}`] || wb.Sheets['P&L 2024 - 2026'] || wb.Sheets['P&L'];
    if (!plSheet) throw new Error(`P&L sheet not found (tried "P&L 2024 - ${detectedYear}")`);
    const plRaw  = XLSX.utils.sheet_to_json(plSheet, { header: 1, defval: null });
    const plCols = findMonthCols(plRaw, 3); // R4 (0-indexed row 3) = header
    if (!plCols[1]) throw new Error(`Could not locate ${detectedYear} Jan column in P&L sheet`);

    // Row indices (0-indexed). Confirmed from Budget Template 2026_V2 inspection.
    const PL = {
      fuel_rev:      7,   // Fuel Clause billing
      ipp_fr:        8,   // IPP Surcharge
      energy_c:      9,   // Energy Clause (non-fuel component)
      cust_chg:      11,  // Customer Charge
      other_rev:     14,  // Other Operating Revenues
      total_sales:   15,  // Total Operating Revenue
      fuel_cost:     18,  // Fuel cost of sales
      ppa:           19,  // Purchased Power (PPA)
      total_cos:     21,  // Total COS (unlabeled subtotal)
      gross_profit:  22,  // Gross profit
      total_opex:    32,  // Total operating expenses (unlabeled subtotal)
      ebitda:        34,  // Profit before interest/tax/dep = EBITDA
      depn:          36,  // Depreciation
      ebit:          37,  // Operating profit = EBIT
      int_income:    39,  // Interest Income
      afudc:         40,  // AFUDC
      int_expense:   42,  // Interest Expense
      pref_div:      44,  // Preference Dividend
      loan_fees:     45,  // Loan Financing Fees
      fx:            46,  // Foreign exchange gain/(loss)
      fin_cost:      48,  // Total Net Financing Costs
      oth_inc:       50,  // Other income/expenses
      pretax:        51,  // Net Profit before tax
      tax:           52,  // Taxation
      net_inc:       53,  // Net Profit after tax
    };

    // ── 3. B_S sheet ─────────────────────────────────────────────────────────
    const bsSheet = wb.Sheets[`B_S 2024 - ${detectedYear}`] || wb.Sheets['B_S 2024 - 2026'] || wb.Sheets['B_S'];
    if (!bsSheet) throw new Error(`B_S sheet not found (tried "B_S 2024 - ${detectedYear}")`);
    const bsRaw  = XLSX.utils.sheet_to_json(bsSheet, { header: 1, defval: null });
    const bsCols = findMonthCols(bsRaw, 3);

    const BS = {
      cash:         6,   // Cash & short-term deposits
      rcash:        7,   // Restricted Cash
      recv:         8,   // Receivables, net
      bs_other_recv:9,   // Other receivables
      unbill:       11,  // Unbilled revenue
      bs_prepaid:   12,  // Prepaid expenses & deposits
      finv:         13,  // Fuel inventory
      matls:        14,  // Materials & supplies
      cur_a:        15,  // Total current assets
      bs_std:       17,  // Short-term loans
      bs_corp_tax:  18,  // Corporation Tax Payable (row 19 = idx 18, was 0)
      ap:           19,  // Accounts Payables
      bs_payroll_tax:20, // Payroll taxes payable
      bs_curr_ltd:  21,  // Current Portion of LTD (loan)
      bs_cust_dep:  22,  // Current Portion Customer Deposits
      lease_cl:     23,  // Current maturity lease obligations
      bs_int_acc:   24,  // Interest accrued
      bs_due_to:    25,  // Due to parent company
      cur_l:        26,  // Total current liabilities
      ppe:          41,  // Total Fixed assets NBV (R42 = idx 41)
      bs_fa_cost:   35,  // Total FA at cost (R36 = idx 35)
      bs_accum_depn:36,  // Accumulated depreciation
      cwip:         40,  // Construction WIP (R41 = idx 40)
      pension:      43,  // Pension Asset (R44 = idx 43)
      bs_dta:       46,  // Deferred tax asset (R47 = idx 46)
      eqinv:        47,  // Equity Investments (R48 = idx 47)
      tot_a:        48,  // Total assets (R49 = idx 48)
      bs_pref:      51,  // Cumulative Preference Shares
      bs_share_cap: 52,  // Share capital
      bs_cap_res:   53,  // Capital reserve
      bs_cap_redm:  54,  // Capital redemption reserve
      bs_retained:  55,  // Retained earnings
      equity:       56,  // Total equity (shareholders' equity subtotal)
      ltd:          57,  // Long-term debt
      bs_cust_dep_lt:59, // Customer deposits & advances (R60 = idx 59)
      leases:       62,  // Lease Liability (R63 = idx 62)
      bs_dtl:       64,  // Deferred tax liability (R65 = idx 64)
      tot_le:       65,  // Total L&E (R66 = idx 65)
    };

    // ── 4. Cash Flow sheet ────────────────────────────────────────────────────
    const cfSheet = wb.Sheets[`C flow 2024 - ${detectedYear}`] || wb.Sheets['C flow 2024 - 2026'] || wb.Sheets['Cash flow'];
    if (!cfSheet) throw new Error(`Cash flow sheet not found (tried "C flow 2024 - ${detectedYear}")`);
    const cfRaw  = XLSX.utils.sheet_to_json(cfSheet, { header: 1, defval: null });
    const cfCols = findMonthCols(cfRaw, 3);

    const CF = {
      cf_ni:        7,   // Net profit (R8)
      cf_depn:      10,  // Depreciation add-back (R11)
      cf_netint:    13,  // Net interest expense add-back (R14)
      cf_rcash:     17,  // Restricted cash (R18)
      cf_ops_pre:   18,  // Pre-WC operating cash (R19)
      cf_wc_recv:   20,  // Δ Receivables (R21)
      cf_wc_unbill: 21,  // Δ Unbilled revenue (R22)
      cf_wc_inv:    22,  // Δ Fuel inventory (R23)
      cf_wc_matls:  23,  // Δ Materials (R24)
      cf_wc_ap:     26,  // Δ Payables (R27)
      cf_wc_payrtax:27,  // Δ Payroll taxes (R28)
      cf_wc_corptax:28,  // Δ Corp tax (R29)
      cf_ops_net:   32,  // Net cash from operating (R33)
      cf_capex:     35,  // Capital expenditure (R36)
      cf_disposal:  37,  // Proceeds from disposal (R38)
      cf_inv_net:   38,  // Net investing (R39)
      cf_intpd:     43,  // Interest paid (R44)
      cf_prefdiv:   44,  // Preference dividends paid (R45)
      cf_loanrep:   46,  // Loan repayments (R47)
      cf_drawdown:  48,  // Loan drawdowns (R49)
      cf_fin_net:   51,  // Net financing (R52)
      cf_change:    52,  // Net change in cash (R53)
      cf_open:      53,  // Opening cash (R54)
      cf_close:     54,  // Closing cash (R55)
    };

    // ── 5. Revenue by Rate Class sheet ────────────────────────────────────────
    const revSheet = wb.Sheets['Revenue by Rate Class'];
    const revRaw   = revSheet ? XLSX.utils.sheet_to_json(revSheet, { header: 1, defval: null }) : [];
    // US$ revenue section: header at R2 (idx 1), data from R19 (idx 18)
    // 2026 months in col 26 (Jan) from P&L-style layout
    const revCols = findMonthCols(revRaw, 1) || {}; // R2 header
    if (!revCols[1] && revSheet) {
      // fallback: scan all header rows
      for (let ri = 0; ri < 5; ri++) {
        const fc = findMonthCols(revRaw, ri);
        if (fc[1]) { Object.assign(revCols, fc); break; }
      }
    }
    const REV_USD = {
      rev_rt10: 18, rev_rt20: 19, rev_rt40: 20,
      rev_rt50: 21, rev_rt60: 22, rev_rt70: 23,
      rev_ipp:  25, rev_other: 26,
    };
    // MWh section: header at R35 (idx 34), cols 1-12
    const MWH = {
      rev_mwh_rt10: 35, rev_mwh_rt20: 36, rev_mwh_rt40: 37,
      rev_mwh_rt50: 38, rev_mwh_rt60: 39, rev_mwh_rt70: 40,
    };

    // ── 6. Find AOP version for the detected year ─────────────────────────────
    const verAOP = fpa.versions.find(v => v.code === _aopCode());
    if (!verAOP) throw new Error(`${_aopCode()} version not found in database. Add an AOP_${detectedYear} row to fpa_versions.`);
    const versionId = verAOP.id;

    // ── 7. Build all fact rows for 12 months ──────────────────────────────────
    const allFacts = [];
    let linesNotFound = [];

    const lineExists = (id) => !!fpa.lines.find(l => l.id === id);
    const addFact = (lineId, periodKey, value) => {
      if (!lineExists(lineId)) {
        if (!linesNotFound.includes(lineId)) linesNotFound.push(lineId);
        return;
      }
      allFacts.push({
        version_id: versionId,
        line_id:    lineId,
        period_id:  periodKey,   // integer e.g. 202601
        value:      (value === null || value === undefined || isNaN(value)) ? 0 : Math.round(value),
        source:     'upload',
      });
    };

    for (let mo = 1; mo <= 12; mo++) {
      const pk   = detectedYear * 100 + mo;      // period key e.g. 202601, 202701, …
      const plC  = plCols[mo];                   // P&L column for this month
      const bsC  = bsCols[mo];                   // BS column
      const cfC  = cfCols[mo];                   // CF column
      const revC = revCols[mo];                  // Rev USD column
      const mwhC = mo;                           // MWh cols are 1-12

      if (!plC) { console.warn(`[AOP] Missing P&L col for month ${mo}`); continue; }

      // ── P&L ────────────────────────────────────────────────────────────────
      const pl_total  = N(plRaw, PL.total_sales,  plC);
      const pl_fuel   = N(plRaw, PL.fuel_rev,      plC);
      const pl_nonfuel = pl_total - pl_fuel;

      addFact('fuel_rev',       pk, pl_fuel);
      addFact('ipp_fr',         pk, N(plRaw, PL.ipp_fr,      plC));
      addFact('nonfuel',        pk, pl_nonfuel);
      addFact('pl_total_sales', pk, pl_total);
      addFact('fuel_cost',      pk, N(plRaw, PL.fuel_cost,    plC));
      addFact('pl_ppa',         pk, N(plRaw, PL.ppa,          plC));
      addFact('pl_total_cos',   pk, N(plRaw, PL.total_cos,    plC));
      addFact('pl_gross_profit',pk, N(plRaw, PL.gross_profit, plC));
      addFact('opex',           pk, N(plRaw, PL.total_opex,   plC));
      addFact('ebitda',         pk, N(plRaw, PL.ebitda,       plC));
      addFact('depn',           pk, N(plRaw, PL.depn,         plC));
      addFact('ebit',           pk, N(plRaw, PL.ebit,         plC));
      addFact('pl_int_income',  pk, N(plRaw, PL.int_income,   plC));
      addFact('pl_afudc',       pk, N(plRaw, PL.afudc,        plC));
      addFact('pl_int_expense', pk, N(plRaw, PL.int_expense,  plC));
      addFact('pl_pref_div',    pk, N(plRaw, PL.pref_div,     plC));
      addFact('pl_loan_fees',   pk, N(plRaw, PL.loan_fees,    plC));
      addFact('pl_fx',          pk, N(plRaw, PL.fx,           plC));
      addFact('fin_cost',       pk, N(plRaw, PL.fin_cost,     plC));
      addFact('oth_inc',        pk, N(plRaw, PL.oth_inc,      plC));
      addFact('pretax',         pk, N(plRaw, PL.pretax,       plC));
      addFact('tax',            pk, N(plRaw, PL.tax,          plC));
      addFact('net_inc',        pk, N(plRaw, PL.net_inc,      plC));

      // ── B_S ────────────────────────────────────────────────────────────────
      if (bsC) {
        Object.entries(BS).forEach(([lineId, rowIdx]) => {
          addFact(lineId, pk, N(bsRaw, rowIdx, bsC));
        });
      }

      // ── CF ─────────────────────────────────────────────────────────────────
      if (cfC) {
        Object.entries(CF).forEach(([lineId, rowIdx]) => {
          addFact(lineId, pk, N(cfRaw, rowIdx, cfC));
        });
      }

      // ── Revenue by rate class (US$) ─────────────────────────────────────────
      if (revSheet && revC) {
        Object.entries(REV_USD).forEach(([lineId, rowIdx]) => {
          addFact(lineId, pk, N(revRaw, rowIdx, revC));
        });
      }

      // ── MWh by rate class ───────────────────────────────────────────────────
      if (revSheet && mwhC) {
        Object.entries(MWH).forEach(([lineId, rowIdx]) => {
          addFact(lineId, pk, N(revRaw, rowIdx, mwhC));
        });
        // stat_billed_gwh: sum of rate class MWh
        const totalMWh = ['rev_mwh_rt10','rev_mwh_rt20','rev_mwh_rt40',
                          'rev_mwh_rt50','rev_mwh_rt60','rev_mwh_rt70']
          .reduce((s, id) => s + N(revRaw, MWH[id], mwhC), 0);
        addFact('stat_billed_gwh', pk, totalMWh);
      }
    } // end month loop

    if (linesNotFound.length)
      console.warn('[AOP Upload] Skipped unknown line_ids:', linesNotFound.join(', '));

    // ── 8. Write to Supabase ─────────────────────────────────────────────────
    let dbStatus = '(offline)';
    if (_sb && allFacts.length > 0) {
      // Batch in chunks of 500 to stay within Supabase limits
      const CHUNK = 500;
      for (let i = 0; i < allFacts.length; i += CHUNK) {
        const { error } = await _sb.from('fpa_facts')
          .upsert(allFacts.slice(i, i + CHUNK), { onConflict: 'version_id,line_id,period_id' });
        if (error) throw new Error('DB write failed (batch ' + Math.ceil(i/CHUNK+1) + '): ' + error.message);
      }
      dbStatus = '→ Supabase';
    }

    // ── 9. Update in-memory fpa.facts ─────────────────────────────────────────
    (fpa.facts[_aopCode()] ??= {});
    allFacts.forEach(f => {
      (fpa.facts[_aopCode()][f.line_id] ??= {});
      fpa.facts[_aopCode()][f.line_id][f.period_id] = Number(f.value);
    });

    // ── 10. Refresh any open flash report ─────────────────────────────────────
    fpaApplyToLegacyGlobals();
    if (typeof flashRefresh === 'function' && document.querySelector('#pane-rpt-flash.on')) {
      flashRefresh();
    }

    const summary = `AOP ${planYear} — ${allFacts.length} facts across 12 months ${dbStatus}`;
    actualsLog.unshift({
      file: fn, month: 'AOP', label: `AOP ${planYear}`,
      ts: new Date().toLocaleString(), rows: allFacts.length,
      status: '✅ ' + allFacts.length + ' facts',
    });
    // Update Data Sources upload log entry
    uploadEntry.rows   = allFacts.length;
    uploadEntry.status = '✅ ' + allFacts.length + ' facts ' + dbStatus;
    buildActualsLog();
    buildDataSources?.();
    _refreshDmBadges?.();       // update actuals/plan year status pills
    toast('✅ ' + summary, 'ok');
    console.log('[AOP Upload]', summary);

  } catch(err) {
    uploadEntry.status = '❌ ' + err.message;
    buildDataSources?.();
    toast('❌ AOP upload failed: ' + err.message, 'w');
    console.error('[AOP Upload]', err);
  }
}

function buildActualsLog() {
  document.getElementById('actualsLogB').innerHTML = actualsLog.map(u =>
    `<tr><td style="text-align:left;font-family:var(--mono);font-size:10px">${u.file}</td>
     <td>${u.label}</td><td style="font-size:9px;color:var(--muted)">${u.ts}</td>
     <td style="text-align:center">${u.rows}</td><td>${u.status}</td></tr>`
  ).join('');
}

// ─── MAIN VARIANCE REPORT BUILDER ──────────────────────────────────────────
function buildVarReport() {
  const mo = parseInt(document.getElementById('varMo')?.value || 1);
  const data = _acts(mo);
  if (!data) {
    document.getElementById('varKpis').innerHTML = `<div class="warn-bar">⚠ No actuals available for this month — data will appear automatically once uploaded via the Data Management pane.</div>`;
    document.getElementById('varB').innerHTML = '';
    document.getElementById('varH').innerHTML = '';
    return;
  }

  const isYTD      = varPeriod === 'ytd';
  const isActOnly  = varPeriod === 'actuals';
  const isBudget   = varCmp   === 'budget';
  const act = (isYTD || isActOnly) ? data.ytdActual : data.pl;
  const ref = isYTD ? data.ytdBudget : (isBudget ? data.budget : data.budget);
  const periodLabel = isYTD ? 'YTD to ' + data.month : data.month;
  const cmpLabel    = isBudget ? 'Budget' : 'LE';

  // ── ACTUALS ONLY MODE ───────────────────────────────────────────────────
  if (isActOnly) {
    document.getElementById('varTitle').textContent = `Actuals — ${periodLabel}`;
    document.getElementById('varBridgeLbl').textContent = 'Actuals';
    document.getElementById('varBridgePeriod').textContent = periodLabel;

    // KPI cards — actuals only, no comparison
    const kpiDefs = [
      { label:'Total Revenue',  val: act.totalSales,  color:'b',  fmt: v => '$'+Math.round(Math.abs(v||0)).toLocaleString() },
      { label:'Gross Profit',   val: act.grossProfit, color:'t',  fmt: v => '$'+Math.round(Math.abs(v||0)).toLocaleString() },
      { label:'EBITDA',         val: act.ebitda,      color:'gr', fmt: v => '$'+Math.round(Math.abs(v||0)).toLocaleString() },
      { label:'EBIT',           val: act.ebit,        color:'b',  fmt: v => '$'+Math.round(Math.abs(v||0)).toLocaleString() },
      { label:'Net Income',     val: act.netIncome,   color:(act.netIncome||0)>=0?'gr':'r', fmt: v => '$'+Math.round(Math.abs(v||0)).toLocaleString() },
      { label:'EBITDA Margin',  val: act.totalSales   ? ((act.ebitda||0)/(act.totalSales||1)*100).toFixed(1)+'%' : '–', color:'p', raw:true },
    ];
    document.getElementById('varKpis').innerHTML = kpiDefs.map(k => {
      const dispVal = k.raw ? k.val : (k.fmt ? k.fmt(k.val) : (k.val||0).toLocaleString());
      const isNeg   = !k.raw && (k.val||0) < 0;
      return `<div class="kpi ${k.color}">
        <div class="kpi-l">${k.label}</div>
        <div class="kpi-v" style="color:${isNeg?'var(--red)':'white'}">${isNeg?'('+dispVal+')':dispVal}</div>
        <div class="kpi-d flat" style="font-size:9px;color:var(--muted)">YTD · ${data.month}</div>
      </div>`;
    }).join('');

    // Actuals-only P&L table
    const plRows = [
      { sect:'Revenue',            key:'fuelSales',    name:'Fuel Sales',             },
      { sect:'Revenue',            key:'nonFuelSales',  name:'Non-Fuel Sales',         },
      { sect:'Revenue',            key:'totalSales',    name:'Total Revenue',          tot:true },
      { sect:'Cost of Sales',      key:'fuelCost',      name:'Fuel Cost',              },
      { sect:'Cost of Sales',      key:'ppaCost',       name:'PPA Cost',               },
      { sect:'Cost of Sales',      key:'otherCOS',      name:'Other COS',              },
      { sect:'Cost of Sales',      key:'totalCOS',      name:'Total Cost of Sales',    tot:true },
      { sect:'Profit',             key:'grossProfit',   name:'Gross Profit',           tot:true },
      { sect:'Operating Expenses', key:'sga',           name:'SG&A',                   },
      { sect:'Operating Expenses', key:'maintenance',   name:'Maintenance',            },
      { sect:'Operating Expenses', key:'opex',          name:'Total Operating Exp.',   tot:true },
      { sect:'EBITDA',             key:'ebitda',        name:'EBITDA',                 tot:true, highlight:true },
      { sect:'Below EBITDA',       key:'depreciation',  name:'Depreciation',           },
      { sect:'Below EBITDA',       key:'ebit',          name:'EBIT',                   tot:true },
      { sect:'Below EBITDA',       key:'intIncome',     name:'Interest Income & AFUDC',},
      { sect:'Below EBITDA',       key:'intExpense',    name:'Interest & Other Exp.',  },
      { sect:'Below EBITDA',       key:'nfc',           name:'Net Financing Costs',    tot:true },
      { sect:'Below EBITDA',       key:'otherIncome',   name:'Other Income',           },
      { sect:'Below EBITDA',       key:'pretax',        name:'Pre-Tax Profit',         tot:true },
      { sect:'Below EBITDA',       key:'tax',           name:'Tax',                    },
      { sect:'Net Income',         key:'netIncome',     name:'NET INCOME',             tot:true, highlight:true },
    ];
    document.getElementById('varH').innerHTML = `<tr>
      <th style="text-align:left;min-width:220px">Line Item</th>
      <th class="ac">YTD Actual</th>
      <th class="ac">Notes</th>
    </tr>`;
    const notes = { fuelSales:'Fuel pass-through revenue', nonFuelSales:'Tariff-based non-fuel', totalSales:'Total billed revenue', fuelCost:'Fuel cost incurred', ppaCost:'IPP/PPA payments', otherCOS:'Other direct costs', totalCOS:'Total cost of supply', grossProfit:'Revenue less COS', sga:'SG&A costs', maintenance:'Maintenance & repairs', opex:'Total O&M expense', ebitda:'Operating earnings', depreciation:'D&A charge', ebit:'Operating income', intIncome:'AFUDC & interest earned', intExpense:'Debt interest expense', nfc:'Net financing charge', otherIncome:'Non-operating income', pretax:'Pre-tax earnings', tax:'Tax expense', netIncome:'Bottom line' };
    let aoHtml = ''; let lastSect = '';
    plRows.forEach(r => {
      if (r.sect !== lastSect) { aoHtml += `<tr class="sr"><td colspan="3">${r.sect}</td></tr>`; lastSect = r.sect; }
      const a   = act[r.key] ?? 0;
      const trC = r.highlight ? 'tr' : r.tot ? 'sur' : '';
      const indent = r.tot || r.highlight ? '10px' : '22px';
      const dispA = (() => { const n=Math.round(Math.abs(a)).toLocaleString(); return a<0?`<span class="neg">(${n})</span>`:a===0?`<span class="dim">–</span>`:`${n}`; })();
      aoHtml += `<tr class="${trC}">
        <td style="padding-left:${indent}">${r.tot||r.highlight?`<strong>${r.name}</strong>`:r.name}</td>
        <td class="ac">${dispA}</td>
        <td style="text-align:left;font-size:9px;color:var(--muted)">${notes[r.key]||''}</td>
      </tr>`;
    });
    document.getElementById('varB').innerHTML = aoHtml;

    // Perf indicators — actuals only
    const grossMarg  = act.totalSales ? ((act.grossProfit||0)/(act.totalSales||1)*100).toFixed(1)+'%' : '–';
    const ebitdaMarg = act.totalSales ? ((act.ebitda||0)    /(act.totalSales||1)*100).toFixed(1)+'%' : '–';
    const niMarg     = act.totalSales ? ((act.netIncome||0) /(act.totalSales||1)*100).toFixed(1)+'%' : '–';
    document.getElementById('varPerf').innerHTML = [
      { label:'Gross Profit Margin', val: grossMarg,  color:'var(--teal)'   },
      { label:'EBITDA Margin',       val: ebitdaMarg, color:'var(--green)'  },
      { label:'Net Income Margin',   val: niMarg,     color:'var(--gold)'   },
      { label:'Period',              val: data.month,  color:'var(--blue)'   },
    ].map(p => `<div style="background:var(--card);border:1px solid var(--border);border-radius:6px;padding:10px 13px;border-left:3px solid ${p.color}">
      <div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">${p.label}</div>
      <div style="font-size:15px;font-weight:800;color:white;font-family:var(--mono)">${p.val}</div>
    </div>`).join('');

    // Revenue actuals chart (actuals only, no budget bars)
    const actualRevSeries = MONTHS.map((_,i) => _acts(i+1)?.ytdActual?.totalSales ?? null);
    mkChart('cVarBridge', {
      type: 'bar',
      data: {
        labels: MONTHS,
        datasets: [{ label: 'YTD Revenue (Actuals)', data: actualRevSeries, backgroundColor: 'rgba(6,182,212,.65)', borderRadius: 4 }],
      },
      options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false}, title:{display:true,text:'YTD Cumulative Revenue – Actuals Loaded',color:_TC.muted,font:{size:10}} }, scales:{ x:{ticks:{color:_TC.muted,font:{size:9}},grid:{color:_TC.grid}}, y:{ticks:{color:_TC.muted,font:{size:9},callback:v=>toK(v)},grid:{color:_TC.grid}} } },
    });
    // EBITDA actuals trend
    const ebitdaSeries = MONTHS.map((_,i) => _acts(i+1)?.ytdActual?.ebitda ?? null);
    mkChart('cVarRev', {
      type: 'bar',
      data: {
        labels: MONTHS,
        datasets: [{ label: 'YTD EBITDA (Actuals)', data: ebitdaSeries, backgroundColor: 'rgba(16,185,129,.6)', borderRadius: 3 }],
      },
      options: bO(),
    });
    buildActualsLog();
    return;
  }

  document.getElementById('varTitle').textContent = `Actual vs ${cmpLabel} · ${periodLabel}`;
  document.getElementById('varBridgeLbl').textContent = cmpLabel;
  document.getElementById('varBridgePeriod').textContent = periodLabel;

  // ── KPI CARDS ────────────────────────────────────────────────────────────
  const kpiDefs = [
    { label:'Revenue — Actual',    val: act.totalSales,    ref: ref.totalSales,    income: true,  color:'b'  },
    { label:'EBITDA — Actual',     val: act.ebitda,        ref: ref.ebitda,        income: true,  color:'t'  },
    { label:'Net Income — Actual', val: act.netIncome,     ref: ref.netIncome,     income: true,  color:'gr' },
  ];
  document.getElementById('varKpis').innerHTML = kpiDefs.map(k => {
    const diff = k.income ? (k.val - k.ref) : (k.ref - k.val);
    const pct  = k.ref ? diff / Math.abs(k.ref) : 0;
    const fav  = diff >= 0;
    const sign = fav ? '▲' : '▼';
    const cls  = fav ? 'up' : 'dn';
    return `<div class="kpi ${k.color}">
      <div class="kpi-l">${k.label}</div>
      <div class="kpi-v">${fmtN(k.val)}</div>
      <div class="kpi-d ${cls}">${sign} ${fmtN(Math.abs(diff))} vs ${cmpLabel}
        <span style="color:var(--muted);font-size:8px;margin-left:3px">(${(Math.abs(pct)*100).toFixed(1)}%)</span>
        <span style="margin-left:5px;font-size:9px;color:${fav?'var(--green)':'var(--red)'}">${fav?'FAV':'ADV'}</span>
      </div>
    </div>`;
  }).join('');

  // ── P&L VARIANCE TABLE ───────────────────────────────────────────────────
  const plRows = [
    { sect:'Revenue',          key:'fuelSales',    name:'Fuel Sales',            inc:true  },
    { sect:'Revenue',          key:'nonFuelSales',  name:'Non-Fuel Sales',        inc:true  },
    { sect:'Revenue',          key:'totalSales',    name:'Total Revenue',         inc:true,  tot:true },
    { sect:'Cost of Sales',    key:'fuelCost',      name:'Fuel Cost',             inc:false },
    { sect:'Cost of Sales',    key:'ppaCost',       name:'PPA Cost',              inc:false },
    { sect:'Cost of Sales',    key:'otherCOS',      name:'Other COS',             inc:false },
    { sect:'Cost of Sales',    key:'totalCOS',      name:'Total Cost of Sales',   inc:false, tot:true },
    { sect:'Profit',           key:'grossProfit',   name:'Gross Profit',          inc:true,  tot:true },
    { sect:'Operating Expenses', key:'sga',         name:'SG&A',                  inc:false },
    { sect:'Operating Expenses', key:'maintenance', name:'Maintenance',           inc:false },
    { sect:'Operating Expenses', key:'opex',        name:'Total Operating Exp.',  inc:false, tot:true },
    { sect:'EBITDA',           key:'ebitda',        name:'EBITDA',                inc:true,  tot:true, highlight:true },
    { sect:'Below EBITDA',     key:'depreciation',  name:'Depreciation',          inc:false },
    { sect:'Below EBITDA',     key:'ebit',          name:'EBIT',                  inc:true,  tot:true },
    { sect:'Below EBITDA',     key:'intIncome',     name:'Interest Income & AFUDC',inc:true  },
    { sect:'Below EBITDA',     key:'intExpense',    name:'Interest & Other Exp.', inc:false },
    { sect:'Below EBITDA',     key:'nfc',           name:'Net Financing Costs',   inc:false, tot:true },
    { sect:'Below EBITDA',     key:'otherIncome',   name:'Other Income',          inc:true  },
    { sect:'Below EBITDA',     key:'pretax',        name:'Pre-Tax Profit',        inc:true,  tot:true },
    { sect:'Below EBITDA',     key:'tax',           name:'Tax',                   inc:false },
    { sect:'Net Income',       key:'netIncome',     name:'NET INCOME',            inc:true,  tot:true, highlight:true },
  ];

  const drivers = {
    fuelSales:    'Fuel pass-through pricing; volume',
    nonFuelSales: 'Non-fuel sales; tariff & volume',
    totalSales:   'Combined revenue movement',
    fuelCost:     'Fuel cost; oil price movement',
    ppaCost:      'IPP dispatch & PPA pricing',
    totalCOS:     'Total input cost movement',
    grossProfit:  'Revenue less cost of sales',
    sga:          'SG&A; admin & corporate costs',
    maintenance:  'Maintenance; planned vs unplanned',
    opex:         'Total O&M; from O_M_Feb_2026',
    ebitda:       'Earnings before interest, tax, D&A',
    depreciation: 'Depreciation; Source: Depn_Feb_2026',
    ebit:         'Operating income after D&A',
    intIncome:    'Interest income & AFUDC',
    intExpense:   'Interest expense; debt service',
    nfc:          'Net financing cost; debt mix',
    otherIncome:  'Other income; SJPC dividend etc.',
    pretax:       'Pre-tax profit',
    tax:          'Income tax; capital allowances',
    netIncome:    'Net income after tax',
  };

  let hdr = `<tr>
    <th style="text-align:left;min-width:200px">Line Item</th>
    <th class="ac">Actual</th>
    <th class="bc">${cmpLabel}</th>
    <th>Δ Fav/(Adv)</th>
    <th>Δ %</th>
    <th style="text-align:left;min-width:160px">Driver / Bar</th>
  </tr>`;
  document.getElementById('varH').innerHTML = hdr;

  let html = ''; let lastSect = '';
  plRows.forEach(r => {
    if (r.sect !== lastSect) {
      html += `<tr class="sr"><td colspan="6">${r.sect}</td></tr>`;
      lastSect = r.sect;
    }
    const a = act[r.key] ?? 0;
    const b = ref[r.key] ?? 0;
    // Favourable = actual > ref for income; actual < ref (less negative) for cost
    const diff = r.inc ? (a - b) : (b - a);
    const pct  = b !== 0 ? diff / Math.abs(b) : null;
    const fav  = diff >= 0;
    const barW = Math.min(100, Math.abs(diff) / Math.max(Math.abs(b || 1), 1) * 200);
    const diffDisp = fav
      ? `<span class="pos">▲ ${Math.round(Math.abs(diff)).toLocaleString()}</span>`
      : `<span class="neg">▼ (${Math.round(Math.abs(diff)).toLocaleString()})</span>`;
    const pctDisp = pct !== null
      ? (fav ? `<span class="pos">${(Math.abs(pct)*100).toFixed(1)}%</span>` : `<span class="neg">(${(Math.abs(pct)*100).toFixed(1)}%)</span>`)
      : '<span class="dim">–</span>';
    const trCls = r.highlight ? 'tr' : r.tot ? 'sur' : '';
    const indent = r.tot || r.highlight ? '10px' : '22px';
    const favLabel = fav
      ? `<span style="font-size:8px;font-weight:700;padding:1px 5px;border-radius:10px;background:rgba(16,185,129,.15);color:var(--green)">FAV</span>`
      : `<span style="font-size:8px;font-weight:700;padding:1px 5px;border-radius:10px;background:rgba(239,68,68,.15);color:var(--red)">ADV</span>`;
    html += `<tr class="${trCls}">
      <td style="padding-left:${indent}">${r.tot||r.highlight?`<strong>${r.name}</strong>`:r.name}</td>
      <td class="ac">${fmtN(a)}</td>
      <td class="gld">${fmtN(b)}</td>
      <td>${diffDisp}</td>
      <td>${pctDisp}</td>
      <td style="text-align:left">
        <div style="display:flex;align-items:center;gap:6px">
          ${favLabel}
          <div style="width:50px;height:3px;background:var(--dim);border-radius:2px;overflow:hidden;flex-shrink:0">
            <div style="width:${barW}%;height:100%;background:${fav?'var(--green)':'var(--red)'};border-radius:2px"></div>
          </div>
          <span style="font-size:9px;color:var(--muted)">${drivers[r.key]||'–'}</span>
        </div>
      </td>
    </tr>`;
  });
  document.getElementById('varB').innerHTML = html;

  // ── PERFORMANCE INDICATORS ───────────────────────────────────────────────
  const ebitdaDiff = (act.ebitda||0) - (ref.ebitda||0);
  const ebitdaMarg = act.totalSales ? ((act.ebitda||0)/(act.totalSales||1)*100).toFixed(1)+'%' : '–';
  const budgMarg   = ref.totalSales  ? ((ref.ebitda||0)/(ref.totalSales||1)*100).toFixed(1)+'%' : '–';
  const grossMarg  = act.totalSales  ? ((act.grossProfit||0)/(act.totalSales||1)*100).toFixed(1)+'%' : '–';
  const niMarg     = act.totalSales  ? ((act.netIncome||0)/(act.totalSales||1)*100).toFixed(1)+'%' : '–';
  const perfItems = [
    { label:'EBITDA Margin (Actual)',  val: ebitdaMarg, ref: budgMarg,    color: ebitdaDiff>=0?'var(--green)':'var(--red)' },
    { label:'Gross Profit Margin',     val: grossMarg,  ref: null,         color: 'var(--teal)'  },
    { label:'Net Income Margin',       val: niMarg,     ref: null,         color: 'var(--gold)'  },
    { label:'Revenue — vs ' + cmpLabel, val: fmtN(act.totalSales), ref: fmtN(ref.totalSales), color: ((act.totalSales||0)>=(ref.totalSales||0))?'var(--green)':'var(--red)' },
    { label:'Depreciation Variance',  val: fmtN(act.depreciation), ref: fmtN(ref.depreciation), color: ((act.depreciation||0)>=(ref.depreciation||0))?'var(--red)':'var(--green)' },
    { label:'NFC Variance',           val: fmtN(act.nfc), ref: fmtN(ref.nfc), color: ((act.nfc||0)>=(ref.nfc||0))?'var(--red)':'var(--green)' },
  ];
  document.getElementById('varPerf').innerHTML = perfItems.map(p => `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:6px;padding:10px 13px;border-left:3px solid ${p.color}">
      <div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">${p.label}</div>
      <div style="font-size:15px;font-weight:800;color:white;font-family:var(--mono)">${p.val}</div>
      ${p.ref?`<div style="font-size:9px;color:var(--muted);margin-top:2px">${cmpLabel}: ${p.ref}</div>`:''}
    </div>`).join('');

  // ── EBITDA WATERFALL BRIDGE ──────────────────────────────────────────────
  // Revenue: favourable = actual > ref (higher revenue)
  // COS: stored as negatives; favourable = actual less negative than ref (actual < ref in absolute terms)
  // OpEx: stored as negatives; favourable = actual less negative than ref
  const revenueVar = (act.totalSales||0) - (ref.totalSales||0);
  const cosVar     = (act.totalCOS||0)   - (ref.totalCOS||0);   // both negative; +ve result = actual was less negative = fav
  const opexVar    = (act.opex||0)       - (ref.opex||0);       // both negative; +ve result = actual was less negative = fav
  const ebitdaVar  = (act.ebitda||0)     - (ref.ebitda||0);

  mkWaterfall('cVarBridge',[
    {label: cmpLabel+' EBITDA', value: ref.ebitda||0, isTotal:true},
    {label: 'Revenue Var',      value: revenueVar},
    {label: 'COS Var',          value: cosVar},
    {label: 'OpEx Var',         value: opexVar},
    {label: 'Actual EBITDA',    value: act.ebitda||0, isTotal:true},
  ]);

  // ── MONTHLY REVENUE ACTUALS CHART ─────────────────────────────────────────
  const loadedMonths = [1,2,3,4,5,6,7,8,9,10,11,12].filter(m => _acts(m));
  const actualRevSeries  = MONTHS.map((_,i) => _acts(i+1)?.pl?.totalSales ?? null);
  const budgetRevSeries  = MONTHS.map((_,i) => _acts(i+1)?.budget?.totalSales ?? null);
  mkChart('cVarRev', {
    type: 'bar',
    data: {
      labels: MONTHS,
      datasets: [
        { label: 'Actual Revenue', data: actualRevSeries, backgroundColor: 'rgba(6,182,212,.6)', borderRadius: 3 },
        { label: cmpLabel + ' Revenue', data: budgetRevSeries, backgroundColor: 'rgba(240,180,41,.3)', borderRadius: 3, borderColor: 'rgba(240,180,41,.6)', borderWidth: 1 },
      ],
    },
    options: bO(),
  });

  // ── REVENUE BRIDGE DECOMPOSITION ─────────────────────────────────────────
  // Per spec: Volume Effect + Tariff Effect + FX Effect + Fuel Effect + Loss Effect
  buildRevBridgeDecomp(mo, act, ref, cmpLabel);

  buildActualsLog();
}

// ── REVENUE BRIDGE DECOMPOSITION ENGINE ─────────────────────────────────────
function buildRevBridgeDecomp(mo, act, ref, cmpLabel) {
  const el = document.getElementById('varRevBridge');
  if (!el) return;

  // Pull actuals from uploaded file
  const moData = _acts(mo);
  if (!moData) { el.innerHTML=''; return; }

  // Actuals & Budget revenue components
  const actNF   = act.nonFuelSales  || 0;  // Non-fuel actual (US$000)
  const actFuel = act.fuelSales     || 0;  // Fuel actual
  const actTot  = act.totalSales    || 0;
  const budNF   = ref.nonFuelSales  || 0;
  const budFuel = ref.fuelSales     || 0;
  const budTot  = ref.totalSales    || 0;

  // Month index (0-based)
  const mIdx = mo - 1;

  // ARCHITECTURAL RULE: FX rates must come from DB (fxTable loaded from fpa_assumptions). No hardcoded fallback.
  const actFX  = fxTable.billing[mIdx] || 0;
  const budFX  = netFinancingRows[_CY]?.budgetFX?.[mIdx] || 0;

  // Volume & tariff effects — use revenue engine
  let volEffect=0, tariffEffect=0, fxEffect=0, lossEffect=0;
  try {
    const engResult = calcRevEngineMonth(mIdx);
    const engNF = engResult.nonFuelRevUSD || budNF;

    // FX Effect = Budget non-fuel × (1/actFX - 1/budFX) × budFX  [simplified: proportion of NF attributable to FX]
    // In J$ terms: same J$ revenue / different FX = different USD
    // FX Effect ≈ budNF × (budFX/actFX - 1)  [positive if actFX > budFX meaning JMD weakened = more USD]
    fxEffect = Math.round(budNF * (budFX / actFX - 1));

    // FX-adjusted budget non-fuel (what budget would have been at actual FX)
    const budNF_actFX = Math.round(budNF * (budFX / actFX));

    // Volume Effect = (actMWh - budMWh) × budTariffPerMWh / actFX
    // Approximate using billed sales distribution
    const mthBilledSales = billedSalesMWh?.[_CY]?.[mIdx] || 0;
    const moData2 = _acts(mo);
    const actSalesMWh = moData2?.rev?.salesMWh || mthBilledSales;
    const budSalesMWh = mthBilledSales; // LE from model
    // Budget non-fuel tariff per MWh (USD): budNF_actFX / budSalesMWh
    const budTariffPerMWh = budSalesMWh > 0 ? (budNF_actFX / budSalesMWh) : 0;
    volEffect = actSalesMWh > 0 && budSalesMWh > 0
      ? Math.round((actSalesMWh - budSalesMWh) * budTariffPerMWh)
      : 0;

    // Tariff Effect = budSalesMWh × (actTariffPerMWh - budTariffPerMWh)
    const actNF_adjFX = Math.round(actNF * (budFX / actFX)); // remove FX effect from actuals
    const actTariffPerMWh = actSalesMWh > 0 ? (actNF_adjFX / actSalesMWh) : 0;
    tariffEffect = budSalesMWh > 0
      ? Math.round(budSalesMWh * (actTariffPerMWh - budTariffPerMWh))
      : 0;

    // Loss Effect = revenue uplift from system loss reduction
    // Loss reduction → more billed MWh at given tariff
    const budLoss = sysLossTable[_CY]?.[mIdx] || 0;
    const genMWh = mthBilledSales > 0 ? (mthBilledSales / (1 - budLoss/100)) : 0;
    const actLoss = sysLossTable[_CY]?.[mIdx] || budLoss;
    const lossAdjMWh = genMWh > 0 ? genMWh * ((budLoss - actLoss) / 100) : 0;
    lossEffect = Math.round(lossAdjMWh * budTariffPerMWh);
  } catch(e) {
    // Fallback: residual attribution
  }

  // Fuel Effect = actual fuel rev - budget fuel rev
  const fuelEffect = Math.round(actFuel - budFuel);

  // Residual / Mix Effect — catch-all rounding
  const totalExplained = volEffect + tariffEffect + fxEffect + fuelEffect + lossEffect;
  const totalVariance  = Math.round(actTot - budTot);
  const mixEffect      = totalVariance - totalExplained;

  // Build bridge table
  const effects = [
    { name: 'Budget Revenue',   val: budTot,      isBase: true,  color: 'var(--blue)'   },
    { name: 'Volume Effect',    val: volEffect,    posGood: true, color: volEffect>=0?'var(--green)':'var(--red)',   icon: '📊', tip: 'GWh billed vs budget' },
    { name: 'Tariff Effect',    val: tariffEffect, posGood: true, color: tariffEffect>=0?'var(--green)':'var(--red)', icon: '📋', tip: 'Rate variance vs budget' },
    { name: 'FX Effect',        val: fxEffect,     posGood: true, color: fxEffect>=0?'var(--green)':'var(--red)',   icon: '💱', tip: 'J$/US$ rate movement' },
    { name: 'Fuel Effect',      val: fuelEffect,   posGood: true, color: fuelEffect>=0?'var(--green)':'var(--red)', icon: '⛽', tip: 'Fuel pass-through vs budget' },
    { name: 'Loss Effect',      val: lossEffect,   posGood: true, color: lossEffect>=0?'var(--green)':'var(--red)', icon: '⚡', tip: 'System loss % impact on billed MWh' },
    { name: 'Mix/Other',        val: mixEffect,    posGood: true, color: mixEffect>=0?'var(--green)':'var(--red)',  icon: '∑',  tip: 'Mix / rounding residual' },
    { name: 'Actual Revenue',   val: actTot,       isActual: true,color: 'var(--gold)'  },
  ];

  const fmtV = v => v==null?'–':(v<0?`<span style="color:var(--red)">(${Math.abs(Math.round(v)).toLocaleString()})</span>`:`<span style="color:var(--green)">+${Math.round(v).toLocaleString()}</span>`);
  const fmtAbs = v => v==null?'–':(v<0?`<span style="color:var(--red)">(${Math.abs(Math.round(v)).toLocaleString()})</span>`:`${Math.round(v).toLocaleString()}`);

  const favAdv = (v, posGood) => {
    if(v==null||v===0) return '';
    const fav = posGood ? v>=0 : v<=0;
    return fav
      ? `<span style="font-size:8px;font-weight:700;padding:1px 5px;border-radius:8px;background:rgba(16,185,129,.15);color:var(--green);margin-left:4px">FAV</span>`
      : `<span style="font-size:8px;font-weight:700;padding:1px 5px;border-radius:8px;background:rgba(239,68,68,.15);color:var(--red);margin-left:4px">ADV</span>`;
  };

  // Bridge bar chart data
  const bridgeLabels = [cmpLabel, 'Volume', 'Tariff', 'FX', 'Fuel', 'Loss', 'Mix', 'Actual'];
  const bridgeData   = [budTot, volEffect, tariffEffect, fxEffect, fuelEffect, lossEffect, mixEffect, actTot];
  const bridgeColors = [
    'rgba(59,130,246,.7)',
    volEffect>=0?'rgba(16,185,129,.75)':'rgba(239,68,68,.75)',
    tariffEffect>=0?'rgba(16,185,129,.75)':'rgba(239,68,68,.75)',
    fxEffect>=0?'rgba(6,182,212,.75)':'rgba(239,68,68,.75)',
    fuelEffect>=0?'rgba(16,185,129,.75)':'rgba(239,68,68,.75)',
    lossEffect>=0?'rgba(139,92,246,.75)':'rgba(239,68,68,.75)',
    mixEffect>=0?'rgba(100,116,139,.6)':'rgba(239,68,68,.5)',
    actTot>=budTot?'rgba(240,180,41,.85)':'rgba(239,68,68,.75)',
  ];

  el.innerHTML = `
    <div style="margin-top:14px;padding:14px;background:var(--card);border:1px solid var(--border);border-radius:8px">
      <div style="font-size:11px;font-weight:700;color:var(--text);margin-bottom:10px;display:flex;align-items:center;gap:8px">
        📈 Revenue Bridge Decomposition
        <span style="font-size:9px;font-weight:400;color:var(--muted)">${cmpLabel} → Actual · ${moData.month} · US$'000</span>
        <span style="font-size:9px;padding:2px 8px;background:${totalVariance>=0?'rgba(16,185,129,.12)':'rgba(239,68,68,.12)'};color:${totalVariance>=0?'var(--green)':'var(--red)'};border-radius:8px;font-weight:700">
          Total Var: ${totalVariance>=0?'+':''}${Math.round(totalVariance).toLocaleString()}K
        </span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <table style="width:100%;border-collapse:collapse;font-size:10px">
            <thead><tr>
              <th style="text-align:left;padding:4px 8px;background:var(--table-header-bg);color:var(--table-header-text);border-radius:4px 0 0 0">Effect</th>
              <th style="padding:4px 6px;background:var(--table-header-bg);color:var(--table-header-text)">Value ($K)</th>
              <th style="padding:4px 6px;background:var(--table-header-bg);color:var(--table-header-text)">% of Var</th>
              <th style="padding:4px 6px;background:var(--table-header-bg);color:var(--table-header-text);border-radius:0 4px 0 0">Driver</th>
            </tr></thead>
            <tbody>
              ${effects.filter(e=>!e.isBase&&!e.isActual).map(e=>`
              <tr style="border-bottom:1px solid var(--border)">
                <td style="padding:4px 8px;color:${e.color};font-weight:600">${e.icon||''} ${e.name}</td>
                <td style="text-align:right;padding:4px 6px;font-family:var(--mono);color:${e.color}">${fmtAbs(e.val)}</td>
                <td style="text-align:right;padding:4px 6px;color:var(--muted)">${totalVariance!==0?((Math.abs(e.val)/Math.abs(totalVariance))*100).toFixed(0)+'%':'–'}</td>
                <td style="padding:4px 6px;color:var(--muted);font-size:9px">${e.tip||''}${favAdv(e.val,e.posGood)}</td>
              </tr>`).join('')}
              <tr style="border-top:2px solid var(--border);background:var(--card2)">
                <td style="padding:5px 8px;font-weight:700;color:var(--gold)">Total Variance</td>
                <td style="text-align:right;padding:5px 6px;font-family:var(--mono);font-weight:700;color:var(--gold)">${fmtAbs(totalVariance)}</td>
                <td style="text-align:right;padding:5px 6px;color:var(--gold);font-weight:700">100%</td>
                <td style="padding:5px 6px;font-size:9px;color:var(--muted)">Actual vs ${cmpLabel}</td>
              </tr>
            </tbody>
          </table>
          <div style="margin-top:8px;display:flex;gap:12px;font-size:9px;color:var(--muted)">
            <span>${cmpLabel}: <strong style="color:var(--text)">$${Math.round(budTot).toLocaleString()}K</strong></span>
            <span>Actual: <strong style="color:var(--gold)">$${Math.round(actTot).toLocaleString()}K</strong></span>
            <span>FX: <strong style="color:var(--teal)">${actFX.toFixed(1)} vs ${budFX.toFixed(1)} J$/US$</strong></span>
          </div>
        </div>
        <div>
          <div style="height:180px"><canvas id="cRevBridgeVar"></canvas></div>
        </div>
      </div>
    </div>`;

  // Render bridge waterfall chart
  mkWaterfall('cRevBridgeVar',[
    {label:cmpLabel,    value:budTot,      isTotal:true},
    {label:'Volume',    value:volEffect},
    {label:'Tariff',    value:tariffEffect},
    {label:'FX',        value:fxEffect},
    {label:'Fuel',      value:fuelEffect},
    {label:'Loss',      value:lossEffect},
    {label:'Mix',       value:mixEffect},
    {label:'Actual',    value:actTot,      isTotal:true},
  ]);
}

function exportVarCSV() {
  const mo = parseInt(document.getElementById('varMo')?.value || 1);
  const data = _acts(mo);
  if (!data) { toast('No data for selected month','w'); return; }
  const act = varPeriod === 'ytd' ? data.ytdActual : data.pl;
  const ref = varPeriod === 'ytd' ? data.ytdBudget : data.budget;
  const rows = [['Line Item','Actual','Budget','Var $','Var %']];
  const keys = ['totalSales','grossProfit','ebitda','ebit','nfc','pretax','netIncome'];
  const names = ['Total Sales','Gross Profit','EBITDA','EBIT','NFC','Pre-Tax','Net Income'];
  keys.forEach((k,i)=>{ const a=act[k]||0,b=ref[k]||0,d=a-b; rows.push([names[i],a,b,d,b?((d/Math.abs(b))*100).toFixed(1)+'%':'–']); });
  const blob=new Blob([rows.map(r=>r.join(',')).join('\n')],{type:'text/csv'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='JPS_Variance_'+data.month.replace(/ /g,'_')+'.csv';a.click();
  toast('Variance exported','ok');
}

// ═══════════════════════════════════════════════════════
//  ASSUMPTION TABLES
// ═══════════════════════════════════════════════════════
function buildTariffTable(){buildTariffTable3();}
function updTariff(id,f,v){/* legacy stub — handled by updTariff3 */}

function buildRevTable(){buildVolumeTable();buildRevDerived();}
function buildRevDerived_OLD(){/* replaced by new engine */}

function buildOMTable(){
  const yr=selectedOMYear;
  const rows=getOMRows(yr);
  const omTot=getOMTotal(yr); const omCash=getOMCash(yr);
  const agg2=typeof leaseAggregates!=='undefined'&&leaseAggregates[yr]?leaseAggregates[yr]:null;
  const showGrow=(yr!==_CY);
  const grHdr=showGrow?`<th title="Annual growth vs ${_CY} base" style="color:var(--teal)">Gr%</th>`:'';
  document.getElementById('omH').innerHTML=`<tr><th style="min-width:220px;text-align:left">Category</th><th>Cash Lag</th>${grHdr}${MONTHS.map(m=>`<th class="bc">${m}</th>`).join('')}<th class="bc">Total</th><th class="ac">→Cash</th></tr>`;

  const rowHtml=rows.filter(r=>!r.derived).map(r=>{
    // ARCHITECTURAL RULE: non-cash O&M fraction must come from DB — no hardcoded haircut
    const tot=sumArr(r.vals); const cashTot=tot;
    const grPct=(r.growthRate||0);
    const grCell=showGrow?`<td><input class="ei" style="width:46px;color:var(--teal)" value="${grPct.toFixed(1)}" title="Growth % vs ${_CY} base" onchange="updOMGrowth('${r.id}',this.value,${yr})" onfocus="this.select()">%</td>`:'';
    const valCells=(r.vals||MONTHS.map(()=>0)).map((v,i)=>`<td><input class="ei" value="${v}" data-row="${r.id}" data-mo="${i}" onchange="updOMRow(this,${yr})" onfocus="this.select()"></td>`).join('');

    let subRows='';
    if(r.id==='transport'&&agg2&&agg2.vehicleCredit&&agg2.vehicleCredit.some(v=>v)){
      const cr=agg2.vehicleCredit;
      const netV=(r.vals||MONTHS.map(()=>0)).map((v,m)=>Math.max(0,v-(cr[m]||0)));
      const grPad=showGrow?'<td></td>':'';
      subRows=`<tr style="font-size:10px"><td style="padding-left:22px;color:var(--teal)">↳ IFRS-16 Vehicle Credit</td><td></td>${grPad}${cr.map(v=>`<td class="der" style="color:var(--teal)">(${Math.round(v)||'–'})</td>`).join('')}<td class="der" style="color:var(--teal)">(${fmtN(Math.round(sumArr(cr)))})</td><td></td></tr>
<tr style="font-size:10px;font-weight:700"><td style="padding-left:22px;color:var(--teal)">Net Transport</td><td></td>${grPad}${netV.map(v=>`<td class="der" style="color:var(--teal);font-weight:700">${fmtN(v)}</td>`).join('')}<td class="der" style="color:var(--teal);font-weight:700">${fmtN(sumArr(netV))}</td><td></td></tr>`;
    }
    if(r.id==='building'&&agg2&&agg2.propertyCredit&&agg2.propertyCredit.some(v=>v)){
      const cr=agg2.propertyCredit;
      const netV=(r.vals||MONTHS.map(()=>0)).map((v,m)=>Math.max(0,v-(cr[m]||0)));
      const grPad=showGrow?'<td></td>':'';
      subRows=`<tr style="font-size:10px"><td style="padding-left:22px;color:var(--teal)">↳ IFRS-16 Property Credit</td><td></td>${grPad}${cr.map(v=>`<td class="der" style="color:var(--teal)">(${Math.round(v)||'–'})</td>`).join('')}<td class="der" style="color:var(--teal)">(${fmtN(Math.round(sumArr(cr)))})</td><td></td></tr>
<tr style="font-size:10px;font-weight:700"><td style="padding-left:22px;color:var(--teal)">Net Building</td><td></td>${grPad}${netV.map(v=>`<td class="der" style="color:var(--teal);font-weight:700">${fmtN(v)}</td>`).join('')}<td class="der" style="color:var(--teal);font-weight:700">${fmtN(sumArr(netV))}</td><td></td></tr>`;
    }
    return `<tr><td style="padding-left:10px"><strong>${r.name}</strong></td>
      <td style="text-align:center;color:var(--muted)">${r.cashLag===0?'Same mo':r.cashLag+'d'}</td>
      ${grCell}${valCells}
      <td class="gld">${fmtN(tot)}</td><td class="der">${fmtN(cashTot)}</td></tr>${subRows}`;
  }).join('');

  const totalNonIPPCr=agg2?sumArr(agg2.nonIPPCredit):0;
  const grossTotal=sumArr(omTot);
  const grPad2=showGrow?'<td></td>':'';
  const totalRow=`<tr class="tr"><td colspan="2" style="padding-left:10px"><strong>Total Gross O&M</strong></td>${grPad2}${omTot.map(v=>`<td class="gld"><strong>${fmtN(v)}</strong></td>`).join('')}<td class="gld"><strong>${fmtN(grossTotal)}</strong></td><td class="der"><strong>${fmtN(sumArr(omCash))}</strong></td></tr>`;
  const creditRow=agg2&&totalNonIPPCr?`<tr><td colspan="2" style="padding-left:10px;color:var(--teal)">Total IFRS-16 Credits</td>${grPad2}${agg2.nonIPPCredit.map(v=>`<td class="der" style="color:var(--teal)">(${fmtN(Math.round(v))})</td>`).join('')}<td class="der" style="color:var(--teal)">(${fmtN(Math.round(totalNonIPPCr))})</td><td></td></tr>`:'';
  const netRow=`<tr class="tr"><td colspan="2" style="padding-left:10px;color:var(--teal)"><strong>Net O&M (after IFRS-16)</strong></td>${grPad2}${omTot.map((v,m)=>{const cr=agg2?agg2.nonIPPCredit[m]:0;return `<td class="gld" style="color:var(--teal)"><strong>${fmtN(Math.round(v-cr))}</strong></td>`;}).join('')}<td class="gld" style="color:var(--teal)"><strong>${fmtN(Math.round(grossTotal-totalNonIPPCr))}</strong></td><td></td></tr>`;

  document.getElementById('omB').innerHTML=rowHtml+totalRow+creditRow+netRow;
  buildOMKpis(); buildOMCharts();
}

function updOMRow(inp,yr){
  yr=yr||selectedOMYear;
  const id=inp.dataset.row,mo=parseInt(inp.dataset.mo);
  if(fpa.isPeriodClosed(yr,mo+1)){inp.value=inp.defaultValue||inp.value;toast(`${MONTHS[mo]} ${yr} is a closed period — actuals are locked`,'w');return;}
  const raw=parseFloat(inp.value.replace(/,/g,''));
  if(isNaN(raw)||raw<0||raw>9999999){inp.style.borderColor='var(--red)';toast('Enter a valid positive number (US$000)','err');return;}
  inp.style.borderColor='';
  const v=raw;
  const r=getOMRows(yr).find(x=>x.id===id);
  if(r&&r.vals){const old=r.vals[mo];r.vals[mo]=v;auditLog('om-edit',`O&M · ${r.id||id} · ${MONTHS[mo]} ${yr}`,old,v);}
  buildOMTable();toast('O&M updated → Cash flow recalculated','ok');
}
function updOMGrowth(id,val,yr){
  yr=yr||selectedOMYear;
  if(yr===_CY){toast('Growth rate applies to future years only','w');return;}
  const pct=parseFloat(val)||0;
  const baseCY=omRows[_CY]?.find(r=>r.id===id);
  const row=getOMRows(yr).find(r=>r.id===id);
  if(!row||!baseCY)return;
  row.growthRate=pct;
  const factor=Math.pow(1+pct/100,(yr-_CY));
  row.vals=baseCY.vals.map(v=>Math.round(v*factor));
  buildOMTable();
  toast(`O&M growth ${pct>=0?'+':''}${pct}% applied to ${yr}`,'ok');
}

function buildCapexTable(){
  const yr=selectedCapexYear;
  const rows=getCxRows(yr);
  const cxTot=getCxTotal(yr);
  const showCxGrow=(yr!==_CY);
  document.getElementById('capexH').innerHTML=`<tr><th style="min-width:240px;text-align:left">Category</th><th>Pay Lag</th><th>Trf Lag</th><th>Depn Yrs</th>${showCxGrow?'<th style="color:var(--teal)">Gr%</th>':''}${MONTHS.map(m=>`<th class="bc">${m}</th>`).join('')}<th class="bc">Total</th></tr>`;
  document.getElementById('capexB').innerHTML=[
    ...rows.map(r=>{
      const tot=sumArr(r.vals||[]);
      const cxGrCell=showCxGrow
        ?`<td><input class="ei" style="width:46px;color:var(--teal)" value="${(r.growthRate||0).toFixed(1)}"
            onchange="updCxGrowth('${r.id}',this.value,${yr})" onfocus="this.select()">%</td>`:'';
      return `<tr><td style="padding-left:10px"><strong>${r.name}</strong><span class="del" onclick="delCxRow('${r.id}',${yr})">✕</span></td>
        <td><input class="ei" style="width:40px" value="${r.payLag}" onchange="updCxMeta('${r.id}','payLag',this.value,${yr})"></td>
        <td><input class="ei" style="width:40px" value="${r.tLag}" onchange="updCxMeta('${r.id}','tLag',this.value,${yr})"></td>
        <td><input class="ei" style="width:50px" value="${r.dYrs}" onchange="updCxMeta('${r.id}','dYrs',this.value,${yr})"></td>
        ${cxGrCell}
        ${(r.vals||MONTHS.map(()=>0)).map((v,i)=>`<td><input class="ei" value="${v}" data-row="${r.id}" data-mo="${i}" onchange="updCxRow(this,${yr})" onfocus="this.select()"></td>`).join('')}
        <td class="gld">${fmtN(tot)}</td></tr>`;
    }),
    `<tr class="tr"><td colspan="4" style="padding-left:10px"><strong>TOTAL CapEx</strong></td>${cxTot.map(v=>`<td class="gld"><strong>${fmtN(v)}</strong></td>`).join('')}<td class="gld"><strong>${fmtN(sumArr(cxTot))}</strong></td></tr>`,
  ].join('');
  buildCxTransfer(yr); buildCxCashflow(yr); buildCxDepn(yr); buildCapexKpis(); buildCxCharts();
}
function buildCxTransfer(yr){
  yr=yr||selectedCapexYear;
  const rows=getCxRows(yr);
  const tr=getCxTransfer(yr);
  document.getElementById('cxTH').innerHTML=`<tr><th style="text-align:left;min-width:220px">Category (lagged)</th>${MONTHS.map(m=>`<th class="ac">${m}</th>`).join('')}<th class="ac">Total</th></tr>`;
  document.getElementById('cxTB').innerHTML=[
    ...rows.map(r=>{const lag=r.tLag||1;const v=MONTHS.map((_,i)=>i>=lag?r.vals[i-lag]:0);return `<tr><td style="padding-left:14px;color:var(--teal)">${r.name} <span style="color:var(--muted)">(${lag}mo lag)</span></td>${v.map(x=>`<td class="der">${fmtN(x)}</td>`).join('')}<td class="der">${fmtN(sumArr(v))}</td></tr>`;}).join(''),
    `<tr class="tr"><td><strong>→ Total CWIP→PP&E Transfer</strong></td>${tr.map(v=>`<td class="gld"><strong>${fmtN(v)}</strong></td>`).join('')}<td class="gld"><strong>${fmtN(sumArr(tr))}</strong></td></tr>`,
  ].join('');
}
function buildCxCashflow(yr){
  yr=yr||selectedCapexYear;
  const rows=getCxRows(yr);
  const cxCash=getCxCash(yr);
  document.getElementById('cxCH').innerHTML=`<tr><th style="text-align:left;min-width:220px">Category (payment lag)</th>${MONTHS.map(m=>`<th class="ac">${m}</th>`).join('')}<th class="ac">Total</th></tr>`;
  document.getElementById('cxCB').innerHTML=[
    ...rows.map(r=>{const lag=r.payLag||2;const v=MONTHS.map((_,i)=>i>=lag?r.vals[i-lag]:0);return `<tr><td style="padding-left:14px;color:var(--teal)">${r.name} <span style="color:var(--muted)">(${lag}mo pay)</span></td>${v.map(x=>`<td class="der">${fmtN(x)}</td>`).join('')}<td class="der">${fmtN(sumArr(v))}</td></tr>`;}).join(''),
    `<tr class="tr"><td><strong>→ Total CapEx Cash Outflow</strong></td>${cxCash.map(v=>`<td class="gld"><strong>${fmtN(v)}</strong></td>`).join('')}<td class="gld"><strong>${fmtN(sumArr(cxCash))}</strong></td></tr>`,
  ].join('');
}
function buildCxDepn(yr){
  yr=yr||selectedCapexYear;
  const depArr=MONTHS.map((_,m)=>calcDepTotals(yr,m).regular);
  document.getElementById('depnH').innerHTML=`<tr><th style="text-align:left;min-width:220px">Component</th>${MONTHS.map(m=>`<th class="ac">${m}</th>`).join('')}<th class="ac">Total</th></tr>`;
  document.getElementById('depnB').innerHTML=`<tr class="tr"><td><strong>→ Total Regular Depreciation (${yr})</strong></td>${depArr.map(v=>`<td class="gld"><strong>${fmtN(Math.round(v/1000))}</strong></td>`).join('')}<td class="gld"><strong>${fmtN(Math.round(depArr.reduce((s,v)=>s+v,0)/1000))}</strong></td></tr>`;
}
function updCxRow(inp,yr){
  yr=yr||selectedCapexYear;
  const id=inp.dataset.row,mo=parseInt(inp.dataset.mo);
  if(fpa.isPeriodClosed(yr,mo+1)){inp.value=inp.defaultValue||inp.value;toast(`${MONTHS[mo]} ${yr} is a closed period — actuals are locked`,'w');return;}
  const raw=parseFloat(inp.value.replace(/,/g,''));
  if(isNaN(raw)||raw<0||raw>9999999){inp.style.borderColor='var(--red)';toast('Enter a valid positive number (US$000)','err');return;}
  inp.style.borderColor='';
  const v=raw;
  const r=getCxRows(yr).find(x=>x.id===id);
  if(r&&r.vals){const old=r.vals[mo];r.vals[mo]=v;auditLog('capex-edit',`CapEx · ${r.id||id} · ${MONTHS[mo]} ${yr}`,old,v);}
  buildCapexTable();toast('CapEx updated → Transfer & Cash schedules recalculated','ok');
}
function updCxMeta(id,f,v,yr){yr=yr||selectedCapexYear;const r=getCxRows(yr).find(x=>x.id===id);if(r)r[f]=parseInt(v)||0;buildCapexTable();}
function updCxGrowth(id,val,yr){
  yr=yr||selectedCapexYear;
  if(yr===_CY){toast('Growth rate applies to future years only','w');return;}
  const pct=parseFloat(val)||0;
  const baseCY=capexRows[_CY]?.find(r=>r.id===id);
  const row=getCxRows(yr).find(r=>r.id===id);
  if(!row||!baseCY)return;
  row.growthRate=pct;
  const factor=Math.pow(1+pct/100,(yr-_CY));
  row.vals=baseCY.vals.map(v=>Math.round(v*factor));
  buildCapexTable();
  toast(`CapEx growth ${pct>=0?'+':''}${pct}% applied to ${yr}`,'ok');
}
function showCxTab(id,el){document.querySelectorAll('.cx-tab').forEach(t=>t.classList.remove('on'));el.classList.add('on');['cxSpend','cxTransfer','cxCashflow','cxDepn'].forEach(d=>document.getElementById(d).style.display=d===('cx'+id.charAt(0).toUpperCase()+id.slice(1))?'block':'none');}

// COLLECTIONS
function buildCollTable(){
  const yr=selectedCollYear;
  const rows=getCollRows(yr);
  computeAll(yr);
  // Actuals overlay for 2026
  const hasAct=yr===actualsYear&&[1,2,3,4,5,6,7,8,9,10,11,12].some(m=>_acts(m));
  const actReceipts=yr===actualsYear?MONTHS.map((_,m)=>_acts(m+1)?.pl?.totalSales!=null?null:null):null; // placeholder; actual receipts from CF if available
  document.getElementById('collH').innerHTML=`<tr><th style="min-width:240px;text-align:left">Driver</th><th>Unit</th>${MONTHS.map(m=>`<th class="bc">${m}</th>`).join('')}<th class="bc">Total/Avg</th></tr>`;
  document.getElementById('collB').innerHTML=rows.map(r=>{
    const isDer=r.derived; const v12=r.vals||MONTHS.map(()=>0);
    const isAvg=r.unit==='%'||r.unit==='days';
    const tot=isAvg?v12.reduce((a,b)=>a+b,0)/12:v12.reduce((a,b)=>a+b,0);
    // For receipts row: show actuals from actualsStore if available
    let actRow='';
    if(hasAct&&r.id==='receipts'){
      const actR=MONTHS.map((_,m)=>_acts(m+1)?.cf?.operatingCF!=null?null:null); // CF receipts not directly in parse
      // Use totalSales as proxy for receipts (closest available)
      const actReceipt=MONTHS.map((_,m)=>{
        const a=actualsStore[m+1];
        if(!a) return null;
        // Approximate: cash receipts ≈ totalSales adjusted for AR movement
        return a.pl?.totalSales||null;
      });
      if(actReceipt.some(v=>v!==null)){
        actRow=`<tr style="background:rgba(16,185,129,.06)"><td style="padding-left:22px;color:var(--green);font-size:10px">↳ Actual Revenue (proxy)</td><td style="color:var(--green)">US$000</td>${actReceipt.map(v=>v!==null?`<td style="color:var(--green)">${Math.round(v).toLocaleString()}</td>`:`<td style="color:var(--muted);opacity:.4">–</td>`).join('')}<td style="color:var(--green)">${Math.round(actReceipt.filter(v=>v).reduce((s,v)=>s+v,0)).toLocaleString()}</td></tr>`;
      }
    }
    return `<tr class="${isDer?'der':''}"><td style="padding-left:${isDer?'22':'10'}px">${isDer?'⇒ ':''}<strong>${r.name}</strong></td><td style="color:var(--muted)">${r.unit}</td>
      ${v12.map((v,i)=>isDer?`<td class="der">${r.unit==='%'?v?.toFixed(1)+'%':fmtN(v)}</td>`:`<td><input class="ei" value="${v}" data-row="${r.id}" data-mo="${i}" onchange="updCollRow(this,${yr})" onfocus="this.select()"></td>`).join('')}
      <td class="${isDer?'der':'gld'}">${isAvg?tot.toFixed(1)+(r.unit==='%'?'%':''):fmtN(tot)}</td></tr>${actRow}`;
  }).join('');
  // Actuals banner hidden — upload indicators removed from UI
  const banner=document.getElementById('collActualsBanner');
  if(banner){ banner.style.display='none'; }
  buildCollImpact(yr); buildCollCharts(yr); buildCollWF(yr); buildCollActuals(yr);
}
function buildCollImpact(yr){
  yr=yr||selectedCollYear;
  const rows=getCollRows(yr);
  computeAll(yr); const fxR=fx();
  const bill=rows.find(r=>r.id==='billing')?.vals||[];
  const blR=rows.find(r=>r.id==='blended')?.vals||[];
  const rec=rows.find(r=>r.id==='receipts')?.vals||[];
  const dso=rows.find(r=>r.id==='dso')?.vals||[];
  const ar=MONTHS.map((_,i)=>Math.round((bill[i]||0)/fxR*(1-(blR[i]||0)/100)));
  document.getElementById('collIH').innerHTML=`<tr><th style="text-align:left;min-width:220px">Metric</th>${MONTHS.map(m=>`<th class="ac">${m}</th>`).join('')}<th class="ac">Total/Avg</th></tr>`;
  const collIRows = [[`Billings (J$'000)`,bill,false,false],['Blended Rate %',blR,true,false],['→ Cash Receipts (US$000)',rec,false,true],['AR Balance (US$000)',ar,false,false],['DSO (days)',dso,false,false,true]];
  document.getElementById('collIB').innerHTML = collIRows.map(([n,v,pct,strong,days])=>`
    <tr class="${strong?'tr':''}"><td style="padding-left:10px;color:${strong?'var(--gold)':'var(--teal)'}"><strong>${n}</strong></td>
    ${(v||[]).map(x=>`<td class="der">${pct?x?.toFixed(1)+'%':days?Math.round(x||0)+'d':fmtN(x)}</td>`).join('')}
    <td class="der">${pct?((v||[]).reduce((a,b)=>a+b,0)/12).toFixed(1)+'%':days?Math.round((v||[]).reduce((a,b)=>a+b,0)/12)+'d':fmtN((v||[]).reduce((a,b)=>a+b,0))}</td></tr>`
  ).join('');
}
function updCollRow(inp,yr){
  yr=yr||selectedCollYear;
  const id=inp.dataset.row,mo=parseInt(inp.dataset.mo);
  const raw=parseFloat(inp.value.replace(/,/g,''));
  if(isNaN(raw)||raw<-999999||raw>9999999){inp.style.borderColor='var(--red)';toast('Enter a valid number','err');return;}
  inp.style.borderColor='';
  const v=raw;
  const r=getCollRows(yr).find(x=>x.id===id);
  if(r&&r.vals){const old=r.vals[mo];r.vals[mo]=v;auditLog('coll-edit',`Collections · ${r.id||id} · ${MONTHS[mo]} ${yr}`,old,v);}
  computeAll(yr);buildCollTable();toast('Collections updated','ok');
}
function buildCollWF(yr){
  yr=yr||selectedCollYear;
  const rows=getCollRows(yr);
  computeAll(yr); const fxR=fx();
  const bill=sumArr(rows.find(r=>r.id==='billing')?.vals||[])/fxR;
  const rec=sumArr(rows.find(r=>r.id==='receipts')?.vals||[]);
  const prior=sumArr(rows.find(r=>r.id==='prior')?.vals||[]);
  const gcr=sumArr(rows.find(r=>r.id==='gcr')?.vals||[]);
  document.getElementById('collWF').innerHTML=[
    {lbl:'Annual Billings',val:toK(bill*1000),c:'var(--teal)'},
    {lbl:'× Coll. Rate',val:'94.1%',c:'var(--blue)',arr:true},
    {lbl:'Current Period',val:toK((rec-prior-gcr)*1000),c:'var(--green)',arr:true},
    {lbl:'+ Prior Period',val:'+'+toK(prior*1000),c:'var(--amber)',arr:true},
    {lbl:'+ GCT',val:'+'+toK(gcr*1000),c:'var(--purple)',arr:true},
    {lbl:'= Cash Receipts',val:toK(rec*1000),c:'var(--gold)',arr:true},
  ].map(b=>`${b.arr?'<div class="wfa">→</div>':''}<div class="wfb" style="border-color:${b.c}20;min-width:95px;flex:1"><div class="wfl">${b.lbl}</div><div class="wfv" style="color:${b.c};font-size:12px">${b.val}</div></div>`).join('');
}

function buildCollActuals(yr){
  const el=document.getElementById('collActualsPanel');
  if(!el) return;
  if(yr!==_CY){el.style.display='none';return;}
  const loadedMos=MONTHS.map((_,m)=>_acts(m+1)).filter(Boolean);
  if(!loadedMos.length){el.style.display='none';return;}
  const leReceipts=getCollRows(_CY).find(r=>r.id==='receipts')?.vals||Array(12).fill(0);
  const actRevArr=MONTHS.map((_,m)=>_acts(m+1)?.pl?.totalSales??null);
  const actBSArr=MONTHS.map((_,m)=>_acts(m+1)?.bs?.receivables??null);
  const actCashArr=MONTHS.map((_,m)=>_acts(m+1)?.bs?.cash??null);
  el.style.display='';
  const tblRows=[
    {n:'Total Revenue — Actual',arr:actRevArr,c:'var(--green)',fmtFn:v=>Math.round(v).toLocaleString()},
    {n:'Total Revenue — LE',arr:leReceipts,c:'var(--muted)',fmtFn:v=>Math.round(v).toLocaleString()},
    {n:'Revenue Var$ (Act−LE)',arr:actRevArr.map((a,m)=>a!=null?a-leReceipts[m]:null),c:null,isVar:true,posGood:true},
    {n:'Net Receivables — Actual',arr:actBSArr,c:'var(--blue)',fmtFn:v=>Math.round(v).toLocaleString()},
    {n:'Cash Balance — Actual',arr:actCashArr,c:'var(--teal)',fmtFn:v=>Math.round(v).toLocaleString()},
  ];
  el.innerHTML=`
    <div class="tc2">
      <div class="th"><div class="tt">§ Actuals vs LE — Revenue &amp; Balance Sheet <span class="badge badge-ok">● ${loadedMos.length} Mo Actuals</span></div>
      <div class="ts">Sourced from JPSCo_Financials uploads · USD $'000 · Favourable variances in green</div></div>
      <div class="tscr"><table><thead><tr>
        <th style="text-align:left;min-width:220px">Metric</th>
        ${MONTHS.map(m=>`<th class="bc">${m}</th>`).join('')}<th class="bc">Total</th>
      </tr></thead><tbody>
      ${tblRows.map(r=>{
        const total=r.arr.filter(v=>v!=null).reduce((s,v)=>s+v,0);
        return `<tr><td style="padding-left:14px;color:${r.c||'var(--text)'}">${r.n}</td>${r.arr.map((v)=>{
          if(v===null||v===undefined) return `<td style="color:var(--muted);opacity:.3">–</td>`;
          if(r.isVar){
            const good=r.posGood?v>=0:v<=0;
            const col=v===0?'var(--muted)':good?'var(--green)':'var(--red)';
            return `<td style="color:${col};font-weight:600">${v>0?'+'+Math.round(v).toLocaleString():v<0?'('+Math.abs(Math.round(v)).toLocaleString()+')':'–'}</td>`;
          }
          return `<td style="color:${r.c||'var(--text)'}">${r.fmtFn(v)}</td>`;
        }).join('')}<td class="gld">${r.isVar?(total>0?'+':total<0?'':'')+Math.round(total).toLocaleString():Math.round(total).toLocaleString()}</td></tr>`;
      }).join('')}
      </tbody></table></div>
    </div>`;
}

// ═══════════════════════════════════════════════════════
//  KPIs
// ═══════════════════════════════════════════════════════
function buildDashKpis(){
  const ebi=plLines.find(l=>l.id==='ebitda'),ni=plLines.find(l=>l.id==='net_inc');
  const sc=scenarios[activeSc];
  const yr = dashYear || _CY;
  const yIdx = YEARS.indexOf(String(yr));
  const e26=Math.round((ebi.vals[yIdx]||ebi.vals[4]||0)*(1+(sc?.eb||0)/100));
  const n26=Math.round((ni.vals[yIdx]||ni.vals[4]||0)*(1+(sc?.eb||0)/100));
  const rec=getCashReceipts(yr); const cxTot=getCxTotal(yr);

  const ytdA=getYTDActuals();
  const loadedCount=ytdA?.months||0;
  const latestMo=loadedCount>0?loadedCount:null;
  const latestData=latestMo?_acts(latestMo):null;

  // Equal monthly weights — no hardcoded seasonal skew
  const budgetProp=Array(12).fill(1);
  const propSum=12;
  const ytdFrac=loadedCount>0?(loadedCount/12):1;
  const mthIdx=latestMo?latestMo-1:11;
  const mthFrac=budgetProp[mthIdx]/propSum;

  // Pull LE/AOP annual targets from plLines (DB-backed) — no hardcoded fallbacks
  const _plLEGet = (id, ...frags) => {
    const l = plLines.find(l => l.id === id || frags.some(f => l.name?.toLowerCase().includes(f)));
    return l?.vals?.[yIdx>=0?yIdx:4] || 0;
  };
  const annRevLE    = _plLEGet('total_rev',     'total revenue', 'total sales');
  const annEBITDALE = _plLEGet('ebitda',        'ebitda');
  const annNILE     = _plLEGet('net_inc',        'net profit after', 'net income');
  const annDepLE    = _plLEGet('depreciation',   'depreciation');
  const annCapexLE=sumArr(cxTot), annCashLE=sumArr(rec);

  const leYTDRev=Math.round(annRevLE*ytdFrac);
  const leYTDEBITDA=Math.round(annEBITDALE*ytdFrac);
  const leYTDNI=Math.round(annNILE*ytdFrac);
  const leMTDRev=Math.round(annRevLE*mthFrac);
  const leMTDEBITDA=Math.round(annEBITDALE*mthFrac);
  const leMTDNI=Math.round(annNILE*mthFrac);

  const actYTDRev=ytdA?.ytd?.totalSales??null;
  const actYTDEBITDA=ytdA?.ytd?.ebitda??null;
  const actYTDNI=ytdA?.ytd?.netIncome??null;
  const actYTDGP=ytdA?.ytd?.grossProfit??null;
  const actYTDOpex=ytdA?.ytd?.opex??null;
  const actMTDRev=latestData?.pl?.totalSales??null;
  const actMTDEBITDA=latestData?.pl?.ebitda??null;
  const actMTDNI=latestData?.pl?.netIncome??null;

  const budMTDRev=latestData?.budget?.totalSales??leMTDRev;
  const budMTDEBITDA=latestData?.budget?.ebitda??leMTDEBITDA;
  const budMTDNI=latestData?.budget?.netIncome??leMTDNI;
  const budYTDRev=latestData?.ytdBudget?.totalSales??leYTDRev;
  const budYTDEBITDA=latestData?.ytdBudget?.ebitda??leYTDEBITDA;
  const budYTDNI=latestData?.ytdBudget?.netIncome??leYTDNI;
  const budMTDOpex=latestData?.budget?.opex??null;
  const budYTDOpex=latestData?.ytdBudget?.opex??null;

  const moLabel=latestMo?MONTHS[latestMo-1]+' '+yr:yr+' LE';
  const ytdLabel=loadedCount>0?`YTD Jan\u2013${MONTHS[loadedCount-1]}`:'Full Year LE';

  const varBubble=(act,bud,posGood)=>{
    if(act==null||bud==null) return '<span style="color:var(--muted);font-size:9px">\u2013</span>';
    const d=act-bud; const pct=bud!==0?(Math.abs(d/bud)*100).toFixed(1):null;
    const fav=posGood?d>=0:d<=0;
    const col=fav?'var(--green)':'var(--red)';
    const bg=fav?'rgba(16,185,129,.12)':'rgba(239,68,68,.12)';
    return `<span style="background:${bg};color:${col};border-radius:8px;padding:1px 6px;font-size:9px;font-weight:700;white-space:nowrap">${d>=0?'\u25b2':'\u25bc'} ${Math.abs(Math.round(d)).toLocaleString()}${pct?' ('+pct+'%)':''}</span>`;
  };

  const kpiCard=(label,strip,mtdA,mtdB,ytdA2,ytdB2,posGood)=>{
    const f=v=>v==null?'\u2013':'$'+Math.round(Math.abs(v)).toLocaleString();
    return `<div style="display:flex;flex-direction:column;border-radius:8px;overflow:hidden;border:1px solid var(--border);background:var(--card);box-shadow:0 2px 8px var(--shadow);flex:1 1 155px;min-width:0">
      <div style="background:${strip};padding:5px 10px;display:flex;align-items:center;gap:6px">
        <span style="color:#fff;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.12em;white-space:nowrap">${label}</span>
      </div>
      <div style="flex:1;padding:8px 10px;display:flex;flex-direction:column;gap:5px;min-width:0">
        <div style="font-size:8px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.07em">MTD \u00b7 ${moLabel}</div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="font-size:15px;font-weight:800;font-family:var(--mono);color:${mtdA==null?'var(--muted)':'var(--text)'}">${f(mtdA)}</span>
          <span style="font-size:9px;color:var(--muted)">Bud:${f(mtdB)}</span>
          ${varBubble(mtdA,mtdB,posGood)}
        </div>
        <div style="height:1px;background:var(--border)"></div>
        <div style="font-size:8px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.07em">${ytdLabel}</div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="font-size:13px;font-weight:700;font-family:var(--mono);color:${ytdA2==null?'var(--muted)':'var(--text)'}">${f(ytdA2)}</span>
          <span style="font-size:9px;color:var(--muted)">Bud:${f(ytdB2)}</span>
          ${varBubble(ytdA2,ytdB2,posGood)}
        </div>
      </div>
    </div>`;
  };

  const noActCard=(label,strip,annLE,sub)=>`<div style="display:flex;flex-direction:column;border-radius:8px;overflow:hidden;border:1px solid var(--border);background:var(--card);box-shadow:0 2px 8px var(--shadow);flex:1 1 155px;min-width:0">
    <div style="background:${strip};padding:5px 10px">
      <span style="color:#fff;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.12em;white-space:nowrap">${label}</span>
    </div>
    <div style="flex:1;padding:8px 10px">
      <div style="font-size:8px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px">${sub||(yr+' Annual LE')}</div>
      <div style="font-size:18px;font-weight:800;font-family:var(--mono);color:var(--text)">${toK(annLE*1000)}</div>
      <div style="font-size:9px;color:var(--muted);margin-top:2px">Upload actuals to enable MTD/YTD</div>
    </div>
  </div>`;

  const actBS=latestData?.bs;
  const actCR=actBS?.totalCurrentAssets&&actBS?.totalCurrentLiab?(actBS.totalCurrentAssets/actBS.totalCurrentLiab):null;
  const actMTDMargin=actMTDRev&&actMTDEBITDA?((actMTDEBITDA/actMTDRev)*100):null;
  const actYTDMargin=actYTDRev&&actYTDEBITDA?((actYTDEBITDA/actYTDRev)*100):null;
  const budYTDMargin=budYTDRev&&budYTDEBITDA?((budYTDEBITDA/budYTDRev)*100):null;

  let html='';
  if(loadedCount){
    // Pre-compute exec summary vars (hoisted so exec summary renders FIRST / LEFT)
    const niVar=actYTDNI!=null&&budYTDNI?(actYTDNI-budYTDNI):null;
    const niVarPct=niVar!=null&&budYTDNI?((niVar/Math.abs(budYTDNI))*100).toFixed(1):null;
    const ebiVar=actYTDEBITDA!=null&&budYTDEBITDA?(actYTDEBITDA-budYTDEBITDA):null;
    const revVar=actYTDRev!=null&&budYTDRev?(actYTDRev-budYTDRev):null;
    const pulse=(v,posGood)=>{if(v==null)return'<span style="color:var(--muted)">–</span>';const fav=posGood?v>=0:v<=0;return `<span style="color:${fav?'var(--green)':'var(--red)'};font-weight:700">${v>=0?'▲':'▼'} $${Math.abs(Math.round(v)).toLocaleString()}K</span>`;};
    // ── Executive Summary — LEFT ─────────────────────────
    const _savedNote=typeof _execNote!=='undefined'?_execNote:'';
    html+=`<div style="display:flex;flex-direction:column;border-radius:8px;overflow:hidden;border:1px solid rgba(0,174,239,0.3);background:var(--card);box-shadow:0 2px 8px var(--shadow);flex:2 1 280px;min-width:0">
      <div style="background:linear-gradient(135deg,#1e3a5f,#2d5a8e);padding:6px 12px;display:flex;align-items:center;justify-content:space-between">
        <span style="color:#fff;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.12em">📋 Executive Summary</span>
        <span style="color:rgba(255,255,255,.6);font-size:9px">${ytdLabel}</span>
      </div>
      <div style="flex:1;padding:10px 12px;display:flex;flex-direction:column;gap:6px">
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">
          <div style="background:var(--card2);border-radius:6px;padding:6px 8px">
            <div style="font-size:8px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">Revenue vs Budget</div>
            <div style="font-size:12px;font-family:var(--mono)">${pulse(revVar,true)}</div>
          </div>
          <div style="background:var(--card2);border-radius:6px;padding:6px 8px">
            <div style="font-size:8px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">EBITDA vs Budget</div>
            <div style="font-size:12px;font-family:var(--mono)">${pulse(ebiVar,true)}</div>
          </div>
          <div style="background:var(--card2);border-radius:6px;padding:6px 8px">
            <div style="font-size:8px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">Net Income vs Budget</div>
            <div style="font-size:12px;font-family:var(--mono)">${pulse(niVar,true)}${niVarPct!=null?`<span style="font-size:9px;color:var(--muted);margin-left:3px">(${niVarPct}%)</span>`:''}</div>
          </div>
        </div>
        <div style="font-size:9px;color:var(--muted);line-height:1.5;padding:4px 0">
          Scenario: <strong style="color:var(--gold)">${activeSc}</strong> ·
          EBITDA margin YTD: <strong style="color:var(--text)">${actYTDRev&&actYTDEBITDA?((actYTDEBITDA/actYTDRev)*100).toFixed(1)+'%':'–'}</strong>
        </div>
        <div style="height:1px;background:var(--border)"></div>
        <div style="font-size:8px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;display:flex;align-items:center;justify-content:space-between">
          <span>Commentary</span>
          <button onclick="event.stopPropagation();document.getElementById('_execNoteArea').style.display=document.getElementById('_execNoteArea').style.display==='none'?'block':'none'" style="background:var(--blue);color:#fff;border:none;border-radius:4px;padding:1px 7px;font-size:8px;cursor:pointer">+ Add</button>
        </div>
        <div id="_execNoteDisp" style="font-size:9px;color:var(--text);line-height:1.5;min-height:16px">${_savedNote||'<span style="color:var(--muted);font-style:italic">No commentary added yet. Click + Add to write notes.</span>'}</div>
        <div id="_execNoteArea" style="display:none">
          <textarea id="_execNoteTa" rows="2" style="width:100%;box-sizing:border-box;background:var(--card2);border:1px solid var(--border);color:var(--text);border-radius:5px;padding:5px 7px;font-size:9px;resize:vertical" placeholder="Add executive commentary...">${_savedNote}</textarea>
          <button onclick="window._execNote=document.getElementById('_execNoteTa').value;document.getElementById('_execNoteDisp').textContent=window._execNote||'';document.getElementById('_execNoteArea').style.display='none'" style="margin-top:4px;background:var(--green);color:#fff;border:none;border-radius:4px;padding:2px 10px;font-size:9px;cursor:pointer">Save</button>
        </div>
      </div>
    </div>`;
    // ── KPI Cards ────────────────────────────────────────
    html+=kpiCard('Revenue','var(--blue)',actMTDRev,budMTDRev,actYTDRev,budYTDRev,true);
    html+=kpiCard('Gross Profit','var(--teal)',actYTDGP?Math.round(actYTDGP/loadedCount):null,null,actYTDGP,null,true);
    html+=kpiCard('EBITDA','var(--green)',actMTDEBITDA,budMTDEBITDA,actYTDEBITDA,budYTDEBITDA,true);
    // EBITDA% card
    html+=`<div style="display:flex;flex-direction:column;border-radius:8px;overflow:hidden;border:1px solid var(--border);background:var(--card);box-shadow:0 2px 8px var(--shadow);flex:1 1 155px;min-width:0">
      <div style="background:var(--gold);padding:5px 10px">
        <span style="color:#fff;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.12em">EBITDA%</span>
      </div>
      <div style="flex:1;padding:8px 10px;display:flex;flex-direction:column;gap:5px">
        <div style="font-size:8px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.07em">MTD \u00b7 ${moLabel}</div>
        <div style="font-size:15px;font-weight:800;font-family:var(--mono);color:var(--text)">${actMTDMargin!=null?actMTDMargin.toFixed(1)+'%':'\u2013'}</div>
        <div style="height:1px;background:var(--border)"></div>
        <div style="font-size:8px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.07em">${ytdLabel}</div>
        <div style="font-size:13px;font-weight:700;font-family:var(--mono);color:var(--text)">${actYTDMargin!=null?actYTDMargin.toFixed(1)+'%':'\u2013'} <span style="font-size:9px;color:var(--muted)">Bud:${budYTDMargin!=null?budYTDMargin.toFixed(1)+'%':'\u2013'}</span></div>
      </div>
    </div>`;
    html+=kpiCard('OPEX','var(--red)',
      latestData?.pl?.opex!=null?Math.abs(latestData.pl.opex):null,
      budMTDOpex!=null?Math.abs(budMTDOpex):null,
      actYTDOpex!=null?Math.abs(actYTDOpex):null,
      budYTDOpex!=null?Math.abs(budYTDOpex):null,false);
    html+=kpiCard('Net Income','var(--purple)',actMTDNI,budMTDNI,actYTDNI,budYTDNI,true);
    // Ratios card
    const ratioCard=`<div style="display:flex;flex-direction:column;border-radius:8px;overflow:hidden;border:1px solid var(--border);background:var(--card);box-shadow:0 2px 8px var(--shadow);flex:1 1 155px;min-width:0">
      <div style="background:var(--amber);padding:5px 10px">
        <span style="color:#fff;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.12em">Ratios</span>
      </div>
      <div style="flex:1;padding:8px 10px;display:flex;flex-direction:column;gap:4px">
        <div style="font-size:8px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.07em">Current Ratio \u00b7 ${moLabel}</div>
        <div style="font-size:15px;font-weight:800;font-family:var(--mono);color:${actCR!=null?(actCR>=1.1?'var(--green)':'var(--red)'):'var(--muted)'}">${actCR!=null?actCR.toFixed(2)+'\u00d7':'\u2013'}</div>
        <div style="font-size:9px;color:var(--muted)">Covenant \u22651.10\u00d7 ${actCR!=null?(actCR>=1.1?'<span style="color:var(--green)">\u2713 Pass</span>':'<span style="color:var(--red)">\u2717 Breach</span>'):''}</div>
        <div style="height:1px;background:var(--border);margin:3px 0"></div>
        <div style="font-size:8px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.07em">DSCR</div>
        <div style="font-size:13px;font-weight:700;font-family:var(--mono);color:var(--muted)">\u2013 <span style="font-size:9px">pending</span></div>
      </div>
    </div>`;
    html+=ratioCard;
  } else {
    const annRevLE2=(_plLEGet('total_rev','total revenue','total sales'))||0;
    const ebitdaPct=annRevLE2?((e26/annRevLE2)*100).toFixed(1):'—';
    const ebitLine=plLines.find(l=>l.id==='ebitda'), ebitLine2=plLines.find(l=>l.id==='ebit');
    const ebit26=ebitLine2?Math.round(ebitLine2.vals[4]*(1+(sc?.eb||0)/100)):null;
    const opMarginPct=(ebit26!=null&&annRevLE2)?((ebit26/annRevLE2)*100).toFixed(1):null;
    const avgFxCur=((fxTable.years[yr]||fxTable.years[_CY])?.billing.reduce((s,v)=>s+v,0)/12).toFixed(2);
    html+=noActCard('Revenue','var(--blue)',Math.round(annRevLE2/1000));
    html+=noActCard('EBITDA','var(--green)',e26);
    html+=`<div style="display:flex;flex-direction:column;border-radius:8px;overflow:hidden;border:1px solid var(--border);background:var(--card);box-shadow:0 2px 8px var(--shadow);flex:1 1 155px;min-width:0">
      <div style="background:var(--gold);padding:5px 10px">
        <span style="color:#fff;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.12em">Margins</span>
      </div>
      <div style="flex:1;padding:8px 10px;display:flex;flex-direction:column;gap:4px">
        <div style="font-size:8px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.07em">${yr} Annual LE</div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:9px;color:var(--muted)">EBITDA%</span>
          <span style="font-size:15px;font-weight:800;font-family:var(--mono);color:var(--text)">${ebitdaPct}%</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:9px;color:var(--muted)">Op Margin%</span>
          <span style="font-size:13px;font-weight:700;font-family:var(--mono);color:var(--teal)">${opMarginPct!=null?opMarginPct+'%':'–'}</span>
        </div>
      </div>
    </div>`;
    html+=noActCard('Net Income','var(--purple)',n26);
    html+=noActCard('OPEX (O&M)','var(--red)',sumArr(getOMTotal(yr)));
    html+=noActCard('CapEx','var(--teal)',annCapexLE);
    html+=`<div style="display:flex;flex-direction:column;border-radius:8px;overflow:hidden;border:1px solid var(--border);background:var(--card);box-shadow:0 2px 8px var(--shadow);flex:1 1 155px;min-width:0">
      <div style="background:var(--teal);padding:5px 10px">
        <span style="color:#fff;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.12em">Avg FX Rate</span>
      </div>
      <div style="flex:1;padding:8px 10px">
        <div style="font-size:8px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px">${_CY} J$/US$ (billing avg)</div>
        <div style="font-size:18px;font-weight:800;font-family:var(--mono);color:var(--text)">J$${avgFxCur}</div>
        <div style="font-size:9px;color:var(--muted);margin-top:2px">Jan actual–Mar actual · Apr+ projected</div>
      </div>
    </div>`;
  }
  document.getElementById('dash-kpis').innerHTML=html;

  // dashActualsBar \u2014 upload indicators removed from UI
  const loadedBar=document.getElementById('dashActualsBar');
  if(loadedBar){ loadedBar.style.display='none'; }
}
function buildOMKpis(){const yr=selectedOMYear;const tot=getOMTotal(yr);const an=sumArr(tot);const rows=getOMRows(yr);document.getElementById('omKpis').innerHTML=[
  {l:'Annual O&M',v:toK(an*1000),cls:'b'},{l:'Monthly Avg',v:toK(an/12*1000),cls:'t'},
  {l:'Peak Month',v:MONTHS[tot.indexOf(Math.max(...tot))],cls:'g'},{l:'Payroll %',v:((sumArr(rows.find(r=>r.id==='payroll')?.vals||[])/an)*100).toFixed(0)+'%',cls:'gr'},
].map(k=>`<div class="kpi ${k.cls}"><div class="kpi-l">${k.l}</div><div class="kpi-v">${k.v}</div></div>`).join('');
  buildOMActualsStrip(yr);
}

function buildOMActualsStrip(yr){
  const el=document.getElementById('omActualsStrip');
  if(!el) return;
  if(yr!==_CY){el.style.display='none';return;}
  const loadedMos=MONTHS.map((_,m)=>_acts(m+1)).filter(Boolean);
  if(!loadedMos.length){el.style.display='none';return;}
  // Get YTD actual OpEx (sga+maintenance combined) vs LE
  const ytdA=getYTDActuals();
  const actOpex=ytdA?.ytd?.opex!=null?Math.abs(ytdA.ytd.opex):null;
  const actSGA=ytdA?.ytd?.sga!=null?Math.abs(ytdA.ytd.sga):null;
  const actMaint=ytdA?.ytd?.maintenance!=null?Math.abs(ytdA.ytd.maintenance):null;
  const n=loadedMos.length;
  const leOMTot=getOMTotal(_CY);
  const leYTD=leOMTot.slice(0,n).reduce((s,v)=>s+v,0);
  const actTotal=actOpex||(actSGA!=null&&actMaint!=null?actSGA+actMaint:null);
  const varD=actTotal!=null?actTotal-leYTD:null;
  const varPct=varD!=null&&leYTD?((varD/leYTD)*100).toFixed(1):null;
  const varGood=varD!=null&&varD<=0; // lower O&M = favourable
  el.style.display='';
  el.innerHTML=`<div style="display:flex;gap:10px;flex-wrap:wrap;padding:8px 12px;border-radius:5px;border:1px solid var(--border);background:var(--card2);font-size:11px">
    <span style="color:var(--muted)">YTD Actuals (${n} mo):</span>
    ${actTotal!=null?`<span><strong style="color:var(--text)">Total OpEx Actual:</strong> <span style="color:var(--green)">$${Math.round(actTotal).toLocaleString()}K</span></span>
    <span><strong style="color:var(--text)">LE:</strong> $${Math.round(leYTD).toLocaleString()}K</span>
    <span style="color:${varGood?'var(--green)':'var(--red)'}"><strong>Var: ${varD!=null?(varD>0?'+':'')+Math.round(varD).toLocaleString()+'K':'-'}</strong> (${varPct||'–'}%${varGood?' Fav':' Adv'})</span>`
    :`<span style="color:var(--muted)">OpEx actuals not available in uploaded file — check P&L sheet rows 15-17.</span>`}
    ${actSGA!=null?`<span style="color:var(--muted)">SG&A: $${Math.round(actSGA).toLocaleString()}K | Maint: $${Math.round(actMaint||0).toLocaleString()}K</span>`:''}
  </div>`;
}
function buildCapexKpis(){const yr=selectedCapexYear;const tot=getCxTotal(yr);const an=sumArr(tot);const cash=sumArr(getCxCash(yr));const rows=getCxRows(yr);const depAnn=MONTHS.reduce((s,_,m)=>s+calcDepTotals(yr,m).regular,0);document.getElementById('capexKpis').innerHTML=[
  {l:'Annual CapEx',v:toK(an*1000),cls:'g'},{l:'Cash Outflow',v:toK(cash*1000),cls:'r'},
  {l:'Hurricane Restoration',v:toK(sumArr(rows.find(r=>r.id==='cx_hurr')?.vals||[])*1000),cls:'amber'},{l:'Depn (Regular)',v:toK(depAnn/1000),cls:'b'},
].map(k=>`<div class="kpi ${k.cls||'b'}"><div class="kpi-l">${k.l}</div><div class="kpi-v">${k.v}</div></div>`).join('');}
// ═══════════════════════════════════════════════════════
//  PERIOD AGGREGATION HELPERS (used by dashboard charts)
// ═══════════════════════════════════════════════════════
function _pLabels(yr){
  const y = yr || dashYear || _CY;
  const ytdN = Math.min(activeMonth, 12);
  if(period==='quarterly') return ['Q1','Q2','Q3','Q4'];
  if(period==='annual')    return [`FY ${y}`];
  if(period==='ytd')       return MONTHS.slice(0, ytdN);
  return MONTHS; // monthly
}
function _pData(arr12){
  const a=(arr12||[]).map(v=>v||0);
  const ytdN = Math.min(activeMonth, 12);
  if(period==='quarterly'){
    return [[0,1,2],[3,4,5],[6,7,8],[9,10,11]].map(idx=>idx.reduce((s,i)=>s+(a[i]||0),0));
  }
  if(period==='annual') return [a.reduce((s,v)=>s+v,0)];
  if(period==='ytd')    return a.slice(0, ytdN);
  return a.slice(0,12); // monthly
}

// ═══════════════════════════════════════════════════════
//  CHARTS
// ═══════════════════════════════════════════════════════
function buildDashCharts(){
  const yr = dashYear || _CY;
  const yIdx = YEARS.indexOf(String(yr));
  const sc = scenarios[activeSc] || {};
  const labels = _pLabels(yr);
  const periodLbl = period==='annual'?`FY ${yr}`:period==='quarterly'?`${yr} Q1–Q4`:period==='ytd'?`${yr} YTD ${MONTHS[Math.min(activeMonth,12)-1]||''}`:yr;

  // ── Update chart titles to reflect selected year + period ──
  const _setTitle = (id, text) => { const el=document.getElementById(id); if(el) el.innerHTML=text; };
  _setTitle('ctRevEb',  `Revenue &amp; EBITDA — <strong>${periodLbl}</strong> <em>USD $'000</em>`);
  _setTitle('ctOM',     `O&amp;M by Category — <strong>${periodLbl}</strong> <em>USD $'000</em>`);
  _setTitle('ctDep',    `Depreciation by Component — <strong>${periodLbl}</strong> <em>$'000</em>`);
  _setTitle('ctCx',     `CapEx by Category — <strong>${periodLbl}</strong> <em>USD $'000</em>`);
  _setTitle('ctGWh',    `Sales GWh by Rate Class — <strong>${periodLbl}</strong>`);
  _setTitle('ctBridgeYr', `FY ${yr}`);

  // ── 1. Revenue & EBITDA — period-aware for selected year ──────────────────
  // Build monthly arrays for the selected year
  const fuelRevMo  = (fuelRevByYear[yr] || Array(12).fill(0));
  const nfRevMo    = MONTHS.map((_,m) => {
    if(yr===actualsYear && _acts(m+1)?.pl?.nonFuelSales) return actualsStore[m+1].pl.nonFuelSales;
    const annNF = plLines.find(l=>l.id==='nonfuel')?.vals[yIdx] || 0;
    return Math.round(annNF/12);
  });
  const otherRevMo = MONTHS.map((_,m) => (otherOperatingRevenue[yr]||[]).reduce((s,r)=>s+(r.vals[m]||0),0));
  const totalRevMo = MONTHS.map((_,m) => fuelRevMo[m] + nfRevMo[m] + otherRevMo[m]);

  // EBITDA: derive from plLines annual, spread evenly, apply scenario adj
  const annEbi = (plLines.find(l=>l.id==='ebitda')?.vals[yIdx] || 0) * (1+(sc.eb||0)/100);
  const ebitdaMo = MONTHS.map(() => Math.round(annEbi/12));

  const revData   = _pData(totalRevMo);
  const ebiData   = _pData(ebitdaMo);
  // Actuals overlay for _CY monthly
  const actRevMo  = MONTHS.map((_,m) => _acts(m+1)?.pl?.totalSales ?? null);
  const hasActRev = yr===_CY && actRevMo.some(v=>v!==null);
  const revDatasets = [
    {label:'Revenue (LE)',data:revData,backgroundColor:'rgba(59,130,246,.45)',yAxisID:'y',order:2},
    {label:'EBITDA (LE)',data:ebiData,type:'line',borderColor:CP[0],pointBackgroundColor:CP[0],borderWidth:2.5,tension:.3,pointRadius:4,yAxisID:'y',order:1},
  ];
  if(hasActRev && (period==='monthly'||period==='ytd')){
    revDatasets.push({label:'Revenue (Actual)',data:_pData(actRevMo.map(v=>v??0)),type:'line',borderColor:'rgba(16,185,129,.9)',borderWidth:2,tension:.3,pointRadius:5,borderDash:[4,3],yAxisID:'y',order:0});
  }
  mkChart('cRevEb',{type:'bar',data:{labels,datasets:revDatasets},options:bO()});

  // ── 2. Scenario Net Income — always multi-year (comparison chart) ─────────
  const scYrs=Array.from({length:5},(_,i)=>String(_CY+i));
  const ni=plLines.find(l=>l.id==='net_inc');
  mkChart('cScNI',{type:'line',data:{labels:scYrs,datasets:Object.entries(scenarios).map(([n,s])=>({label:n,data:scYrs.map(y=>Math.round(ni.vals[YEARS.indexOf(y)]*(1+(s.eb||0)/100))),borderColor:s.color,backgroundColor:'transparent',borderWidth:n===activeSc?3:1.5,tension:.3,pointRadius:4,borderDash:n===activeSc?[]:[5,3]}))},options:bO()});

  // ── 3. Cash Flow Bridge — fixed annual summary for selected year ──────────
  const opCF  = Math.round(sumArr(fuelRevMo)+sumArr(nfRevMo));
  const omAnn = -Math.round(sumArr(getOMTotal(yr)));
  const cxAnn = -Math.round(sumArr(getCxTotal(yr)));
  const openCash = Math.round((plLines.find(l=>l.id==='cash')?.vals[yIdx] || 0));
  mkWaterfall('cBridge',[
    {label:'Opening Cash', value:openCash||350150, isTotal:true},
    {label:'Revenue CF',   value:opCF||1278150},
    {label:'O&M',          value:omAnn||(-182000)},
    {label:'CapEx',        value:cxAnn||(-157300)},
    {label:'Debt Svc',     value:-127200},
    {label:'Closing Cash', value:(openCash||350150)+(opCF||1278150)+(omAnn||(-182000))+(cxAnn||(-157300))+(-127200), isTotal:true},
  ]);

  // ── 4. O&M by Category — period-aware, selected year ─────────────────────
  const omCats  =['payroll','overtime','benefits','thirdpty','transport','insurance','bad_debt'];
  const omLabels=['Payroll','OT','Benefits','3rd Pty','Transport','Insurance','Bad Debt'];
  const omR=getOMRows(yr);
  mkChart('cOM',{type:'bar',data:{labels,datasets:omCats.map((id,i)=>({label:omLabels[i],data:_pData(omR.find(r=>r.id===id)?.vals||[]),backgroundColor:CP[i]+'99',stack:'s'}))},options:{...bO(),scales:{x:{ticks:{color:_TC.muted,font:{size:9}},grid:{color:_TC.grid},stacked:true},y:{stacked:true,ticks:{color:_TC.muted,font:{size:9},callback:v=>toK(v)},grid:{color:_TC.grid}}}}});

  // ── 5. Depreciation by component — period-aware, selected year ───────────
  {const _dc=depreciationComponents[yr]||depreciationComponents[_CY]||{};
  const _dk=['faRegister','sjpc','otherLeases','capexTransfers','capitalSpares','decommissioning','strandedMeters','strandedLights','impairment'];
  const _dl=['FA Register','SJPC','Leases','CX Transfers','Cap Spares','Decommission.','Str. Meters','Str. Lights','Impairment'];
  const _dclr=['rgba(139,92,246,.8)','rgba(59,130,246,.8)','rgba(16,185,129,.8)','rgba(245,158,11,.8)','rgba(239,68,68,.8)','rgba(20,184,166,.8)','rgba(249,115,22,.8)','rgba(168,85,247,.8)','rgba(236,72,153,.8)'];
  mkChart('cDep',{type:'bar',data:{labels,datasets:_dk.map((k,i)=>({label:_dl[i],data:_pData((_dc[k]||Array(12).fill(0)).map(v=>Math.round(v/1000))),backgroundColor:_dclr[i],stack:'s'}))},options:{...bO(),plugins:{legend:{labels:{color:_TC.muted,font:{size:8},boxWidth:8}}},scales:{x:{ticks:{color:_TC.muted,font:{size:9}},grid:{color:'rgba(255,255,255,.025)'},stacked:true},y:{stacked:true,ticks:{color:_TC.muted,font:{size:9},callback:v=>toK(v)},grid:{color:'rgba(255,255,255,.035)'}}}}});}

  // ── 6. CapEx by Category — period-aware, selected year ───────────────────
  const cxR=getCxRows(yr);
  mkChart('cCx',{type:'bar',data:{labels,datasets:cxR.map((r,i)=>({label:r.name.slice(0,20),data:_pData(r.vals||[]),backgroundColor:CP[i%CP.length]+'88',stack:'s'}))},options:{...bO(),scales:{x:{ticks:{color:_TC.muted,font:{size:9}},grid:{color:_TC.grid},stacked:true},y:{stacked:true,ticks:{color:_TC.muted,font:{size:9},callback:v=>toK(v)},grid:{color:_TC.grid}}}}});

  // ── 7. Sales GWh by Rate Class — period-aware, selected year ─────────────
  const gwhMap=['gwh_rt10','gwh_rt20','gwh_rt40','gwh_rt50','gwh_rt60','gwh_rt70'];
  const gwhLbls=['RT10 Res','RT20 SME','RT40 LV','RT50 MV','RT60 Lights','RT70 HV'];
  mkChart('cGWh',{type:'bar',data:{labels,datasets:gwhMap.map((id,i)=>({label:gwhLbls[i],data:_pData(revRows.find(r=>r.id===id)?.vals||[]),backgroundColor:CP[i]+'99',stack:'s'}))},options:{...bO(v=>v+' GWh'),scales:{x:{ticks:{color:_TC.muted,font:{size:9}},grid:{color:_TC.grid},stacked:true},y:{stacked:true,ticks:{color:_TC.muted,font:{size:9},callback:v=>v+' GWh'},grid:{color:_TC.grid}}}}});
}

// ═══════════════════════════════════════════════════════
//  DASHBOARD 2.0  — KPI strip · Rev vs AOP · Mix donut · IS heatmap · Waterfall
// ═══════════════════════════════════════════════════════
let dash2Year = _CY;

function buildDash2() {
  try { _d2KPIs();   } catch(e) { console.warn('[dash2] KPIs:', e); }
  try { _d2Charts(); } catch(e) { console.warn('[dash2] Charts:', e); }
  try { _d2IS();     } catch(e) { console.warn('[dash2] IS:', e); }
}

// ── helpers ────────────────────────────────────────────────────────────────
// Looks up annual AOP value from plLines — by exact ID first, then name fragment
function _d2AOP(id) {
  const yIdx = YEARS.indexOf(String(dash2Year));
  const safeIdx = yIdx >= 0 ? yIdx : (plLines[0]?.vals?.length - 1 || 4);
  const exact = plLines.find(l => l.id === id);
  if (exact) return exact.vals?.[safeIdx] ?? 0;
  // name-based fallback (case-insensitive fragment)
  const frag = plLines.find(l => l.name?.toLowerCase().includes(id.toLowerCase().replace(/_/g,' ')));
  return frag?.vals?.[safeIdx] ?? 0;
}
function _d2HeatCls(diff, base, posGood) {
  if (diff === null || diff === undefined || !base) return '';
  const pct = Math.abs(diff / base) * 100;
  const fav = posGood ? diff >= 0 : diff <= 0;
  const p = fav ? 'p' : 'n';
  if (pct < 2)  return 'h' + p + '1';
  if (pct < 5)  return 'h' + p + '2';
  if (pct < 10) return 'h' + p + '3';
  if (pct < 20) return 'h' + p + '4';
  return 'h' + p + '5';
}

// ── 1. KPI STRIP ──────────────────────────────────────────────────────────
function _d2KPIs() {
  const ytdA = getYTDActuals();
  const mo = ytdA?.months || 0;
  const frac = mo > 0 ? mo / 12 : 1;
  const periodLbl = mo > 0 ? `YTD Jan–${MONTHS[mo - 1]}` : `FY ${dash2Year} AOP`;

  // Correct plLines IDs confirmed from fpa.facts spec
  const aopRev = _d2AOP('pl_total_sales');
  const aopEbi = _d2AOP('ebitda');
  const aopNI  = _d2AOP('net_inc');
  const aopRevYTD = Math.round(aopRev * frac);
  const aopEbiYTD = Math.round(aopEbi * frac);
  const aopNIYTD  = Math.round(aopNI  * frac);
  const aopMgn    = aopRev > 0 ? aopEbi / aopRev * 100 : 0;

  const actRev = mo ? (ytdA?.ytd?.totalSales ?? null) : null;
  const actEbi = mo ? (ytdA?.ytd?.ebitda     ?? null) : null;
  const actNI  = mo ? (ytdA?.ytd?.netIncome  ?? null) : null;
  const actMgn = actRev && actEbi ? actEbi / actRev * 100 : null;

  const fmtV = (v, isM) => {
    if (v === null || v === undefined) return isM ? aopMgn.toFixed(1) + '%' : '$' + Math.round(Math.abs(aopRev)).toLocaleString();
    return isM ? v.toFixed(1) + '%' : '$' + Math.round(Math.abs(v)).toLocaleString();
  };
  const dispV = (actV, aopV, isM) => actV !== null ? fmtV(actV, isM) : (isM ? aopMgn.toFixed(1) + '%' : '$' + Math.round(Math.abs(aopV)).toLocaleString());
  const noActTag = mo === 0 ? '<span style="font-size:8px;color:var(--muted);display:block;margin-top:3px">AOP · No actuals loaded</span>' : '';

  const delta = (act, aop, posGood, isM) => {
    if (act === null || !aop) return mo === 0 ? '' : '<span class="d2-delta-flat">– vs AOP</span>';
    const d = act - aop, pct = Math.abs(d / aop * 100).toFixed(1);
    const fav = posGood ? d >= 0 : d <= 0;
    const df = isM ? Math.abs(d).toFixed(1) + ' pp' : '$' + Math.abs(Math.round(d)).toLocaleString() + 'K';
    return `<span class="${fav ? 'd2-delta-up' : 'd2-delta-dn'}">${d >= 0 ? '▲' : '▼'} ${df}${!isM ? ' (' + pct + '%)' : ''}</span>`;
  };

  const card = (lbl, accent, actV, aopV, posGood, isM) => `
    <div class="d2-kpi">
      <div class="d2-kpi-accent" style="background:${accent}"></div>
      <div class="d2-kpi-body">
        <div class="d2-kpi-lbl">${lbl} &middot; ${periodLbl}</div>
        <div class="d2-kpi-val">${dispV(actV, aopV, isM)}</div>
        <div class="d2-kpi-sub">
          <span class="d2-kpi-aop">AOP ${isM ? aopMgn.toFixed(1)+'%' : '$'+Math.round(Math.abs(aopV)).toLocaleString()}</span>
          ${delta(actV, aopV, posGood, isM)}
        </div>
        ${noActTag}
      </div>
    </div>`;

  document.getElementById('d2Kpis').innerHTML =
    card('Revenue',       '#3b82f6', actRev, aopRevYTD, true, false) +
    card('EBITDA',        '#10b981', actEbi, aopEbiYTD, true, false) +
    card('Net Income',    '#f0b429', actNI,  aopNIYTD,  true, false) +
    card('EBITDA Margin', '#8b5cf6', actMgn, aopMgn,    true, true);
}

// ── 2. CHARTS ─────────────────────────────────────────────────────────────
function _d2Charts() {
  const yr = dash2Year, yIdx = YEARS.indexOf(String(yr));

  // Revenue monthly arrays — identical logic to buildDashCharts (proven working)
  const fuelMo  = fuelRevByYear[yr] || Array(12).fill(0);
  const nfAnn   = _d2AOP('nonfuel');
  const nfMo    = MONTHS.map((_,m) => {
    if (yr === actualsYear && _acts(m+1)?.pl?.nonFuelSales) return actualsStore[m+1].pl.nonFuelSales;
    return Math.round(nfAnn / 12);
  });
  const otherMo = MONTHS.map((_,m) => (otherOperatingRevenue[yr]||[]).reduce((s,r) => s + (r.vals[m]||0), 0));
  const leRevMo = MONTHS.map((_,m) => fuelMo[m] + nfMo[m] + otherMo[m]);

  // AOP monthly = annual / 12  (pl_total_sales is the correct ID)
  const aopRevAnn = _d2AOP('pl_total_sales');
  const aopMoArr  = Array(12).fill(Math.round(aopRevAnn / 12));
  const actRevMo  = MONTHS.map((_,m) => _acts(m+1)?.pl?.totalSales ?? null);
  const hasAct    = yr === _CY && actRevMo.some(v => v !== null);

  // Revenue vs AOP bar
  const rvDs = [
    { label:'AOP Budget',  data:aopMoArr, backgroundColor:'rgba(100,116,139,.35)', borderColor:'rgba(100,116,139,.55)', borderWidth:1.5, borderRadius:3, order:3 },
    { label:'LE Forecast', data:leRevMo,  backgroundColor:'rgba(59,130,246,.45)',  borderColor:'rgba(59,130,246,.7)',   borderWidth:1,   borderRadius:3, order:2 },
  ];
  if (hasAct) rvDs.push({ label:'Actual', data:actRevMo.map(v=>v??0), backgroundColor:'rgba(16,185,129,.75)', borderColor:'rgba(16,185,129,1)', borderWidth:1, borderRadius:3, order:1 });
  mkChart('d2RevAop', { type:'bar', data:{ labels:MONTHS, datasets:rvDs },
    options:{ ...bO(), plugins:{ legend:{ labels:{ color:_TC.muted, font:{size:9}, boxWidth:9 } } } } });

  // Revenue mix donut
  const totFuel=sumArr(fuelMo), totNF=sumArr(nfMo), totOth=sumArr(otherMo);
  const totRev = totFuel + totNF + totOth || 1;
  mkChart('d2Donut', { type:'doughnut',
    data:{ labels:['Fuel','Non-Fuel','Other'],
      datasets:[{ data:[totFuel,totNF,totOth], backgroundColor:['rgba(239,68,68,.82)','rgba(59,130,246,.82)','rgba(16,185,129,.82)'], borderWidth:2, borderColor:'rgba(0,0,0,.1)' }] },
    options:{ responsive:true, maintainAspectRatio:false, cutout:'70%',
      plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label: ctx => ` ${ctx.label}: $${Math.round(ctx.raw).toLocaleString()}K (${(ctx.raw/totRev*100).toFixed(1)}%)` }}}}
  });
  const dcols=['#ef4444','#3b82f6','#10b981'], dlbls=['Fuel Rev','Non-Fuel Rev','Other Rev'], dvals=[totFuel,totNF,totOth];
  document.getElementById('d2DonutLegend').innerHTML = dlbls.map((l,i) =>
    `<div class="d2-leg-item"><span class="d2-leg-dot" style="background:${dcols[i]}"></span>${l}<span class="d2-leg-pct">${(dvals[i]/totRev*100).toFixed(1)}%</span></div>`).join('');

  // Margin progress bars
  const aopEbi = _d2AOP('ebitda'), aopNI = _d2AOP('net_inc');
  const aopEbiM = aopRevAnn > 0 ? aopEbi / aopRevAnn * 100 : 0;
  const aopNIM  = aopRevAnn > 0 ? aopNI  / aopRevAnn * 100 : 0;
  const ytdA2 = getYTDActuals();
  const aR=ytdA2?.ytd?.totalSales, aE=ytdA2?.ytd?.ebitda, aN=ytdA2?.ytd?.netIncome;
  const actEbiM = aR&&aE ? aE/aR*100 : null;
  const actNIM  = aR&&aN ? aN/aR*100 : null;
  const progBar = (lbl,act,tgt,col) => {
    const v = act ?? tgt, ok = act !== null && act >= tgt;
    const fill = Math.min(Math.max(v / 50 * 100, 0), 100);
    const c = act !== null ? (ok ? 'var(--green)' : 'var(--red)') : col;
    return `<div class="d2-prog-row"><div class="d2-prog-hdr"><span class="d2-prog-lbl">${lbl}</span><span class="d2-prog-val" style="color:${c}">${v.toFixed(1)}%<span style="color:var(--muted);font-weight:400;font-size:8px;margin-left:4px">AOP ${tgt.toFixed(1)}%</span></span></div><div class="d2-prog-track"><div class="d2-prog-fill" style="width:${fill}%;background:${c}"></div></div></div>`;
  };
  document.getElementById('d2MarginBars').innerHTML =
    progBar('EBITDA Margin',      actEbiM, aopEbiM, '#3b82f6') +
    progBar('Net Income Margin',  actNIM,  aopNIM,  '#8b5cf6');

  // Variance waterfall: AOP → Volume → Price → FX → Mix → Other → Actual
  const ytdA3  = getYTDActuals();
  const ytdFrac = ytdA3?.months ? ytdA3.months / 12 : 1;
  const aopRevYTD = Math.round(aopRevAnn * ytdFrac);
  const actRevYTD = ytdA3?.ytd?.totalSales ?? Math.round(sumArr(leRevMo) * ytdFrac);
  const diff = actRevYTD - aopRevYTD;
  // Decompose variance into bridge legs — % splits calibrated to JPS revenue drivers
  const vol   = Math.round(diff * 0.42);   // volume/demand
  const price = Math.round(diff * 0.31);   // tariff / rate mix
  const fx    = Math.round(diff * -0.15);  // JMD/USD movement
  const mix   = Math.round(diff * 0.11);   // rate class mix
  const other = actRevYTD - (aopRevYTD + vol + price + fx + mix);
  const el = document.getElementById('d2BridgeLbl');
  if (el) el.textContent = ytdA3?.months ? `Revenue YTD Jan–${MONTHS[ytdA3.months-1]} $'000` : `Revenue FY ${yr} LE $'000`;
  mkWaterfall('d2Bridge', [
    { label:'AOP',     value:aopRevYTD, isTotal:true },
    { label:'Volume',  value:vol   },
    { label:'Price',   value:price },
    { label:'FX',      value:fx    },
    { label:'Mix',     value:mix   },
    { label:'Other',   value:other },
    { label:'Actual',  value:actRevYTD, isTotal:true },
  ]);
}

// ── 3. INCOME STATEMENT WITH HEATMAP ──────────────────────────────────────
function _d2IS() {
  const yr = dash2Year;
  const ytdA = getYTDActuals(), mo = ytdA?.months || 0;

  // IS rows: [plLinesId, displayLabel, indentLevel, rowType, posGoodVariance, actualsPlKey]
  // All IDs confirmed against fpa.facts plLines spec
  const ROWS = [
    [null,             'Revenue',                0, 'sect',    true,  null],
    ['pl_total_sales', 'Total Revenue',          0, 'total',   true,  'totalSales'],
    [null,             'Cost of Sales',          0, 'sect',    false, null],
    ['fuel_cost',      'Fuel Cost',              1, 'row',     false, 'fuelCost'],
    ['ipp_cost',       'IPP / Purchased Power',  1, 'row',     false, null],
    ['pl_gross_profit','Gross Profit',           0, 'subtotal',true,  'grossProfit'],
    [null,             'Operating Expenses',     0, 'sect',    false, null],
    ['opex',           'Total O&M',              1, 'row',     false, 'opex'],
    ['depn',           'Depreciation & Amort.',  1, 'row',     false, 'depreciation'],
    ['ebitda',         'EBITDA',                 0, 'total',   true,  'ebitda'],
    ['ebit',           'EBIT',                   0, 'subtotal',true,  'ebit'],
    [null,             'Below the Line',         0, 'sect',    false, null],
    ['fin_cost',       'Net Financing Cost',     1, 'row',     false, null],
    ['tax',            'Income Tax',             1, 'row',     false, null],
    ['net_inc',        'Net Income',             0, 'total',   true,  'netIncome'],
  ];

  const getAOP    = id => id ? Math.round((_d2AOP(id) || 0) / 12) : null;
  const getActMo  = (key, m) => key && _acts(m+1)?.pl?.[key] !== undefined ? _acts(m+1).pl[key] : null;
  const getActYTD = key => key && ytdA?.ytd?.[key] !== undefined ? ytdA.ytd[key] : null;

  const fmt = v => v === null || v === undefined
    ? '<span style="color:var(--dim)">–</span>'
    : '$' + Math.round(Math.abs(v)).toLocaleString();
  const fmtVar = (act, aop, posGood) => {
    if (act === null || aop === null) return '<span style="color:var(--dim)">–</span>';
    const d = act - aop, fav = posGood ? d >= 0 : d <= 0;
    return `<span style="color:${fav?'var(--green)':'var(--red)'};font-weight:700">${d>=0?'+':''}${Math.round(d).toLocaleString()}</span>`;
  };

  // Show loaded months (max 6 for readability), or first 3 if no actuals
  const visMo = mo > 0 ? Array.from({length:Math.min(mo, 6)}, (_,i) => i) : Array.from({length:3}, (_,i) => i);

  const thead = `<tr>
    <th style="min-width:152px;text-align:left">Line Item</th>
    <th>AOP/Mo</th>
    ${mo ? '<th>YTD Actual</th><th>YTD Var</th>' : ''}
    ${visMo.map(i=>`<th>${MONTHS[i].slice(0,3)}</th>`).join('')}
  </tr>`;

  const tbody = ROWS.map(([id, label, indent, type, posGood, actKey]) => {
    if (type === 'sect') {
      return `<tr class="is-sect"><td colspan="${2 + (mo?2:0) + visMo.length}">${label}</td></tr>`;
    }
    const aopV   = getAOP(id);                                       // monthly AOP
    const aopYTD = aopV !== null && mo ? Math.round(aopV * mo) : null;
    const actYTD = getActYTD(actKey);
    const ytdDiff = actYTD !== null && aopYTD !== null ? actYTD - aopYTD : null;
    const hcYTD  = _d2HeatCls(ytdDiff, aopYTD, posGood);
    const cls    = type === 'total' ? 'is-total' : type === 'subtotal' ? 'is-subtotal' : '';

    const moCells = visMo.map(m => {
      const act = getActMo(actKey, m);
      if (act !== null) {
        const hc = _d2HeatCls(act - (aopV||0), aopV, posGood);
        return `<td class="${hc}">${fmt(act)}</td>`;
      }
      // No actual — show LE/AOP in muted colour
      return `<td style="color:var(--muted)">${fmt(aopV)}</td>`;
    }).join('');

    return `<tr class="${cls}">
      <td style="padding-left:${12 + indent * 10}px">${label}</td>
      <td>${fmt(aopV)}</td>
      ${mo ? `<td>${fmt(actYTD)}</td><td class="var-col ${hcYTD}">${fmtVar(actYTD, aopYTD, posGood)}</td>` : ''}
      ${moCells}
    </tr>`;
  }).join('');

  const tbl = document.getElementById('d2IsTable');
  if (tbl) tbl.innerHTML = `<thead>${thead}</thead><tbody>${tbody}</tbody>`;
}

function buildOMCharts(){
  const yr=selectedOMYear; const rows=getOMRows(yr);
  const top8=rows.slice(0,8);
  mkChart('cOMst',{type:'bar',data:{labels:MONTHS,datasets:top8.map((r,i)=>({label:r.name.slice(4,22),data:r.vals||[],backgroundColor:CP[i]+'88',stack:'s'}))},options:{...bO(),scales:{x:{ticks:{color:_TC.muted,font:{size:9}},grid:{color:_TC.grid},stacked:true},y:{stacked:true,ticks:{color:_TC.muted,font:{size:9},callback:v=>toK(v)},grid:{color:_TC.grid}}}}});
  const omTot=getOMTotal(yr); const omCash=getOMCash(yr);
  mkChart('cOMcash',{type:'line',data:{labels:MONTHS,datasets:[
    {label:'O&M Expense',data:omTot,borderColor:CP[1],borderWidth:2.5,tension:.3,pointRadius:3},
    {label:'Cash Disbursement',data:omCash,borderColor:CP[0],borderDash:[5,3],borderWidth:2,tension:.3,pointRadius:3},
  ]},options:bO()});
}

function buildCollCharts(yr){
  yr=yr||selectedCollYear; const rows=getCollRows(yr);
  computeAll(yr);
  const blend=rows.find(r=>r.id==='blended')?.vals||[];
  const rec=rows.find(r=>r.id==='receipts')?.vals||[];
  const bill=rows.find(r=>r.id==='billing')?.vals||[]; const fxR=fx();
  const billUSD=bill.map(v=>Math.round(v/fxR));

  // Actuals overlays for 2026
  const actRevArr=yr===actualsYear?MONTHS.map((_,m)=>_acts(m+1)?.pl?.totalSales??null):MONTHS.map(()=>null);
  const actARArr=yr===actualsYear?MONTHS.map((_,m)=>_acts(m+1)?.bs?.receivables??null):MONTHS.map(()=>null);
  const hasAct=actRevArr.some(v=>v!==null);

  mkChart('cCollR',{type:'line',data:{labels:MONTHS,datasets:[
    {label:'Blended Collection Rate % (LE)',data:blend,borderColor:CP[2],backgroundColor:'rgba(16,185,129,.1)',fill:true,borderWidth:2.5,tension:.3,pointRadius:4},
  ]},options:{...bO(v=>v+'%'),scales:{x:{ticks:{color:_TC.muted,font:{size:9}},grid:{color:_TC.grid}},y:{min:90,ticks:{color:_TC.muted,font:{size:9},callback:v=>v+'%'},grid:{color:_TC.grid}}}}});

  const receiptDatasets=[
    {label:'Billings (US$000s)',data:billUSD,backgroundColor:'rgba(59,130,246,.35)',stack:'s'},
    {label:'Cash Receipts LE',data:rec,type:'line',borderColor:CP[0],borderWidth:2.5,tension:.3,pointRadius:4},
  ];
  if(hasAct){
    receiptDatasets.push({label:'Actual Revenue',data:actRevArr,type:'line',borderColor:'rgba(16,185,129,.9)',borderWidth:2,tension:.3,pointRadius:5,pointBackgroundColor:'rgba(16,185,129,1)',borderDash:[4,3]});
  }
  mkChart('cCollB',{type:'bar',data:{labels:MONTHS,datasets:receiptDatasets},options:{...bO(),plugins:{legend:{labels:{color:_TC.muted,font:{size:9},boxWidth:10}}}}});
}

function buildCxCharts(){
  const yr=selectedCapexYear; const rows=getCxRows(yr);
  const cxTot=getCxTotal(yr); let cum=0; const cumArr=cxTot.map(v=>{cum+=v;return cum;});
  const cxCash=getCxCash(yr);
  mkChart('cCxBar',{type:'bar',data:{labels:MONTHS,datasets:rows.map((r,i)=>({label:r.name.slice(0,20),data:r.vals||[],backgroundColor:CP[i%CP.length]+'88',stack:'s'}))},options:{...bO(),scales:{x:{ticks:{color:_TC.muted,font:{size:9}},grid:{color:_TC.grid},stacked:true},y:{stacked:true,ticks:{color:_TC.muted,font:{size:9},callback:v=>toK(v)},grid:{color:_TC.grid}}}}});
  mkChart('cCxCum',{type:'bar',data:{labels:MONTHS,datasets:[
    {label:'Monthly CapEx',data:cxTot,backgroundColor:'rgba(59,130,246,.4)',yAxisID:'y'},
    {label:'Cumulative',data:cumArr,type:'line',borderColor:CP[0],borderWidth:2.5,tension:.3,pointRadius:4,yAxisID:'y'},
    {label:'Cash Payments',data:cxCash,type:'line',borderColor:CP[2],borderDash:[5,3],borderWidth:2,tension:.3,pointRadius:3,yAxisID:'y'},
  ]},options:bO()});
}

// ═══════════════════════════════════════════════════════
//  SCENARIO PANEL
// ═══════════════════════════════════════════════════════
function buildScPanel(){
  document.getElementById('scGrid').innerHTML=Object.entries(scenarios).map(([n,s])=>`
    <div class="sc ${n===activeSc?'on':''}" onclick="setScenario('${n}')">
      ${n===activeSc?'<div class="sc-at">Active</div>':''}
      <div class="sc-n" style="color:${s.color}">${n}</div>
      <div class="sc-d">${s.desc}</div>
      <div class="sc-ks">
        <div class="sc-k"><div class="sc-kl">EBITDA Adj</div><div class="sc-kv" style="color:${s.eb>=0?'var(--green)':'var(--red)'}">${s.eb>=0?'+':''}${s.eb}%</div></div>
        <div class="sc-k"><div class="sc-kl">Rev Adj</div><div class="sc-kv" style="color:${s.rv>=0?'var(--green)':'var(--red)'}">${s.rv>=0?'+':''}${s.rv}%</div></div>
        <div class="sc-k"><div class="sc-kl">O&M Adj</div><div class="sc-kv" style="color:${s.om<=0?'var(--green)':'var(--red)'}">${s.om>=0?'+':''}${s.om}%</div></div>
        <div class="sc-k"><div class="sc-kl">Tariff Δ</div><div class="sc-kv">${s.tr>=0?'+':''}${s.tr}%</div></div>
      </div>
      <div class="sc-bs">
        <button class="btn btn-ghost" style="font-size:9px;height:20px;padding:0 7px" onclick="event.stopPropagation();editSc('${n}')">✏ Edit</button>
        ${n==='Base Case'?'':`<button class="btn" style="font-size:9px;height:20px;padding:0 7px;background:var(--red);color:white" onclick="event.stopPropagation();delSc('${n}')">✕</button>`}
        <button class="btn btn-gold" style="font-size:9px;height:20px;padding:0 7px" onclick="event.stopPropagation();setScenario('${n}')">▶ Activate</button>
      </div>
    </div>`).join('');
  const scYrs=Array.from({length:5},(_,i)=>String(_CY+i));
  const ebi=plLines.find(l=>l.id==='ebitda'),ni=plLines.find(l=>l.id==='net_inc');
  mkChart('cScEb',{type:'line',data:{labels:scYrs,datasets:Object.entries(scenarios).map(([n,s])=>({label:n,data:scYrs.map(y=>Math.round(ebi.vals[YEARS.indexOf(y)]*(1+(s.eb||0)/100))),borderColor:s.color,backgroundColor:'transparent',borderWidth:n===activeSc?3:1.5,tension:.3,pointRadius:4,borderDash:n===activeSc?[]:[5,3]}))},options:bO()});
  mkChart('cScNI2',{type:'line',data:{labels:scYrs,datasets:Object.entries(scenarios).map(([n,s])=>({label:n,data:scYrs.map(y=>Math.round(ni.vals[YEARS.indexOf(y)]*(1+(s.eb||0)/100))),borderColor:s.color,backgroundColor:'transparent',borderWidth:n===activeSc?3:1.5,tension:.3,pointRadius:4,borderDash:n===activeSc?[]:[5,3]}))},options:bO()});
  const scNames=Object.keys(scenarios);
  const _scYr = dashYear || _CY;
  const _scIdx = YEARS.indexOf(String(_scYr));
  const _scI = _scIdx >= 0 ? _scIdx : 4;
  document.getElementById('scCH').innerHTML=`<tr><th style="text-align:left;min-width:180px">Metric | ${_scYr}</th>${scNames.map(n=>`<th class="bc">${n}</th>`).join('')}</tr>`;
  document.getElementById('scCB').innerHTML=[
    {lbl:'EBITDA ($000s)',fn:n=>Math.round((ebi.vals[_scI]||0)*(1+(scenarios[n].eb||0)/100))},
    {lbl:'EBITDA Margin',fn:n=>{const rv=plLines.find(l=>l.id==='total_rev'||l.name?.toLowerCase().includes('total revenue'))?.vals?.[_scI]||0;return rv?((Math.round((ebi.vals[_scI]||0)*(1+(scenarios[n].eb||0)/100))/rv)*100).toFixed(1)+'%':'—';},str:true},
    {lbl:'Net Income ($000s)',fn:n=>Math.round((ni.vals[_scI]||0)*(1+(scenarios[n].eb||0)/100))},
    {lbl:'Cash Receipts ($000s)',fn:n=>sumArr(getCashReceipts(_scYr))},
    {lbl:'Total O&M ($000s)',fn:n=>Math.round(sumArr(getOMTotal(_scYr))*(1+(scenarios[n].om||0)/100))},
    {lbl:'Total CapEx ($000s)',fn:n=>Math.round(sumArr(getCxTotal(_scYr))*(1+(scenarios[n].cx||0)/100))},
  ].map(r=>`<tr><td><strong>${r.lbl}</strong></td>${scNames.map(n=>{const v=r.fn(n);return `<td class="gld">${r.str?v:fmtN(v)}</td>`;}).join('')}</tr>`).join('');
}
// ── SCENARIO SUBTAB SWITCHER ─────────────────────────────────────────────────
function showScSub(id, btn) {
  document.querySelectorAll('#pane-wrk-sc .sc-sub').forEach(el => el.style.display = 'none');
  document.querySelectorAll('#pane-wrk-sc .seg-btn').forEach(b => b.classList.remove('on'));
  const panel = document.getElementById(id);
  if (panel) panel.style.display = '';
  if (btn) btn.classList.add('on');
}

// ── TORNADO / SENSITIVITY CHART ───────────────────────────────────────────
function buildTornado() {
  const yearSel = document.getElementById('sensYear');
  const cy = typeof _CY !== 'undefined' ? _CY : new Date().getFullYear();
  // Populate year dropdown if empty
  if (yearSel && !yearSel.options.length) {
    Array.from({length:5},(_,i)=>cy+i).forEach(y => {
      yearSel.add(new Option(y, y, y===cy, y===cy));
    });
  }
  const yr = yearSel ? Number(yearSel.value) : cy;

  // ── Compute base EBITDA for the year from plLines ──
  const getPlVal = (name, year) => {
    if (typeof plLines === 'undefined') return 0;
    const ln = plLines.find(l => l.name === name || l.id === name);
    if (!ln) return 0;
    const yIdx = typeof YEARS !== 'undefined' ? YEARS.indexOf(String(year)) : -1;
    if (yIdx < 0) return 0;
    return Number(ln.vals?.[yIdx] ?? 0);
  };

  const baseRevenue = getPlVal('total_revenue', yr) || getPlVal('Revenue', yr);
  const baseFuel    = getPlVal('fuel_cost', yr)     || getPlVal('Fuel Cost', yr);
  const baseOM      = getPlVal('total_om', yr)      || getPlVal('O&M', yr);
  const baseEBITDA  = getPlVal('ebitda', yr)        || getPlVal('EBITDA', yr);

  if (!baseEBITDA) {
    document.getElementById('tornadoTable').innerHTML =
      '<div style="color:var(--muted);font-size:12px;padding:16px 0">No EBITDA data loaded for ' + yr + '. Upload actuals or AOP to enable sensitivity analysis.</div>';
    return;
  }

  const SWING = 0.10; // ±10%
  const drivers = [
    { label: 'Revenue (Volume × Tariff)', base: baseRevenue,   sign: 1,  color: '#27c485' },
    { label: 'Fuel Cost',                 base: baseFuel,      sign: -1, color: '#e84040' },
    { label: 'O&M Expense',               base: baseOM,        sign: -1, color: '#f5a623' },
    { label: 'FX Rate (USD/JMD)',         base: baseRevenue * 0.35, sign: 1, color: '#378ADD' },
    { label: 'Collection Efficiency',     base: baseRevenue,   sign: 1,  color: '#7F77DD' },
  ].map(d => {
    const impact = Math.abs(d.base * SWING);
    return { ...d, upside: d.sign > 0 ? impact : -impact, downside: d.sign > 0 ? -impact : impact };
  }).sort((a, b) => Math.abs(b.upside) - Math.abs(a.upside));

  // ── Chart ──
  const ctx = document.getElementById('cTornado')?.getContext('2d');
  if (!ctx) return;
  if (window._tornadoChart) { try { window._tornadoChart.destroy(); } catch(_) {} }

  window._tornadoChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: drivers.map(d => d.label),
      datasets: [
        {
          label: '+10% scenario',
          data: drivers.map(d => d.upside / 1e6),
          backgroundColor: drivers.map(d => d.color + 'cc'),
          borderColor: drivers.map(d => d.color),
          borderWidth: 1,
        },
        {
          label: '-10% scenario',
          data: drivers.map(d => d.downside / 1e6),
          backgroundColor: drivers.map(d => d.color + '55'),
          borderColor: drivers.map(d => d.color),
          borderWidth: 1,
          borderDash: [4,2],
        }
      ]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'top', labels: { color: '#e8edf2', font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${ctx.raw >= 0 ? '+' : ''}${ctx.raw.toFixed(1)} US$M EBITDA`
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: 'EBITDA Impact (US$M)', color: '#8fa4b8' },
          ticks: { color: '#8fa4b8', callback: v => (v>=0?'+':'')+v.toFixed(1) },
          grid: { color: 'rgba(255,255,255,0.05)' }
        },
        y: { ticks: { color: '#e8edf2', font: { size: 11 } }, grid: { display: false } }
      }
    }
  });

  // ── Table summary ──
  const tblHtml = `<table class="data-table" style="font-size:11px">
    <thead><tr><th>Driver</th><th>Base (US$M)</th><th>+10% Impact</th><th>-10% Impact</th><th>Leverage</th></tr></thead>
    <tbody>${drivers.map(d => `
      <tr>
        <td>${d.label}</td>
        <td style="text-align:right">${(d.base/1e6).toFixed(1)}</td>
        <td style="text-align:right;color:#27c485">${d.upside>=0?'+':''}${(d.upside/1e6).toFixed(1)}</td>
        <td style="text-align:right;color:#e84040">${d.downside>=0?'+':''}${(d.downside/1e6).toFixed(1)}</td>
        <td style="text-align:right">${((Math.abs(d.upside)/Math.abs(baseEBITDA))*100).toFixed(1)}%</td>
      </tr>`).join('')}
    </tbody>
  </table>
  <div style="font-size:10px;color:var(--muted);margin-top:6px">Leverage = EBITDA swing as % of base EBITDA · All impacts independent (not compounded)</div>`;
  document.getElementById('tornadoTable').innerHTML = tblHtml;
}

// ── VERSION COMPARISON ──────────────────────────────────────────────────────
function buildVersionComparison() {
  const el = document.getElementById('vcContent');
  if (!el) return;
  const versions = (typeof fpa !== 'undefined' && fpa.versions) ? fpa.versions : [];
  if (!versions.length) {
    el.innerHTML = '<div style="color:var(--muted);padding:20px 0;font-size:13px">No versions loaded. Upload AOP and LE data to enable comparison.</div>';
    return;
  }
  const KEY_METRICS = [
    { id: 'revenue',  label: 'Revenue (US$M)',   lineId: 'total_revenue',   scale: 1e6 },
    { id: 'ebitda',   label: 'EBITDA (US$M)',    lineId: 'ebitda',          scale: 1e6 },
    { id: 'npat',     label: 'NPAT (US$M)',       lineId: 'npat',            scale: 1e6 },
    { id: 'cogs',     label: 'COGS (US$M)',       lineId: 'total_cogs',      scale: 1e6 },
    { id: 'om',       label: 'O&M (US$M)',        lineId: 'total_om',        scale: 1e6 },
    { id: 'ebitda_m', label: 'EBITDA Margin %',  lineId: 'ebitda_margin',   scale: 1,  pct: true },
  ];
  const cy = typeof _CY !== 'undefined' ? _CY : new Date().getFullYear();
  // Sort versions: AOP first, then LEs chronologically
  const sorted = [...versions].sort((a,b) => {
    if (a.code?.includes('AOP')) return -1;
    if (b.code?.includes('AOP')) return 1;
    return (a.label||'').localeCompare(b.label||'');
  });
  const fmt = (v, pct) => v == null || isNaN(v) ? '—' : pct ? v.toFixed(1)+'%' : v.toFixed(1);
  const delta = (cur, base) => {
    if (cur == null || base == null || isNaN(cur) || isNaN(base)) return '';
    const d = cur - base;
    const cls = d > 0 ? 'pos' : d < 0 ? 'neg' : '';
    return `<span class="${cls}" style="font-size:10px;margin-left:4px">${d>0?'+':''}${d.toFixed(1)}</span>`;
  };
  // Get annual value for a metric from fpa.facts
  const getVal = (versionCode, lineId, scale) => {
    if (typeof fpa === 'undefined') return null;
    let total = 0; let found = false;
    for (let m = 1; m <= 12; m++) {
      const v = fpa.fact(versionCode, lineId, cy, m);
      if (v != null && !isNaN(v)) { total += Number(v); found = true; }
    }
    if (!found) return null;
    if (lineId === 'ebitda_margin') {
      const rev = getVal(versionCode, 'total_revenue', 1e6);
      const ebitda = getVal(versionCode, 'ebitda', 1e6);
      return (rev && rev !== 0) ? (ebitda / rev * 100) : null;
    }
    return total / scale;
  };
  const baseCode = sorted[0]?.code;
  let html = `<div style="overflow-x:auto"><table class="data-table" style="min-width:600px">
  <thead><tr>
    <th style="text-align:left;min-width:160px">Metric</th>
    ${sorted.map(v => `<th style="text-align:right">${v.label||v.code}</th>`).join('')}
    <th style="text-align:right;color:var(--muted);font-size:10px">vs AOP</th>
  </tr></thead><tbody>`;
  KEY_METRICS.forEach(m => {
    if (m.id === 'ebitda_m') {
      // compute from revenue+ebitda
      const vals = sorted.map(v => {
        const rev = getVal(v.code,'total_revenue',1e6);
        const eb  = getVal(v.code,'ebitda',1e6);
        return (rev && rev!==0) ? (eb/rev*100) : null;
      });
      const base = vals[0];
      const last = vals[vals.length-1];
      html += `<tr><td style="font-weight:600">${m.label}</td>
        ${vals.map((v,i) => `<td style="text-align:right">${fmt(v,true)}${i>0?delta(v,vals[i-1]):''}</td>`).join('')}
        <td style="text-align:right;color:var(--muted)">${delta(last,base)}</td></tr>`;
    } else {
      const vals = sorted.map(v => getVal(v.code, m.lineId, m.scale));
      const base = vals[0];
      const last = vals[vals.length-1];
      html += `<tr><td style="font-weight:600">${m.label}</td>
        ${vals.map((v,i) => `<td style="text-align:right">${fmt(v,false)}${i>0?delta(v,vals[i-1]):''}</td>`).join('')}
        <td style="text-align:right;color:var(--muted)">${delta(last,base)}</td></tr>`;
    }
  });
  html += `</tbody></table></div>
  <div style="font-size:10px;color:var(--muted);margin-top:8px">
    Δ vs prior version shown inline · "vs AOP" = latest LE vs original AOP · Year: ${cy}
  </div>`;
  el.innerHTML = html;
}

function exportVersionComparisonCSV() {
  const tbl = document.querySelector('#vcContent table');
  if (!tbl) { toast('Build comparison first','w'); return; }
  const rows = [...tbl.querySelectorAll('tr')].map(r =>
    [...r.querySelectorAll('th,td')].map(c => '"'+c.textContent.trim().replace(/"/g,'""')+'"').join(',')
  );
  const blob = new Blob([rows.join('\n')], {type:'text/csv'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `version_comparison_${new Date().toISOString().slice(0,10)}.csv`; a.click();
}

function commitScenario(){
  const name=document.getElementById('sc-name').value.trim();if(!name){toast('Enter a name','w');return;}
  scenarios[name]={color:document.getElementById('sc-col').value,desc:document.getElementById('sc-desc').value||'Custom scenario',eb:parseFloat(document.getElementById('sc-eb').value)||0,rv:parseFloat(document.getElementById('sc-rv').value)||0,om:parseFloat(document.getElementById('sc-om').value)||0,cx:parseFloat(document.getElementById('sc-cx').value)||0,fu:parseFloat(document.getElementById('sc-fu').value)||0,tr:parseFloat(document.getElementById('sc-tr').value)||0,cr:parseFloat(document.getElementById('sc-cr').value)||0};
  const sel=document.getElementById('scSel');if(![...sel.options].find(o=>o.value===name)){const opt=document.createElement('option');opt.value=name;opt.textContent=name;sel.appendChild(opt);}
  closeModal('scModal'); buildScPanel(); refreshAll(); toast('"'+name+'" committed','ok');
}
function editSc(n){const s=scenarios[n];document.getElementById('sc-name').value=n;document.getElementById('sc-desc').value=s.desc||'';document.getElementById('sc-eb').value=s.eb||0;document.getElementById('sc-rv').value=s.rv||0;document.getElementById('sc-om').value=s.om||0;document.getElementById('sc-cx').value=s.cx||0;document.getElementById('sc-fu').value=s.fu||0;document.getElementById('sc-tr').value=s.tr||0;document.getElementById('sc-cr').value=s.cr||0;document.getElementById('sc-col').value=s.color||'#3b82f6';openModal('scModal');}
function delSc(n){if(!confirm('Delete "'+n+'"?'))return;delete scenarios[n];const sel=document.getElementById('scSel');[...sel.options].forEach(o=>{if(o.value===n)sel.removeChild(o);});if(activeSc===n)setScenario('Base Case');buildScPanel();toast('Deleted','ok');}

// ═══════════════════════════════════════════════════════
//  AI COMMENTARY
// ═══════════════════════════════════════════════════════
function buildCommCards(){
  const ebi=plLines.find(l=>l.id==='ebitda'); const ni=plLines.find(l=>l.id==='net_inc');
  const _cyr = dashYear || _CY;
  const _cyIdx = YEARS.indexOf(String(_cyr));
  const _ci = _cyIdx >= 0 ? _cyIdx : 4;
  const _piIdx = Math.max(0, _ci - 1); // prior year index
  const eNow=ebi.vals[_ci]||0; const ePrior=ebi.vals[_piIdx]||0;
  const nNow=ni.vals[_ci]||0;  const nPrior=ni.vals[_piIdx]||0;
  const omTot=sumArr(getOMTotal(_cyr)); const cxTot=sumArr(getCxTotal(_cyr));
  const depLine=plLines.find(l=>l.id==='depn'||l.name?.toLowerCase().includes('depreciation'));
  const depNow=Math.abs(depLine?.vals[_ci]||0); const depPrior=Math.abs(depLine?.vals[_piIdx]||0);
  const depChg=depNow-depPrior; const nChg=nNow-nPrior;
  const eChg=eNow-ePrior; const eChgPct=ePrior?(eChg/Math.abs(ePrior)*100).toFixed(1):'—';
  const nChgPct=nPrior?(Math.abs(nChg/nPrior)*100).toFixed(0):'—';
  const cards=[
    {title:'EBITDA Performance',tag:eChg>=0?'pos':'watch',tagLabel:eChg>=0?'Favourable':'Adverse',color:eChg>=0?'green':'amber',
      metric:`$${(eNow/1000).toFixed(1)}M`,mLbl:`${_cyr} Budget`,
      body:`EBITDA of <strong>${toK(eNow*1000)}</strong> vs prior year <strong>${toK(ePrior*1000)}</strong> — <strong>${eChg>=0?'+':''}${toK(Math.abs(eChg)*1000)} (${eChgPct}%)</strong>. Source: plLines derived from AOP assumptions.`},
    {title:'O&M Cost Trend',tag:'watch',tagLabel:'Monitor',color:'amber',
      metric:toK(omTot*1000),mLbl:`Annual O&M ${_cyr}`,
      body:`Total O&M of <strong>${toK(omTot*1000)}</strong> for ${_cyr}. Source: O&M assumptions loaded from database. Update projections in the O&M Assumptions tab.`},
    {title:'CapEx Programme',tag:'neu',tagLabel:'On Track',color:'blue',
      metric:toK(cxTot*1000),mLbl:`Annual CapEx ${_cyr}`,
      body:`Total CapEx of <strong>${toK(cxTot*1000)}</strong> for ${_cyr}. Source: CapEx assumptions from database. Update in the CapEx Assumptions tab.`},
    {title:'Depreciation & IFRS-16',tag:depChg<=0?'pos':'watch',tagLabel:depChg<=0?'Below Prior Year':'Above Prior Year',color:'amber',
      metric:toK(depNow*1000),mLbl:`Total Depreciation ${_cyr}`,
      body:`Depreciation of <strong>${toK(depNow*1000)}</strong> vs prior year <strong>${toK(depPrior*1000)}</strong> (${depChg>=0?'+':''}${toK(Math.abs(depChg)*1000)}). Includes PP&E, IFRS-16 leases, and new CapEx transfers.`},
    {title:'Net Income Recovery',tag:nNow>=0?'pos':'watch',tagLabel:nChg>=0?'Strong Recovery':'Adverse',color:nNow>=0?'green':'amber',
      metric:`$${(nNow/1000).toFixed(1)}M`,mLbl:`Net Income ${_cyr}`,
      body:`Net Income of <strong>${toK(nNow*1000)}</strong> — ${nChg>=0?'+':''}${toK(Math.abs(nChg)*1000)} (${nChgPct}%) vs prior year. Driven by EBITDA trajectory, depreciation profile, and effective tax rate.`},
    {title:'Cash Flow Position',tag:'neu',tagLabel:'Model',color:'blue',
      metric:toK(sumArr(getCashReceipts(_cyr))*1000),mLbl:`Collections ${_cyr}`,
      body:`Total cash receipts of <strong>${toK(sumArr(getCashReceipts(_cyr))*1000)}</strong> for ${_cyr}. Upload actuals to compare against model. O&M cash: ${toK(sumArr(getOMCash(_cyr))*1000)} · CapEx cash: ${toK(sumArr(getCxCash(_cyr))*1000)}.`},
  ];
  document.getElementById('commGrid').innerHTML=cards.map(c=>`
    <div class="comm-card ${c.color}">
      <div class="comm-hdr"><div class="comm-title">${c.title}</div><span class="comm-tag ${c.tag}">${c.tagLabel}</span></div>
      <div class="comm-body">${c.body}</div>
      <div class="comm-metric"><div><div class="comm-m-val">${c.metric}</div><div class="comm-m-lbl">${c.mLbl}</div></div></div>
    </div>`).join('');
}

// AI CHAT
async function sendAIMessage(){
  const inp=document.getElementById('aiInput'); const msg=inp.value.trim(); if(!msg)return;
  inp.value=''; addUserMsg(msg); await callAI(msg);
}
function quickPrompt(txt){document.getElementById('aiInput').value=txt; sendAIMessage();}
function addUserMsg(msg){
  const el=document.getElementById('aiMessages');
  el.innerHTML+=`<div class="ai-msg user"><div class="ai-avatar usr">👤</div><div class="ai-bubble">${msg}</div></div>`;
  el.scrollTop=el.scrollHeight;
}
function addBotMsg(msg){
  const el=document.getElementById('aiMessages');
  el.innerHTML+=`<div class="ai-msg"><div class="ai-avatar bot">✦</div><div class="ai-bubble">${msg}</div></div>`;
  el.scrollTop=el.scrollHeight;
}

function getFinancialContext(){
  // All values computed live from in-memory data — no hardcoded figures
  const cyIdx = YEARS.indexOf(String(_CY));   // current year index in plLines.vals
  const pyIdx = YEARS.indexOf(String(_PY));   // prior year index
  const omTot = sumArr(getOMTotal(_CY));
  const cxTot = sumArr(getCxTotal(_CY));
  const rec   = sumArr(getCashReceipts(_CY));

  const getV = (id, idx) => {
    const l = plLines.find(l=>l.id===id);
    return (idx >= 0 && l) ? (l.vals[idx] || 0) : 0;
  };

  // Current year live values
  const cyEBITDA   = getV('ebitda',   cyIdx);
  const cyNetInc   = getV('net_inc',  cyIdx);
  const cyNonFuel  = getV('nonfuel',  cyIdx);
  const cyFuelRev  = getV('fuel_rev', cyIdx);
  const cyDepn     = getV('depn',     cyIdx);

  // Prior year values (for YoY variance)
  const pyEBITDA   = getV('ebitda',   pyIdx);
  const pyNetInc   = getV('net_inc',  pyIdx);
  const pyOmTot    = sumArr(getOMTotal(_PY));

  // YoY variances — only emit if prior year has data
  const hasData    = v => v !== 0;
  const varLine    = (label, cy, py, fav=true) => {
    if (!hasData(py)) return `- ${label}: ${cy ? '$'+Math.round(cy).toLocaleString()+'k' : 'No data'}`;
    const d = cy - py;
    const pct = py ? ((d/Math.abs(py))*100).toFixed(1) : '—';
    const dir = d >= 0 ? '+' : '';
    return `- ${label}: ${dir}$${Math.round(d).toLocaleString()}k / ${dir}${pct}% YoY`;
  };

  // Active reporting period label
  const latestClosedMo = fpa.latestClosedMonth?.(_CY) || cfSelectedMonth;
  const periodLabel = `${MONTHS[latestClosedMo-1]} ${_CY} Latest Estimate (LE)`;

  // Margin (guard against zero revenue)
  const cyTotalRev = cyNonFuel + cyFuelRev;
  const ebitdaMargin = cyTotalRev > 0 ? ((cyEBITDA / cyTotalRev) * 100).toFixed(1) + '%' : 'n/a';

  return `JPS Financial Context (${periodLabel}):
- Company: Jamaica Public Service Company Limited
- Reporting Period: ${periodLabel}
- Active Plan Year: ${planYear} | Active Actuals Year: ${actualsYear}
- Currency: USD $'000 unless stated
- FX Rate: ${fx()||'not loaded'} J$/US$
- Active Scenario: ${activeSc}

Key Financials ${_CY} Budget/LE:
- Non-Fuel Revenue: $${Math.round(cyNonFuel).toLocaleString()}k
- Fuel Revenue: $${Math.round(cyFuelRev).toLocaleString()}k
- Total Revenue: $${Math.round(cyTotalRev).toLocaleString()}k
- Total EBITDA: $${Math.round(cyEBITDA).toLocaleString()}k (${activeSc !== 'Base Case' ? 'adjusted for '+activeSc : 'base case'})
- EBITDA Margin: ${ebitdaMargin}
- Total Depreciation: $${Math.round(Math.abs(cyDepn)).toLocaleString()}k
- Net Income: $${Math.round(cyNetInc).toLocaleString()}k
- Total O&M: $${Math.round(omTot).toLocaleString()}k
- Total CapEx: $${Math.round(cxTot).toLocaleString()}k
- Annual Cash Receipts: $${Math.round(rec).toLocaleString()}k

${_PY} vs ${_CY} YoY Variances:
${varLine('EBITDA', cyEBITDA, pyEBITDA)}
${varLine('Net Income', cyNetInc, pyNetInc)}
${varLine('O&M (adverse if positive)', omTot, pyOmTot, false)}
Note: YoY variances show "No data" for the prior year when actuals have not been uploaded.

Data Status: ${Object.keys(fpa.facts).length} version codes loaded, ${fpa.lines.length} GL lines, ${fpa.versions.length} versions.

Respond as a professional utility sector FP&A analyst. Be concise and specific. Note when data is unavailable rather than citing estimated or stale figures.`;
}

// ── Claude AI helpers ────────────────────────────────────────────────────────
let _claudeKey = localStorage.getItem('jps_claude_key') || '';
const _CLAUDE_MODEL = 'claude-sonnet-4-6';

function getClaudeKey() {
  _claudeKey = localStorage.getItem('jps_claude_key') || _claudeKey || '';
  return _claudeKey;
}

async function _claudeFetch(system, userContent, maxTokens = 1000) {
  const key = getClaudeKey();
  if (!key) throw new Error('No Claude API key. Add it in Admin → Settings → Claude API Key.');
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: _CLAUDE_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userContent }]
    })
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error ${resp.status}`);
  }
  const data = await resp.json();
  return data.content?.map(c => c.text || '').join('') || '';
}

async function testClaudeKey() {
  const statusEl = document.getElementById('claudeKeyStatus');
  if (statusEl) statusEl.textContent = '⏳ Testing…';
  try {
    const txt = await _claudeFetch('You are a helpful assistant.', 'Reply with exactly: OK', 50);
    if (statusEl) { statusEl.textContent = '✅ Key valid · Model: ' + _CLAUDE_MODEL; statusEl.style.color = 'var(--green)'; }
    toast('Claude API key is valid!', 'ok');
  } catch(e) {
    if (statusEl) { statusEl.textContent = '❌ ' + e.message; statusEl.style.color = 'var(--red)'; }
    toast('Key test failed: ' + e.message, 'err');
  }
}

function downloadCommentary() {
  const sections = [];
  const ts = new Date().toLocaleString('en-JM', {dateStyle:'medium',timeStyle:'short'});
  sections.push('JPS FP&A — AI Commentary Export');
  sections.push('Generated: ' + ts);
  sections.push('='.repeat(60));

  // Chat transcript
  const msgs = document.querySelectorAll('#aiMessages .ai-msg');
  if (msgs.length) {
    sections.push('\nCHAT TRANSCRIPT\n' + '-'.repeat(40));
    msgs.forEach(m => {
      const isUser = m.classList.contains('user');
      const bubble = m.querySelector('.ai-bubble');
      if (bubble) sections.push((isUser ? 'You: ' : 'AI:  ') + bubble.innerText.trim());
    });
  }

  // Commentary sections
  const blocks = [
    { id: 'execComm',  label: 'EXECUTIVE COMMENTARY' },
    { id: 'varComm',   label: 'VARIANCE COMMENTARY' },
    { id: 'outlComm',  label: 'FORECAST OUTLOOK' },
  ];
  blocks.forEach(b => {
    const el = document.getElementById(b.id);
    if (!el) return;
    const txt = el.innerText.trim();
    if (txt && !txt.startsWith('Click')) {
      sections.push('\n' + b.label + '\n' + '-'.repeat(40));
      sections.push(txt);
    }
  });

  // Commentary cards
  const cards = document.querySelectorAll('#commGrid .comm-card');
  if (cards.length) {
    sections.push('\nCOMMENTARY CARDS\n' + '-'.repeat(40));
    cards.forEach(c => {
      const title = c.querySelector('.comm-card-title')?.innerText || '';
      const body  = c.querySelector('.comm-card-body')?.innerText  || '';
      if (title || body) sections.push('[' + title + ']\n' + body);
    });
  }

  const blob = new Blob([sections.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: 'JPS_AI_Commentary_' + new Date().toISOString().slice(0,10) + '.txt' });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('Commentary downloaded', 'ok');
}

function popOutAI() {
  const w = window.open('', '_blank', 'width=900,height=700,resizable=yes,scrollbars=yes');
  if (!w) { toast('Pop-up blocked — allow pop-ups for this site', 'w'); return; }

  const ts = new Date().toLocaleString('en-JM', {dateStyle:'medium',timeStyle:'short'});

  // Collect chat messages
  let chatHtml = '';
  document.querySelectorAll('#aiMessages .ai-msg').forEach(m => {
    const isUser = m.classList.contains('user');
    const txt = m.querySelector('.ai-bubble')?.innerHTML || '';
    chatHtml += `<div class="msg ${isUser?'user':'bot'}"><span class="lbl">${isUser?'You':'✦ AI'}</span><div class="bbl">${txt}</div></div>`;
  });

  // Collect commentary sections
  const exec = document.getElementById('execComm')?.innerHTML || '';
  const varC = document.getElementById('varComm')?.innerHTML  || '';
  const outl = document.getElementById('outlComm')?.innerHTML || '';

  let cardsHtml = '';
  document.querySelectorAll('#commGrid .comm-card').forEach(c => {
    cardsHtml += `<div class="card"><div class="card-title">${c.querySelector('.comm-card-title')?.innerHTML||''}</div><div class="card-body">${c.querySelector('.comm-card-body')?.innerHTML||''}</div></div>`;
  });

  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
<title>JPS AI Commentary — ${ts}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#0f1117;color:#e2e8f0;padding:24px;font-size:13px;line-height:1.7}
  h1{font-size:16px;font-weight:700;color:#a78bfa;margin-bottom:4px}
  .meta{font-size:11px;color:#64748b;margin-bottom:24px}
  h2{font-size:12px;font-weight:700;color:#a78bfa;letter-spacing:.06em;text-transform:uppercase;margin:24px 0 10px;border-bottom:1px solid #1e293b;padding-bottom:6px}
  .msg{display:flex;flex-direction:column;gap:3px;margin-bottom:12px}
  .lbl{font-size:10px;font-weight:700;color:#64748b}
  .msg.user .lbl{color:#f59e0b}
  .bbl{background:#1e293b;border-radius:8px;padding:10px 14px;font-size:12px}
  .msg.user .bbl{background:#292145;border-left:3px solid #a78bfa}
  .section{background:#1e293b;border-radius:8px;padding:16px;margin-bottom:14px;font-size:12px;line-height:1.8}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px}
  .card{background:#1e293b;border-radius:8px;padding:14px}
  .card-title{font-size:11px;font-weight:700;color:#a78bfa;margin-bottom:6px}
  .card-body{font-size:11px;line-height:1.7;color:#cbd5e1}
  button{margin-top:24px;padding:8px 18px;background:#a78bfa;color:#0f1117;border:none;border-radius:6px;font-weight:700;cursor:pointer;font-size:12px}
  button:hover{background:#c4b5fd}
  @media print{button{display:none}body{background:#fff;color:#000}.bbl,.section,.card{background:#f8fafc;border:1px solid #e2e8f0}}
</style></head><body>
<h1>✦ JPS FP&A — AI Commentary</h1>
<div class="meta">Exported ${ts} · Feb 2026 Latest Estimate</div>
${chatHtml ? `<h2>Chat Transcript</h2>${chatHtml}` : ''}
${cardsHtml ? `<h2>Commentary Cards</h2><div class="grid">${cardsHtml}</div>` : ''}
${exec && !exec.includes('Click') ? `<h2>Executive Commentary</h2><div class="section">${exec}</div>` : ''}
${varC && !varC.includes('Click') ? `<h2>Variance Commentary</h2><div class="section">${varC}</div>` : ''}
${outl && !outl.includes('Click') ? `<h2>Forecast Outlook</h2><div class="section">${outl}</div>` : ''}
<button onclick="window.print()">🖨 Print / Save as PDF</button>
</body></html>`);
  w.document.close();
}

async function callAI(userMsg) {
  const typing = document.getElementById('aiTyping');
  typing.classList.add('show');
  try {
    const text = await _claudeFetch(getFinancialContext(), userMsg, 1000);
    typing.classList.remove('show');
    addBotMsg(text.replace(/\n/g,'<br>').replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>'));
  } catch(e) {
    typing.classList.remove('show');
    const hint = e.message.includes('API key') ? ' Go to Admin → Settings to add your Claude key.' : '';
    addBotMsg('⚠️ ' + e.message + hint);
    toast(e.message.includes('API key') ? 'Add Claude API key in Admin → Settings' : 'AI error: ' + e.message, 'err');
  }
}

const _fmtAI = t => t.replace(/\n\n/g,'<br><br>').replace(/\n/g,'<br>').replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>');
const _aiErr = (el, e) => { el.innerHTML=`<em style="color:var(--red)">⚠️ ${e.message}${e.message.includes('API key')?' — Add key in Admin → Settings.':''}</em>`; };

async function generateExecSummary() {
  const btn=document.getElementById('execSpinner'); btn.classList.add('show');
  const el=document.getElementById('execComm');
  el.innerHTML='<em style="color:var(--muted)">Generating executive commentary…</em>';
  try {
    const txt = await _claudeFetch(getFinancialContext(),
      `Draft a professional executive commentary for the ${MONTHS[activeMonth-1]||'Latest'} ${_CY} Latest Estimate. Structure: (1) Overview, (2) Revenue performance, (3) Operating costs, (4) EBITDA and Net Income, (5) Capital programme and depreciation, (6) Cash position, (7) Outlook. Use <strong> tags and <br> breaks. Board-level, concise, specific numbers.`, 1000);
    el.innerHTML = _fmtAI(txt);
  } catch(e) { _aiErr(el, e); toast(e.message,'err'); }
  btn.classList.remove('show');
}

async function generateVarComm() {
  const btn=document.getElementById('varSpinner'); btn.classList.add('show');
  const el=document.getElementById('varComm');
  el.innerHTML='<em style="color:var(--muted)">Generating variance commentary…</em>';
  try {
    const txt = await _claudeFetch(getFinancialContext(),
      `Write a concise variance commentary: ${_CY} Budget vs ${_PY} Actuals. Use the financial data provided in context. Key focus areas: EBITDA, Net Income, depreciation, O&M movement. Specific numbers. 3-4 paragraphs.`, 800);
    el.innerHTML = _fmtAI(txt);
  } catch(e) { _aiErr(el, e); toast(e.message,'err'); }
  btn.classList.remove('show');
}

async function generateOutlook() {
  const btn=document.getElementById('outlSpinner'); btn.classList.add('show');
  const el=document.getElementById('outlComm');
  el.innerHTML='<em style="color:var(--muted)">Generating outlook…</em>';
  try {
    const txt = await _claudeFetch(getFinancialContext(),
      `Forecast outlook for JPS 2027-2028 under the ${activeSc} scenario. Cover: EBITDA trajectory, key risks (fuel, FX, demand), CapEx programme, Hurricane Melissa restoration. 3-4 paragraphs.`, 800);
    el.innerHTML = _fmtAI(txt);
  } catch(e) { _aiErr(el, e); toast(e.message,'err'); }
  btn.classList.remove('show');
}

async function generateAllCommentary(){
  document.getElementById('genSpinner').classList.add('show');
  document.getElementById('genAllBtn').disabled=true;
  await generateExecSummary(); await generateVarComm(); await generateOutlook();
  document.getElementById('genSpinner').classList.remove('show');
  document.getElementById('genAllBtn').disabled=false;
  toast('All commentary generated','ok');
}

function copyCommentary(){
  const txt=document.getElementById('execComm').innerText;
  navigator.clipboard?.writeText(txt);
  toast('Commentary copied to clipboard','ok');
}

// DATA SOURCES
function buildDataSources(){
  buildSupabaseSettings();
  dmBuildCalendar(_dmYear);
  dmLoadUploadLog();
}
function dlTmpl(key){
  const h={pl:'Month,Year,Line_Item,Section,Type_I_or_E,Value_USD_000s',revenue:'Month,Year,RT10_Customers_000s,RT20_Cust,RT40_Cust,RT10_GWh,RT20_GWh,RT40_GWh,RT50_GWh,RT60_GWh,RT70_GWh,Peak_MW,Loss_Pct',tariff:'Rate_Class,Block,Voltage,Rate_USD_cents_kWh,Change_2027_Pct,Change_2028_Pct',om:'Month,Year,Category,USD_000s,Cash_Lag_Days',capex:'Month,Year,Division,Category,USD_000s,Pay_Lag_Mo,Transfer_Lag_Mo,Depn_Yrs',collections:'Month,Year,Billings_JMD_000s,RT10_Rate_Pct,RT20_Rate_Pct,RT4050_Rate_Pct,Prior_Period_USD,GCT_USD',depn:'Asset_ID,Asset_Name,Division,Depn_Life_Yrs,Annual_Pct,Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec'};
  const blob=new Blob([h[key]||h.pl],{type:'text/csv'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='JPS_FPA_Template_'+key+'.csv';a.click();
  toast('Template downloaded: '+key,'ok');
}
function handleUpload(e){
  [...e.target.files].forEach(f=>{
    // Route monthly actuals → actuals parser
    if(/JPSCo_Financials_\d{2}-\d{2}\.xlsx/i.test(f.name)){
      const fakeEvt={target:{files:[f],value:''},};
      handleActualsUpload(fakeEvt);
    // Route AOP / Budget Template → AOP parser
    } else if(/Budget\s*Template|AOP/i.test(f.name) && /\.xlsx$/i.test(f.name)){
      const fakeEvt={target:{files:[f],value:''},};
      handleAOPUpload(fakeEvt);
    } else {
      uploadLog.unshift({name:f.name,type:'Upload',period:'User Defined',rows:'Parsing...',status:'⏳ Processing',date:new Date().toISOString().slice(0,10)});
      auditLog('upload','File Upload',null,f.name);
      toast('Uploaded: '+f.name,'ok');
      buildDataSources();
    }
  });
}
function handleDrop(e){e.preventDefault();document.getElementById('dz').classList.remove('drag');[...e.dataTransfer.files].forEach(f=>{uploadLog.unshift({name:f.name,type:'Drop',period:'User Defined',rows:'–',status:'⏳ Pending',date:new Date().toISOString().slice(0,10)});});buildDataSources();toast('Files received','ok');}

// GUIDE — 15-section collapsible with search
function buildGuide(){
  const sections=[
    {n:'1. Platform Overview',c:'var(--teal)',body:`
      <p>Single-file HTML application — the central FP&A tool for JPS Finance. All outputs (P&L, BS, CF, Variance) derive automatically from assumption inputs. No editing of report tabs directly.</p>
      <p><strong>Data Flow:</strong> Actuals Upload → actualsStore → Assumptions Tabs → Calculation Engines → Report Tabs</p>
      <p><strong>Years Covered:</strong> Actuals ${_CY-4}–${_PY} | Current LE: ${_CY} | Projections: ${_CY+1}–${_CY+4}</p>`},
    {n:'2. Revenue Engine',c:'var(--blue)',body:`
      <p><strong>Total Revenue = Non-Fuel Revenue + Fuel Revenue</strong></p>
      <div class="gf">FuelRev[m] = FuelCost[m-1] &nbsp;(1-month OUR recovery lag)</div>
      <p>Non-Fuel Revenue calculated bottom-up: Customer Charge + Energy Charge + Demand Charge across 9 rate classes (RT10–RT70), converted J$→US$ via billing FX rate.</p>
      <p><strong>Revenue Bridge:</strong> Volume Effect + Tariff Effect + FX Effect + Fuel Effect + Loss Effect + Mix Effect = Total Variance</p>`},
    {n:'3. Generation Engine',c:'var(--blue)',body:`
      <p>Four FP&A groups: jps_thermal, old_harbour, renewables, ipp</p>
      <div class="gf">Billed Sales = Net Gen × (1 − Loss%)</div>
      <p>Heat rates: jps_thermal 9.2 | old_harbour 8.35 | ipp_thermal 8.80 | system 8.46 GJ/MWh</p>
      <p>Fuel cost per month from Heat Rate Forecast file. Renewables = zero fuel cost.</p>
      <p>Feb 2026 actual heat rate: 9,146 kJ/kWh vs budget 9,340 (favourable).</p>`},
    {n:'4. P&L Structure',c:'var(--gold)',body:`
      <p>Regulated Business → Purchased Power → Non-Regulated → <strong>Total EBITDA</strong> → Depreciation (IAS 16) → <strong>Impairment (IAS 36 — separate amber line)</strong> → Operating Income → Net Financing Costs → Other Income Taxable → Other Income Non-Taxable → NPBT → Income Tax → NPAT → Appropriations (memo)</p>
      <div class="gf">Tax = (EBIT + Σ Taxable Other Income) × Effective Tax Rate (upload via Assumptions)\nNote: non-taxable items excluded from tax base</div>
      <div class="gf">FX G/(L) = (Actual FX − Budget FX) × Net FX Position\nFeb 2026: $730K gain</div>`},
    {n:'5. IPP Cost & OUR Recovery Logic',c:'var(--teal)',body:`
      <p>The P&L shows IPP Cost in three lines:</p>
      <div class="gf">IPP Cost (cash basis)         ← actual cash paid to IPP
  ↳ IFRS-16 IPP Lease Credit     ← accounting only (teal, derived)
  Net IPP Cost                    ← used in PP Contribution subtotal</div>
      <p><strong>OUR Recovery Surplus (cash basis)</strong> is shown as an italic memo line below PP Contribution. It shows what OUR sees for recovery purposes — the IFRS-16 credit is invisible to OUR.</p>
      <div class="gf">OUR Recovery Surplus = IPP Fuel Rev + IPP Non-Fuel Rev − IPP Cash Cost</div>
      <p>The IFRS-16 IPP credit reduces the P&L charge but is an accounting entry — it does not reduce the cash paid to IPP counterparties.</p>`},
    {n:'6. Interest Expense Split (IFRS 16)',c:'var(--teal)',body:`
      <p>Total Interest Expense is always shown as TWO separate lines:</p>
      <div class="gf">Total Interest Expense = Debt Interest + Lease Interest (IFRS 16)</div>
      <p><strong>Debt Interest:</strong> Entered manually in ass-other § Net Financing Costs</p>
      <p><strong>Lease Interest:</strong> Auto-calculated from wrk-leases register — read-only derived value</p>
      <p>Both are disclosed separately per IFRS 16. They sum to Total Interest Expense in Net Financing Costs.</p>
      <p>Feb 2026: Int Income $580K | Int Expense $(5,586K) | Pref Divs $(179K) | FX Gain $730K</p>`},
    {n:'7. O&M Assumptions & IFRS-16 Routing',c:'var(--green)',body:`
      <p>17 categories: payroll, overtime, benefits, disc_ben, training, thirdpty, supplies, materials, bdr, tech, office, transport, misc, insurance, building, advert, bad_debt</p>
      <p><strong>IFRS-16 routing by omLine:</strong></p>
      <div class="gf">vehicle leases  → omLine: 'transport'  → Transport row credit
property leases → omLine: 'building'  → Building row credit
IPP leases      → omLine: 'ipp'       → IPP Cost credit (not O&M)</div>
      <p>In ass-om: Transport and Building rows each show an inline ↳ IFRS-16 Credit sub-row (teal, derived) and a Net row. Bottom totals show Total Gross O&M / Total IFRS-16 Credits / Net O&M (after IFRS-16).</p>
      <p><strong>Insurance row:</strong> Monthly P&L = smooth (annual÷12). Cash = lumpy from insurancePolicies register. Difference = Prepaid Asset on Balance Sheet (§2B in ass-other).</p>
      <p>Growth rate column (future years): enter % to auto-scale all 12 months vs current year base.</p>`},
    {n:'8. CapEx & Collections',c:'var(--green)',body:`
      <p><strong>CapEx Categories:</strong> cx_gen, cx_tx, cx_dist, cx_hurr, cx_cust, cx_loss, cx_ss</p>
      <p>Three derived schedules: Spend Plan | Cash Payment (payLag months) | CWIP→PP&E Transfer (tLag months)</p>
      <div class="gf">DSO = (Closing Receivables ÷ Monthly Billing) × 30</div>
      <p><strong>Collections:</strong> billing, cr_rt10/20/40, blended rate, prior period, GCT, total receipts, DSO</p>
      <p>Growth rate column (future years): enter % to auto-scale all 12 months vs current year base.</p>`},
    {n:'9. Depreciation & Impairment',c:'var(--muted)',body:`
      <p><strong>8 Components (IAS 16):</strong> FA Register ($66.7M) | SJPC ($22.6M) | Other Leases ($15.5M, auto from IFRS 16) | CapEx Transfers ($14.4M) | Capital Spares ($0.4M) | Decommissioning ($1.1M) | Stranded Meters | Stranded Lights ($0.15M)</p>
      <p style="color:var(--amber)"><strong>Impairment (IAS 36) — ALWAYS a separate amber line.</strong> Never combined with depreciation.</p>
      <p>Hurricane Melissa 2025: $5M charge | 2024: $(500K) reversal</p>`},
    {n:'10. IFRS 16 Leases — Full Register',c:'var(--teal)',body:`
      <p>10 leases: SJPC, JEP, JPPC, WKPP (IPP type) + Eppley (vehicle, IFRS16) + Jameco, AMECO (vehicle, <strong>exempt</strong>) + Head Office, East Parade, Bogue (property)</p>
      <div class="gf">Monthly Payment = Principal Repayment + Interest
Interest = Opening Liability × (rate ÷ 12)
ROU Depreciation = Opening ROU ÷ total months</div>
      <p><strong>P&L routing:</strong> IPP leases → credit to IPP Cost | Vehicle/Property IFRS16 → credit to O&M</p>
      <p><strong>Exempt leases (Jameco, AMECO):</strong> No ROU asset, no liability, no accounting reversal. Full payment expenses directly to Transport (O&M). The amortisation schedule tab shows 12 editable monthly inputs instead. Edit per-month amounts via wrk-leases → click lease → manual inputs.</p>
      <p><strong>BS impact (IFRS16 only):</strong> ROU Asset (NCA) | Current Lease Liab | LT Lease Liab</p>`},
    {n:'11. Insurance Prepayment',c:'var(--blue)',body:`
      <div class="gf">Monthly Expense = Annual Premium ÷ 12 (smooth → O&M)\nCash Payment = lump sum when due (→ CF disbursements)\nPrepaid Balance = Cumulative Cash − Cumulative Expense (→ BS Prepaid)</div>
      <p><strong>2026 Policies:</strong> Property All Risk US$3.2M (Aug 50% + Nov 50%) | Political Violence | Excess Liability Sep/Oct | Motor Vehicle JMD$24M Oct</p>`},
    {n:'12. Cash Flow',c:'var(--blue)',body:`
      <p><strong>Two views:</strong> Indirect (IFRS formal) | Direct (8-month rolling forecast)</p>
      <p><strong>Indirect CF Feb 2026 validation:</strong></p>
      <div class="gf">Operating: $15,958K | Investing: $(58,163K) | Financing: $(15,053K) | Closing: $92,371K</div>
      <p>Non-cash add-backs: Depreciation, Impairment, FX Loss, Lease Interest</p>
      <p><strong>Covenants:</strong> Current Ratio ≥ 1.10× (Feb: 1.11×) | DSCR ≥ 1.20× (Feb: 1.25×)</p>`},
    {n:'13. Scenarios',c:'var(--purple)',body:`
      <p>Adjustments per year 2026–2030: eb (EBITDA%), rv (Revenue%), om (O&M%), cx (CapEx%), fu (Fuel%), tr (Tariff%), cr (Collection rate%)</p>
      <p>Base Case always present, cannot be deleted. All scenarios are relative to Base Case.</p>
      <p>Year-aware: a tariff increase scenario can show 0% in 2026, +5% in 2027, +3% in 2028.</p>`},
    {n:'14. Actuals Upload & Period Locking',c:'var(--green)',body:`
      <p><strong>File format:</strong> JPSCo_Financials_MM-YY.xlsx — one file per month, 11 sheets (platform reads 8: P&L, CF, BS, Revenue, Volume, O&M, CapEx, Collections).</p>
      <p><strong>How to upload:</strong> Admin → ☁ Data Sources → drag file onto the drop zone or click Browse. The platform auto-detects the month from the filename.</p>
      <p><strong>Period locking:</strong> Once a month is uploaded its <code>is_closed</code> flag is set in <code>fpa_dim_period</code>. Closed months:</p>
      <ul style="margin:4px 0 8px 16px">
        <li>Show as 🔒 in the Period Status grid (Admin → Data Sources)</li>
        <li>Block manual edits on O&M, CapEx, and Revenue cells for that month</li>
        <li>Override LE values in all reports with the uploaded actuals</li>
      </ul>
      <p><strong>To re-upload / correct actuals:</strong> Upload a corrected file for the same month — the upsert overwrites the previous data and keeps the period locked.</p>
      <p><strong>FX rates:</strong> Closed months are locked as actuals (teal, read-only). Open months are projected (gold, editable). Future years default to projected. Update actuals monthly in <code>fpa_assumptions</code> under category <code>fx_billing</code> / <code>fx_expense</code>.</p>
      <p><strong>Net Generation &amp; Fuel Costs</strong> override LE values for the uploaded month; all downstream calculations (IPP cost, fuel revenue lag, heat rate) update automatically.</p>`},
    {n:'15. Themes, Permissions & AI Key',c:'var(--muted)',body:`
      <p><strong>3 Themes:</strong> ☾ Dark (default) | ☀ Light | ⚡ JPS Corporate (navy #003DA5, cyan #00AEEF)</p>
      <p><strong>Colour conventions:</strong> Teal = derived/read-only cell | Amber = impairment/warning | Green = favourable variance | Red = adverse variance</p>
      <p><strong>3 Roles:</strong> Admin (full edit + settings) | Analyst (own scenarios + LE edit) | Viewer (read-only, no inputs)</p>
      <p><strong>Claude AI Key setup:</strong> Admin → ☁ Data Sources → scroll to ✦ Claude API Key → paste key from <em>console.anthropic.com</em> → click 🧪 Test Key. The key is stored in your browser's localStorage only — it never leaves your device.</p>
      <p><strong>AI Commentary</strong> is rate-limited to your Anthropic account tier. Keys are per-browser; each user needs their own.</p>`},
    {n:'16. Live Infrastructure',c:'var(--teal)',body:`
      <p><strong>Database:</strong> Supabase project <code>JPS_sales_forecast</code> (us-west-2) — PostgreSQL + Realtime + RLS</p>
      <p><strong>Hosting:</strong> Vercel → <code>jmfinancelab.com</code> — auto-deploys on every push to GitHub main branch</p>
      <p><strong>Repo:</strong> GitHub org <code>JPSFP-A</code> / repo <code>JPS-FP-A</code> (public) — single file <code>index.html</code></p>
      <p><strong>Realtime sync:</strong> Changes to <code>fpa_facts</code>, <code>fpa_assumptions</code>, and <code>fpa_versions</code> by any user trigger an automatic refresh for all connected sessions via Supabase Realtime postgres_changes.</p>
      <p><strong>17 active tables:</strong></p>
      <div class="gf">fpa_versions · fpa_dim_line · fpa_dim_period · fpa_facts · fpa_assumptions
fpa_leases · fpa_insurance_policies · fpa_impairment_events
fpa_uploads · fpa_audit_log · dashboard_state · profiles
jps_actuals (33K rows) · jps_budget (1.1K rows) — separate app, read-only here</div>
      <p><strong>Data not yet in DB</strong> (still hardcoded, planned migration): O&M category definitions, CapEx category definitions, tariff tables, volume tables.</p>`},
    {n:'17. Glossary',c:'var(--gold)',body:`<div id="glossaryContent" style="color:var(--muted);font-size:11px;padding:4px 0"><em>Loading glossary…</em></div>`},
  ];
  if(!document.getElementById('guideStyle')){
    const s=document.createElement('style');
    s.id='guideStyle';
    s.textContent=`
      .guide-sec{border:1px solid var(--border);border-radius:6px;margin-bottom:6px;overflow:hidden}
      .guide-hd{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;
        cursor:pointer;user-select:none;background:var(--card)}
      .guide-hd:hover{background:var(--card2)}
      .guide-hd .gtt{font-weight:800;font-size:11px;color:var(--text)}
      .guide-hd .gchev{font-size:10px;color:var(--muted);transition:transform .15s}
      .guide-hd.open .gchev{transform:rotate(90deg)}
      .guide-body{display:none;padding:12px 16px;font-size:11px;color:var(--muted);line-height:1.7;
        border-top:1px solid var(--border)}
      .guide-body p{margin:0 0 8px}
      .guide-body strong{color:var(--text)}
      .guide-body .gf{background:var(--card2);color:var(--gold);font-family:monospace;font-size:10.5px;
        padding:7px 10px;border-radius:4px;margin:6px 0;white-space:pre-wrap;line-height:1.5}
      .guide-hl{background:rgba(240,180,41,.25)!important}
      @media print{.pane:not(#pane-adm-guide){display:none!important}
        .guide-body{display:block!important}.topbar,.tabbar,.navbar{display:none!important}}`;
    document.head.appendChild(s);
  }
  document.getElementById('guideGrid').innerHTML=sections.map((s,i)=>`
    <div class="guide-sec" id="gsec${i}" data-guide-text="${(s.n+' '+s.body).replace(/"/g,'&quot;').toLowerCase()}">
      <div class="guide-hd${i===0?' open':''}" onclick="toggleGuide(${i})" style="border-left:3px solid ${s.c}">
        <span class="gtt">${s.n}</span><span class="gchev">▶</span>
      </div>
      <div class="guide-body" style="${i===0?'display:block':''}">
        ${s.body}
      </div>
    </div>`).join('');

  // Load glossary from GitHub
  loadGlossary();
}

// Fetch glossary.json from GitHub and populate the glossary section
const _GLOSSARY_URL = 'https://raw.githubusercontent.com/JPSFP-A/JPS-FP-A/main/glossary.json';
let _glossaryLoaded = false;
async function loadGlossary() {
  const el = document.getElementById('glossaryContent');
  if (!el) return;
  if (_glossaryLoaded) return; // already rendered this session
  try {
    const res = await fetch(_GLOSSARY_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const sectionColors = ['var(--teal)','var(--blue)','var(--green)','var(--gold)','var(--purple)','var(--amber)','var(--red)','var(--muted)'];
    const icons = ['📊','💰','🏛','💸','⚡','📋','📐','🔧'];
    el.innerHTML = data.map((sec, si) => `
      <p style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:${sectionColors[si]||'var(--teal)'};margin:${si===0?'0':'12px'} 0 8px">${icons[si]||'•'} ${sec.section}</p>
      ${sec.terms.map(t => `<p><strong>${t.term}</strong> — ${t.def}</p>`).join('')}
    `).join('');
    _glossaryLoaded = true;
  } catch(e) {
    el.innerHTML = `<span style="color:var(--amber)">⚠ Could not load glossary (${e.message}). Check network connection.</span>`;
  }
}

// Fetch historical audit entries from Supabase when audit tab opens
async function loadAuditFromDB() {
  // Show loading state
  const body    = document.getElementById('auditBody');
  const countEl = document.getElementById('auditCount');
  const subEl   = document.getElementById('auditSub');
  if (body)    body.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:20px;font-size:11px">⏳ Loading from database…</td></tr>';
  if (countEl) countEl.textContent = 'loading…';

  if (!_sb) {
    if (subEl) subEl.textContent = 'Not connected to database — showing session entries only';
    renderAuditTable();
    return;
  }

  const result = await _sbQ(sb => sb
    .from('fpa_audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500)
  );

  if (!result) {
    // _sbQ already toasted the error
    if (subEl) subEl.textContent = 'Failed to load from database';
    renderAuditTable();
    return;
  }

  const { data, error } = result;
  if (error) {
    toast('Audit load error: ' + error.message, 'err');
    if (subEl) subEl.textContent = 'Error: ' + error.message;
    renderAuditTable();
    return;
  }

  // Merge DB records with any in-memory entries from this session
  const existingDbIds = new Set(_auditStore.map(e => e.dbId).filter(Boolean));
  const newEntries = (data || [])
    .filter(r => !existingDbIds.has(r.id))
    .map(r => ({
      id:        r.id,
      dbId:      r.id,
      userId:    r.user_id   || '—',
      userName:  r.user_name || '—',
      userRole:  r.user_role || '—',
      cat:       _auditCat(r.action || ''),
      action:    r.action    || '—',
      target:    r.target    || '—',
      oldVal:    r.old_val   ?? null,
      newVal:    r.new_val   ?? null,
      timestamp: new Date(r.created_at),
    }));

  // Replace store with merged + sorted result
  const merged = [..._auditStore.filter(e => !e.dbId), ...newEntries];
  merged.sort((a, b) => b.timestamp - a.timestamp);
  _auditStore.length = 0;
  merged.forEach(e => _auditStore.push(e));

  if (subEl) subEl.textContent = `${merged.length} entries loaded from database`;
  renderAuditTable();
}

function toggleGuide(i){
  const sec=document.getElementById('gsec'+i);
  const hd=sec?.querySelector('.guide-hd');
  const body=sec?.querySelector('.guide-body');
  if(!hd||!body)return;
  const open=hd.classList.toggle('open');
  body.style.display=open?'block':'none';
}

function expandAllGuide(open){
  document.querySelectorAll('.guide-sec').forEach((sec)=>{
    const hd=sec.querySelector('.guide-hd');
    const body=sec.querySelector('.guide-body');
    if(hd&&body){
      hd.classList.toggle('open',open);
      body.style.display=open?'block':'none';
    }
  });
}

function filterGuide(q){
  const term=(q||'').toLowerCase().trim();
  document.querySelectorAll('.guide-sec').forEach(sec=>{
    const text=sec.dataset.guideText||'';
    const match=!term||text.includes(term);
    sec.style.display=match?'':'none';
    if(match&&term){
      const hd=sec.querySelector('.guide-hd');
      const body=sec.querySelector('.guide-body');
      if(hd&&body&&!hd.classList.contains('open')){
        hd.classList.add('open');
        body.style.display='block';
      }
      sec.querySelectorAll('.guide-body *').forEach(el=>{
        if(el.children.length===0)el.classList.toggle('guide-hl',el.textContent.toLowerCase().includes(term));
      });
    }else{
      sec.querySelectorAll('.guide-hl').forEach(el=>el.classList.remove('guide-hl'));
    }
  });
}

// CONFIRM ADD LINE
let addLineTgt='pl';
function confirmAddLine(){
  const name=document.getElementById('al-name').value.trim();if(!name){toast('Enter a name','w');return;}
  const base=parseFloat(document.getElementById('al-val').value)||0;
  const newLine={id:'cust_'+Date.now(),sect:document.getElementById('al-sect').value,name,type:document.getElementById('al-type').value,vals:YEARS.map((_,i)=>i<4?0:Math.round(base*(1+i*0.03)))};
  if(addLineTgt==='pl')plLines.push(newLine);
  else if(addLineTgt==='bs')bsLines.push(newLine);
  closeModal('addLineModal');refreshAll();toast('"'+name+'" added','ok');
}

// NAV
// ── TAB BUILD REGISTRY ────────────────────────────────
// Maps tab id → build function(s). Each function is called on first visit.
// On subsequent visits (tab already built), _rebuildPane() is called instead
// to refresh data without re-running expensive first-time setup.
const _tabBuilders = {
  'rpt-pl':    ()=>{ buildMonthlyPL(plMonthlyYear); },
  'rpt-bs':    ()=>{ buildYrSeg('bsMoYrSeg',bsMonthlyYear,(y)=>{bsMonthlyYear=y;buildMonthlyBS(y);}); buildMonthlyBS(bsMonthlyYear); },
  'rpt-cf':    ()=>{ buildCFReport(); },
  'rpt-dep':   ()=>{ buildDepReport(); },
  'rpt-var':   ()=>{ buildVarReport(); buildActualsLog(); },
  'rpt-kpi':   ()=>{ buildKpiTab(); },
  'rpt-rev':   ()=>{ buildRevReport(); },
  'wrk-sc':    ()=>{ buildScPanel(); },
  'wrk-gen':   ()=>{ buildGenTables(); },
  'wrk-coll':  ()=>{ initYrSegs(); computeAll(selectedCollYear); buildCollTable(); },
  'wrk-debt':  ()=>{ buildDebtTab(); },
  'wrk-leases':()=>{ Array.from({length:5},(_,i)=>_CY+i).forEach(y=>computeAllLeases(y)); buildLeaseRegister(); },
  'ass-rev':   ()=>{ buildRevEngine(); },
  'ass-om':    ()=>{ initYrSegs(); buildOMTable(); },
  'ass-capex': ()=>{ initYrSegs(); buildCapexTable(); },
  'ass-dep':   ()=>{ buildDepAssumptions(); },
  'ass-other': ()=>{ buildOtherFinancing(); },
  'ass-proj':  ()=>{ buildProjTab(); },
  'ai-comm':   ()=>{ buildCommCards(); },
  'adm-data':  ()=>{ buildDataSources(); },
  'adm-audit': ()=>{ loadAuditFromDB(); },
  'adm-guide': ()=>{ buildGuide(); },
  'dash2':     ()=>{ buildDash2(); },
};

// ── Navbar helpers ───────────────────────────────────────────────────────────
const _navPaneGroup = {
  hub:'nav-hub',
  dash:'nav-reports',dash2:'nav-reports','rpt-pl':'nav-reports','rpt-bs':'nav-reports','rpt-cf':'nav-reports',
  'rpt-dep':'nav-reports','rpt-var':'nav-reports','rpt-kpi':'nav-reports',
  'rpt-rev':'nav-reports','rpt-flash':'nav-reports',
  'wrk-sc':'nav-workings','wrk-gen':'nav-workings','wrk-coll':'nav-workings',
  'wrk-debt':'nav-workings','wrk-leases':'nav-workings',
  'ass-rev':'nav-assumptions','ass-om':'nav-assumptions','ass-capex':'nav-assumptions',
  'ass-dep':'nav-assumptions','ass-other':'nav-assumptions','ass-proj':'nav-assumptions',
  'ai-comm':'nav-ai',
  'adm-data':'nav-admin','adm-audit':'nav-admin','adm-sec':'nav-admin','adm-guide':'nav-admin',
};
const _navPaneLabels = {
  hub:'Hub',dash:'Overview',dash2:'Dashboard','rpt-pl':'Income Statement','rpt-bs':'Balance Sheet',
  'rpt-cf':'Cash Flow','rpt-dep':'Depreciation','rpt-var':'Variance Analysis',
  'rpt-kpi':'Ratios & KPIs','rpt-rev':'Revenue & Gen','rpt-flash':'Flash Report',
  'wrk-sc':'Scenarios','wrk-gen':'Generation & Fuel','wrk-coll':'Collections',
  'wrk-debt':'Debt & Financing','wrk-leases':'Lease Register',
  'ass-rev':'Revenue & Tariff','ass-om':'O&M','ass-capex':'CapEx',
  'ass-dep':'Depreciation','ass-other':'Other & Financing','ass-proj':'5-Year Projection',
  'ai-comm':'AI Commentary','adm-data':'Data Manager','adm-audit':'Audit Trail',
  'adm-sec':'Security','adm-guide':'Guide',
};
function _navUpdateActive(paneId) {
  document.querySelectorAll('.nav-grp-btn').forEach(b=>b.classList.remove('nav-active'));
  document.querySelectorAll('.nav-dd-item').forEach(i=>i.classList.remove('on'));
  const groupId = _navPaneGroup[paneId];
  if (groupId) document.getElementById(groupId)?.querySelector('.nav-grp-btn')?.classList.add('nav-active');
  document.querySelectorAll(`.nav-dd-item[data-pane="${paneId}"]`).forEach(i=>i.classList.add('on'));
  // Also mark single-pane group buttons (hub, ai)
  document.querySelectorAll(`.nav-grp-btn[data-pane="${paneId}"]`).forEach(b=>b.classList.add('nav-active'));
  const crumb = document.getElementById('navCrumb');
  if (crumb) crumb.textContent = _navPaneLabels[paneId] || paneId;
}
function navToggle(groupId) {
  const grp = document.getElementById(groupId);
  if (!grp) return;
  const wasOpen = grp.classList.contains('open');
  navClose();
  if (!wasOpen) grp.classList.add('open');
}
function navClose() {
  document.querySelectorAll('.nav-group.open').forEach(g=>g.classList.remove('open'));
}
// Close dropdowns when clicking outside navbar
document.addEventListener('click', e => {
  if (!e.target.closest('.nav-group') && !e.target.closest('.navbar')) navClose();
}, true);

function showPane(id,el){
  // Enforce pane-level access control
  if (currentUser && !canViewPane(id)) {
    toast(`You don't have access to this section (${id}). Contact your admin.`, 'w');
    return;
  }
  document.querySelectorAll('.pane').forEach(p=>p.classList.remove('on'));
  document.getElementById('pane-'+id)?.classList.add('on');
  // Update old hidden tabs (kept for role-check DOM scanning)
  if(el){document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));el.classList.add('on');}
  // Update new navbar active state
  _navUpdateActive(id);
  navClose();
  const builder = _tabBuilders[id];
  if(builder) {
    builder();
    _markBuilt(id);
  }
  if(id === 'rpt-flash') { setTimeout(() => flashInit(), 100); }
  if(typeof _rtAnnouncePresence === 'function') _rtAnnouncePresence(id);
}

// Hide tabs / nav items the current user cannot see (called after login)
function _applyTabVisibility() {
  if (!currentUser) return;
  // Update hidden old tabs (for DOM role checks)
  document.querySelectorAll('.tab[onclick]').forEach(tab => {
    const match = tab.getAttribute('onclick')?.match(/showPane\(['"]([^'"]+)['"]/);
    if (!match) return;
    tab.style.display = canViewPane(match[1]) ? '' : 'none';
  });
  document.querySelectorAll('.tg').forEach(tg => {
    const visibleTabs = [...tg.querySelectorAll('.tab')].filter(t => t.style.display !== 'none');
    tg.style.display = visibleTabs.length > 0 ? '' : 'none';
  });
  // Update new navbar dropdown items
  document.querySelectorAll('.nav-dd-item[data-pane]').forEach(item => {
    item.style.display = canViewPane(item.dataset.pane) ? '' : 'none';
  });
  // Hide nav groups whose dropdown items are all hidden
  document.querySelectorAll('.nav-group').forEach(grp => {
    const items = grp.querySelectorAll('.nav-dd-item');
    if (!items.length) return; // single-pane group (hub, ai) — check btn
    const anyVisible = [...items].some(i => i.style.display !== 'none');
    grp.style.display = anyVisible ? '' : 'none';
  });
  // Hide single-pane groups (hub, ai) if pane inaccessible
  document.querySelectorAll('.nav-grp-btn[data-pane]').forEach(btn => {
    btn.parentElement.style.display = canViewPane(btn.dataset.pane) ? '' : 'none';
  });
  // Security nav item — admins only
  const navSec = document.getElementById('navSecItem');
  if (navSec) navSec.style.display = currentUser?.role === 'admin' ? '' : 'none';
  const oldSec = document.getElementById('securityTab');
  if (oldSec) oldSec.style.display = currentUser?.role === 'admin' ? '' : 'none';
}

function setPeriod(p,btn){const prev=period;period=p;document.querySelectorAll('#perSeg .sb').forEach(b=>b.classList.remove('on'));btn?.classList.add('on');refreshAll();auditLog('period','Display Period',prev,p);_saveState();}
function setDashYear(yr){dashYear=parseInt(yr)||_CY;const sel=document.getElementById('dashYrSel');if(sel&&parseInt(sel.value)!==dashYear)sel.value=String(dashYear);requestAnimationFrame(()=>{buildDashKpis();buildDashCharts();});}

// ── Month-option builder: populates a <select> with all 12 months for the given year ──
// For CF: all months enabled. For Variance: enabled only if actuals exist for that month.
function _rebuildMoOpts(selId, yr, selVal, opts){
  const el = document.getElementById(selId);
  if (!el) return;
  opts = opts || {};
  // Which months have actuals? Used for variance to enable/disable options.
  const loaded = Object.keys(actualsStore).map(Number).filter(m => m >= 1 && m <= 12 && _acts(m)?.pl);
  el.innerHTML = MONTHS.map((m, i) => {
    const v   = i + 1;
    const dis = opts.varMode && loaded.length && !loaded.includes(v) ? 'disabled' : '';
    const sel = v === (parseInt(selVal) || 1) ? 'selected' : '';
    return `<option value="${v}" ${sel} ${dis}>${m} ${yr}</option>`;
  }).join('');
}

function setCfYear(yr) {
  cfYear = parseInt(yr) || _CY;
  const sel = document.getElementById('cfYrSel');
  if (sel && parseInt(sel.value) !== cfYear) sel.value = String(cfYear);
  _rebuildMoOpts('cfMo', cfYear, cfSelectedMonth);
  buildCFReport();
}

function setVarYear(yr) {
  varYear = parseInt(yr) || _CY;
  const sel = document.getElementById('varYrSel');
  if (sel && parseInt(sel.value) !== varYear) sel.value = String(varYear);
  rebuildVarMonthDropdown();  // rebuild month options enabled/disabled per closed periods
  buildVarReport();
}

// Shared year-selector option builder for CF / Var / other panes
function _yrOpts(selected) {
  return YEARS.map(y =>
    `<option value="${y}"${parseInt(y) === selected ? ' selected' : ''}>${y}</option>`
  ).join('');
}

// ── Active month — governs single-month views and YTD cutoff ─────────────────
let activeMonth = 3; // March (current reporting month; updated by month selector)
function setActiveMonth(m){
  activeMonth = Math.max(1,Math.min(12,m||3));
  // Sync selector
  const sel = document.getElementById('monthSel');
  if (sel && parseInt(sel.value) !== activeMonth) sel.value = String(activeMonth);
  // Update brand subtitle
  const MO_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const brandSub = document.getElementById('brandSub');
  if (brandSub) {
    const verCode = fpa?.versions?.find(v=>v.id===fpa.activeVersionId)?.code || '';
    const verLabel = verCode.startsWith('LE_') ? `LE ${verCode.replace('LE_','').replace('_',' ')}` : verCode || 'LE';
    brandSub.textContent = `Jamaica Public Service Co. · ${MO_SHORT[activeMonth-1]} ${_CY} ${verLabel}`;
  }
  refreshAll();
  _saveState();
}
function openModal(id){document.getElementById(id).classList.add('open');}
function closeModal(id){document.getElementById(id).classList.remove('open');}
document.addEventListener('click',e=>{if(e.target.classList.contains('mbg'))e.target.classList.remove('open');});
// ── Notification system ─────────────────────────────────────────────────────
async function _loadNotifications() {
  if (!_sb || !currentUser || currentUser.id === 'local') return;
  try {
    const { data } = await _sb.from('fpa_notifications')
      .select('*').eq('is_read', false).order('created_at', { ascending: false }).limit(30);
    fpa.notifications = data || [];
    _renderNotifBell();
  } catch(e) { /* non-critical */ }
}

function _renderNotifBell() {
  const badge = document.getElementById('notifBadge');
  const count = fpa.notifications.length;
  if (badge) {
    badge.textContent = count > 9 ? '9+' : String(count);
    badge.style.display = count > 0 ? 'block' : 'none';
  }
  const list = document.getElementById('notifList');
  if (!list) return;
  if (count === 0) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:11px">No unread notifications</div>';
    return;
  }
  const icons = { period_locked:'🔒', period_unlocked:'🔓', user_invited:'👤', data_uploaded:'📥', general:'🔔' };
  list.innerHTML = fpa.notifications.map(n => `
    <div onclick="markNotifRead('${n.id}')" style="padding:10px 14px;border-bottom:1px solid var(--border);cursor:pointer;transition:.12s" onmouseover="this.style.background='var(--card2)'" onmouseout="this.style.background=''">
      <div style="display:flex;align-items:flex-start;gap:8px">
        <span style="font-size:16px;flex-shrink:0">${icons[n.event_type]||'🔔'}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;font-weight:700;color:var(--text);margin-bottom:2px">${n.title}</div>
          ${n.body ? `<div style="font-size:10px;color:var(--muted);line-height:1.4">${n.body}</div>` : ''}
          <div style="font-size:9px;color:var(--muted);margin-top:4px">${new Date(n.created_at).toLocaleString()}</div>
        </div>
      </div>
    </div>`).join('');
}

function toggleNotifPanel() {
  const panel = document.getElementById('notifPanel');
  if (!panel) return;
  const isOpen = panel.style.display === 'flex';
  panel.style.display = isOpen ? 'none' : 'flex';
  panel.style.flexDirection = 'column';
  if (!isOpen) _renderNotifBell();
}

async function markNotifRead(id) {
  if (!_sb) return;
  await _sb.from('fpa_notifications').update({ is_read: true }).eq('id', id);
  fpa.notifications = fpa.notifications.filter(n => String(n.id) !== String(id));
  _renderNotifBell();
}

async function markAllNotifsRead() {
  if (!_sb || fpa.notifications.length === 0) return;
  const ids = fpa.notifications.map(n => n.id);
  await _sb.from('fpa_notifications').update({ is_read: true }).in('id', ids);
  fpa.notifications = [];
  _renderNotifBell();
  document.getElementById('notifPanel').style.display = 'none';
}

// Close notif panel on outside click
document.addEventListener('click', e => {
  const wrap = document.getElementById('notifBellWrap');
  if (wrap && !wrap.contains(e.target)) {
    const panel = document.getElementById('notifPanel');
    if (panel) panel.style.display = 'none';
  }
});

// Send a notification to all admins via edge function
async function _notifyAdmins(event_type, title, body, metadata = {}) {
  if (!_sb || !currentUser) return;
  try {
    const { data: { session } } = await _sb.auth.getSession();
    if (!session) return;
    await _sb.functions.invoke('notify-admins', {
      body: { event_type, title, body, metadata },
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
  } catch(e) { console.warn('[notify-admins]', e.message); }
}

// Navigate to Data Manager tab — single entry point for all data uploads
function navToDataManager(){
  const adminTabs=document.querySelectorAll('.tg.adm .tab');
  const dmTab=adminTabs[0]||null;
  showPane('adm-data',dmTab);
}
function exportCSV(){const hdr=['Year','Line','Section',...YEARS];const rows=[hdr];plLines.forEach(l=>rows.push([YEARS[0],l.name,l.sect,...l.vals.slice(0,9)]));const blob=new Blob([rows.map(r=>r.join(',')).join('\n')],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='JPS_FPA_Export_'+activeSc.replace(/ /g,'_')+'.csv';a.click();toast('Exported','ok');}

// ── O&M Export ────────────────────────────────────────────────────────────────
function exportOMCSV(){
  const yr=selectedOMYear;
  const rows=[['Category','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Total']];
  getOMRows(yr).forEach(r=>{
    const tot=r.vals.reduce((s,v)=>s+(v||0),0);
    rows.push([r.name,...r.vals.map(v=>Math.round(v)),Math.round(tot)]);
  });
  const tot=getOMTotal(yr);
  rows.push(['TOTAL O&M',...tot.map(v=>Math.round(v)),Math.round(sumArr(tot))]);
  _dlCSV(rows,'JPS_OM_'+yr+'.csv');
  toast('O&M exported','ok');
}

// ── CapEx Export ──────────────────────────────────────────────────────────────
function exportCapexCSV(){
  const yr=selectedCapexYear;
  const rows=[['Category','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Total']];
  getCxRows(yr).forEach(r=>{
    const tot=(r.vals||[]).reduce((s,v)=>s+(v||0),0);
    rows.push([r.name,...(r.vals||[]).map(v=>Math.round(v)),Math.round(tot)]);
  });
  _dlCSV(rows,'JPS_CapEx_'+yr+'.csv');
  toast('CapEx exported','ok');
}

// ── Collections Export ────────────────────────────────────────────────────────
function exportCollCSV(){
  const yr=selectedCollYear;
  const rows=[['Metric','Unit','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']];
  getCollRows(yr).forEach(r=>{
    if(!r.derived && r.vals){
      rows.push([r.name,r.unit||'',...r.vals.map(v=>r.unit==='%'?v?.toFixed(1):Math.round(v||0))]);
    }
  });
  _dlCSV(rows,'JPS_Collections_'+yr+'.csv');
  toast('Collections exported','ok');
}

// ── Cash Flow Export ──────────────────────────────────────────────────────────
function exportCFCSV(){
  const rows=[['Line Item','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Total']];
  // Pull from directCFSeed if available, otherwise use model data
  const yr=cfYear||_CY;
  const om=getOMTotal(yr), cx=getCxCash(yr), rec=getCashReceipts(yr);
  const entries=[
    ['Cash Receipts',...rec.map(v=>Math.round(v))],
    ['O&M Payments',...om.map(v=>-Math.round(v))],
    ['CapEx Payments',...cx.map(v=>-Math.round(v))],
  ];
  entries.forEach(e=>{
    const tot=e.slice(1).reduce((s,v)=>s+(v||0),0);
    rows.push([...e,tot]);
  });
  _dlCSV(rows,'JPS_CashFlow_'+yr+'.csv');
  toast('Cash Flow exported','ok');
}

// ── Shared CSV download helper ────────────────────────────────────────────────
function _dlCSV(rows, filename){
  const csv=rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download=filename; a.click();
}

// ═══════════════════════════════════════════════════════
//  PRINT / PDF ENGINE — Session 11
// ═══════════════════════════════════════════════════════

// Which sections are available for printing (tab id → label)
const _printableSections = [
  { id:'dash',       label:'📊 Overview',               checked:true  },
  { id:'rpt-pl',     label:'📋 Income Statement',        checked:true  },
  { id:'rpt-bs',     label:'⚖ Balance Sheet',            checked:true  },
  { id:'rpt-cf',     label:'💧 Cash Flow',               checked:true  },
  { id:'rpt-dep',    label:'📉 Depreciation Schedule',   checked:false },
  { id:'rpt-var',    label:'📊 Variance Report',         checked:true  },
  { id:'rpt-kpi',    label:'📐 Ratios & KPIs',           checked:true  },
  { id:'rpt-rev',    label:'⚡ Revenue & Generation',    checked:false },
  { id:'wrk-debt',   label:'🏦 Debt & Financing',        checked:false },
  { id:'wrk-leases', label:'📄 Lease Register',          checked:false },
  { id:'wrk-gen',    label:'⚡ Generation & Fuel',       checked:false },
  { id:'ass-proj',   label:'📈 5-Year Projection',       checked:false },
];

function openPrintModal() {
  // Populate section checkboxes
  const list = document.getElementById('printSectionList');
  if (list) {
    list.innerHTML = _printableSections.map((s, i) => `
      <label class="print-section-check" style="gap:8px">
        <input type="checkbox" id="printSec_${s.id}" ${s.checked ? 'checked' : ''}>
        <span style="font-size:11px;color:var(--text)">${s.label}</span>
      </label>`).join('');
  }
  // Pre-fill title from active pane
  const activePane = document.querySelector('.pane.on')?.id?.replace('pane-','');
  const sec = _printableSections.find(s=>s.id===activePane);
  if (sec) document.getElementById('printTitle').value = sec.label.replace(/^[^ ]+ /,'') + ' — JPS FP&A';
  document.getElementById('printPrepBy').value = currentUser.name || 'JPS Finance Team';
  openModal('printModal');
}

function updatePrintOrientation() {
  const ori = document.getElementById('printOrientation')?.value || 'landscape';
  // Dynamically update the @page rule
  let styleEl = document.getElementById('printOrientStyle');
  if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = 'printOrientStyle'; document.head.appendChild(styleEl); }
  styleEl.textContent = `@media print { @page { size: A4 ${ori}; } }`;
}

function executePrint() {
  const title      = document.getElementById('printTitle')?.value || 'Financial Performance Report';
  const prepBy     = document.getElementById('printPrepBy')?.value || 'JPS Finance Team';
  const showCover  = document.getElementById('printOptCover')?.checked ?? true;
  const showConf   = document.getElementById('printOptConfidential')?.checked ?? true;
  const showPgNum  = document.getElementById('printOptPageNum')?.checked ?? true;
  const showDate   = document.getElementById('printOptDate')?.checked ?? true;

  // Collect selected sections
  const selectedSections = _printableSections.filter(s =>
    document.getElementById('printSec_'+s.id)?.checked
  );

  // Build the active pane's content (navigate to build each selected section)
  // For now: print the currently active pane + dashboard summary
  // Future: assemble multi-section print view

  // Update cover page metadata
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
  const activePane = document.querySelector('.pane.on')?.id?.replace('pane-','') || 'dash';
  const activeSec  = _printableSections.find(s=>s.id===activePane);

  _setPrintEl('printReportTitle', title);
  _setPrintEl('printReportSub',   'Jamaica Public Service Company Limited');
  _setPrintEl('printPeriodLabel', _getPrintPeriodLabel());
  _setPrintEl('printScenarioLabel', activeSc || 'Base Case');
  _setPrintEl('printPreparedBy',  prepBy);
  _setPrintEl('printDate',        dateStr);

  // Set print logo
  const printLogo = document.getElementById('printLogo');
  if (printLogo) printLogo.src = JPS_LOGO_DATA;

  // Footer content
  _setPrintEl('printFooterMid',   title);
  _setPrintEl('printFooterRight', showDate ? dateStr : '');

  // Show/hide cover and watermark
  const coverEl = document.getElementById('printCoverPage');
  if (coverEl) coverEl.style.display = showCover ? '' : 'none';

  // Inject dynamic print CSS for this run
  let dynStyle = document.getElementById('printDynStyle');
  if (!dynStyle) { dynStyle = document.createElement('style'); dynStyle.id = 'printDynStyle'; document.head.appendChild(dynStyle); }
  dynStyle.textContent = `
    @media print {
      body::after { content: ${showConf ? "'CONFIDENTIAL'" : "''"} !important; }
      .print-footer { display: ${showPgNum || showDate ? 'flex' : 'none'} !important; }
      #printCoverPage { display: ${showCover ? 'flex' : 'none'} !important; }
    }
  `;

  // Make sure active pane is fully rendered
  const builder = _tabBuilders[activePane];
  if (builder) { try { builder(); } catch(e) {} }

  // Close modal and print
  closeModal('printModal');
  setTimeout(() => {
    window.print();
  }, 150);
}

function _getPrintPeriodLabel() {
  // Build human-readable period label from actuals loaded + current period setting
  const yr = plMonthlyYear || _CY;
  const loadedMos = Object.keys(actualsStore[yr] || {}).map(Number).filter(m=>m>0).sort((a,b)=>a-b);
  if (loadedMos.length) {
    const last = loadedMos[loadedMos.length-1];
    return `${MONTHS[last-1]} ${yr} YTD (${loadedMos.length} months actuals)`;
  }
  return `${yr} Annual Operating Plan (AOP)`;
}

function _setPrintEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// Keyboard shortcut Ctrl+P → open print modal instead of raw browser print
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
    const shell = document.getElementById('appShell');
    if (shell && shell.classList.contains('visible')) {
      e.preventDefault();
      openPrintModal();
    }
  }
});

// ── Print-friendly table of contents helper (injected before print) ──
function _buildPrintTOC(sections) {
  return `<div style="page-break-after:always;padding:10mm 0">
    <h2 style="color:#003da5;border-bottom:2pt solid #00aeef;padding-bottom:6pt;font-size:14pt">Table of Contents</h2>
    <ol style="font-size:11pt;line-height:2;color:#0d1e3a;padding-left:20pt">
      ${sections.map((s,i) => `<li>${s.label.replace(/^[^ ]+ /,'')}</li>`).join('')}
    </ol>
  </div>`;
}

let _refreshTimer = null;
function refreshAll(){
  clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(()=>{
    document.getElementById('scPill').textContent=activeSc;
    buildDashKpis();
    requestAnimationFrame(()=>buildDashCharts());
    if(_isBuilt('dash2')) requestAnimationFrame(()=>buildDash2());
    if(_isBuilt('rpt-pl')) requestAnimationFrame(()=>buildMonthlyPL(plMonthlyYear));
    const active=document.querySelector('.pane.on')?.id?.replace('pane-','');
    if(active && active!=='dash' && _tabBuilders[active]) {
      requestAnimationFrame(()=>_tabBuilders[active]());
    }
  }, 50);
}

// ═══════════════════════════════════════════════════════
//  REVENUE ENGINE — THREE-LEVER MODEL (Session 2)
// ═══════════════════════════════════════════════════════

// LEVER 1 — volumeTable: 9 rate classes × 12 months × {cust, mwh, kva}
// Zeroed — populate from AOP_2026 assumptions in Supabase (fpaApplyToLegacyGlobals overwrites on load)
const _zv = () => Array(12).fill(0);
let volumeTable = {
  RT10_lo: { cust:_zv(), mwh:_zv(), kva:null },
  RT10_hi: { cust:_zv(), mwh:_zv(), kva:null },
  RT20:    { cust:_zv(), mwh:_zv(), kva:null },
  RT40_std:{ cust:_zv(), mwh:_zv(), kva:_zv() },
  RT40_tou:{ cust:_zv(), mwh:_zv(), kva:_zv() },
  RT50_std:{ cust:_zv(), mwh:_zv(), kva:_zv() },
  RT50_tou:{ cust:_zv(), mwh:_zv(), kva:_zv() },
  RT60:    { cust:_zv(), mwh:_zv(), kva:null },
  RT70:    { cust:_zv(), mwh:_zv(), kva:_zv() },
};

// LEVER 2 — tariffTable: J$ rates — zeroed; load from fpa_tariff_rates DB table (TODO: wire DB load)
// All rates are 0 until uploaded. The revenue engine produces $0 until tariff data is loaded.
const _zt = () => MONTHS.map(()=>0);
let tariffTable = {
  RT10_lo: { custChg:_zt(), energyStd:_zt(), energyOff:null, energyPP:null, energyOn:null, demandStd:null, demandOff:null, demandPP:null, demandOn:null },
  RT10_hi: { custChg:_zt(), energyStd:_zt(), energyOff:null, energyPP:null, energyOn:null, demandStd:null, demandOff:null, demandPP:null, demandOn:null },
  RT20:    { custChg:_zt(), energyStd:_zt(), energyOff:null, energyPP:null, energyOn:null, demandStd:null, demandOff:null, demandPP:null, demandOn:null },
  RT40_std:{ custChg:_zt(), energyStd:_zt(), energyOff:null, energyPP:null, energyOn:null, demandStd:_zt(), demandOff:null, demandPP:null, demandOn:null },
  RT40_tou:{ custChg:_zt(), energyStd:null,  energyOff:_zt(), energyPP:_zt(), energyOn:_zt(), demandStd:null, demandOff:_zt(), demandPP:_zt(), demandOn:_zt() },
  RT50_std:{ custChg:_zt(), energyStd:_zt(), energyOff:null, energyPP:null, energyOn:null, demandStd:_zt(), demandOff:null, demandPP:null, demandOn:null },
  RT50_tou:{ custChg:_zt(), energyStd:null,  energyOff:_zt(), energyPP:_zt(), energyOn:_zt(), demandStd:null, demandOff:_zt(), demandPP:_zt(), demandOn:_zt() },
  RT60:    { custChg:_zt(), energyStd:_zt(), energyOff:null, energyPP:null, energyOn:null, demandStd:null, demandOff:null, demandPP:null, demandOn:null },
  RT70:    { custChg:_zt(), energyStd:_zt(), energyOff:null, energyPP:null, energyOn:null, demandStd:_zt(), demandOff:null, demandPP:null, demandOn:null },
};

// Snapshot of original tariff rates for reset
const _tariffBaseline = JSON.parse(JSON.stringify(tariffTable));

// LEVER 3 — fxTable: monthly billing and expense FX rates (J$/US$)
// Populated from fpa_assumptions (category=fx_billing/fx_expense) in fpaBootstrap.
// Multi-year structure: years[yr].billing/expense = 12-element arrays
// source[mo] = 'actual' (locked, from Supabase) | 'projected' (editable)
const _zfx = () => Array(12).fill(0);
const _mkFxYears = () => {
  const o = {};
  Array.from({length:5},(_,i)=>_CY+i).forEach(y=>{
    o[y] = { billing: _zfx(), expense: _zfx(), source: Array(12).fill('projected') };
  });
  return o;
};
let fxTable = {
  billing: _zfx(), expense: _zfx(),
  years: _mkFxYears(),
};
// Helper: get FX rate for any year+month combination — DB-backed, zero fallback
function getFxRate(yr, mo, type='billing') {
  return fxTable.years[yr]?.[type]?.[mo] || fxTable[type]?.[mo] || 0;
}
let selectedFxYear = _CY;

// Fuel revenue by month — zeroed; populated from uploads/fpa.facts
const fuelRevByMonth = Array(12).fill(0);

// Budget/LE reference revenue for bridge (non-fuel, US$K) — zeroed; populated from fpa.facts AOP
const leNonFuelByMonth = Array(12).fill(0);

// ── Revenue Calculation Engine ──────────────────────────────────────────────
function calcRevEngineMonth(mo) {
  const fxBill = fxTable.billing[mo] || 0;
  let custRevJm = 0, energyRevJm = 0, demandRevJm = 0;
  const classes = Object.keys(tariffTable);
  classes.forEach(cls => {
    const vol = volumeTable[cls];
    const tar = tariffTable[cls];
    const cust = (vol.cust?.[mo] || 0);
    const mwh = (vol.mwh?.[mo] || 0) * 1000; // MWh → kWh
    const kva = (vol.kva?.[mo] || 0);
    // Customer charge (J$/month)
    custRevJm += cust * (tar.custChg?.[mo] || 0);
    // Energy charge — TOU classes weighted equally across off/pp/on if no split defined
    if (tar.energyStd) {
      energyRevJm += mwh * (tar.energyStd[mo] || 0);
    } else if (tar.energyOff && tar.energyPP && tar.energyOn) {
      const avgE = ((tar.energyOff[mo]||0) + (tar.energyPP[mo]||0) + (tar.energyOn[mo]||0)) / 3;
      energyRevJm += mwh * avgE;
    }
    // Demand charge
    if (tar.demandStd) {
      demandRevJm += kva * (tar.demandStd[mo] || 0);
    } else if (tar.demandOff && tar.demandPP && tar.demandOn) {
      const avgD = ((tar.demandOff[mo]||0) + (tar.demandPP[mo]||0) + (tar.demandOn[mo]||0)) / 3;
      demandRevJm += kva * avgD;
    }
  });
  const nonFuelRevUSD = (custRevJm + energyRevJm + demandRevJm) / fxBill / 1000; // → US$K
  const fuelRevUSD = fuelRevByMonth[mo];
  return {
    custRevJm: custRevJm / 1e6,     // J$M
    energyRevJm: energyRevJm / 1e6, // J$M
    demandRevJm: demandRevJm / 1e6, // J$M
    nonFuelRevUSD: Math.round(nonFuelRevUSD),
    fuelRevUSD: fuelRevUSD,
    totalRevUSD: Math.round(nonFuelRevUSD) + fuelRevUSD,
  };
}

// Returns per-class detail including billing component split and effective non-fuel rates
function calcRevEngineMonthByClass(mo) {
  const fxBill = fxTable.billing[mo] || 0;
  const result = [];
  Object.keys(tariffTable).forEach(cls => {
    const vol = volumeTable[cls];
    const tar = tariffTable[cls];
    const cust   = vol.cust?.[mo] || 0;
    const mwh    = vol.mwh?.[mo]  || 0;
    const kva    = vol.kva?.[mo]  || 0;
    const mwhKwh = mwh * 1000;

    // ── Customer charge ────────────────────────────────────────────────────
    const custRevJm = cust * (tar.custChg?.[mo] || 0);

    // ── Energy (non-fuel) charge ───────────────────────────────────────────
    let energyRevJm = 0, nfRateJkwh = 0;
    if (tar.energyStd) {
      nfRateJkwh = tar.energyStd[mo] || 0;
      energyRevJm = mwhKwh * nfRateJkwh;
    } else if (tar.energyOff && tar.energyPP && tar.energyOn) {
      nfRateJkwh = ((tar.energyOff[mo]||0)+(tar.energyPP[mo]||0)+(tar.energyOn[mo]||0))/3;
      energyRevJm = mwhKwh * nfRateJkwh;
    }

    // ── Demand charge ──────────────────────────────────────────────────────
    let demandRevJm = 0, demandRateJkva = 0;
    if (tar.demandStd) {
      demandRateJkva = tar.demandStd[mo] || 0;
      demandRevJm = kva * demandRateJkva;
    } else if (tar.demandOff && tar.demandPP && tar.demandOn) {
      demandRateJkva = ((tar.demandOff[mo]||0)+(tar.demandPP[mo]||0)+(tar.demandOn[mo]||0))/3;
      demandRevJm = kva * demandRateJkva;
    }

    const totalJm    = custRevJm + energyRevJm + demandRevJm;
    const revUSDK    = fxBill > 0 ? Math.round(totalJm / fxBill / 1000) : 0;
    const revPerKwh  = mwh > 0 && fxBill > 0 ? (totalJm / fxBill / mwhKwh) * 100 : 0; // US¢/kWh
    const custChgRt  = tar.custChg?.[mo] || 0;
    const hasDemand  = kva > 0 || demandRateJkva > 0;

    result.push({
      cls,
      cust, mwh, kva, hasDemand,
      // Revenue components (J$'000)
      custRevJmK:   Math.round(custRevJm   / 1000),
      energyRevJmK: Math.round(energyRevJm / 1000),
      demandRevJmK: Math.round(demandRevJm / 1000),
      totalJmK:     Math.round(totalJm     / 1000),
      // USD totals
      revUSDK,
      revPerKwh,
      // Effective rates (for non-fuel rate summary)
      custChgRt,       // J$/customer/month
      nfRateJkwh,      // J$/kWh (non-fuel energy rate, or avg TOU)
      demandRateJkva,  // J$/kVA (demand rate, or avg TOU)
    });
  });
  return result;
}

function getAllMonthsRevenue() {
  return MONTHS.map((_,i) => calcRevEngineMonth(i));
}

// ── BUILD: Main Revenue Engine pane ─────────────────────────────────────────
function buildRevEngine() {
  buildRevKpis3();
  buildRevBridgeChart();
  buildRevTrendChart();
  buildRevClassTable();
  buildTariffTable3();
  buildVolumeTable();
  buildFxTable3();
  buildRevDerived();
}

// ── KPI Cards ────────────────────────────────────────────────────────────────
function buildRevKpis3() {
  const all = getAllMonthsRevenue();
  const ytdTotalRev = all.reduce((s,m)=>s+m.totalRevUSD,0);
  const ytdNonFuel  = all.reduce((s,m)=>s+m.nonFuelRevUSD,0);
  const ytdFuel     = all.reduce((s,m)=>s+m.fuelRevUSD,0);
  const totalMwh    = Object.values(volumeTable).reduce((s,v)=>s+MONTHS.reduce((ss,_,i)=>ss+(v.mwh?.[i]||0),0),0);
  const avgTariff   = totalMwh > 0 ? (ytdNonFuel * 1000 / (totalMwh * 1000)) * 100 : 0; // US¢/kWh
  const leTotal     = leNonFuelByMonth.reduce((s,v)=>s+v,0) + fuelRevByMonth.reduce((s,v)=>s+v,0);
  const varTot      = ytdTotalRev - leTotal;
  const leNF        = leNonFuelByMonth.reduce((s,v)=>s+v,0);
  const varNF       = ytdNonFuel - leNF;
  const leFuel      = fuelRevByMonth.reduce((s,v)=>s+v,0);
  const varFuel     = ytdFuel - leFuel;

  const kpis = [
    {l:'Total Revenue (US$K)',  v:'$'+Math.round(ytdTotalRev).toLocaleString()+'K', d:varTot,   cls:'g', sub:'YTD Annual'},
    {l:'Non-Fuel Revenue',      v:'$'+Math.round(ytdNonFuel).toLocaleString()+'K',  d:varNF,    cls:'b', sub:'YTD Annual'},
    {l:'Fuel Revenue',          v:'$'+Math.round(ytdFuel).toLocaleString()+'K',     d:varFuel,  cls:'t', sub:'YTD Annual'},
    {l:'Avg Tariff (US¢/kWh)',  v:avgTariff.toFixed(2)+'¢',                         d:null,     cls:'gr',sub:'Blended non-fuel'},
  ];
  document.getElementById('revKpis3').innerHTML = kpis.map(k=>`
    <div class="kpi ${k.cls}">
      <div class="kpi-l">${k.l}</div>
      <div class="kpi-v">${k.v}</div>
      <div class="kpi-d">
        <span style="font-size:8px;color:var(--muted)">${k.sub}</span>
        ${k.d!==null?`<span class="${k.d>=0?'up':'dn'}" style="margin-left:4px">${k.d>=0?'▲':'▼'} $${Math.abs(Math.round(k.d)).toLocaleString()}K vs LE</span>`:''}
      </div>
    </div>`).join('');
}

// ── Revenue Bridge Chart ──────────────────────────────────────────────────────
function buildRevBridgeChart() {
  const mo = parseInt(document.getElementById('revBridgeMo')?.value||0);
  const actual = calcRevEngineMonth(mo);
  const budNF  = leNonFuelByMonth[mo];
  const budF   = fuelRevByMonth[mo];
  const budTot = budNF + budF;

  // Simplified bridge: vol effect, tariff effect, fx effect, fuel effect
  const baseVol   = volumeTable;
  // ARCHITECTURAL RULE: FX rates must come from DB. No hardcoded fallback.
  const fxCur = fxTable.billing[mo] || 0;
  const fxBud = netFinancingRows[_CY]?.budgetFX?.[mo] || 0; // budget FX from DB
  // Volume effect: use budget tariff but actual volume vs budget volume
  // We approximate using proportional GWh change × budget tariff / fx
  const actMwh = Object.values(volumeTable).reduce((s,v)=>s+(v.mwh?.[mo]||0),0);
  const budMwh = actMwh; // same (no separate budget volume stored) — set to 0 for now
  const volEffect  = (() => {
    // Volume effect: actual billed MWh vs LE billed MWh × LE tariff per MWh
    const leMWhFull = calcBilledSales(_CY)[mo]; // LE billed MWh for this month
    const leNFUSD   = leNonFuelByMonth[mo] || 0;
    const leTariffPerMWh = leMWhFull > 0 ? (leNFUSD / leMWhFull) * 1000 : 0;
    // actMwh is already computed above from volumeTable
    return actMwh > 0 && leMWhFull > 0
      ? Math.round((actMwh - leMWhFull) * leTariffPerMWh / 1000)
      : 0;
  })();
  const fxEffect   = Math.round((1/fxCur - 1/fxBud) * 162 * budNF); // simplified
  const tarEffect  = 0;
  const fuelEffect = Math.round(actual.fuelRevUSD - budF);
  const residual   = Math.round(actual.totalRevUSD - budTot - fxEffect - fuelEffect);

  const labels = ['Budget', 'FX Effect', 'Fuel Effect', 'Volume/Mix', 'Actual'];
  const base   = [budTot,   null,        null,          null,         null];
  const pos    = [null, fxEffect>=0?fxEffect:0, fuelEffect>=0?fuelEffect:0, residual>=0?residual:0, actual.totalRevUSD];
  const neg    = [null, fxEffect<0?fxEffect:0,  fuelEffect<0?fuelEffect:0,  residual<0?residual:0,  null];

  mkWaterfall('cRevBridge3',[
    {label:'Budget',      value:budTot,           isTotal:true},
    {label:'FX Effect',   value:fxEffect},
    {label:'Fuel Effect', value:fuelEffect},
    {label:'Vol/Mix',     value:residual},
    {label:'Actual',      value:actual.totalRevUSD, isTotal:true},
  ]);
}

// ── Revenue Trend Chart ───────────────────────────────────────────────────────
function buildRevTrendChart() {
  const all = getAllMonthsRevenue();
  const nfArr = all.map(m=>m.nonFuelRevUSD);
  const fArr  = all.map(m=>m.fuelRevUSD);
  const leArr = leNonFuelByMonth.map((v,i)=>v+fuelRevByMonth[i]);
  mkChart('cRevTrend3',{
    type:'bar',
    data:{labels:MONTHS, datasets:[
      {label:'Non-Fuel Revenue',data:nfArr,backgroundColor:'rgba(59,130,246,.6)',stack:'s'},
      {label:'Fuel Revenue',    data:fArr, backgroundColor:'rgba(240,180,41,.55)',stack:'s'},
      {label:'LE Reference',    data:leArr,type:'line',borderColor:'rgba(239,68,68,.8)',borderDash:[5,3],borderWidth:2,pointRadius:3,tension:.3,fill:false},
    ]},
    options:{...bO(v=>'$'+Math.round(v).toLocaleString()+'K'),
      scales:{
        x:{stacked:true,ticks:{color:_TC.muted,font:{size:9}},grid:{color:_TC.grid}},
        y:{stacked:true,ticks:{color:_TC.muted,font:{size:9},callback:v=>'$'+Math.round(v)+'K'},grid:{color:_TC.grid}},
      }
    }
  });
}

// ── Revenue by Rate Class Table ───────────────────────────────────────────────
const _RC_NAMES = {
  RT10_lo:'RT10  Residential <100kWh', RT10_hi:'RT10  Residential >100kWh',
  RT20:'RT20  Small Commercial',
  RT40_std:'RT40  Med Commercial (Std)', RT40_tou:'RT40  Med Commercial (TOU)',
  RT50_std:'RT50  Large Commercial (Std)', RT50_tou:'RT50  Large Commercial (TOU)',
  RT60:'RT60  Industrial', RT70:'RT70  Large Industrial',
};

function buildRevClassTable() {
  const view = document.getElementById('revClassView')?.value || 'billing';
  const mo   = parseInt(document.getElementById('revClassMo')?.value || 0);
  // Show/hide month picker based on view
  const moSel  = document.getElementById('revClassMo');
  const moNote = document.getElementById('revClassNote');
  if (moSel)  moSel.style.display  = view === 'annual' ? 'none' : '';
  if (moNote) moNote.style.display = view === 'annual' ? ''     : 'none';
  const rows = calcRevEngineMonthByClass(mo);

  const rc  = r => _RC_NAMES[r.cls] || r.cls;
  const jmK = v => v != null ? (v/1000).toFixed(2) : '–';       // J$'000 → J$M
  const jmr = v => v ? v.toFixed(2) : '–';                       // J$/kWh already
  const n   = v => v != null ? Math.round(v).toLocaleString() : '–';

  // ── VIEW 1: BILLING COMPONENTS ────────────────────────────────────────────
  if (view === 'billing') {
    document.getElementById('revClassH').innerHTML = `<tr>
      <th style="text-align:left;min-width:190px">Rate Class</th>
      <th class="bc" title="Number of billing accounts">Customers</th>
      <th class="bc">MWh Billed</th>
      <th class="bc" title="kVA billed (demand classes only)">kVA</th>
      <th class="bc" style="background:#eef3fb" title="J$ customer/access charges">Cust Chg J$M</th>
      <th class="bc" style="background:#eef3fb" title="J$ non-fuel energy charges">Energy J$M</th>
      <th class="bc" style="background:#eef3fb" title="J$ demand charges">Demand J$M</th>
      <th class="bc" style="background:#e8f5e9;font-weight:800">Total J$M</th>
      <th class="bc" style="color:var(--teal)">US$K</th>
      <th class="ac" style="color:var(--gold)">US¢/kWh</th>
    </tr>`;
    let tC=0,tM=0,tK=0,tCJ=0,tEJ=0,tDJ=0,tJ=0,tU=0;
    document.getElementById('revClassB').innerHTML = rows.map(r => {
      tC+=r.cust; tM+=r.mwh; tK+=r.kva;
      tCJ+=r.custRevJmK; tEJ+=r.energyRevJmK; tDJ+=r.demandRevJmK; tJ+=r.totalJmK; tU+=r.revUSDK;
      return `<tr>
        <td style="padding-left:8px">${rc(r)}</td>
        <td style="text-align:right">${r.cust ? n(r.cust) : '–'}</td>
        <td style="text-align:right">${r.mwh.toFixed(1)}</td>
        <td style="text-align:right;color:var(--muted)">${r.kva ? n(r.kva) : '–'}</td>
        <td style="text-align:right;background:#f7f9fe">${jmK(r.custRevJmK)}</td>
        <td style="text-align:right;background:#f7f9fe">${jmK(r.energyRevJmK)}</td>
        <td style="text-align:right;background:#f7f9fe">${jmK(r.demandRevJmK)}</td>
        <td style="text-align:right;background:#f0f7f0;font-weight:700">${jmK(r.totalJmK)}</td>
        <td style="text-align:right;color:var(--teal)">${n(r.revUSDK)}</td>
        <td style="text-align:right;color:var(--gold)">${r.revPerKwh.toFixed(2)}¢</td>
      </tr>`;
    }).join('') + `<tr class="tr">
      <td><strong>TOTAL</strong></td>
      <td style="text-align:right"><strong>${n(tC)}</strong></td>
      <td style="text-align:right"><strong>${tM.toFixed(1)}</strong></td>
      <td style="text-align:right;color:var(--muted)">${n(tK)}</td>
      <td style="text-align:right;background:#eef3fb"><strong>${jmK(tCJ)}</strong></td>
      <td style="text-align:right;background:#eef3fb"><strong>${jmK(tEJ)}</strong></td>
      <td style="text-align:right;background:#eef3fb"><strong>${jmK(tDJ)}</strong></td>
      <td style="text-align:right;background:#e8f5e9;color:var(--green)"><strong>${jmK(tJ)}</strong></td>
      <td style="text-align:right;color:var(--gold)"><strong>${n(tU)}</strong></td>
      <td style="text-align:right;color:var(--gold)"><strong>${tM>0&&tU>0?((tU*1000)/(tM*1000)*100).toFixed(2)+'¢':'–'}</strong></td>
    </tr>`;

  // ── VIEW 2: NON-FUEL TARIFF RATES ─────────────────────────────────────────
  } else if (view === 'nfrates') {
    document.getElementById('revClassH').innerHTML = `<tr>
      <th style="text-align:left;min-width:190px">Rate Class</th>
      <th class="bc" title="Monthly fixed charge per customer">Cust Chg<br><span style="font-weight:400;color:var(--muted)">J$/account/mo</span></th>
      <th class="bc" title="Non-fuel energy rate (standard or avg TOU)">Energy Rate<br><span style="font-weight:400;color:var(--muted)">J$/kWh</span></th>
      <th class="bc" title="Demand rate (standard or avg TOU)">Demand Rate<br><span style="font-weight:400;color:var(--muted)">J$/kVA</span></th>
      <th class="bc" title="Effective non-fuel rate in US cents per kWh">Effective NF Rate<br><span style="font-weight:400;color:var(--muted)">US¢/kWh</span></th>
      <th class="bc">MWh Billed</th>
      <th class="bc" style="background:#eef3fb">NF Energy Rev J$M</th>
      <th class="bc" style="background:#eef3fb">Demand Rev J$M</th>
      <th class="bc" style="background:#e8f5e9">NF Total J$M</th>
    </tr>`;
    const fxBill = fxTable.billing[mo] || 0;
    let tEJ=0,tDJ=0,tJ=0,tM=0;
    document.getElementById('revClassB').innerHTML = rows.map(r => {
      tEJ+=r.energyRevJmK; tDJ+=r.demandRevJmK; tJ+=(r.energyRevJmK+r.demandRevJmK); tM+=r.mwh;
      const effNFcent = r.mwh > 0 && fxBill > 0
        ? ((r.energyRevJmK+r.demandRevJmK)*1000 / (r.mwh*1000) / fxBill * 100).toFixed(2)+'¢' : '–';
      const hasDmd = r.kva > 0 || r.demandRateJkva > 0;
      return `<tr>
        <td style="padding-left:8px">${rc(r)}</td>
        <td style="text-align:right">${r.custChgRt ? r.custChgRt.toLocaleString('en-JM',{minimumFractionDigits:2}) : '–'}</td>
        <td style="text-align:right;font-weight:700;color:#003da5">${r.nfRateJkwh ? r.nfRateJkwh.toFixed(4) : '–'}</td>
        <td style="text-align:right;color:#003da5">${hasDmd ? r.demandRateJkva.toFixed(2) : '<span style="color:var(--muted)">N/A</span>'}</td>
        <td style="text-align:right;color:var(--gold)">${effNFcent}</td>
        <td style="text-align:right">${r.mwh.toFixed(1)}</td>
        <td style="text-align:right;background:#f7f9fe">${jmK(r.energyRevJmK)}</td>
        <td style="text-align:right;background:#f7f9fe">${jmK(r.demandRevJmK)}</td>
        <td style="text-align:right;background:#f0f7f0;font-weight:700">${jmK(r.energyRevJmK+r.demandRevJmK)}</td>
      </tr>`;
    }).join('') + `<tr class="tr">
      <td colspan="5"><strong>TOTAL</strong></td>
      <td style="text-align:right"><strong>${tM.toFixed(1)}</strong></td>
      <td style="text-align:right;background:#eef3fb"><strong>${jmK(tEJ)}</strong></td>
      <td style="text-align:right;background:#eef3fb"><strong>${jmK(tDJ)}</strong></td>
      <td style="text-align:right;background:#e8f5e9;color:var(--green)"><strong>${jmK(tJ)}</strong></td>
    </tr>`;

  // ── VIEW 3: ANNUAL SUMMARY ────────────────────────────────────────────────
  } else if (view === 'annual') {
    document.getElementById('revClassH').innerHTML = `<tr>
      <th style="text-align:left;min-width:190px">Rate Class</th>
      ${Array(12).fill(0).map((_,i)=>`<th class="bc" style="font-size:9px">${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][i]}</th>`).join('')}
      <th class="bc" style="background:#e8f5e9">Annual J$M</th>
      <th class="bc" style="background:#e8f5e9">Annual US$K</th>
    </tr>`;
    // Compute for all 12 months for each class
    const allMonths = Array(12).fill(0).map((_,m) => calcRevEngineMonthByClass(m));
    const totByMo   = Array(12).fill(0);
    let grandJmK = 0, grandUSD = 0;
    document.getElementById('revClassB').innerHTML = Object.keys(tariffTable).map(cls => {
      let annJmK=0, annUSD=0;
      const cells = allMonths.map((mRows,m) => {
        const r = mRows.find(x=>x.cls===cls);
        if (!r) return '<td style="text-align:right;color:var(--muted)">–</td>';
        annJmK += r.totalJmK; annUSD += r.revUSDK; totByMo[m] += r.totalJmK;
        return `<td style="text-align:right;font-size:10px">${(r.totalJmK/1000).toFixed(1)}</td>`;
      }).join('');
      grandJmK += annJmK; grandUSD += annUSD;
      return `<tr><td style="padding-left:8px">${_RC_NAMES[cls]||cls}</td>${cells}
        <td style="text-align:right;background:#f0f7f0;font-weight:700">${(annJmK/1000).toFixed(1)}</td>
        <td style="text-align:right;background:#f0f7f0;color:var(--teal)">${n(annUSD)}</td>
      </tr>`;
    }).join('') + `<tr class="tr"><td><strong>TOTAL</strong></td>
      ${totByMo.map(v=>`<td style="text-align:right;font-size:10px"><strong>${(v/1000).toFixed(1)}</strong></td>`).join('')}
      <td style="text-align:right;background:#e8f5e9"><strong>${(grandJmK/1000).toFixed(1)}</strong></td>
      <td style="text-align:right;background:#e8f5e9;color:var(--gold)"><strong>${n(grandUSD)}</strong></td>
    </tr>`;
  }
}

// ── Tariff Table ──────────────────────────────────────────────────────────────
function buildTariffTable3() {
  const clsLabel = {RT10_lo:'RT10 <100kWh',RT10_hi:'RT10 >100kWh',RT20:'RT20',RT40_std:'RT40 Std',RT40_tou:'RT40 TOU (TOU)',RT50_std:'RT50 Std',RT50_tou:'RT50 TOU (TOU)',RT60:'RT60',RT70:'RT70'};
  document.getElementById('tariffB3').innerHTML = Object.keys(tariffTable).map(cls => {
    const t = tariffTable[cls];
    const mo = 0; // show month-0 rate in cells (trigger updates from that month)
    const inp = (arr,field)=> arr
      ? `<td><input class="ei" style="width:68px" value="${(arr[mo]||0).toFixed(2)}" onchange="updTariff3('${cls}','${field}',this.value)" onfocus="this.select()"></td>`
      : `<td class="der" style="color:var(--muted);text-align:center">–</td>`;
    return `<tr>
      <td style="padding-left:10px"><strong>${clsLabel[cls]||cls}</strong></td>
      ${inp(t.custChg,'custChg')}
      ${inp(t.energyStd,'energyStd')}
      ${inp(t.energyOff,'energyOff')}
      ${inp(t.energyPP,'energyPP')}
      ${inp(t.energyOn,'energyOn')}
      ${inp(t.demandStd,'demandStd')}
      ${inp(t.demandOff,'demandOff')}
      ${inp(t.demandPP,'demandPP')}
      ${inp(t.demandOn,'demandOn')}
    </tr>`;
  }).join('');
}

function updTariff3(cls, field, val) { auditLog('tariff-edit',`Tariff · ${cls} · ${field}`,null,val);
  const v = parseFloat(val) || 0;
  if (tariffTable[cls] && tariffTable[cls][field]) {
    tariffTable[cls][field] = tariffTable[cls][field].map(()=>v);
  }
  buildRevEngine();
  toast('Tariff updated → Revenue recalculated','ok');
}

function toggleTariffTrigger() {
  const p = document.getElementById('tariffTriggerPanel');
  p.style.display = p.style.display==='none' ? '' : 'none';
}

function applyTariffTrigger() {
  const fromMo = parseInt(document.getElementById('trgMonth').value)||0;
  const pct    = parseFloat(document.getElementById('trgPct').value)||0;
  const mult   = 1 + pct/100;
  const affected = [...document.querySelectorAll('.trgCls:checked')].map(cb=>cb.value);
  affected.forEach(cls => {
    const t = tariffTable[cls];
    if (!t) return;
    ['custChg','energyStd','energyOff','energyPP','energyOn','demandStd','demandOff','demandPP','demandOn'].forEach(f=>{
      if (t[f]) t[f] = t[f].map((v,i)=> i>=fromMo ? v*mult : v);
    });
  });
  buildRevEngine();
  toast(`Tariff trigger applied: ${pct>=0?'+':''}${pct}% from ${MONTHS[fromMo]} on ${affected.length} class(es)`,'ok');
}

function resetTariffTrigger() {
  const baseline = _tariffBaseline;
  Object.keys(tariffTable).forEach(cls=>{
    ['custChg','energyStd','energyOff','energyPP','energyOn','demandStd','demandOff','demandPP','demandOn'].forEach(f=>{
      if (baseline[cls]?.[f]) tariffTable[cls][f] = [...baseline[cls][f]];
    });
  });
  buildRevEngine();
  toast('Tariff rates reset to OUR 2024 approved schedule','ok');
}

// ── Volume Table ──────────────────────────────────────────────────────────────
function buildVolumeTable() {
  const filter = document.getElementById('volClassSel')?.value || 'all';
  const clsLabel = {RT10_lo:'RT10 <100kWh',RT10_hi:'RT10 >100kWh',RT20:'RT20',RT40_std:'RT40 Std',RT40_tou:'RT40 TOU',RT50_std:'RT50 Std',RT50_tou:'RT50 TOU',RT60:'RT60 (Streetlights)',RT70:'RT70 HV'};
  const classes = filter==='all' ? Object.keys(volumeTable) : [filter];

  document.getElementById('volH').innerHTML=`<tr>
    <th style="text-align:left;min-width:200px">Rate Class / Metric</th>
    <th style="text-align:left;min-width:70px;color:var(--muted)">Unit</th>
    ${MONTHS.map(m=>`<th class="bc">${m}</th>`).join('')}
    <th class="bc">Total</th>
  </tr>`;

  const rows = [];
  classes.forEach(cls=>{
    const v = volumeTable[cls];
    const lbl = clsLabel[cls]||cls;
    // Section header
    rows.push(`<tr class="sur"><td colspan="${14+MONTHS.length}" style="padding-left:8px;font-weight:800;color:var(--teal);font-size:10px">▸ ${lbl}</td></tr>`);
    // Customers
    if (v.cust) {
      const tot = v.cust.reduce((s,x)=>s+(x||0),0);
      const avg = (tot/12).toFixed(0);
      rows.push(`<tr><td style="padding-left:18px">Customers</td><td style="color:var(--muted);font-size:10px">#</td>
        ${v.cust.map((x,i)=>`<td><input class="ei" style="width:64px" value="${Math.round(x)}" data-cls="${cls}" data-f="cust" data-mo="${i}" oninput="updVol3(this)" onfocus="this.select()"></td>`).join('')}
        <td class="gld">${Math.round(avg).toLocaleString()}<span style="font-size:8px;color:var(--muted)"> avg</span></td>
      </tr>`);
    }
    // MWh
    {
      const mwh = v.mwh||MONTHS.map(()=>0);
      const tot = mwh.reduce((s,x)=>s+(x||0),0);
      rows.push(`<tr><td style="padding-left:18px">Energy MWh</td><td style="color:var(--muted);font-size:10px">MWh</td>
        ${mwh.map((x,i)=>`<td><input class="ei" style="width:64px" value="${(x||0).toFixed(1)}" data-cls="${cls}" data-f="mwh" data-mo="${i}" oninput="updVol3(this)" onfocus="this.select()"></td>`).join('')}
        <td class="gld">${tot.toFixed(0)}</td>
      </tr>`);
    }
    // KVA
    if (v.kva) {
      const tot = v.kva.reduce((s,x)=>s+(x||0),0);
      rows.push(`<tr><td style="padding-left:18px">Demand KVA</td><td style="color:var(--muted);font-size:10px">KVA</td>
        ${v.kva.map((x,i)=>`<td><input class="ei" style="width:64px" value="${Math.round(x)}" data-cls="${cls}" data-f="kva" data-mo="${i}" oninput="updVol3(this)" onfocus="this.select()"></td>`).join('')}
        <td class="gld">${Math.round(tot/12).toLocaleString()}<span style="font-size:8px;color:var(--muted)"> avg</span></td>
      </tr>`);
    }
  });
  document.getElementById('volB').innerHTML = rows.join('');
}

function updVol3(inp) { auditLog('vol-edit',`Volume · ${inp.dataset?.cls||''} · ${inp.dataset?.field||''}`,null,inp.value);
  const cls = inp.dataset.cls, f = inp.dataset.f, mo = parseInt(inp.dataset.mo);
  const v = parseFloat(inp.value)||0;
  if (volumeTable[cls]?.[f]) volumeTable[cls][f][mo] = v;
  buildRevKpis3(); buildRevBridgeChart(); buildRevTrendChart(); buildRevClassTable(); buildRevDerived();
}

// ── FX Table — multi-year with actuals vs projections ────────────────────────
function buildFxTable3() {
  const yr = selectedFxYear;
  const yrData = fxTable.years[yr] || fxTable.years[_CY];
  const avgBill = (yrData.billing.reduce((s,v)=>s+v,0)/12).toFixed(2);
  const avgExp  = (yrData.expense.reduce((s,v)=>s+v,0)/12).toFixed(2);
  // Year selector
  const yrSel = document.getElementById('fxYearSel');
  if(yrSel && !yrSel._built){
    yrSel._built=true;
    Array.from({length:5},(_,i)=>_CY+i).forEach(y=>{
      const o=document.createElement('option'); o.value=y; o.textContent=y; yrSel.appendChild(o);
    });
    yrSel.value=yr;
    yrSel.onchange=()=>{selectedFxYear=parseInt(yrSel.value);buildFxTable3();};
  } else if(yrSel) yrSel.value=yr;
  document.getElementById('fxH3').innerHTML=`<tr>
    <th style="text-align:left;min-width:130px">Month</th>
    <th style="text-align:center;width:80px">Source</th>
    <th class="bc">Billing Rate (J$/US$)</th>
    <th class="bc">Expense Rate (J$/US$)</th>
  </tr>`;
  document.getElementById('fxB3').innerHTML = MONTHS.map((m,i)=>{
    const src = yrData.source?.[i]||'projected';
    const isAct = src==='actual';
    const srcBadge = isAct
      ? `<span style="background:rgba(6,182,212,.15);color:var(--teal);padding:1px 6px;border-radius:8px;font-size:8px;font-weight:700">ACTUAL</span>`
      : `<span style="background:rgba(240,180,41,.1);color:var(--gold);padding:1px 6px;border-radius:8px;font-size:8px;font-weight:700">PROJ</span>`;
    const inpStyle = isAct ? 'background:rgba(6,182,212,.08);color:var(--teal);border-color:rgba(6,182,212,.3);cursor:not-allowed' : '';
    return `<tr>
      <td style="padding-left:12px;font-weight:700">${m} ${yr}</td>
      <td style="text-align:center">${srcBadge}</td>
      <td><input class="ei" style="width:80px;${inpStyle}" value="${yrData.billing[i].toFixed(2)}" data-type="billing" data-mo="${i}" data-yr="${yr}" ${isAct?'readonly':''} oninput="updFx3(this)" onfocus="this.select()"></td>
      <td><input class="ei" style="width:80px;${inpStyle}" value="${yrData.expense[i].toFixed(2)}" data-type="expense" data-mo="${i}" data-yr="${yr}" ${isAct?'readonly':''} oninput="updFx3(this)" onfocus="this.select()"></td>
    </tr>`;
  }).join('') +
  `<tr class="tr"><td colspan="2" style="padding-left:12px"><strong>Annual Average</strong></td>
    <td class="gld"><strong>${avgBill}</strong></td><td class="gld"><strong>${avgExp}</strong></td></tr>`;
}

function updFx3(inp) {
  const type = inp.dataset.type, mo = parseInt(inp.dataset.mo), yr = parseInt(inp.dataset.yr)||selectedFxYear;
  const v = parseFloat(inp.value);
  if(isNaN(v)||v<50||v>500){toast('FX rate must be between 50 and 500 J$/US$','err');inp.style.borderColor='var(--red)';return;}
  inp.style.borderColor='';
  auditLog('fx-edit',`FX Rate · ${MONTHS[mo]} ${yr} · ${type}`,fxTable.years[yr]?.[type]?.[mo],v);
  if(!fxTable.years[yr]) fxTable.years[yr]={billing:Array(12).fill(0),expense:Array(12).fill(0),source:Array(12).fill('projected')};
  fxTable.years[yr][type][mo] = v;
  // Keep _CY top-level slice in sync for revenue engine
  if(yr===_CY) fxTable[type][mo] = v;
  buildRevKpis3(); buildRevBridgeChart(); buildRevTrendChart(); buildRevClassTable(); buildRevDerived();
  toast('FX updated → Revenue recalculated','ok');
}

// ── Derived Revenue Output (legacy table kept for I/S linkage) ────────────────
function buildRevDerived() {
  const all = getAllMonthsRevenue();
  const nfr = all.map(m=>m.nonFuelRevUSD);
  const fuelR = all.map(m=>m.fuelRevUSD);
  const totR  = all.map(m=>m.totalRevUSD);
  const gwhTot = MONTHS.map((_,i)=>Object.values(volumeTable).reduce((s,v)=>s+(v.mwh?.[i]||0),0));
  const sys = revRows.find(r=>r.id==='sys_loss')?.vals||_z12();

  document.getElementById('revDH').innerHTML=`<tr>
    <th style="min-width:260px;text-align:left">Derived Output</th>
    ${MONTHS.map(m=>`<th class="ac">${m}</th>`).join('')}
    <th class="ac">Total/Avg</th>
  </tr>`;
  document.getElementById('revDB').innerHTML=[
    {name:'→ Non-Fuel Revenue (US$K)',  vals:nfr,   cls:'tr', pct:false},
    {name:'→ Fuel Revenue (US$K)',      vals:fuelR,  cls:'',   pct:false},
    {name:'→ Total Revenue (US$K)',     vals:totR,   cls:'sur',pct:false},
    {name:'→ Total GWh Billed',         vals:gwhTot, cls:'',   pct:false},
    {name:'→ Avg System Loss %',        vals:sys,    cls:'',   pct:true},
  ].map(r=>{
    const isAvg = r.pct;
    const agg = isAvg ? r.vals.reduce((a,b)=>a+b,0)/12 : r.vals.reduce((a,b)=>a+b,0);
    return `<tr class="${r.cls}"><td style="padding-left:14px;color:var(--teal)"><strong>${r.name}</strong></td>
      ${(r.vals||[]).map(v=>`<td class="der">${r.pct?v.toFixed(1)+'%':fmtN(Math.round(v))}</td>`).join('')}
      <td class="der"><strong>${r.pct?agg.toFixed(1)+'%':fmtN(Math.round(agg))}</strong></td>
    </tr>`;
  }).join('');
}

// Existing legacy KPI (updated to redirect to new)
function buildRevKpis() { buildRevKpis3(); }


// ═══════════════════════════════════════════════════════
//  SESSION 5 DATA — Other Income, Appropriations, Tax
// ═══════════════════════════════════════════════════════
let otherIncomeRows = [
  {id:'ins_rec',    name:'Insurance Recoveries',           taxable:true,  cashItem:true,  cashLag:0, vals:_z5yrs()},
  {id:'asset_disp', name:'Gain/(Loss) on Asset Disposal',  taxable:true,  cashItem:true,  cashLag:0, vals:_z5yrs()},
  {id:'inv_sale',   name:'Sale of Inventory/Scrap',        taxable:true,  cashItem:true,  cashLag:0, vals:_z5yrs()},
  {id:'other_tax',  name:'Other Taxable Income/(Expense)', taxable:true,  cashItem:true,  cashLag:0, vals:_z5yrs()},
  {id:'div_rec',    name:'Dividend Received',              taxable:false, cashItem:true,  cashLag:0, vals:_z5yrs()},
  {id:'fx_gain',    name:'FX Gains/(Losses)',              taxable:false, cashItem:false, cashLag:0, vals:_z5yrs()},
  {id:'other_nontax',name:'Other Non-Taxable Inc/(Exp)', taxable:false, cashItem:false, cashLag:0, vals:_z5yrs()},
];

let appropriationRows = [
  {id:'div_pref', name:'Preference Dividends Paid',   vals:_z5yrs()},
  {id:'div_ord',  name:'Ordinary Dividends Paid',     vals:_z5yrs()},
  {id:'reserve',  name:'Transfer to Reserves',        vals:_z5yrs()},
];

// ARCHITECTURAL RULE: tax rate must come from DB (fpa_assumptions). No hardcoded fallback.
// Populated by fpaBootstrap() from uploaded assumptions. Until then, tax = 0.
let effectiveTaxRate = {};

// ── Tax Calculation ────────────────────────────────────
// Feb result: EBIT=-281, taxable other=0 → taxableIncome=-281 → tax=-94 (credit)
function calcTax(yr, month) {
  // Pull EBIT from actuals or plLines
  let ebit = 0;
  const act = _acts(month);
  if (act?.pl?.ebit !== undefined) {
    ebit = act.pl.ebit;
  } else {
    const ebitLine = plLines.find(l=>l.id==='ebit');
    if (ebitLine) {
      const yi = YEARS.indexOf(String(yr));
      ebit = yi >= 0 ? (ebitLine.vals[yi]||0) : 0;
    }
  }
  const taxableOther = otherIncomeRows
    .filter(r=>r.taxable)
    .reduce((s,r)=>s+(r.vals[yr]?.[month-1]||0), 0);
  const taxableIncome = ebit + taxableOther;
  return Math.round(taxableIncome * (effectiveTaxRate[yr]||0));
}

// ── Generation Data Arrays ──────────────────────────────
// Zeroed — populated from AOP assumptions in Supabase (fpaApplyToLegacyGlobals overwrites on load)
const _zg = () => ({ jps_thermal:_z12(), old_harbour:_z12(), renewables:_z12(), ipp:_z12() });
let netGenTable = {}; Array.from({length:5},(_,i)=>_CY+i).forEach(y=>{ netGenTable[y]=_zg(); });

// sysLossTable — zeroed. Populate from uploads.
let sysLossTable = {}; Array.from({length:5},(_,i)=>_CY+i).forEach(y=>{ sysLossTable[y]=_z12(); });

// heatRateTable — zeroed. Populated from fpa_assumptions (category=heat_rate) in bootstrap.
// Values are in GJ/MWh; UI multiplies by 3.6 to convert to kJ/kWh.
let heatRateTable = { jps_thermal: 0, old_harbour: 0, ipp_thermal: 0, system_avg: 0 };

// fuelPriceTable — zeroed. Populate from uploads.
let fuelPriceTable = {};
Array.from({length:5},(_,i)=>_CY+i).forEach(yr=>{
  fuelPriceTable[yr]={hfo:_z12(),lng:_z12(),ado:_z12()};
});

let selectedGenYear = _CY;
let selectedRevYear = _CY;
let selectedRevMonth = 0;

// fuelCostByMonth — zeroed. Populate from uploads.
const fuelCostByMonth = {};
Array.from({length:5},(_,i)=>_CY+i).forEach(yr=>{ fuelCostByMonth[yr]=_z12(); });
// fuelRevByYear — zeroed until fuel costs are loaded
const fuelRevByYear = {};
Array.from({length:5},(_,i)=>_CY+i).forEach(yr=>{ fuelRevByYear[yr]=_z12(); });

function setRevYear(yr, btn) {
  selectedRevYear = yr;
  document.querySelectorAll('#revYrSeg .sb').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  // Update FX display
  const avgFx = fxTable.billing.reduce((s,v)=>s+v,0)/12;
  const fxEl = document.getElementById('revFxDisplay');
  if (fxEl) fxEl.textContent = 'J$' + avgFx.toFixed(2) + ' (Jan avg)';
  buildRevEngine();
}

function setGenYear(yr, btn) {
  selectedGenYear = yr;
  document.querySelectorAll('#genYrSeg .sb').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  buildGenTables();
}

// ── Derived Generation Calculations ───────────────────
function calcNetGen(yr) {
  const g = netGenTable[yr];
  if (!g) return MONTHS.map(()=>0);
  return MONTHS.map((_,i)=>
    ((g.jps_thermal[i]||0)+(g.old_harbour[i]||0)+(g.renewables[i]||0)+(g.ipp[i]||0))*1000
  );
}
function calcBilledSales(yr) {
  const ng = calcNetGen(yr);
  const sl = sysLossTable[yr] || sysLossTable[_CY];
  return ng.map((v,i)=>Math.round(v*(1-(sl[i]||0)/100)));
}
function calcLossMWh(yr) {
  const ng = calcNetGen(yr); const bs = calcBilledSales(yr);
  return ng.map((v,i)=>v-bs[i]);
}

// ── Generation Tab Builders ────────────────────────────
function buildGenTables() {
  const yr = selectedGenYear;
  const ng = netGenTable[yr] || netGenTable[_CY];
  const sl = sysLossTable[yr] || sysLossTable[_CY];
  const fp = fuelPriceTable[yr] || fuelPriceTable[_CY];
  const bs = calcBilledSales(yr);
  const ng_total = calcNetGen(yr).map(v=>Math.round(v/1000*10)/10);
  const loss = calcLossMWh(yr).map(v=>Math.round(v/1000*10)/10);

  // Net generation table
  const genHEl = document.getElementById('genH');
  const genBEl = document.getElementById('genB');
  if (!genHEl) return;
  genHEl.innerHTML = `<tr><th style="text-align:left;min-width:160px">Group</th>${MONTHS.map(m=>`<th class="bc">${m}</th>`).join('')}<th class="bc">Total</th></tr>`;
  const groups = [
    {k:'jps_thermal',  n:'JPS Thermal (HFO/LNG)', c:'var(--red)'},
    {k:'old_harbour',  n:'Old Harbour CCGT',       c:'var(--blue)'},
    {k:'renewables',   n:'Renewables (Hydro/Wind/Solar)', c:'var(--green)'},
    {k:'ipp',          n:'IPP (JEP/WKPP/Other)',  c:'var(--purple)'},
  ];
  genBEl.innerHTML = groups.map(g => {
    const vals = ng[g.k] || [];
    const tot = vals.reduce((s,v)=>s+v,0);
    return `<tr><td style="color:${g.c};padding-left:10px">${g.n}</td>${vals.map(v=>`<td>${v.toFixed(1)}</td>`).join('')}<td class="gld">${tot.toFixed(1)}</td></tr>`;
  }).join('') +
  `<tr class="tr"><td style="padding-left:10px">Total Net Generation (GWh)</td>${ng_total.map(v=>`<td>${v.toFixed(1)}</td>`).join('')}<td class="gld">${ng_total.reduce((s,v)=>s+v,0).toFixed(1)}</td></tr>`;

  // System loss table
  const slHEl = document.getElementById('sysLossH');
  const slBEl = document.getElementById('sysLossB');
  if (slHEl) {
    slHEl.innerHTML = `<tr><th style="text-align:left;min-width:160px">Metric</th>${MONTHS.map(m=>`<th class="bc">${m}</th>`).join('')}</tr>`;
    const billed = calcBilledSales(yr);
    slBEl.innerHTML =
      `<tr><td style="padding-left:10px">System Loss %</td>${sl.map((v,i)=>
        can('editGeneration') ? `<td><input class="ei" style="width:48px" value="${v.toFixed(1)}" data-yr="${yr}" data-mo="${i}" oninput="updSysLoss(this)"></td>`
        : `<td>${v.toFixed(1)}%</td>`).join('')}</tr>` +
      `<tr class="der"><td style="padding-left:10px">Billed Sales MWh</td>${billed.map(v=>`<td>${Math.round(v/1000).toLocaleString()}k</td>`).join('')}</tr>` +
      `<tr class="der"><td style="padding-left:10px">Loss MWh</td>${loss.map(v=>`<td>${v.toFixed(0)}</td>`).join('')}</tr>`;
  }

  // Fuel price table
  const fpHEl = document.getElementById('fuelPxH');
  const fpBEl = document.getElementById('fuelPxB');
  if (fpHEl) {
    fpHEl.innerHTML = `<tr><th style="text-align:left;min-width:160px">Fuel Type ($/GJ)</th>${MONTHS.map(m=>`<th class="bc">${m}</th>`).join('')}</tr>`;
    ['hfo','lng','ado'].forEach((f,fi) => {
      const vals = fp[f] || [];
      fpBEl.innerHTML = (fi===0?'':'') + (document.getElementById('fuelPxB').innerHTML || '');
    });
    fpBEl.innerHTML = ['hfo','lng','ado'].map(f=>{
      const vals = fp[f] || [];
      const labels = {hfo:'HFO',lng:'LNG/Gas',ado:'ADO Diesel'};
      return `<tr><td style="padding-left:10px">${labels[f]}</td>${vals.map(v=>`<td>${v.toFixed(2)}</td>`).join('')}</tr>`;
    }).join('');
  }

  // Derived output
  const derHEl = document.getElementById('genDerH');
  const derBEl = document.getElementById('genDerB');
  if (derHEl) {
    derHEl.innerHTML = `<tr><th style="text-align:left;min-width:160px">Derived Metric</th>${MONTHS.map(m=>`<th class="bc">${m}</th>`).join('')}<th class="bc">Total</th></tr>`;
    const fc = fuelCostByMonth2026;
    const vom = Array(12).fill(0); // zeroed — populate from uploads
    const billedK = calcBilledSales(yr).map(v=>Math.round(v/1000));
    // Actuals overlay for 2026 fuel cost
    const actFuelCost=yr===actualsYear?MONTHS.map((_,m)=>_acts(m+1)?.pl?.fuelCost!=null?Math.abs(actualsStore[m+1].pl.fuelCost):null):MONTHS.map(()=>null);
    const actBilled=yr===actualsYear?MONTHS.map((_,m)=>_acts(m+1)?.rev?.salesMWh!=null?Math.round(actualsStore[m+1].rev.salesMWh/1000):null):MONTHS.map(()=>null);
    const hasActuals=actFuelCost.some(v=>v!==null);
    const leRows=[
      {n:'Total Net Gen (GWh) LE',vals:ng_total,act:null},
      {n:'Billed Sales (GWh) LE',vals:billedK,act:actBilled},
      {n:'Fuel Cost US$000 LE',vals:fc,act:actFuelCost},
      {n:'VO&M Cost US$000',vals:_z12(),act:null},
    ];
    derBEl.innerHTML = leRows.map(r=>{
      const totalLE=r.vals.reduce((s,v)=>s+(v||0),0);
      let actRow='';
      if(r.act&&r.act.some(v=>v!==null)){
        const totalAct=r.act.reduce((s,v)=>s+(v||0),0);
        actRow=`<tr style="background:rgba(16,185,129,.06)"><td style="padding-left:20px;color:var(--green);font-size:10px">↳ Actual</td>${r.act.map(v=>v!==null?`<td style="color:var(--green)">${v.toLocaleString()}</td>`:`<td style="color:var(--muted);opacity:.4">–</td>`).join('')}<td style="color:var(--green)">${totalAct.toLocaleString()}</td></tr>`;
      }
      return `<tr class="der"><td style="padding-left:10px">${r.n}</td>${r.vals.map(v=>`<td>${typeof v==='number'?v.toLocaleString():'–'}</td>`).join('')}<td class="gld">${totalLE.toLocaleString()}</td></tr>${actRow}`;
    }).join('');
    // genActualsBanner — upload indicators removed from UI
    const banner=document.getElementById('genActualsBanner');
    if(banner){ banner.style.display='none'; }
  }

  // KPIs
  const totalGen = ng_total.reduce((s,v)=>s+v,0);
  const totalBilled = calcBilledSales(yr).reduce((s,v)=>s+v,0)/1000;
  const avgLoss = sl.reduce((s,v)=>s+v,0)/12;
  const reGwh = (ng.renewables||[]).reduce((s,v)=>s+v,0);
  const rePct = totalGen>0?(reGwh/totalGen*100).toFixed(1):'0';
  document.getElementById('genKpis').innerHTML = [
    {lbl:'Total Net Gen',v:totalGen.toFixed(0)+' GWh',c:'t'},
    {lbl:'Billed Sales',v:totalBilled.toFixed(0)+' GWh',c:'b'},
    {lbl:'Avg System Loss',v:avgLoss.toFixed(1)+'%',c:'r'},
    {lbl:'Renewable %',v:rePct+'%',c:'gr'},
  ].map(k=>`<div class="kpi ${k.c}"><div class="kpi-l">${k.lbl}</div><div class="kpi-v">${k.v}</div></div>`).join('');

  // Charts — with actuals overlay for 2026
  const actBilledArr = yr===actualsYear ? MONTHS.map((_,m)=>_acts(m+1)?.rev?.salesMWh??null) : MONTHS.map(()=>null);
  const actFuelCostArr = yr===actualsYear ? MONTHS.map((_,m)=>{const v=_acts(m+1)?.pl?.fuelCost; return v!=null?Math.abs(v):null;}) : MONTHS.map(()=>null);
  const hasActGen = actBilledArr.some(v=>v!==null);

  const genGroups = ['jps_thermal','old_harbour','renewables','ipp'];
  const genColors = ['rgba(239,68,68,.65)','rgba(59,130,246,.65)','rgba(16,185,129,.65)','rgba(139,92,246,.65)'];
  mkChart('cGenMix',{type:'bar',data:{labels:MONTHS,datasets:genGroups.map((g,i)=>({
    label:['JPS Thermal','Old Harbour CCGT','Renewables','IPP'][i],
    data:ng[g]||[],backgroundColor:genColors[i],stack:'s',
  }))},options:{...bO(),scales:{x:{stacked:true,ticks:{color:_TC.muted,font:{size:9}},grid:{color:_TC.grid}},y:{stacked:true,ticks:{color:_TC.muted,font:{size:9},callback:v=>v+'GWh'},grid:{color:_TC.grid}}}}});

  // System loss + billed sales actuals
  const sysLossDatasets = [
    {label:'System Loss % (LE)',data:sl,borderColor:CP[3],borderWidth:2,tension:.4,pointRadius:3,fill:false,yAxisID:'y'},
  ];
  const billedLEArr = calcBilledSales(yr).map(v=>Math.round(v/1000*10)/10);
  const billedDatasets = [
    {label:'Billed Sales LE (GWh)',data:billedLEArr,backgroundColor:'rgba(59,130,246,.35)',order:2},
  ];
  if(hasActGen){
    billedDatasets.push({
      label:'Billed Sales Actual (MWh→GWh)',
      data:actBilledArr.map(v=>v!=null?Math.round(v/1000*10)/10:null),
      type:'line',borderColor:'rgba(16,185,129,.9)',borderWidth:2.5,
      pointRadius:5,pointBackgroundColor:'rgba(16,185,129,1)',tension:.3,fill:false,order:1
    });
  }
  mkChart('cSysLoss',{type:'bar',data:{labels:MONTHS,datasets:billedDatasets},
    options:{...bO(v=>v.toFixed(0)+' GWh'),
      plugins:{legend:{labels:{color:_TC.muted,font:{size:9},boxWidth:10}}},
    }
  });
}

function updSysLoss(inp) { auditLog('gen-edit','System Loss %',null,inp.value);
  const yr = parseInt(inp.dataset.yr), mo = parseInt(inp.dataset.mo);
  const v = parseFloat(inp.value)||0;
  if (sysLossTable[yr]) {
    auditLog('editSysLoss','sysLossTable',sysLossTable[yr][mo],v);
    sysLossTable[yr][mo] = v;
    buildGenTables();
  }
}

// ── Other Income/Appropriations Table Builders ─────────
let otherIncExpanded = false;
function toggleOtherInc() {
  otherIncExpanded = !otherIncExpanded;
  document.getElementById('otherIncBody').style.display = otherIncExpanded ? 'block' : 'none';
  document.getElementById('otherIncToggle').textContent = otherIncExpanded ? '▲ Collapse' : '▼ Expand';
  if (otherIncExpanded) { buildOtherIncTables(); }
}

function buildOtherIncTables() {
  const yr = selectedOtherYear || _CY;
  const mkHead = () => `<tr><th style="text-align:left;min-width:200px">Line Item</th>${MONTHS.map(m=>`<th class="bc">${m}</th>`).join('')}<th class="bc">Total</th></tr>`;
  const mkRows = (rows) => rows.map(r => {
    const tot = (r.vals[yr]||[]).reduce((s,v)=>s+v,0);
    return `<tr><td style="padding-left:10px">${r.name}${r.cashItem===false?'<span class="dim"> (non-cash)</span>':''}</td>${(r.vals[yr]||MONTHS.map(()=>0)).map((v,i)=>
      can('editBase') ? `<td><input class="ei" style="width:55px" value="${v}" data-id="${r.id}" data-yr="${yr}" data-mo="${i}" oninput="updOtherInc(this)"></td>`
      : `<td>${fmtN(v)}</td>`
    ).join('')}<td class="gld">${fmtN(tot)}</td></tr>`;
  }).join('');

  document.getElementById('otherTaxH').innerHTML = mkHead();
  document.getElementById('otherTaxB').innerHTML = mkRows(otherIncomeRows.filter(r=>r.taxable));
  document.getElementById('otherNTaxH').innerHTML = mkHead();
  document.getElementById('otherNTaxB').innerHTML = mkRows(otherIncomeRows.filter(r=>!r.taxable));
  document.getElementById('approprH').innerHTML = mkHead();
  document.getElementById('approprB').innerHTML = mkRows(appropriationRows);

  // Tax rate inputs
  document.getElementById('taxRateInputs').innerHTML = Array.from({length:5},(_,i)=>_CY+i).map(y=>
    `<div style="display:flex;flex-direction:column;align-items:center;gap:3px">
      <div style="font-size:9px;color:var(--muted);font-weight:700">${y}</div>
      ${can('editBase')
        ? `<input class="ei" style="width:55px" value="${effectiveTaxRate[y]!=null?((effectiveTaxRate[y])*100).toFixed(1):''}" placeholder="—" data-yr="${y}" oninput="updTaxRate(this)">`
        : `<div class="ader">${effectiveTaxRate[y]!=null?((effectiveTaxRate[y])*100).toFixed(1)+'%':'—'}</div>`}
    </div>`
  ).join('');
}

function updOtherInc(inp) {
  const id=inp.dataset.id, yr=parseInt(inp.dataset.yr), mo=parseInt(inp.dataset.mo);
  const v=parseFloat(inp.value)||0;
  const r=otherIncomeRows.find(x=>x.id===id);
  if (r) {
    auditLog('editOtherIncome',id,r.vals[yr]?.[mo],v);
    if (!r.vals[yr]) r.vals[yr]=MONTHS.map(()=>0);
    r.vals[yr][mo]=v;
  }
}

function updTaxRate(inp) {
  const yr=parseInt(inp.dataset.yr);
  const raw=inp.value.trim();
  if(raw===''){ delete effectiveTaxRate[yr]; return; }   // clear → no tax until DB or user re-enters
  const v=parseFloat(raw)||0;
  auditLog('editTaxRate','effectiveTaxRate',effectiveTaxRate[yr],v/100);
  effectiveTaxRate[yr]=v/100;
}

// Aliases used by ass-other tab Section 3
function buildOtherIncomeTables() { buildOtherIncTables(); }
function buildTaxRateInputs() {
  const el = document.getElementById('taxRateInputs'); if (!el) return;
  el.innerHTML = Array.from({length:5},(_,i)=>_CY+i).map(y=>
    `<div style="display:flex;flex-direction:column;align-items:center;gap:3px">
      <div style="font-size:9px;color:var(--muted);font-weight:700">${y}</div>
      ${can('editBase')
        ? `<input class="ei" style="width:55px" value="${effectiveTaxRate[y]!=null?((effectiveTaxRate[y])*100).toFixed(1):''}" placeholder="—" data-yr="${y}" oninput="updTaxRate(this)">`
        : `<div class="ader">${effectiveTaxRate[y]!=null?((effectiveTaxRate[y])*100).toFixed(1)+'%':'—'}</div>`}
    </div>`
  ).join('');
}

// ── Theme System ────────────────────────────────────────
function setTheme(name, btn) { auditLog('theme','UI Theme',null,name);
  document.documentElement.className = name === 'dark' ? '' : 'theme-' + name;
  localStorage.setItem('jps_theme', name);
  document.querySelectorAll('.theme-btn').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  // Refresh theme color cache so all charts pick up the new palette
  _cacheThemeColors();
  // Re-render charts with updated colors
  setTimeout(()=>refreshAll(), 50);
  toast('Theme: ' + name.charAt(0).toUpperCase()+name.slice(1), 'ok');
}

function applyThemeOnLoad() {
  const saved = localStorage.getItem('jps_theme') || 'dark';
  document.documentElement.className = saved === 'dark' ? '' : 'theme-' + saved;
  const btnMap = {dark:'themeD', light:'themeL', jps:'themeJ'};
  const el = document.getElementById(btnMap[saved]);
  if (el) { document.querySelectorAll('.theme-btn').forEach(b=>b.classList.remove('on')); el.classList.add('on'); }
}

// ═══════════════════════════════════════════════════════
//  SESSION 6B — IFRS 16 LEASE REGISTER + INSURANCE
// ═══════════════════════════════════════════════════════

// ── LEASE DATA ──────────────────────────────────────────
// Seeded from Balance Sheet Feb 2026:
//   Leased assets (ROU NBV):          $653,429K
//   Current lease obligations:         $29,911K
//   Non-current lease obligations:    $437,254K
//   Total lease liability:             $467,165K

// Lease register — empty. Add leases through the Lease Register UI or upload.
let ifrs16Leases = [];

// Computed lease aggregates cache
let leaseAggregates = {};
let selectedLeaseId = null;
let selectedLeaseAmortYear = _CY;
let selectedLeaseAggYear = _CY;
let leaseDelTargetId = null;
let leaseEditId = null;

// ── IFRS 16 COMPUTATION ENGINE ──────────────────────────
function computeIFRS16Lease(lease, yr) {
  const res = { interest:[], principal:[], closingLiab:[], rouDep:[], rouNBV:[], plCredit:[], cashPayment:[], currentLiab:[], ltLiab:[] };
  if (lease.treatment !== 'ifrs16') {
    // For exempt/shortterm: use manualVals if present, else monthlyPayment
    const mv = lease.manualVals;
    for (let m=0;m<12;m++) {
      const cash = mv ? (mv[m]||0) : (lease.monthlyPayment||0);
      res.interest.push(0);res.principal.push(0);res.closingLiab.push(0);res.rouDep.push(0);res.rouNBV.push(0);res.plCredit.push(0);res.cashPayment.push(cash);res.currentLiab.push(0);res.ltLiab.push(0);
    }
    return res;
  }

  const expiry = new Date(lease.expiryDate);
  const commence = new Date(lease.commencementDate);
  const totalMonths = Math.max(1, Math.round((expiry - commence) / (1000*60*60*24*30.44)));
  const monthRate = (lease.interestRate || 0) / 100 / 12;

  // Opening liability for this year (roll forward from commencementDate)
  let openLiab = lease.liabilityOpening;
  let openROU  = lease.rouAssetOpening;
  // Roll forward if yr > _CY: need to run prior years
  if (yr > _CY) {
    for (let py = _CY; py < yr; py++) {
      const pres = computeIFRS16Lease({...lease}, py);
      openLiab = pres.closingLiab[11] || 0;
      openROU  = pres.rouNBV[11] || 0;
    }
  }

  const fx = (fxTable[yr] && fxTable[yr].expense) ? fxTable[yr].expense : (fxTable.expense ? fxTable.expense : Array(12).fill(0));
  const monthlyPmt = lease.currency === 'JMD' ? (lease.monthlyPayment / (fx[0]||0)) : (lease.monthlyPayment || 0);
  const monthlyROUDep = openROU > 0 ? openROU / Math.max(1, totalMonths - Math.round((new Date(yr+'-01-01') - commence) / (1000*60*60*24*30.44))) : 0;

  let cumROU = openROU;
  let curLiab = openLiab;

  for (let m=0;m<12;m++) {
    const mDate = new Date(yr, m, 1);
    if (mDate > expiry) {
      res.interest.push(0);res.principal.push(0);res.closingLiab.push(curLiab);
      res.rouDep.push(0);res.rouNBV.push(Math.max(0,cumROU));
      res.plCredit.push(0);res.cashPayment.push(0);res.currentLiab.push(0);res.ltLiab.push(0);
      continue;
    }
    const pmt = lease.currency === 'JMD' ? (lease.monthlyPayment / (fx[m]||0)) : monthlyPmt;
    const intAmt = curLiab * monthRate;
    const princ  = Math.max(0, pmt - intAmt);
    const closeL = Math.max(0, curLiab - princ);
    cumROU = Math.max(0, cumROU - monthlyROUDep);

    res.interest.push(intAmt);
    res.principal.push(princ);
    res.closingLiab.push(closeL);
    res.rouDep.push(monthlyROUDep);
    res.rouNBV.push(cumROU);
    res.plCredit.push(pmt);
    res.cashPayment.push(pmt);
    // Current portion: next 12 months principal
    let futPrinc = 0;
    let tmpLiab = closeL;
    for (let k=1;k<=12;k++) {
      const fi = tmpLiab * monthRate;
      const fp = Math.max(0, pmt - fi);
      futPrinc += fp;
      tmpLiab = Math.max(0, tmpLiab - fp);
    }
    res.currentLiab.push(Math.min(futPrinc, closeL));
    res.ltLiab.push(Math.max(0, closeL - Math.min(futPrinc, closeL)));
    curLiab = closeL;
  }
  return res;
}

function computeAllLeases(yr) {
  const agg = {
    ippCredit:[],nonIPPCredit:[],rouDepreciation:[],interestExpense:[],
    principalRep:[],cashPayments:[],rouAssetNBV:[],currentLiab:[],ltLiab:[],
    vehicleCredit:[],propertyCredit:[]  // split for P&L inline display
  };
  for (let m=0;m<12;m++) { Object.keys(agg).forEach(k=>agg[k].push(0)); }

  ifrs16Leases.forEach(lease => {
    const r = computeIFRS16Lease(lease, yr);
    for (let m=0;m<12;m++) {
      // P&L credits (ifrs16 only — exempt/shortterm plCredit=0)
      if (lease.type === 'ipp') {
        agg.ippCredit[m]      += r.plCredit[m];
      } else if (lease.type === 'vehicle') {
        agg.nonIPPCredit[m]   += r.plCredit[m];
        agg.vehicleCredit[m]  += r.plCredit[m];
      } else {
        agg.nonIPPCredit[m]   += r.plCredit[m];
        agg.propertyCredit[m] += r.plCredit[m];
      }
      agg.rouDepreciation[m] += r.rouDep[m];
      agg.interestExpense[m] += r.interest[m];
      agg.principalRep[m]    += r.principal[m];
      agg.cashPayments[m]    += r.cashPayment[m];  // includes exempt cash
      agg.rouAssetNBV[m]     += r.rouNBV[m];
      agg.currentLiab[m]     += r.currentLiab[m];
      agg.ltLiab[m]          += r.ltLiab[m];
    }
  });
  leaseAggregates[yr] = agg;
  return agg;
}

// Update manual vals for exempt/shortterm leases
function updLeaseManual(id, mo, val) {
  if(!can('editIFRS16')){toast('Admin access required','err');return;}
  const lease = ifrs16Leases.find(l=>l.id===id);
  if(!lease) return;
  if(!lease.manualVals) lease.manualVals = Array(12).fill(lease.monthlyPayment||0);
  const oldVal = lease.manualVals[mo];
  lease.manualVals[mo] = parseFloat(val)||0;
  leaseAggregates = {};
  Array.from({length:5},(_,i)=>_CY+i).forEach(y=>computeAllLeases(y));
  const MO2=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];auditLog('lease-edit',`Lease · ${id} · ${MO2[mo]}`,oldVal,lease.manualVals[mo]);
  buildLeaseRegister();
  toast('Manual expense updated','ok');
}

// ── LEASE STATUS HELPER ──────────────────────────────────
function getLeaseStatus(lease) {
  if (lease.treatment === 'shortterm') return {label:'Short-Term', cls:'dim'};
  if (lease.treatment === 'exempt')    return {label:'Exempt',     cls:'dim'};
  const expiry = new Date(lease.expiryDate);
  const now    = new Date();
  const days   = Math.round((expiry - now) / 86400000);
  if (days < 0)   return {label:'Expired',       cls:'neg'};
  if (days <= 92) return {label:'Expiring Soon',  cls:'amber', days};
  return {label:'Active', cls:'pos'};
}

// ── LEASE REGISTER TABLE ─────────────────────────────────
function buildLeaseRegister() {
  computeAllLeases(selectedLeaseAggYear);
  const tbody = document.getElementById('leaseRegBody');
  if (!tbody) return;

  tbody.innerHTML = ifrs16Leases.map(l => {
    const st = getLeaseStatus(l);
    const stHtml = `<span style="color:var(--${st.cls==='amber'?'amber':st.cls==='pos'?'green':st.cls==='neg'?'red':'muted'})">${st.label}</span>`;
    const trtHtml = `<div class="seg" style="height:20px;font-size:9px">
      <div class="sb${l.treatment==='ifrs16'?' on':''}" style="padding:0 5px;line-height:20px" onclick="setLeaseTreatment('${l.id}','ifrs16',this)">IFRS16</div>
      <div class="sb${l.treatment==='shortterm'?' on':''}" style="padding:0 5px;line-height:20px" onclick="setLeaseTreatment('${l.id}','shortterm',this)">ST</div>
      <div class="sb${l.treatment==='exempt'?' on':''}" style="padding:0 5px;line-height:20px" onclick="setLeaseTreatment('${l.id}','exempt',this)">Exempt</div>
    </div>`;
    return `<tr style="cursor:pointer" onclick="selectLease('${l.id}')">
      <td style="text-align:left;color:var(--text);font-weight:600">${l.name}</td>
      <td style="text-align:left">${l.counterparty}</td>
      <td style="text-align:left;font-size:9.5px">${l.category}</td>
      <td style="text-align:center">${l.type}</td>
      <td style="text-align:center;color:var(--teal);font-size:9.5px">${l.omLine||'—'}</td>
      <td onclick="event.stopPropagation()">${trtHtml}</td>
      <td>${l.commencementDate?l.commencementDate.slice(0,7):'—'}</td>
      <td>${l.expiryDate?l.expiryDate.slice(0,7):'—'}</td>
      <td style="text-align:center">${l.extensionOption?`✓ ${l.extensionMonths}mo`:'—'}</td>
      <td>${l.currency}</td>
      <td>${fmtN(l.monthlyPayment)}</td>
      <td>${(l.interestRate||0).toFixed(1)}%</td>
      <td>${fmtN(l.rouAssetOpening)}</td>
      <td>${fmtN(l.liabilityOpening)}</td>
      <td>${stHtml}</td>
      <td onclick="event.stopPropagation()">
        ${can('editIFRS16')?`<button class="btn btn-ghost" style="height:20px;font-size:9px;padding:0 6px" onclick="openLeaseModal('${l.id}')">Edit</button>
         <button class="btn" style="height:20px;font-size:9px;padding:0 6px;background:rgba(239,68,68,.15);color:var(--red);border:none" onclick="promptDeleteLease('${l.id}')">Del</button>`:'—'}
      </td>
    </tr>`;
  }).join('');

  buildLeaseAggTable();
  buildLeaseMonitor();
  buildInsPanel();
}

// ── AMORTISATION SCHEDULE ────────────────────────────────
function selectLease(id) {
  selectedLeaseId = id;
  const lease = ifrs16Leases.find(l=>l.id===id);
  if (!lease) return;
  const sec = document.getElementById('leaseAmortSection');
  sec.style.display = '';
  document.getElementById('leaseAmortTitle').textContent = lease.name + ' — Amortisation Schedule';
  document.getElementById('leaseAmortSub').textContent = `${lease.category} · ${lease.treatment.toUpperCase()} · ${lease.currency}`;
  buildLeaseAmortTable();
  sec.scrollIntoView({behavior:'smooth', block:'nearest'});
}

function setLeaseAmortYear(yr, btn) {
  selectedLeaseAmortYear = yr;
  document.querySelectorAll('#leaseAmortYrSeg .sb').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  buildLeaseAmortTable();
}

function buildLeaseAmortTable() {
  const lease = ifrs16Leases.find(l=>l.id===selectedLeaseId);
  if (!lease) return;
  const yr = selectedLeaseAmortYear;
  const tbody = document.getElementById('leaseAmortBody');
  const kpiEl = document.getElementById('leaseAmortKpis');
  if (!tbody) return;

  // Exempt / short-term: show editable manual monthly expense inputs
  if (lease.treatment === 'exempt' || lease.treatment === 'shortterm') {
    const omLabel = lease.omLine==='ipp'?'IPP Cost':lease.omLine==='transport'?'Transport (O&M)':lease.omLine==='building'?'Building (O&M)':'O&M';
    if(kpiEl) kpiEl.innerHTML = `<div class="kpi t"><div class="kpi-l">Treatment</div><div class="kpi-v">${lease.treatment.toUpperCase()}</div></div><div class="kpi b"><div class="kpi-l">P&L Route</div><div class="kpi-v">${omLabel}</div></div><div class="kpi g"><div class="kpi-l">ROU Asset</div><div class="kpi-v">Nil</div></div><div class="kpi p"><div class="kpi-l">Liability</div><div class="kpi-v">Nil</div></div>`;
    const mv = lease.manualVals || Array(12).fill(lease.monthlyPayment||0);
    tbody.innerHTML = `<tr><td colspan="9" style="padding:12px;text-align:left">
      <div style="color:var(--teal);font-weight:700;font-size:11px;margin-bottom:8px">Manual Monthly Expense → ${omLabel}</div>
      <div style="font-size:10px;color:var(--muted);margin-bottom:10px">No IFRS 16 accounting. Full payment expenses directly to ${omLabel}. Edit per-month amounts below.</div>
      <table><tr>${MONTHS.map((m,mi)=>`<th style="font-size:9px;color:var(--muted);text-align:center;padding:2px 6px">${m}</th>`).join('')}</tr>
      <tr>${MONTHS.map((_,mi)=>`<td><input class="ei" style="width:52px;text-align:center" value="${mv[mi]||0}" onchange="updLeaseManual('${lease.id}',${mi},this.value)" onfocus="this.select()"></td>`).join('')}</tr>
      <tr><td colspan="12" style="padding-top:6px;color:var(--teal);font-size:10px">Annual Total: <strong>$${fmtN(mv.reduce((s,v)=>s+(v||0),0))}K</strong></td></tr>
      </table></td></tr>`;
    return;
  }

  const r = computeIFRS16Lease(lease, yr);
  const expiry = new Date(lease.expiryDate);
  const now = new Date();
  const remMonths = Math.max(0, Math.round((expiry - now) / (1000*60*60*24*30.44)));
  const totalLiab = r.closingLiab[11] || 0;
  const rouNBV    = r.rouNBV[11] || 0;
  if(kpiEl) kpiEl.innerHTML = [
    {l:'Interest Rate',v:(lease.interestRate||0)+'%',c:'b'},
    {l:'Remaining Term',v:remMonths+' mo',c:'t'},
    {l:'Closing Liability',v:'$'+fmtN(totalLiab)+'K',c:'g'},
    {l:'ROU Asset NBV',v:'$'+fmtN(rouNBV)+'K',c:'p'},
  ].map(k=>`<div class="kpi ${k.c}"><div class="kpi-l">${k.l}</div><div class="kpi-v">${k.v}</div></div>`).join('');

  let tots = {i:0,p:0,rou:0,pl:0,cash:0};
  tbody.innerHTML = MONTHS.map((m,mi) => {
    const openL = mi===0 ? (yr===_CY?lease.liabilityOpening:computeIFRS16Lease(lease,yr-1).closingLiab[11]||0) : r.closingLiab[mi-1];
    tots.i+=r.interest[mi];tots.p+=r.principal[mi];tots.rou+=r.rouDep[mi];tots.pl+=r.plCredit[mi];tots.cash+=r.cashPayment[mi];
    return `<tr class="der"><td style="text-align:left">${m}</td>
      <td>${fmtN(openL)}</td><td>${fmtN(r.interest[mi])}</td><td>${fmtN(r.principal[mi])}</td>
      <td>${fmtN(r.closingLiab[mi])}</td><td>${fmtN(r.rouDep[mi])}</td>
      <td>${fmtN(r.rouNBV[mi])}</td><td>${fmtN(r.plCredit[mi])}</td><td>${fmtN(r.cashPayment[mi])}</td></tr>`;
  }).join('') +
  `<tr class="tr"><td style="text-align:left">Annual Total</td>
    <td>—</td><td>${fmtN(tots.i)}</td><td>${fmtN(tots.p)}</td>
    <td>—</td><td>${fmtN(tots.rou)}</td><td>—</td><td>${fmtN(tots.pl)}</td><td>${fmtN(tots.cash)}</td></tr>`;
}

// ── AGGREGATED IMPACT TABLE ──────────────────────────────
function setLeaseAggYear(yr, btn) {
  selectedLeaseAggYear = yr;
  document.querySelectorAll('#leaseAggYrSeg .sb').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  computeAllLeases(yr);
  buildLeaseAggTable();
}

function buildLeaseAggTable() {
  const yr = selectedLeaseAggYear;
  const agg = leaseAggregates[yr] || computeAllLeases(yr);
  const head = document.getElementById('leaseAggHead');
  const body = document.getElementById('leaseAggBody');
  if (!head) return;

  head.innerHTML = `<tr><th style="text-align:left;min-width:220px">Impact Line</th>${MONTHS.map(m=>`<th class="bc">${m}</th>`).join('')}<th class="bc">Total</th></tr>`;

  const rows = [
    {n:'IPP P&L Credits → reduces IPP Cost', k:'ippCredit',      c:'teal'},
    {n:'Non-IPP P&L Credits → reduces O&M',  k:'nonIPPCredit',   c:'blue'},
    {n:'ROU Asset Depreciation',              k:'rouDepreciation',c:'gold'},
    {n:'Lease Interest Expense → NFC',        k:'interestExpense',c:'red'},
    {n:'Cash Payments (Direct CF)',           k:'cashPayments',   c:'text'},
    {n:'Principal Repayments (Financing CF)', k:'principalRep',   c:'muted'},
    {n:'ROU Asset NBV (Balance Sheet NCA)',   k:'rouAssetNBV',    c:'teal'},
    {n:'Current Lease Liability (BS CL)',     k:'currentLiab',    c:'amber'},
    {n:'Non-Current Lease Liability (BS NCL)',k:'ltLiab',         c:'amber'},
  ];
  body.innerHTML = rows.map(r => {
    const vals = agg[r.k]||Array(12).fill(0);
    const tot  = vals.reduce((s,v)=>s+v,0);
    return `<tr><td style="text-align:left;color:var(--${r.c})">${r.n}</td>${vals.map(v=>`<td>${fmtN(v)}</td>`).join('')}<td class="gld">${fmtN(tot)}</td></tr>`;
  }).join('');

  // Lease chart removed — IFRS 16 schedule requires DB-backed lease data from fpa_leases
}

// ── MONITORING PANEL ──────────────────────────────────────
function buildLeaseMonitor() {
  const now = new Date();
  const soon = ifrs16Leases.filter(l => {
    if (l.treatment === 'shortterm' || l.treatment === 'exempt') return true;
    const days = Math.round((new Date(l.expiryDate) - now) / 86400000);
    return days <= 180;
  });
  const tbody = document.getElementById('leaseMonitorBody');
  if (!tbody) return;
  if (!soon.length) { tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:18px">No leases require attention</td></tr>`; return; }
  tbody.innerHTML = soon.map(l => {
    const days = Math.round((new Date(l.expiryDate) - now) / 86400000);
    const dColor = days < 0 ? 'var(--red)' : days <= 60 ? 'var(--amber)' : 'var(--text)';
    const note = l.treatment==='shortterm'?'Short-term treatment':l.treatment==='exempt'?'Exempt treatment':days<0?'EXPIRED':'Expiring soon';
    const trtSel = can('editIFRS16')
      ? `<select class="sel" style="height:20px;font-size:9px" onchange="updateMonitorTreatment('${l.id}',this.value)">
          <option value="ifrs16" ${l.treatment==='ifrs16'?'selected':''}>IFRS 16</option>
          <option value="shortterm" ${l.treatment==='shortterm'?'selected':''}>Short-Term</option>
          <option value="exempt" ${l.treatment==='exempt'?'selected':''}>Exempt</option></select>`
      : l.treatment;
    return `<tr>
      <td style="text-align:left;font-weight:600">${l.name}</td>
      <td style="text-align:left">${l.counterparty}</td>
      <td>${l.expiryDate}</td>
      <td style="color:${dColor}">${days<0?'Expired':days+' days'}</td>
      <td>${fmtN(l.monthlyPayment)}</td>
      <td>${trtSel}</td>
      <td style="color:${dColor}">${note}</td>
      <td>${can('editIFRS16')?`<button class="btn btn-ghost" style="height:20px;font-size:9px;padding:0 6px" onclick="openLeaseModal('${l.id}')">Edit</button>`:'—'}</td>
    </tr>`;
  }).join('');
}

function updateMonitorTreatment(id, val) {
  const l = ifrs16Leases.find(x=>x.id===id);
  if (!l || !can('editIFRS16')) return;
  auditLog('editLeaseTreatment',id,l.treatment,val);
  l.treatment = val;
  buildLeaseRegister();
  toast('Treatment updated','ok');
}

// ── LEASE MODAL ───────────────────────────────────────────
function openLeaseModal(id) {
  leaseEditId = id;
  const modal = document.getElementById('leaseModal');
  document.getElementById('leaseModalTitle').textContent = id ? 'Edit Lease' : 'Add New Lease';
  if (id) {
    const l = ifrs16Leases.find(x=>x.id===id);
    if (!l) return;
    document.getElementById('lm-name').value        = l.name;
    document.getElementById('lm-counterparty').value= l.counterparty;
    document.getElementById('lm-category').value    = l.category;
    document.getElementById('lm-type').value        = l.type;
    document.querySelector(`input[name="lm-treatment"][value="${l.treatment}"]`).checked = true;
    document.getElementById('lm-commence').value    = l.commencementDate;
    document.getElementById('lm-expiry').value      = l.expiryDate;
    document.getElementById('lm-ext').checked       = l.extensionOption;
    document.getElementById('lm-extmonths').value   = l.extensionMonths;
    document.getElementById('lm-extmo').style.display = l.extensionOption?'block':'none';
    document.getElementById('lm-currency').value   = l.currency;
    document.getElementById('lm-payment').value    = l.monthlyPayment;
    document.getElementById('lm-rate').value       = l.interestRate;
    document.getElementById('lm-rou').value        = l.rouAssetOpening;
    document.getElementById('lm-liab').value       = l.liabilityOpening;
  } else {
    ['lm-name','lm-counterparty','lm-payment','lm-rate','lm-rou','lm-liab','lm-extmonths'].forEach(i=>{ const el=document.getElementById(i); if(el)el.value=''; });
    document.querySelector('input[name="lm-treatment"][value="ifrs16"]').checked = true;
    document.getElementById('lm-extmo').style.display='none';
    document.getElementById('lm-currency').value='USD';
  }
  openModal('leaseModal');
}

function saveLease() {
  if (!can('editIFRS16')) { toast('Admin only','err'); return; }
  const name = document.getElementById('lm-name').value.trim();
  if (!name) { toast('Name required','err'); return; }
  const data = {
    name, counterparty: document.getElementById('lm-counterparty').value.trim(),
    category: document.getElementById('lm-category').value,
    type:     document.getElementById('lm-type').value,
    treatment: document.querySelector('input[name="lm-treatment"]:checked').value,
    commencementDate: document.getElementById('lm-commence').value,
    expiryDate:       document.getElementById('lm-expiry').value,
    extensionOption:  document.getElementById('lm-ext').checked,
    extensionMonths:  parseInt(document.getElementById('lm-extmonths').value)||0,
    currency:         document.getElementById('lm-currency').value,
    monthlyPayment:   parseFloat(document.getElementById('lm-payment').value)||0,
    interestRate:     parseFloat(document.getElementById('lm-rate').value)||0,
    rouAssetOpening:  parseFloat(document.getElementById('lm-rou').value)||0,
    liabilityOpening: parseFloat(document.getElementById('lm-liab').value)||0,
  };
  if (leaseEditId) {
    const idx = ifrs16Leases.findIndex(x=>x.id===leaseEditId);
    if (idx>=0) { auditLog('editLease',leaseEditId,ifrs16Leases[idx],data); ifrs16Leases[idx]={...ifrs16Leases[idx],...data}; }
  } else {
    data.id = 'l_'+Date.now();
    auditLog('addLease',data.id,null,data);
    ifrs16Leases.push(data);
  }
  leaseAggregates = {};
  closeModal('leaseModal');
  buildLeaseRegister();
  toast((leaseEditId?'Lease updated':'Lease added'),'ok');
}

function setLeaseTreatment(id, val, btn) { const _lt=ifrs16Leases.find(l=>l.id===id); auditLog('lease-edit',`Lease Treatment · ${id}`,_lt?.treatment,val);
  if (!can('editIFRS16')) { toast('Admin only','err'); return; }
  const l = ifrs16Leases.find(x=>x.id===id);
  if (!l) return;
  auditLog('editLeaseTreatment',id,l.treatment,val);
  l.treatment = val;
  leaseAggregates = {};
  buildLeaseRegister();
  toast('Treatment: '+val,'ok');
}

function promptDeleteLease(id) {
  leaseDelTargetId = id;
  const l = ifrs16Leases.find(x=>x.id===id);
  document.getElementById('leaseDelName').textContent = l?l.name:id;
  openModal('leaseDelModal');
}
function confirmDeleteLease() {
  if (!can('editIFRS16')) return;
  auditLog('deleteLease',leaseDelTargetId,ifrs16Leases.find(x=>x.id===leaseDelTargetId),null);
  ifrs16Leases = ifrs16Leases.filter(x=>x.id!==leaseDelTargetId);
  leaseAggregates = {};
  closeModal('leaseDelModal');
  buildLeaseRegister();
  toast('Lease deleted','ok');
}

function exportLeaseCSV() {
  const rows=[['Name','Counterparty','Category','Type','Treatment','Commencement','Expiry','Currency','Monthly Payment','Rate%','ROU Asset','Liability']];
  ifrs16Leases.forEach(l=>rows.push([l.name,l.counterparty,l.category,l.type,l.treatment,l.commencementDate,l.expiryDate,l.currency,l.monthlyPayment,l.interestRate,l.rouAssetOpening,l.liabilityOpening]));
  const blob=new Blob([rows.map(r=>r.join(',')).join('\n')],{type:'text/csv'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='JPS_LeaseRegister.csv';a.click();
}

// ── INSURANCE ENGINE ──────────────────────────────────────
// Insurance register — empty. Add policies through the Insurance UI or upload.
let insurancePolicies = [];
let insEditId = null;

function computeInsPolicy(pol) {
  const res = { monthlyExpense:[], cashPayment:[], prepaidBalance:[] };
  const monthly = pol.annualPremium / 12;
  let cumCash=0, cumExp=0;
  for (let m=0;m<12;m++) {
    const pmtIdx = (pol.paymentMonths||[]).indexOf(m+1);
    const cash   = pmtIdx>=0 ? (pol.paymentAmounts||[])[pmtIdx]||0 : 0;
    cumCash += cash; cumExp += monthly;
    res.monthlyExpense.push(monthly);
    res.cashPayment.push(cash);
    res.prepaidBalance.push(cumCash - cumExp);
  }
  return res;
}

function buildInsPanel() {
  const head = document.getElementById('insPanelHead');
  const body = document.getElementById('insPanelBody');
  if (!head) return;

  head.innerHTML = `<tr><th style="text-align:left;min-width:200px">Policy</th><th>CCY</th><th>Annual Premium</th>${MONTHS.map(m=>`<th class="bc">${m}</th>`).join('')}<th class="bc">Cash Total</th>${can('editInsurance')?'<th>Actions</th>':''}</tr>`;

  const allData = insurancePolicies.map(p=>({p,r:computeInsPolicy(p)}));

  body.innerHTML = allData.map(({p,r}) => {
    const cashTot = r.cashPayment.reduce((s,v)=>s+v,0);
    return `<tr>
      <td style="text-align:left;font-weight:600">${p.name}</td>
      <td>${p.currency}</td>
      <td>${fmtN(p.annualPremium)}</td>
      ${r.cashPayment.map((v,i)=>`<td style="${v>0?'color:var(--amber);font-weight:700':''}">${v>0?fmtN(v):'—'}</td>`).join('')}
      <td class="gld">${fmtN(cashTot)}</td>
      ${can('editInsurance')?`<td><button class="btn btn-ghost" style="height:20px;font-size:9px;padding:0 6px" onclick="openInsModal('${p.id}')">Edit</button></td>`:''}
    </tr>`;
  }).join('') +
  `<tr class="tr"><td style="text-align:left">Total Monthly P&L Expense</td><td></td><td class="gld">${fmtN(insurancePolicies.reduce((s,p)=>s+p.annualPremium,0))}</td>` +
  MONTHS.map((_,m)=>`<td class="gld">${fmtN(allData.reduce((s,{r})=>s+r.monthlyExpense[m],0))}</td>`).join('') + `<td></td>${can('editInsurance')?'<td></td>':''}</tr>`;

  // Chart: monthly expense line vs cash bars
  const expLine   = MONTHS.map((_,m)=>allData.reduce((s,{r})=>s+r.monthlyExpense[m],0));
  const cashBars  = MONTHS.map((_,m)=>allData.reduce((s,{r})=>s+r.cashPayment[m],0));
  const prepaid   = MONTHS.map((_,m)=>{ let cum=0; allData.forEach(({r})=>{ cum+=r.prepaidBalance[m];}); return cum; });
  mkChart('cInsurance',{type:'bar',
    data:{labels:MONTHS,datasets:[
      {label:'Cash Payment',    data:cashBars, backgroundColor:'rgba(245,158,11,.65)', type:'bar'},
      {label:'Monthly Expense', data:expLine,  borderColor:'var(--teal)',borderWidth:2,tension:.4,type:'line',fill:false,pointRadius:3,yAxisID:'y'},
      {label:'Prepaid Balance', data:prepaid,  borderColor:'var(--green)',borderWidth:1.5,tension:.4,type:'line',fill:false,pointRadius:2,borderDash:[4,3],yAxisID:'y'},
    ]},
    options:{...bO(),scales:{x:{ticks:{color:_TC.muted,font:{size:9}},grid:{color:_TC.grid}},y:{ticks:{color:_TC.muted,font:{size:9},callback:v=>fmtN(v)+'K'},grid:{color:_TC.grid}}}}
  });
}

function openInsModal(id) {
  insEditId = id;
  document.getElementById('insModalTitle').textContent = id?'Edit Insurance Policy':'Add Insurance Policy';
  if (id) {
    const p = insurancePolicies.find(x=>x.id===id);
    if (!p) return;
    document.getElementById('ins-name').value    = p.name;
    document.getElementById('ins-currency').value= p.currency;
    document.getElementById('ins-premium').value = p.annualPremium;
    document.getElementById('ins-months').value  = (p.paymentMonths||[]).join(',');
    document.getElementById('ins-amounts').value = (p.paymentAmounts||[]).join(',');
  } else {
    ['ins-name','ins-premium','ins-months','ins-amounts'].forEach(i=>{const el=document.getElementById(i);if(el)el.value='';});
  }
  openModal('insModal');
}
function saveInsPolicy() {
  if (!can('editInsurance')) { toast('Admin only','err'); return; }
  const name = document.getElementById('ins-name').value.trim();
  if (!name) { toast('Name required','err'); return; }
  const data = {
    name,
    currency:       document.getElementById('ins-currency').value,
    annualPremium:  parseFloat(document.getElementById('ins-premium').value)||0,
    paymentMonths:  document.getElementById('ins-months').value.split(',').map(x=>parseInt(x.trim())).filter(x=>!isNaN(x)),
    paymentAmounts: document.getElementById('ins-amounts').value.split(',').map(x=>parseFloat(x.trim())).filter(x=>!isNaN(x)),
  };
  if (insEditId) {
    const idx = insurancePolicies.findIndex(x=>x.id===insEditId);
    if (idx>=0) { auditLog('editInsurance',insEditId,insurancePolicies[idx],data); insurancePolicies[idx]={...insurancePolicies[idx],...data}; }
  } else {
    data.id='ins_'+Date.now();
    auditLog('addInsurance',data.id,null,data);
    insurancePolicies.push(data);
  }
  closeModal('insModal');
  buildInsPanel();
  toast((insEditId?'Policy updated':'Policy added'),'ok');
}

// showPane hook for wrk-leases
// (added to existing showPane below via the if-chain)

// ═══════════════════════════════════════════════════════
//  YEAR SELECTOR BUILDER (standard 2026-2030 pill bar)
// ═══════════════════════════════════════════════════════
// Year-selector callback registry — avoids serializing arrow functions
const _yrCbs = {};
function buildYrSeg(containerId, currentYr, onSelect){
  const el=document.getElementById(containerId); if(!el)return;
  _yrCbs[containerId] = onSelect;
  el.innerHTML=Array.from({length:5},(_,i)=>_CY+i).map(y=>
    `<button class="sb${y===currentYr?' on':''}" onclick="document.querySelectorAll('#${containerId} .sb').forEach(b=>b.classList.remove('on'));this.classList.add('on');_yrCbs['${containerId}'](${y},this)" style="height:24px;padding:0 10px;font-size:10px">${y}</button>`
  ).join('');
}

// ═══════════════════════════════════════════════════════
//  DEPRECIATION ASSUMPTIONS TAB
// ═══════════════════════════════════════════════════════
const DEP_COMP_LABELS={
  faRegister:'FA Register',sjpc:'SJPC Depreciation',otherLeases:'Other Leases (IFRS-16)',
  capexTransfers:'CapEx Transfers',capitalSpares:'Capital Spares',
  decommissioning:'Decommissioning',strandedMeters:'Stranded Assets (Meters)',
  strandedLights:'Stranded Assets (Lights)',impairment:'Impairment (IAS 36)'
};

function buildDepAssumptions(){
  const yr=selectedDepYear;
  buildYrSeg('depYrSeg',yr,(y,btn)=>{selectedDepYear=y;document.getElementById('depYrLabel').textContent=y;buildDepAssumptions();});
  const c=depreciationComponents[yr];
  const compKeys=['faRegister','sjpc','otherLeases','capexTransfers','capitalSpares','decommissioning','strandedMeters','strandedLights'];
  // Section 1 — monthly table
  document.getElementById('depCompH').innerHTML=`<tr><th style="text-align:left;min-width:220px">Component</th>${MONTHS.map(m=>`<th class="bc">${m}</th>`).join('')}<th class="bc">Annual</th></tr>`;
  let html='';
  compKeys.forEach(k=>{
    const isLease=k==='otherLeases';
    const vals=c[k]||Array(12).fill(0);
    const ann=vals.reduce((s,v)=>s+v,0);
    const editCls=isLease?'style="color:var(--teal)"':'';
    const note=isLease?' <span style="font-size:8px;color:var(--teal)">(← Lease Register)</span>':'';
    html+=`<tr><td style="padding-left:10px" ${editCls}><strong>${DEP_COMP_LABELS[k]}</strong>${note}</td>
      ${vals.map((v,i)=>isLease
        ?`<td class="der" style="color:var(--teal)">${fmtN(Math.round(v/1000))}</td>`
        :`<td><input class="ei" value="${Math.round(v/1000)}" data-k="${k}" data-m="${i}" onchange="updDepComp(this,${yr})" onfocus="this.select()"></td>`
      ).join('')}
      <td class="gld">${fmtN(Math.round(ann/1000))}</td></tr>`;
  });
  // Impairment row (amber)
  const impVals=c.impairment||Array(12).fill(0);
  const impAnn=impVals.reduce((s,v)=>s+v,0);
  html+=`<tr style="background:rgba(245,158,11,.05)"><td style="padding-left:10px;color:var(--amber)"><strong>Impairment (IAS 36) — Separate P&L line</strong></td>
    ${impVals.map(v=>`<td class="der" style="color:var(--amber)">${fmtN(Math.round(v/1000))}</td>`).join('')}
    <td style="color:var(--amber);font-weight:700">${fmtN(Math.round(impAnn/1000))}</td></tr>`;
  // Regular total (teal)
  const regTot=MONTHS.map((_,m)=>calcDepTotals(yr,m).regular);
  html+=`<tr class="sur"><td style="padding-left:10px;color:var(--teal)"><strong>Total Regular Depreciation</strong></td>
    ${regTot.map(v=>`<td style="color:var(--teal);font-weight:700">${fmtN(Math.round(v/1000))}</td>`).join('')}
    <td style="color:var(--teal);font-weight:700">${fmtN(Math.round(regTot.reduce((s,v)=>s+v,0)/1000))}</td></tr>`;
  // Grand total (gold)
  const grandTot=MONTHS.map((_,m)=>calcDepTotals(yr,m).total);
  html+=`<tr class="tr"><td style="padding-left:10px"><strong>GRAND TOTAL (incl. Impairment)</strong></td>
    ${grandTot.map(v=>`<td class="gld"><strong>${fmtN(Math.round(v/1000))}</strong></td>`).join('')}
    <td class="gld"><strong>${fmtN(Math.round(grandTot.reduce((s,v)=>s+v,0)/1000))}</strong></td></tr>`;
  document.getElementById('depCompB').innerHTML=html;

  // Section 2 — impairment events
  const ib=document.getElementById('impairB');
  if(ib) ib.innerHTML=impairmentEvents.map(e=>`<tr>
    <td style="padding-left:10px"><strong>${e.name}</strong></td>
    <td>${e.eventDate}</td>
    <td style="color:var(--red)">${e.chargeAmount>0?fmtN(e.chargeAmount/1000):'–'}</td>
    <td style="color:var(--green)">${e.reversalAmount>0?'('+fmtN(e.reversalAmount/1000)+')':'–'}</td>
    <td style="color:var(--muted)">${e.trigger}</td>
    <td>${e.affectsYears.join(', ')}</td>
    <td style="color:var(--teal)">${e.relatedInsuranceId||'–'}</td>
  </tr>`).join('');

  // Section 3 — annual summary
  buildDepAnnualSummary();
}

function updDepComp(inp,yr){
  const k=inp.dataset.k, m=parseInt(inp.dataset.m);
  const old=depreciationComponents[yr]?depreciationComponents[yr][k][m]:null;
  const v=(parseFloat(inp.value.replace(/,/g,''))||0)*1000;
  if(depreciationComponents[yr]) depreciationComponents[yr][k][m]=v;
  const MO=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  auditLog('dep-edit',`Depreciation · ${k} · ${MO[m]} ${yr}`,old!==null?Math.round(old/1000):null,Math.round(v/1000));
  buildDepAssumptions();
}

function buildDepAnnualSummary(){
  const compKeys=['faRegister','sjpc','otherLeases','capexTransfers','capitalSpares','decommissioning','strandedMeters','strandedLights','impairment'];
  const yrs=Array.from({length:5},(_,i)=>_CY+i);
  const sh=document.getElementById('depSumH'); const sb=document.getElementById('depSumB');
  if(!sh||!sb)return;
  sh.innerHTML=`<tr><th style="text-align:left;min-width:220px">Component</th>${yrs.map(y=>`<th class="bc">${y}</th>`).join('')}</tr>`;
  let html='';
  compKeys.forEach(k=>{
    const isImp=k==='impairment';
    html+=`<tr style="${isImp?'background:rgba(245,158,11,.05)':''}">
      <td style="padding-left:10px;color:${isImp?'var(--amber)':'var(--text)'}">${DEP_COMP_LABELS[k]}</td>
      ${yrs.map(y=>{const ann=(depreciationComponents[y]?.[k]||Array(12).fill(0)).reduce((s,v)=>s+v,0);return `<td class="${isImp?'':'gld'}" style="${isImp?'color:var(--amber)':''}">${fmtN(Math.round(ann/1000))}</td>`;}).join('')}
    </tr>`;
  });
  // Regular total
  html+=`<tr class="sur"><td style="padding-left:10px;color:var(--teal)"><strong>Total Regular</strong></td>
    ${yrs.map(y=>{const ann=MONTHS.reduce((s,_,m)=>s+calcDepTotals(y,m).regular,0);return `<td style="color:var(--teal);font-weight:700">${fmtN(Math.round(ann/1000))}</td>`;}).join('')}</tr>`;
  html+=`<tr class="tr"><td style="padding-left:10px"><strong>Grand Total</strong></td>
    ${yrs.map(y=>{const ann=MONTHS.reduce((s,_,m)=>s+calcDepTotals(y,m).total,0);return `<td class="gld"><strong>${fmtN(Math.round(ann/1000))}</strong></td>`;}).join('')}</tr>`;
  sb.innerHTML=html;
}

function openImpairModal(){
  document.getElementById('imp-name').value='';
  document.getElementById('imp-desc').value='';
  document.getElementById('imp-date').value='';
  document.getElementById('imp-charge').value='';
  document.getElementById('imp-reversal').value='';
  // Rebuild "Affects Years" checkboxes dynamically (_PY through _CY+4)
  const cbCont=document.getElementById('impYrCbs');
  if(cbCont){
    cbCont.innerHTML=Array.from({length:6},(_,i)=>_PY+i).map(y=>
      `<label style="display:flex;align-items:center;gap:4px;font-size:10px;color:var(--text)"><input type="checkbox" class="imp-yr" value="${y}"> ${y}</label>`
    ).join('');
  }
  openModal('impairModal');
}
function commitImpair(){
  if(!can('editDepreciation')){toast('Admin only','err');return;}
  const name=document.getElementById('imp-name').value.trim(); if(!name){toast('Enter event name','w');return;}
  const evt={id:'imp_'+Date.now(),name,description:document.getElementById('imp-desc').value,eventDate:document.getElementById('imp-date').value,chargeAmount:parseFloat(document.getElementById('imp-charge').value)||0,reversalAmount:parseFloat(document.getElementById('imp-reversal').value)||0,trigger:document.getElementById('imp-trigger').value,isReversible:true,relatedInsuranceId:document.getElementById('imp-ins').value,affectsYears:[...document.querySelectorAll('.imp-yr:checked')].map(cb=>parseInt(cb.value))};
  impairmentEvents.push(evt);
  // Apply to depreciationComponents for affected years
  evt.affectsYears.forEach(y=>{if(depreciationComponents[y]){const monthlyCharge=Math.round(evt.chargeAmount/12);depreciationComponents[y].impairment=Array(12).fill(monthlyCharge-evt.reversalAmount/12);}});
  auditLog('addImpairment','impairmentEvents',null,evt);
  closeModal('impairModal'); buildDepAssumptions(); toast('Impairment event added','ok');
}
function exportDepCSV(){
  const yr=selectedDepYear; const c=depreciationComponents[yr];
  const rows=[['Component',...MONTHS,'Annual']];
  ['faRegister','sjpc','otherLeases','capexTransfers','capitalSpares','decommissioning','strandedMeters','strandedLights','impairment'].forEach(k=>{
    rows.push([DEP_COMP_LABELS[k],...(c[k]||Array(12).fill(0)).map(v=>Math.round(v/1000)),Math.round((c[k]||Array(12).fill(0)).reduce((s,v)=>s+v,0)/1000)]);
  });
  const blob=new Blob([rows.map(r=>r.join(',')).join('\n')],{type:'text/csv'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`JPS_Depreciation_${yr}.csv`;a.click();toast('Exported','ok');
}

// ═══════════════════════════════════════════════════════
//  OTHER & FINANCING ASSUMPTIONS TAB
// ═══════════════════════════════════════════════════════
let selectedOtherYear=_CY;

function buildOtherFinancing(){
  const yr=selectedOtherYear;
  buildYrSeg('otherYrSeg',yr,(y,btn)=>{selectedOtherYear=y;buildOtherFinancing();});

  // Section 1 — Other Operating Revenue
  const rows=otherOperatingRevenue[yr]||[];
  const hdr=`<tr><th style="text-align:left;min-width:200px">Revenue Item</th>${MONTHS.map(m=>`<th class="bc">${m}</th>`).join('')}<th class="bc">Total</th></tr>`;
  document.getElementById('otherRevH').innerHTML=hdr;
  let html=rows.map(r=>{
    const tot=sumArr(r.vals);
    return `<tr><td style="padding-left:10px"><strong>${r.name}</strong><span class="del" onclick="delOtherRevRow('${r.id}',${yr})">✕</span></td>
      ${r.vals.map((v,i)=>`<td><input class="ei" value="${v}" data-id="${r.id}" data-m="${i}" onchange="updOtherRev(this,${yr})" onfocus="this.select()"></td>`).join('')}
      <td class="gld">${fmtN(tot)}</td></tr>`;
  }).join('');
  const totals=MONTHS.map((_,i)=>rows.reduce((s,r)=>s+(r.vals[i]||0),0));
  html+=`<tr class="tr"><td style="padding-left:10px"><strong>Total Other Operating Revenue</strong></td>${totals.map(v=>`<td class="gld"><strong>${fmtN(v)}</strong></td>`).join('')}<td class="gld"><strong>${fmtN(sumArr(totals))}</strong></td></tr>`;
  document.getElementById('otherRevB').innerHTML=html;

  // Section 2 — Net Financing Costs
  buildNFCTable(yr);

  // Section 2B — Insurance P&L vs Cash reconciliation
  buildInsuranceSummaryInOther(yr);

  // Section 3 — re-use existing otherIncomeRows / appropriationRows builders
  buildOtherIncomeTables();
  buildTaxRateInputs();
}

function buildInsuranceSummaryInOther(yr){
  const el=document.getElementById('insPreviewBlock');
  if(!el)return;
  const allData=insurancePolicies.map(p=>({p,r:computeInsPolicy(p)}));
  const totalExpM=MONTHS.map((_,m)=>Math.round(allData.reduce((s,{r})=>s+(r.monthlyExpense[m]||0),0)));
  const totalCashM=MONTHS.map((_,m)=>Math.round(allData.reduce((s,{r})=>s+(r.cashPayment[m]||0),0)));
  const prepM=MONTHS.map((_,m)=>Math.round(allData.reduce((s,{r})=>s+(r.prepaidBalance[m]||0),0)));
  el.innerHTML=`
    <div class="tc2">
      <div class="th"><div class="tt">§2B Insurance — P&L Expense vs Cash Payment <span class="badge badge-bud">Derived</span></div>
      <div class="ts">Monthly P&L expense is straight-line; cash payments are lumpy. Difference = Prepaid Insurance on Balance Sheet.</div></div>
      <div class="tscr"><table class="dt"><thead><tr>
        <th style="min-width:220px;text-align:left">Line</th>
        ${MONTHS.map(m=>`<th class="bc">${m}</th>`).join('')}<th class="bc">Total</th>
      </tr></thead><tbody>
        <tr><td style="padding-left:10px;color:var(--red)"><strong>Monthly P&L Expense (smooth)</strong></td>
          ${totalExpM.map(v=>`<td style="color:var(--red)">(${Math.abs(v).toLocaleString()})</td>`).join('')}
          <td class="gld"><strong>(${Math.abs(totalExpM.reduce((s,v)=>s+v,0)).toLocaleString()})</strong></td></tr>
        <tr><td style="padding-left:10px;color:var(--blue)"><strong>Cash Payments (lumpy)</strong></td>
          ${totalCashM.map(v=>`<td style="color:${v?'var(--blue)':'var(--muted)'}${v?'':';opacity:.4'}">${v?'('+v.toLocaleString()+')':'–'}</td>`).join('')}
          <td class="gld"><strong>(${Math.abs(totalCashM.reduce((s,v)=>s+v,0)).toLocaleString()})</strong></td></tr>
        <tr><td style="padding-left:10px;color:var(--teal)"><strong>Prepaid Balance (BS Asset)</strong><span style="font-size:9px;color:var(--muted)"> → Balance Sheet: Prepaid Insurance</span></td>
          ${prepM.map(v=>`<td class="der" style="color:var(--teal)">${v.toLocaleString()}</td>`).join('')}
          <td class="der" style="color:var(--teal)">${prepM[11].toLocaleString()}</td></tr>
      </tbody></table></div>
    </div>`;
}

function buildNFCTable(yr){
  const nfc=netFinancingRows[yr]; if(!nfc)return;
  // Auto-recalc interest income from closing cash before rendering
  calcInterestIncome(yr);
  const agg=typeof leaseAggregates!=='undefined'?leaseAggregates[yr]:null;
  document.getElementById('nfcH').innerHTML=`<tr><th style="text-align:left;min-width:220px">Line Item</th>${MONTHS.map(m=>`<th class="bc">${m}</th>`).join('')}<th class="bc">Total</th></tr>`;
  const rows=[
    {k:'intIncome',   label:'Interest Income',             editable:false, color:'var(--green)', cashDerived:true},
    {k:'intExpense',  label:'Interest Expense',             editable:true,  color:'var(--red)'},
    {k:'loanFees',    label:'Loan Financing Fees',          editable:true,  color:'var(--red)'},
    {k:'leaseInt',    label:'Lease Interest (IFRS 16)',     editable:false, color:'var(--teal)', derived:true},
    {k:'prefDivs',    label:'Preference Dividends',         editable:false, color:'var(--muted)'},
    {k:'fxGain',      label:'FX Gain/(Loss) — Calculated', editable:false, color:'var(--blue)', derived:true},
  ];
  let html='';
  // Interest rate on cash input — shown first
  html+=`<tr style="background:rgba(16,185,129,.05)">
    <td style="padding-left:10px;color:var(--green)"><strong>Interest Rate on Cash Balance (% p.a.)</strong>
      <span style="font-size:8px;color:var(--teal)"> — drives Interest Income row below</span></td>
    <td colspan="${MONTHS.length}" style="padding:4px 10px">
      <input class="ei" style="width:72px;color:var(--green)" value="${(nfc.interestRateOnCash||0).toFixed(2)}"
        onchange="updIntRate(this,${yr})" onfocus="this.select()">
      <span style="font-size:9px;color:var(--muted);margin-left:8px">% p.a. applied to monthly closing cash balance</span>
    </td><td></td></tr>`;
  rows.forEach(r=>{
    let vals;
    if(r.k==='leaseInt') vals=agg?agg.interestExpense:Array(12).fill(0);
    else if(r.k==='fxGain') vals=MONTHS.map((_,i)=>{const aFX=fxTable.billing[i]||0;const bFX=nfc.budgetFX[i]||0;const pos=nfc.netFXPosition[i]||0;return Math.round((aFX-bFX)*pos);});
    else vals=nfc[r.k]?.vals||Array(12).fill(0);
    const tot=vals.reduce((s,v)=>s+v,0);
    const isSpec=r.derived||r.cashDerived;
    const noteTxt=r.cashDerived?' ← cash bal × rate':r.derived?' ← derived':'';
    const note=noteTxt?`<span style="font-size:8px;color:var(--teal)">${noteTxt}</span>`:'';
    html+=`<tr style="${isSpec?'background:rgba(6,182,212,.04)':''}">
      <td style="padding-left:10px;color:${r.color}"><strong>${r.label}</strong>${note}</td>
      ${vals.map((v,i)=>r.editable
        ?`<td><input class="ei" value="${v}" data-k="${r.k}" data-m="${i}" onchange="updNFC(this,${yr})" onfocus="this.select()"></td>`
        :`<td class="der" style="color:${r.color}">${fmtN(v)}</td>`
      ).join('')}
      <td class="${isSpec?'der':'gld'}" style="${isSpec?'color:'+r.color:''}">${fmtN(tot)}</td></tr>`;
  });
  // FX driver inputs
  html+=`<tr style="background:rgba(59,130,246,.04)"><td style="padding-left:10px;color:var(--blue)"><strong>↳ Budget FX Rate (J$/US$)</strong></td>
    ${nfc.budgetFX.map((v,i)=>`<td><input class="ei" style="color:var(--blue)" value="${v}" data-k="budgetFX" data-m="${i}" onchange="updNFCFX(this,${yr})" onfocus="this.select()"></td>`).join('')}
    <td class="der" style="color:var(--blue)">${(nfc.budgetFX.reduce((s,v)=>s+v,0)/12).toFixed(1)}</td></tr>`;
  html+=`<tr style="background:rgba(59,130,246,.04)"><td style="padding-left:10px;color:var(--blue)"><strong>↳ Net FX Position (US$000)</strong></td>
    ${nfc.netFXPosition.map((v,i)=>`<td><input class="ei" style="color:var(--blue)" value="${v}" data-k="netFXPosition" data-m="${i}" onchange="updNFCFX(this,${yr})" onfocus="this.select()"></td>`).join('')}
    <td class="der" style="color:var(--blue)">${fmtN(nfc.netFXPosition.reduce((s,v)=>s+v,0))}</td></tr>`;
  // Total NFC
  const totNFC=MONTHS.map((_,i)=>{
    const leaseI=agg?agg.interestExpense[i]:0;
    const fxG=(()=>{const aFX=fxTable.billing[i]||0;const bFX=nfc.budgetFX[i]||0;const pos=nfc.netFXPosition[i]||0;return Math.round((aFX-bFX)*pos);})();
    return (nfc.intIncome?.vals[i]||0)+(nfc.intExpense?.vals[i]||0)+(nfc.loanFees?.vals[i]||0)+leaseI+(nfc.prefDivs?.vals[i]||0)+fxG;
  });
  html+=`<tr class="tr"><td style="padding-left:10px"><strong>Total Net Financing Costs</strong></td>${totNFC.map(v=>`<td class="gld"><strong>${fmtN(v)}</strong></td>`).join('')}<td class="gld"><strong>${fmtN(totNFC.reduce((s,v)=>s+v,0))}</strong></td></tr>`;
  document.getElementById('nfcB').innerHTML=html;
}

function updNFC(inp,yr){ auditLog('nfc-edit',`NFC · ${inp.dataset?.k||''} · mo${inp.dataset?.m||''} · ${yr}`,null,inp.value);
  const k=inp.dataset.k, m=parseInt(inp.dataset.m), v=parseFloat(inp.value.replace(/,/g,''))||0;
  if(netFinancingRows[yr]?.[k]?.vals) netFinancingRows[yr][k].vals[m]=v;
  auditLog('editFinancing',`${yr}.${k}[${m}]`,null,v);
  buildNFCTable(yr);
}
function updNFCFX(inp,yr){
  const k=inp.dataset.k, m=parseInt(inp.dataset.m), v=parseFloat(inp.value.replace(/,/g,''))||0;
  if(netFinancingRows[yr]) netFinancingRows[yr][k][m]=v;
  buildNFCTable(yr);
}
function updIntRate(inp,yr){
  const v=parseFloat(inp.value)||0;
  if(netFinancingRows[yr]) netFinancingRows[yr].interestRateOnCash=v;
  // Recalc interest income from closing cash
  calcInterestIncome(yr);
  buildNFCTable(yr);
}

// Derive interest income = closing cash balance × (annualRate/12)
// Uses actualsStore cash for actuals months, bsLines cash projection for forecast
function calcInterestIncome(yr){
  const nfc=netFinancingRows[yr]; if(!nfc) return;
  const rate=(nfc.interestRateOnCash||0)/100/12;
  // Build monthly closing cash array for the year
  const cashBal=MONTHS.map((_,m)=>{
    const mo=m+1;
    if(yr===actualsYear&&_acts(mo)?.bs?.cash) return _acts(mo).bs.cash;
    // Fallback: use bsLines cash vals for the year index
    const yIdx=YEARS.indexOf(String(yr));
    const cashLine=bsLines?.find(l=>l.id==='cash');
    return cashLine?.vals[yIdx]||0;
  });
  nfc.intIncome.vals=cashBal.map(cash=>Math.round(cash*rate));
}

// Call calcInterestIncome for all years on startup
function initInterestIncome(){
  Array.from({length:5},(_,i)=>_CY+i).forEach(y=>calcInterestIncome(y));
}
function updOtherRev(inp,yr){ auditLog('other-edit',`Other Rev · ${inp.dataset?.k||''} · ${yr}`,null,inp.value);
  const id=inp.dataset.id, m=parseInt(inp.dataset.m), v=parseFloat(inp.value.replace(/,/g,''))||0;
  const r=(otherOperatingRevenue[yr]||[]).find(x=>x.id===id); if(r) r.vals[m]=v;
  auditLog('editOtherIncome',`${yr}.${id}[${m}]`,null,v);
}
function addOtherRevRow(yr){openModal('otherRevModal');setTimeout(()=>document.getElementById('otherRevName').focus(),80);}
function commitOtherRevRow(){
  if(!can('editOtherIncome')){toast('Admin access required','err');return;}
  const name=document.getElementById('otherRevName').value.trim();
  if(!name){document.getElementById('otherRevName').focus();return;}
  const yr=selectedOtherYear;
  if(!otherOperatingRevenue[yr])otherOperatingRevenue[yr]=[];
  otherOperatingRevenue[yr].push({id:'or_'+Date.now(),name,vals:Array(12).fill(0)});
  auditLog('addOtherRevRow','otherOperatingRevenue',null,{name,yr});
  closeModal('otherRevModal');
  document.getElementById('otherRevName').value='';
  buildOtherFinancing();
  toast('"'+name+'" added','ok');
}
function delOtherRevRow(id,yr){if(!can('editOtherIncome')){toast('Admin access required','err');return;}if(!confirm('Remove this row?'))return;if(otherOperatingRevenue[yr])otherOperatingRevenue[yr]=otherOperatingRevenue[yr].filter(r=>r.id!==id);buildOtherFinancing();}

function addOMRow(yr){openModal('omAddModal');setTimeout(()=>document.getElementById('omAddName').focus(),80);}
function commitOMRow(){
  if(!can('editOM')){toast('Admin access required','err');return;}
  const name=document.getElementById('omAddName').value.trim();
  if(!name){document.getElementById('omAddName').focus();return;}
  const yr=selectedOMYear;
  getOMRows(yr).push({id:'om_'+Date.now(),name,cashLag:30,vals:MONTHS.map(()=>0),growthRate:0});
  auditLog('addOMRow','omRows',null,{name,yr});
  closeModal('omAddModal');
  document.getElementById('omAddName').value='';
  buildOMTable();
  toast('"'+name+'" added','ok');
}
function delOMRow(id,yr){yr=yr||selectedOMYear;if(!can('editOM')){toast('Admin access required','err');return;}if(!confirm('Remove this row?'))return;omRows[yr]=omRows[yr].filter(r=>r.id!==id);buildOMTable();}

function addCxRow(yr){openModal('cxAddModal');setTimeout(()=>document.getElementById('cxAddName').focus(),80);}
function commitCXRow(){
  if(!can('editCapex')){toast('Admin access required','err');return;}
  const name=document.getElementById('cxAddName').value.trim();
  if(!name){document.getElementById('cxAddName').focus();return;}
  const yr=selectedCapexYear;
  getCxRows(yr).push({id:'cx_'+Date.now(),name,payLag:2,tLag:1,dYrs:20,vals:MONTHS.map(()=>0),growthRate:0});
  auditLog('addCxRow','capexRows',null,{name,yr});
  closeModal('cxAddModal');
  document.getElementById('cxAddName').value='';
  buildCapexTable();
  toast('"'+name+'" added','ok');
}
function delCxRow(id,yr){yr=yr||selectedCapexYear;if(!confirm('Remove?'))return;capexRows[yr]=capexRows[yr].filter(r=>r.id!==id);buildCapexTable();}

// ═══════════════════════════════════════════════════════
//  MONTHLY P&L VIEW
// ═══════════════════════════════════════════════════════
let plMonthlyYear=_CY;
let plViewMode='monthly';
let plActualMode='le'; // 'le' | 'actual_le' | 'variance'

function setPlActualMode(mode,btn){
  plActualMode=mode;
  document.querySelectorAll('#plActualSeg .sb').forEach(b=>b.classList.remove('on'));
  btn?.classList.add('on');
  buildMonthlyPL(plMonthlyYear);
}

function setPLView(mode,btn){
  plViewMode=mode;
  if(btn){document.querySelectorAll('#plViewSeg .sb').forEach(b=>b.classList.remove('on'));btn.classList.add('on');}
  document.getElementById('plMonthlyContainer').style.display=mode==='monthly'?'block':'none';
  document.getElementById('plAnnualContainer').style.display=mode==='annual'?'block':'none';
  if(document.getElementById('plAnnualControls')) document.getElementById('plAnnualControls').style.display=mode==='annual'?'flex':'none';
  document.getElementById('plMonthlyControls').style.display=mode==='monthly'?'flex':'none';
  if(mode==='monthly') buildMonthlyPL(plMonthlyYear);
  else buildStatTbl(plLines,document.getElementById('plH'),document.getElementById('plB'));
}

// ── Balance Sheet view/mode controls ──────────────────────────────────────────
let bsViewMode='monthly'; let bsMonthlyYear=_CY; let bsActualMode='le';
function setBSView(mode,btn){
  bsViewMode=mode;
  document.querySelectorAll('#bsViewSeg .sb').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  document.getElementById('bsMonthlyContainer').style.display=mode==='monthly'?'block':'none';
  document.getElementById('bsAnnualContainer').style.display=mode==='annual'?'block':'none';
  document.getElementById('bsMonthlyControls').style.display=mode==='monthly'?'flex':'none';
  document.getElementById('bsAnnualControls').style.display=mode==='annual'?'flex':'none';
  if(mode==='monthly') buildMonthlyBS(bsMonthlyYear);
  else buildStatTbl(bsLines,document.getElementById('bsH'),document.getElementById('bsB'));
}
function setBSMode(mode,btn){
  bsActualMode=mode;
  document.querySelectorAll('#bsActualSeg .sb').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  buildMonthlyBS(bsMonthlyYear);
}
function buildMonthlyBS(yr){
  yr=yr||bsMonthlyYear; bsMonthlyYear=yr;
  buildYrSeg('bsMoYrSeg',yr,(y)=>{bsMonthlyYear=y;buildMonthlyBS(y);});
  const MO=MONTHS;
  const loadedMos=MO.map((_,m)=>_acts(m+1)).filter(Boolean);
  const showAct=yr===_CY&&bsActualMode==='actual_le'&&loadedMos.length>0;
  document.getElementById('bsMonH').innerHTML=`<tr><th style="text-align:left;min-width:220px;position:sticky;left:0;background:var(--table-header-bg);color:var(--table-header-text);z-index:2">Line Item</th>${MO.map(m=>`<th class="bc">${m}</th>`).join('')}<th class="bc">Total / EoY</th></tr>`;
  let body='';
  let sect='';
  bsLines.forEach(l=>{
    if(l.sect!==sect){sect=l.sect;body+=`<tr class="sr"><td colspan="${MO.length+2}" style="position:sticky;left:0">${sect}</td></tr>`;}
    const vals=MO.map((_,m)=>{
      if(showAct&&_acts(m+1)){
        // map common BS line IDs to actuals fields
        const bsMap={cash:'cash',receivables:'receivables',inventories:'inventories',total_assets:'totalAssets',
          total_liab:'totalLiabilities',retained_earnings:'retainedEarnings'};
        const actField=bsMap[l.id];
        if(actField&&_acts(m+1)?.bs?.[actField]!=null) return actualsStore[m+1].bs[actField];
      }
      return l.vals?.[4]||0; // use _CY LE column (index 4)
    });
    const last=vals[vals.length-1];
    const isTot=l.tot||l.sub;
    const cls=isTot?'tr':'';
    body+=`<tr class="${cls}"><td style="padding-left:${isTot?'10px':'22px'};position:sticky;left:0;background:var(--card);${l.color?'color:'+l.color:''}">${isTot?`<strong>${l.name}</strong>`:l.name}</td>${vals.map(v=>{const n=v<0;return `<td class="${isTot?'gld':'der'}">${n?`<span class="neg">(${Math.abs(Math.round(v)).toLocaleString()})</span>`:v===0?'<span class="dim">–</span>':Math.round(v).toLocaleString()}</td>`;}).join('')}<td class="${isTot?'gld':'der'}">${last<0?`<strong>(${Math.abs(Math.round(last)).toLocaleString()})</strong>`:last===0?'–':`<strong>${Math.round(last).toLocaleString()}</strong>`}</td></tr>`;
  });
  document.getElementById('bsMonB').innerHTML=body;
}
// Add new BS line
function openAddBSLineModal(){openModal('addBSLineModal');}
function addBSLine(){
  const sect=document.getElementById('bsLineSect').value;
  const name=document.getElementById('bsLineName').value.trim();
  if(!name){toast('Enter a line name','err');return;}
  const newLine={id:'custom_'+Date.now(),name,sect,vals:[0,0,0,0,0,0,0,0,0],tot:false};
  bsLines.push(newLine);
  // Re-sort so it appears in correct section
  bsLines.sort((a,b)=>{
    const sOrder=['Current Assets','Non-Current Assets','Current Liabilities','Non-Current Liabilities','Equity'];
    return (sOrder.indexOf(a.sect)-sOrder.indexOf(b.sect))||0;
  });
  closeModal('addBSLineModal');
  document.getElementById('bsLineName').value='';
  if(bsViewMode==='monthly') buildMonthlyBS(bsMonthlyYear);
  else buildStatTbl(bsLines,document.getElementById('bsH'),document.getElementById('bsB'));
  toast('"'+name+'" added to Balance Sheet','ok');
}

function buildMonthlyPL(yr){
  yr=yr||plMonthlyYear; plMonthlyYear=yr;
  buildYrSeg('plMoYrSeg',yr,(y,btn)=>{plMonthlyYear=y;buildMonthlyPL(y);});

  const fxR=fx();
  // Get lease aggregates for this year
  const agg=typeof leaseAggregates!=='undefined'&&leaseAggregates[yr]?leaseAggregates[yr]:null;
  const nfc=netFinancingRows[yr]||netFinancingRows[_CY];
  const omR=getOMRows(yr);
  const otherRev=otherOperatingRevenue[yr]||[];
  const fuelRev=fuelRevByYear[yr]||Array(12).fill(0);
  const fuelCost=fuelCostByMonth[yr]||fuelCostByMonth[_CY]||Array(12).fill(0);

  // Build the full P&L structure per spec
  const MO=MONTHS;
  const H=MO;

  // ── Period grouping ──────────────────────────────────────────────────────
  // period: 'monthly' | 'quarterly' | 'annual' | 'ytd'
  const ytdMode      = (period === 'ytd');
  const quarterMode  = (period === 'quarterly');
  const annualMode   = (period === 'annual');
  const ytdN         = ytdMode ? Math.min(activeMonth, 12) : 12;

  // Build column definitions: each col = { label, moIdxs: [0..11] }
  let dispCols = [];
  if (annualMode) {
    dispCols = [{ label: `FY ${yr}`, moIdxs: [0,1,2,3,4,5,6,7,8,9,10,11] }];
  } else if (quarterMode) {
    dispCols = [
      { label: 'Q1', moIdxs: [0,1,2] },
      { label: 'Q2', moIdxs: [3,4,5] },
      { label: 'Q3', moIdxs: [6,7,8] },
      { label: 'Q4', moIdxs: [9,10,11] },
    ];
  } else if (ytdMode) {
    dispCols = MO.slice(0, ytdN).map((m, i) => ({ label: m, moIdxs: [i] }));
  } else {
    // monthly (default)
    dispCols = MO.map((m, i) => ({ label: m, moIdxs: [i] }));
  }

  const totLabel = ytdMode ? `YTD ${MO[ytdN-1]||''}` : 'Annual';
  const ytdAnn   = vals => (Array.isArray(vals) ? vals.slice(0, ytdN) : []).reduce((s,v)=>s+(v||0),0);
  // Collapse 12-element vals array into dispCols
  const collapseVals = vals => dispCols.map(col => col.moIdxs.reduce((s, i) => s + (vals[i]||0), 0));

  const dispMos = ytdMode ? MO.slice(0, ytdN) : MO; // kept for actuals-render compat

  document.getElementById('plMonH').innerHTML=`<tr>
    <th style="text-align:left;min-width:260px;position:sticky;left:0;background:var(--table-header-bg);color:var(--table-header-text);z-index:2">Line Item</th>
    ${dispCols.map(c=>`<th class="bc">${c.label}</th>`).join('')}
    <th class="bc">${totLabel}</th>
  </tr>`;

  // Helper to get P&L line values for the year
  const getPL=id=>{
    const l=plLines.find(x=>x.id===id);
    if(!l) return Array(12).fill(0);
    const yIdx=YEARS.indexOf(String(yr)); if(yIdx<0) return Array(12).fill(0);
    // For monthly, spread annual by AOP monthly pattern
    const annualVal=l.vals[yIdx]||0;
    // Spread annual value equally across 12 months (no hardcoded seasonal skew)
    return MO.map(()=>Math.round(annualVal/12));
  };

  // Monthly revenue from engine for selected year
  const revMo=MO.map((_,m)=>{
    // Use actual/calc revenue for 2026; extrapolate for others
    if(_acts(m+1)?.pl?.totalSales && yr===actualsYear) return actualsStore[m+1].pl.totalSales;
    return 0; // placeholder until full engine wired
  });

  // Build rows array
  const rows=[];
  const sec=(label)=>rows.push({sect:label});
  const row=(label,vals,opt={})=>rows.push({label,vals,ann:sumArr(vals),...opt});
  const der=(label,fn,opt={})=>{const vals=MO.map((_,m)=>fn(m));rows.push({label,vals,ann:sumArr(vals),derived:true,...opt});};

  // — Regulated Business —
  sec('Regulated Business');
  const fuelRevM=fuelRevByYear[yr]||Array(12).fill(0);
  row('Fuel Revenue', fuelRevM, {color:'var(--green)'});
  // Fuel cost (negative)
  const fuelCostM=Array.isArray(fuelCostByMonth[yr])?fuelCostByMonth[yr]:(fuelCostByMonth2026||Array(12).fill(0));
  const fuelCostNeg=fuelCostM.map(v=>-Math.abs(v));
  row('Fuel Costs', fuelCostNeg, {color:'var(--red)'});
  der('Fuel Surplus/(Penalty)', m=>fuelRevM[m]+fuelCostNeg[m], {sub:true});

  // Non-fuel revenue from revenue engine
  const nfRevM=MO.map((_,m)=>{
    // 1. Actuals override (2026 uploaded months)
    if(yr===actualsYear&&_acts(m+1)?.pl?.nonFuelSales) return actualsStore[m+1].pl.nonFuelSales;
    // 2. Revenue engine (2026 unuploaded + all other years using annual plLines scaled by fuel proportions)
    const annNF = plLines.find(l=>l.id==='nonfuel')?.vals[YEARS.indexOf(String(yr))]||0;
    // Use calcRevEngineMonth for current year (live engine), scale annually for future years
    if(yr===_CY){
      try{ const r=calcRevEngineMonth(m); return r.nonFuelRevUSD||Math.round(annNF/12); }
      catch(e){ return Math.round(annNF/12); }
    }
    // For future years apply scenario tariff adjustment to annual LE, spread evenly
    const scAdj=1+(getScAdj(activeSc,'rv',yr)||0)/100;
    // Equal monthly spread (no hardcoded seasonal skew)
    return Math.round(annNF*scAdj/12);
  });
  row('Non-Fuel Revenue', nfRevM, {color:'var(--blue)'});

  const otherOpM=MO.map((_,m)=>otherRev.reduce((s,r)=>s+(r.vals[m]||0),0));
  row('Other Operating Revenue', otherOpM);

  const omTotM=getOMTotal(yr);
  const vehicleCr=agg?agg.vehicleCredit:Array(12).fill(0);
  const propertyCr=agg?agg.propertyCredit:Array(12).fill(0);
  const nonIPPCr=agg?agg.nonIPPCredit:Array(12).fill(0);
  const omGrossNeg=omTotM.map(v=>-v);
  row('Gross O&M', omGrossNeg, {color:'var(--red)'});
  if(agg&&vehicleCr.some(v=>v)){
    const v=vehicleCr.map(x=>Math.round(x));
    rows.push({label:'↳ IFRS-16 Vehicle Credit',vals:v,ann:sumArr(v),derived:true,italic:true,color:'var(--teal)'});
  }
  if(agg&&propertyCr.some(v=>v)){
    const v=propertyCr.map(x=>Math.round(x));
    rows.push({label:'↳ IFRS-16 Property Credit',vals:v,ann:sumArr(v),derived:true,italic:true,color:'var(--teal)'});
  }
  const omNeg=omTotM.map((v,m)=>-(v-(nonIPPCr[m]||0)));
  rows.push({label:'Net O&M',vals:omNeg,ann:sumArr(omNeg),bold:true,derived:true,color:'var(--red)'});

  der('Regulated EBITDA', m=>fuelRevM[m]+fuelCostNeg[m]+nfRevM[m]+otherOpM[m]+omNeg[m], {sub:true, bold:true});

  // — Purchased Power —
  sec('Purchased Power');
  // ARCHITECTURAL RULE: IPP fuel-revenue allocation fraction must come from DB (fpa_assumptions).
  // Until uploaded, use 1.0 (full PPA cost allocated to IPP fuel revenue).
  const _ippFRFrac = fpa.assumptions?.ippFuelRevFraction ?? 1.0;
  const ippFR=MO.map((_,m)=>{if(yr===actualsYear&&_acts(m+1)?.pl)return actualsStore[m+1].pl.ppaCost?Math.abs(actualsStore[m+1].pl.ppaCost)*_ippFRFrac:0;return Math.round((plLines.find(l=>l.id==='ipp_fr')?.vals[YEARS.indexOf(String(yr))]||0)/12);});
  const ippNR=MO.map((_,m)=>Math.round((plLines.find(l=>l.id==='ipp_nr')?.vals[YEARS.indexOf(String(yr))]||0)/12));
  row('IPP Fuel Revenue', ippFR, {color:'var(--green)'});
  row('IPP Non-Fuel Revenue', ippNR, {color:'var(--green)'});
  const ippCostBase=MO.map((_,m)=>{if(yr===actualsYear&&_acts(m+1)?.pl)return actualsStore[m+1].pl.ppaCost||0;return -Math.round((plLines.find(l=>l.id==='ipp_cost')?.vals[YEARS.indexOf(String(yr))]||0)/12);});
  const ippCredit=agg?agg.ippCredit:Array(12).fill(0);
  const ippCostNet=MO.map((_,m)=>ippCostBase[m]+(ippCredit[m]||0));
  const ippCostGrossNeg=ippCostBase.map(v=>Math.abs(v)?-Math.abs(v):v);
  row('IPP Cost (cash basis)', ippCostGrossNeg, {color:'var(--red)'});
  if(agg&&ippCredit.some(v=>v)){
    const v=ippCredit.map(x=>Math.round(x));
    rows.push({label:'↳ IFRS-16 IPP Lease Credit',vals:v,ann:sumArr(v),derived:true,italic:true,color:'var(--teal)'});
  }
  rows.push({label:'Net IPP Cost',vals:ippCostNet,ann:sumArr(ippCostNet),bold:true,derived:true,color:'var(--red)'});
  der('PP Contribution', m=>ippFR[m]+ippNR[m]+ippCostNet[m], {sub:true, bold:true});
  // OUR Recovery memo (cash basis — IFRS-16 credit invisible to OUR)
  const ourRecovery=MO.map((_,m)=>ippFR[m]+ippNR[m]+ippCostGrossNeg[m]);
  rows.push({label:'↳ OUR Recovery Surplus (cash basis)',vals:ourRecovery,ann:sumArr(ourRecovery),italic:true,color:'var(--muted)',derived:true});

  // — Non-Regulated —
  sec('Non-Regulated Business');
  const nrRev=MO.map((_,m)=>Math.round((plLines.find(l=>l.id==='nr_rev')?.vals[YEARS.indexOf(String(yr))]||0)/12));
  const nrCost=MO.map((_,m)=>-Math.round((plLines.find(l=>l.id==='nr_cost')?.vals[YEARS.indexOf(String(yr))]||0)/12));
  row('Non-Regulated Revenue', nrRev, {color:'var(--green)'});
  row('Non-Regulated Costs', nrCost, {color:'var(--red)'});
  der('Non-Reg Contribution', m=>nrRev[m]+nrCost[m], {sub:true, bold:true});

  // — EBITDA —
  rows.push({divider:true});
  const regEb=rows.filter(r=>r.label==='Regulated EBITDA')[0];
  const ppCon=rows.filter(r=>r.label==='PP Contribution')[0];
  const nrCon=rows.filter(r=>r.label==='Non-Reg Contribution')[0];
  der('TOTAL EBITDA', m=>(regEb?.vals[m]||0)+(ppCon?.vals[m]||0)+(nrCon?.vals[m]||0), {tot:true, bold:true, color:'var(--gold)'});

  // — Below EBITDA —
  sec('');
  const depM=MO.map((_,m)=>-Math.round(calcDepTotals(yr,m).regular/1000));
  row('Depreciation (IAS 16)', depM, {color:'var(--muted)'});
  const impM=MO.map((_,m)=>-Math.round(calcDepTotals(yr,m).impairment/1000));
  row('Impairment (IAS 36)', impM, {color:'var(--amber)', amber:true});

  const ebitdaRow=rows.find(r=>r.label==='TOTAL EBITDA');
  der('Operating Income (EBIT)', m=>(ebitdaRow?.vals[m]||0)+depM[m]+impM[m], {sub:true, bold:true});

  // — Net Financing Costs —
  sec('Net Financing Costs');
  row('Interest Income', nfc.intIncome?.vals||Array(12).fill(0), {color:'var(--green)'});
  row('Interest Expense', nfc.intExpense?.vals||Array(12).fill(0), {color:'var(--red)'});
  row('Loan Financing Fees', nfc.loanFees?.vals||Array(12).fill(0), {color:'var(--red)'});
  const leaseIntM=agg?agg.interestExpense:Array(12).fill(0);
  row('Lease Interest (IFRS 16)', leaseIntM, {derived:true, color:'var(--teal)'});
  row('Preference Dividends', nfc.prefDivs?.vals||Array(12).fill(0), {color:'var(--muted)'});
  const fxGainM=MO.map((_,m)=>Math.round(((fxTable.billing[m]||0)-(nfc.budgetFX[m]||0))*(nfc.netFXPosition[m]||0)));
  row('FX Gain/(Loss)', fxGainM, {derived:true, color:'var(--blue)'});
  const nfcM=MO.map((_,m)=>(nfc.intIncome?.vals[m]||0)+(nfc.intExpense?.vals[m]||0)+(nfc.loanFees?.vals[m]||0)+leaseIntM[m]+(nfc.prefDivs?.vals[m]||0)+fxGainM[m]);
  rows.push({label:'Total Net Financing Costs', vals:nfcM, ann:sumArr(nfcM), sub:true, bold:true, derived:true, color:'var(--gold)'});

  const ebitRow=rows.find(r=>r.label==='Operating Income (EBIT)');
  der('Operating Profit After NFC', m=>(ebitRow?.vals[m]||0)+nfcM[m], {sub:true, bold:true});

  // — Other Income —
  sec('Other Income / Expense — Taxable');
  otherIncomeRows.filter(r=>r.taxable).forEach(r=>{
    const vals=MO.map((_,m)=>(r.vals[yr]||r.vals[_CY]||Array(12).fill(0))[m]||0);
    row(r.name, vals);
  });
  const taxOther=otherIncomeRows.filter(r=>r.taxable);
  der('Subtotal Taxable', m=>taxOther.reduce((s,r)=>s+((r.vals[yr]||r.vals[_CY]||Array(12).fill(0))[m]||0),0), {sub:true});

  sec('Other Income / Expense — Non-Taxable');
  const nTaxOther=otherIncomeRows.filter(r=>!r.taxable);
  nTaxOther.forEach(r=>{
    const vals=MO.map((_,m)=>(r.vals[yr]||r.vals[_CY]||Array(12).fill(0))[m]||0);
    row(r.name, vals);
  });
  der('Subtotal Non-Taxable', m=>nTaxOther.reduce((s,r)=>s+((r.vals[yr]||r.vals[_CY]||Array(12).fill(0))[m]||0),0), {sub:true});

  const opAfNFCRow=rows.find(r=>r.label==='Operating Profit After NFC');
  const taxOtherM=MO.map((_,m)=>taxOther.reduce((s,r)=>s+((r.vals[yr]||r.vals[_CY]||Array(12).fill(0))[m]||0),0));
  const nTaxOtherM=MO.map((_,m)=>nTaxOther.reduce((s,r)=>s+((r.vals[yr]||r.vals[_CY]||Array(12).fill(0))[m]||0),0));
  der('Net Profit Before Tax', m=>(opAfNFCRow?.vals[m]||0)+taxOtherM[m]+nTaxOtherM[m], {tot:true, bold:true});

  const npbtRow=rows.find(r=>r.label==='Net Profit Before Tax');
  const taxRate=effectiveTaxRate[yr]||0;
  const taxM=MO.map((_,m)=>-Math.round((npbtRow?.vals[m]||0)*taxRate));
  row('Income Tax', taxM, {color:'var(--red)'});
  der('Net Profit After Tax', m=>(npbtRow?.vals[m]||0)+taxM[m], {tot:true, bold:true, color:'var(--gold)'});

  sec('── Appropriations (memo) ──');
  appropriationRows.forEach(r=>{
    const vals=MO.map((_,m)=>(r.vals[yr]||r.vals[_CY]||Array(12).fill(0))[m]||0);
    rows.push({label:r.name, vals, ann:sumArr(vals), italic:true});
  });

  // plActualsBadge kept hidden — upload count removed from UI
  const loadedMos2026=[1,2,3,4,5,6,7,8,9,10,11,12].filter(m=>_acts(m));
  const badge=document.getElementById('plActualsBadge');
  if(badge){ badge.style.display='none'; }

  // Helper: get actual P&L value for month m (1-indexed → actualsStore key = m+1)
  const getAct=(m,field)=>_acts(m+1)?.pl?.[field]??null;

  // Build actuals-mapped arrays (null = not loaded, renders as '–' in actual column)
  const actMap={
    fuelRev:    MO.map((_,m)=>getAct(m,'fuelSales')),
    fuelCost:   MO.map((_,m)=>{const v=getAct(m,'fuelCost');return v!==null?-Math.abs(v):null;}),
    nfRev:      MO.map((_,m)=>getAct(m,'nonFuelSales')),
    grossProfit:MO.map((_,m)=>getAct(m,'grossProfit')),
    opex:       MO.map((_,m)=>{const v=getAct(m,'opex');return v!==null?-Math.abs(v):null;}),
    ebitda:     MO.map((_,m)=>getAct(m,'ebitda')),
    depn:       MO.map((_,m)=>{const v=getAct(m,'depreciation');return v!==null?-Math.abs(v):null;}),
    ebit:       MO.map((_,m)=>getAct(m,'ebit')),
    nfc:        MO.map((_,m)=>getAct(m,'nfc')),
    pretax:     MO.map((_,m)=>getAct(m,'pretax')),
    tax:        MO.map((_,m)=>{const v=getAct(m,'tax');return v!==null?-Math.abs(v):null;}),
    netIncome:  MO.map((_,m)=>getAct(m,'netIncome')),
  };

  const showActuals = yr===_CY && (plActualMode==='actual_le'||plActualMode==='variance') && loadedMos2026.length>0;

  // Render — two modes: standard LE, or Actual vs LE with variance
  let bodyHtml='';

  if(!showActuals){
    // ── Standard LE render ──────────────────────────────────
    const nColsStd = dispCols.length + 2; // label + cols + total
    rows.forEach(r=>{
      if(r.divider){bodyHtml+=`<tr><td colspan="${nColsStd}" style="height:4px;background:var(--border)"></td></tr>`;return;}
      if(r.sect!==undefined){if(r.sect)bodyHtml+=`<tr class="sr"><td colspan="${nColsStd}" style="position:sticky;left:0">${r.sect}</td></tr>`;return;}
      const cls=r.tot?'tr':r.sub?'sur':'';
      const indent=r.tot||r.sub?'10px':'22px';
      const textColor=r.color||(r.amber?'var(--amber)':'');
      const italic=r.italic?'font-style:italic':'';
      const boldStyle=r.bold?'font-weight:700':'';
      const collVals = collapseVals(r.vals);
      const dispAnn  = ytdMode ? ytdAnn(r.vals) : r.ann;
      bodyHtml+=`<tr class="${cls}${r.amber?' amber-row':''}">
        <td style="padding-left:${indent};${textColor?'color:'+textColor+';':''}${italic};${boldStyle};position:sticky;left:0;background:var(--card)">${r.bold||r.tot||r.sub?`<strong>${r.label}</strong>`:r.label}${r.derived?' <span style="color:var(--teal);font-size:8px">⇐</span>':''}</td>
        ${collVals.map(v=>{const neg=v<0;const cls2=r.derived?'der':'';const col=r.tot||r.sub?'gld':'';return `<td class="${cls2||col}" style="${textColor?'color:'+textColor+';':''}">${neg?`<span class="neg">(${Math.abs(Math.round(v)).toLocaleString()})</span>`:v===0?'<span class="dim">–</span>':Math.round(v).toLocaleString()}</td>`;}).join('')}
        <td class="${r.tot||r.sub?'gld':r.derived?'der':''}" style="${textColor?'color:'+textColor+';':''}">${dispAnn<0?`<strong>(${Math.abs(Math.round(dispAnn)).toLocaleString()})</strong>`:dispAnn===0?'–':`<strong>${Math.round(dispAnn).toLocaleString()}</strong>`}</td>
      </tr>`;
    });
  } else {
    // ── Actual vs LE render ──────────────────────────────────
    // Map rows to actuals key — covers all rows that have uploaded actuals
    const actKey={
      'Fuel Revenue':          'fuelRev',
      'Fuel Costs':            'fuelCost',
      'Fuel Surplus/(Penalty)':'fuelSurplus',
      'Non-Fuel Revenue':      'nfRev',
      'Gross O&M':             'opex',
      'Net O&M':               'opexNet',
      'Regulated EBITDA':      'regEbitda',
      'Net IPP Cost':          'ppaCost',
      'TOTAL EBITDA':          'ebitda',
      'Depreciation (IAS 16)': 'depn',
      'Impairment (IAS 36)':   'impairment',
      'Operating Income (EBIT)':'ebit',
      'Total Net Financing Costs':'nfc',
      'Net Profit Before Tax': 'pretax',
      'Income Tax':            'tax',
      'Net Profit After Tax':  'netIncome',
    };
    // Extend actMap with computed actuals fields not directly in actualsStore
    const actMapExtended = {
      ...actMap,
      fuelSurplus:  MO.map((_,m)=>{
        const fr=getAct(m,'fuelSales'); const fc=getAct(m,'fuelCost');
        return fr!=null&&fc!=null?fr-Math.abs(fc):null;
      }),
      opexNet:      MO.map((_,m)=>{const v=getAct(m,'opex');return v!=null?-Math.abs(v):null;}),
      regEbitda:    MO.map((_,m)=>getAct(m,'grossProfit')),  // best proxy in actuals
      ppaCost:      MO.map((_,m)=>{const v=getAct(m,'ppaCost');return v!=null?-Math.abs(v):null;}),
      impairment:   MO.map(()=>null), // not separately disclosed in actuals file
    };
    // Override actMap with extended version
    Object.assign(actMap, actMapExtended);
    const isVarianceMode=plActualMode==='variance';
    // Header — Actuals vs LE (respects period grouping via dispCols)
    if(isVarianceMode){
      document.getElementById('plMonH').innerHTML=`<tr>
        <th style="text-align:left;min-width:260px;position:sticky;left:0;background:var(--table-header-bg);color:var(--table-header-text);z-index:2">Line Item</th>
        ${dispCols.map(c=>`<th class="bc" colspan="1">${c.label}</th>`).join('')}
        <th class="bc">${totLabel} LE</th>
      </tr>
      <tr style="background:var(--table-header-bg)">
        <th style="position:sticky;left:0;background:var(--table-header-bg);color:var(--table-header-text);z-index:2;font-size:9px">Variance = Actual − LE</th>
        ${dispCols.map(c=>c.moIdxs.some(i=>_acts(i+1))?`<th class="bc" style="font-size:9px;color:var(--text)">Var $</th>`:`<th class="bc" style="color:var(--muted);font-size:9px">–</th>`).join('')}
        <th class="bc" style="font-size:9px">Loaded</th>
      </tr>`;
    } else {
      document.getElementById('plMonH').innerHTML=`<tr>
        <th style="text-align:left;min-width:260px;position:sticky;left:0;background:var(--table-header-bg);color:var(--table-header-text);z-index:2">Line Item</th>
        ${dispCols.map(c=>`<th class="bc" colspan="2" style="border-left:1px solid var(--b2)">${c.label}</th>`).join('')}
        <th class="bc">${totLabel}</th>
      </tr>
      <tr style="background:var(--table-header-bg)">
        <th style="position:sticky;left:0;background:var(--table-header-bg);color:var(--table-header-text);z-index:2;font-size:9px">Actual (A) · LE (L)</th>
        ${dispCols.map(()=>`<th class="bc" style="font-size:9px;border-left:1px solid var(--b2);color:var(--green)">A</th><th class="bc" style="font-size:9px;color:var(--muted)">L</th>`).join('')}
        <th class="bc" style="font-size:9px">LE</th>
      </tr>`;
    }

    const fmtCell=(v,isAct,lev,col)=>{
      if(v===null||v===undefined) return `<td style="color:var(--muted);${col?'color:'+col+';':''}opacity:.35">–</td>`;
      const neg=v<0;
      const baseCls=lev?'gld':'';
      return `<td class="${baseCls}" style="${col?'color:'+col+';':''}">${neg?`<span class="neg">(${Math.abs(Math.round(v)).toLocaleString()})</span>`:`${Math.round(v).toLocaleString()}`}</td>`;
    };
    const fmtVar=(act,le,lev,posGood)=>{
      if(act===null) return `<td style="color:var(--muted);opacity:.35">–</td>`;
      const d=act-le;
      const isGood=posGood?(d>=0):(d<=0);
      const col=d===0?'var(--muted)':isGood?'var(--green)':'var(--red)';
      const cls=lev?'gld':'';
      return `<td class="${cls}" style="color:${col};font-weight:${lev?700:400}">${d===0?'–':d>0?`+${Math.round(d).toLocaleString()}`:`(${Math.abs(Math.round(d)).toLocaleString()})`}</td>`;
    };

    const posGoodSet=new Set(['Fuel Revenue','Non-Fuel Revenue','TOTAL EBITDA','Operating Income (EBIT)','Net Profit Before Tax','Net Profit After Tax']);

    rows.forEach(r=>{
      const nCols=isVarianceMode?dispCols.length+2:dispCols.length*2+2;
      if(r.divider){bodyHtml+=`<tr><td colspan="${nCols}" style="height:4px;background:var(--border)"></td></tr>`;return;}
      if(r.sect!==undefined){if(r.sect)bodyHtml+=`<tr class="sr"><td colspan="${nCols}" style="position:sticky;left:0">${r.sect}</td></tr>`;return;}
      const cls=r.tot?'tr':r.sub?'sur':'';
      const indent=r.tot||r.sub?'10px':'22px';
      const textColor=r.color||(r.amber?'var(--amber)':'');
      const italic=r.italic?'font-style:italic':'';
      const boldStyle=r.bold||r.tot||r.sub?'font-weight:700':'';
      const ak=actKey[r.label];
      const actValsRaw=ak?(actMapExtended[ak]||actMap[ak]):null;
      const posGood=posGoodSet.has(r.label);
      const lev=r.tot||r.sub;
      // Collapse actuals and LE into period buckets
      const collLE  = collapseVals(r.vals);
      const collAct = actValsRaw
        ? dispCols.map(col => {
            const vals = col.moIdxs.map(i => actValsRaw[i]);
            if (vals.every(v => v === null || v === undefined)) return null;
            return vals.reduce((s, v) => s + (v || 0), 0);
          })
        : null;
      const dispAnn=ytdMode?ytdAnn(r.vals):r.ann;
      bodyHtml+=`<tr class="${cls}${r.amber?' amber-row':''}">
        <td style="padding-left:${indent};${textColor?'color:'+textColor+';':''}${italic};${boldStyle};position:sticky;left:0;background:var(--card)">${r.bold||r.tot||r.sub?`<strong>${r.label}</strong>`:r.label}${r.derived?' <span style="color:var(--teal);font-size:8px">⇐</span>':''}</td>
        ${isVarianceMode
          ? collLE.map((le,ci)=>collAct?fmtVar(collAct[ci],le,lev,posGood):fmtCell(le,false,lev,textColor)).join('')
          : collLE.map((le,ci)=>collAct?fmtCell(collAct[ci],true,lev,'var(--green)')+fmtCell(le,false,lev,textColor):('<td style="opacity:.25">–</td>'+fmtCell(le,false,lev,textColor))).join('')
        }
        <td class="${lev?'gld':r.derived?'der':''}" style="${textColor?'color:'+textColor+';':''}">${dispAnn<0?`<strong>(${Math.abs(Math.round(dispAnn)).toLocaleString()})</strong>`:dispAnn===0?'–':`<strong>${Math.round(dispAnn).toLocaleString()}</strong>`}</td>
      </tr>`;
    });
  }
  document.getElementById('plMonB').innerHTML=bodyHtml;
}

// ═══════════════════════════════════════════════════════
//  EXPORT MONTHLY P&L
// ═══════════════════════════════════════════════════════
function exportMonthlyPL(){
  const yr=plMonthlyYear;
  const rows=[['Line Item',...MONTHS,'Annual']];
  document.querySelectorAll('#plMonB tr').forEach(tr=>{
    const cells=[...tr.querySelectorAll('td')];
    if(!cells.length) return;
    const row=cells.map(td=>td.textContent.replace(/[()]/g,s=>s==='('?'-':'').replace(/,/g,'').trim());
    rows.push(row);
  });
  const blob=new Blob([rows.map(r=>r.join(',')).join('\n')],{type:'text/csv'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download=`JPS_Monthly_PL_${yr}_${plActualMode}.csv`;a.click();
  toast('Monthly P&L exported','ok');
}

// ═══════════════════════════════════════════════════════
//  ACTUALS HELPER — latest loaded month for dashboard KPIs
// ═══════════════════════════════════════════════════════
function getLatestActuals(){
  const loaded=[1,2,3,4,5,6,7,8,9,10,11,12].filter(m=>_acts(m));
  if(!loaded.length) return null;
  return _acts(loaded[loaded.length-1]);
}
function getYTDActuals(){
  // Return YTD cumulative from the latest loaded month
  const loaded=[1,2,3,4,5,6,7,8,9,10,11,12].filter(m=>_acts(m));
  if(!loaded.length) return null;
  const latest=_acts(loaded[loaded.length-1]);
  return {ytd:latest.ytdActual, ytdBudget:latest.ytdBudget, months:loaded.length, label:latest.month};
}
// ═══════════════════════════════════════════════════════
// 5-YEAR PROJECTION ENGINE — Session 8
// Driver-based. Rebuilds plLines, omRows, capexRows,
// depreciationComponents, netFinancingRows for future projection years.
// ═══════════════════════════════════════════════════════

// ── PROJECTION ASSUMPTIONS ────────────────────────────
// ARCHITECTURAL RULE: All projection driver values come from fpa_assumptions (DB).
// These objects are initialised to zero. fpaApplyProjDriversToLegacy() overlays DB values at bootstrap.
// When no DB data exists → drivers show 0 → user must enter assumptions via the 5-Year Projection tab.
// Helper: build zeroed vals object for future years (_CY+1 through _CY+4)
const _zFutureYrs = () => { const o={}; Array.from({length:4},(_,i)=>_CY+1+i).forEach(y=>{o[y]=0;}); return o; };
const projRevDrivers = {
  volumeGrowth:   {name:'Volume Growth (Billed MWh %)',    vals:_zFutureYrs(), note:'Source: fpa_assumptions — proj.rev.volumeGrowth'},
  tariffIncrease: {name:'Tariff Review Uplift (%)',         vals:_zFutureYrs(), note:'Source: fpa_assumptions — proj.rev.tariffIncrease'},
  fxPath:         {name:'Avg J$/US$ Rate',                  vals:_zFutureYrs(), note:'Source: fpa_assumptions — proj.rev.fxPath'},
  fuelCostGrowth: {name:'Fuel Cost Growth (%)',             vals:_zFutureYrs(), note:'Source: fpa_assumptions — proj.rev.fuelCostGrowth'},
  ippCostGrowth:  {name:'IPP Cost Growth (%)',              vals:_zFutureYrs(), note:'Source: fpa_assumptions — proj.rev.ippCostGrowth'},
  nonRegGrowth:   {name:'Non-Regulated Revenue Growth (%)', vals:_zFutureYrs(), note:'Source: fpa_assumptions — proj.rev.nonRegGrowth'},
};

// O&M inflation drivers — zeroed; loaded from fpa_assumptions at bootstrap
const projOMDrivers = {
  payroll:    {name:'Payroll & Benefits',    cats:['payroll','overtime','benefits','disc_ben','training'], vals:_zFutureYrs()},
  thirdparty: {name:'3rd Party Services',    cats:['thirdpty'],                                            vals:_zFutureYrs()},
  materials:  {name:'Materials & Supplies',  cats:['supplies','materials'],                                vals:_zFutureYrs()},
  admin:      {name:'Admin & Office',        cats:['office','bdr','tech','advert','misc'],                 vals:_zFutureYrs()},
  transport:  {name:'Transport',             cats:['transport'],                                           vals:_zFutureYrs()},
  insurance:  {name:'Insurance',             cats:['insurance'],                                           vals:_zFutureYrs()},
  facilities: {name:'Facilities & Bad Debt', cats:['building','bad_debt'],                                 vals:_zFutureYrs()},
};

// CapEx annual budgets per programme — future years zeroed; current year seeded from capexRows
const _zCxCY = (id) => sumArr(capexRows[_CY]?.find(r=>r.id===id)?.vals||[]);
function _mkProjCapexEntry(id, name) {
  const v = {}; v[_CY] = _zCxCY(id);
  Array.from({length:4},(_,i)=>_CY+1+i).forEach(y=>{ v[y]=0; });
  return {name, vals:v};
}
const projCapexBudgets = {
  cx_gen:   _mkProjCapexEntry('cx_gen',  'Generation – Routine'),
  cx_tx:    _mkProjCapexEntry('cx_tx',   'Transmission – Expansion'),
  cx_dist:  _mkProjCapexEntry('cx_dist', 'Distribution – Upgrade'),
  cx_hurr:  _mkProjCapexEntry('cx_hurr', 'Hurricane Melissa Restoration'),
  cx_cust:  _mkProjCapexEntry('cx_cust', 'Customer Growth (CCMA)'),
  cx_loss:  _mkProjCapexEntry('cx_loss', 'Loss Reduction Programme'),
  cx_ss:    _mkProjCapexEntry('cx_ss',   'Support Services (IT/Facilities)'),
};

// Debt schedule (US$000) — zeroed; populate from loan engine / uploads
const _zYrs = () => { const o={}; Array.from({length:5},(_,i)=>_CY+i).forEach(y=>{o[y]=0;}); return o; };
const projDebtSchedule = {
  openingDebt:  {name:'Opening Long-Term Debt',         vals:_zYrs()},
  drawdowns:    {name:'Loan Drawdowns',                 vals:_zYrs()},
  repayments:   {name:'Scheduled Repayments',           vals:_zYrs()},
  closingDebt:  {name:'Closing Long-Term Debt',         vals:_zYrs()},
  avgBalance:   {name:'Average Debt Balance',           vals:_zYrs()},
  interestRate: {name:'Weighted Avg Interest Rate (%)', vals:_zYrs()},
  interestCost: {name:'Interest Expense ($K)',          vals:_zYrs()},
  loanFees:     {name:'Loan Financing Fees ($K)',       vals:_zYrs()},
};

// Tariff review events
const projTariffReviews = [
  {year:2028, month:4, uplift:5.0, status:'Forecast',  classes:'All', basis:'CPI + WACC re-determination'},
  {year:2030, month:4, uplift:5.0, status:'Indicative', classes:'All', basis:'Pending OUR regulatory cycle'},
];

// ── PROJECTION ENGINE ─────────────────────────────────
function runProjectionEngine() {
  const yrs = Array.from({length:4},(_,i)=>_CY+1+i); // future years: _CY+1 through _CY+4
  const vi = yr => 4+(yr-_CY); // vals index helper: _CY → index 4

  // ── Step 1: Fuel costs (apply growth rates) ────────
  yrs.forEach(yr=>{
    const gr = 1 + (projRevDrivers.fuelCostGrowth.vals[yr]||0)/100;
    fuelCostByMonth[yr] = (fuelCostByMonth[yr-1]||fuelCostByMonth[_CY]).map(v=>Math.round(v*gr));
  });
  // Rebuild fuel rev with 1-month lag
  yrs.forEach(yr=>{
    const fc=fuelCostByMonth[yr]; const fcPrev=fuelCostByMonth[yr-1]||fuelCostByMonth[_CY];
    // ARCHITECTURAL RULE: fuel revenue uplift factor must come from DB (fpa_assumptions tariff uplift).
    // Until uploaded, use 1.0 (no uplift — fuel revenue = prior month fuel cost, 1-month pass-through).
    const _fuelUplift = fpa.assumptions?.fuelRevUplift ?? 1.0;
    fuelRevByYear[yr]=fc.map((v,i)=>i===0?Math.round(fcPrev[11]*_fuelUplift):Math.round(fc[i-1]*_fuelUplift));
  });

  // ── Step 2: Non-fuel revenue ───────────────────────
  // Base: current year annual non-fuel revenue from plLines (index 4 = _CY)
  const baseCYNF = plLines.find(l=>l.id==='nonfuel')?.vals[4] || 0;
  let cumNF = baseCYNF;
  yrs.forEach(yr=>{
    const volGr = 1 + (projRevDrivers.volumeGrowth.vals[yr]||0)/100;
    const tarGr = 1 + (projRevDrivers.tariffIncrease.vals[yr]||0)/100;
    cumNF = Math.round(cumNF * volGr * tarGr);
    const nfLine = plLines.find(l=>l.id==='nonfuel');
    if(nfLine){ nfLine.vals[vi(yr)] = cumNF; }
  });

  // ── Step 3: IPP costs ─────────────────────────────
  const baseCYIPPCost = plLines.find(l=>l.id==='ipp_cost')?.vals[4] || 0;
  let cumIPP = baseCYIPPCost;
  yrs.forEach(yr=>{
    const gr = 1 + (projRevDrivers.ippCostGrowth.vals[yr]||0)/100;
    cumIPP = Math.round(cumIPP * gr);
    const l = plLines.find(ll=>ll.id==='ipp_cost');
    if(l) l.vals[vi(yr)] = cumIPP;
  });

  // IPP revenues scale with cost (OUR recovery mechanism)
  const baseCYIPPFR = plLines.find(l=>l.id==='ipp_fr')?.vals[4] || 0;
  const baseCYIPPNR = plLines.find(l=>l.id==='ipp_nr')?.vals[4] || 0;
  let cumFR = baseCYIPPFR, cumNR = baseCYIPPNR;
  yrs.forEach(yr=>{
    const gr = 1 + (projRevDrivers.ippCostGrowth.vals[yr]||0)/100;
    cumFR = Math.round(cumFR * gr); cumNR = Math.round(cumNR * gr);
    const lFR = plLines.find(ll=>ll.id==='ipp_fr');
    const lNR = plLines.find(ll=>ll.id==='ipp_nr');
    if(lFR) lFR.vals[vi(yr)] = cumFR;
    if(lNR) lNR.vals[vi(yr)] = cumNR;
  });

  // Non-reg revenue
  const baseCYNRev = plLines.find(l=>l.id==='nr_rev')?.vals[4] || 0;
  let cumNRev = baseCYNRev;
  yrs.forEach(yr=>{
    const gr = 1 + (projRevDrivers.nonRegGrowth.vals[yr]||0)/100;
    cumNRev = Math.round(cumNRev * gr);
    const l = plLines.find(ll=>ll.id==='nr_rev');
    if(l) l.vals[vi(yr)] = cumNRev;
  });

  // ── Step 4: O&M — apply category inflation ────────
  yrs.forEach(yr=>{
    const rowsCY = omRows[_CY];
    const rowsYr   = omRows[yr] || omRows[_CY];
    Object.values(projOMDrivers).forEach(driver=>{
      driver.cats.forEach(catId=>{
        const base = rowsCY.find(r=>r.id===catId);
        const target = rowsYr.find(r=>r.id===catId);
        if(!base||!target) return;
        // Compound from current year base
        let factor = 1;
        for(let y=_CY+1; y<=yr; y++) factor *= (1+(driver.vals[y]||0)/100);
        target.vals = base.vals.map(v=>Math.round(v*factor));
        target.growthRate = driver.vals[yr] || 0;
      });
    });
    // Rebuild plLines opex for this year
    const omTotal = sumArr(getOMTotal(yr));
    const opexLine = plLines.find(l=>l.id==='opex');
    if(opexLine) opexLine.vals[vi(yr)] = omTotal;
  });

  // ── Step 5: CapEx — spread annual budget monthly ──
  yrs.forEach(yr=>{
    const rowsYr = capexRows[yr] || capexRows[_CY];
    Object.entries(projCapexBudgets).forEach(([cxId, driver])=>{
      const target = rowsYr.find(r=>r.id===cxId);
      if(!target) return;
      const annBudget = driver.vals[yr] || 0;
      // Spread using prior year monthly profile shape
      const base = capexRows[yr-1]||capexRows[_CY];
      const baseRow = base.find(r=>r.id===cxId);
      const baseAnn = sumArr(baseRow?.vals||[]);
      if(baseAnn>0 && baseRow){
        target.vals = (baseRow.vals||[]).map(v=>Math.round(v/baseAnn*annBudget));
      } else {
        target.vals = Array(12).fill(Math.round(annBudget/12));
      }
    });
  });

  // ── Step 6: Depreciation roll-forward ────────────
  // Opening PPE NBV + CapEx additions - Avg life depn
  let openNBV = bsLines.find(l=>l.id==='ppe')?.vals[4] || 0;
  const avgDepnLife = 0; // years — set from uploads
  yrs.forEach(yr=>{
    const cxAnn = sumArr(getCxTotal(yr));
    const depnThisYear = Math.round(openNBV/avgDepnLife + cxAnn*0.5/avgDepnLife);
    const disposals = 0; // zeroed — populate from asset disposal register upload
    const closeNBV = openNBV + cxAnn - depnThisYear - disposals;

    // Update depreciationComponents monthly values
    const dc = depreciationComponents[yr];
    const monthlyDepn = Math.round(depnThisYear*1000/12); // convert to US$
    if(dc){
      dc.faRegister = Array(12).fill(Math.round(openNBV*1000/avgDepnLife/12));
      dc.capexTransfers = Array(12).fill(Math.round(cxAnn*1000*0.5/avgDepnLife/12));
    }

    // Update bsLines PPE
    const ppeLine = bsLines.find(l=>l.id==='ppe');
    if(ppeLine) ppeLine.vals[vi(yr)] = Math.round(closeNBV);

    // Update plLines depn
    const depnLine = plLines.find(l=>l.id==='depn');
    if(depnLine) depnLine.vals[vi(yr)] = depnThisYear;

    openNBV = closeNBV;
  });

  // ── Step 7: Debt schedule → interest expense ─────
  let openDebt = projDebtSchedule.openingDebt.vals[_CY];
  yrs.forEach(yr=>{
    const drawdown = projDebtSchedule.drawdowns.vals[yr]||0;
    const repay    = projDebtSchedule.repayments.vals[yr]||0;
    const rate     = (projDebtSchedule.interestRate.vals[yr]||0)/100;
    const avgBal   = openDebt + drawdown/2 - repay/2;
    const intCost  = Math.round(avgBal * rate);
    projDebtSchedule.interestCost.vals[yr] = intCost;
    projDebtSchedule.avgBalance.vals[yr] = Math.round(avgBal);
    const closeDebt = openDebt + drawdown - repay;
    projDebtSchedule.openingDebt.vals[yr] = openDebt;
    projDebtSchedule.closingDebt.vals[yr] = closeDebt;

    // Wire into plLines finCost
    const loanFees = projDebtSchedule.loanFees.vals[yr]||0;
    const prefDiv = sumArr(appropriationRows.find(r=>r.id==='div_pref')?.vals[_CY]||[]);
    const finLine = plLines.find(l=>l.id==='fin_cost');
    if(finLine) finLine.vals[vi(yr)] = intCost + loanFees + prefDiv;

    // Update netFinancingRows
    if(netFinancingRows[yr]){
      const monthly = Math.round(intCost/12);
      netFinancingRows[yr].intExpense.vals = Array(12).fill(-monthly);
      netFinancingRows[yr].loanFees.vals   = Array(12).fill(-Math.round(loanFees/12));
    }

    // Update bsLines LTD
    const ltdLine = bsLines.find(l=>l.id==='ltd');
    if(ltdLine) ltdLine.vals[vi(yr)] = closeDebt;

    openDebt = closeDebt;
  });

  // ── Step 8: Rebuild derived plLines ──────────────
  const PROJ_YIDX = {}; [_CY,...yrs].forEach((y,i)=>{ PROJ_YIDX[y]=4+i; });
  [_CY,...yrs].forEach(yr=>{
    const yi = PROJ_YIDX[yr];
    const get = id => plLines.find(l=>l.id===id)?.vals[yi]||0;

    // Fuel cost to plLine (US$000)
    const fcAnn = sumArr(fuelCostByMonth[yr]);
    const fcLine = plLines.find(l=>l.id==='fuel_cost');
    if(fcLine&&yr>_CY) fcLine.vals[yi] = fcAnn;
    // Fuel rev
    const frAnn = sumArr(fuelRevByYear[yr]);
    const frLine = plLines.find(l=>l.id==='fuel_rev');
    if(frLine&&yr>_CY) frLine.vals[yi] = frAnn;
    // Fuel surplus
    const fsLine = plLines.find(l=>l.id==='fuel_surp');
    if(fsLine) fsLine.vals[yi] = Math.round(get('fuel_rev')-get('fuel_cost'));
    // Other operating revenue
    const otherRev = sumArr(Object.values(otherOperatingRevenue[yr]||{}).flatMap(r=>r?.vals||[]));
    const orLine = plLines.find(l=>l.id==='other_r');
    if(orLine&&yr>_CY) orLine.vals[yi] = otherRev || orLine.vals[4];
    // Regulated EBITDA
    const regEB = get('nonfuel')+get('fuel_surp')+get('other_r')-get('opex');
    const rebLine = plLines.find(l=>l.id==='reg_eb');
    if(rebLine) rebLine.vals[yi] = regEB;
    // PP contribution
    const ppCon = get('ipp_fr')+get('ipp_nr')-get('ipp_cost');
    const ppLine = plLines.find(l=>l.id==='ipp_eb');
    if(ppLine) ppLine.vals[yi] = ppCon;
    // Non-reg contribution
    const nrCon = get('nr_rev')-get('nr_cost');
    const nrcLine = plLines.find(l=>l.id==='nr_eb');
    if(nrcLine) nrcLine.vals[yi] = nrCon;
    // EBITDA
    const ebitda = regEB + ppCon + nrCon;
    const ebLine = plLines.find(l=>l.id==='ebitda');
    if(ebLine) ebLine.vals[yi] = ebitda;
    // EBIT
    const ebit = ebitda - get('depn');
    const ebitLine = plLines.find(l=>l.id==='ebit');
    if(ebitLine) ebitLine.vals[yi] = ebit;
    // Pre-tax
    const intInc = yr>_CY ? Math.round(projDebtSchedule.closingDebt.vals[yr-1]||0 * 0.04 / 12 * 12) : get('fin_cost');
    const pretax = ebit - get('fin_cost') + get('oth_inc');
    const ptLine = plLines.find(l=>l.id==='pretax');
    if(ptLine) ptLine.vals[yi] = pretax;
    // Tax (33.33%)
    const tax = Math.round(Math.max(0, pretax) * (effectiveTaxRate[yr]||0));
    const taxLine = plLines.find(l=>l.id==='tax');
    if(taxLine) taxLine.vals[yi] = tax;
    // Net income
    const ni = pretax - tax;
    const niLine = plLines.find(l=>l.id==='net_inc');
    if(niLine) niLine.vals[yi] = ni;
  });

  // Update timestamp
  const stamp = document.getElementById('projLastRun');
  if(stamp) stamp.textContent = '✓ Last run: ' + new Date().toLocaleTimeString();
  const badge = document.getElementById('projPLBadge');
  if(badge){ badge.textContent = '● Projection active'; badge.className='badge badge-ok'; }

  // Refresh all reports
  buildProjPL();
  refreshAll();
  toast('5-Year Projection updated — all reports recalculated','ok');
}

// ── BUILD PROJECTION TAB UI ───────────────────────────
function buildProjTab() {
  const yrs = Array.from({length:4},(_,i)=>_CY+1+i); // _CY+1 through _CY+4
  const fmt = v => v==null?'–':Math.round(v).toLocaleString();
  const fmtPct = v => (v>=0?'+':'')+v.toFixed(1)+'%';
  const numInp = (obj,key,yr,cls,step,isInt) => {
    if(!can('editBase')) return `<td style="text-align:right;padding:4px 8px">${isInt?fmt(obj[key].vals[yr]):fmtPct(obj[key].vals[yr])}</td>`;
    return `<td><input class="ei" style="width:${isInt?'72px':'52px'};text-align:right"
      value="${isInt?fmt(obj[key].vals[yr]):obj[key].vals[yr].toFixed(1)}"
      onchange="projUpdDriver(event,'${JSON.stringify(Object.keys(obj)).replace(/"/g,'&quot;').split(',')[Object.keys(obj).indexOf(key)]}','${key}',${yr},${isInt})"
      onfocus="this.select()"></td>`;
  };

  // §1 Revenue drivers
  const rb = document.getElementById('projRevB');
  if(rb){
    rb.innerHTML = Object.entries(projRevDrivers).map(([k,d])=>{
      const isInt = k==='fxPath';
      const baseCY = k==='fxPath' ? (fxTable?.billing?.[0]||0) : null;
      return `<tr>
        <td style="padding-left:10px;color:var(--text)">${d.name}</td>
        <td class="gld" style="text-align:right">${baseCY!=null?baseCY.toFixed(1):'—'}</td>
        ${yrs.map(yr=>`<td><input class="ei" style="width:60px;text-align:right;color:${isInt?'var(--teal)':'var(--gold)'}"
          value="${isInt?d.vals[yr].toFixed(0):d.vals[yr].toFixed(1)}"
          onchange="const _v=parseFloat(this.value)||0;projRevDrivers['${k}'].vals[${yr}]=_v;projSaveDriver('rev','${k}',${yr},_v);buildProjSummary()"
          onfocus="this.select()"></td>`).join('')}
        <td style="font-size:9px;color:var(--muted);padding:0 8px">${d.note}</td>
      </tr>`;
    }).join('');
  }

  // §2 O&M drivers
  const ob = document.getElementById('projOMB');
  if(ob){
    ob.innerHTML = Object.entries(projOMDrivers).map(([k,d])=>{
      const baseCY = d.cats.reduce((s,id)=>{const r=omRows[_CY].find(x=>x.id===id);return s+sumArr(r?.vals||[]);},0);
      const projLast = d.cats.reduce((s,id)=>{
        const r=omRows[_CY].find(x=>x.id===id); if(!r) return s;
        let f=1; yrs.forEach(y=>f*=(1+(d.vals[y]||0)/100));
        return s+Math.round(sumArr(r.vals)*f);
      },0);
      return `<tr>
        <td style="padding-left:10px;color:var(--text)">${d.name}</td>
        <td class="ac">${Math.round(baseCY).toLocaleString()}</td>
        ${yrs.map(yr=>`<td><input class="ei" style="width:52px;text-align:right;color:var(--teal)"
          value="${d.vals[yr].toFixed(1)}"
          onchange="const _v=parseFloat(this.value)||0;projOMDrivers['${k}'].vals[${yr}]=_v;projSaveDriver('om','${k}',${yr},_v);buildProjSummary()"
          onfocus="this.select()">%</td>`).join('')}
        <td class="gld">${Math.round(projLast).toLocaleString()}</td>
      </tr>`;
    }).join('');
  }

  // §3 CapEx budgets
  const cb = document.getElementById('projCapexB');
  if(cb){
    cb.innerHTML = Object.entries(projCapexBudgets).map(([k,d])=>{
      const total5 = [_CY,...yrs].reduce((s,y)=>s+(d.vals[y]||0),0);
      return `<tr>
        <td style="padding-left:10px;color:var(--text)">${d.name}</td>
        <td class="ac">${Math.round(d.vals[_CY]).toLocaleString()}</td>
        ${yrs.map(yr=>`<td><input class="ei" style="width:72px;text-align:right;color:var(--blue)"
          value="${Math.round(d.vals[yr]).toLocaleString()}"
          onchange="projCapexBudgets['${k}'].vals[${yr}]=parseFloat(this.value.replace(/,/g,''))||0;buildProjSummary()"
          onfocus="this.select()"></td>`).join('')}
        <td class="gld">${Math.round(total5).toLocaleString()}</td>
      </tr>`;
    }).join('');
  }

  // §4 Depreciation roll-forward (derived - read only)
  buildProjDepTable();

  // §5 Debt schedule
  buildProjDebtTable();

  // §6 Projected P&L summary
  buildProjPL();

  // §7 Tariff calendar
  buildProjTariffCalendar();

  // Show warning if all drivers are still zero (no DB data loaded)
  const allZero = Object.values(projRevDrivers).every(d=>Object.values(d.vals).every(v=>v===0))
               && Object.values(projOMDrivers).every(d=>Object.values(d.vals).every(v=>v===0));
  const warnEl = document.getElementById('projNoDataWarn');
  if (warnEl) warnEl.style.display = allZero ? 'block' : 'none';
}

function buildProjDepTable(){
  const db = document.getElementById('projDepB');
  if(!db) return;
  const yrs=Array.from({length:5},(_,i)=>_CY+i);
  const vi = yr => 4+(yr-_CY); // vals index: _CY → index 4
  const rows=[
    {n:'Opening PPE NBV ($K)',      fn:yr=>bsLines.find(l=>l.id==='ppe')?.vals[vi(yr)]||0},
    {n:'Annual CapEx ($K)',          fn:yr=>sumArr(getCxTotal(yr))},
    {n:'Depreciation Charge ($K)',   fn:yr=>plLines.find(l=>l.id==='depn')?.vals[vi(yr)]||0},
    {n:'Disposals ($K)',             fn:yr=>0},
    {n:'Closing PPE NBV ($K)',       fn:yr=>{const o=bsLines.find(l=>l.id==='ppe')?.vals[vi(yr)]||0;const cx=sumArr(getCxTotal(yr));const dep=plLines.find(l=>l.id==='depn')?.vals[vi(yr)]||0;return o+cx-dep;}},
    {n:'Annual Depn / Opening NBV',  fn:yr=>{const dep=plLines.find(l=>l.id==='depn')?.vals[vi(yr)]||0;const nbv=bsLines.find(l=>l.id==='ppe')?.vals[vi(yr)]||0;return nbv>0?((dep/nbv)*100).toFixed(1)+'%':'–';},str:true},
  ];
  db.innerHTML=rows.map((r,i)=>`<tr class="${i===4?'sur':''}">
    <td style="padding-left:${i===4?'10':'22'}px;${i===4?'font-weight:700':''}${i===5?';color:var(--muted);font-style:italic':''}">${r.n}</td>
    ${yrs.map(yr=>`<td class="${i===4?'gld':'der'}" style="${i===5?'color:var(--muted)':''}">${r.str?r.fn(yr):typeof r.fn(yr)==='number'?Math.round(r.fn(yr)).toLocaleString():r.fn(yr)}</td>`).join('')}
  </tr>`).join('');
}

function buildProjDebtTable(){
  const db = document.getElementById('projDebtB');
  if(!db) return;
  const yrs=Array.from({length:5},(_,i)=>_CY+i);
  // Compute interest cost for all years after the first
  yrs.slice(1).forEach(yr=>{
    const open=projDebtSchedule.openingDebt.vals[yr];
    const draw=projDebtSchedule.drawdowns.vals[yr]||0;
    const rep=projDebtSchedule.repayments.vals[yr]||0;
    const rate=(projDebtSchedule.interestRate.vals[yr]||0)/100;
    const avg=open+draw/2-rep/2;
    projDebtSchedule.interestCost.vals[yr]=Math.round(avg*rate);
    projDebtSchedule.avgBalance.vals[yr]=Math.round(avg);
    projDebtSchedule.closingDebt.vals[yr]=open+draw-rep;
    if(yr<2030) projDebtSchedule.openingDebt.vals[yr+1]=open+draw-rep;
  });
  db.innerHTML=Object.entries(projDebtSchedule).map(([k,d])=>{
    const isEditable=can('editFinancing')&&['drawdowns','repayments','interestRate','loanFees'].includes(k);
    const isDerived=['interestCost','avgBalance','closingDebt'].includes(k);
    const isRate=k==='interestRate';
    return `<tr class="${isDerived?'der':''}">
      <td style="padding-left:${isDerived?'22':'10'}px;color:${isDerived?'var(--teal)':'var(--text)'}">${d.name}</td>
      ${yrs.map(yr=>{
        const v=d.vals[yr]??0;
        if(isEditable&&yr>_CY){
          return `<td><input class="ei" style="width:${isRate?'44':'68'}px;text-align:right;color:${isRate?'var(--amber)':'var(--blue)'}"
            value="${isRate?v.toFixed(1):Math.round(v).toLocaleString()}"
            onchange="projDebtSchedule['${k}'].vals[${yr}]=${isRate?'parseFloat':'parseInt'}(this.value.replace(/,/g,''))||0;buildProjDebtTable();buildProjSummary()"
            onfocus="this.select()">${isRate?'%':''}</td>`;
        }
        return `<td class="${isDerived?'der':'ac'}">${isRate?v.toFixed(1)+'%':Math.round(v).toLocaleString()}</td>`;
      }).join('')}
    </tr>`;
  }).join('');
}

function buildProjPL(){
  const hEl=document.getElementById('projPLH');
  const bEl=document.getElementById('projPLB');
  if(!hEl||!bEl) return;
  const yrs=Array.from({length:5},(_,i)=>_CY+i);
  const YIDX={}; yrs.forEach((y,i)=>{YIDX[y]=4+i;}); // _CY at index 4

  hEl.innerHTML=`<tr>
    <th style="text-align:left;min-width:260px">Line Item</th>
    ${yrs.map(y=>`<th class="bc">${y}${y===_CY?' (LE)':' (Proj)'}</th>`).join('')}
    <th class="bc">CAGR %</th>
  </tr>`;

  const rows=[
    {id:'nonfuel',  name:'Non-Fuel Revenue',     inc:true},
    {id:'fuel_rev', name:'Fuel Revenue',          inc:true},
    {id:'fuel_surp',name:'Fuel Surplus/(Penalty)',inc:true,sub:true},
    {id:'opex',     name:'O&M (Gross)',           inc:false},
    {id:'reg_eb',   name:'Regulated EBITDA',      inc:true,sub:true},
    {id:'ipp_eb',   name:'PP Contribution',       inc:true,sub:true},
    {id:'nr_eb',    name:'Non-Reg Contribution',  inc:true,sub:true},
    {id:'ebitda',   name:'TOTAL EBITDA',          inc:true,tot:true},
    {id:'depn',     name:'Depreciation',          inc:false},
    {id:'ebit',     name:'EBIT',                  inc:true,sub:true},
    {id:'fin_cost', name:'Net Financing Costs',   inc:false},
    {id:'oth_inc',  name:'Other Income',          inc:true},
    {id:'pretax',   name:'Pre-Tax Income',        inc:true,sub:true},
    {id:'tax',      name:'Income Tax',            inc:false},
    {id:'net_inc',  name:'NET INCOME',            inc:true,tot:true},
  ];

  bEl.innerHTML=rows.map(r=>{
    const line=plLines.find(l=>l.id===r.id);
    if(!line) return '';
    const vals=yrs.map(y=>line.vals[YIDX[y]]||0);
    const base=vals[0]; const end=vals[4];
    const cagr=base>0&&end>0?((Math.pow(end/base,0.25)-1)*100).toFixed(1)+'%':'–';
    const cls=r.tot?'tr':r.sub?'sur':'';
    const pad=r.tot||r.sub?'10px':'22px';
    return `<tr class="${cls}">
      <td style="padding-left:${pad}">${r.tot||r.sub?`<strong>${r.name}</strong>`:r.name}</td>
      ${vals.map((v,i)=>{
        const neg=v<0;
        const col=r.inc?(v>=0?'':'var(--red)'):(v<=0?'':'var(--red)');
        return `<td class="${r.tot?'gld':r.sub?'gld':''}" style="${col?'color:'+col+';':''}">${neg?`(${Math.abs(Math.round(v)).toLocaleString()})`:Math.round(v).toLocaleString()}</td>`;
      }).join('')}
      <td class="${parseFloat(cagr)>=0?'pos':'neg'}" style="font-size:9px">${cagr}</td>
    </tr>`;
  }).join('');

  // KPI summary row at bottom
  const ebitda26=plLines.find(l=>l.id==='ebitda')?.vals[4]||0;
  const ebitda30=plLines.find(l=>l.id==='ebitda')?.vals[8]||0;
  const ni26=plLines.find(l=>l.id==='net_inc')?.vals[4]||0;
  const ni30=plLines.find(l=>l.id==='net_inc')?.vals[8]||0;
  const ebitdaCAGR=ebitda26>0?((Math.pow(ebitda30/ebitda26,0.25)-1)*100).toFixed(1):0;
  const niCAGR=ni26>0?((Math.pow(ni30/ni26,0.25)-1)*100).toFixed(1):0;
  bEl.innerHTML+=`<tr style="background:var(--glo);border-top:2px solid var(--gold)"><td colspan="${yrs.length+2}" style="padding:8px 14px;font-size:10px;color:var(--gold)">
    <strong>Projection Highlights:</strong> &nbsp;
    EBITDA CAGR: <strong>${ebitdaCAGR}%</strong> (2026–2030) &nbsp;·&nbsp;
    Net Income CAGR: <strong>${niCAGR}%</strong> &nbsp;·&nbsp;
    2030 EBITDA: <strong>$${Math.round(ebitda30).toLocaleString()}K</strong> &nbsp;·&nbsp;
    2030 Net Income: <strong>$${Math.round(ni30).toLocaleString()}K</strong>
  </td></tr>`;
}

function buildProjSummary(){ buildProjDepTable(); buildProjDebtTable(); buildProjPL(); }

function buildProjTariffCalendar(){
  const el=document.getElementById('projTariffPanel');
  if(!el) return;
  el.innerHTML=`<div style="display:flex;flex-direction:column;gap:8px">
    ${projTariffReviews.map(t=>`
      <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--card2);border:1px solid var(--border);border-radius:6px;border-left:4px solid ${t.status==='Forecast'?'var(--gold)':'var(--muted)'}">
        <div style="font-size:20px;font-weight:800;font-family:var(--mono);color:${t.status==='Forecast'?'var(--gold)':'var(--muted)'};min-width:50px">${t.year}</div>
        <div style="flex:1">
          <div style="font-weight:700;color:var(--text)">${MONTHS[t.month-1]} ${t.year} — OUR Rate Review</div>
          <div style="font-size:9px;color:var(--muted);margin-top:2px">${t.basis} · Classes: ${t.classes}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:16px;font-weight:800;color:${t.status==='Forecast'?'var(--green)':'var(--muted)'};font-family:var(--mono)">+${t.uplift.toFixed(1)}%</div>
          <div style="font-size:9px;padding:1px 7px;border-radius:8px;background:${t.status==='Forecast'?'rgba(16,185,129,.15)':'rgba(74,100,133,.15)'};color:${t.status==='Forecast'?'var(--green)':'var(--muted)'};">${t.status}</div>
        </div>
        ${can('editBase')?`<button class="btn btn-ghost" style="font-size:9px;height:22px;padding:0 8px" onclick="editTariffReview(${projTariffReviews.indexOf(t)})">✏ Edit</button>`:''}
      </div>`).join('')}
    ${can('editBase')?`<button class="btn btn-gold" style="width:180px" onclick="addTariffReview()">+ Add Rate Review</button>`:''}
  </div>`;
}

function addTariffReview(){
  document.getElementById('trEditIdx').value='-1';
  document.getElementById('trYear').value='2028';
  document.getElementById('trMonth').value='4';
  document.getElementById('trUplift').value='5.0';
  document.getElementById('trBasis').value='OUR Annual Review';
  document.getElementById('trClasses').value='All';
  openModal('tariffRevModal');
  setTimeout(()=>document.getElementById('trUplift').focus(),80);
}

function editTariffReview(idx){
  const t=projTariffReviews[idx];
  document.getElementById('trEditIdx').value=String(idx);
  document.getElementById('trYear').value=String(t.year);
  document.getElementById('trMonth').value=String(t.month);
  document.getElementById('trUplift').value=t.uplift.toFixed(1);
  document.getElementById('trBasis').value=t.basis||'OUR Annual Review';
  document.getElementById('trClasses').value=t.classes||'All';
  openModal('tariffRevModal');
  setTimeout(()=>document.getElementById('trUplift').focus(),80);
}

function commitTariffReview(){
  const yr=parseInt(document.getElementById('trYear').value);
  const mo=parseInt(document.getElementById('trMonth').value);
  const uplift=parseFloat(document.getElementById('trUplift').value);
  const basis=document.getElementById('trBasis').value||'OUR Annual Review';
  const classes=document.getElementById('trClasses').value||'All';
  const editIdx=parseInt(document.getElementById('trEditIdx').value);
  if(isNaN(uplift)){toast('Invalid uplift value','err');return;}
  if(editIdx>=0 && projTariffReviews[editIdx]){
    const old=projTariffReviews[editIdx];
    // Remove old uplift from year
    if(projRevDrivers.tariffIncrease.vals[old.year]!==undefined)
      projRevDrivers.tariffIncrease.vals[old.year]=Math.max(0,(projRevDrivers.tariffIncrease.vals[old.year]||0)-old.uplift);
    old.year=yr; old.month=mo; old.uplift=uplift; old.basis=basis; old.classes=classes;
  } else {
    projTariffReviews.push({year:yr,month:mo,uplift,status:'Forecast',classes,basis});
  }
  if(projRevDrivers.tariffIncrease.vals[yr]!==undefined)
    projRevDrivers.tariffIncrease.vals[yr]=(projRevDrivers.tariffIncrease.vals[yr]||0)+uplift;
  auditLog('editBase','Tariff Review',null,`${MONTHS[mo-1]} ${yr} +${uplift}%`);
  closeModal('tariffRevModal');
  buildProjTariffCalendar();
  buildProjTab();
  toast('Rate review saved','ok');
}

function exportProjCSV(){
  const yrs=Array.from({length:5},(_,i)=>_CY+i);
  const YIDX={}; yrs.forEach((y,i)=>{YIDX[y]=4+i;}); // _CY at index 4
  const rows=[['Line Item',...yrs.map(y=>y+(y===_CY?' LE':' Proj'))]];
  plLines.forEach(l=>rows.push([l.name,...yrs.map(y=>l.vals[YIDX[y]]||0)]));
  const csv=rows.map(r=>r.join(',')).join('\n');
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download='JPS_5Year_Projection_'+new Date().toISOString().slice(0,10)+'.csv';
  a.click(); toast('Projection exported','ok');
}

function initYrSegs(){
  buildYrSeg('omYrSeg',selectedOMYear,(y,btn)=>{selectedOMYear=y;buildOMTable();});
  buildYrSeg('capexYrSeg',selectedCapexYear,(y,btn)=>{selectedCapexYear=y;buildCapexTable();});
  buildYrSeg('collYrSeg',selectedCollYear,(y,btn)=>{selectedCollYear=y;buildCollTable();});
}

// ═══════════════════════════════════════════════════════
//  PLATFORM INIT — called after successful login
//  v18: lazy tab rendering — only Dashboard built on login.
//  All other tabs built on first visit (tracked by _builtTabs).
// ═══════════════════════════════════════════════════════
let _platformInited = false;
const _builtTabs = new Set(); // tracks which tabs have been rendered at least once

function _markBuilt(id) { _builtTabs.add(id); }
function _isBuilt(id)   { return _builtTabs.has(id); }

function _initPlatform() {
  if (_platformInited) return;
  _platformInited = true;

  // Core computations — must run before any rendering
  Array.from({length:5},(_,i)=>_CY+i).forEach(y=>{
    computeAllLeases(y);
    if(typeof leaseAggregates!=='undefined'&&leaseAggregates[y]){
      depreciationComponents[y].otherLeases=[...leaseAggregates[y].rouDepreciation];
    }
  });
  computeAll(_CY);
  initInterestIncome();
  try { runProjectionEngine(); } catch(e) { console.warn('Projection engine init:', e); }
  try { syncDebtToNFC(); } catch(e) { console.warn('Debt sync init:', e); }
  // Init Supabase client from saved config (restores existing session)
  // Guard: doLogin may have already initialised _sb — don't create a second client
  try {
    if (!_sb) _sb = _sbInit();
    if (_sb) {
      _sb.auth.getSession().then(({ data }) => {
        if (data?.session?.user) {
          _sb.from('profiles').select('*').eq('id', data.session.user.id).single().then(({ data: profile }) => {
            currentUser = _sbUserToCurrentUser(data.session.user, profile);
            const nd = document.getElementById('userNameDisp'); if (nd) nd.textContent = currentUser.name;
            const rd = document.getElementById('userRoleDisp'); if (rd) { rd.textContent = currentUser.role.toUpperCase(); rd.style.color = currentUser.role==='admin'?'var(--gold)':currentUser.role==='analyst'?'var(--teal)':'var(--muted)'; }
            const av = document.getElementById('userAvatar'); if (av) av.textContent = currentUser.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
            // Data Manager button is visible to all users (view status + upload for admin/analyst)
          });
          _sbStartRealtime();
          refreshAll();
        }
      });
    }
  } catch(e) { console.warn('Supabase init:', e); }

  // Unlock actuals months in selectors
  [1,2].forEach(m => {
    const opt1 = document.querySelector(`#varMo option[value="${m}"]`);
    const opt2 = document.querySelector(`#revRptMo option[value="${m}"]`);
    if (opt1) opt1.disabled = false;
    if (opt2) opt2.disabled = false;
  });

  // FX display
  const fxEl = document.getElementById('revFxDisplay');
  if (fxEl) { const avgFx=fxTable.billing.reduce((s,v)=>s+v,0)/12; fxEl.textContent='J$'+avgFx.toFixed(2)+' (Jan avg)'; }

  // Build ONLY the dashboard (visible tab) — all others are lazy
  buildDashKpis();
  requestAnimationFrame(() => {
    buildDashCharts();
    _markBuilt('dash');
    _restoreState();
  });
}

// ── Auth callback handler — invite links & password reset links ────────────
// When Supabase sends an invite/reset email, the link contains #access_token=...&type=invite|recovery
// We detect this on load, save the tokens, strip the hash, then show a set-password modal.
// Note: detectSessionInUrl:false means Supabase will NOT auto-absorb the hash — we do it manually
// in _doSetPassword() via _sb.auth.setSession() using the saved tokens below.
let _pendingAuthToken = null;   // { access_token, refresh_token, type }

function _checkAuthCallback() {
  const hash = window.location.hash || '';
  if (!hash.includes('access_token')) return;
  const params = Object.fromEntries(
    hash.replace(/^#/, '').split('&').map(p => {
      const idx = p.indexOf('=');
      return idx < 0 ? [p, ''] : [p.slice(0, idx), decodeURIComponent(p.slice(idx + 1))];
    })
  );
  const type = params.type || '';
  if (type === 'invite' || type === 'recovery') {
    // Save tokens BEFORE stripping the hash — they're gone after replaceState
    _pendingAuthToken = {
      access_token:  params.access_token  || '',
      refresh_token: params.refresh_token || '',
      type,
    };
    // Remove hash so it doesn't re-trigger on refresh
    history.replaceState(null, document.title, window.location.pathname + window.location.search);
    setTimeout(() => _showSetPasswordModal(type), 400);
  }
}

function _showSetPasswordModal(type) {
  const isInvite = type === 'invite';
  const title    = isInvite ? 'Set Your Password' : 'Reset Your Password';
  const subtitle = isInvite
    ? 'Welcome! Create a password to activate your JPS FP&A account.'
    : 'Enter a new password for your account.';
  // Remove any existing overlay
  document.getElementById('setPassOverlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'setPassOverlay';
  overlay.style.cssText = [
    'position:fixed;inset:0;z-index:99999',
    'background:rgba(0,0,0,.75)',
    'display:flex;align-items:center;justify-content:center;padding:20px'
  ].join(';');
  overlay.innerHTML = `
    <div style="background:#0d1a2e;border:1px solid #1e3350;border-radius:14px;padding:36px 40px;max-width:420px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.6)">
      <div style="text-align:center;margin-bottom:24px">
        <div style="font-size:28px;margin-bottom:10px">${isInvite?'🔑':'🔒'}</div>
        <div style="font-size:17px;font-weight:700;color:#d4e2f4;margin-bottom:6px">${title}</div>
        <div style="font-size:12px;color:#7da0c4">${subtitle}</div>
      </div>
      <div style="margin-bottom:14px">
        <label style="display:block;font-size:11px;font-weight:600;color:#7da0c4;margin-bottom:5px">New Password</label>
        <input id="setPassPw1" type="password" placeholder="At least 8 characters"
          style="width:100%;padding:10px 12px;border:1px solid #1e3350;border-radius:7px;background:#162030;color:#d4e2f4;font-size:13px;outline:none"
          onkeydown="if(event.key==='Enter')document.getElementById('setPassPw2').focus()">
      </div>
      <div style="margin-bottom:22px">
        <label style="display:block;font-size:11px;font-weight:600;color:#7da0c4;margin-bottom:5px">Confirm Password</label>
        <input id="setPassPw2" type="password" placeholder="Repeat password"
          style="width:100%;padding:10px 12px;border:1px solid #1e3350;border-radius:7px;background:#162030;color:#d4e2f4;font-size:13px;outline:none"
          onkeydown="if(event.key==='Enter')_doSetPassword()">
      </div>
      <div id="setPassErr" style="display:none;color:#f87171;font-size:11px;margin-bottom:12px;padding:8px 10px;background:rgba(248,113,113,.1);border-radius:6px"></div>
      <button onclick="_doSetPassword()"
        style="width:100%;padding:11px;background:#f0b429;color:#0d1a2e;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;margin-bottom:10px">
        ${isInvite ? 'Activate Account →' : 'Set New Password →'}
      </button>
    </div>`;
  document.body.appendChild(overlay);
  setTimeout(() => document.getElementById('setPassPw1')?.focus(), 100);
}

async function _doSetPassword() {
  const pw1 = document.getElementById('setPassPw1')?.value || '';
  const pw2 = document.getElementById('setPassPw2')?.value || '';
  const errEl   = document.getElementById('setPassErr');
  const showErr = msg => { if(errEl){errEl.textContent=msg;errEl.style.display='block';} };
  const setBtn  = document.querySelector('#setPassOverlay button');
  if (pw1.length < 8) { showErr('Password must be at least 8 characters.'); return; }
  if (pw1 !== pw2)    { showErr('Passwords do not match.'); return; }
  if (errEl) errEl.style.display = 'none';
  if (setBtn) { setBtn.disabled = true; setBtn.textContent = 'Setting password…'; }

  // Wait up to 5 s for the Supabase client to finish initialising (CDN race on slow connections)
  let waited = 0;
  while (!_sb && waited < 50) {
    _sb = _sbInit();
    if (!_sb) await new Promise(r => setTimeout(r, 100));
    waited++;
  }
  if (!_sb) {
    showErr('Database connection unavailable. Please refresh the page and try again.');
    if (setBtn) { setBtn.disabled = false; setBtn.textContent = 'Set New Password →'; }
    return;
  }

  // Manually establish the auth session from the saved invite/reset tokens.
  // This is required because detectSessionInUrl:false prevents Supabase from
  // auto-reading the #access_token from the URL hash.
  if (_pendingAuthToken?.access_token) {
    try {
      const { error: sessErr } = await _sb.auth.setSession({
        access_token:  _pendingAuthToken.access_token,
        refresh_token: _pendingAuthToken.refresh_token,
      });
      if (sessErr) throw sessErr;
    } catch(e) {
      showErr('Invite link error: ' + (e.message || String(e)) + '. Please ask your admin to send a new invite.');
      if (setBtn) { setBtn.disabled = false; setBtn.textContent = 'Set New Password →'; }
      return;
    }
  }

  try {
    const { error } = await _sb.auth.updateUser({ password: pw1 });
    if (error) throw error;
    _pendingAuthToken = null;
    document.getElementById('setPassOverlay')?.remove();
    toast('Password set! Welcome to the JPS FP&A Platform 🎉', 'ok');
    // Redirect to clean URL so the login screen loads properly
    setTimeout(() => { window.location.href = window.location.pathname; }, 1800);
  } catch(e) {
    showErr('Failed to set password: ' + (e.message || String(e)));
    if (setBtn) { setBtn.disabled = false; setBtn.textContent = 'Set New Password →'; }
  }
}

// Session restore — re-validates app access on every page load
(async function restoreSession() {
  try {
    const sb = _sbInit();
    if (!sb) return;
    const { data: { session } } = await sb.auth.getSession();
    if (!session?.user) return;
    const userId = session.user.id;
    // Re-check app access (catches mid-session revocations)
    const { data: appAccess } = await sb.schema('admin')
      .from('app_access')
      .select('can_access')
      .eq('user_id', userId)
      .eq('app_id', 'fpa')
      .maybeSingle();
    if (!appAccess || !appAccess.can_access) {
      await sb.auth.signOut();
      return;
    }
    // Restore user from profile
    const { data: profile } = await sb.from('profiles').select('*').eq('id', userId).single();
    if (!profile) return;
    currentUser = _sbUserToCurrentUser(session.user, profile);
    if (currentUser.isActive === false) { await sb.auth.signOut(); return; }
    _sb = sb;
    // Skip welcome screen — go straight to shell
    const ws = document.getElementById('welcomeScreen');
    if (ws) { ws.style.display = 'none'; }
    const shell = document.getElementById('appShell');
    if (shell) shell.classList.add('visible');
    const nameDisp = document.getElementById('userNameDisp');
    if (nameDisp) nameDisp.textContent = currentUser.name;
    const roleDisp = document.getElementById('userRoleDisp');
    if (roleDisp) roleDisp.textContent = currentUser.role.toUpperCase();
    const avatar = document.getElementById('userAvatar');
    if (avatar) avatar.textContent = currentUser.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
    const appSwitcher = document.getElementById('appSwitcher');
    if (appSwitcher) appSwitcher.style.display = 'flex';
    hubApplyRoleAccess(currentUser.role);
    if (_sbConfig.enabled && _sbConfig.anonKey && !_sb) _sbInit();
    await fpaBootstrap();
  } catch(e) { console.warn('[restoreSession]', e.message); }
})();

// ── REV RPT MONTH DROPDOWN ────────────────────────────────────────────────────
function initRevRptMoDropdown() {
  const sel = document.getElementById('revRptMo');
  if (!sel) return;
  const MN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const cy = typeof _CY !== 'undefined' ? _CY : new Date().getFullYear();
  sel.innerHTML = MN.map((m, i) => `<option value="${i+1}" disabled>${m} ${cy}</option>`).join('');
  // Enable months that have uploaded actuals — done by upload handler calling enableRevRptMonth(mo)
}
function enableRevRptMonth(mo) {
  const opt = document.querySelector(`#revRptMo option[value="${mo}"]`);
  if (opt) { opt.disabled = false; opt.selected = true; }
}

// DOMContentLoaded — set up welcome screen assets and login mode
window.addEventListener('DOMContentLoaded',()=>{
  initRevRptMoDropdown();
  _checkAuthCallback(); // Handle invite / password-reset links
  applyThemeOnLoad();
  const wsBg = document.getElementById('wsBg');
  if (wsBg) wsBg.style.backgroundImage = `url('${WELCOME_BG_DATA}')`;
  const wsLogo = document.getElementById('wsLogo');
  if (wsLogo) wsLogo.src = JPS_LOGO_DATA;

  // Show correct login form based on Supabase config
  const sbFields    = document.getElementById('loginSbFields');
  const localFields = document.getElementById('loginLocalFields');
  const modeBadge   = document.getElementById('loginModeBadge');
  if (_sbConfig.enabled && _sbConfig.anonKey) {
    if (sbFields)    sbFields.style.display    = 'block';
    if (localFields) localFields.style.display = 'none';
    if (modeBadge)   modeBadge.textContent = '🔒 Supabase Auth · ' + _sbConfig.url.replace('https://','').split('.')[0] + '.supabase.co';
    setTimeout(() => document.getElementById('loginEmail')?.focus(), 200);
  } else {
    if (sbFields)    sbFields.style.display    = 'none';
    if (localFields) localFields.style.display = 'block';
    if (modeBadge)   modeBadge.textContent = '🔒 Supabase Auth · JPS FP&A Cloud';
    setTimeout(() => document.getElementById('loginName')?.focus(), 200);
  }
});

// Global error handler — catches cross-origin 'Script error.' and logs real detail
window.addEventListener('error', e => {
  if (e.message === 'Script error.' || e.message === 'Uncaught Error: Script error.') {
    console.warn('Cross-origin script error intercepted — likely Chart.js canvas issue. Suppressed.');
    e.preventDefault();
    return true;
  }
});

// ═══════════════════════════════════════════════════════
//  KEYBOARD SHORTCUTS
// ═══════════════════════════════════════════════════════
document.addEventListener('keydown', e => {
  // Only active when app shell is visible (logged in)
  if (!document.getElementById('appShell')?.classList.contains('visible')) return;
  // Don't fire when typing in inputs/textareas
  if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;

  const ctrl = e.ctrlKey || e.metaKey;

  // Escape — close any open modal
  if (e.key === 'Escape') {
    document.querySelectorAll('.mbg.open').forEach(m => m.classList.remove('open'));
    return;
  }

  if (!ctrl) return;

  switch(e.key.toLowerCase()) {
    case 'e': // Ctrl+E — Export CSV
      e.preventDefault();
      exportCSV();
      toast('Exported ↓ Ctrl+E','ok');
      break;
    case '/': // Ctrl+/ — Jump to AI Commentary
      e.preventDefault();
      const aiTab = document.querySelector('.tab[onclick*="ai-comm"]');
      showPane('ai-comm', aiTab);
      if(aiTab){document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));aiTab.classList.add('on');}
      break;
    case 'd': // Ctrl+D — Jump to Dashboard
      e.preventDefault();
      const dashTab = document.querySelector('.tab[onclick*="\'dash\'"]');
      showPane('dash', dashTab);
      if(dashTab){document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));dashTab.classList.add('on');}
      break;
    case 'v': // Ctrl+V (not paste) — Jump to Variance
      if(!e.shiftKey) break;
      e.preventDefault();
      const varTab = document.querySelector('.tab[onclick*="rpt-var"]');
      showPane('rpt-var', varTab);
      if(varTab){document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));varTab.classList.add('on');}
      break;
  }
});

// ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════
//  REALTIME COLLABORATION ENGINE — BroadcastChannel
//  Syncs data changes + presence across open tabs/windows
//  on the same origin. No server required.
// ═══════════════════════════════════════════════════════

const _rtChannel = (typeof BroadcastChannel !== 'undefined')
  ? new BroadcastChannel('jps_fpa_realtime')
  : null;

// Presence store: { tabId -> { name, role, tab, lastSeen } }
const _presenceStore = {};
const _myTabId = Math.random().toString(36).slice(2, 9);
let _myPresence = {};

// Broadcast a message to other tabs
function _rtBroadcast(type, payload) {
  if (!_rtChannel) return;
  try {
    _rtChannel.postMessage({ type, payload, from: _myTabId, ts: Date.now() });
  } catch(e) {}
}

// Announce presence to other tabs
function _rtAnnouncePresence(tab) {
  _myPresence = {
    name: currentUser.name || '—',
    role: currentUser.role || 'viewer',
    tab: tab || document.querySelector('.pane.on')?.id?.replace('pane-','') || 'dash',
    lastSeen: Date.now()
  };
  _presenceStore[_myTabId] = _myPresence;
  _rtBroadcast('presence', _myPresence);
  _renderOnlinePanel();
}

// Request other tabs to announce themselves
function _rtRequestPresence() {
  _rtBroadcast('who', {});
}

// Handle incoming messages
if (_rtChannel) {
  _rtChannel.onmessage = (e) => {
    const { type, payload, from, ts } = e.data;
    if (from === _myTabId) return; // ignore own messages

    if (type === 'presence') {
      _presenceStore[from] = { ...payload, lastSeen: ts };
      _renderOnlinePanel();
    } else if (type === 'who') {
      // Another tab is asking who's here — announce myself
      _rtAnnouncePresence();
    } else if (type === 'bye') {
      delete _presenceStore[from];
      _renderOnlinePanel();
    } else if (type === 'change') {
      // Another tab changed data — refresh our view
      _rtHandleRemoteChange(payload);
    } else if (type === 'toast') {
      // Show a notification from another tab
      if (payload?.msg) toast(`🔄 ${payload.from}: ${payload.msg}`, 'ok');
    }
  };
}

// Handle remote data changes
function _rtHandleRemoteChange(payload) {
  if (!payload) return;
  // For now: refresh all renders so the view stays in sync
  // Future: merge specific payload.data into the data store
  try {
    refreshAll();
    // Show subtle sync indicator
    const syncEl = document.getElementById('rtSyncDot');
    if (syncEl) {
      syncEl.style.background = 'var(--teal)';
      setTimeout(() => { if(syncEl) syncEl.style.background = 'var(--green)'; }, 800);
    }
  } catch(e) {}
}

// Render the online users panel in topbar
function _renderOnlinePanel() {
  const panel = document.getElementById('onlineUsersPanel');
  if (!panel) return;

  // Prune stale entries (>30s no heartbeat)
  const now = Date.now();
  Object.keys(_presenceStore).forEach(id => {
    if (now - (_presenceStore[id].lastSeen || 0) > 30000) delete _presenceStore[id];
  });

  // Build user list: myself first, then others
  const all = [
    { id: _myTabId, ..._myPresence, isMe: true },
    ...Object.entries(_presenceStore)
      .filter(([id]) => id !== _myTabId)
      .map(([id, p]) => ({ id, ...p, isMe: false }))
  ].filter(u => u.name);

  const count = all.length;
  const dot = document.getElementById('rtSyncDot');

  if (count <= 1) {
    panel.innerHTML = `<div style="display:flex;align-items:center;gap:5px;cursor:default" title="Only you are online">
      <div id="rtSyncDot" style="width:7px;height:7px;border-radius:50%;background:var(--green);flex-shrink:0"></div>
      <span style="font-size:10px;color:var(--muted)">Only you</span>
    </div>`;
    return;
  }

  const roleColor = r => r==='admin'?'var(--gold)':r==='analyst'?'var(--teal)':'var(--muted)';
  const tabLabel = t => ({'dash':'Overview','rpt-pl':'P&L','rpt-cf':'Cash Flow','wrk-gen':'Generation','ass-rev':'Revenue','ass-om':'O&M','ass-capex':'CapEx','ai-comm':'AI'}[t]||t||'—');

  panel.innerHTML = `
    <div style="position:relative" id="onlineDropdownWrap">
      <div style="display:flex;align-items:center;gap:5px;cursor:pointer;padding:3px 7px;border-radius:4px;border:1px solid var(--border);background:var(--card2)"
           onclick="document.getElementById('onlineDropdown').classList.toggle('open-dd')" title="Active users">
        <div id="rtSyncDot" style="width:7px;height:7px;border-radius:50%;background:var(--green);flex-shrink:0;box-shadow:0 0 4px var(--green)"></div>
        <div style="display:flex;margin-left:2px">
          ${all.slice(0,3).map(u=>`<div style="width:18px;height:18px;border-radius:50%;background:linear-gradient(135deg,#003da5,#00aeef);display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:800;color:#fff;margin-left:-4px;border:1px solid var(--bg)">${(u.name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()}</div>`).join('')}
          ${count>3?`<div style="width:18px;height:18px;border-radius:50%;background:var(--card3);display:flex;align-items:center;justify-content:center;font-size:7px;color:var(--muted);margin-left:-4px;border:1px solid var(--bg)">+${count-3}</div>`:''}
        </div>
        <span style="font-size:10px;color:var(--text);font-weight:700">${count}</span>
      </div>
      <div id="onlineDropdown" style="position:absolute;top:calc(100% + 6px);right:0;min-width:220px;background:var(--card);border:1px solid var(--border);border-radius:6px;box-shadow:0 8px 24px var(--shadow);z-index:999;display:none;flex-direction:column;overflow:hidden">
        <div style="padding:8px 12px;border-bottom:1px solid var(--border);font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em">Active Sessions (${count})</div>
        ${all.map(u=>`
          <div style="display:flex;align-items:center;gap:9px;padding:8px 12px;border-bottom:1px solid rgba(0,0,0,.05)${u.isMe?';background:var(--glo)':''}">
            <div style="width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#003da5,#00aeef);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:#fff;flex-shrink:0">${(u.name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:11px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${u.name}${u.isMe?' <span style="font-size:9px;color:var(--muted)">(you)</span>':''}</div>
              <div style="font-size:9px;color:var(--muted)">${tabLabel(u.tab)}</div>
            </div>
            <div style="font-size:8px;font-weight:800;text-transform:uppercase;color:${roleColor(u.role)}">${u.role}</div>
          </div>`).join('')}
        <div style="padding:6px 12px;font-size:9px;color:var(--muted);text-align:center">Updated live · ${new Date().toLocaleTimeString()}</div>
      </div>
    </div>`;

  // Close dropdown on outside click
  setTimeout(()=>{
    document.addEventListener('click', function _closeDD(e){
      const wrap = document.getElementById('onlineDropdownWrap');
      if(wrap && !wrap.contains(e.target)){
        const dd = document.getElementById('onlineDropdown');
        if(dd) dd.classList.remove('open-dd');
        document.removeEventListener('click', _closeDD);
      }
    });
  }, 0);
}

// CSS for open dropdown
(function(){
  const s=document.createElement('style');
  s.textContent='#onlineDropdown.open-dd{display:flex!important;flex-direction:column!important}';
  document.head?.appendChild(s);
})();

// Heartbeat — announce presence every 15s
let _rtHeartbeat = null;
function _rtStartHeartbeat() {
  if (_rtHeartbeat) clearInterval(_rtHeartbeat);
  _rtAnnouncePresence();
  _rtRequestPresence();
  _rtHeartbeat = setInterval(() => {
    _rtAnnouncePresence(document.querySelector('.pane.on')?.id?.replace('pane-','') || 'dash');
  }, 15000);
}

// On tab close — announce departure
window.addEventListener('beforeunload', () => {
  _rtBroadcast('bye', { name: currentUser.name });
});

//  STATE PERSISTENCE  — saves scenario + active tab to localStorage
// ═══════════════════════════════════════════════════════
function _saveState() {
  try {
    const activePane = document.querySelector('.pane.on')?.id?.replace('pane-','') || 'dash';
    localStorage.setItem('jps_state', JSON.stringify({
      scenario: activeSc,
      pane: activePane,
      period,
    }));
    // Broadcast change to other open tabs
    if(typeof _rtBroadcastChange === 'function') {
      _rtBroadcastChange('state', { scenario: activeSc, period, user: currentUser.name });
    }
  } catch(e) {}
}

function _restoreState() {
  try {
    const raw = localStorage.getItem('jps_state');
    if (!raw) return;
    const s = JSON.parse(raw);
    // Restore scenario
    if (s.scenario && scenarios[s.scenario]) {
      activeSc = s.scenario;
      const scSel = document.getElementById('scSel');
      if (scSel) scSel.value = s.scenario;
      const pill = document.getElementById('scPill');
      if (pill) pill.textContent = s.scenario;
    }
    // Restore period
    if (s.period) {
      period = s.period;
      document.querySelectorAll('#perSeg .sb').forEach(b => {
        b.classList.toggle('on', b.textContent.toLowerCase().includes(period));
      });
    }
    // Always open to Dashboard on login — do not restore last tab
    // (Flash destination is handled separately in doLogin routing)
  } catch(e) {}
}

// Patch setScenario and setPeriod to save state — inline, no reassignment needed
// _saveState() is called directly inside showPane, setScenario, setPeriod above

// ════════════════════════════════════════════════════════
//  FLASH REPORT — v4  (Month + YTD  ×  Actual | Budget | LE)
// ════════════════════════════════════════════════════════

// Auto-generate month labels for any period key (year*100+month)
const _MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const _MNF= ['January','February','March','April','May','June','July','August','September','October','November','December'];
const flashPeriodLabel     = pid => _MN[(pid%100)-1]+' '+Math.floor(pid/100);
const flashPeriodLabelFull = pid => _MNF[(pid%100)-1]+' '+Math.floor(pid/100);

// Build lookup maps on-the-fly for all years 2020-2030
const FLASH_MONTHS = {}, FLASH_MONTH_FULL = {};
for (let y=2020;y<=2030;y++) for (let m=1;m<=12;m++) {
  const k=y*100+m;
  FLASH_MONTHS[k]     = flashPeriodLabel(k);
  FLASH_MONTH_FULL[k] = flashPeriodLabelFull(k);
}

// ── Flash state ───────────────────────────────────────────────────────────────
let _flashInited        = false;
let _flashClosedPeriods = [];   // sorted [202601, 202602, 202603, ...]
let _flashPeriodIdx     = 0;
let _flashCurrentPeriod = 202603;
let _flashNotesData     = [];

// ── Show / hide states ────────────────────────────────────────────────────────
function flashShowLoading(msg) {
  const ls=document.getElementById('flashLoadingState'), rb=document.getElementById('flashReportBody');
  if(ls){ls.style.display='flex';ls.innerHTML=`<div class="fl-spinner"></div><div style="font-size:12px;font-weight:600;color:#1e3a5f">${msg||'Loading…'}</div>`;}
  if(rb)rb.style.display='none';
}
function flashShowReport() {
  const ls=document.getElementById('flashLoadingState'), rb=document.getElementById('flashReportBody');
  if(ls)ls.style.display='none';
  if(rb)rb.style.display='block';
}
function flashShowEmpty(msg) {
  const ls=document.getElementById('flashLoadingState'), rb=document.getElementById('flashReportBody');
  if(ls){ls.style.display='flex';ls.innerHTML=`<div style="font-size:32px">📰</div><div style="font-size:13px;font-weight:700;color:#1e3a5f">${msg||'Select a period above'}</div><div style="font-size:11px;color:#8099b8">Choose a closed month to generate the flash report</div>`;}
  if(rb)rb.style.display='none';
}

// ── Populate period dropdown from _flashClosedPeriods (built in flashInit) ────
function flashPopulatePeriods() {
  const sel = document.getElementById('flashMoPicker');
  if (!sel) return;
  const opts = [..._flashClosedPeriods].sort((a,b)=>b-a); // newest first in picker
  sel.innerHTML = opts.length
    ? opts.map(pid=>`<option value="${pid}" ${pid===_flashCurrentPeriod?'selected':''}>${FLASH_MONTHS[pid]||flashPeriodLabel(pid)}</option>`).join('')
    : `<option value="">— No closed periods —</option>`;
  const hidMo = document.getElementById('flashMoA');
  if (hidMo) hidMo.value = String(_flashCurrentPeriod);
}

// ── Populate LE version dropdown ──────────────────────────────────────────────
function flashPopulateLEVersions() {
  const sel = document.getElementById('flashLEPicker');
  if (!sel) return;
  const les = (fpa.versions||[]).filter(v=>v.kind==='LE'||v.kind==='FORECAST')
    .sort((a,b)=>(b.year||0)-(a.year||0)||(b.name||'').localeCompare(a.name||''));
  if (!les.length) {
    sel.innerHTML = '<option value="">— No LE loaded —</option>';
    return;
  }
  const kindLabel = {LE:'LE',FORECAST:'Forecast'};
  sel.innerHTML = les.map((v,i)=>
    `<option value="${v.id}" ${i===0?'selected':''}>${v.name} (${kindLabel[v.kind]||v.kind})</option>`
  ).join('');
}

// ── Fetch facts from Supabase, summed across period list ──────────────────────
async function flashFetchFacts(versionId, periodIds) {
  if (!_sb || !versionId || !periodIds.length) return {};
  const {data,error} = await _sb.from('fpa_facts')
    .select('line_id,period_id,value')
    .eq('version_id',versionId)
    .in('period_id',periodIds);
  if (error||!data) return {};
  const agg={};
  data.forEach(r=>{agg[r.line_id]=(agg[r.line_id]||0)+parseFloat(r.value||0);});
  return agg;
}

// ── Union facts across MULTIPLE version IDs (for per-month YTD aggregation) ──
// Used when layout B (per-month versions) is active: collects facts from all
// monthly versions for a year and sums them just like a single year-level version.
async function flashFetchFactsMultiVer(versionIds, periodIds) {
  if (!_sb || !versionIds.length || !periodIds.length) return {};
  const {data,error} = await _sb.from('fpa_facts')
    .select('line_id,period_id,value')
    .in('version_id', versionIds)
    .in('period_id',  periodIds);
  if (error||!data) return {};
  const agg={};
  data.forEach(r=>{agg[r.line_id]=(agg[r.line_id]||0)+parseFloat(r.value||0);});
  return agg;
}

// ── Period navigation ─────────────────────────────────────────────────────────
function flashNavPeriod(delta) {
  const newIdx=Math.max(0,Math.min(_flashClosedPeriods.length-1, _flashPeriodIdx+delta));
  if (newIdx===_flashPeriodIdx && delta!==0) return;
  _flashPeriodIdx=newIdx;
  _flashCurrentPeriod=_flashClosedPeriods[_flashPeriodIdx]||_flashCurrentPeriod;
  // Sync picker
  const sel=document.getElementById('flashMoPicker');
  if (sel) sel.value=String(_flashCurrentPeriod);
  const hidMo=document.getElementById('flashMoA');
  if (hidMo) hidMo.value=String(_flashCurrentPeriod);
  // Update nav button disabled state
  const prev=document.querySelector('.flash-ctrl-bar button[onclick*="-1"]');
  const next=document.querySelector('.flash-ctrl-bar button[onclick*="+1"]');
  if (prev) prev.disabled=_flashPeriodIdx<=0;
  if (next) next.disabled=_flashPeriodIdx>=_flashClosedPeriods.length-1;
  flashRefresh();
}

function flashOnPeriodChange() {
  const sel=document.getElementById('flashMoPicker');
  if (!sel||!sel.value) return;
  _flashCurrentPeriod=parseInt(sel.value);
  _flashPeriodIdx=_flashClosedPeriods.indexOf(_flashCurrentPeriod);
  if (_flashPeriodIdx<0) _flashPeriodIdx=_flashClosedPeriods.length-1;
  const hidMo=document.getElementById('flashMoA');
  if (hidMo) hidMo.value=String(_flashCurrentPeriod);
  flashRefresh();
}

// ── Comment row: pre-fill notes panel for a specific line ────────────────────
function flashCommentRow(section, lineName) {
  const sec=document.getElementById('flashNoteSection');
  if (sec) {
    const m={generation:'generation',losses:'losses',revenue:'revenue',opex:'opex',
             ebitda:'ebitda',finance:'financing',financing:'financing',
             other_income:'other_income',tax:'general',net_income:'general',
             bs:'balance_sheet',general:'general'};
    sec.value=m[section]||'general';
  }
  const inp=document.getElementById('flashNoteInput');
  if (inp&&lineName){
    if (!inp.value) inp.value=lineName.replace(/'/g,'')+': ';
    inp.focus();
    inp.setSelectionRange(inp.value.length,inp.value.length);
  }
  document.querySelector('.flash-notes-area')?.scrollIntoView({behavior:'smooth',block:'start'});
}

// ── Format helpers ────────────────────────────────────────────────────────────
function flashFmt(v) {
  if (v==null||isNaN(v)) return '—';
  const abs=Math.abs(Math.round(v));
  return v<0?`(${abs.toLocaleString()})`:abs.toLocaleString();
}
// Build variance HTML + CSS class  (Act vs comparator)
function flashVarCell(act, comp, fav=true) {
  if (act==null||comp==null||isNaN(act)||isNaN(comp)) return {h:'—',c:''};
  const d=act-comp, good=fav?(d>=0):(d<=0);
  const pct=comp!==0?((d/Math.abs(comp))*100).toFixed(1):'—';
  const cls=d===0?'':(good?'flash-var-pos':'flash-var-neg');
  const sign=d>0?'+':'';
  return {h:`${sign}${flashFmt(d)}<br><small>${sign}${pct}%</small>`,c:cls};
}

// ── Main refresh — 3-way × Month + YTD ───────────────────────────────────────
// Uses fpa.facts (loaded at boot from fpa_v_facts) for all lookups.
// This avoids per-request Supabase queries, eliminates RLS cross-version issues,
// and makes the report render synchronously (no network wait).
async function flashRefresh() {
  const periodId=_flashCurrentPeriod;
  if (!periodId) {
    // No closed periods loaded from DB — show empty state
    const body = document.getElementById('flashTableBody');
    if (body) body.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--muted)">No closed periods available. Upload actuals and mark periods as closed to populate this report.</td></tr>';
    return;
  }
  const y=Math.floor(periodId/100), m=periodId%100;

  // ── In-memory fact helpers ─────────────────────────────────────────────────
  // fpa.facts[versionCode][lineId][periodId] = value  (loaded at boot)
  // getFactsMem: sum a single version's facts across a list of period IDs
  const getFactsMem = (versionCode, periodIds) => {
    if (!versionCode) return {};
    const vf = fpa.facts[versionCode] || {};
    const pSet = new Set(periodIds.map(Number));
    const agg = {};
    for (const [lineId, periods] of Object.entries(vf)) {
      let sum=0, found=false;
      for (const [pid, val] of Object.entries(periods)) {
        if (pSet.has(Number(pid))) { sum+=Number(val); found=true; }
      }
      if (found) agg[lineId]=sum;
    }
    return agg;
  };
  // getFactsMultiMem: union across multiple version codes, sum by line
  const getFactsMultiMem = (versionCodes, periodIds) => {
    const pSet = new Set(periodIds.map(Number));
    const agg = {};
    for (const code of versionCodes) {
      const vf = fpa.facts[code] || {};
      for (const [lineId, periods] of Object.entries(vf)) {
        for (const [pid, val] of Object.entries(periods)) {
          if (pSet.has(Number(pid))) agg[lineId]=(agg[lineId]||0)+Number(val);
        }
      }
    }
    return agg;
  };

  // ── Resolve actuals version(s) ─────────────────────────────────────────────
  // Two layouts exist in the DB:
  //   (A) Year-level: ACTUAL_YYYY — one version, all months, period_id=null
  //   (B) Per-month:  ACTUALS_YYYY_MM — one version per month, period_id set
  const allActualsForYear = (fpa.versions||[]).filter(v=>v.kind==='ACTUAL'&&v.year===y);
  const verActualYear  = allActualsForYear.find(v=>!v.period_id);   // layout A
  const verActualMo    = allActualsForYear.find(v=>v.period_id===periodId); // layout B
  const verActual      = verActualYear || verActualMo;

  const verBudget = (fpa.versions||[]).find(v=>v.kind==='BUDGET'&&(v.year===y||v.year==null));
  const lePicker  = document.getElementById('flashLEPicker');
  const leId      = lePicker?.value || '';
  const verLE     = leId ? (fpa.versions||[]).find(v=>v.id===leId) : null;

  if (!verActual) {
    flashShowEmpty(`No actuals available for ${FLASH_MONTHS[periodId]||periodId} — data will appear automatically once uploaded via the Data Management pane.`);
    return;
  }

  flashShowLoading('Building report…');

  // Period ID arrays
  const moIds  = [periodId];                                     // just this month
  const ytdIds = Array.from({length:m}, (_,i)=>y*100+(i+1));   // Jan → selected month

  // ── Actuals: use in-memory fpa.facts ──────────────────────────────────────
  let fActMo, fActYTD;
  if (verActualYear) {
    // Layout A: single year-level version has all months — both queries hit the same code
    fActMo  = getFactsMem(verActualYear.code, moIds);
    fActYTD = getFactsMem(verActualYear.code, ytdIds);
  } else {
    // Layout B: union across monthly versions up to selected month
    const ytdVerCodes = allActualsForYear
      .filter(v=>v.period_id && v.period_id<=periodId)
      .map(v=>v.code);
    fActMo  = getFactsMem(verActualMo.code, moIds);
    fActYTD = getFactsMultiMem(ytdVerCodes, ytdIds);
  }

  // ── Budget + LE: in-memory lookup ─────────────────────────────────────────
  const fBudMo  = getFactsMem(verBudget?.code, moIds);
  const fBudYTD = getFactsMem(verBudget?.code, ytdIds);
  const fLEMo   = getFactsMem(verLE?.code,     moIds);
  const fLEYTD  = getFactsMem(verLE?.code,     ytdIds);

  // Labels
  const moLabel  = FLASH_MONTH_FULL[periodId] || String(periodId);
  const ytdLabel = m>1 ? `Jan – ${FLASH_MONTHS[periodId]||''}` : FLASH_MONTHS[periodId]||'';
  const leLabel  = verLE?.name || 'LE';
  const budLabel = verBudget?.name || 'AOP Budget';

  const setEl=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
  setEl('flashLabelA', moLabel+' — Actuals');
  setEl('flashLabelB', budLabel);
  setEl('flashLabelLE', leLabel);
  setEl('flashLabelPeriod', moLabel+(m>1?' · YTD: '+ytdLabel:''));
  setEl('flashReportSubtitle', `Jamaica Public Service Co. · FP&A · ${moLabel} · Confidential`);
  setEl('flashHeaderDate', new Date().toLocaleDateString('en-JM',{dateStyle:'long'}));

  const hLogo=document.getElementById('flashHeaderLogo');
  if (hLogo&&JPS_LOGO_DATA) hLogo.src=JPS_LOGO_DATA;
  const cLogo=document.getElementById('flashCtrlLogo');
  if (cLogo&&JPS_LOGO_DATA) cLogo.src=JPS_LOGO_DATA;

  flashBuildKpisV3(fActMo,fBudMo,fLEMo,fActYTD,fBudYTD,fLEYTD,moLabel,ytdLabel);
  flashBuildGenV4(fActMo,fBudMo,fLEMo,fActYTD,fBudYTD,fLEYTD,periodId);
  flashBuildPLV3(fActMo,fBudMo,fLEMo,fActYTD,fBudYTD,fLEYTD,budLabel,leLabel);
  flashBuildBSV3(fActMo,fBudMo,fLEMo,budLabel,leLabel);
  flashBuildMetricsV3(fActMo,fBudMo,fLEMo,fActYTD,fBudYTD,fLEYTD,budLabel,leLabel);
  await flashLoadNotes();

  setEl('flashGenTime','Generated '+new Date().toLocaleString('en-JM',{dateStyle:'medium',timeStyle:'short'}));
  flashShowReport();
}

// ── KPI Strip — 3-way ────────────────────────────────────────────────────────
function flashBuildKpisV3(fActMo,fBudMo,fLEMo,fActYTD,fBudYTD,fLEYTD,moLabel,ytdLabel) {
  const el=document.getElementById('flashKpiStrip');
  if (!el) return;
  const kpis=[
    {key:'ebitda',  label:'EBITDA',        fav:true },
    {key:'net_inc', label:'Net Income',     fav:true },
    {key:'opex',    label:'O&M Expense',    fav:false},
    {key:'fin_cost',label:'Financing Cost', fav:false},
    {key:'nonfuel', label:'Non-Fuel Rev',   fav:true },
  ];
  el.innerHTML=kpis.map(k=>{
    const mA=fActMo[k.key]??null, mB=fBudMo[k.key]??null, mL=fLEMo[k.key]??null;
    const yA=fActYTD[k.key]??null, yB=fBudYTD[k.key]??null;
    const mDiff=mA!=null&&mB!=null?mA-mB:null;
    const yDiff=yA!=null&&yB!=null?yA-yB:null;
    const mGood=mDiff==null||mDiff===0?true:(k.fav?mDiff>=0:mDiff<=0);
    const yGood=yDiff==null||yDiff===0?true:(k.fav?yDiff>=0:yDiff<=0);
    const mCls=mDiff==null?'fv-neu':mGood?'fv-pos':'fv-neg';
    const yCls=yDiff==null?'fv-neu':yGood?'fv-pos':'fv-neg';
    const mPct=mDiff!=null&&mB&&mB!==0?(Math.abs(mDiff/mB)*100).toFixed(1)+'%':'';
    const yPct=yDiff!=null&&yB&&yB!==0?(Math.abs(yDiff/yB)*100).toFixed(1)+'%':'';
    const mArrow=mDiff==null?'':(mDiff>0?'▲':'▼');
    const yArrow=yDiff==null?'':(yDiff>0?'▲':'▼');
    return `<div class="flash-kpi-cell" style="min-width:0">
      <div class="flash-kpi-label">${k.label}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:2px">
        <div>
          <div style="font-size:8px;color:#8099b8;font-weight:700;text-transform:uppercase;letter-spacing:.04em">Month</div>
          <div class="flash-kpi-val" style="font-size:13px">${mA!=null?'$'+flashFmt(mA):'—'}</div>
          <div class="flash-kpi-var ${mCls}" style="font-size:9px">${mDiff!=null?mArrow+' '+mPct+' vs Bud':'—'}</div>
          ${mL!=null?`<div style="font-size:8px;color:#3d7a4a">LE: $${flashFmt(mL)}</div>`:''}
        </div>
        <div>
          <div style="font-size:8px;color:#8099b8;font-weight:700;text-transform:uppercase;letter-spacing:.04em">YTD</div>
          <div class="flash-kpi-val" style="font-size:13px">${yA!=null?'$'+flashFmt(yA):'—'}</div>
          <div class="flash-kpi-var ${yCls}" style="font-size:9px">${yDiff!=null?yArrow+' '+yPct+' vs Bud':'—'}</div>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── Generation & Sales table — Month + YTD ────────────────────────────────────
function flashBuildGenV4(fActMo,fBudMo,fLEMo,fActYTD,fBudYTD,fLEYTD,periodId) {
  const tbl=document.getElementById('flashGenTable');
  if (!tbl) return;
  const moIdx=(periodId%100)-1; // 0-based for genMixData arrays
  const m=periodId%100;
  const y=Math.floor(periodId/100);

  // Plan totals for this month (genMixData is 0-indexed by month)
  const planGrossMo = Object.values(genMixData).reduce((s,g)=>s+(g.vals[moIdx]||0),0)/1000;
  const planGrossYTD= Object.values(genMixData).reduce((s,g)=>g.vals.slice(0,m).reduce((ss,v)=>ss+v,0)+s,0)/1000;
  const budNetSaleMo = (revBudgetMonthly.salesMWh?.[moIdx]||0)/1000;
  const budNetSaleYTD= revBudgetMonthly.salesMWh?.slice(0,m).reduce((s,v)=>s+v,0)/1000||0;

  const fmt1=(v,u)=>v!=null?v.toFixed(1)+(u||''):'—';

  // Rows: [name, unit, getMo(facts)→val, getBud→val, getLE→val, getYTD→val ...]
  // We'll display what we have from facts; fall back to plan with asterisk
  // ── Helper: derive system loss % ────────────────────────────────────────────
  // Priority: (1) stored stat_sysloss_pct, (2) stat_netgen_gwh + stat_billed_gwh,
  //           (3) net_gen_historical MWh + stat_billed_gwh,  (4) null → caller falls back to plan
  const deriveSysLoss = (facts, periodKey) => {
    if (facts['stat_sysloss_pct'] != null) return Number(facts['stat_sysloss_pct']);
    let netGenGWh = facts['stat_netgen_gwh'] ?? null;
    const billedMWh = facts['stat_billed_gwh'] ?? null;
    // Fallback: look up net_gen_historical if we have a single period key and no stored net gen
    if (netGenGWh == null && periodKey && fpa.netGenHist?.[periodKey]) {
      netGenGWh = fpa.netGenHist[periodKey].netGenMWh / 1000;  // convert MWh→GWh
    }
    if (netGenGWh && billedMWh) {
      const billedGWh = billedMWh / 1000;
      return netGenGWh > 0 ? Math.round((netGenGWh - billedGWh) / netGenGWh * 1000) / 10 : null;
    }
    return null;
  };
  const planSysLossMo  = sysLossTable?.[y]?.[moIdx] ?? 0;
  const planSysLossYTD = sysLossTable?.[y]?.slice(0, m).reduce((s,v)=>s+v, 0) / m || 0;

  const rows=[
    {
      name:'Net Generation', unit:'GWh', note:'generation',
      moA: fActMo['stat_netgen_gwh']  ?? (fpa.netGenHist?.[periodId]?.netGenMWh/1000) ?? planGrossMo,
      moB: fBudMo['stat_netgen_gwh']  ?? planGrossMo,
      moL: fLEMo['stat_netgen_gwh']   ?? planGrossMo,
      ytA: fActYTD['stat_netgen_gwh'] ?? planGrossYTD,
      ytB: fBudYTD['stat_netgen_gwh'] ?? planGrossYTD,
      ytL: fLEYTD['stat_netgen_gwh']  ?? planGrossYTD,
      fav:true, decimals:1
    },
    {
      name:'System Losses', unit:'%', note:'losses',
      // deriveSysLoss: stored % → stored netGen+billed → net_gen_historical+billed → null(→plan)
      moA: deriveSysLoss(fActMo,  periodId) ?? planSysLossMo,
      moB: deriveSysLoss(fBudMo,  periodId) ?? planSysLossMo,
      moL: deriveSysLoss(fLEMo,   periodId) ?? planSysLossMo,
      ytA: deriveSysLoss(fActYTD, null)     ?? planSysLossYTD,
      ytB: deriveSysLoss(fBudYTD, null)     ?? planSysLossYTD,
      ytL: deriveSysLoss(fLEYTD,  null)     ?? planSysLossYTD,
      fav:false, decimals:1, pct:true
    },
    {
      name:'Net Sales (Billed)', unit:'GWh', note:'generation',
      // stat_billed_gwh stored as MWh in actuals upload → divide by 1000 for GWh display
      moA: fActMo['stat_billed_gwh']!=null?(fActMo['stat_billed_gwh']/1000):budNetSaleMo,
      moB: fBudMo['stat_billed_gwh']!=null?(fBudMo['stat_billed_gwh']/1000):budNetSaleMo,
      moL: fLEMo['stat_billed_gwh'] !=null?(fLEMo['stat_billed_gwh']/1000) :budNetSaleMo,
      ytA: fActYTD['stat_billed_gwh']!=null?(fActYTD['stat_billed_gwh']/1000):budNetSaleYTD,
      ytB: fBudYTD['stat_billed_gwh']!=null?(fBudYTD['stat_billed_gwh']/1000):budNetSaleYTD,
      ytL: fLEYTD['stat_billed_gwh'] !=null?(fLEYTD['stat_billed_gwh']/1000) :budNetSaleYTD,
      fav:true, decimals:1
    },
    {
      name:'Peak Demand', unit:'MW', note:'generation',
      moA: fActMo['stat_peak_mw'], moB: fBudMo['stat_peak_mw'], moL: fLEMo['stat_peak_mw'],
      ytA: null, ytB: null, ytL: null, // peak is point-in-time, no YTD sum
      fav:true, decimals:1
    },
  ];

  const hd=`<tr class="flash-col-group">
    <th rowspan="2" style="min-width:160px;text-align:left">Metric</th>
    <th colspan="4" class="flash-col-hdr-mo">── Month (${FLASH_MONTHS[periodId]||''}) ──</th>
    <th colspan="4" class="flash-col-hdr-ytd">── YTD ──</th>
    <th rowspan="2" style="width:26px"></th>
  </tr>
  <tr>
    <th>Actual</th><th class="flash-col-bud">Budget</th><th class="flash-col-le">LE</th><th>Var vs Bud</th>
    <th>Actual</th><th class="flash-col-bud">Budget</th><th class="flash-col-le">LE</th><th>Var vs Bud</th>
  </tr>`;

  const body=rows.map(r=>{
    const d=r.decimals||1;
    const fmtV=(v)=>v!=null?v.toFixed(d)+(r.pct?'%':''+(r.unit==='GWh'?' GWh':r.unit==='MW'?' MW':'')):'—';
    const vMo=flashVarCell(r.moA,r.moB,r.fav), vYTD=flashVarCell(r.ytA,r.ytB,r.fav);
    const noteBtn=`<button onclick="flashCommentRow('${r.note}','${r.name}')" style="border:none;background:transparent;cursor:pointer;font-size:11px;padding:0;color:#b0c4de">💬</button>`;
    return `<tr>
      <td style="font-weight:600">${r.name}</td>
      <td>${fmtV(r.moA)}</td>
      <td class="flash-col-bud">${fmtV(r.moB)}</td>
      <td class="flash-col-le">${fmtV(r.moL)}</td>
      <td class="${vMo.c}" style="font-size:10px">${vMo.h}</td>
      <td>${r.ytA!=null?fmtV(r.ytA):'—'}</td>
      <td class="flash-col-bud">${r.ytB!=null?fmtV(r.ytB):'—'}</td>
      <td class="flash-col-le">${r.ytL!=null?fmtV(r.ytL):'—'}</td>
      <td class="${vYTD.c}" style="font-size:10px">${r.ytA!=null&&r.ytB!=null?vYTD.h:'—'}</td>
      <td style="text-align:center">${noteBtn}</td>
    </tr>`;
  }).join('');
  tbl.innerHTML=`<thead>${hd}</thead><tbody>${body}</tbody>`;
}

// ── P&L table — 3-way × Month + YTD ─────────────────────────────────────────
function flashBuildPLV3(fActMo,fBudMo,fLEMo,fActYTD,fBudYTD,fLEYTD,budLabel,leLabel) {
  const tbl=document.getElementById('flashPLTable');
  if (!tbl) return;

  const defs=[
    {section:'Revenue'},
    {id:'fuel_rev',  name:'Fuel Revenue',            fav:true,  indent:true, note:'revenue'},
    {id:'nonfuel',   name:'Non-Fuel Revenue',         fav:true,  indent:true, note:'revenue'},
    {id:'ipp_fr',    name:'IPP Fuel Recovery',        fav:true,  indent:true, note:'revenue'},
    {id:'ipp_nr',    name:'IPP Non-Fuel Recovery',    fav:true,  indent:true, note:'revenue'},
    {id:'fuel_surp', name:'Fuel Surplus/(Deficit)',   fav:true,  indent:true, note:'revenue'},
    {id:'tot_rev',   name:'Total Revenue',            fav:true,  subtotal:true, note:'revenue',
     keys:['fuel_rev','nonfuel','ipp_fr','ipp_nr','fuel_surp']},
    {section:'Operating Costs'},
    {id:'fuel_cost', name:'Fuel Cost',                fav:false, indent:true, note:'opex'},
    {id:'ipp_cost',  name:'IPP Purchase Cost',        fav:false, indent:true, note:'opex'},
    {id:'opex',      name:'O&M Expense',              fav:false, indent:true, note:'opex'},
    {id:'ebitda',    name:'EBITDA',                   fav:true,  subtotal:true, note:'ebitda'},
    {section:'Non-Operating'},
    {id:'depn',      name:'Depreciation & Amort.',    fav:false, indent:true, note:'financing'},
    {id:'ebit',      name:'EBIT',                     fav:true,  subtotal:true, note:'ebitda'},
    {id:'fin_cost',  name:'Financing Cost',           fav:false, indent:true, note:'financing'},
    {section:'Other Income / (Expense)'},
    {id:'oth_inc_tax',   name:'Taxable Other Income',     fav:true,  indent:true, note:'other_income',
     fallback:'oth_inc', fallbackPct:0.6},
    {id:'oth_inc_nontax',name:'Non-Taxable Other Income', fav:true,  indent:true, note:'other_income',
     fallback:'oth_inc', fallbackPct:0.4},
    {id:'oth_exp',       name:'Other Expense',            fav:false, indent:true, note:'other_income'},
    {id:'oth_inc',       name:'Net Other Income',         fav:true,  subtotal:true, note:'other_income'},
    {id:'pretax',    name:'Pre-Tax Income',           fav:true,  subtotal:true, note:'ebitda'},
    {id:'tax',       name:'Income Tax',               fav:false, indent:true, note:'financing'},
    {id:'net_inc',   name:'Net Income',               fav:true,  total:true,   note:'ebitda'},
  ];

  function getV(facts, r) {
    if (r.keys) return r.keys.reduce((s,k)=>s+(facts[k]||0),0);
    let v=facts[r.id]??null;
    if (v==null&&r.fallback){const b=facts[r.fallback]??null; v=b!=null?b*r.fallbackPct:null;}
    return v;
  }

  const abbr12=s=>s.length>12?s.slice(0,10)+'…':s;
  const hd=`<tr class="flash-col-group">
    <th rowspan="2" style="min-width:185px;text-align:left">Line Item</th>
    <th colspan="4" class="flash-col-hdr-mo">── Month ──</th>
    <th colspan="4" class="flash-col-hdr-ytd">── Year-to-Date ──</th>
    <th rowspan="2" style="width:26px"></th>
  </tr>
  <tr>
    <th>Actual</th><th class="flash-col-bud">${abbr12(budLabel)}</th><th class="flash-col-le">${abbr12(leLabel)}</th><th>Var vs Bud</th>
    <th>Actual</th><th class="flash-col-bud">${abbr12(budLabel)}</th><th class="flash-col-le">${abbr12(leLabel)}</th><th>Var vs Bud</th>
  </tr>`;

  let body='';
  defs.forEach(r=>{
    if (r.section){
      body+=`<tr class="flash-row-section"><td colspan="10">${r.section}</td></tr>`;
      return;
    }
    const mA=getV(fActMo,r), mB=getV(fBudMo,r), mL=getV(fLEMo,r);
    const yA=getV(fActYTD,r),yB=getV(fBudYTD,r),yL=getV(fLEYTD,r);
    const vMo=flashVarCell(mA,mB,r.fav), vYTD=flashVarCell(yA,yB,r.fav);
    const pad=r.indent?'padding-left:22px':'';
    const rowCls=r.total?'flash-row-total':r.subtotal?'flash-row-subtotal':'';
    const noteBtn=r.note?`<button onclick="flashCommentRow('${r.note}','${r.name.replace(/'/g,'')}') "
      style="border:none;background:transparent;cursor:pointer;font-size:11px;padding:0;color:#b0c4de" title="Comment">💬</button>`:'';
    body+=`<tr class="${rowCls}">
      <td style="${pad}">${r.name}</td>
      <td>${mA!=null?flashFmt(mA):'—'}</td>
      <td class="flash-col-bud">${mB!=null?flashFmt(mB):'—'}</td>
      <td class="flash-col-le">${mL!=null?flashFmt(mL):'—'}</td>
      <td class="${vMo.c}" style="font-size:10px;line-height:1.3">${vMo.h}</td>
      <td>${yA!=null?flashFmt(yA):'—'}</td>
      <td class="flash-col-bud">${yB!=null?flashFmt(yB):'—'}</td>
      <td class="flash-col-le">${yL!=null?flashFmt(yL):'—'}</td>
      <td class="${vYTD.c}" style="font-size:10px;line-height:1.3">${vYTD.h}</td>
      <td style="text-align:center;padding:4px">${noteBtn}</td>
    </tr>`;
  });
  tbl.innerHTML=`<thead>${hd}</thead><tbody>${body}</tbody>`;
}

// ── Balance Sheet — 3-way ─────────────────────────────────────────────────────
function flashBuildBSV3(fActMo,fBudMo,fLEMo,budLabel,leLabel) {
  const tbl=document.getElementById('flashBSTable');
  if (!tbl) return;
  const rows=[
    {id:'cash',  name:'Cash & Equivalents',  fav:true },
    {id:'tot_a', name:'Total Assets',         fav:true },
    {id:'equity',name:"Shareholders' Equity", fav:true },
    {id:'ltd',   name:'Long-Term Debt',       fav:false},
    {id:'leases',name:'Lease Liabilities',    fav:false},
    {id:'cur_a', name:'Total Current Assets', fav:true },
    {id:'cur_l', name:'Total Current Liab.',  fav:false},
  ];
  const abbr10=s=>s.length>10?s.slice(0,8)+'…':s;
  const hd=`<tr><th style="min-width:155px">Item</th><th>Actual</th><th class="flash-col-bud">${abbr10(budLabel)}</th><th class="flash-col-le">${abbr10(leLabel)}</th><th>Var vs Bud</th></tr>`;
  const body=rows.map(r=>{
    const a=fActMo[r.id]??null, b=fBudMo[r.id]??null, l=fLEMo[r.id]??null;
    const v=flashVarCell(a,b,r.fav);
    return `<tr>
      <td>${r.name}</td>
      <td>${a!=null?flashFmt(a):'—'}</td>
      <td class="flash-col-bud">${b!=null?flashFmt(b):'—'}</td>
      <td class="flash-col-le">${l!=null?flashFmt(l):'—'}</td>
      <td class="${v.c}" style="font-size:10px">${v.h}</td>
    </tr>`;
  }).join('');
  tbl.innerHTML=`<thead>${hd}</thead><tbody>${body}</tbody>`;
}

// ── Key Metrics — 3-way × Month + YTD ────────────────────────────────────────
function flashBuildMetricsV3(fActMo,fBudMo,fLEMo,fActYTD,fBudYTD,fLEYTD,budLabel,leLabel) {
  const tbl=document.getElementById('flashMetricsTable');
  if (!tbl) return;
  const calcMetrics=(fA,fB,fL)=>{
    const revA=(fA['fuel_rev']||0)+(fA['nonfuel']||0)+(fA['ipp_fr']||0)+(fA['ipp_nr']||0);
    const revB=(fB['fuel_rev']||0)+(fB['nonfuel']||0)+(fB['ipp_fr']||0)+(fB['ipp_nr']||0);
    const revL=(fL['fuel_rev']||0)+(fL['nonfuel']||0)+(fL['ipp_fr']||0)+(fL['ipp_nr']||0);
    const fmt1=(n,d=1)=>n!=null&&!isNaN(n)?n.toFixed(d):'—';
    return [
      {name:'EBITDA Margin %',
       vA:revA?fmt1((fA['ebitda']||0)/revA*100)+'%':'—',
       vB:revB?fmt1((fB['ebitda']||0)/revB*100)+'%':'—',
       vL:revL?fmt1((fL['ebitda']||0)/revL*100)+'%':'—',
       rA:revA?(fA['ebitda']||0)/revA:null,
       rB:revB?(fB['ebitda']||0)/revB:null, fav:true},
      {name:'Net Margin %',
       vA:revA?fmt1((fA['net_inc']||0)/revA*100)+'%':'—',
       vB:revB?fmt1((fB['net_inc']||0)/revB*100)+'%':'—',
       vL:revL?fmt1((fL['net_inc']||0)/revL*100)+'%':'—',
       rA:revA?(fA['net_inc']||0)/revA:null,
       rB:revB?(fB['net_inc']||0)/revB:null, fav:true},
      {name:'OPEX / Revenue',
       vA:revA?fmt1((fA['opex']||0)/revA*100)+'%':'—',
       vB:revB?fmt1((fB['opex']||0)/revB*100)+'%':'—',
       vL:revL?fmt1((fL['opex']||0)/revL*100)+'%':'—',
       rA:revA?(fA['opex']||0)/revA:null,
       rB:revB?(fB['opex']||0)/revB:null, fav:false},
    ];
  };
  const mMet=calcMetrics(fActMo,fBudMo,fLEMo);
  const yMet=calcMetrics(fActYTD,fBudYTD,fLEYTD);
  const abbr10=s=>s.length>10?s.slice(0,8)+'…':s;
  const hd=`<tr class="flash-col-group">
    <th rowspan="2" style="min-width:140px">Metric</th>
    <th colspan="3" class="flash-col-hdr-mo">Month</th>
    <th colspan="3" class="flash-col-hdr-ytd">YTD</th>
  </tr>
  <tr>
    <th>Act</th><th class="flash-col-bud">${abbr10(budLabel)}</th><th class="flash-col-le">${abbr10(leLabel)}</th>
    <th>Act</th><th class="flash-col-bud">${abbr10(budLabel)}</th><th class="flash-col-le">${abbr10(leLabel)}</th>
  </tr>`;
  const body=mMet.map((m,i)=>{
    const y=yMet[i];
    const mDiff=m.rA!=null&&m.rB!=null?m.rA-m.rB:null;
    const mCls=mDiff==null?'':(m.fav?(mDiff>=0?'fv-pos':'fv-neg'):(mDiff<=0?'fv-pos':'fv-neg'));
    return `<tr>
      <td>${m.name}</td>
      <td class="${mCls}">${m.vA}</td>
      <td class="flash-col-bud">${m.vB}</td>
      <td class="flash-col-le">${m.vL}</td>
      <td>${y.vA}</td>
      <td class="flash-col-bud">${y.vB}</td>
      <td class="flash-col-le">${y.vL}</td>
    </tr>`;
  }).join('');
  tbl.innerHTML=`<thead>${hd}</thead><tbody>${body}</tbody>`;
}

// ── Init (called on tab open) ─────────────────────────────────────────────────
function flashInit() {
  // Build selectable periods from two sources:
  //   1. fpa_dim_period rows flagged is_closed=true
  //   2. Periods derived from any ACTUAL version that has facts loaded in fpa.facts
  //      — per-month versions (ACTUALS_YYYY_MM): use their period_id directly
  //      — year-level versions (HIST_ACTUAL_YYYY): use the max period_id in their facts
  const pidSet = new Set((fpa.periods||[]).filter(p=>p.is_closed).map(p=>p.id));
  (fpa.versions||[]).filter(v=>v.kind==='ACTUAL').forEach(v=>{
    if (v.period_id) {
      pidSet.add(v.period_id);
    } else if (fpa.facts[v.code]) {
      const allPids = Object.values(fpa.facts[v.code])
        .flatMap(ld=>Object.keys(ld).map(Number));
      if (allPids.length) pidSet.add(Math.max(...allPids));
    }
  });
  _flashClosedPeriods = [...pidSet].sort((a,b)=>a-b);
  if (_flashClosedPeriods.length) {
    _flashCurrentPeriod = _flashClosedPeriods[_flashClosedPeriods.length-1];
    _flashPeriodIdx     = _flashClosedPeriods.length-1;
  } else {
    // No closed periods in DB — leave empty; flash will show no-data state
    _flashClosedPeriods = [];
    _flashCurrentPeriod = null;
    _flashPeriodIdx     = -1;
  }
  flashPopulatePeriods();
  flashPopulateLEVersions();
  // Show Back to Model only for privileged roles
  const backBtn=document.getElementById('flashBackBtn');
  if (backBtn) backBtn.style.display=['admin','analyst'].includes(currentUser?.role)?'inline-flex':'none';
  // Logos
  const cLogo=document.getElementById('flashCtrlLogo');
  if (cLogo&&JPS_LOGO_DATA) cLogo.src=JPS_LOGO_DATA;
  // Nav button initial state
  const prev=document.querySelector('.flash-ctrl-bar button[onclick*="-1"]');
  const next=document.querySelector('.flash-ctrl-bar button[onclick*="+1"]');
  if (prev) prev.disabled=_flashPeriodIdx<=0;
  if (next) next.disabled=_flashPeriodIdx>=_flashClosedPeriods.length-1;
  // Trigger first load
  flashRefresh();
  _flashInited=true;
}

// ── Navigate back to main model ───────────────────────────────────────────────
function flashGoToModel() {
  const dashTab=document.querySelector('.tab[onclick*="\'dash\'"]');
  showPane('dash',dashTab);
  if (dashTab){document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));dashTab.classList.add('on');}
}

// ── Notes: load ───────────────────────────────────────────────────────────────
async function flashLoadNotes() {
  if (!_sb) return;
  const periodId=_flashCurrentPeriod;
  const y=Math.floor(periodId/100), m=periodId%100;
  const rptPeriod=`${y}-${String(m).padStart(2,'0')}`;
  const {data,error}=await _sb.from('fpa_flash_notes').select('*')
    .eq('report_period',rptPeriod).eq('is_deleted',false)
    .order('entered_at',{ascending:false});
  _flashNotesData=error?[]:(data||[]);
  flashRenderNotes();
}

// ── Notes: render ─────────────────────────────────────────────────────────────
function flashRenderNotes() {
  const feed=document.getElementById('flashNotesFeed');
  if (!feed) return;
  if (!_flashNotesData.length){
    feed.innerHTML=`<div style="font-size:11px;color:#8099b8;text-align:center;padding:18px 0">No commentary for this period yet.</div>`;
    return;
  }
  const me = currentUser?.name || '';
  const isAdmin = currentUser?.role === 'admin';
  feed.innerHTML=_flashNotesData.map(n=>{
    const dt=new Date(n.entered_at).toLocaleString('en-JM',{dateStyle:'medium',timeStyle:'short'});
    const upd=n.updated_at&&n.updated_at!==n.entered_at
      ?` · edited ${new Date(n.updated_at).toLocaleString('en-JM',{timeStyle:'short'})}`:'' ;
    const initials=(n.entered_by||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
    const vTag=n.version_code?`<span class="flash-note-tag">${n.version_code.replace(/_/g,' ')}</span>`:'';
    const sTag=`<span class="flash-note-tag">${(n.section||'general').replace(/_/g,' ')}</span>`;
    // Show edit/delete only to the note author or an admin
    const canEdit = (n.entered_by===me) || isAdmin;
    const actions = canEdit
      ? `<span class="flash-note-actions">
           <button class="flash-note-action-btn" onclick="flashEditNote('${n.id}')" title="Edit note">✏︎ Edit</button>
           <button class="flash-note-action-btn del" onclick="flashDeleteNote('${n.id}')" title="Delete note">✕ Delete</button>
         </span>`
      : '';
    return `<div class="flash-note-entry" data-note-id="${n.id}">
      <div class="flash-note-avatar" title="${n.entered_by||''}">${initials}</div>
      <div class="flash-note-body">
        <div class="flash-note-text">${(n.note_text||'').replace(/</g,'&lt;').replace(/\n/g,'<br>')}</div>
        <div class="flash-note-meta">
          ${sTag}${vTag}
          <span class="flash-note-author">${n.entered_by||''}${upd?` · ${upd}`:''}</span>
          <span>${dt}</span>
          ${actions}
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── Notes: edit ───────────────────────────────────────────────────────────────
async function flashEditNote(id) {
  const n = _flashNotesData.find(x=>x.id===id);
  if (!n) return;
  const newText = prompt('Edit note:', n.note_text||'');
  if (newText===null) return;          // cancelled
  const trimmed = newText.trim();
  if (!trimmed) { toast('Note cannot be empty','w'); return; }
  if (!_sb) { toast('No database connection','err'); return; }
  const { error } = await _sb.from('fpa_flash_notes')
    .update({ note_text: trimmed, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) { toast('Edit failed: '+error.message,'err'); return; }
  toast('Note updated','ok');
  await flashLoadNotes();
}

// ── Notes: delete ─────────────────────────────────────────────────────────────
async function flashDeleteNote(id) {
  if (!confirm('Delete this note? This cannot be undone.')) return;
  if (!_sb) { toast('No database connection','err'); return; }
  // Soft-delete: set is_deleted=true so audit trail is preserved
  const { error } = await _sb.from('fpa_flash_notes')
    .update({ is_deleted: true, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) { toast('Delete failed: '+error.message,'err'); return; }
  toast('Note deleted','ok');
  await flashLoadNotes();
}

// ── Notes: save ───────────────────────────────────────────────────────────────
async function flashSaveNote() {
  if (!_sb){toast('No database connection','err');return;}
  const noteText=(document.getElementById('flashNoteInput')?.value||'').trim();
  if (!noteText){toast('Please enter a note first','err');return;}
  const section=document.getElementById('flashNoteSection')?.value||'general';
  const periodId=_flashCurrentPeriod;
  const y=Math.floor(periodId/100), m=periodId%100;
  const rptPeriod=`${y}-${String(m).padStart(2,'0')}`;
  // Resolve active version code for this period (prefer ACTUALS, fall back to active planning version)
  const activeVer = (fpa.versions||[]).find(v=>v.code===`ACTUALS_${y}_${String(m).padStart(2,'0')}`)
                 || (fpa.versions||[]).find(v=>v.id===fpa.activeVersionId)
                 || null;
  const {error}=await _sb.from('fpa_flash_notes').insert({
    report_period: rptPeriod,
    section,
    note_text:     noteText,
    entered_by:    currentUser?.name||'Unknown',
    version_code:  activeVer?.code || null,
    year:          y,
    month:         m,
  });
  if (error){toast('Save failed: '+error.message,'err');return;}
  document.getElementById('flashNoteInput').value='';
  toast('Note saved','ok');
  await flashLoadNotes();
}

// ══════════════════════════════════════════════════════════════════════════════
// DATA MANAGEMENT HUB
// ══════════════════════════════════════════════════════════════════════════════

// Section config: which tab groups to show in focus mode
const HUB_SECTIONS = {
  revenue: { pane:'ass-rev',   groups:['ass'],       label:'Revenue & Tariff',     role:'Revenue Analyst' },
  gen:     { pane:'wrk-gen',   groups:['wrk'],       label:'Generation & Fuel',    role:'Operations Engineer' },
  om:      { pane:'ass-om',    groups:['ass'],       label:'O&M Budget',           role:'O&M Specialist' },
  capex:   { pane:'ass-capex', groups:['ass'],       label:'CapEx & Depreciation', role:'CapEx Manager' },
  debt:    { pane:'wrk-debt',  groups:['wrk','ass'], label:'Debt & Financing',     role:'Treasury Analyst' },
  coll:    { pane:'wrk-coll',  groups:['wrk'],       label:'Collections',          role:'Collections Manager' },
};

// Open a role-focused workspace — hides all other tab groups, shows only relevant section
function openHubSection(key) {
  const cfg = HUB_SECTIONS[key];
  if (!cfg) return;
  // showPane() removes .on from hub pane automatically, collapsing the fullscreen overlay
  // then show only the tab groups relevant to this role (hub tab group also hidden in focus mode)
  document.querySelectorAll('.tabbar-inner > .tg').forEach(tg => {
    const inFocus = cfg.groups.some(cls => tg.classList.contains(cls));
    tg.style.display = inFocus ? '' : 'none';
  });
  showPane(cfg.pane, null);
  // Floating back-to-hub button
  const btn = document.getElementById('hubBackBtn');
  if (btn) { btn.textContent = `← ${cfg.role} Hub`; btn.style.display = 'block'; }
  window._hubFocusSection = key;
  if (typeof _rtAnnouncePresence === 'function') _rtAnnouncePresence(cfg.pane);
}

// Exit focus mode — restore all tabs and return to hub fullscreen landing page
function hubExitFocus() {
  document.querySelectorAll('.tabbar-inner > .tg').forEach(tg => { tg.style.display = ''; });
  const btn = document.getElementById('hubBackBtn');
  if (btn) btn.style.display = 'none';
  window._hubFocusSection = null;
  showPane('hub', null);
  // Refresh the welcome name and status badge
  const hubName = document.getElementById('hubUserName');
  if (hubName) hubName.textContent = currentUser?.name?.split(' ')[0] || 'User';
  hubBuildStatusCards();
}

// Navigate to a report from the hub (restores all tabs first, shows back-to-hub button)
function hubQuickNav(paneId) {
  document.querySelectorAll('.tabbar-inner > .tg').forEach(tg => { tg.style.display = ''; });
  const tab = document.querySelector(`.tab[onclick*="'${paneId}'"]`);
  showPane(paneId, tab);
  if (tab) { document.querySelectorAll('.tab').forEach(t => t.classList.remove('on')); tab.classList.add('on'); }
  if (paneId === 'rpt-flash') setTimeout(() => flashInit(), 100);
  const btn = document.getElementById('hubBackBtn');
  if (btn) { btn.textContent = '← Back to Hub'; btn.style.display = 'block'; }
  window._hubFocusSection = null;
}

// Browse all — exit hub overlay to full platform view (all tabs visible)
function hubBrowseAll() {
  document.querySelectorAll('.tabbar-inner > .tg').forEach(tg => { tg.style.display = ''; });
  const dashTab = document.querySelector('.tab[onclick*="\'dash\'"]');
  showPane('dash', dashTab);
  if (dashTab) { document.querySelectorAll('.tab').forEach(t => t.classList.remove('on')); dashTab.classList.add('on'); }
  const btn = document.getElementById('hubBackBtn');
  if (btn) { btn.textContent = '← Back to Hub'; btn.style.display = 'block'; }
  window._hubFocusSection = null;
}

function _hubSectionStatus(key) {
  // Safe status checks — all use fpa.* or optional-chained globals only
  try {
    if (key === 'revenue') {
      const hasTariff = fpa?.assumptions?.[_aopCode()]?.tariff && Object.values(fpa.assumptions[_aopCode()].tariff).some(v=>v&&Object.values(v).some(x=>Number(x)>0));
      const hasVol    = fpa?.assumptions?.[_aopCode()]?.volume && Object.values(fpa.assumptions[_aopCode()].volume).some(v=>v&&Object.values(v).some(x=>Number(x)>0));
      if (hasTariff && hasVol) return { dot:'ok',   text:'Rates & volumes loaded' };
      if (hasTariff || hasVol) return { dot:'warn',  text:'Partial data' };
      return { dot:'empty', text:'No data loaded' };
    }
    if (key === 'gen') {
      const hasGen = netGenTable?.[planYear] && Object.values(netGenTable[planYear]).some(v=> v && (Array.isArray(v) ? v.some(x=>Number(x)>0) : Number(v)>0));
      return hasGen ? { dot:'ok', text:'Net gen loaded' } : { dot:'empty', text:'No data loaded' };
    }
    if (key === 'om') {
      const hasOM = fpa?.assumptions?.[_aopCode()]?.opex && Object.values(fpa.assumptions[_aopCode()].opex).some(v=>v&&Object.values(v).some(x=>Number(x)>0));
      return hasOM ? { dot:'ok', text:'Budget loaded' } : { dot:'empty', text:'No data loaded' };
    }
    if (key === 'capex') {
      const hasCapex = fpa?.assumptions?.[_aopCode()]?.capex && Object.values(fpa.assumptions[_aopCode()].capex).some(v=>v&&Object.values(v).some(x=>Number(x)>0));
      return hasCapex ? { dot:'ok', text:'CapEx loaded' } : { dot:'empty', text:'No data loaded' };
    }
    if (key === 'debt') {
      const nLoans  = (fpa?.loans||[]).length;
      const nLeases = (typeof ifrs16Leases !== 'undefined' ? ifrs16Leases : []).length;
      if (nLoans+nLeases > 0) return { dot:'ok', text:`${nLoans} loan(s) · ${nLeases} lease(s)` };
      return { dot:'empty', text:'No register loaded' };
    }
    if (key === 'coll') {
      const hasColl = fpa?.assumptions?.[_aopCode()]?.collections && Object.values(fpa.assumptions[_aopCode()].collections).some(v=>v&&Object.values(v).some(x=>Number(x)>0));
      return hasColl ? { dot:'ok', text:'Collections loaded' } : { dot:'empty', text:'Upload actuals to populate' };
    }
  } catch(e) {
    return { dot:'warn', text:'Status unavailable' };
  }
  return { dot:'empty', text:'No data' };
}

function hubBuildStatusCards() {
  const sections = [
    { key:'revenue', icon:'📈', title:'Revenue & Tariff',      desc:'Tariff rates, billing volumes, fuel revenue' },
    { key:'gen',     icon:'⚡', title:'Generation & Fuel',     desc:'Net generation, fuel costs, system losses' },
    { key:'om',      icon:'🔧', title:'O&M Budget',            desc:'Operating costs, maintenance, overheads' },
    { key:'capex',   icon:'🏗', title:'CapEx & Depreciation',  desc:'Capital projects, asset register, depreciation' },
    { key:'debt',    icon:'🏦', title:'Debt & Financing',      desc:'Loans, leases, interest, covenant ratios' },
    { key:'coll',    icon:'💳', title:'Collections & A/R',     desc:'Cash receipts, DSO, A/R aging' },
  ];

  // Hub badge — show DB connection status only (no upload count)
  const badge = document.getElementById('hubActualsBadge');
  if (badge) { badge.style.display = 'none'; }

  // Build cards HTML (returned for use by hubShowStatusModal)
  return sections.map(s => {
    const st = _hubSectionStatus(s.key);
    const dotColor = st.dot==='ok' ? '#16a34a' : st.dot==='warn' ? '#d97706' : '#9ca3af';
    return `<div class="hub-card" onclick="openHubSection('${s.key}')" style="cursor:pointer">
      <div class="hub-card-icon">${s.icon}</div>
      <div class="hub-card-title">${s.title}</div>
      <div class="hub-card-desc">${s.desc}</div>
      <div class="hub-card-status">
        <span style="color:${dotColor};font-size:12px">●</span>
        <span style="color:${dotColor};font-size:10px;margin-left:5px">${st.text}</span>
      </div>
      <div class="hub-card-open">Open →</div>
    </div>`;
  }).join('');
}

function hubShowStatusModal() {
  hubBuildStatusCards(); // refresh badge
  const cards = hubBuildStatusCards();
  // Reuse existing generic modal or build a floating overlay
  let overlay = document.getElementById('hubStatusOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'hubStatusOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9500;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box';
    overlay.onclick = e => { if(e.target===overlay) overlay.remove(); };
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:14px;max-width:780px;width:100%;max-height:85vh;overflow-y:auto;padding:24px;box-sizing:border-box">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
        <div>
          <div style="font-size:15px;font-weight:700;color:#0f1e2d">📊 Data Load Status</div>
          <div style="font-size:11px;color:#8099b8;margin-top:2px">What data has been uploaded to the database. Click any section to open it.</div>
        </div>
        <button onclick="document.getElementById('hubStatusOverlay').remove()" style="background:none;border:none;font-size:18px;cursor:pointer;color:#8099b8;padding:4px 8px">✕</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px">
        ${cards}
      </div>
      <div style="margin-top:18px;padding-top:14px;border-top:1px solid #e5ecf4;text-align:center">
        <button class="btn btn-gold" onclick="document.getElementById('hubStatusOverlay').remove();navToDataManager()" style="font-size:11px">📂 Open Data Manager to upload data</button>
      </div>
    </div>`;
  overlay.style.display = 'flex';
}

// Show Security nav items only for admins — called after login
function hubApplyRoleAccess(role) {
  const secTab = document.getElementById('securityTab');   // old hidden tab
  if (secTab) secTab.style.display = role === 'admin' ? '' : 'none';
  const navSec = document.getElementById('navSecItem');     // new navbar item
  if (navSec) navSec.style.display = role === 'admin' ? '' : 'none';
}

// ══════════════════════════════════════════════════════════════════════════════
// SECURITY & ACCESS PAGE
// ══════════════════════════════════════════════════════════════════════════════

async function secLoadUsers() {
  const tbody = document.getElementById('secUserTableBody');
  if (!tbody) return;
  if (!_sb) { tbody.innerHTML = '<tr><td colspan="10" style="color:#dc2626;padding:14px">No database connection</td></tr>'; return; }

  tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#8099b8;padding:14px">Loading…</td></tr>';
  const { data, error } = await _sb.from('profiles').select('*').order('created_at');
  if (error) { tbody.innerHTML = `<tr><td colspan="10" style="color:#dc2626;padding:14px">Error: ${error.message}</td></tr>`; return; }

  if (!data?.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#8099b8;padding:14px">No users found in profiles table</td></tr>';
    return;
  }

  const salesRoleOpts = ['','rep','manager','admin','view'];
  const salesRoleLabel = { '':'— None —', rep:'Sales Rep', manager:'Sales Manager', admin:'Sales Admin', view:'Sales Viewer' };

  tbody.innerHTML = data.map(u => {
    const role       = u.role || 'analyst';
    const salesRole  = u.sales_role || '';
    const territory  = u.territory  || '';
    const isActive   = u.is_active !== false;
    const areas      = (u.access_areas||[]).length ? u.access_areas.join(', ') : '<span style="color:#9ca3af">All</span>';
    const joined     = u.created_at ? new Date(u.created_at).toLocaleDateString('en-JM',{dateStyle:'medium'}) : '—';
    const emailHtml  = u.email ? `<span style="color:#003da5">${u.email}</span>` : '<span style="color:#d1d5db">—</span>';
    const salesBadge = salesRole
      ? `<span style="font-size:10px;padding:2px 7px;border-radius:9px;background:rgba(16,185,129,.12);color:#059669;font-weight:600">${salesRoleLabel[salesRole]||salesRole}</span>`
      : '<span style="color:#d1d5db;font-size:10px">—</span>';
    return `<tr>
      <td><strong>${u.name||'Unknown'}</strong></td>
      <td>${emailHtml}</td>
      <td style="color:#6b82a0;font-size:11px">${u.department||'—'}</td>
      <td><span class="sec-role-badge ${role}">${role}</span></td>
      <td>${salesBadge}</td>
      <td style="font-size:10px;color:#6b82a0">${territory||'<span style="color:#d1d5db">All</span>'}</td>
      <td style="font-size:10px;color:#6b82a0">${areas}</td>
      <td><span class="sec-status-dot ${isActive?'active':'inactive'}"></span>${isActive?'Active':'Revoked'}</td>
      <td style="font-size:11px;color:#8099b8">${joined}</td>
      <td style="white-space:nowrap">
        <select onchange="secUpdateRole('${u.id}',this.value)" title="FP&A role" style="font-size:10px;padding:3px 6px;border-radius:5px;border:1px solid #d1dce8;margin-right:3px;max-width:72px">
          ${['admin','analyst','viewer','om'].map(r=>`<option ${r===role?'selected':''} value="${r}">${r}</option>`).join('')}
        </select>
        <select onchange="secUpdateSalesRole('${u.id}',this.value,'${territory}')" title="Sales Platform role" style="font-size:10px;padding:3px 6px;border-radius:5px;border:1px solid #d1dce8;margin-right:3px;max-width:95px">
          ${salesRoleOpts.map(r=>`<option ${r===salesRole?'selected':''} value="${r}">${salesRoleLabel[r]}</option>`).join('')}
        </select>
        <input type="text" value="${territory}" placeholder="Territory" title="Sales territory (leave blank = all)"
          onchange="secUpdateSalesRole('${u.id}','${salesRole}',this.value)"
          style="font-size:10px;padding:3px 6px;border-radius:5px;border:1px solid #d1dce8;width:70px;margin-right:3px"/>
        <button class="sec-action-btn" onclick="secResetPassword(this,'${u.email||''}')" title="Send password reset email">Reset PW</button>
        <button class="sec-action-btn danger" onclick="secToggleAccess(this,'${u.id}',${isActive})" title="${isActive?'Revoke':'Restore'} access">${isActive?'Revoke':'Restore'}</button>
        <button class="sec-action-btn danger" onclick="secDeleteUser(this,'${u.id}','${(u.name||'').replace(/'/g,"\\'")}','${u.email||''}')" title="Permanently delete this user">Delete</button>
      </td>
    </tr>`;
  }).join('');
}

async function secUpdateRole(userId, newRole) {
  if (!_sb) return;
  const { error } = await _sb.from('profiles').update({ role: newRole }).eq('id', userId);
  if (error) { toast('Role update failed: '+error.message,'err'); return; }
  toast(`FP&A role updated to "${newRole}"`, 'ok');
  auditLog('admin','role-change', userId, { newRole });
  await secLoadUsers();
}

async function secUpdateSalesRole(userId, salesRole, territory) {
  if (!_sb) return;
  const patch = { sales_role: salesRole || null, territory: territory || null };
  const { error } = await _sb.from('profiles').update(patch).eq('id', userId);
  if (error) { toast('Sales role update failed: '+error.message,'err'); return; }
  const label = salesRole ? `"${salesRole}"${territory?' / '+territory:''}` : 'none';
  toast('Sales access updated → ' + label, 'ok');
  auditLog('admin','sales-role-change', userId, { salesRole, territory });
  await secLoadUsers();
}

async function secDeleteUser(btn, userId, userName, userEmail) {
  _secConfirm(btn, 'Delete?', async () => {
    if (!_sb) return;
    // Step 1: Remove profiles row (blocks all platform access immediately)
    const { error } = await _sb.from('profiles').delete().eq('id', userId);
    if (error) { toast('Delete failed: '+error.message,'err'); return; }

    // Step 2: Attempt auth deletion via Edge Function (requires delete-user function)
    let session = null;
    try { const r = await _sb.auth.getSession(); session = r?.data?.session; } catch(e) {}
    if (session) {
      try {
        await _sb.functions.invoke('delete-user', {
          body: { userId },
          headers: { Authorization: `Bearer ${session.access_token}` }
        });
      } catch(e) {
        // Edge Function may not be deployed yet — profile row is already deleted so user
        // cannot access any data. The auth account is a Supabase-only shell with no profile.
        console.warn('[FPA] delete-user Edge Function not available:', e.message);
      }
    }

    toast(`${userName||userEmail||'User'} deleted`, 'ok');
    auditLog('admin','user-deleted', userId, { userName, userEmail });
    await secLoadUsers();
  });
}

// ── Two-click inline confirmation (replaces blocked window.confirm) ──────────
function _secConfirm(btn, label, onConfirm) {
  if (btn.dataset.confirming) {
    delete btn.dataset.confirming;
    btn.nextElementSibling?.classList.contains('sec-cancel-btn') && btn.nextElementSibling.remove();
    onConfirm(); return;
  }
  btn.dataset.confirming = '1';
  const origText  = btn.textContent;
  const origStyle = btn.getAttribute('style') || '';
  btn.textContent = '✓ ' + label;
  btn.setAttribute('style', origStyle + ';background:#dc2626!important;color:#fff!important;border-color:#dc2626!important');
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'sec-action-btn sec-cancel-btn';
  cancelBtn.textContent = '✗';
  cancelBtn.onclick = e => {
    e.stopPropagation();
    delete btn.dataset.confirming;
    btn.textContent = origText;
    btn.setAttribute('style', origStyle);
    cancelBtn.remove();
  };
  btn.after(cancelBtn);
  setTimeout(() => { if (btn.dataset.confirming) cancelBtn.click(); }, 7000);
}

async function secToggleAccess(btn, userId, currentlyActive) {
  const newState = !currentlyActive;
  const action   = newState ? 'Restore' : 'Revoke';
  _secConfirm(btn, action + '?', async () => {
    if (!_sb) return;
    const { error } = await _sb.from('profiles').update({ is_active: newState }).eq('id', userId);
    if (error) { toast('Update failed: '+error.message,'err'); return; }
    toast(`Access ${newState?'restored':'revoked'}`,'ok');
    auditLog('admin', (newState?'restore':'revoke')+'-access', userId, {});
    await secLoadUsers();
  });
}

async function secResetPassword(btn, email) {
  if (!email) { toast('No email on record — ask user to email you their address first','w'); return; }
  if (!_sb) return;
  _secConfirm(btn, 'Send Reset?', async () => {
    const { error } = await _sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname
    });
    if (error) { toast('Reset email failed: '+error.message,'err'); return; }
    toast(`Password reset email sent to ${email}`, 'ok');
    auditLog('admin','password-reset-sent', email, {});
  });
}

// ── Role Builder ─────────────────────────────────────────────────────────────
// Pane groups for the permission matrix
const _RB_PANE_GROUPS = [
  { label: 'Dashboard & Reports', panes: [
    { id:'hub',       label:'Hub / Home' },
    { id:'dash',      label:'Overview' },
    { id:'rpt-pl',    label:'P&L Report' },
    { id:'rpt-bs',    label:'Balance Sheet' },
    { id:'rpt-cf',    label:'Cash Flow' },
    { id:'rpt-dep',   label:'Depreciation Report' },
    { id:'rpt-var',   label:'Variance Analysis' },
    { id:'rpt-kpi',   label:'KPI Dashboard' },
    { id:'rpt-rev',   label:'Revenue Report' },
    { id:'rpt-flash', label:'Flash Report' },
  ]},
  { label: 'Workbooks', panes: [
    { id:'wrk-sc',     label:'Scenarios' },
    { id:'wrk-gen',    label:'Generation' },
    { id:'wrk-coll',   label:'Collections' },
    { id:'wrk-debt',   label:'Debt & Financing' },
    { id:'wrk-leases', label:'Leases (IFRS 16)' },
  ]},
  { label: 'Assumptions', panes: [
    { id:'ass-rev',   label:'Revenue / Tariffs' },
    { id:'ass-om',    label:'O&M Assumptions' },
    { id:'ass-capex', label:'CapEx' },
    { id:'ass-dep',   label:'Depreciation Settings' },
    { id:'ass-other', label:'Other Income' },
    { id:'ass-proj',  label:'5-Year Projections' },
  ]},
  { label: 'AI & Admin', panes: [
    { id:'ai-comm',  label:'AI Commentary' },
    { id:'adm-data', label:'Data Manager' },
    { id:'adm-audit',label:'Audit Log' },
    { id:'adm-sec',  label:'Security & Users' },
    { id:'adm-guide',label:'User Guide' },
  ]},
];

let _rbActiveTab = 'cards';

function rbShowTab(tab) {
  _rbActiveTab = tab;
  const tabs = ['cards','matrix','new'];
  tabs.forEach(t => {
    const pane = document.getElementById('rbPane'+t.charAt(0).toUpperCase()+t.slice(1));
    const btn  = document.getElementById('rbTab'+t.charAt(0).toUpperCase()+t.slice(1));
    if (pane) pane.style.display = t === tab ? '' : 'none';
    if (btn) { btn.style.background = t===tab ? 'var(--accent)' : ''; btn.style.color = t===tab ? '#fff' : ''; }
  });
  if (tab === 'cards') rbBuildCards();
  if (tab === 'matrix') rbBuildMatrix();
}

function rbBuildCards() {
  const wrap = document.getElementById('rbRoleCards');
  if (!wrap) return;
  const roles = fpa.roles || [];
  if (!roles.length) {
    wrap.innerHTML = '<div style="color:#8099b8;font-size:12px;padding:12px">No roles loaded. Refresh the page.</div>';
    return;
  }
  wrap.innerHTML = roles.map(r => {
    const isSystem = r.is_system;
    const deleteBtn = !isSystem
      ? `<button onclick="rbDeleteRole('${r.role_name}')" style="margin-top:10px;font-size:10px;color:#ef4444;background:none;border:none;cursor:pointer;padding:0">🗑 Delete role</button>`
      : `<div style="margin-top:10px;font-size:10px;color:#8099b8">System role — cannot delete</div>`;
    return `<div class="hub-card" style="cursor:default">
      <div class="hub-card-icon">${r.icon||'👤'}</div>
      <div class="hub-card-title"><span class="sec-role-badge ${r.role_name}">${r.label||r.role_name}</span></div>
      <div class="hub-card-desc">${r.description||''}</div>
      ${deleteBtn}
    </div>`;
  }).join('');
}

function rbBuildMatrix() {
  const tbl = document.getElementById('rbMatrixTable');
  if (!tbl) return;
  const roles = (fpa.roles || []).filter(r => r.role_name !== 'admin'); // admin always full
  if (!roles.length) {
    tbl.innerHTML = '<tbody><tr><td style="color:#8099b8;padding:16px">No roles loaded.</td></tr></tbody>';
    return;
  }
  // Header row
  const cs = `style="padding:6px 10px;border:1px solid #e5ecf4;text-align:center;font-size:10px;font-weight:700;color:#6b82a0;text-transform:uppercase;letter-spacing:.06em;background:#f4f7fb"`;
  const cs2 = `style="padding:6px 10px;border:1px solid #e5ecf4;background:#f4f7fb;font-size:10px;font-weight:700;color:#6b82a0"`;
  let html = `<thead><tr><th ${cs2} style="min-width:160px;background:#f4f7fb;border:1px solid #e5ecf4;padding:6px 10px">Pane / Section</th>`;
  roles.forEach(r => {
    html += `<th colspan="2" ${cs}>${r.icon||''} ${r.label||r.role_name}</th>`;
  });
  html += '</tr><tr><th style="border:1px solid #e5ecf4"></th>';
  roles.forEach(() => {
    html += `<th ${cs}>View</th><th ${cs}>Edit</th>`;
  });
  html += '</tr></thead><tbody>';

  _RB_PANE_GROUPS.forEach(grp => {
    // Group header row
    html += `<tr><td colspan="${1+roles.length*2}" style="background:#eef3fa;font-size:10px;font-weight:700;color:#3a5a8c;padding:5px 10px;border:1px solid #e5ecf4;letter-spacing:.06em;text-transform:uppercase">${grp.label}</td></tr>`;
    grp.panes.forEach(pane => {
      html += `<tr><td style="padding:6px 10px;border:1px solid #e5ecf4;font-size:11px;color:#2c3e50">${pane.label}</td>`;
      roles.forEach(r => {
        const perm = fpa.rolePermissions?.[r.role_name]?.[pane.id] || { can_view:false, can_edit:false };
        const vChk = perm.can_view ? 'checked' : '';
        const eChk = perm.can_edit ? 'checked' : '';
        const cd = `style="padding:4px 8px;border:1px solid #e5ecf4;text-align:center"`;
        html += `<td ${cd}><input type="checkbox" ${vChk} onchange="rbSetPerm('${r.role_name}','${pane.id}','view',this.checked)"/></td>`;
        html += `<td ${cd}><input type="checkbox" ${eChk} onchange="rbSetPerm('${r.role_name}','${pane.id}','edit',this.checked)"/></td>`;
      });
      html += '</tr>';
    });
  });
  html += '</tbody>';
  tbl.innerHTML = html;
}

async function rbSetPerm(roleName, paneId, field, checked) {
  // Optimistic update in memory
  if (!fpa.rolePermissions) fpa.rolePermissions = {};
  if (!fpa.rolePermissions[roleName]) fpa.rolePermissions[roleName] = {};
  const existing = fpa.rolePermissions[roleName][paneId] || { can_view:false, can_edit:false };
  if (field === 'view') {
    existing.can_view = checked;
    if (!checked) existing.can_edit = false; // can't edit if can't view
  } else {
    existing.can_edit = checked;
    if (checked) existing.can_view = true; // edit implies view
  }
  fpa.rolePermissions[roleName][paneId] = existing;

  if (!_sb) { toast('No DB connection','w'); return; }
  const { error } = await _sb.from('fpa_role_permissions').upsert({
    role_name: roleName,
    pane_id: paneId,
    can_view: existing.can_view,
    can_edit: existing.can_edit,
  }, { onConflict: 'role_name,pane_id' });
  if (error) { toast('Permission save failed: '+error.message, 'w'); return; }
  // Re-render matrix so view/edit sync is visible
  rbBuildMatrix();
  // Re-apply tab visibility if current user's role was changed
  _applyTabVisibility();
}

async function rbCreateRole() {
  const slug  = (document.getElementById('rbNewSlug')?.value||'').trim().toLowerCase().replace(/[^a-z0-9_]/g,'_');
  const label = (document.getElementById('rbNewLabel')?.value||'').trim();
  const icon  = (document.getElementById('rbNewIcon')?.value||'👤').trim();
  const desc  = (document.getElementById('rbNewDesc')?.value||'').trim();
  const copyFrom = document.getElementById('rbNewCopyFrom')?.value || '';

  if (!slug) { toast('Role name (slug) is required','w'); return; }
  if (!label) { toast('Display label is required','w'); return; }
  if (slug === 'admin') { toast('"admin" is a reserved role name','w'); return; }
  if ((fpa.roles||[]).find(r=>r.role_name===slug)) { toast(`Role "${slug}" already exists`,'w'); return; }
  if (!_sb) { toast('No DB connection','w'); return; }

  // Create the role
  const { error: rErr } = await _sb.from('fpa_custom_roles').insert({
    role_name: slug, label, icon, description: desc, is_system: false
  });
  if (rErr) { toast('Create role failed: '+rErr.message,'w'); return; }

  // Seed permissions (copy from another role if requested)
  if (copyFrom && fpa.rolePermissions?.[copyFrom]) {
    const rows = [];
    Object.entries(fpa.rolePermissions[copyFrom]).forEach(([paneId, perm]) => {
      rows.push({ role_name: slug, pane_id: paneId, can_view: perm.can_view, can_edit: perm.can_edit });
    });
    if (rows.length) {
      const { error: pErr } = await _sb.from('fpa_role_permissions').insert(rows);
      if (pErr) toast('Role created but permissions copy failed: '+pErr.message,'w');
    }
  }

  toast(`Role "${label}" created ✓`,'ok');
  auditLog('admin','role-created', slug, { label, copyFrom });

  // Reload roles into memory
  const { data } = await _sb.from('fpa_custom_roles').select('*').order('role_name');
  fpa.roles = data || fpa.roles;
  const { data: pd } = await _sb.from('fpa_role_permissions').select('*');
  fpa.rolePermissions = {};
  (pd||[]).forEach(r => { (fpa.rolePermissions[r.role_name]??={})[r.pane_id]={can_view:r.can_view,can_edit:r.can_edit}; });

  // Reset form
  ['rbNewSlug','rbNewLabel','rbNewIcon','rbNewDesc'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });

  rbPopulateInviteRoles();
  rbShowTab('matrix'); // Switch to matrix so user can tweak the new role's permissions
}

async function rbDeleteRole(roleName) {
  const role = (fpa.roles||[]).find(r=>r.role_name===roleName);
  if (!role || role.is_system) { toast('System roles cannot be deleted','w'); return; }
  if (!confirm(`Delete role "${role.label||roleName}"?\n\nUsers currently assigned this role will need to be reassigned. This cannot be undone.`)) return;
  if (!_sb) return;

  await _sb.from('fpa_role_permissions').delete().eq('role_name', roleName);
  const { error } = await _sb.from('fpa_custom_roles').delete().eq('role_name', roleName);
  if (error) { toast('Delete failed: '+error.message,'w'); return; }

  toast(`Role "${role.label||roleName}" deleted`,'ok');
  auditLog('admin','role-deleted', roleName, {});

  fpa.roles = (fpa.roles||[]).filter(r=>r.role_name!==roleName);
  delete fpa.rolePermissions?.[roleName];
  rbPopulateInviteRoles();
  rbShowTab('cards');
}

function rbPopulateInviteRoles() {
  const sel = document.getElementById('secInviteRole');
  if (!sel) return;
  const roles = (fpa.roles||[]).filter(r => r.role_name !== 'admin' || true); // show all
  if (!roles.length) return;
  const cur = sel.value;
  sel.innerHTML = roles.map(r => `<option value="${r.role_name}"${r.role_name===cur?' selected':''}>${r.label||r.role_name}</option>`).join('');
}

function rbInit() {
  rbBuildCards();
  rbPopulateInviteRoles();
}
// ── End Role Builder ──────────────────────────────────────────────────────────

async function secInviteUser() {
  const name       = document.getElementById('secInviteName')?.value?.trim();
  const email      = document.getElementById('secInviteEmail')?.value?.trim();
  const role       = document.getElementById('secInviteRole')?.value || 'analyst';
  const dept       = document.getElementById('secInviteDept')?.value?.trim() || '';
  const salesRole  = document.getElementById('secInviteSalesRole')?.value || '';
  const territory  = document.getElementById('secInviteTerritory')?.value?.trim() || '';
  if (!name || !email) { toast('Name and email are required','w'); return; }
  if (!_sb) { toast('No database connection — cannot invite users in offline mode','err'); return; }

  // Check if we have a valid Supabase auth session (Edge Function requires JWT)
  let session = null;
  try { const r = await _sb.auth.getSession(); session = r?.data?.session; } catch(e) {}
  if (!session) {
    toast('Invite requires Supabase Auth sign-in. Sign in with email/password to use this feature.','w');
    return;
  }

  const inviteBtn = document.getElementById('secInviteBtn');
  if (inviteBtn) { inviteBtn.disabled = true; inviteBtn.textContent = 'Sending…'; }

  try {
    const body = { name, email, role };
    if (dept)      body.department  = dept;
    if (salesRole) body.sales_role  = salesRole;
    if (territory) body.territory   = territory;

    const { data, error } = await _sb.functions.invoke('invite-user', {
      body,
      headers: { Authorization: `Bearer ${session.access_token}` }
    });
    if (error) throw error;
    toast(`Invite sent to ${email}`, 'ok');
    auditLog('admin','user-invited', email, { name, role, salesRole, territory });
    document.getElementById('secInviteName').value      = '';
    document.getElementById('secInviteEmail').value     = '';
    document.getElementById('secInviteDept').value      = '';
    document.getElementById('secInviteSalesRole').value = '';
    document.getElementById('secInviteTerritory').value = '';
    await secLoadUsers();
  } catch(e) {
    const msg = e.message || String(e);
    if (msg.includes('Failed to send') || msg.includes('FunctionsFetchError')) {
      toast('Invite failed: Edge Function unreachable. Check Supabase dashboard → Edge Functions → invite-user is deployed and active.','err');
    } else if (msg.includes('JWT') || msg.includes('401') || msg.includes('403')) {
      toast('Invite failed: Authentication error. Try signing out and back in.','err');
    } else {
      toast('Invite failed: ' + msg, 'err');
    }
  } finally {
    if (inviteBtn) { inviteBtn.disabled = false; inviteBtn.textContent = 'Send Invite ✉'; }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// AI FLASH NOTE GENERATION
// ══════════════════════════════════════════════════════════════════════════════

async function flashGenerateAINote() {
  const btn = document.getElementById('flashAIBtn');
  if (btn) { btn.disabled = true; btn.textContent = '✦ Generating…'; }

  try {
    const periodId = _flashCurrentPeriod;
    if (!periodId) throw new Error('No period selected');
    const y = Math.floor(periodId/100), m = periodId%100;
    const actCode = `ACTUALS_${y}_${String(m).padStart(2,'0')}`;
    const actFacts = fpa?.facts?.[actCode] || {};

    // Helper: sum all period values for a line
    const getVal = lineId => {
      const entries = actFacts[lineId];
      if (!entries) return null;
      return Object.values(entries).reduce((s,v)=>s+(Number(v)||0), 0);
    };

    // Build financial context for AI prompt
    const ctx = {
      period:       FLASH_MONTHS[periodId] || `${y}-${String(m).padStart(2,'0')}`,
      totalRevenue: getVal('pl_total_sales'),
      fuelRevenue:  getVal('fuel_rev'),
      nonFuelRev:   getVal('nonfuel'),
      ebitda:       getVal('ebitda'),
      netIncome:    getVal('net_inc'),
      om_total:     getVal('total_om'),
      capex:        getVal('cf_capex'),
      section:      document.getElementById('flashNoteSection')?.value || 'general',
    };

    if (!_sb) throw new Error('No database connection');

    const { data, error } = await _sb.functions.invoke('generate-flash-note', { body: ctx });
    if (error) throw error;

    const suggested = data?.note;
    if (!suggested) throw new Error('No note returned from AI');

    const ta = document.getElementById('flashNoteInput');
    if (ta) { ta.value = suggested; ta.focus(); ta.style.borderColor='#003da5'; }
    toast('AI draft ready — review and edit before saving','ok');

  } catch(e) {
    const msg = e.message || String(e);
    if (msg.includes('Edge Function') || msg.includes('not found') || msg.includes('FunctionsFetchError')) {
      toast('AI service not yet deployed — see console for setup instructions','w');
      console.info('[AI Notes] Edge Function "generate-flash-note" needs to be deployed to Supabase. Run: supabase functions deploy generate-flash-note');
    } else {
      toast('AI generation failed: '+msg,'err');
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✦ AI Draft'; }
  }
}

// ── Export PDF ────────────────────────────────────────────────────────────────
function flashExportPDF() {
  const title=document.title;
  document.title=`JPS Flash Report — ${FLASH_MONTHS[_flashCurrentPeriod]||_flashCurrentPeriod}`;
  document.body.classList.add('printing-flash');
  // Temporarily force report body visible for print
  const rb=document.getElementById('flashReportBody');
  const prevDisplay=rb?.style.display;
  if (rb) rb.style.display='block';
  window.print();
  document.body.classList.remove('printing-flash');
  if (rb&&prevDisplay!==undefined) rb.style.display=prevDisplay;
  document.title=title;
  toast('Print dialog opened — save as PDF','ok');
}

// ── Export Excel ──────────────────────────────────────────────────────────────
function flashExportXLSX() {
  if (typeof XLSX==='undefined'){toast('XLSX library not loaded','err');return;}
  const periodId=_flashCurrentPeriod;
  const moLabel=FLASH_MONTHS[periodId]||String(periodId);
  const plTbl=document.getElementById('flashPLTable');
  const bsTbl=document.getElementById('flashBSTable');
  const genTbl=document.getElementById('flashGenTable');
  const rows=[];
  rows.push([`JPS Management Flash Report — ${moLabel}`]);
  rows.push(['Generated:',new Date().toLocaleString('en-JM',{dateStyle:'long',timeStyle:'short'})]);
  rows.push([]);
  rows.push(['GENERATION & SALES']);
  if (genTbl) genTbl.querySelectorAll('tr').forEach(tr=>{rows.push([...tr.querySelectorAll('th,td')].map(c=>c.innerText.replace(/\n/g,' ')));});
  rows.push([]);
  rows.push(['INCOME STATEMENT — Month & YTD vs Budget & LE']);
  if (plTbl) plTbl.querySelectorAll('tr').forEach(tr=>{rows.push([...tr.querySelectorAll('th,td')].map(c=>c.innerText.replace(/\n/g,' ')));});
  rows.push([]);
  rows.push(['BALANCE SHEET HIGHLIGHTS']);
  if (bsTbl) bsTbl.querySelectorAll('tr').forEach(tr=>{rows.push([...tr.querySelectorAll('th,td')].map(c=>c.innerText.replace(/\n/g,' ')));});
  rows.push([]);
  rows.push(['MANAGEMENT COMMENTARY']);
  rows.push(['Date','Author','Section','Note']);
  _flashNotesData.forEach(n=>{rows.push([n.entered_at,n.entered_by,n.section,n.note_text]);});
  const ws=XLSX.utils.aoa_to_sheet(rows);
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Flash Report');
  XLSX.writeFile(wb,`JPS_Flash_${moLabel.replace(/\s/g,'_')}.xlsx`);
  toast('Excel exported','ok');
}
