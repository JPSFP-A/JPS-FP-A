# JPS Finance Skills / Agents — Cheat-Sheet
_Last updated 2026-06-20. Two buckets: internal ops (your data) vs external market intel (public companies)._

## 🏢 Bucket A — JPS ops (internal data: Supabase `fpa_facts` / QuickBooks)
Runs on YOUR numbers. Daily driver.

| When you need to… | Fire |
|---|---|
| Morning vitals (rev vs budget, cash, recon, heartbeat) | `/jps-morning-brief` |
| Actuals vs budget/LE + driver narrative | `/jps-variance-analysis` |
| MoM revenue decomposition by rate class/segment | `/jps-revenue-movers` |
| GL recon + FAIL/WARN exceptions | `/jps-recon-report` |
| Revenue/load forecast (base/up/down) | `/jps-forecast` |
| Run period close (validate → aggregate → lock) | `/jps-period-close` |
| Board pack (live data → PPTX/PDF → Drive) | `/jps-board-pack` |
| Upload actuals Excel → fpa_facts | `/jps-rate-class-upload` |
| IFRS treatment / technical memo (Jamaica) | `/ifrs-accounting-standards-advisor`, `/accounting` |
| Ad-hoc analysis / report build on your data | `/financial-analyst`, `/financial-reporting` |
| QuickBooks entities (VI etc.) — P&L, AR/AP aging, payroll | QuickBooks MCP, `vi-qb-sync`, `/sage-accounting` |

## 🌐 Bucket B — External market intel (public companies)
For board context, peer/parent benchmarking, macro inputs — NOT your internal close.

| When you need to… | Fire | Reel "3 standouts" |
|---|---|---|
| Full company workup / tearsheet | `/financial-analyst-master`, `bigdata-com:company-brief`, `daloopa:tearsheet` | ① news + ratings |
| Build an Excel valuation model | `daloopa:build-model`, `daloopa:dcf`, `daloopa:comps` | ② Excel valuation |
| Analyze an earnings call / thesis | `/earnings-analyst-master`, `bigdata-com:earnings-digest` | ③ earnings review |
| Public-co statements | `income-statement`, `balance-sheet`, `cash-flow-statement` | |
| SEC filings (10-K/Q/8-K, MD&A, risk) | `/sec-analyst-master` + `sec-*` | |

## 🔌 Connectivity status (checked 2026-06-20)
- ✅ **Live now:** QuickBooks (P&L/BS/CF/AR-AP/payroll — needs `company-info` connect), Canva.
- 🔑 **1-click OAuth to enable:** `bigdata-com`, `daloopa`, `lseg` (call each server's `authenticate` once). lseg + daloopa are the ones worth it.
- ❌ **Not connected (no MCP):** Octagon — backs `commodities-quote`, `stock-quote`, `income/balance/cash-flow-statement`, `sec-*`, `earnings-*`, `financial-analyst-master`, `market-analyst-master`. These skills are LISTED but have no data backend until Octagon MCP is added. (Fuel/crude read currently has to fall back to web search.)

## ⚡ JPS-specific power moves (where Bucket B earns its keep)
- **Fuel pass-through** → `commodities-quote` (live oil/energy prices) → feeds fuel-cost / tariff work.
- **BOJ forex / JMD–USD for IFRS** → `forex-list`, `lseg:fx-carry`, `lseg:macro-rates` → IFRS forex + monetary-item revaluation inputs.
- **Utility peer / parent benchmarking for board** → `daloopa:comps`, `financial-analyst-master` on comparable utilities.
- **NotebookLM** (Google, free) → dump IFRS standards / long earnings docs for Q&A during board prep.

## Don'ts
- Don't swap Opus for free open-model "Claude Code" hacks (NVIDIA NIM/OpenRouter/Ollama) — quality + integrity downgrade on a platform moving financial numbers.
