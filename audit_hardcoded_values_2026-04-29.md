# Hardcoded / Fake Values Audit — JPS FP&A Platform
**File:** `index.html`  
**Date:** 2026-04-29  
**Auditor:** Claude (read-only pass — no edits made)

---

## SUMMARY COUNTS

| Severity | Count |
|---|---|
| 🔴 CRITICAL | 5 |
| 🟠 HIGH | 11 |
| 🟡 MEDIUM | 9 |
| **Total findings** | **25** |

---

## 🔴 CRITICAL FINDINGS
*(Wrong or stale data shown to users — silent data integrity risk)*

---

### C-01 — AI context prompt has hardcoded dollar figures for revenue and depreciation
**Lines:** 12205–12213  
**Code:**
```js
- Non-Fuel Revenue: $340,501k
- Fuel Revenue: $146,369k
- EBITDA Margin: ~38.1%
- Total Depreciation: $125,770k (source: Depreciation_February_2026_LE_revised.xlsx; includes SJPC $22.6M, Lease Assets $15.5M, CapEx transfers $14.4M from Feb 2026)
- Payroll $65.2M = 36% of total
- Hurricane Melissa restoration ~$28M, Distribution upgrade $23M
- Blended collection rate 94.1%
```
**Severity:** CRITICAL  
**Problem:** The AI assistant (`getFinancialContext()`) will feed these hardcoded 2026 numbers to Claude even after the model year changes or actuals are uploaded and differ from these values. It will confidently cite "$340,501k Non-Fuel Revenue" when the actual DB value may be different.  
**Fix:** Replace every hardcoded figure in `getFinancialContext()` with live computed values from `plLines`, `getOMTotal()`, `fuelCostByMonth`, etc. The EBITDA, Net Income, O&M total, and CapEx total are already pulled dynamically (lines 12207, 12210–12212) — the remaining static strings must match the same pattern.

---

### C-02 — AI context "2025 Actuals vs 2026 Budget Variances" are hardcoded narrative
**Lines:** 12215–12219  
**Code:**
```
2025 Actuals vs 2026 Budget Variances:
- EBITDA: +$15.9M / +7.0% improvement
- Net Income: +$25.2M / +126% recovery
- Depreciation: -$19.3M favourable (hurricane impairment not recurring)
- O&M: +$4.3M adverse vs 2025 actuals (inflation + restoration costs)
```
**Severity:** CRITICAL  
**Problem:** These are hardcoded strings from an earlier session where Excel files were loaded locally. With `fpa_facts` now empty (0 rows), the AI will state these figures as fact when no actuals or 2025 data exists in the DB.  
**Fix:** Compute YoY variances dynamically from `plLines.vals` (2025 index vs 2026 index). If 2025 data is zero, emit a message like "2025 actuals not loaded — variances unavailable."

---

### C-03 — Indirect CF budget column has hardcoded CapEx budget and dividend figure
**Line:** 8202, 8210  
**Code:**
```js
{n:'  Capital expenditure',  a:capex,  b:-55000},
...
{n:'  Preference dividends paid', a:prefDivPaid, b:-179},
```
**Severity:** CRITICAL  
**Problem:** The "MTD Budget" column for Capital Expenditure is hardcoded to `$55,000K` and Preference Dividends to `$179K`. These are not read from the DB (`fpa_facts` AOP_2026 version). They will never update when a new budget is loaded.  
**Fix:** Read `b` values from `fpa.fact('AOP_2026', lineId, cfYear, mo)` using the correct line IDs (`cf_capex`, `cf_pref_div_paid`).

---

### C-04 — `directCFSeed.labels` are hardcoded to specific months
**Lines:** 8080–8106  
**Code:**
```js
labels: ['Nov-25','Dec-25','Jan-26','Feb-26','Mar-26','Apr-26','May-26','Jun-26'],
```
**Severity:** CRITICAL  
**Problem:** The Direct Cash Flow view is permanently pinned to Nov-2025 through Jun-2026. When the year moves on — or when the user uploads March or April actuals — the label row will be wrong, columns will misalign, and the forecast population logic (line 8289: `forecastMonths = [2,3,4,5]`) will compute against the wrong months.  
**Fix:** Build the label array dynamically from `cfYear`, starting 2 months before January of `cfYear` and spanning 8 months forward. Use `fpa.periods` to determine which are closed.

---

### C-05 — Erase Modal hardcodes "all2026" and "AOP 2026" as fixed options
**Lines:** 6552–6560  
**Code:**
```js
if (monthly.some(v => Math.floor(v.period_id/100)===2026)) {
  sel.innerHTML += `<option value="all2026">⚠ ALL 2026 monthly actuals</option>`;
}
sel.innerHTML += `<option value="aop">AOP 2026 Budget (${fc} lines)</option>`;
```
**Severity:** CRITICAL  
**Problem:** The erase scope option for "all 2026 monthly actuals" is hardcoded to the year 2026. When 2027 actuals exist in the DB, there will be no equivalent option to erase them. The "AOP 2026" label will also become stale when `planYear` changes to 2027.  
**Fix:** Loop over years that have monthly actuals in `fpa.versions`, creating one option per year. Use `_aopCode()` as the label (already dynamic), and use the actual year from the version's `period_id`.

---

## 🟠 HIGH FINDINGS
*(Zeros shown where live data should appear, or labels that will be wrong)*

---

### H-01 — `actualsYear` and `planYear` default to hardcoded `2026`
**Line:** 7464–7468  
**Code:**
```js
let dashYear    = 2026;
let cfYear      = 2026;
let varYear     = 2026;
let actualsYear = 2026;
let planYear    = 2026;
```
**Severity:** HIGH  
**Problem:** All five year-tracking globals are hardcoded to 2026. They should default to the **current calendar year** (i.e. `new Date().getFullYear()`) or be derived from the latest closed period in `fpa_dim_period`. When 2027 arrives, all dashboards will silently default to 2026 until manually changed.  
**Fix:**
```js
const _currentYear = new Date().getFullYear();
let dashYear    = _currentYear;
let cfYear      = _currentYear;
let varYear     = _currentYear;
let actualsYear = _currentYear;
let planYear    = _currentYear;
```
Then on bootstrap: set `actualsYear` to the year of the latest ACTUALS_* version with facts, and `planYear` to the year of the active AOP/LE version.

---

### H-02 — `plYrFrom` and `plYrTo` default to hardcoded year range
**Line:** 7872  
**Code:**
```js
let plYrFrom = 2024, plYrTo = 2027;
```
**Severity:** HIGH  
**Problem:** The annual P&L and Balance Sheet year range dropdowns default to 2024–2027. In 2027 this will show a stale window. Should derive from `new Date().getFullYear() - 2` and `+ 2`.  
**Fix:** `let plYrFrom = new Date().getFullYear() - 2; let plYrTo = new Date().getFullYear() + 2;`

---

### H-03 — `cfSelectedMonth` defaults to hardcoded month 2 (February)
**Line:** 8063  
**Code:**
```js
let cfSelectedMonth = 2; // default Feb
```
**Severity:** HIGH  
**Problem:** The Cash Flow report always opens on February regardless of what month it is or what the latest closed period is. Should default to the most recently closed month from `fpa_dim_period`.  
**Fix:** `let cfSelectedMonth = fpa.latestClosedMonth(new Date().getFullYear()) || new Date().getMonth() + 1;`

---

### H-04 — `_dmYear` defaults to hardcoded 2026
**Line:** 4978  
**Code:**
```js
let _dmYear = 2026;
```
**Severity:** HIGH  
**Problem:** The Data Management calendar always opens on 2026. When 2027 comes, users must manually click to change the year.  
**Fix:** `let _dmYear = new Date().getFullYear();`

---

### H-05 — `depYears` column array is fully hardcoded
**Line:** 7980  
**Code:**
```js
const depYears = ['2021','2022','2023','2024','2025','2026','2027'];
```
**Severity:** HIGH  
**Problem:** The Depreciation Schedule table will forever show 2021–2027 as its column headers, regardless of what years are in the DB. In 2027 the "2027" column becomes a historical column and 2028 is missing.  
**Fix:** Derive from the range of years in `depreciationComponents` (or from `new Date().getFullYear() - 5` to `+ 1`).

---

### H-06 — `YEARS` constant array is hardcoded to 2022–2030
**Line:** 7462  
**Code:**
```js
const YEARS=['2022','2023','2024','2025','2026','2027','2028','2029','2030'];
```
**Severity:** HIGH  
**Problem:** `YEARS` is used as the index array for `plLines.vals[]` and `bsLines.vals[]`. It never updates. When columns are added or years roll over, the array mapping (`YEARS.indexOf(String(col.yr))`) returns `-1` and data silently disappears.  
**Fix:** Build `YEARS` dynamically from the actual range in `fpa.versions` or from a window around `new Date().getFullYear()`.

---

### H-07 — `blendedAnnual()` hardcodes the year 2025 as the boundary for "historical" data
**Lines:** 4405–4408  
**Code:**
```js
if (y <= 2025) return null;   // Historical years (2022-2025): always zero
if (y >= 2027) return null;   // 2027+: always zero
```
**Severity:** HIGH  
**Problem:** These two hardcoded cutoffs control whether P&L lines are populated from the DB. In 2027 the first condition becomes `y <= 2025` (still valid), but the second (`y >= 2027`) would wrongly zero out 2027 actuals when they start being uploaded.  
**Fix:** Replace with `y < actualsYear` (for historical) and `y > actualsYear` (for future), or use `fpa_dim_period.is_closed` as the authority on what has uploaded actuals.

---

### H-08 — `act:y<=2025` hardcodes the "actuals" column colour cutoff
**Lines:** 7877–7879 (inside `getCols()`)  
**Code:**
```js
cols.push({lbl:y+'', yr:y, act:y<=2025})   // ← blue "actuals" style applied to ≤2025
```
**Severity:** HIGH  
**Problem:** All years up to and including 2025 are styled as "actual" (shaded blue), 2026+ as "budget" (purple). In 2027 when 2026 actuals are uploaded and closed, the 2026 column will still be styled as "budget."  
**Fix:** Use `y < actualsYear` or check `fpa.latestClosedMonth(y) > 0` to determine actuals styling.

---

### H-09 — Quarterly / Monthly breakdown uses flat seasonal weights
**Lines:** 7893–7894  
**Code:**
```js
if(col.qi!==undefined){const qw=[.25,.25,.25,.25]; return Math.round(base*qw[col.qi]);}
if(col.mi!==undefined){const mw=Array(12).fill(1/12); return Math.round(base*mw[col.mi]);}
```
**Severity:** HIGH  
**Problem:** The annual P&L quarterly and monthly columns spread values evenly (25% per quarter / 1/12 per month). The comment acknowledges this should come from `fpa_assumptions`. This produces demonstrably wrong numbers for any line with seasonality (fuel costs, collections, insurance premiums).  
**Fix:** When AOP/LE assumption monthly values are loaded into `fpa.facts`, use `fpa.factMonthly(versionCode, lineId, year)` to build the monthly breakdown instead of the flat spread. Fall back to flat spread only when no monthly assumption exists in DB.

---

### H-10 — Blended collection rate uses hardcoded equal weights (1/3 each)
**Line:** 7838  
**Code:**
```js
const rIds=['cr_rt10','cr_rt20','cr_rt40']; const wts=[1/3,1/3,1/3];
```
**Severity:** HIGH  
**Problem:** The blended collection rate is computed as a simple average of RT10/RT20/RT40 rates, even though these rate classes have vastly different billing volumes (RT10 is roughly 70% of customers). This produces a meaningless blended rate that looks like a real metric.  
**Fix:** Weight by actual customer count or billing volume from `volumeTable` / `collRows`. If those aren't loaded, fall back to the flat average but display a "weighted data unavailable" warning.

---

### H-11 — `projTariffReviews` has hardcoded 2028 and 2030 tariff events with specific uplift %
**Lines:** 15755–15758  
**Code:**
```js
const projTariffReviews = [
  {year:2028, month:4, uplift:5.0, status:'Forecast',   basis:'CPI + WACC re-determination'},
  {year:2030, month:4, uplift:5.0, status:'Indicative', basis:'Pending OUR regulatory cycle'},
];
```
**Severity:** HIGH  
**Problem:** These tariff review events are baked into the JS and feed the 5-year projection engine. They are not editable through the DB. The Tariff Review modal on line 3854 is for creating new events, but these defaults are never saved to `fpa_assumptions` — so they will always override whatever the user enters, or worse, be silently used when the modal-created events don't match.  
**Fix:** Load tariff review events from `fpa_assumptions` (category `proj`, key `tariff_review`). The modal already exists to create events; wire it to upsert to `fpa_assumptions` and remove the hardcoded defaults.

---

## 🟡 MEDIUM FINDINGS
*(Cosmetic, label, or minor UX issues that won't corrupt data but mislead users)*

---

### M-01 — Dashboard year dropdown options are hardcoded to 2026–2030
**Lines:** 1576–1581 (HTML)  
**Code:**
```html
<select class="sel" id="dashYrSel" onchange="setDashYear(this.value)">
  <option value="2026" selected>2026</option>
  <option value="2027">2027</option>
  ...
  <option value="2030">2030</option>
</select>
```
**Severity:** MEDIUM  
**Problem:** These are static HTML options. When 2025 data exists or 2030 data is needed beyond the dropdown, users can't select it.  
**Fix:** Build dropdown dynamically using JS from `fpa.versions.map(v=>v.year).filter(unique)` on bootstrap.

---

### M-02 — Balance Sheet "From/To" year dropdowns are hardcoded in HTML
**Lines:** 1651, 1655 (HTML)  
**Code:**
```html
<option>2022</option><option>2023</option><option selected>2024</option><option>2025</option><option>2026</option>
<option>2026</option><option selected>2027</option><option>2028</option><option>2029</option><option>2030</option>
```
**Severity:** MEDIUM  
**Fix:** Build dynamically from `YEARS` array (after YEARS itself is fixed per H-06).

---

### M-03 — Cash Flow month dropdown has hardcoded "Jan 2026"–"Dec 2026" labels
**Lines:** 1834–1839 (HTML)  
**Code:**
```html
<option value="1">Jan 2026</option><option value="2" selected>Feb 2026</option>
...
<option value="12">Dec 2026</option>
```
**Severity:** MEDIUM  
**Problem:** Labels are hardcoded to 2026. When `cfYear` changes to 2027, the dropdown still says "Jan 2026."  
**Fix:** Rebuild this dropdown dynamically in `setCfYear()` using `MONTHS.map((m,i) => ...)` with `cfYear`.

---

### M-04 — Variance report month dropdown has hardcoded "2026" months with disabled future months
**Lines:** 1890–1901 (HTML)  
**Code:**
```html
<option value="1">January 2026</option>
<option value="2" selected>February 2026</option>
<option value="3" disabled>March 2026</option>
...
```
**Severity:** MEDIUM  
**Problem:** Future months are statically `disabled` in the HTML. The disabled/enabled state should be driven by which months have a closed period in `fpa_dim_period`. As closed months are added, these options should auto-enable. Currently a user locking March 2026 in the DB would still see March disabled in this dropdown.  
**Fix:** Rebuild this dropdown dynamically from `fpa.periods`, using `is_closed` to set the disabled state.

---

### M-05 — Loan modal label says "Opening Balance Jan 2026"
**Line:** 3919 (HTML)  
**Code:**
```html
<label>Opening Balance Jan 2026 ($'000)</label>
```
**Severity:** MEDIUM  
**Problem:** This label is hardcoded to Jan 2026. For any loan entered in 2027 this is misleading.  
**Fix:** Generate the label dynamically: `Opening Balance ${MONTHS[0]} ${new Date().getFullYear()} ($'000)`.

---

### M-06 — Depreciation report lock-banner references a specific Excel file
**Line:** 1858 (HTML)  
**Code:**
```html
<div class="lock-banner">🔒 Report View — Source: Depreciation_February_2026_LE_revised.xlsx</div>
```
**Severity:** MEDIUM  
**Problem:** The banner hardcodes a specific file name from the initial upload session. This file name is wrong the moment any other file is uploaded.  
**Fix:** Display the name of the last uploaded file from the audit log (`fpa_audit_log`) or suppress the file name if it can't be determined dynamically.

---

### M-07 — Platform Guide header says "JPS FP&A v25"
**Line:** 3834 (HTML)  
**Code:**
```html
<div class="st" style="margin:0">📖 Platform Logic Guide — JPS FP&A v25</div>
```
**Severity:** MEDIUM  
**Problem:** The guide title is hardcoded to v25. The app `<title>` and other badges say v31.0.  
**Fix:** Either align to the current version string (which should live in a single constant) or remove the version number from the guide title entirely.

---

### M-08 — AI assistant quick prompts reference hardcoded years
**Lines:** 3125–3127 (HTML)  
**Code:**
```html
<div class="ai-prompt-btn">📊 Explain the EBITDA variance vs 2025 actuals</div>
<div class="ai-prompt-btn">💧 Why is net cash flow declining in Q3 2026?</div>
```
**Severity:** MEDIUM  
**Problem:** These canned prompts hardcode 2025 and 2026. They will mislead the AI when the active year is different.  
**Fix:** Generate quick prompts dynamically using `actualsYear` and `planYear` variables.

---

### M-09 — `getFinancialContext()` hardcodes reporting period as "February 2026 Latest Estimate"
**Line:** 12197  
**Code:**
```js
return `JPS Financial Context (February 2026 Latest Estimate):
- Reporting Period: February 2026 Latest Estimate (LE)`
```
**Severity:** MEDIUM  
**Problem:** The AI always believes the active period is February 2026 LE, regardless of what month/year is selected on the dashboard.  
**Fix:** Use `${MONTHS[cfSelectedMonth-1]} ${cfYear}` (or the latest closed period) to build the period label dynamically.

---

## PRIORITISED FIX ORDER

### Phase 1 — Fix with existing data (no new DB tables needed)

| # | Finding | Why first |
|---|---|---|
| 1 | C-01, C-02 | AI will confidently cite wrong numbers to management |
| 2 | C-03 | CF budget column shows hardcoded CapEx/dividend to anyone opening that screen |
| 3 | H-01 | All five year globals wrong as of Jan 1 2027 |
| 4 | H-07, H-08 | Actuals year boundary breaks all P&L/BS rendering |
| 5 | H-02, H-03, H-04 | Default year/month views open on wrong period |
| 6 | M-03, M-04 | Dropdowns show wrong year in labels; disabled state ignores DB |
| 7 | H-06, H-05 | YEARS constant and depYears must be dynamic |

### Phase 2 — Fix that also requires DB wiring

| # | Finding | Blocker |
|---|---|---|
| 8 | C-04 | Direct CF label row needs dynamic month range from `fpa_dim_period` |
| 9 | H-09 | Quarterly/monthly seasonality needs `fpa_assumptions` monthly data uploaded |
| 10 | H-10 | Blended collection rate weights need volume data from `volumeTable` or DB |
| 11 | H-11 | `projTariffReviews` defaults need replacing with DB-backed events |
| 12 | C-05 | Erase modal needs year-agnostic loop over `fpa.versions` |
| 13 | M-01, M-02 | HTML dropdowns should be rebuilt from `fpa.versions` on bootstrap |

---

## KEY PATTERNS FOUND

### What's done well ✅
- `plLines`, `bsLines`, `omRows`, `capexRows`, `collRows`, `depreciationComponents`, `tariffTable`, `volumeTable`, `fxTable`, `sysLossTable`, `netGenTable`, `heatRateTable`, `fuelCostByMonth`, `fuelRevByYear` — **all declared with `Array(12).fill(0)` zeros and overwritten by `fpaApplyToLegacyGlobals()` at bootstrap.** No hardcoded financial values in these arrays.
- `projRevDrivers`, `projOMDrivers` — zeroed at startup, overlaid from DB at bootstrap.
- Flash Report (`flashRefresh`) reads exclusively from `fpa.facts` (in-memory DB mirror). No hardcoded data.
- Loan register, lease register, insurance register, impairment register — all populated from Supabase only.
- The eraseScope options for monthly actuals are built dynamically from `fpa.versions`.

### What's broken 🔴
- The AI context string (`getFinancialContext()`) is the most dangerous — it mixes live computed values with hardcoded static strings that are now stale.
- Year tracking globals (`actualsYear`, `planYear`, `cfYear`, etc.) default to 2026 and will silently use the wrong year after year-end.
- The Indirect CF budget column (b: values) is the only chart/table where hardcoded financial amounts appear directly in rendered output.

---

*Audit complete — no edits made to source files.*
