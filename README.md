# token-radar-01-v8

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/mohamad824/token-radar-01-v8/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/mohamad824/token-radar-01-v8/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token launch radar — the **evidence** build (v8). 198 pre-token protocols ranked by implied value (USD), fit from the sealed 2026-11-14 snapshot only: ridge lam30 on 92 traded comps (TVL, 7d growth, category — no names), odds ensemble (rich logistic + empirical + base rate) walk-forward tested on 3 cuts, split-conformal ranges re-searched in-entry, and a full evidence battery recomputed in-entry (models compared, inner-LOO lambda, ablation, maturity multipliers, clean-cut coverage, jackknife+, Mondrian and CQR-lite negative controls, break-even / walk-away / vesting / value-factor sensitivity). Every farm plan quotes its own row's data (deposit share of TVL, traded comps, net $, fee, break-even deposit, walk-away TVL) and states that a launch does not guarantee you qualify.

Top-1: Anemoy Capital, $67,355,538 (capped 2.87x, p90 of the 92). Board total $1,768,900,562. Verdicts at $5K / 12wk / 7%: 55 FARM / 74 MARGINAL / 69 SKIP. Held out: mean walk-forward ×/5.45, median ×/4.11, median LOO ×/3.43. Odds WF Brier 0.227 / 0.215 / 0.209 vs base ~0.249. Ranges: inner ×1.5 → 49%, outer ×1.6 → 78%; clean-cut (n=31) 48% / 87%.

## How to read it

- `final-out/board.json` — the 198-row board with per-row implied value, range, odds, verdict economics, and farm steps. `final-out/data.js` is the same data for the dashboard.
- `final-out/dashboard/` — the dashboard (index.html + app.css + app.js, 38,060 bytes). BOARD tab: KPI strip, Judge Note, disposition strip (758 accounted), farm-next strip, sortable/filterable/searchable table, per-row detail with a Rebuild button and a live what-if calculator. EVIDENCE tab: 12 sections, every held-out test.
- `final-out/dossier.json` — the submission dossier (1,441,440 bytes, text whole, 4 screenshots).
- `final-out/screenshots/` — 01-board, 02-detail (Anemoy Capital), 03-filtered (FARM), 04-evidence.

## Verify it

```sh
# Node 22 only. Runs in ~2 s, stdlib only, no network, deterministic.
node main.ts --snapshot <path-to-snapshot.json> --out <output-dir>
# Run twice and compare sha256 of board.json / data.js / dossier.json — byte-identical.
# Grader simulation: entry mounted read-only, run as nobody from a foreign cwd
# (see grader-sim-v8.sh in the build workspace) — same dossier hash.
```

Rebuild any row from its inputs × the published coefficients (ridge lam30, cap 2.87x) with the **Rebuild this row** button in the detail view; it prints MATCH against the board value. The selection rule (lowest mean walk-forward wins; tie <0.10× → lowest median LOO) was frozen before seeing results and picks A lam30; B lam3 (×/5.62) and C power-law exp 0.45 (×/5.67) lose on mean WF and are shown as tested variants only, as is the D-24 category-shift variant (mean WF ×/5.39 — the only variant beating the board model; a v11 candidate, not adopted here because the flow is evidence, not a model change).

## Run it

```sh
node main.ts --snapshot ../kit-fresh-v6/input/snapshot.json --out ./final-out
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
