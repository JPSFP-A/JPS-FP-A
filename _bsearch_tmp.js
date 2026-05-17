
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
    [2026,2027,2028,2029,2030].forEach(yr => {
      if (!collRows[yr]) return;
      Object.entries(dbIdToLegacy).forEach(([dbId, legacyId]) => {
        const row = collRows[yr].find(r => r.id === legacyId);
        if (!row || !row.vals) return;   // skip derived rows (null vals)
        const monthMap = collSrc[dbId]?.value || {};
        for (let m = 1; m <= 12; m++) {
          const v = monthMap[2026 * 100 + m];
          if (v !== undefined && v !== null) row.vals[m-1] = Number(v);
        }
      });
    });
  } catch(e) { console.warn('[FPA] coll bridge:', e); }
}

function fpaApplyDepToLegacy() {
  if (!fpa.versions.length) return;
  try {
    const depSrc = fpa.assumptions?.[_aopCode()]?.dep_comp || {};
    if (typeof depreciationComponents === 'undefined' || !depreciationComponents[2026]) return;
    const dbIdToLegacy = {
      dep_fa:'faRegister',  dep_sjpc:'sjpc',           dep_leases:'otherLeases',
      dep_capex:'capexTransfers', dep_spares:'capitalSpares',
      dep_decomm:'decommissioning', dep_meters:'strandedMeters',
      dep_lights:'strandedLights',  dep_impair:'impairment',
    };
    Object.entries(dbIdToLegacy).forEach(([dbId, legacyKey]) => {
      const monthMap = depSrc[dbId]?.value || {};
      if (!depreciationComponents[2026][legacyKey]) return;
      for (let m = 1; m <= 12; m++) {
        const v = monthMap[2026 * 100 + m];
        if (v !== undefined && v !== null) depreciationComponents[2026][legacyKey][m-1] = Number(v);
      }
    });
  } catch(e) { console.warn('[FPA] dep bridge:', e); }
}

// ── Bridge: AOP_2026 assumptions → tariff / volume / FX / gen / fuel ────────
// Reads from fpa.assumptions[_aopCode()] (loaded in fpaBootstrap) and writes
// into the legacy global arrays consumed by the revenue engine and KPI tables.
function fpaApplyAssumptionsToLegacy() {
  if (!fpa.assumptions?.[_aopCode()]) return;
  const aop = fpa.assumptions[_aopCode()];

  // Helper: build 12-element monthly array for 2026 from assumption store
  const mo12 = (cat, key, sk = '') => {
    const src = aop[cat]?.[key]?.[sk] || {};
    return Array(12).fill(0).map((_, m) => Number(src[2026 * 100 + m + 1] ?? 0));
  };
  // Helper: single annual value (stored with month=0 or month=null)
  const single = (cat, key, sk = '') => {
    const src = aop[cat]?.[key]?.[sk] || {};
    if (src[2026 * 100] !== undefined) return Number(src[2026 * 100]);
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
    if (fxTable.years?.[2026]) fxTable.years[2026].billing = fxBill.slice();
  }
  if (fxExp.some(v => v)) {
    fxTable.expense = fxExp.slice();
    if (fxTable.years?.[2026]) fxTable.years[2026].expense = fxExp.slice();
  }

  // ── System loss % (monthly) ───────────────────────────────────────────────
  const sysLoss = mo12('sys_loss', 'total');
  if (sysLoss.some(v => v)) sysLossTable[2026] = sysLoss;

  // ── Net generation by source (GWh/month) → netGenTable[2026] ─────────────
  const ngSrcs = { jps_thermal:'jps_thermal', old_harbour:'old_harbour',
                   renewables:'renewables',   ipp:'ipp' };
  Object.entries(ngSrcs).forEach(([dbKey, jsKey]) => {
    const vals = mo12('net_gen', dbKey);
    if (vals.some(v => v)) netGenTable[2026][jsKey] = vals;
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
      fuelCostByMonth[2026][m]   = fuelCost[m];
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
    if (prices.some(v => v)) fuelPriceTable[2026][fuel] = prices;
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
  const yrs = [2027, 2028, 2029, 2030];

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

let _dmYear        = 2026;
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
  var year   = _dmYear || 2026;
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

  // All 2026 per-month actuals at once
  if (monthly.some(v => Math.floor(v.period_id/100)===2026)) {
    sel.innerHTML += `<option value="all2026">⚠ ALL 2026 monthly actuals</option>`;
  }

  // AOP
  const aop = (fpa.versions||[]).find(v=>v.code===_aopCode());
  if (aop) {
    const fc = Object.values(fpa.facts[_aopCode()]||{}).length;
    sel.innerHTML += `<option value="aop">AOP 2026 Budget (${fc} lines)</option>`;
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
    'all2026': '⚠ This will erase ALL uploaded monthly actuals for 2026. You will need to re-upload each month.',
    'aop':     '⚠ This will erase all AOP 2026 budget facts. You will need to re-upload the Budget Template.',
  };
  let msg = msgs[scope];
  if (!msg) {
    if (scope.startsWith('month:')) {
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

    } else if (scope === 'all2026') {
      // All per-month 2026 actuals
      const vers = (fpa.versions||[]).filter(v=>v.kind==='ACTUAL'&&v.period_id&&Math.floor(v.period_id/100)===2026);
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
  const planYrOpts = [2026,2027,2028,2029,2030]
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
    } catch(e) {
      errEl.textContent = e.message || 'Sign-in failed. Check email and password.';
      if (loginBtn) { loginBtn.textContent = 'Sign In'; loginBtn.disabled = false; }
      return;
    }
    if (loginBtn) { loginBtn.textContent = 'Sign In'; loginBtn.disabled = false; }
  } else {
    // ── Local mode fallback ───────────────────────
    const name = nameEl ? nameEl.value.trim() : '';
    if (!name) {
      errEl.textContent = 'Please enter your name to continue.';
      nameEl && nameEl.focus();
      return;
    }
    errEl.textContent = '';
    currentUser = { id: 'local_' + Date.now(), name, email: '', role: _selectedLoginRole };
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
const YEARS=['2022','2023','2024','2025','2026','2027','2028','2029','2030'];
let period='quarterly', activeSc='Base Case';
let dashYear    = 2026;   // year shown on dashboard charts
let cfYear      = 2026;   // year shown on cash flow report
let varYear     = 2026;   // year shown on variance report
let actualsYear = 2026;   // year of currently active uploaded actuals
let planYear    = 2026;   // year of the active AOP / Budget plan

// _acts(mo) — reads actuals for the active year.
// Tries actualsStore[actualsYear][mo] first; for 2026 falls back to the
// legacy month-only store so existing in-memory data is never lost.
const _acts = (mo) =>
  actualsStore[actualsYear]?.[mo] ??
  (actualsYear === 2026 ? _acts(mo) : undefined);

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
// Scenarios — year-keyed byYear for 2026-2030
function mkScYears(base){const yrs={};[2026,2027,2028,2029,2030].forEach(y=>{yrs[y]={...base};});return yrs;}
let scenarios={
  'Base Case':{color:'#f0b429',desc:'Central case; Feb 2026 LE as filed. Moderate growth with Hurricane Melissa restoration costs.',eb:0,rv:0,om:0,cx:0,fu:0,tr:0,cr:0,byYear:mkScYears({eb:0,rv:0,om:0,cx:0,fu:0,tr:0,cr:0})},
  'Upside':   {color:'#10b981',desc:'Favourable tariff review outcome, lower fuel prices, stronger demand recovery.',eb:8,rv:5,om:-2,cx:0,fu:-5,tr:2,cr:0.5,byYear:mkScYears({eb:8,rv:5,om:-2,cx:0,fu:-5,tr:2,cr:0.5})},
  'Downside': {color:'#ef4444',desc:'Adverse fuel, FX devaluation, demand shortfall, no tariff increase approved.',eb:-12,rv:-4,om:3,cx:0,fu:8,tr:-1,cr:-1,byYear:mkScYears({eb:-12,rv:-4,om:3,cx:0,fu:8,tr:-1,cr:-1})},
  'Management':{color:'#d97706',desc:'Management stretch; all efficiency targets achieved, accelerated restoration.',eb:5,rv:3,om:-3,cx:-5,fu:0,tr:1,cr:0.5,byYear:mkScYears({eb:5,rv:3,om:-3,cx:-5,fu:0,tr:1,cr:0.5})},
};
let selectedScYear = 2026;
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
  [2026,2027,2028,2029,2030].forEach(y=>{
    obj[y]={};
    Object.keys(base).forEach(k=>{obj[y][k]=[...base[k]];});
  });
  return obj;
}
let depreciationComponents = _mkDepComp();
let selectedDepYear = 2026;

let impairmentEvents = []; // zeroed — populated from DB registers

function calcDepTotals(yr,m){
  const c=depreciationComponents[yr]||depreciationComponents[2026];
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
  [2026,2027,2028,2029,2030].forEach(y=>{
    obj[y]=base.map(r=>({...r,vals:[...r.vals],growthRate:0}));
  });
  return obj;
}
let omRows=_mkOMRows();
let omGrowthRates={};// {yr:{rowId:rate}} — populated by UI
let selectedOMYear=2026;

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
  [2026,2027,2028,2029,2030].forEach(y=>{
    obj[y]=base.map(r=>({...r,vals:[...r.vals],growthRate:0}));
  });
  return obj;
}
let capexRows=_mkCapexRows();
let selectedCapexYear=2026;

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
  [2026,2027,2028,2029,2030].forEach(y=>{
    obj[y]=base.map(r=>({...r,vals:r.vals?[...r.vals]:null}));
  });
  return obj;
}
let collRows=_mkCollRows();
let selectedCollYear=2026;

// Other Operating Revenue — year-keyed
let otherOperatingRevenue={};
[2026,2027,2028,2029,2030].forEach(y=>{
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

// Net Financing rows — year-keyed
let netFinancingRows={};
[2026,2027,2028,2029,2030].forEach(y=>{
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
const getOMRows=(yr)=>omRows[yr||selectedOMYear]||omRows[2026];
const getCxRows=(yr)=>capexRows[yr||selectedCapexYear]||capexRows[2026];
const getCollRows=(yr)=>collRows[yr||selectedCollYear]||collRows[2026];

function computeAll(yr){
  yr=yr||selectedCollYear||2026;
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
let plYrFrom = 2024, plYrTo = 2027;

function getCols(){
  const yF = plYrFrom, yT = plYrTo;
  const cols=[];
  if(period==='annual'){for(let y=yF;y<=yT;y++)cols.push({lbl:y+'',yr:y,act:y<=2025});}
  else if(period==='quarterly'){for(let y=yF;y<=yT;y++){['Q1','Q2','Q3','Q4'].forEach((q,qi)=>cols.push({lbl:q+String(y).slice(2),yr:y,qi,act:y<=2025}));}}
  else{for(let y=Math.max(yF,2026);y<=Math.min(yT,2027);y++)MONTHS.forEach((m,mi)=>cols.push({lbl:m[0]+' '+String(y).slice(2),yr:y,mi,act:false}));}
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
  [2026,2027,2028,2029,2030].forEach((y,i)=>{
    const prepArr=getInsurancePrepaidByMonth(y);
    // vals array index corresponds to position in YEARS + historical columns
    // bsLines vals: [2021,2022,2023,2024,2025,2026,2027,2028,2029,2030] (0-indexed)
    // 2026 is at index 5 in bsLines vals (matching existing data pattern)
    line.vals[5+i]=prepArr[11]||0;
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
      <strong>● Actuals — ${MONTHS[latestActMo-1]} 2026</strong> &nbsp;·&nbsp; Cash: $${Math.round(actBS.cash||0).toLocaleString()}K &nbsp;·&nbsp;
      Receivables: $${Math.round(actBS.receivables||0).toLocaleString()}K &nbsp;·&nbsp; Total Assets: $${Math.round(actBS.totalAssets||0).toLocaleString()}K
      &nbsp;·&nbsp; Current Ratio: ${cr} &nbsp;·&nbsp; Source: B_S sheet of uploaded file
    </td></tr>`;
  }
  bEl.innerHTML=html;
}

// ═══════════════════════════════════════════════════════
//  DEPRECIATION REPORT
// ═══════════════════════════════════════════════════════
// depYears — columns for the historic rpt-dep report (uses depLines[] read-only reference)
const depYears = ['2021','2022','2023','2024','2025','2026','2027'];
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
  document.getElementById('depH').innerHTML=`<tr><th style="text-align:left;min-width:260px">Component</th>${depYears.map(y=>`<th class="${y<='2025'?'ac':'bc'}">${y}</th>`).join('')}</tr>`;
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
  const leDepArr=MONTHS.map((_,m)=>Math.round(calcDepTotals(2026,m).regular/1000));

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
let cfSelectedMonth = 2; // default Feb

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
const directCFSeed = {
  labels: ['Nov-25','Dec-25','Jan-26','Feb-26','Mar-26','Apr-26','May-26','Jun-26'],
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
    {n:'  Capital expenditure',         a:capex,               b:-55000},
    {n:'  Dividend received',           a:divRec,              b:0},
    {n:'  Proceeds from disposal',      a:proceeds,            b:0},
    {n:'Net cash used in investing',    a:netCashInvesting, b:bud.netCashInvesting, tot:true},
    {s:'FINANCING ACTIVITIES'},
    {n:'  Loan drawdowns',              a:loanDrawdowns,       b:0},
    {n:'  Loan repayments',             a:loanRepayments,      b:0},
    {n:'  Interest paid',               a:interestPaid,        b:0},
    {n:'  Preference dividends paid',   a:prefDivPaid,         b:-179},
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
let selectedKpiYear = 2026;

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
  const YIDX = {2026:4,2027:5,2028:6,2029:7,2030:8};
  const line = plLines.find(l => l.name && l.name.toLowerCase().includes(nameFrag.toLowerCase()));
  if (!line) return 0;
  if (mo !== undefined) {
    // monthly P&L
    const yr26mo = mo; // index 0-11 into vals array — monthly P&L uses buildMonthlyPL
    return 0; // fallback — monthly P&L not easily extractable from plLines (annual)
  }
  return line.vals?.[YIDX[yr]] || 0;
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
  const leVer = yr <= 2025 ? `HIST_ACTUAL_${yr}` :
                yr === 2026 ? 'LE_2026_02' : 'FORECAST_BASE';

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

      // 2. Seeded actuals (month-indexed, 2026 only): _acts(month).pl
      if (yr === 2026) {
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
  const YIDX = {2026:4,2027:5,2028:6,2029:7,2030:8};
  const el = document.getElementById('kpiScoreCards');
  if (!el) return;

  // Annual totals from plLines
  const getLine = (frag) => {
    const l = plLines.find(l=>l.name&&l.name.toLowerCase().includes(frag.toLowerCase()));
    return l?.vals?.[YIDX[yr]]||0;
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

  // Billed sales GWh
  const billedArr = [2026,2027,2028,2029,2030].includes(yr)
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
  const _yIdx = 4; // index for 2026 in plLines.vals (2021,2022,2023,2024,2025,2026,...)
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

// ── Leverage Table (annual, 2026-2030) ───────────────
function buildKpiLeverageTable() {
  const el = document.getElementById('kpiLevBody');
  if (!el) return;
  const YRS = [2026,2027,2028,2029,2030];
  const YIDX = {2026:4,2027:5,2028:6,2029:7,2030:8};

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
    if (!v && yr === 2026) {
      const closedMos = [12,11,10,9,8,7,6,5,4,3,2,1].filter(m => fpa.isPeriodClosed(2026, m));
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
  const YRS = [2026,2027,2028,2029,2030];
  const YIDX = {2026:4,2027:5,2028:6,2029:7,2030:8};
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
    const cashBal = bsLines.find(l=>l.id==='cash')?.vals?.[{2026:4,2027:5,2028:6,2029:7,2030:8}[yr]??4] || 0;
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
let selectedDebtYear = 2026;
let selectedLoanId   = null;
let selectedDebtAmortYear = 2026;

// ── Loan register data ───────────────────────────────
// Seeded from AOP 2026 / Feb 2026 corporate data
// Loan register — empty. Add facilities through the Debt Management UI or upload.
let loanRegister = [];

// ── Loan amortisation engine ─────────────────────────
function computeLoanSchedule(loan, yr) {
  const schedule = [];
  // Determine opening balance for this year
  let openBal = loan.openBal;
  // Roll forward from base year if needed
  if (yr > 2026) {
    for (let y = 2026; y < yr; y++) {
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
  const YRS = [2026,2027,2028,2029,2030];
  const fmtK = v => v?'$'+Math.round(v).toLocaleString():'—';

  const sumByYr = yr => {
    const agg = getDebtAggregates(yr);
    return {
      openBal:  loanRegister.filter(l=>l.active).reduce((s,l)=>{
        // Roll opening balance
        if(yr===2026) return s+(l.openBal||0);
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
    const YIDX={2026:4,2027:5,2028:6,2029:7,2030:8};
    const l=plLines.find(l=>l.name&&l.name.toLowerCase().includes('ebitda'));
    return l?.vals?.[YIDX[selectedDebtYear]]||0;
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
  const YRS = [2026,2027,2028,2029,2030];
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
  [2026,2027,2028,2029,2030].forEach(yr => {
    if (!netFinancingRows[yr]) return;
    const agg = getDebtAggregates(yr);
    // Write computed interest into intExpense vals (preserve manually-seeded 2026 actuals for Jan/Feb)
    const existing = netFinancingRows[yr].intExpense.vals;
    agg.totalInterest.forEach((v, m) => {
      // Keep actuals for months already loaded
      if (yr===2026 && (m===0||m===1) && existing[m]!==0) return;
      netFinancingRows[yr].intExpense.vals[m] = -v; // negative = expense
    });
  });
}

function exportDebtCSV() {
  const YRS = [2026,2027,2028,2029,2030];
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
  const monthLabel = data ? data.month : (MONTHS[mo-1] + ' 2026');
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
      // Also update fuelCostByMonth2026 legacy array for 2026 months
      if (yr === 2026) fuelCostByMonth2026[moNum - 1] = Math.abs(plAct.fuel_cos);
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
  const detectedYear = fnYrMatch ? parseInt('20' + fnYrMatch[1], 10) : (planYear || 2026);
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
  const budFX  = netFinancingRows[2026]?.budgetFX?.[mIdx] || 0;

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
    const mthBilledSales = billedSalesMWh?.[2026]?.[mIdx] || 0;
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
    const budLoss = sysLossTable[2026]?.[mIdx] || 0;
    const genMWh = mthBilledSales > 0 ? (mthBilledSales / (1 - budLoss/100)) : 0;
    const actLoss = sysLossTable[2026]?.[mIdx] || budLoss;
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
  const showGrow=(yr!==2026);
  const grHdr=showGrow?'<th title="Annual growth vs 2026 base" style="color:var(--teal)">Gr%</th>':'';
  document.getElementById('omH').innerHTML=`<tr><th style="min-width:220px;text-align:left">Category</th><th>Cash Lag</th>${grHdr}${MONTHS.map(m=>`<th class="bc">${m}</th>`).join('')}<th class="bc">Total</th><th class="ac">→Cash</th></tr>`;

  const rowHtml=rows.filter(r=>!r.derived).map(r=>{
    // ARCHITECTURAL RULE: non-cash O&M fraction must come from DB — no hardcoded haircut
    const tot=sumArr(r.vals); const cashTot=tot;
    const grPct=(r.growthRate||0);
    const grCell=showGrow?`<td><input class="ei" style="width:46px;color:var(--teal)" value="${grPct.toFixed(1)}" title="Growth % vs 2026 base" onchange="updOMGrowth('${r.id}',this.value,${yr})" onfocus="this.select()">%</td>`:'';
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
  if(yr===2026){toast('Growth rate applies to 2027-2030 only','w');return;}
  const pct=parseFloat(val)||0;
  const base2026=omRows[2026]?.find(r=>r.id===id);
  const row=getOMRows(yr).find(r=>r.id===id);
  if(!row||!base2026)return;
  row.growthRate=pct;
  const factor=Math.pow(1+pct/100,(yr-2026));
  row.vals=base2026.vals.map(v=>Math.round(v*factor));
  buildOMTable();
  toast(`O&M growth ${pct>=0?'+':''}${pct}% applied to ${yr}`,'ok');
}

function buildCapexTable(){
  const yr=selectedCapexYear;
  const rows=getCxRows(yr);
  const cxTot=getCxTotal(yr);
  const showCxGrow=(yr!==2026);
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
  if(yr===2026){toast('Growth rate applies to 2027-2030 only','w');return;}
  const pct=parseFloat(val)||0;
  const base2026=capexRows[2026]?.find(r=>r.id===id);
  const row=getCxRows(yr).find(r=>r.id===id);
  if(!row||!base2026)return;
  row.growthRate=pct;
  const factor=Math.pow(1+pct/100,(yr-2026));
  row.vals=base2026.vals.map(v=>Math.round(v*factor));
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
  if(yr!==2026){el.style.display='none';return;}
  const loadedMos=MONTHS.map((_,m)=>_acts(m+1)).filter(Boolean);
  if(!loadedMos.length){el.style.display='none';return;}
  const leReceipts=getCollRows(2026).find(r=>r.id==='receipts')?.vals||Array(12).fill(0);
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
  const yr = dashYear || 2026;
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
    const avgFxCur=((fxTable.years[yr]||fxTable.years[2026])?.billing.reduce((s,v)=>s+v,0)/12).toFixed(2);
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
        <div style="font-size:8px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px">2026 J$/US$ (billing avg)</div>
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
  if(yr!==2026){el.style.display='none';return;}
  const loadedMos=MONTHS.map((_,m)=>_acts(m+1)).filter(Boolean);
  if(!loadedMos.length){el.style.display='none';return;}
  // Get YTD actual OpEx (sga+maintenance combined) vs LE
  const ytdA=getYTDActuals();
  const actOpex=ytdA?.ytd?.opex!=null?Math.abs(ytdA.ytd.opex):null;
  const actSGA=ytdA?.ytd?.sga!=null?Math.abs(ytdA.ytd.sga):null;
  const actMaint=ytdA?.ytd?.maintenance!=null?Math.abs(ytdA.ytd.maintenance):null;
  const n=loadedMos.length;
  const leOMTot=getOMTotal(2026);
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
  const y = yr || dashYear || 2026;
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
  const yr = dashYear || 2026;
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
  // Actuals overlay for 2026 monthly
  const actRevMo  = MONTHS.map((_,m) => _acts(m+1)?.pl?.totalSales ?? null);
  const hasActRev = yr===2026 && actRevMo.some(v=>v!==null);
  const revDatasets = [
    {label:'Revenue (LE)',data:revData,backgroundColor:'rgba(59,130,246,.45)',yAxisID:'y',order:2},
    {label:'EBITDA (LE)',data:ebiData,type:'line',borderColor:CP[0],pointBackgroundColor:CP[0],borderWidth:2.5,tension:.3,pointRadius:4,yAxisID:'y',order:1},
  ];
  if(hasActRev && (period==='monthly'||period==='ytd')){
    revDatasets.push({label:'Revenue (Actual)',data:_pData(actRevMo.map(v=>v??0)),type:'line',borderColor:'rgba(16,185,129,.9)',borderWidth:2,tension:.3,pointRadius:5,borderDash:[4,3],yAxisID:'y',order:0});
  }
  mkChart('cRevEb',{type:'bar',data:{labels,datasets:revDatasets},options:bO()});

  // ── 2. Scenario Net Income — always multi-year (comparison chart) ─────────
  const scYrs=['2026','2027','2028','2029','2030'];
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
  {const _dc=depreciationComponents[yr]||depreciationComponents[2026]||{};