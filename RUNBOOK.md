# RUNBOOK — FP&A Hub

> One paragraph per decision. Code says *what*; this says *why* and *how to run it when the author is gone.*
> Bump **Last reviewed** whenever you edit this. Stale > 90 days flags red in the Project Tracker.

## 0. At a glance
| | |
|---|---|
| **Owner** | jps |
| **Status** | active |
| **Category** | JPS |
| **Live URL** | https://jmfinancelab.com |
| **GitHub repo** | JPSFP-A/JPS-FP-A |
| **Default branch** | master |
| **Local path** | D:\Projects\FPA |
| **Entry file** | index.html |
| **Supabase** | bhrswnbenkvflpdjhfpa |
| **Tech stack** | single-file index.html + Supabase JS + Vercel static |
| **Last reviewed** | 2026-06-26 |

## 1. Architecture — the WHY
- **Stack:** single-file index.html + Supabase JS + Vercel static. _Why this shape:_ TODO (one paragraph).
- **Auth:** Platform SSO (`jps_sso_v1` cookie via shared/jps-auth.js); access gated by get_app_access() RPC → admin.app_access.
- **Database:** bhrswnbenkvflpdjhfpa. _Key tables + why this schema:_ TODO.
- **Project-specific notes:** Reads fpa_facts via sa(); OCC writes via fpa_facts_write_occ. Report Builder (p17) drives templated pages. Derived lines computed in JS, never read from DB.
- **Other non-obvious decisions** (a library, an RPC, a workaround): TODO — one paragraph each.

## 2. Setup — run from scratch
```bash
git clone https://github.com/JPSFP-A/JPS-FP-A.git
cd "FPA"
# env / secrets — list every var + where it comes from. Supabase anon key only in client, never service-role.
# entry: index.html
# run locally (static apps): python -m http.server 8080
```
- **Gotchas the instructions skip:** TODO — the commands/workarounds a new person trips on.

## 3. Deploy
```bash
cd "D:\Projects\FPA"
vercel --prod --yes
```
- **Git identity (JPS repos):** user.name=JPSFP-A, user.email=jwilson@jpsco.com — Jordachew identity → Vercel BLOCKED.
- **⚠️ Verify the live URL serves the new build** after deploy (shadow *-deploy projects have hijacked aliases before).

## 4. Failure modes — when it breaks
| Symptom | Likely cause | Fix |
|---|---|---|
| Live URL serves old build | shadow *-deploy Vercel project owns alias | re-alias to real project (`--scope jps-fpa`) |
| Login fails / `otp_expired` | jpsco.com Defender burns reset link | use CODE-only reset, not link |
| Numbers show 0 | upstream *_facts table empty for period | check upload ran; never hardcode a non-zero fallback |
| 401 / RLS denied | anon key hitting protected view | confirm RLS / security_invoker |
- **Monitoring:** JpsMonitor heartbeat (record_heartbeat RPC, 60s); Sentry/PostHog where wired.
- **Rollback:** Vercel → Deployments → promote previous; or git revert + redeploy.

## 5. Git & branching
- Never push straight to `master` — even solo. `git checkout -b feature/<x>` → commit → PR → merge.
- `master` is production = what users see. Vercel preview deploys = staging.

## 6. Open items / TODO
- Fill section 1 architecture WHYs.
- Confirm Supabase ref + key tables.

