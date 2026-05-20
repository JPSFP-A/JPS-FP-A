# JPS FP&A Suite — Product Requirements Document
**Version:** 1.2 (Operations/COGS module — fuel + IPP calculation engine)
**Date:** 2026-05-16
**Owner:** JPS FP&A Department
**Status:** Draft for Review

### Change Log
| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-05-16 | Initial draft |
| 1.1 | 2026-05-16 | Corrected app inventory after audit: Propel = CapEx approval (not Sales duplicate); O&M Platform substantially built; Operations recommended as Sales tab not separate app; app count reduced from 8 to 6 |
| 1.2 | 2026-05-16 | Operations/COGS module fully designed from Excel model reverse-engineering: unit register, IPP payment model (fixed + variable per provider), fuel cost calculation chain, OUR regulatory adjustments (17.5% loss pass-through, heat rate efficiency target), FCRA/BPRF treatment, FX conversion on fuel recovery. New DB tables added. Phase 2 roadmap expanded. |
| 1.3 | 2026-05-16 | Four additional Excel models analysed: Non-Fuel Variance (price/volume/mix decomposition by rate class), IFRS 16 schedule (confirmed: only JEP/JPPC/SJPC/WKPP are IFRS 16 IPPs), FX Gain/Loss (by BS category), Other Income (structured line items), FX Forecast (PPP model, billing vs expense rate, multi-currency). Architecture confirmed: FX rates = FP&A Hub admin table; Non-Fuel Variance = Hub management reporting; Other Income + FX G/L = Hub manual entry. New DB tables + FP&A Hub feature set added. Final build plan written. |

---

## 1. Executive Summary

The JPS FP&A Suite is a fully integrated, web-based financial planning and analysis platform for Jamaica Public Service Company. It replaces fragmented Excel-based processes with a hub-and-spoke architecture: a central FP&A Hub consolidates committed financial data from domain-specific extension apps operated by each functional team.

**Six apps, one Supabase backend.** Each functional extension owns its detail data, builds its LE/Budget, runs validation, and formally commits to the FP&A Hub. The Hub consolidates, reconciles, and produces board-ready reporting with AI commentary — automatically.

The suite enables monthly Latest Estimate (LE) and annual Budget preparation with a formal commit-and-review workflow. Once a team commits, the FP&A Hub automatically incorporates it into consolidated reporting. Board packs generate from the platform with AI-assisted commentary in PowerPoint or PDF format.

---

## 2. Problem Statement

| Pain | Impact |
|---|---|
| Excel files emailed between teams | Version confusion, stale numbers in board packs |
| FP&A Platform is a monolith — every team in one file | Access control impossible, concurrent edit conflicts |
| Sales forecast never formally connects to FP&A P&L | Revenue variance has no single source of truth |
| O&M, Treasury, IFRS detail all live inside FP&A Platform | Functional teams cannot maintain their own numbers |
| No formal LE commit workflow in any extension | FP&A never knows if a number is "final" or "draft" |
| Actuals loaded manually across multiple uploads | Risk of double-loading, overwriting, inconsistency |
| Board pack rebuilt in PowerPoint every month | 2–3 days of manual work, error-prone |
| No reconciliation between extension detail and GL | Audit risk — numbers cannot be traced to source |
| O&M Platform is built but disconnected from FP&A Hub | O&M team's work invisible to FP&A until emailed |
| Propel (CapEx approvals) has no spend feed to FP&A | Approved project budgets not reflected in FP&A LE |

---

## 3. Vision

> One platform, one source of truth. Every team owns their numbers, commits on schedule, FP&A consolidates automatically. The board pack generates itself.

---

## 4. Goals & Success Metrics

| Goal | Metric | Target |
|---|---|---|
| Eliminate re-entry between extensions and hub | Manual data touch-points after commit | 0 |
| Formal LE cycle with deadline tracking | Extensions committing on time | >90% by month 3 |
| Board pack automation | Time to produce from close | <2 hours (vs 2–3 days today) |
| GL traceability | GL line → fpa_facts coverage | 100% of committed lines |
| Single login, correct role per app | Access-related support tickets | 0 |
| Actuals vs LE vs Budget everywhere | Report coverage across all 6 domains | 100% |

---

## 5. Stakeholders & User Personas

| Persona | App(s) | Responsibilities |
|---|---|---|
| **FP&A Analyst / Manager** | Hub | Load actuals, review commits, produce board pack, manage users |
| **Revenue / Sales Analyst** | Sales Platform | Forecast kWh + revenue by rate class, manage large accounts, commit LE |
| **Operations Analyst** | Sales Platform (Operations tab) | Set loss factors, IPP plan, fuel assumptions; commit once Sales commits |
| **O&M Analyst** | O&M Platform | Upload GL, build O&M LE by cost centre, manage risks, commit |
| **Project Manager / CapEx** | Propel | Submit PPD, manage project spend; approved spend auto-feeds FP&A |
| **Treasury Analyst** | Treasury (Cash Benchmark) | Maintain loan register, IFRS-16, FX assumptions, commit debt service |
| **Collections Analyst** | Sales Platform (Collections tab) | AR aging, collection rate model, commit receipts forecast |
| **IFRS / Regulatory** | FP&A Hub (IFRS section) | Impairments, grants, other income — managed by FP&A team directly |
| **Senior Management / Board** | Hub (read-only) | View consolidated reports, board pack |

---

## 6. Corrected App Inventory

### 6.1 What Exists Today

| App | Location | Stack | Actual Purpose | Real Status |
|---|---|---|---|---|
| **FP&A Hub** | `C:\Users\jwilson\Downloads\FP&A Rebuild\index.html` | Vanilla JS | Central consolidation, P&L/BS/CF/KPI, variance, debt, leases, actuals upload | Production. Needs: Commit Review panel, GL mapping UI, board pack generation, strip out detail that moves to extensions |
| **Sales Platform** | `D:\Projects\Sales_Platform\` | Vanilla JS | kWh/revenue forecast, customer mgmt, KAM, defection tracking, weather analysis | Production. Needs: LE commit workflow, Operations tab (losses/IPP/fuel), Collections tab formal commit |
| **O&M Platform** | `D:\Projects\O&M management\JPS_OM_Platform.html` | Vanilla JS | GL upload, payroll + non-payroll LE, FX, risks, IFRS-16 O&M, analytics | Substantially built. MISSING: commit workflow to fpa_facts — this is the only gap |
| **Propel** | `D:\Projects\Propel\` | Vanilla JS | CapEx project approval system — PPD form, multi-tier approval, AI review, RACI, audit | Production — DO NOT TOUCH. Needs: approved project spend → fpa_facts feed (commit hook on approval) |
| **Treasury** | `D:\Projects\Cash_Benchmark\` | React + Vite | Treasury / debt / IFRS-16 / cashflow dashboard | POC only — stub pages, read-only. Needs: full build-out |
| **Operations** | Does not exist yet | — | Net gen, T&D losses, IPP, fuel cost | Recommend: Operations tab inside Sales Platform (see Section 8) |

### 6.2 Supabase Tables — Current Coverage

| Domain | Tables (existing) | Status |
|---|---|---|
| FP&A Core | fpa_facts, fpa_versions, fpa_dim_line, fpa_dim_period, fpa_audit_log, fpa_notifications, fpa_assumptions, fpa_leases, fpa_debt_facilities, fpa_debt_schedule, fpa_impairment_events, fpa_insurance_policies, fpa_flash_notes | Production |
| Sales | jps_actuals, jps_budget, jps_forecast, jps_forecast_versions, jps_le, jps_kam, jps_period_locks, jps_vb_drivers, jps_notes, jps_actuals_fpa, jps_budget_fpa, jps_actuals_agg | Production |
| Operations / Losses | jps_losses_forecast, net_gen_historical | Exists, UI not built |
| Operations / COGS (new) | ops_unit_register, ops_unit_monthly, ops_fuel_assumptions, ops_ipp_schedule, ops_loss_analysis, ops_heat_rate_analysis, ops_cogs_detail, ops_cogs_summary | New — Phase 2 migration |
| O&M | om_facts, om_dim_line, om_dim_entity, om_dim_period, om_gl_detail, om_payroll_gl, om_fx_rates, om_uploads, om_audit_log, om_user_scope, om_risks | Production |
| CapEx (Propel) | projects, project_sections, project_financials, approval_requests, ai_review_results, project_comments, project_documents, approval_thresholds | Production |
| Treasury/Cashflow | cashflow_records, cashflow_source_uploads, cashflow_months, cashflow_sections, cashflow_sub_groups, cashflow_rules, cashflow_audit_log, cashflow_settings, cashflow_approval_codes | Partially built |
| Shared | profiles, audit_log, fpa_custom_roles, fpa_role_permissions, dashboard_state | Production |

---

## 7. System Architecture

### 7.1 Hub-and-Spoke Model

```
┌────────────────────────────────────────────────────────────────┐
│                   SUPABASE (Shared Backend)                     │
│  PostgreSQL · Auth · Edge Functions · Storage · Realtime        │
│  Project: bhrswnbenkvflpdjhfpa · Region: us-west-2             │
└───────────────────────────┬────────────────────────────────────┘
                            │ fpa_facts (committed data only)
          ┌─────────────────▼──────────────────┐
          │           FP&A HUB                  │
          │  jmfinancelab.com                   │
          │  ─────────────────────────────────  │
          │  Reads committed fpa_facts only      │
          │  Writes: actuals, GL mapping         │
          │  Produces: Board pack, AI reports    │
          │  Reviews: Incoming extension commits │
          └────────────────┬───────────────────┘
                           │ accept / reject
     ┌─────────────────────┼──────────────────────────┐
     │                     │                          │
┌────▼──────────┐  ┌───────▼──────────┐  ┌───────────▼──────────┐
│ SALES PLATFORM│  │  O&M PLATFORM    │  │  PROPEL (CapEx)      │
│ + Operations  │  │  (substantially  │  │  Project approvals   │
│   tab         │  │   built — needs  │  │  Auto-feed on        │
│ + Collections │  │   commit wiring) │  │  project approval    │
│   tab         │  │                  │  │  DO NOT TOUCH UI     │
└────┬──────────┘  └────────┬─────────┘  └───────────┬──────────┘
     │COMMIT                │COMMIT                   │AUTO-FEED
     │Revenue + Net Gen     │All O&M lines            │Approved spend
     │+ Losses + Receipts   │+ FX + Risks             │by project/month
     └──────────────────────┴─────────────────────────┘
                            │
                    ┌───────▼──────────┐
                    │  TREASURY        │
                    │  (Cash Benchmark │
                    │   — rebuild)     │
                    │  Loans · FX      │
                    │  IFRS-16 Leases  │
                    └───────┬──────────┘
                            │COMMIT
                            │Interest + Debt service
                            └──────────────────────→ fpa_facts
```

### 7.2 Operations / Net Generation — Architecture Decision

**Recommended approach: Operations tab within Sales Platform.**

**Rationale — how the numbers relate:**

```
Net System Input (Net Gen + IPP Purchases)
         │
         │  minus T&D Losses % (by voltage level)
         ▼
Energy Delivered to Customers
         │
         │  minus UFE / Non-Technical Losses
         ▼
Billed kWh (Sales by Rate Class)   ← Sales team owns this
```

Net generation is a **derived output** of the Sales LE, not an independent input. Once Sales commits kWh, the system can back-calculate the net gen requirement automatically using the loss factor.

**Workflow:**
1. Sales team finalises kWh LE by rate class (their section)
2. Operations analyst (different role, same app) sets:
   - T&D loss factor % by month
   - IPP capacity payments schedule
   - Fuel price assumptions (HFO, diesel, LNG)
3. App auto-calculates: Net Gen Required = Committed Sales kWh ÷ (1 − Loss%)
4. Operations validates their generation plan covers the requirement
5. Single combined commit sends Revenue + Net Gen + Losses + Fuel to fpa_facts
6. FP&A Hub sees a complete picture: revenue AND fuel cost in one commit event

**Why not a separate app:**
- Net gen is mathematically derived from sales volume — separating them creates a reconciliation problem where two independent numbers must always agree
- Loss factor and fuel cost are tightly coupled to the kWh forecast
- The same monthly close cycle governs both — one commit, one deadline
- Tables already exist in the Sales Platform's Supabase schema (`jps_losses_forecast`, `net_gen_historical`)
- Avoids app sprawl — 6 apps is already significant infrastructure

**Role gating:** Operations tab visible only to users with `access_areas` including `'operations'`. Sales tab visible to `'sales'` role. Different people, same app, separate tabs, single commit.

### 7.3 Commit Protocol

```
Extension (any app)                DB                      FP&A Hub
      │                            │                           │
      ├─ Build LE / Budget ────────►│ status = 'draft'          │
      │  (multiple working saves)   │ (invisible to Hub)        │
      │                            │                           │
      ├─ Run pre-submit checks ────►│                           │
      │  (balance, completeness,    │                           │
      │   variance vs prior LE)     │                           │
      │                            │                           │
      ├─ Submit ───────────────────►│ status = 'submitted'      │
      │                            │ Realtime notify ─────────►│
      │                            │                           │ Review panel
      │                            │                           │ shows new item
      │                            │◄─ FP&A accepts ───────────│
      │                            │ status = 'accepted'        │
      │                            │ summary → fpa_facts        │
      │◄─ Notified ────────────────│ (IMMUTABLE, locked)        │
      │                            │                           │
      │         OR                 │                           │
      │                            │◄─ FP&A rejects ───────────│
      │◄─ Rejection + notes ───────│ status = 'rejected'        │
      │  (must revise + resubmit)  │                           │
```

**Rules:**
- Draft versions visible only inside the owning extension
- One active committed LE per extension per period (prior superseded, not deleted)
- Accepted versions immutable — only FP&A admin can unlock with audit reason
- Budget committed once annually; LE committed monthly (amendments create new version)
- FP&A Hub consolidated report requires minimum set of extensions accepted (configurable)

---

## 8. Feature Requirements — Extension by Extension

### 8.1 FP&A Hub

**What to keep (already built):**
- P&L, Balance Sheet, Cash Flow reports
- Monthly P&L drill-down, variance analysis, KPI dashboard
- Debt/loan schedule, IFRS-16 leases (move to Treasury extension eventually)
- Actuals upload (Excel → fpa_facts)
- User management, audit trail, flash report
- AI commentary generation
- Scenario analysis

**What to add:**

| Ref | Feature | Priority |
|---|---|---|
| HUB-01 | Incoming Commits panel — list all extensions with status, deadline RAG, accept/reject UI | P0 |
| HUB-02 | GL line mapping admin — map GL codes to fpa_dim_line via UI (not hardcoded) | P0 |
| HUB-03 | Reconciliation view — actuals vs committed LE per line, variance flags | P1 |
| HUB-04 | LE Calendar — deadlines per extension per period, countdown, RAG status | P1 |
| HUB-05 | Board Pack generation — PPTX via pptxgenjs, AI commentary per slide | P2 |
| HUB-06 | PDF export — print-optimised CSS layout for operational reports | P2 |
| HUB-07 | Consolidated view gating — require minimum extensions committed before showing consolidated P&L | P2 |

**What to remove / migrate:**
- O&M detail input → O&M Platform owns this
- CapEx detail entry → Propel + commit feed owns this
- IFRS-16 lease calculator → move to Treasury extension

**New FP&A Hub modules (confirmed from Excel model analysis):**

| Ref | Feature | Priority | Source |
|---|---|---|---|
| HUB-08 | FX Rate Admin Table — monthly Billing rate (JMD/USD) + Expense rate (one-month lag), GBP, CAD, EUR; Budget vs LE vs Actual; consumed by all other apps | P0 | `2026 FX Forecast - Mar-2026.xlsx` |
| HUB-09 | Non-Fuel Variance Report — price/volume/mix variance by rate class (MT10/20/40/50/60/70 + TOU blocks); FX impact on energy + customer charges; reads committed Sales LE + actuals + FX assumption | P1 | `Non Fuel Variance March 2026.xlsx` |
| HUB-10 | Other Income Entry — monthly grid: Inventory sales, Dividend income (CBSEL), Gain on disposal, Rental income, Other sales, Credit writeoffs, Restructuring; Actual vs Budget vs Variance; US$'000 | P1 | `FX and Other Income 03-2026.xlsx` |
| HUB-11 | FX Gain/Loss Entry — monthly by BS category (Receivables, Bank A/c, Pension Asset, Liabilities, LT Loans); ending FX rate; net FX G/L auto-summed; feeds P&L as Other Income/Expense line | P1 | `FX and Other Income 03-2026.xlsx` |
| HUB-12 | IFRS 16 Adjustment Entry — monthly grid per lease: JEP, JPPC, SJPC, WKPP (COS reversal), Eppley, Head Office, Hunts Bay, JAMECO (OpEx adj); Depreciation + Interest auto-populated from Treasury eventually; manual entry interim | P1 | `IFRS16 - Leased Asset Recognition 03-2026.xlsx` |

**IFRS 16 IPP Classification (confirmed):**
- **IFRS 16 (lease-reclassified):** JEP, JPPC, SJPC, WKPP — PPA payments reclassified from COGS → ROU depreciation + lease interest. Operations tab flags these 4 as `ifrs16: true`. Their payments do NOT appear in COGS.
- **Operating (non-IFRS 16):** Wigton, JAMALCO, JPS Renewables — payments stay in COGS as variable/fixed operating costs.

**FX Rate Architecture (confirmed):**
- Single source of truth: `fpa_fx_rates` table in Supabase, managed by FP&A Hub admin
- Two rate types per month per currency: `billing` (used for revenue/fuel calculation) and `expense` (one-month lag, used for cost translation)
- PPP forecast methodology: Budget set annually; LE updated monthly as actuals come in (actuals replace forward rate)
- Read by: Sales Platform (non-fuel FX variance, billing exchange rate), O&M Platform (cost FX translation), Operations tab (fuel cost FX conversion), FX Gain/Loss model
- Multi-currency: JMD/USD (primary), JMD/GBP, JMD/CAD, JMD/EUR

**Non-Fuel Variance Report — Calculation (from Excel model):**
```
Per rate class per month:
  Price Variance  = (Actual Tariff - Budget Tariff) × Actual Volume
  Mix Variance    = (Actual Vol - Actual Vol @ Budget Mix) × Budget Tariff
  Qty Variance    = (Actual Vol @ Budget Mix - Budget Volume) × Budget Tariff
  Volume Variance = Qty Variance + Mix Variance
  FX Variance     = (Actual Billing Rate - Budget Billing Rate)
                    × (Energy Charge @ Budget Rate + Customer Charge @ Budget Rate)

Three dimensions: Energy kWh, Invoice Count (customer proxy), Demand-kVA
```

---

### 8.2 Sales Platform

**What to keep (already built):**
- kWh actuals upload + rate class breakdown
- Customer-level forecast (RT50/60/70)
- KAM performance, defection register, weather analysis, revenue recovery
- Period locks

**What to add:**

| Ref | Feature | Priority |
|---|---|---|
| SAL-01 | LE version workflow — create named LE, save working copy, view history | P0 |
| SAL-02 | Pre-submit validation — no blank months, revenue ties to rate class sum, prior LE comparison | P0 |
| SAL-03 | Submit LE to FP&A Hub — summarise revenue + collections by fpa_dim_line, write to fpa_facts | P0 |
| SAL-04 | Operations tab — loss factor by month, IPP schedule, fuel price assumptions | P1 |
| SAL-05 | Net gen auto-calculation — derives from committed kWh ÷ (1 − loss%) | P1 |
| SAL-06 | Combined commit — Revenue + Operations (net gen + fuel + IPP) in one submission | P1 |
| SAL-07 | Collections tab formal commit — AR aging model, receipts forecast → fpa_facts | P1 |
| SAL-08 | Budget workflow — annual budget build with same commit protocol as LE | P2 |

---

### 8.2.1 Operations Tab — COGS Calculation Engine (Detailed Design)

> **Source:** Reverse-engineered from `FP&A main model.xlsx` sheets: Gen, PPower, Fuel Rate, Input.

This is the most technically complex component in the suite. The fuel cost and IPP payment calculations involve a multi-step chain of volume, efficiency, regulatory, and FX adjustments. All intermediate results must be stored — they are auditable inputs to the OUR fuel rate submission.

#### A. Generation Unit Register

Each generation unit is registered with its fuel type and monthly availability. The system must:
- Store the full unit list (JPS-owned + IPPs + renewables)
- Record capacity (MW) and availability-adjusted max MWh per unit per month
- Store N/Y fuel type flags per unit per month (some units switch between LNG / HFO / diesel by season or price)

**Unit categories from model:**

| Category | Units |
|---|---|
| LNG Plants | OH-4, OH-3, OH-2, OH-1, HB-B6, HBGT10, HBGT5 |
| Bogue Gas Turbines | BOGT3, BOGT5, BOGT6, BOGT7, BOGT8, BOGT9, BOGT11, BOGT13, BO-ST14 |
| IPPs — Private Power | JEP, JPPC, JAMALCO, Wigton, JPS Renewables |
| Renewables (JPS-owned) | Hydro plants (multiple) |

**Rule:** Renewables (hydro) are excluded from the fuel cost calculation. Net generation requiring fuel = Total net gen − Hydro generation.

---

#### B. Net Generation Calculation Chain

```
Electricity Sales (kWh) by rate class       ← Sales Platform LE (committed)
        │
        │  ÷ (1 − System Loss %)
        ▼
Net System Input Required (kWh)
        │
        │  − Hydro / Renewable Generation (kWh)   ← from unit register, not fuel-driven
        ▼
Net Generation Using Fuel (kWh)             ← basis for all fuel cost calculations
        │
        │  Split by unit: JPS-owned plants vs IPPs
        │  (based on dispatch plan / unit commitment)
        ├──► JPS Own Generation (kWh)       → heat rate → fuel volume → JPS fuel cost
        └──► IPP Generation (NEO kWh)       → IPP payment schedule (see Section C + D)
```

**System Losses — OUR regulatory treatment:**

| Loss Layer | Calculation | Treatment |
|---|---|---|
| Actual system loss % | Read from actual data (26.5–26.8% range in model) | Input per month |
| OUR permitted pass-through | Fixed at 17.5% | Only this portion recoverable in fuel rate |
| Excess loss absorbed by JPS | `Actual% − 17.5%` applied to kWh | JPS bears cost; NOT passed to customers |
| Loss Effect on fuel cost | `Excess kWh × unit fuel cost` | Deducted in regulatory adjustment |

---

#### C. JPS Own Generation — Fuel Cost Calculation

**Per unit per month:**

```
Unit kWh Generated
    × Unit Heat Rate (kJ/kWh)            ← from Input sheet, per unit
    = Fuel Energy Required (kJ)
    ÷ Fuel Energy Content (kJ/unit)       ← per fuel type
    = Fuel Volume (barrels / MMBtu / etc.)
    × Fuel Unit Price (US$/barrel etc.)   ← from Input: Platts, LNG spot, etc.
    = JPS Fuel Cost for Unit (US$)
```

**Fuel types and price indices:**

| Fuel | Price Reference | Typical Unit |
|---|---|---|
| HFO (Heavy Fuel Oil) | Platts #6 | US$/barrel |
| LNG | Spot / contract | US$/MMBtu |
| CNG | Fixed contract | US$/MMBtu |
| No. 2 Fuel | Spot | US$/barrel |
| Diesel (ADO) | Spot | US$/barrel |
| Petcoke | Spot | US$/tonne |
| Coal | Spot | US$/tonne |

**Heat Rate — OUR efficiency adjustment:**

| Heat Rate Layer | Value | Treatment |
|---|---|---|
| Actual unit heat rate | Per unit from model | Used for actual volume calculation |
| OUR Permitted Billing Heat Rate | 10,200 kJ/kWh | Maximum recoverable from customers |
| Excess heat (inefficiency) | `Actual kJ/kWh − 10,200` | JPS absorbs cost; NOT passed through |
| Heat Rate Effect on fuel cost | `Excess kJ × fuel cost per kJ` | Deducted in regulatory adjustment |

---

#### D. IPP Payments — Fixed + Variable Model

Each IPP has a two-part payment structure that must be modelled separately:

**Fixed Payments (capacity-based, not volume-dependent):**

| Component | Driver | Example (JEP) |
|---|---|---|
| Capacity Charge | Average Dependable Capacity (ADC) kW × rate | ~$1.4M/mo |
| Fixed O&M | ADC × rate | ~$1.09M/mo |
| Fixed Local Non-Labour | Fixed contract | Varies |
| Fixed Foreign Labour | Fixed contract | Varies |
| Fixed Foreign Non-Labour | Fixed contract | Varies |
| Mooring Facility | Fixed (where applicable) | Varies |
| Debt Service | Per PPA schedule | Varies |
| Equity Return | Per PPA schedule | ~$623K/mo |
| Supplemental | Per PPA | ~$116K/mo |

**Variable Payments (energy/volume-dependent):**

| Component | Driver | Example (JEP) |
|---|---|---|
| Variable Fuel Charge | NEO (kWh) × fuel rate | $6–8M/mo |
| CET Payments | Per PPA formula | $185–235K/mo |
| Variable O&M (local) | NEO × rate | Varies |
| Variable O&M (foreign) | NEO × rate | ~$1.2–1.6M/mo |
| Fuel Transport | NEO × transport rate | Varies |
| Cylinder Oil | NEO × consumption rate | Varies |
| Circulating Oil | NEO × consumption rate | Varies |

**IPP aggregates (system totals from model):**
- System Fixed Payments: ~$754K/mo capacity + ~$131K/mo fixed O&M + equity + supplemental
- System Variable: HFO payment $5M+/mo at full dispatch

**Fuel cost split:**
- JPS Fuel Cost (US$) = sum of JPS-owned unit fuel costs
- IPP Fuel Cost (US$) = sum of IPP variable fuel charges across all providers
- Total Fuel Cost = JPS + IPP (US$, then converted to JMD)

---

#### E. Regulatory Adjustments — FCRA / BPRF / Efficiency Credits

After calculating raw fuel cost, the following adjustments are applied before the billable fuel rate is computed:

| Adjustment | Description | Sign |
|---|---|---|
| System Loss Effect | Cost of excess losses absorbed by JPS (OUR disallows above 17.5%) | Negative (deducted from recovery) |
| Heat Rate Effect | Cost of heat rate inefficiency absorbed by JPS (above 10,200 kJ/kWh) | Negative |
| Force Majeure | Approved regulatory adjustment for force majeure events | +/- |
| FCRA (Fuel Cost Recovery Adjustment) | OUR mechanism to true-up over/under-recovery from prior periods | +/- |
| Inverse Cap / Ceiling | OUR caps recoverable fuel rate per tariff schedule | May reduce recovery |
| Net Efficiencies | Combined effect of all adjustments | Net of above |

**Formula:**
```
Billable Fuel Cost = Total Fuel Cost
                   − Loss Effect (excess over 17.5%)
                   − Heat Rate Effect (excess over 10,200 kJ/kWh)
                   ± Force Majeure
                   ± FCRA / BPRF
                   ± Inverse Cap
                   = Net Recoverable Fuel Cost

Fuel Rate (US¢/kWh) = Net Recoverable Fuel Cost (US$) ÷ kWh Sales
Fuel Rate (J¢/kWh)  = Fuel Rate (US¢) × Billing Exchange Rate (JMD/USD)
```

---

#### F. FX Conversion

All fuel costs and IPP payments originate in USD. FX conversion applies at the Billing Exchange Rate set by OUR/BOJ for the billing period.

```
FX Model per cost component:
    USD Amount (volume × USD price)
    × Billing Exchange Rate (JMD/USD)
    = JMD Amount

FX Variance Decomposition (when forecasting):
    Volume Effect = (Forecast Vol − Budget Vol) × Budget Rate × Budget Price
    Price Effect  = Budget Vol × Budget Rate × (Forecast Price − Budget Price)
    Rate Effect   = Budget Vol × Budget Price × (Forecast Rate − Budget Rate)
```

FX adjustment on Fuel Recovery is tracked separately as a regulatory mechanism — BOJ/OUR may apply a supplemental FX adjustment on the recoverable fuel cost in the tariff filing.

---

#### G. Operations Tab — UI Sections

| Section | Fields | Notes |
|---|---|---|
| **System Losses** | Actual loss % by month; OUR permitted %; absorbed kWh auto-calculated | Read-only comparison vs prior LE |
| **Unit Register** | Fuel type flag (N/Y) per unit per month; availability % | Can be preloaded from prior period, adjusted |
| **Fuel Assumptions** | Price per fuel type per month (HFO, LNG, CNG, diesel, ADO, petcoke, coal); billing exchange rate | Pulled from `ops_fuel_assumptions`; Input sheet equivalent |
| **IPP Schedule** | Per-IPP: ADC (kW), NEO (kWh), fixed payment breakdown, variable fuel rate | Entered once per LE cycle; drives IPP cost auto-calc |
| **Heat Rate Targets** | Per-unit heat rate vs OUR 10,200 kJ/kWh target; efficiency delta | Shows absorbed cost |
| **COGS Summary** | JPS Fuel Cost, IPP Fixed, IPP Variable, Total, Regulatory adjustments, Net Fuel Rate (US¢ and J¢) | Auto-calculated from all inputs |
| **Regulatory Adjustments** | FCRA amount, inverse cap, force majeure — entered by Operations analyst | Requires supporting documentation |

---

#### H. Required DB Tables — Operations/COGS

See Section 10 for DDL.

| Table | Purpose |
|---|---|
| `ops_unit_register` | Generation unit list: name, category, fuel type, capacity MW |
| `ops_unit_monthly` | Per-unit per-month: availability %, max MWh, fuel type flag |
| `ops_fuel_assumptions` | Fuel prices + exchange rate by month/LE version |
| `ops_ipp_schedule` | Per-IPP per-month: ADC, NEO, fixed and variable payment inputs |
| `ops_cogs_detail` | Calculated fuel cost lines: JPS fuel cost, IPP fixed, IPP variable, by unit/provider/month |
| `ops_cogs_summary` | Monthly totals: total fuel cost, regulatory adjustments, net recoverable, fuel rate |
| `ops_loss_analysis` | Monthly: actual loss%, OUR permitted%, absorbed%, loss effect on fuel cost |
| `ops_heat_rate_analysis` | Monthly: actual heat rate vs OUR target, heat rate effect on fuel cost |

---

### 8.3 O&M Platform

**What exists (substantially built):**
- GL upload (Metabase YTD format) → om_gl_detail
- Payroll GL detail → om_payroll_gl
- LE/Budget/Actual/Forecast version toggle
- Dashboard, Analytics, Payroll, Non-payroll tabs
- IFRS-16 O&M leases tab
- Risks & opportunities register
- FX rates table
- Audit log (matches FP&A protocol)
- Admin, user scope management

**The ONE gap — wire the commit:**

| Ref | Feature | Priority |
|---|---|---|
| OM-01 | LE version formalisation — name and create a versioned LE (currently version is a toggle, not a formal object in fpa_versions) | P0 |
| OM-02 | Pre-submit validation — completeness check (all cost centres covered), variance vs budget flag | P0 |
| OM-03 | Submit to FP&A Hub — summarise om_facts by fpa_dim_line mapping, write to fpa_facts | P0 |
| OM-04 | FP&A line mapping — map om_dim_line codes to fpa_dim_line IDs | P0 |
| OM-05 | Rejection handling — display rejection notes from FP&A, allow resubmit | P1 |
| OM-06 | Budget commit (annual) — same flow as LE, tagged as BUDGET version | P1 |

**This is the closest to done of all extensions — estimated 1 week of work.**

---

### 8.4 Propel (CapEx)

**DO NOT modify the UI or approval workflow.**

**Only add:**

| Ref | Feature | Priority |
|---|---|---|
| PRO-01 | On project approval (final tier sign-off) → auto-write approved project spend plan to fpa_facts | P1 |
| PRO-02 | Spend plan input — when project approved, trigger form to enter monthly spend phasing | P1 |
| PRO-03 | Capitalisation schedule → write depreciation profile to fpa_facts | P2 |
| PRO-04 | If project revised/cancelled → supersede fpa_facts entry with zero or revised figures | P2 |

**Implementation approach:** Add a webhook/trigger on Propel's approval completion event → calls `commit-capex-version` Edge Function → writes to fpa_facts. No changes to Propel's UI or approval logic.

---

### 8.5 Treasury Extension (Cash Benchmark)

**Current state:** React + Vite POC. Dashboard and Income Statement partially built. All other pages stubbed. Read-only.

**Full build required:**

| Ref | Feature | Priority |
|---|---|---|
| TR-01 | Loan register — facility name, lender, currency, principal, rate (fixed/floating), maturity | P0 |
| TR-02 | Repayment schedule auto-calc — principal + interest per month from loan terms | P0 |
| TR-03 | FX assumptions table — JMD/USD forecast rate by month | P0 |
| TR-04 | IFRS-16 lease register — migrate from FP&A Hub's lease calculator | P1 |
| TR-05 | IFRS-16 engine — ROU asset, lease liability, interest, depreciation per month | P1 |
| TR-06 | Liquidity forecast — 30/60/90 day cash position | P1 |
| TR-07 | FX impact on USD debt — mark-to-market at period-end rate | P1 |
| TR-08 | LE commit → interest expense, debt repayment, FX loss/gain to fpa_facts | P0 |
| TR-09 | Budget commit — annual debt service plan | P2 |

---

### 8.6 Presentations & Board Pack

| Ref | Feature | Priority |
|---|---|---|
| BP-01 | PowerPoint generation — pptxgenjs library, branded JPS template, live data per slide | P2 |
| BP-02 | Standard slide set — Executive Summary, Revenue, O&M, CapEx, EBITDA bridge, BS, CF, KPIs | P2 |
| BP-03 | AI commentary per slide — Claude API, structured prompt per slide type, prompt caching on CoA context | P2 |
| BP-04 | Inline commentary editor — user reviews AI draft, edits inline, approves before export | P2 |
| BP-05 | Commentary saved to DB — approved text stored in board_pack_outputs for audit | P2 |
| BP-06 | PDF export — print-optimised CSS + `window.print()` for operational reports | P2 |
| BP-07 | Board pack versioning — draft vs final, published packs read-only to senior management | P3 |

---

## 9. Technology Stack

### 9.1 Frontend

| Layer | Technology | Used In |
|---|---|---|
| Existing apps | Vanilla JS + HTML/CSS | FP&A Hub, Sales Platform, O&M Platform |
| New / rebuilt extensions | React 18 + Vite | Treasury (Cash Benchmark rebuild) |
| Charts | Chart.js 4 | All apps (consistent) |
| Excel parsing | SheetJS (xlsx) 0.18.5 | All apps (GL uploads) |
| PowerPoint generation | pptxgenjs | FP&A Hub (board pack) |
| Spreadsheet-style input grids | Handsontable Community or vanilla table | Budget build grids in O&M, Treasury |
| Icons | Inline SVG / emoji (Vanilla) · Heroicons (React) | Consistent per app type |

### 9.2 Backend — Supabase (Single Backend for All Apps)

**Project:** `bhrswnbenkvflpdjhfpa` · Region: `us-west-2`
**URL:** `https://bhrswnbenkvflpdjhfpa.supabase.co`

| Service | Purpose |
|---|---|
| **PostgreSQL 15** | All financial data, version history, audit trail, profiles |
| **Auth** | Single user directory across all 6 apps; isolated per-app via `storageKey` |
| **Edge Functions** (Deno/TypeScript) | All server-side operations requiring service role key |
| **Realtime** | Live notifications: commit submitted, accepted, rejected, deadline warning |
| **Storage** | GL upload files, generated PPTX/PDF outputs, app assets |
| **Row Level Security** | Per-extension data isolation; enforced at DB layer, not app layer |

### 9.3 Edge Functions — Complete List

| Function | Caller | Purpose |
|---|---|---|
| `invite-user` | FP&A Hub Admin | Create auth + profile (deployed v6) |
| `delete-user` | FP&A Hub Admin | Delete auth account (deployed v1) |
| `submit-version` | Any extension | Validate, set submitted, Realtime notify Hub |
| `accept-version` | FP&A Hub | Write summary to fpa_facts, lock, notify extension |
| `reject-version` | FP&A Hub | Set rejected, write notes, notify extension |
| `run-validations` | Any extension (pre-submit) | Execute validation rules for a version |
| `commit-capex-version` | Propel (on approval) | Write approved project spend to fpa_facts |
| `gl-import` | All extensions | Parse GL Excel/CSV, map codes, write to extension detail |
| `generate-commentary` | FP&A Hub | Claude API — draft narrative per report section |
| `generate-board-pack` | FP&A Hub | Assemble PPTX, save to Storage, return URL |
| `send-reminder` | Supabase CRON | Email extensions approaching LE deadline |
| `reconcile-period` | FP&A Hub (post-actuals) | Compare actuals vs committed LE, write recon log |
| `map-om-to-fpa` | O&M commit flow | Translate om_facts lines → fpa_dim_line IDs |
| `calculate-cogs` | Operations tab | Run full COGS engine: loss analysis → heat rate → JPS fuel cost → IPP payments → regulatory adjustments → summary |
| `seed-unit-register` | Ops admin (one-time) | Populate ops_unit_register from Excel model unit list |

### 9.4 AI Layer

| Capability | Model | Notes |
|---|---|---|
| Executive summary | claude-opus-4 | Highest quality — board-level output |
| Variance narrative | claude-sonnet-4-5 | Cost/quality balance for operational commentary |
| Anomaly flags | claude-haiku-3 | High frequency, lightweight |
| Prompt caching | `cache_control` on CoA + prior period data | Reduces API cost ~80% on repeated context |

### 9.5 Infrastructure

| Component | Tool |
|---|---|
| Hosting | Vercel (all apps under jmfinancelab.com) |
| CI/CD | GitHub (JPSFP-A org) → Vercel auto-deploy on push to `main` |
| Secrets | Vercel Env Vars (anon key); Supabase Vault (service role, Claude API key) |
| Monitoring | JpsMonitor (custom) — error tracking, session events, 60s health check |
| `.vercelignore` | Exclude non-app files from deploy (set up 2026-05-16) |

---

## 10. Database Schema — Additions Required

### 10.1 Commit Protocol (All Extensions)

```sql
-- ── Extend fpa_versions for commit protocol ──────────────────────
ALTER TABLE fpa_versions ADD COLUMN IF NOT EXISTS extension TEXT;
  -- 'sales','om','capex','treasury','hub'
ALTER TABLE fpa_versions ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft';
  -- draft | submitted | accepted | rejected | superseded
ALTER TABLE fpa_versions ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
ALTER TABLE fpa_versions ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES profiles;
ALTER TABLE fpa_versions ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES profiles;
ALTER TABLE fpa_versions ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE fpa_versions ADD COLUMN IF NOT EXISTS review_notes TEXT;
ALTER TABLE fpa_versions ADD COLUMN IF NOT EXISTS deadline TIMESTAMPTZ;

-- ── GL code → FP&A line mapping ──────────────────────────────────
CREATE TABLE IF NOT EXISTS gl_line_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  extension TEXT NOT NULL,        -- which app owns this mapping
  source_line_code TEXT NOT NULL, -- GL code or om_dim_line code
  source_description TEXT,
  fpa_line_id UUID REFERENCES fpa_dim_line(id),
  sign_convention SMALLINT DEFAULT 1,  -- 1 = same sign, -1 = flip
  effective_from DATE DEFAULT '2020-01-01',
  effective_to DATE,
  created_by UUID REFERENCES profiles,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(extension, source_line_code, effective_from)
);

-- ── Commit validation results ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS commit_validations (
  id BIGSERIAL PRIMARY KEY,
  version_id UUID REFERENCES fpa_versions,
  rule_code TEXT NOT NULL,
  status TEXT NOT NULL,           -- pass | warn | fail
  detail JSONB,
  override_reason TEXT,           -- required when user overrides a warn
  override_by UUID REFERENCES profiles,
  checked_at TIMESTAMPTZ DEFAULT now()
);

-- ── Reconciliation log (actuals vs committed LE) ──────────────────
CREATE TABLE IF NOT EXISTS reconciliation_log (
  id BIGSERIAL PRIMARY KEY,
  period_year INT,
  period_month INT,
  extension TEXT,
  fpa_line_id UUID REFERENCES fpa_dim_line,
  actuals_value NUMERIC,
  committed_le_value NUMERIC,
  variance NUMERIC GENERATED ALWAYS AS (committed_le_value - actuals_value) STORED,
  variance_pct NUMERIC,
  status TEXT DEFAULT 'flagged',  -- within_threshold | flagged | explained
  explanation TEXT,
  explained_by UUID REFERENCES profiles,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── LE Calendar / Deadlines ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS le_calendar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_year INT NOT NULL,
  period_month INT NOT NULL,
  extension TEXT NOT NULL,
  deadline TIMESTAMPTZ NOT NULL,
  reminder_sent_48h BOOLEAN DEFAULT false,
  reminder_sent_24h BOOLEAN DEFAULT false,
  UNIQUE(period_year, period_month, extension)
);

-- ── Board Pack Outputs ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS board_pack_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_year INT,
  period_month INT,
  version_label TEXT,
  generated_by UUID REFERENCES profiles,
  generated_at TIMESTAMPTZ DEFAULT now(),
  storage_path TEXT,              -- Supabase Storage path to .pptx / .pdf
  ai_commentary JSONB,            -- per-slide commentary, saved for audit
  status TEXT DEFAULT 'draft'     -- draft | approved | published
);
```

### 10.2 FP&A Hub — FX, Other Income, IFRS 16 Tables

```sql
-- ── Central FX Rate Table ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fpa_fx_rates (
  id BIGSERIAL PRIMARY KEY,
  period_year INT NOT NULL,
  period_month INT NOT NULL,
  rate_type TEXT NOT NULL,        -- 'billing' | 'expense'
  version TEXT NOT NULL,          -- 'budget' | 'le' | 'actual'
  jmd_usd NUMERIC,                -- primary rate for JPS operations
  jmd_gbp NUMERIC,
  jmd_cad NUMERIC,
  jmd_eur NUMERIC,
  source TEXT,                    -- 'boj' | 'platts' | 'imf' | 'manual'
  updated_by UUID REFERENCES profiles,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(period_year, period_month, rate_type, version)
);

-- ── Other Income / Expense Lines ─────────────────────────────────
CREATE TABLE IF NOT EXISTS fpa_other_income (
  id BIGSERIAL PRIMARY KEY,
  period_year INT NOT NULL,
  period_month INT NOT NULL,
  version TEXT NOT NULL,          -- 'budget' | 'le' | 'actual'
  -- Line items (US$'000)
  inventory_sales NUMERIC DEFAULT 0,
  stock_obsolescence NUMERIC DEFAULT 0,
  credit_writeoffs NUMERIC DEFAULT 0,
  gain_on_disposal NUMERIC DEFAULT 0,
  dividend_income NUMERIC DEFAULT 0,     -- CBSEL and other subsidiaries
  dividend_source TEXT,                   -- e.g. 'CBSEL'
  rental_income NUMERIC DEFAULT 0,        -- transmitter site rentals
  other_sales NUMERIC DEFAULT 0,          -- training, demin water, etc.
  refunds NUMERIC DEFAULT 0,
  tax_refund_interest NUMERIC DEFAULT 0,
  fx_recovery NUMERIC DEFAULT 0,
  restructuring_costs NUMERIC DEFAULT 0,
  notes TEXT,
  updated_by UUID REFERENCES profiles,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(period_year, period_month, version)
);

-- ── FX Gain / Loss (by BS Category) ─────────────────────────────
CREATE TABLE IF NOT EXISTS fpa_fx_gain_loss (
  id BIGSERIAL PRIMARY KEY,
  period_year INT NOT NULL,
  period_month INT NOT NULL,
  version TEXT NOT NULL,          -- 'actual' | 'le'
  fx_rate_used NUMERIC,           -- billing rate for the period
  fx_rate_prior NUMERIC,          -- prior period rate (for delta)
  -- By balance sheet category (JMD):  positive = loss, negative = gain
  receivables_fx NUMERIC DEFAULT 0,
  bank_ac_fx NUMERIC DEFAULT 0,
  pension_asset_fx NUMERIC DEFAULT 0,
  liabilities_fx NUMERIC DEFAULT 0,
  lt_loans_fx NUMERIC DEFAULT 0,
  net_fx_gl NUMERIC GENERATED ALWAYS AS (
    receivables_fx + bank_ac_fx + pension_asset_fx + liabilities_fx + lt_loans_fx
  ) STORED,
  notes TEXT,
  updated_by UUID REFERENCES profiles,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(period_year, period_month, version)
);

-- ── IFRS 16 Monthly Adjustment Schedule ──────────────────────────
CREATE TABLE IF NOT EXISTS fpa_ifrs16_schedule (
  id BIGSERIAL PRIMARY KEY,
  period_year INT NOT NULL,
  period_month INT NOT NULL,
  version TEXT NOT NULL,          -- 'budget' | 'le' | 'actual'
  lease_id TEXT NOT NULL,
    -- 'JEP' | 'JPPC' | 'SJPC' | 'WKPP'               (IPPs — COS reversal)
    -- 'EPPLEY' | 'HEAD_OFFICE' | 'HUNTS_BAY' | 'JAMECO' (property — OpEx adj)
  lease_category TEXT NOT NULL,   -- 'ipp' | 'property'
  -- IPP: reversal of cost of sales (negative = credit to COGS)
  cos_reversal NUMERIC DEFAULT 0,
  -- Property: operating expense adjustment (negative = credit to OpEx)
  opex_adjustment NUMERIC DEFAULT 0,
  -- Both: depreciation charge (debit to P&L)
  rou_depreciation NUMERIC DEFAULT 0,
  -- Both: interest on lease liability (debit to P&L)
  interest_expense NUMERIC DEFAULT 0,
  source TEXT DEFAULT 'manual',   -- 'manual' | 'treasury_auto' (future)
  updated_by UUID REFERENCES profiles,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(period_year, period_month, version, lease_id)
);

-- ── Non-Fuel Variance Cache (pre-computed for report speed) ──────
CREATE TABLE IF NOT EXISTS fpa_nonfuel_variance (
  id BIGSERIAL PRIMARY KEY,
  period_year INT NOT NULL,
  period_month INT NOT NULL,
  rate_class TEXT NOT NULL,       -- 'MT10_B1' | 'MT20_B1' | 'MT40_B1' etc.
  dimension TEXT NOT NULL,        -- 'energy_kwh' | 'invoices' | 'demand_kva'
  actual_value NUMERIC,
  budget_value NUMERIC,
  actual_mix NUMERIC,
  budget_mix NUMERIC,
  actual_tariff NUMERIC,
  budget_tariff NUMERIC,
  price_variance NUMERIC,
  qty_variance NUMERIC,
  mix_variance NUMERIC,
  volume_variance NUMERIC GENERATED ALWAYS AS (qty_variance + mix_variance) STORED,
  fx_variance NUMERIC,
  computed_at TIMESTAMPTZ DEFAULT now()
);
```

### 10.3 Operations / COGS Tables

```sql
-- ── Generation Unit Register ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS ops_unit_register (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_code TEXT NOT NULL UNIQUE,
  unit_name TEXT NOT NULL,
  category TEXT NOT NULL,
    -- 'jps_lng' | 'jps_bogue_gt' | 'ipp' | 'jps_renewable' | 'hydro'
  primary_fuel TEXT,
    -- 'lng' | 'hfo' | 'cng' | 'no2' | 'diesel' | 'petcoke' | 'coal' | 'hydro' | 'wind' | 'solar'
  capacity_mw NUMERIC,
  is_ipp BOOLEAN DEFAULT false,
  is_renewable BOOLEAN DEFAULT false,  -- excluded from fuel calc if true
  is_ifrs16 BOOLEAN DEFAULT false,
    -- TRUE for JEP, JPPC, SJPC, WKPP — PPA reclassified as lease under IFRS 16
    -- Their payments excluded from COGS; appear as depreciation + interest via fpa_ifrs16_schedule
    -- FALSE for Wigton, JAMALCO, JPS Renewables — straight operating cost / COGS
  is_active BOOLEAN DEFAULT true,
  ppa_expiry DATE,                     -- for IPPs
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Unit Monthly Plan (per LE version) ───────────────────────────
CREATE TABLE IF NOT EXISTS ops_unit_monthly (
  id BIGSERIAL PRIMARY KEY,
  version_id UUID REFERENCES fpa_versions,
  unit_id UUID REFERENCES ops_unit_register,
  period_year INT NOT NULL,
  period_month INT NOT NULL,
  fuel_type_active TEXT,          -- may differ from primary_fuel (e.g. dual-fuel units)
  availability_pct NUMERIC,       -- % of hours available
  max_mwh NUMERIC,                -- capacity × availability hours
  planned_mwh NUMERIC,            -- dispatch plan for this unit
  actual_heat_rate_kj_kwh NUMERIC, -- unit-level, from Input sheet
  our_heat_rate_kj_kwh NUMERIC DEFAULT 10200, -- OUR permitted billing heat rate
  UNIQUE(version_id, unit_id, period_year, period_month)
);

-- ── Fuel Price Assumptions (per LE version) ───────────────────────
CREATE TABLE IF NOT EXISTS ops_fuel_assumptions (
  id BIGSERIAL PRIMARY KEY,
  version_id UUID REFERENCES fpa_versions,
  period_year INT NOT NULL,
  period_month INT NOT NULL,
  fuel_type TEXT NOT NULL,
    -- 'hfo' | 'lng' | 'cng' | 'no2' | 'diesel' | 'petcoke' | 'coal'
  price_usd NUMERIC NOT NULL,     -- US$ per barrel / MMBtu / tonne (depends on fuel type)
  price_unit TEXT NOT NULL,       -- 'barrel' | 'mmbtu' | 'tonne'
  billing_exchange_rate NUMERIC,  -- JMD/USD — OUR/BOJ rate for billing period
  source TEXT,                    -- 'platts' | 'spot' | 'contract' | 'manual'
  updated_by UUID REFERENCES profiles,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(version_id, period_year, period_month, fuel_type)
);

-- ── IPP Payment Schedule (per LE version) ────────────────────────
CREATE TABLE IF NOT EXISTS ops_ipp_schedule (
  id BIGSERIAL PRIMARY KEY,
  version_id UUID REFERENCES fpa_versions,
  unit_id UUID REFERENCES ops_unit_register,   -- must be an IPP unit
  period_year INT NOT NULL,
  period_month INT NOT NULL,
  -- Volume drivers
  adc_kw NUMERIC,                 -- Average Dependable Capacity (kW)
  neo_kwh NUMERIC,                -- Net Energy Output (kWh) — drives variable payments
  -- Fixed payments (US$) — capacity-based, not volume-dependent
  fixed_capacity_charge NUMERIC DEFAULT 0,
  fixed_om NUMERIC DEFAULT 0,
  fixed_local_non_labour NUMERIC DEFAULT 0,
  fixed_foreign_labour NUMERIC DEFAULT 0,
  fixed_foreign_non_labour NUMERIC DEFAULT 0,
  fixed_mooring NUMERIC DEFAULT 0,
  fixed_debt_service NUMERIC DEFAULT 0,
  fixed_equity_return NUMERIC DEFAULT 0,
  fixed_supplemental NUMERIC DEFAULT 0,
  -- Variable payments (US$) — NEO-driven
  variable_fuel_charge NUMERIC DEFAULT 0,
  variable_cet_payments NUMERIC DEFAULT 0,
  variable_om_local NUMERIC DEFAULT 0,
  variable_om_foreign NUMERIC DEFAULT 0,
  variable_fuel_transport NUMERIC DEFAULT 0,
  variable_cylinder_oil NUMERIC DEFAULT 0,
  variable_circulating_oil NUMERIC DEFAULT 0,
  -- Totals (auto-calculated on insert/update via generated columns or trigger)
  total_fixed NUMERIC GENERATED ALWAYS AS (
    fixed_capacity_charge + fixed_om + fixed_local_non_labour +
    fixed_foreign_labour + fixed_foreign_non_labour + fixed_mooring +
    fixed_debt_service + fixed_equity_return + fixed_supplemental
  ) STORED,
  total_variable NUMERIC GENERATED ALWAYS AS (
    variable_fuel_charge + variable_cet_payments + variable_om_local +
    variable_om_foreign + variable_fuel_transport + variable_cylinder_oil +
    variable_circulating_oil
  ) STORED,
  updated_by UUID REFERENCES profiles,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(version_id, unit_id, period_year, period_month)
);

-- ── System Loss Analysis (per LE version) ────────────────────────
CREATE TABLE IF NOT EXISTS ops_loss_analysis (
  id BIGSERIAL PRIMARY KEY,
  version_id UUID REFERENCES fpa_versions,
  period_year INT NOT NULL,
  period_month INT NOT NULL,
  sales_kwh NUMERIC,              -- billed kWh (from committed Sales LE)
  actual_loss_pct NUMERIC,        -- actual system loss %
  our_permitted_loss_pct NUMERIC DEFAULT 0.175, -- 17.5% OUR cap
  net_gen_required_kwh NUMERIC GENERATED ALWAYS AS
    (sales_kwh / NULLIF(1 - actual_loss_pct, 0)) STORED,
  excess_loss_pct NUMERIC GENERATED ALWAYS AS
    (GREATEST(actual_loss_pct - 0.175, 0)) STORED,
  excess_loss_kwh NUMERIC,        -- calculated: net_gen × excess_loss_pct
  loss_effect_usd NUMERIC,        -- cost of excess loss absorbed by JPS
  updated_by UUID REFERENCES profiles,
  UNIQUE(version_id, period_year, period_month)
);

-- ── Heat Rate Analysis (per LE version) ──────────────────────────
CREATE TABLE IF NOT EXISTS ops_heat_rate_analysis (
  id BIGSERIAL PRIMARY KEY,
  version_id UUID REFERENCES fpa_versions,
  period_year INT NOT NULL,
  period_month INT NOT NULL,
  fuel_gen_kwh NUMERIC,           -- net gen using fuel (excl hydro/renewables)
  system_avg_heat_rate_kj_kwh NUMERIC,   -- weighted avg actual heat rate
  our_billing_heat_rate_kj_kwh NUMERIC DEFAULT 10200,
  excess_heat_kj_kwh NUMERIC GENERATED ALWAYS AS
    (GREATEST(system_avg_heat_rate_kj_kwh - 10200, 0)) STORED,
  heat_rate_effect_usd NUMERIC,   -- cost of excess heat rate absorbed by JPS
  updated_by UUID REFERENCES profiles,
  UNIQUE(version_id, period_year, period_month)
);

-- ── COGS Monthly Summary ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ops_cogs_summary (
  id BIGSERIAL PRIMARY KEY,
  version_id UUID REFERENCES fpa_versions,
  period_year INT NOT NULL,
  period_month INT NOT NULL,
  -- JPS own generation fuel cost
  jps_fuel_cost_usd NUMERIC DEFAULT 0,
  -- IPP payments
  ipp_fixed_total_usd NUMERIC DEFAULT 0,
  ipp_variable_total_usd NUMERIC DEFAULT 0,
  ipp_total_usd NUMERIC GENERATED ALWAYS AS
    (ipp_fixed_total_usd + ipp_variable_total_usd) STORED,
  -- Gross fuel cost
  total_fuel_cost_usd NUMERIC GENERATED ALWAYS AS
    (jps_fuel_cost_usd + ipp_fixed_total_usd + ipp_variable_total_usd) STORED,
  -- Regulatory adjustments (signed: negative = deduction from recovery)
  adj_system_loss_effect_usd NUMERIC DEFAULT 0,
  adj_heat_rate_effect_usd NUMERIC DEFAULT 0,
  adj_force_majeure_usd NUMERIC DEFAULT 0,
  adj_fcra_usd NUMERIC DEFAULT 0,
  adj_inverse_cap_usd NUMERIC DEFAULT 0,
  -- Net recoverable
  net_recoverable_usd NUMERIC,    -- computed: total_fuel_cost + sum of adjustments
  -- FX conversion
  billing_exchange_rate NUMERIC,
  total_fuel_cost_jmd NUMERIC,
  net_recoverable_jmd NUMERIC,
  -- Fuel rate
  sales_kwh NUMERIC,              -- from committed Sales LE
  fuel_rate_usc_kwh NUMERIC,      -- US¢/kWh = net_recoverable_usd / (sales_kwh/100)
  fuel_rate_jmc_kwh NUMERIC,      -- J¢/kWh = fuel_rate_usc × billing rate
  -- Metadata
  calculated_at TIMESTAMPTZ DEFAULT now(),
  calculated_by UUID REFERENCES profiles,
  UNIQUE(version_id, period_year, period_month)
);

-- ── COGS Detail Lines (unit-level, for drill-down) ────────────────
CREATE TABLE IF NOT EXISTS ops_cogs_detail (
  id BIGSERIAL PRIMARY KEY,
  version_id UUID REFERENCES fpa_versions,
  unit_id UUID REFERENCES ops_unit_register,
  period_year INT NOT NULL,
  period_month INT NOT NULL,
  kwh_generated NUMERIC,
  fuel_type TEXT,
  fuel_volume NUMERIC,            -- barrels / MMBtu / tonnes
  fuel_price_usd NUMERIC,         -- price per unit
  fuel_cost_usd NUMERIC,          -- volume × price
  heat_rate_kj_kwh NUMERIC,       -- actual heat rate used
  heat_rate_effect_usd NUMERIC,   -- absorbed inefficiency for this unit
  source TEXT DEFAULT 'calculated' -- 'calculated' | 'manual_override'
);
```

---

## 11. Security & Compliance

### 11.1 Authentication
- Supabase Auth (email + password) across all 6 apps
- Each app uses isolated `storageKey` — no cross-app session collision
- Invite link flow: `_pendingAuthToken` pattern (fixed 2026-05-16) — manually exchanges token with `setSession()` before `updateUser()`, since `detectSessionInUrl: false` is set on all apps
- MFA: roadmap (Supabase TOTP — enable for admin role)

### 11.2 Authorisation
- `profiles.role` → FP&A Hub access (admin / analyst / viewer / om)
- `profiles.sales_role` → Sales Platform access (admin / manager / rep / view)
- `profiles.access_areas[]` → tab-level gating within apps (e.g. 'operations' tab in Sales)
- All writes via Edge Functions (server-side role check + service role key)
- RLS on all tables — extension data isolated by extension field

### 11.3 Data Integrity
- OCC (Optimistic Concurrency Control) on fpa_facts writes
- Accepted versions immutable — supersede-only pattern
- All commits written to fpa_audit_log (user, timestamp, version, lines affected)
- Reconciliation checks enforce GL → committed data traceability

### 11.4 Secrets
- Supabase URL + anon key: Vercel Environment Variables
- Service role key: Supabase Vault (Edge Functions only)
- Claude API key: Supabase Vault
- **Action required:** Rotate Propel service role key — was committed to git (flagged in cross_project_standards.md)

### 11.5 Compliance Mapping
| Control | Framework | Implementation |
|---|---|---|
| Access control | COSO, SOC 2 | RBAC + RLS + MFA (roadmap) |
| Audit trail | IIA, SOC 2 | fpa_audit_log — immutable, all events |
| Data integrity | COSO | OCC, DB constraints, version locking |
| Segregation of duties | COSO | Extension commits ≠ FP&A review/accept |
| Backup & recovery | NIST CSF | Supabase daily backups + PITR |

---

## 12. Implementation Roadmap

### Phase 0 — Commit Protocol Foundation (1–2 weeks)
**Outcome:** The handshake between extensions and hub is built. Everything else layers on top.

- DB migration: extend fpa_versions, create gl_line_mapping, commit_validations, reconciliation_log, le_calendar
- Edge Functions: submit-version, accept-version, reject-version, run-validations
- FP&A Hub: Incoming Commits review panel (list, accept, reject with notes)
- Realtime channels: commit submitted/accepted/rejected notifications
- GL mapping admin UI in FP&A Hub

---

### Phase 1 — O&M Commit (1 week)
**Outcome:** O&M Platform connects to hub. First real end-to-end commit flow.
*O&M Platform is the closest to done — just needs the commit wiring.*

- Formalise LE version in om_facts → fpa_versions record
- Build om_dim_line → fpa_dim_line mapping
- Add submit button + validation panel to O&M Platform
- Test full flow: O&M submits → FP&A Hub accepts → P&L updates

---

### Phase 2 — Sales Platform Commit + Operations Tab (3 weeks)
**Outcome:** Revenue + net gen + fuel COGS + IPP payments + collections all committed from Sales Platform.

**Week 1 — LE Commit Flow:**
- LE version workflow in Sales Platform (create named version, save, history)
- Pre-submit validation (no blanks, revenue ties, prior LE comparison)
- Submit LE: summarise jps_forecast → fpa_facts

**Week 2 — Operations Tab Build:**
- DB migration: ops_unit_register, ops_unit_monthly, ops_fuel_assumptions, ops_ipp_schedule, ops_loss_analysis, ops_heat_rate_analysis, ops_cogs_detail, ops_cogs_summary
- Seed unit register with full plant list (LNG, Bogue GTs, IPPs, hydro/renewables)
- System Losses section: actual loss% vs OUR 17.5% cap, absorbed loss auto-calculation
- Fuel Assumptions section: price per fuel type per month, billing exchange rate
- Unit plan section: fuel type flag + availability per unit per month
- IPP Schedule section: per-provider ADC, NEO, fixed breakdown, variable breakdown
- Heat Rate section: unit-level actual vs OUR 10,200 kJ/kWh target

**Week 3 — COGS Engine + Combined Commit:**
- Auto-calculation engine: all fuel cost and IPP payment formulas (see Section 8.2.1)
- Regulatory adjustments section: FCRA, inverse cap, force majeure (manual entry + documented)
- COGS Summary panel: JPS fuel, IPP fixed, IPP variable, adjustments, fuel rate (US¢ + J¢)
- FX variance decomposition: volume / price / rate effects
- Combined commit: Revenue + Operations (COGS) + Collections in one submission event
- fpa_facts mapping: fuel cost, IPP fixed, IPP variable → separate fpa_dim_line entries
- Collections tab: AR aging model, receipts forecast, formal commit

---

### Phase 3 — Propel → FP&A Feed (1 week)
**Outcome:** Approved CapEx projects automatically appear in FP&A LE.
*No changes to Propel UI or approval workflow.*

- commit-capex-version Edge Function (triggered on Propel's final approval)
- Spend phasing form: project manager enters monthly spend plan on approval
- Capitalisation schedule → depreciation profile → fpa_facts
- Cancel/revision: supersede prior fpa_facts entry

---

### Phase 4 — Treasury Extension (2–3 weeks)
**Outcome:** Debt service, IFRS-16, FX fully managed in Treasury app.

- Loan register CRUD
- Repayment schedule auto-calculation
- FX assumptions table
- IFRS-16 lease register + calculation engine (migrate from FP&A Hub)
- Liquidity forecast (30/60/90 day)
- Commit: interest expense, debt repayment, FX impact → fpa_facts

---

### Phase 5 — Board Pack & AI Commentary (1–2 weeks)
**Outcome:** Monthly board pack generated in <2 hours from close.

- pptxgenjs template — branded JPS slides
- generate-board-pack Edge Function
- generate-commentary Edge Function (Claude API with prompt caching)
- Inline commentary editor in FP&A Hub
- PDF export (print CSS)
- board_pack_outputs storage + versioning

---

### Phase 6 — Reconciliation & Hardening (1 week)
**Outcome:** Full audit trail from GL → committed LE → board pack.

- reconcile-period Edge Function (actuals vs committed LE per line)
- Reconciliation dashboard in FP&A Hub
- LE Calendar UI with deadline tracking + automated reminders
- Full RLS audit across all 6 apps
- Performance testing: 50 concurrent users, large table query analysis
- Propel service role key rotation (security fix)

---

**Total estimated timeline: 10–13 weeks** *(Phase 2 extended by 1 week for COGS engine)*

---

## 13. Out of Scope — Version 1.0

- Direct ERP API integration (manual GL upload acceptable for v1)
- Mobile native app (responsive web only)
- Multi-company / multi-entity consolidation
- Automated bank reconciliation
- Payroll system integration
- Customer self-service portal
- ML-based predictive forecasting (Claude API narrative only)
- Propel UI changes (approval workflow is production — no touch)

---

## 14. Open Questions for Management

**Platform / Process:**
1. **GL export format** — What system produces the GL trial balance? SAP, Sage, or other? Who runs the export and on what schedule?
2. **LE cycle calendar** — What is the agreed submission deadline for each extension per month-end close?
3. **Acceptance authority** — Who in FP&A accepts extension submissions? One designated analyst or any FP&A team member?
4. **Operations ownership** — Confirm: Operations tab in Sales Platform will be managed by Operations team, not Sales team. Who has write access to loss factor and fuel assumptions?
5. **Budget timeline** — When does the annual budget cycle run? What is the AOP lockdown date?
6. **Variance threshold for reconciliation** — What % or $ triggers a reconciliation query? (Suggested: 5% or $5M JMD, whichever is smaller)
7. **Board pack template** — Is there an approved PowerPoint template? Who approves changes?
8. **AI commentary sign-off** — Must AI commentary be reviewed by CFO before distribution?
9. **Data retention** — How long must financial versions be retained? (Recommended: 7 years)
10. **Propel service role key** — Confirm rotation of exposed key (flagged as security action required)

**Operations / COGS:**
11. **Dispatch plan source** — How is unit dispatch (planned MWh per unit per month) currently determined? Ops team manual entry, or does it come from the SCADA/energy management system?
12. **OUR heat rate target** — Confirm the OUR Permitted Billing Heat Rate is fixed at 10,200 kJ/kWh for all JPS-owned thermal units. Are there unit-specific exceptions?
13. **IPP PPA schedules** — Are the fixed payment schedules (capacity charge, equity return, debt service) locked in the PPA and stable year-over-year, or do they change? Who is the authoritative source — Legal or Treasury?
14. **FCRA determination** — Who calculates the FCRA amount? Is it determined by OUR after the tariff filing, or does JPS pre-estimate it for LE purposes? How should this be recorded before OUR issues the determination?
15. **Force Majeure treatment** — What documentation is required for a force majeure fuel recovery adjustment to be entered in the system? Who has authority to approve the entry?
16. **Loss target in LE** — Should the Operations tab use the OUR permitted 17.5% as the LE assumption for loss%, or does JPS use its own target loss% (e.g. actual 26.5% knowing JPS absorbs the excess)? Confirm what the model should project vs what is recoverable.
17. **Fuel price assumption source** — For the LE, are fuel prices provided by a specific team (Procurement? Treasury?)? What is the agreed price authority — Platts forward curve, contract fixed price, internal forecast?
18. **Hydro generation data** — How is hydro MWh planned in the LE? Is there a rainfall forecast model, or is it a fixed assumption based on historical average?
19. **Billing exchange rate** — For LE purposes, is the billing exchange rate the BOJ monthly average, the rate at the tariff filing date, or a forward rate? Who sets the assumption?
20. **CET payments** — What is CET (appears in JEP PPA)? Confirm formula — is it indexed to fuel price, generation volume, or fixed per PPA term?

---

## 15. App URL Structure

| App | URL | Vercel Project |
|---|---|---|
| FP&A Hub | jmfinancelab.com | jps-fp-a |
| Sales Platform | sales.jmfinancelab.com | jps-sales (or /sales subpath) |
| O&M Platform | om.jmfinancelab.com | jps-om |
| Propel (CapEx) | propel.jmfinancelab.com | jps-propel |
| Treasury | treasury.jmfinancelab.com | jps-treasury |
| App Switcher | jmfinancelab.com (landing) | jps-fp-a |

---

*Document: `JPS_FPA_Suite_PRD.md` — maintained in `C:\Users\jwilson\Downloads\FP&A Rebuild\`*
*Next step: Phase 0 — DB schema migration + commit Edge Functions*
