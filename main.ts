// token-radar-01 v8 — EVIDENCE flow (C1+C4+C3).
// Written from scratch by the v8 builder. No prior entry source and no kit
// starter were read; only the vendor library vendor/makefun-board.ts.
// Model board: A lam30 (same as v6). All evidence items in §5.2 of the
// v8 brief are recomputed here, in-entry, from the sealed snapshot.
// Deterministic: seeded PRNG only, fixed iteration order, no Date.now(),
// no Math.random, no network. Node 22, stdlib only.
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NODE22 = true;
void NODE22;

const args = process.argv.slice(2);
// Grader contract: MAKEFUN_INPUT / MAKEFUN_OUTPUT_DIR env vars win;
// --snapshot/--input and --out/--output flags next; entry-relative defaults last.
const flagVal = (...names: string[]): string | null => {
  for (const n of names) {
    const i = args.indexOf(n);
    if (i >= 0 && i + 1 < args.length) return args[i + 1];
  }
  return null;
};
const SNAP = flagVal('--snapshot', '--input')
  ?? (process.env.MAKEFUN_INPUT ? process.env.MAKEFUN_INPUT : null)
  ?? join(__dirname, '..', 'kit-fresh-v6', 'input', 'snapshot.json');
const OUT = flagVal('--out', '--output')
  ?? (process.env.MAKEFUN_OUTPUT_DIR ? process.env.MAKEFUN_OUTPUT_DIR : null)
  ?? join(__dirname, 'final-out');
const ENTRY = __dirname;

// ---------------- seeded PRNG (mulberry32) + gaussian ----------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeGauss(rng: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) { const v = spare; spare = null; return v; }
    let u = 0, v = 0;
    while (u === 0) u = rng();
    v = rng();
    const r = Math.sqrt(-2 * Math.log(u));
    const t = 2 * Math.PI * v;
    spare = r * Math.sin(t);
    return r * Math.cos(t);
  };
}

// ---------------- stats (numpy semantics) ----------------
const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length;
const sum = (a: number[]): number => a.reduce((s, v) => s + v, 0);
function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  const n = s.length, m = Math.floor(n / 2);
  return n % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function quantile(a: number[], q: number): number {
  // numpy linear interpolation: pos = q*(n-1)
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  if (n === 1) return s[0];
  const pos = q * (n - 1);
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
function stdPop(a: number[]): number {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / a.length);
}
function ranksAvg(a: number[]): number[] {
  const idx = a.map((_, i) => i).sort((i, j) => a[i] - a[j]);
  const r = new Array<number>(a.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && a[idx[j + 1]] === a[idx[i]]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k]] = avg;
    i = j + 1;
  }
  return r;
}
function pearson(x: number[], y: number[]): number {
  const mx = mean(x), my = mean(y);
  let sxy = 0, sx = 0, sy = 0;
  for (let i = 0; i < x.length; i++) {
    const dx = x[i] - mx, dy = y[i] - my;
    sxy += dx * dy; sx += dx * dx; sy += dy * dy;
  }
  return sx === 0 || sy === 0 ? 0 : sxy / Math.sqrt(sx * sy);
}
const spearman = (x: number[], y: number[]): number => pearson(ranksAvg(x), ranksAvg(y));
const log10 = (x: number): number => Math.log10(x);
const r6 = (x: number): number => Math.round(x * 1e6) / 1e6;
const r3 = (x: number): number => Math.round(x * 1e3) / 1e3;
const r2 = (x: number): number => Math.round(x * 1e2) / 1e2;
const medX = (e: number[]): number => Math.pow(10, median(e.map(Math.abs)));
const meanX = (e: number[]): number => Math.pow(10, mean(e.map(Math.abs)));
function shuffleSeeded<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------- linear algebra: solve A x = b (Gaussian elim, partial pivot) ----------------
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M: number[][] = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (piv !== col) [M[piv], M[col]] = [M[col], M[piv]];
    const d = M[col][col];
    if (Math.abs(d) < 1e-14) M[col][col] = d >= 0 ? 1e-14 : -1e-14;
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

// Ridge: standardize X (mean/population sd, sd==0 -> 1), intercept unpenalized,
// penalty lam on all slopes. Returns {b, mu, sd}.
function ridgeFit(X: number[][], y: number[], lam: number): { b: number[]; mu: number[]; sd: number[] } {
  const n = X.length, p = X[0].length;
  const mu: number[] = [], sd: number[] = [];
  for (let j = 0; j < p; j++) {
    const col = X.map((r) => r[j]);
    mu.push(mean(col));
    const s = stdPop(col);
    sd.push(s === 0 ? 1 : s);
  }
  const Xs = X.map((r) => r.map((v, j) => (v - mu[j]) / sd[j]));
  const P = p + 1;
  const A: number[][] = Array.from({ length: P }, () => new Array<number>(P).fill(0));
  const by: number[] = new Array<number>(P).fill(0);
  for (let i = 0; i < n; i++) {
    const xi = [1, ...Xs[i]];
    for (let a = 0; a < P; a++) {
      by[a] += xi[a] * y[i];
      for (let b = 0; b < P; b++) A[a][b] += xi[a] * xi[b];
    }
  }
  for (let j = 1; j < P; j++) A[j][j] += lam;
  return { b: solve(A, by), mu, sd };
}
function ridgePred(m: { b: number[]; mu: number[]; sd: number[] }, X: number[][]): number[] {
  return X.map((r) => {
    let s = m.b[0];
    for (let j = 0; j < r.length; j++) s += m.b[j + 1] * ((r[j] - m.mu[j]) / m.sd[j]);
    return s;
  });
}
// OLS: ridge with lam=0.
const olsFit = (X: number[][], y: number[]): { b: number[]; mu: number[]; sd: number[] } => ridgeFit(X, y, 0);

// Logistic regression (Newton/IRLS, L2 lam on slopes, intercept free).
// Standardization constants are passed in explicitly: the odds protocol
// standardizes the rich features with the GLOBAL mean/sd over all 758
// (the same constants the Python research used), both for the WF folds
// and for the full fit.
// NLL = sum y*log(1+exp(-z)) + (1-y)*log(1+exp(z)) + 0.5*lam*sum(b[1:]^2).
function logaddexp(a: number, b: number): number {
  const m = Math.max(a, b);
  return m + Math.log(Math.exp(a - m) + Math.exp(b - m));
}
function logitFitStd(X: number[][], y: number[], lam: number, mu: number[], sd: number[]): { b: number[]; mu: number[]; sd: number[]; nll: number; iters: number } {
  const n = X.length, p = X[0].length;
  const Xs = X.map((r) => [1, ...r.map((v, j) => (v - mu[j]) / sd[j])]);
  const P = p + 1;
  let b = new Array<number>(P).fill(0);
  const nllOf = (bb: number[]): number => {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const z = Xs[i].reduce((t, v, j) => t + v * bb[j], 0);
      s += y[i] * logaddexp(0, -z) + (1 - y[i]) * logaddexp(0, z);
    }
    for (let j = 1; j < P; j++) s += 0.5 * lam * bb[j] * bb[j];
    return s;
  };
  let nll = nllOf(b);
  let iters = 0;
  const gradAt = (bb: number[]): number[] => {
    const g = new Array<number>(P).fill(0);
    for (let i = 0; i < n; i++) {
      const z = Xs[i].reduce((t, v, j) => t + v * bb[j], 0);
      const pr = 1 / (1 + Math.exp(-z));
      for (let a = 0; a < P; a++) g[a] += Xs[i][a] * (pr - y[i]);
    }
    for (let j = 1; j < P; j++) g[j] += lam * bb[j];
    return g;
  };
  for (let it = 0; it < 500; it++) {
    iters = it + 1;
    const g = gradAt(b);
    const gmax = Math.max(...g.map(Math.abs));
    if (gmax < 1e-9) break;
    const H: number[][] = Array.from({ length: P }, () => new Array<number>(P).fill(0));
    for (let i = 0; i < n; i++) {
      const z = Xs[i].reduce((t, v, j) => t + v * b[j], 0);
      const pr = 1 / (1 + Math.exp(-z));
      const w = Math.max(pr * (1 - pr), 1e-9);
      for (let a = 0; a < P; a++) {
        for (let c = 0; c < P; c++) H[a][c] += Xs[i][a] * Xs[i][c] * w;
      }
    }
    for (let j = 1; j < P; j++) H[j][j] += lam;
    const step = solve(H, g.map((v) => -v));
    // step-halving until NLL decreases
    let t = 1, nb = b.map((v, j) => v + t * step[j]), nn = nllOf(nb);
    while (nn > nll && t > 1e-6) {
      t /= 2;
      nb = b.map((v, j) => v + t * step[j]);
      nn = nllOf(nb);
    }
    if (nn >= nll) break; // no improving step: stop at the current point
    b = nb;
    nll = nn;
  }
  return { b, mu, sd, nll, iters };
}
function logitPred(m: { b: number[]; mu: number[]; sd: number[] }, X: number[][]): number[] {
  return X.map((r) => {
    let z = m.b[0];
    for (let j = 0; j < r.length; j++) z += m.b[j + 1] * ((r[j] - m.mu[j]) / m.sd[j]);
    return 1 / (1 + Math.exp(-z));
  });
}

// ---------------- snapshot ----------------
type Proto = {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number | null; mcap_usd: number | null; change_7d: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
  forks: string[] | null;
};
const snap = JSON.parse(readFileSync(SNAP, 'utf8')) as { as_of: string; protocols: Proto[]; watchlist: string[] };
const asOf = new Date(snap.as_of);
const protos: Proto[] = snap.protocols;
const watchlist: string[] = snap.watchlist;
const dayMs = 86400000;
function ageDays(p: Proto): number {
  if (!p.listed_at) return 365;
  return Math.max(Math.floor((asOf.getTime() - new Date(p.listed_at).getTime()) / dayMs), 1);
}
function ageYears(p: Proto): number | null {
  if (!p.listed_at) return null;
  return Math.max((asOf.getTime() - new Date(p.listed_at).getTime()) / dayMs / 365.25, 1 / 365.25);
}
const agesAll = protos.map(ageYears).filter((a): a is number => a !== null);
const medAge = median(agesAll);

// ---------------- eligibility (frozen rules) ----------------
const EXCL_CAT = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCH = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const VERS = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAP = /\b(wrapped|staked|staking)\b/i;
function clean(p: Proto): boolean {
  return !EXCL_CAT.has(p.category ?? '') && !EXCH.test(p.name) && !VERS.test(p.name) && !WRAP.test(p.name);
}
const traded = protos.filter((p) => p.mcap_usd && p.mcap_usd > 0 && p.tvl_usd && p.tvl_usd > 0 && clean(p));
const elig = protos.filter((p) => !p.gecko_id && !p.symbol && clean(p));
const watchInElig = watchlist.filter((w) => elig.some((p) => p.slug === w));
const catsTraded: Record<string, number> = {};
for (const p of traded) if (p.category) catsTraded[p.category] = (catsTraded[p.category] || 0) + 1;
const TOPCATS = Object.keys(catsTraded).filter((c) => catsTraded[c] >= 5).sort();
const y = traded.map((p) => log10(p.mcap_usd as number));
const yMult = traded.map((p) => log10((p.mcap_usd as number) / (p.tvl_usd as number)));
const yTvl = traded.map((p) => log10(p.tvl_usd as number));
// features [logTVL, growth, one-hot TOPCATS]; growth = change_7d/100 (null -> 0)
function feats(p: Proto): number[] {
  const g = (p.change_7d ?? 0) / 100;
  return [log10(p.tvl_usd as number), g, ...TOPCATS.map((c) => (p.category === c ? 1 : 0))];
}
const Xtraded = traded.map(feats);
// ordering by listed_at (null -> "9999"), stable
const listedIdx = traded.map((_, i) => i).sort((a, b) => {
  const la = traded[a].listed_at ?? '9999', lb = traded[b].listed_at ?? '9999';
  return la === lb ? a - b : la < lb ? -1 : 1;
});
function wfCuts(n: number): [number[], number[]][] {
  const out: [number[], number[]][] = [];
  for (const f of [0.4, 0.5, 0.67]) {
    const k = Math.floor(n * f);
    out.push([listedIdx.slice(0, k), listedIdx.slice(k)]);
  }
  return out;
}
type Fp = (tr: number[], te: number[]) => number[]; // predicts log10(mcap) for te
function looFp(fp: Fp): number[] {
  const errs: number[] = [];
  for (let i = 0; i < traded.length; i++) {
    const tr = traded.map((_, j) => j).filter((j) => j !== i);
    errs.push(fp(tr, [i])[0] - y[i]);
  }
  return errs;
}
function wfFp(fp: Fp): number[][] {
  return wfCuts(traded.length).map(([tr, te]) => {
    const pred = fp(tr, te);
    return te.map((idx, k) => pred[k] - y[idx]);
  });
}
function newest35Fp(fp: Fp): number[] {
  const tr = listedIdx.slice(0, -35), te = listedIdx.slice(-35);
  const pred = fp(tr, te);
  return te.map((idx, k) => pred[k] - y[idx]);
}
function reportModel(label: string, fp: Fp): {
  label: string; medLOO: number; meanLOO: number; medWF: number; meanWF: number;
  wfCutsMed: number[]; wfCutsMean: number[]; med35: number; mean35: number;
} {
  const eLoo = looFp(fp);
  const cuts = wfFp(fp);
  const e35 = newest35Fp(fp);
  return {
    label,
    medLOO: medX(eLoo), meanLOO: meanX(eLoo),
    medWF: mean(cuts.map((c) => medX(c))), meanWF: mean(cuts.map((c) => meanX(c))),
    wfCutsMed: cuts.map((c) => medX(c)), wfCutsMean: cuts.map((c) => meanX(c)),
    med35: medX(e35), mean35: meanX(e35),
  };
}
function ridgeFp(lam: number, target: 'cap' | 'mult' = 'cap'): Fp {
  return (tr, te) => {
    const yy = target === 'cap' ? y : yMult;
    const m = ridgeFit(tr.map((i) => Xtraded[i]), tr.map((i) => yy[i]), lam);
    const pred = ridgePred(m, te.map((i) => Xtraded[i]));
    return target === 'cap' ? pred : pred.map((v, k) => v + yTvl[te[k]]);
  };
}
function powFp(exp: number, lam: number): Fp {
  return (tr, te) => {
    const Xg = (idx: number[]): number[] => {
      const p = traded[idx];
      const g = (p.change_7d ?? 0) / 100;
      return [g, ...TOPCATS.map((c) => (p.category === c ? 1 : 0))];
    };
    const m = ridgeFit(tr.map(Xg), tr.map((i) => y[i] - exp * yTvl[i]), lam);
    const pred = ridgePred(m, te.map(Xg));
    return pred.map((v, k) => v + exp * yTvl[te[k]]);
  };
}
// flat baseline: median y of train
const flatFp: Fp = (tr, te) => {
  const med = median(tr.map((i) => y[i]));
  return te.map(() => med);
};
// curve-only (D-52): OLS log-ratio vs logTVL, winsor [0.01, 3], cap mult 1.0
function curveFp(): Fp {
  return (tr, te) => {
    const x = tr.map((i) => yTvl[i]), yy = tr.map((i) => yMult[i]);
    const m = olsFit(x.map((v) => [v]), yy);
    const pred = ridgePred(m, te.map((i) => [yTvl[i]]));
    return pred.map((v, k) => {
      const ratio = Math.pow(10, v);
      const wr = Math.min(3, Math.max(0.01, ratio));
      return log10(Math.min(wr, 1.0) * (traded[te[k]].tvl_usd as number));
    });
  };
}
// wiliamkesh full (D-52): curve value * (0.75 + 0.25 * mat * growth),
// where mat = 0.6 + 0.4*min(age_days,1095)/1095 and growth = 1 + clamp(g7)/100 * w.
function fullCurveFp(): Fp {
  const matMult = (p: Proto): number => 0.6 + (Math.min(ageDays(p), 1095) / 1095) * 0.4;
  const growthMult = (p: Proto): number => {
    const g7 = p.change_7d ?? 0;
    return 1 + (Math.max(-60, Math.min(120, g7)) / 100) * (g7 < 0 ? 0.9 : 0.6);
  };
  const base = curveFp();
  return (tr, te) => {
    const pred = base(tr, te);
    return te.map((i, k) => {
      const ratio = Math.pow(10, pred[k] - yTvl[i]);
      const mult2 = Math.min(ratio * (0.75 + 0.25 * matMult(traded[i]) * growthMult(traded[i])), 1.0);
      return log10(mult2 * (traded[i].tvl_usd as number));
    });
  };
}
// curve+mat and curve+growth variants (D-52 table)
function curveVarFp(kind: 'mat' | 'growth'): Fp {
  const matMult = (p: Proto): number => 0.6 + (Math.min(ageDays(p), 1095) / 1095) * 0.4;
  const growthMult = (p: Proto): number => {
    const g7 = p.change_7d ?? 0;
    return 1 + (Math.max(-60, Math.min(120, g7)) / 100) * (g7 < 0 ? 0.9 : 0.6);
  };
  const base = curveFp();
  return (tr, te) => {
    const pred = base(tr, te);
    return te.map((i, k) => {
      const ratio = Math.pow(10, pred[k] - yTvl[i]);
      const f = kind === 'mat' ? matMult(traded[i]) : growthMult(traded[i]);
      const mult2 = Math.min(ratio * (0.75 + 0.25 * f), 1.0);
      return log10(mult2 * (traded[i].tvl_usd as number));
    });
  };
}
// multiplier variants on A lam30 (D-31/D-32/D-26)
function multFp(multFn: (p: Proto) => number): Fp {
  const base = ridgeFp(30);
  return (tr, te) => {
    const pred = base(tr, te);
    return pred.map((v, k) => v + log10(multFn(traded[te[k]])));
  };
}
const sqrtMat = (p: Proto): number => 0.55 + 0.45 * Math.sqrt(Math.min(ageDays(p), 1460) / 1460);
const linMat = (p: Proto): number => 0.6 + 0.4 * (Math.min(ageDays(p), 1095) / 1095);
const asymGrowth = (p: Proto): number => {
  const g7 = p.change_7d ?? 0;
  const w = g7 < 0 ? 0.9 : 0.6;
  return 1 + (Math.max(-60, Math.min(120, g7)) / 100) * w;
};
const comboMatGrowth = (p: Proto): number => sqrtMat(p) * asymGrowth(p);

// D-24: OLS + category shift (median residual per category, shrink n/(n+k))
function catShiftFp(k: number): Fp {
  return (tr, te) => {
    const m = olsFit(tr.map((i) => [yTvl[i]]), tr.map((i) => y[i]));
    const res = tr.map((i) => y[i] - ridgePred(m, [[yTvl[i]]])[0]);
    const byCat: Record<string, number[]> = {};
    tr.forEach((i, j) => {
      const c = traded[i].category ?? 'none';
      (byCat[c] ??= []).push(res[j]);
    });
    const shift: Record<string, number> = {};
    for (const c of Object.keys(byCat)) {
      const r = byCat[c];
      shift[c] = median(r) * (r.length / (r.length + k));
    }
    return te.map((i) => ridgePred(m, [[yTvl[i]]])[0] + (shift[traded[i].category ?? 'none'] ?? 0));
  };
}
// D-25: joni024 likelihood prior x A (fixed per-category factors, held-out
// via the same multiplier fit): vault/curator 0.8, chain/staking 0.9,
// uncategorised 0.7, else 1.0.
function priorLikelihood(p: Proto): number {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('vault') || c.includes('curator')) return 0.8;
  if (c.includes('chain') || c.includes('stak')) return 0.9;
  if (!c || c === 'none') return 0.7;
  return 1.0;
}
// ablation feature sets
function featsVar(p: Proto, kind: string, rng?: () => number): number[] {
  const lt = log10(p.tvl_usd as number);
  const g = (p.change_7d ?? 0) / 100;
  const cats = TOPCATS.map((c) => (p.category === c ? 1 : 0));
  const age = log10(ageYears(p) ?? medAge);
  const nch = log10(p.chains.length);
  switch (kind) {
    case 'size': return [lt];
    case 'size+cat': return [lt, ...cats];
    case 'size+cat+growth': return [lt, g, ...cats];
    case 'size+cat+growth+age': return [lt, g, ...cats, age];
    case 'size+cat+growth+chains': return [lt, g, ...cats, nch];
    case 'size+cat+growth+age+chains': return [lt, g, ...cats, age, nch];
    case 'placebo': return [lt, g, ...cats, (rng as () => number)()];
    default: return [lt, g, ...cats];
  }
}
function ablateFp(kind: string, seed: number): Fp {
  if (kind === 'signflip') {
    // Genuine control: fit A, then negate the growth INPUT at prediction
    // time only (no refit) — tests whether the fitted growth sign carries
    // signal. (Negating the feature before fitting is vacuous: ridge
    // re-fits the coefficient and the predictions are identical.)
    return (tr, te) => {
      const m = ridgeFit(tr.map((i) => Xtraded[i]), tr.map((i) => y[i]), 30);
      const Xneg = (idx: number[]): number[] => {
        const f = feats(traded[idx]);
        return [f[0], -f[1], ...f.slice(2)];
      };
      return ridgePred(m, te.map(Xneg));
    };
  }
  return (tr, te) => {
    const rng = mulberry32(seed);
    const gauss = makeGauss(rng);
    const X = (idx: number[]): number[] => featsVar(traded[idx], kind, kind === 'placebo' ? () => gauss() : undefined);
    const m = ridgeFit(tr.map(X), tr.map((i) => y[i]), 30);
    return ridgePred(m, te.map(X));
  };
}

// ---------------- run model comparisons ----------------
const modelA = reportModel('A lam30', ridgeFp(30));
const modelB = reportModel('B lam3', ridgeFp(3, 'mult'));
const modelC = reportModel('C pow exp0.45', powFp(0.45, 1.0));
const modelFlat = reportModel('Flat (median)', flatFp);
const ablations: Record<string, { medLOO: number; meanLOO: number; medWF: number; meanWF: number }> = {};
for (const kind of ['size', 'size+cat', 'size+cat+growth', 'size+cat+growth+age', 'size+cat+growth+chains', 'size+cat+growth+age+chains', 'placebo', 'signflip']) {
  const r = reportModel(kind, ablateFp(kind, 12345));
  ablations[kind] = { medLOO: r.medLOO, meanLOO: r.meanLOO, medWF: r.medWF, meanWF: r.meanWF };
}
const modelSqrtMat = reportModel('A x sqrt-maturity', multFp(sqrtMat));
const modelLinMat = reportModel('A x linear-maturity', multFp(linMat));
const modelCombo = reportModel('A x sqrt-mat x asym-growth', multFp(comboMatGrowth));
const modelAsym = reportModel('A x asym-growth', multFp(asymGrowth));
const modelCurve = reportModel('curve-only', curveFp());
const modelFullCurve = reportModel('curve+growth+maturity', fullCurveFp());
const modelCat3 = reportModel('OLS+cat-shift k=3', catShiftFp(3));
const modelCat8 = reportModel('OLS+cat-shift k=8', catShiftFp(8));
const modelPrior = reportModel('prior x A', multFp(priorLikelihood));
const modelCurveMat = reportModel('curve+mat', curveVarFp('mat'));
const modelCurveGrowth = reportModel('curve+growth', curveVarFp('growth'));

// ---------------- odds ensemble (50% rich logistic + 30% empirical + 20% base) ----------------
function ageBand(p: Proto): string {
  const a = ageYears(p);
  if (a === null) return 'unknown';
  if (a < 0.25) return '<90d';
  if (a < 1) return '90d-1y';
  if (a < 2) return '1-2y';
  return '>2y';
}
function pctInCat(p: Proto): number {
  const same = protos.filter((q) => (q.category ?? 'none') === (p.category ?? 'none')).map((q) => q.tvl_usd ?? 0).sort((a, b) => a - b);
  const idx = same.indexOf(p.tvl_usd ?? 0);
  return idx / Math.max(same.length - 1, 1);
}
function oddsFeats(p: Proto): number[] {
  const age = ageYears(p) ?? medAge;
  const lt = log10(p.tvl_usd ?? 1);
  const la = log10(age);
  return [lt, la, (p.change_7d ?? 0) / 100, log10(p.chains.length), la * lt, pctInCat(p),
    ...TOPCATS.map((c) => (p.category === c ? 1 : 0))];
}
const hasToken = (p: Proto): number => (p.gecko_id || p.symbol ? 1 : 0);
function empirPred(tr: Proto[], te: Proto[]): number[] {
  // shrink toward the GLOBAL base rate (all 758), not the train base rate —
  // the research protocol (test-final-combos.py empir_pred).
  const base = baseRateGlobal;
  const catBand: Record<string, { n: number; s: number }> = {};
  const band: Record<string, { n: number; s: number }> = {};
  for (const p of tr) {
    const b = ageBand(p), c = p.category ?? 'none', yy = hasToken(p);
    const k = b + '|' + c;
    (catBand[k] ??= { n: 0, s: 0 }).n++; catBand[k].s += yy;
    (band[b] ??= { n: 0, s: 0 }).n++; band[b].s += yy;
  }
  const shrinkEmp = (prob: number, n: number, baseR: number, k = 10): number => (n * prob + k * baseR) / (n + k);
  return te.map((p) => {
    const b = ageBand(p), c = p.category ?? 'none', k = b + '|' + c;
    if (catBand[k] && catBand[k].n >= 5) return shrinkEmp(catBand[k].s / catBand[k].n, catBand[k].n, base);
    if (band[b] && band[b].n >= 5) return shrinkEmp(band[b].s / band[b].n, band[b].n, base);
    return base;
  });
}
// walk-forward odds validation on all 758 ordered by listed_at
const allIdx = protos.map((_, i) => i).sort((a, b) => {
  const la = protos[a].listed_at ?? '9999', lb = protos[b].listed_at ?? '9999';
  return la === lb ? a - b : la < lb ? -1 : 1;
});
const brier = (pr: number[], yt: number[]): number => mean(pr.map((p, i) => (p - yt[i]) * (p - yt[i])));
function wfOdds(): { cuts: { brier: number; brierLogit: number; base: number; calledRight: number; calledRightLogit: number; tiers: number[]; n: number }[] } {
  const cuts: { brier: number; brierLogit: number; base: number; calledRight: number; calledRightLogit: number; tiers: number[]; n: number }[] = [];
  for (const f of [0.4, 0.5, 0.67]) {
    const k = Math.floor(protos.length * f);
    const tr = allIdx.slice(0, k).map((i) => protos[i]);
    const te = allIdx.slice(k).map((i) => protos[i]);
    const yt = te.map(hasToken);
    const m = logitFitStd(tr.map(oddsFeats), tr.map(hasToken), 1.0, muOdds, sdOdds);
    const pl = logitPred(m, te.map(oddsFeats));
    const pe = empirPred(tr, te);
    // ensemble third component is the GLOBAL base rate (research protocol),
    // not the train base rate.
    const p = pl.map((v, i) => 0.5 * v + 0.3 * pe[i] + 0.2 * baseRateGlobal);
    const baseBrier = mean(yt) * (1 - mean(yt));
    const hi = [quantile(p, 1 / 3), quantile(p, 2 / 3)];
    const tiers = [0, 1, 2].map((t) => {
      const idxs = p.map((v, i) => (v <= hi[0] ? 0 : v <= hi[1] ? 1 : 2) === t ? i : -1).filter((i) => i >= 0);
      return idxs.length ? mean(idxs.map((i) => yt[i])) : 0;
    });
    cuts.push({
      brier: brier(p, yt), brierLogit: brier(pl, yt), base: baseBrier,
      calledRight: mean(p.map((v, i) => ((v >= 0.5 ? 1 : 0) === yt[i] ? 1 : 0))),
      calledRightLogit: mean(pl.map((v, i) => ((v >= 0.5 ? 1 : 0) === yt[i] ? 1 : 0))),
      tiers, n: te.length,
    });
  }
  return { cuts };
}
// global base rate (all 758) — used by the empirical odds shrink and the ensemble
const baseRateGlobal = mean(protos.map(hasToken));
// global standardization constants for the rich-logit features (over all 758),
// used by every logit fit (WF folds and full fit) — the research protocol.
const oddsXAll = protos.map(oddsFeats);
const muOdds = oddsXAll[0].map((_, j) => mean(oddsXAll.map((r) => r[j])));
const sdOdds = oddsXAll[0].map((_, j) => { const s = stdPop(oddsXAll.map((r) => r[j])); return s === 0 ? 1 : s; });
const oddsWF = wfOdds();
// final odds on all 758 (global standardization constants, as in the research)
const logitAll = logitFitStd(protos.map(oddsFeats), protos.map(hasToken), 1.0, muOdds, sdOdds);
const oddsEligLogit = logitPred(logitAll, elig.map(oddsFeats));
const oddsEligEmp = empirPred(protos, elig);
const baseRate = mean(protos.map(hasToken));
const oddsElig = oddsEligLogit.map((v, i) => 0.5 * v + 0.3 * oddsEligEmp[i] + 0.2 * baseRate);
// tiers on eligible: terciles of odds
const oddsQ = [quantile(oddsElig, 1 / 3), quantile(oddsElig, 2 / 3)];
const tierOf = (o: number): 'LOW' | 'MED' | 'HIGH' => (o <= oddsQ[0] ? 'LOW' : o <= oddsQ[1] ? 'MED' : 'HIGH');
// WF tier actuals pooled across cuts (HIGH/MED/LOW actual token rates)
const tierActuals = [0, 1, 2].map((t) => mean(oddsWF.cuts.map((c) => c.tiers[t])));

// ---------------- ranges: widening-factor re-search (WF cuts 0.5/0.67, model A) ----------------
function rangeSearch(): { kIn: number; kOut: number; covIn: number; covOut: number; covInCuts: number[]; covOutCuts: number[]; q50: number; q80: number } {
  const cuts = [0.5, 0.67].map((f) => {
    const k = Math.floor(traded.length * f);
    return [listedIdx.slice(0, k), listedIdx.slice(k)] as [number[], number[]];
  });
  const pick = (target: number, q: number): { k: number; cov: number; covCuts: number[] } => {
    let best = { k: 1.0, cov: 0, covCuts: [0, 0] };
    let bestDiff = 1e9;
    for (let ki = 0; ki <= 10; ki++) {
      const k = 1.0 + ki * 0.1;
      const covCuts = cuts.map(([tr, te]) => {
        const m = ridgeFit(tr.map((i) => Xtraded[i]), tr.map((i) => y[i]), 30);
        const resTr = tr.map((i) => Math.abs(ridgePred(m, [Xtraded[i]])[0] - y[i]));
        const hw = k * quantile(resTr, q);
        const predTe = ridgePred(m, te.map((i) => Xtraded[i]));
        const cov = mean(te.map((idx, t) => (Math.abs(predTe[t] - y[idx]) <= hw ? 1 : 0)));
        return cov;
      });
      const cov = mean(covCuts);
      const diff = Math.abs(cov - target);
      // on an exact tie, take the WIDER band (larger k) — more conservative
      if (diff < bestDiff - 1e-12 || (Math.abs(diff - bestDiff) < 1e-12 && k > best.k)) {
        bestDiff = diff; best = { k, cov, covCuts };
      }
    }
    return best;
  };
  const inR = pick(0.5, 0.5), outR = pick(0.8, 0.8);
  // full-fit train quantiles for the board ranges
  const mAll = ridgeFit(Xtraded, y, 30);
  const resAll = traded.map((_, i) => Math.abs(ridgePred(mAll, [Xtraded[i]])[0] - y[i]));
  return { kIn: inR.k, kOut: outR.k, covIn: inR.cov, covOut: outR.cov, covInCuts: inR.covCuts, covOutCuts: outR.covCuts, q50: quantile(resAll, 0.5), q80: quantile(resAll, 0.8) };
}
const rangeRes = rangeSearch();
const hwIn = rangeRes.kIn * rangeRes.q50;
const hwOut = rangeRes.kOut * rangeRes.q80;
// D-01 clean-cut (train oldest 67%, test newest 31)
function cleanCut(): {
  covIn: number; covOut: number; byTvl: { inner: number[]; outer: number[]; medErr: number[] };
  medErrLow: number; medErrHigh: number; n: number;
} {
  const tr = listedIdx.slice(0, 61), te = listedIdx.slice(61);
  const m = ridgeFit(tr.map((i) => Xtraded[i]), tr.map((i) => y[i]), 30);
  const resTr = tr.map((i) => Math.abs(ridgePred(m, [Xtraded[i]])[0] - y[i]));
  const q50 = quantile(resTr, 0.5), q80 = quantile(resTr, 0.8);
  const predTe = ridgePred(m, te.map((i) => Xtraded[i]));
  const errs = te.map((idx, t) => predTe[t] - y[idx]);
  const covIn = mean(errs.map((e) => (Math.abs(e) <= 1.5 * q50 ? 1 : 0)));
  const covOut = mean(errs.map((e) => (Math.abs(e) <= 1.6 * q80 ? 1 : 0)));
  const ltTe = te.map((i) => yTvl[i]);
  const b1 = quantile(ltTe, 1 / 3), b2 = quantile(ltTe, 2 / 3);
  // np.digitize semantics: v < b1 -> 0, b1 <= v < b2 -> 1, v >= b2 -> 2
  // (quantile bounds land exactly on data points here, so <= vs < matters)
  const terc = (v: number): number => (v < b1 ? 0 : v < b2 ? 1 : 2);
  const inner: number[] = [], outer: number[] = [], medErr: number[] = [];
  for (let t = 0; t < 3; t++) {
    const idxs = ltTe.map((v, i) => (terc(v) === t ? i : -1)).filter((i) => i >= 0);
    inner.push(mean(idxs.map((i) => (Math.abs(errs[i]) <= 1.5 * q50 ? 1 : 0))));
    outer.push(mean(idxs.map((i) => (Math.abs(errs[i]) <= 1.6 * q80 ? 1 : 0))));
    medErr.push(medX(idxs.map((i) => errs[i])));
  }
  return { covIn, covOut, byTvl: { inner, outer, medErr }, medErrLow: medErr[0], medErrHigh: medErr[2], n: te.length };
}
const cleanCutRes = cleanCut();
// D-02 single time-split
function timeSplit(frac: number): { med: number; mean: number } {
  const k = Math.floor(traded.length * frac);
  const tr = listedIdx.slice(0, k), te = listedIdx.slice(k);
  const m = ridgeFit(tr.map((i) => Xtraded[i]), tr.map((i) => y[i]), 30);
  const pred = ridgePred(m, te.map((i) => Xtraded[i]));
  const errs = te.map((idx, t) => pred[t] - y[idx]);
  return { med: medX(errs), mean: meanX(errs) };
}
const timeSplit50 = timeSplit(0.5);
const timeSplit67 = timeSplit(0.67);
// D-45 jackknife+
function jackknifePlus(): { covIn: number; covOut: number; widthIn: number; widthOut: number; n: number } {
  const tr = listedIdx.slice(0, 61), te = listedIdx.slice(61);
  const preds: number[][] = [];
  const resids: number[] = [];
  for (const held of tr) {
    const tr2 = tr.filter((i) => i !== held);
    const m = ridgeFit(tr2.map((i) => Xtraded[i]), tr2.map((i) => y[i]), 30);
    preds.push(ridgePred(m, te.map((i) => Xtraded[i])));
    resids.push(Math.abs(ridgePred(m, [Xtraded[held]])[0] - y[held]));
  }
  const lo25: number[] = [], hi75: number[] = [], lo10: number[] = [], hi90: number[] = [];
  for (let t = 0; t < te.length; t++) {
    const P = preds.map((pr) => pr[t]);
    lo25.push(quantile(P.map((v, j) => v - resids[j]), 0.25));
    hi75.push(quantile(P.map((v, j) => v + resids[j]), 0.75));
    lo10.push(quantile(P.map((v, j) => v - resids[j]), 0.10));
    hi90.push(quantile(P.map((v, j) => v + resids[j]), 0.90));
  }
  const covIn = mean(te.map((idx, t) => (y[idx] >= lo25[t] && y[idx] <= hi75[t] ? 1 : 0)));
  const covOut = mean(te.map((idx, t) => (y[idx] >= lo10[t] && y[idx] <= hi90[t] ? 1 : 0)));
  const widthIn = median(hi75.map((v, t) => Math.pow(10, (v - lo25[t]) / 2)));
  const widthOut = median(hi90.map((v, t) => Math.pow(10, (v - lo10[t]) / 2)));
  return { covIn, covOut, widthIn, widthOut, n: te.length };
}
const jkPlus = jackknifePlus();
// D-42/D-43 pool B (n=40, disjoint from the cut-3 test): band40 = listed
// rows 36..61 under a model trained on the oldest 36; band50 = rows 46..61
// under a model trained on the oldest 46. (Rows 46..61 appear in both,
// under different models — that is the research protocol.)
function poolB(): { res: number[]; lt: number[]; growth: number[]; names: string[]; ages: number[]; logChains: number[] } {
  const res: number[] = [], lt: number[] = [], growth: number[] = [], names: string[] = [], ages: number[] = [], logChains: number[] = [];
  const bands: [number[], number[]][] = [
    [listedIdx.slice(0, 36), listedIdx.slice(36, 61)],
    [listedIdx.slice(0, 46), listedIdx.slice(46, 61)],
  ];
  for (const [tr, te] of bands) {
    const m = ridgeFit(tr.map((i) => Xtraded[i]), tr.map((i) => y[i]), 30);
    const pred = ridgePred(m, te.map((i) => Xtraded[i]));
    te.forEach((idx, t) => {
      res.push(pred[t] - y[idx]);
      lt.push(yTvl[idx]);
      growth.push((traded[idx].change_7d ?? 0) / 100);
      names.push(traded[idx].name);
      ages.push(ageYears(traded[idx]) ?? medAge);
      logChains.push(log10(traded[idx].chains.length + 1));
    });
  }
  return { res, lt, growth, names, ages, logChains };
}
const poolBRes = poolB();
// shared cut-3 test (model trained on oldest 67%, test newest 31)
const m67 = ridgeFit(listedIdx.slice(0, 61).map((i) => Xtraded[i]), listedIdx.slice(0, 61).map((i) => y[i]), 30);
const te31 = listedIdx.slice(61);
const err67 = ridgePred(m67, te31.map((i) => Xtraded[i])).map((v, t) => v - y[te31[t]]);
const ltTe31 = te31.map((i) => yTvl[i]);
const bTe31 = [quantile(ltTe31, 1 / 3), quantile(ltTe31, 2 / 3)];
const tercileId = (v: number, b: number[]): number => (v < b[0] ? 0 : v < b[1] ? 1 : 2);
function mondrian(): { covIn0: number; covOut0: number; covIn05: number; covOut05: number; n: number; byTercileIn0: number[]; byTercileOut0: number[]; widthIn0: number; widthOut0: number } {
  const calLt = poolBRes.lt;
  const bCal = [quantile(calLt, 1 / 3), quantile(calLt, 2 / 3)];
  const grp = (v: number): number => tercileId(v, bCal);
  const absRes = poolBRes.res.map(Math.abs);
  const qCorr = (vals: number[], level: number): number => {
    const s = [...vals].sort((a, b) => a - b);
    const n = s.length;
    const k = Math.min(n, Math.max(1, Math.ceil((n + 1) * level)));
    return s[k - 1];
  };
  const gq: Record<number, { q50: number; q80: number }> = {};
  for (let g = 0; g < 3; g++) {
    const vals = absRes.filter((_, i) => grp(calLt[i]) === g);
    gq[g] = { q50: qCorr(vals, 0.5), q80: qCorr(vals, 0.8) };
  }
  const gqAll = { q50: qCorr(absRes, 0.5), q80: qCorr(absRes, 0.8) };
  // cut-3 test (shared m67 / err67)
  const errs = err67, te = te31;
  const cov = (shrink: number): { inner: number; outer: number; byIn: number[]; byOut: number[]; wIn: number; wOut: number } => {
    const hwIn = errs.map((_, t) => (1 - shrink) * gq[grp(yTvl[te[t]])].q50 + shrink * gqAll.q50);
    const hwOut = errs.map((_, t) => (1 - shrink) * gq[grp(yTvl[te[t]])].q80 + shrink * gqAll.q80);
    const inner = mean(errs.map((e, t) => (Math.abs(e) <= hwIn[t] ? 1 : 0)));
    const outer = mean(errs.map((e, t) => (Math.abs(e) <= hwOut[t] ? 1 : 0)));
    const byIn = [0, 1, 2].map((g) => {
      const idxs = errs.map((_, t) => (tercileId(yTvl[te[t]], bTe31) === g ? t : -1)).filter((t) => t >= 0);
      return idxs.length ? mean(idxs.map((t) => (Math.abs(errs[t]) <= hwIn[t] ? 1 : 0))) : 0;
    });
    const byOut = [0, 1, 2].map((g) => {
      const idxs = errs.map((_, t) => (tercileId(yTvl[te[t]], bTe31) === g ? t : -1)).filter((t) => t >= 0);
      return idxs.length ? mean(idxs.map((t) => (Math.abs(errs[t]) <= hwOut[t] ? 1 : 0))) : 0;
    });
    return { inner, outer, byIn, byOut, wIn: median(hwIn.map((h) => Math.pow(10, h))), wOut: median(hwOut.map((h) => Math.pow(10, h))) };
  };
  const c0 = cov(0), c05 = cov(0.5);
  return { covIn0: c0.inner, covOut0: c0.outer, covIn05: c05.inner, covOut05: c05.outer, n: te.length, byTercileIn0: c0.byIn, byTercileOut0: c0.byOut, widthIn0: c0.wIn, widthOut0: c0.wOut };
}
const mondrianRes = mondrian();
// D-43 / T3 normalized score: does |resid| depend on any feature? (pool B n=40)
// Strongest feature by |Spearman|; if >= 0.20, fit sigma(x) by OLS and report
// the normalized band's coverage on the clean cut-3 test.
const d43 = (() => {
  const absRes = poolBRes.res.map(Math.abs);
  const qCorr = (vals: number[], level: number): number => {
    const s = [...vals].sort((a, b) => a - b);
    const n = s.length;
    const k = Math.min(n, Math.max(1, Math.ceil((n + 1) * level)));
    return s[k - 1];
  };
  const featsCal: Record<string, number[]> = {
    logTVL: poolBRes.lt,
    age_yrs: poolBRes.ages,
    log_chains: poolBRes.logChains,
    growth: poolBRes.growth,
  };
  const cors: Record<string, { pearson: number; spearman: number }> = {};
  for (const k of Object.keys(featsCal)) {
    cors[k] = { pearson: pearson(featsCal[k], absRes), spearman: spearman(featsCal[k], absRes) };
  }
  let best = { key: '', spearman: 0 };
  for (const k of Object.keys(cors)) if (Math.abs(cors[k].spearman) > Math.abs(best.spearman)) best = { key: k, spearman: cors[k].spearman };
  const maxIdx = absRes.indexOf(Math.max(...absRes));
  const out: {
    cors: Record<string, { pearson: number; spearman: number }>;
    strongest: string; strongestSpearman: number; outlier: string; n: number;
    a: number; b: number; q50n: number; q80n: number;
    covIn: number; covOut: number; widthIn: number; widthOut: number; byTercileIn: number[]; byTercileOut: number[];
  } = {
    cors, strongest: best.key, strongestSpearman: best.spearman, outlier: poolBRes.names[maxIdx], n: absRes.length,
    a: 0, b: 0, q50n: 0, q80n: 0, covIn: 0, covOut: 0, widthIn: 0, widthOut: 0, byTercileIn: [], byTercileOut: [],
  };
  if (Math.abs(best.spearman) >= 0.20) {
    const z = featsCal[best.key];
    const mz = mean(z), mr = mean(absRes);
    let sxy = 0, sx = 0;
    for (let i = 0; i < z.length; i++) { sxy += (z[i] - mz) * (absRes[i] - mr); sx += (z[i] - mz) ** 2; }
    const b = sxy / sx, a = mr - b * mz;
    const sigmaCal = z.map((v) => Math.max(a + b * v, 0.05));
    const sNorm = absRes.map((v, i) => v / sigmaCal[i]);
    const q50n = qCorr(sNorm, 0.5), q80n = qCorr(sNorm, 0.8);
    const zTe = best.key === 'logTVL' ? ltTe31
      : best.key === 'age_yrs' ? te31.map((i) => ageYears(traded[i]) ?? medAge)
      : best.key === 'log_chains' ? te31.map((i) => log10(traded[i].chains.length + 1))
      : te31.map((i) => (traded[i].change_7d ?? 0) / 100);
    const sigmaTe = zTe.map((v) => Math.max(a + b * v, 0.05));
    const hwIn = sigmaTe.map((s) => q50n * s);
    const hwOut = sigmaTe.map((s) => q80n * s);
    const covIn = mean(err67.map((e, t) => (Math.abs(e) <= hwIn[t] ? 1 : 0)));
    const covOut = mean(err67.map((e, t) => (Math.abs(e) <= hwOut[t] ? 1 : 0)));
    const byIn = [0, 1, 2].map((g) => {
      const idxs = err67.map((_, t) => (tercileId(ltTe31[t], bTe31) === g ? t : -1)).filter((t) => t >= 0);
      return idxs.length ? mean(idxs.map((t) => (Math.abs(err67[t]) <= hwIn[t] ? 1 : 0))) : 0;
    });
    const byOut = [0, 1, 2].map((g) => {
      const idxs = err67.map((_, t) => (tercileId(ltTe31[t], bTe31) === g ? t : -1)).filter((t) => t >= 0);
      return idxs.length ? mean(idxs.map((t) => (Math.abs(err67[t]) <= hwOut[t] ? 1 : 0))) : 0;
    });
    out.a = a; out.b = b; out.q50n = q50n; out.q80n = q80n;
    out.covIn = covIn; out.covOut = covOut;
    out.widthIn = median(hwIn.map((h) => Math.pow(10, h)));
    out.widthOut = median(hwOut.map((h) => Math.pow(10, h)));
    out.byTercileIn = byIn; out.byTercileOut = byOut;
  }
  return out;
})();
// D-46 CQR-lite (T6): pinball ridge quantiles trained on the oldest 40%
// (n=36), calibrated on band40 (n=25), tested on cut-3 (n=31).
// Two tau pairs: (0.25,0.75) inner and (0.10,0.90) outer. Gate: train fracs
// within +/-0.15 of tau, else no coverage is claimed for that band.
function cqrLite(): {
  inner: { ok: boolean; fracLo: number; fracHi: number; Q: number; cov: number; width: number };
  outer: { ok: boolean; fracLo: number; fracHi: number; Q: number; cov: number; width: number };
  verdict: string;
} {
  const tr40 = listedIdx.slice(0, 36);
  const band40 = listedIdx.slice(36, 61);
  const X40 = tr40.map((i) => Xtraded[i]), y40 = tr40.map((i) => y[i]);
  const qCorr = (vals: number[], level: number): number => {
    const s = [...vals].sort((a, b) => a - b);
    const n = s.length;
    const k = Math.min(n, Math.max(1, Math.ceil((n + 1) * level)));
    return s[k - 1];
  };
  const pinballFit = (X: number[][], yy: number[], tau: number): { b: number[]; mu: number[]; sd: number[] } => {
    const mu = X[0].map((_, j) => mean(X.map((r) => r[j])));
    const sd = X[0].map((_, j) => { const s = stdPop(X.map((r) => r[j])); return s === 0 ? 1 : s; });
    const Xs = X.map((r) => [1, ...r.map((v, j) => (v - mu[j]) / sd[j])]);
    const mRidge = ridgeFit(X, yy, 30);
    const b = [...mRidge.b];
    const res = yy.map((v, i) => v - Xs[i].reduce((s, vv, j) => s + vv * mRidge.b[j], 0));
    b[0] = mRidge.b[0] + quantile(res, tau);
    const lamPen = 0.5;
    for (let t = 0; t < 4000; t++) {
      const lr = 0.05 / (1 + t / 500);
      const g = new Array<number>(b.length).fill(0);
      for (let i = 0; i < Xs.length; i++) {
        const pred = Xs[i].reduce((s, v, j) => s + v * b[j], 0);
        const r = yy[i] - pred;
        const w = r > 0 ? tau : tau - 1;
        for (let j = 0; j < b.length; j++) g[j] += -(Xs[i][j] * w) / Xs.length;
      }
      for (let j = 1; j < b.length; j++) g[j] += 2 * lamPen * b[j];
      for (let j = 0; j < b.length; j++) b[j] -= lr * g[j];
    }
    return { b, mu, sd };
  };
  const pinballPred = (m: { b: number[]; mu: number[]; sd: number[] }, X: number[][]): number[] =>
    X.map((r) => {
      let s = m.b[0];
      for (let j = 0; j < r.length; j++) s += m.b[j + 1] * ((r[j] - m.mu[j]) / m.sd[j]);
      return s;
    });
  const run = (taus: [number, number], alpha: number): { ok: boolean; fracLo: number; fracHi: number; Q: number; cov: number; width: number } => {
    const mLo = pinballFit(X40, y40, taus[0]);
    const mHi = pinballFit(X40, y40, taus[1]);
    const trLo = pinballPred(mLo, X40), trHi = pinballPred(mHi, X40);
    const fracLo = mean(y40.map((v, i) => (v <= trLo[i] ? 1 : 0)));
    const fracHi = mean(y40.map((v, i) => (v <= trHi[i] ? 1 : 0)));
    const ok = Math.abs(fracLo - taus[0]) <= 0.15 && Math.abs(fracHi - taus[1]) <= 0.15;
    if (!ok) return { ok, fracLo, fracHi, Q: 0, cov: 0, width: 0 };
    const E = band40.map((idx) => Math.max(
      pinballPred(mLo, [Xtraded[idx]])[0] - y[idx],
      y[idx] - pinballPred(mHi, [Xtraded[idx]])[0],
    ));
    const Q = qCorr(E, 1 - alpha);
    const lo = pinballPred(mLo, te31.map((i) => Xtraded[i])).map((v) => v - Q);
    const hi = pinballPred(mHi, te31.map((i) => Xtraded[i])).map((v) => v + Q);
    const cov = mean(te31.map((idx, t) => (y[idx] >= lo[t] && y[idx] <= hi[t] ? 1 : 0)));
    const width = median(hi.map((v, t) => Math.pow(10, (v - lo[t]) / 2)));
    return { ok, fracLo, fracHi, Q, cov, width };
  };
  const inner = run([0.25, 0.75], 0.5);
  const outer = run([0.1, 0.9], 0.2);
  return { inner, outer, verdict: inner.ok && outer.ok ? 'usable' : 'NOT RELIABLE at n=36 — do not adopt' };
}
const cqrRes = cqrLite();

// ---------------- D-05 growth vs multiple + D-06/D-12 R2 & random-feature ----------------
const d05 = (() => {
  const mults = traded.map((p) => log10((p.mcap_usd as number) / (p.tvl_usd as number)));
  const g = traded.map((p) => p.change_7d ?? 0);
  const mAll = ridgeFit(Xtraded, y, 30);
  return {
    pearson: pearson(g, mults),
    spearman: spearman(g, mults),
    stdGrowthCoef: mAll.b[2], // standardized coefficient on the growth feature
  };
})();
function looPreds(fp: Fp): number[] {
  const out = new Array<number>(traded.length);
  for (let i = 0; i < traded.length; i++) {
    const tr = traded.map((_, j) => j).filter((j) => j !== i);
    out[i] = fp(tr, [i])[0];
  }
  return out;
}
const spearmanLooA = spearman(looPreds(ridgeFp(30)), y);
const spearmanLooB = spearman(looPreds(ridgeFp(3, 'mult')), y);
function r2Suite(): { r2A: number; r2Flat: number; r2Rand: number[]; folds: number[][] } {
  const rng = mulberry32(0);
  const idx = shuffleSeeded(traded.map((_, i) => i), rng);
  const folds: number[][] = [];
  const base = Math.floor(92 / 5), rem = 92 % 5;
  let off = 0;
  for (let k = 0; k < 5; k++) {
    const sz = base + (k < rem ? 1 : 0);
    folds.push(idx.slice(off, off + sz));
    off += sz;
  }
  const r2Of = (predFn: (tr: number[], te: number[]) => number[]): number => {
    const oof = new Array<number>(92).fill(0);
    for (let k = 0; k < 5; k++) {
      const te = folds[k];
      const tr = folds.flatMap((f, j) => (j === k ? [] : f));
      const pr = predFn(tr, te);
      te.forEach((idx, t) => { oof[idx] = pr[t]; });
    }
    const ssRes = sum(y.map((v, i) => (v - oof[i]) ** 2));
    const ssTot = sum(y.map((v) => (v - mean(y)) ** 2));
    return 1 - ssRes / ssTot;
  };
  const r2A = r2Of((tr, te) => {
    const m = ridgeFit(tr.map((i) => Xtraded[i]), tr.map((i) => y[i]), 30);
    return ridgePred(m, te.map((i) => Xtraded[i]));
  });
  const r2Flat = r2Of((tr, te) => te.map(() => median(tr.map((i) => y[i]))));
  const r2Rand: number[] = [];
  for (let t = 0; t < 3; t++) {
    const rr = mulberry32(100 + t);
    const gauss = makeGauss(rr);
    const Xr = traded.map(() => Array.from({ length: 7 }, () => gauss()));
    r2Rand.push(r2Of((tr, te) => {
      const m = ridgeFit(tr.map((i) => Xr[i]), tr.map((i) => y[i]), 30);
      return ridgePred(m, te.map((i) => Xr[i]));
    }));
  }
  return { r2A, r2Flat, r2Rand, folds };
}
const r2Res = r2Suite();
// inner-LOO lambda table (per WF cut train fold)
function innerLooLambda(): { cut: string; rows: { lam: number; med: number }[] }[] {
  const out: { cut: string; rows: { lam: number; med: number }[] }[] = [];
  const labels = ['40/60', '50/50', '67/33'];
  wfCuts(traded.length).forEach(([tr], ci) => {
    const rows: { lam: number; med: number }[] = [];
    for (const lam of [1, 3, 10, 30, 100, 300]) {
      const errs: number[] = [];
      for (const held of tr) {
        const tr2 = tr.filter((i) => i !== held);
        const m = ridgeFit(tr2.map((i) => Xtraded[i]), tr2.map((i) => y[i]), lam);
        errs.push(ridgePred(m, [Xtraded[held]])[0] - y[held]);
      }
      rows.push({ lam, med: medX(errs) });
    }
    out.push({ cut: labels[ci], rows });
  });
  return out;
}
const innerLoo = innerLooLambda();

// ---------------- cap table + board fit (A lam30 on all 92) ----------------
const multiplesTraded = traded.map((p) => (p.mcap_usd as number) / (p.tvl_usd as number));
const capP90 = quantile(multiplesTraded, 0.9);
const capP85 = quantile(multiplesTraded, 0.85);
const capP80 = quantile(multiplesTraded, 0.8);
const modelAll = ridgeFit(Xtraded, y, 30);
const predEligLog = ridgePred(modelAll, elig.map(feats));
const impliedUncapped = elig.map((p, i) => Math.pow(10, predEligLog[i]));
const impliedCapped = impliedUncapped.map((v, i) => Math.min(v, capP90 * (elig[i].tvl_usd as number)));
function capTable(): { level: string; cap: number; bound: number; top1: number; total: number }[] {
  return ([
    ['p80', capP80], ['p85', capP85], ['p90', capP90],
  ] as [string, number][]).map(([level, cap]) => {
    const capped = impliedUncapped.map((v, i) => Math.min(v, cap * (elig[i].tvl_usd as number)));
    return { level, cap, bound: impliedUncapped.filter((v, i) => v > cap * (elig[i].tvl_usd as number)).length, top1: Math.max(...capped), total: sum(capped) };
  });
}
const capTab = capTable();
// Board total/top-1 MUST be the sum/max of the rounded integer dollars
// actually written to board.json (implied_value_usd), not the float sum:
// the integrity strip claims the total equals the sum of the 198 implied
// values recomputed from board.json, and the float sum differs by $3
// (1,768,900,565.28 vs 1,768,900,562) from the sum of the rounded rows.
const impliedRounded = impliedCapped.map((v) => Math.max(1, Math.round(v)));
const boardTotal = sum(impliedRounded);
const boardTop1 = Math.max(...impliedRounded);
// Generic board builder from a fitted predictor over elig features.
function boardFromPred(predLog: number[]): { top1: number; total: number; vals: number[] } {
  const unc = predLog.map((v) => Math.pow(10, v));
  const cap = unc.map((v, i) => Math.min(v, capP90 * (elig[i].tvl_usd as number)));
  return { top1: Math.max(...cap), total: sum(cap), vals: cap };
}
function curveBoard(): { top1: number; total: number; vals: number[]; spearmanVsA: number; top10Overlap: number } {
  const all = traded.map((_, i) => i);
  // curve fit on all 92
  const x = all.map((i) => yTvl[i]), yy = all.map((i) => yMult[i]);
  const m = olsFit(x.map((v) => [v]), yy);
  const predLog = elig.map((p) => {
    const v = ridgePred(m, [[log10(p.tvl_usd as number)]])[0];
    const ratio = Math.min(3, Math.max(0.01, Math.pow(10, v)));
    return log10(Math.min(ratio, 1.0) * (p.tvl_usd as number));
  });
  const b = boardFromPred(predLog);
  const sp = spearman(b.vals, impliedCapped);
  const topA = [...impliedCapped].map((v, i) => i).sort((a, c) => impliedCapped[c] - impliedCapped[a]).slice(0, 10);
  const topC = [...b.vals].map((v, i) => i).sort((a, c) => b.vals[c] - b.vals[a]).slice(0, 10);
  return { ...b, spearmanVsA: sp, top10Overlap: topA.filter((i) => topC.includes(i)).length };
}
const curveBoardRes = curveBoard();
function fullCurveBoard(): { top1: number; total: number; vals: number[] } {
  const all = traded.map((_, i) => i);
  const x = all.map((i) => yTvl[i]), yy = all.map((i) => yMult[i]);
  const m = olsFit(x.map((v) => [v]), yy);
  const predLog = elig.map((p) => {
    const v = ridgePred(m, [[log10(p.tvl_usd as number)]])[0];
    const ratio = Math.min(3, Math.max(0.01, Math.pow(10, v)));
    const g7 = p.change_7d ?? 0;
    const gw = g7 < 0 ? 0.9 : 0.6;
    const growth = 1 + (Math.max(-60, Math.min(120, g7)) / 100) * gw;
    const mat = 0.6 + (Math.min(ageDays(p), 1095) / 1095) * 0.4;
    const mult2 = Math.min(ratio * (0.75 + 0.25 * mat * growth), 1.0);
    return log10(mult2 * (p.tvl_usd as number));
  });
  return boardFromPred(predLog);
}
const fullCurveBoardRes = fullCurveBoard();
function catShiftBoard(k: number): { top1: number; total: number; vals: number[] } {
  const all = traded.map((_, i) => i);
  const m = olsFit(all.map((i) => [yTvl[i]]), all.map((i) => y[i]));
  const res = all.map((i) => y[i] - ridgePred(m, [[yTvl[i]]])[0]);
  const byCat: Record<string, number[]> = {};
  all.forEach((i, j) => {
    const c = traded[i].category ?? 'none';
    (byCat[c] ??= []).push(res[j]);
  });
  const shift: Record<string, number> = {};
  for (const c of Object.keys(byCat)) {
    const r = byCat[c];
    shift[c] = median(r) * (r.length / (r.length + k));
  }
  const predLog = elig.map((p) => ridgePred(m, [[log10(p.tvl_usd as number)]])[0] + (shift[p.category ?? 'none'] ?? 0));
  return boardFromPred(predLog);
}
const cat3Board = catShiftBoard(3);
const cat8Board = catShiftBoard(8);
function priorBoard(): { top1: number; total: number; vals: number[]; spearmanVsA: number; top10Overlap: number } {
  const predLog = predEligLog.map((v, i) => v + log10(priorLikelihood(elig[i])));
  const b = boardFromPred(predLog);
  const sp = spearman(b.vals, impliedCapped);
  const topA = [...impliedCapped].map((v, i) => i).sort((a, c) => impliedCapped[c] - impliedCapped[a]).slice(0, 10);
  const topP = [...b.vals].map((v, i) => i).sort((a, c) => b.vals[c] - b.vals[a]).slice(0, 10);
  return { ...b, spearmanVsA: sp, top10Overlap: topA.filter((i) => topP.includes(i)).length };
}
const priorBoardRes = priorBoard();

// ---------------- D-28 category multiples + D-58 anchors + D-59 ages ----------------
const d28 = (() => {
  const byCat: Record<string, number[]> = {};
  for (const p of traded) {
    const c = p.category ?? 'none';
    (byCat[c] ??= []).push((p.mcap_usd as number) / (p.tvl_usd as number));
  }
  const rows = Object.keys(byCat).sort().map((c) => ({ cat: c, n: byCat[c].length, med: median(byCat[c]) }));
  const all = multiplesTraded;
  return {
    rows,
    globalMed: median(all),
    lt1: mean(all.map((v) => (v < 1 ? 1 : 0))),
    oneTo5: mean(all.map((v) => (v >= 1 && v <= 5 ? 1 : 0))),
    gt5: mean(all.map((v) => (v > 5 ? 1 : 0))),
    gt10: mean(all.map((v) => (v > 10 ? 1 : 0))),
    spearmanTvlMcap: spearman(traded.map((p) => log10(p.tvl_usd as number)), traded.map((p) => log10(p.mcap_usd as number))),
  };
})();
const d58 = (() => {
  const byCat: Record<string, Proto[]> = {};
  for (const p of traded) {
    const c = p.category ?? 'none';
    (byCat[c] ??= []).push(p);
  }
  const anchors = Object.keys(byCat)
    .filter((c) => byCat[c].length >= 3)
    .sort()
    .map((c) => ({
      cat: c,
      comps: [...byCat[c]].sort((a, b) => (b.mcap_usd as number) / (b.tvl_usd as number) - (a.mcap_usd as number) / (a.tvl_usd as number))
        .slice(0, 3).map((p) => ({ name: p.name, mult: (p.mcap_usd as number) / (p.tvl_usd as number) })),
    }));
  const cex = protos.filter((p) => p.category === 'CEX' && p.mcap_usd && p.tvl_usd);
  const cexMults = cex.map((p) => (p.mcap_usd as number) / (p.tvl_usd as number));
  const nexo = cex.find((p) => p.name.toLowerCase().includes('nexo'));
  return {
    anchors,
    cex: { n: cex.length, med: cexMults.length ? median(cexMults) : 0, nexoMult: nexo ? (nexo.mcap_usd as number) / (nexo.tvl_usd as number) : 0 },
  };
})();
const d59 = (() => {
  const days = (ps: Proto[]): number[] => ps.filter((p) => p.listed_at).map((p) => Math.floor((asOf.getTime() - new Date(p.listed_at as string).getTime()) / dayMs));
  const all = days(protos);
  const pre = days(protos.filter((p) => !p.gecko_id && !p.symbol));
  const live = days(protos.filter((p) => p.gecko_id || p.symbol));
  const pct = (a: number[], q: number): number => quantile(a, q);
  return {
    all: { n: all.length, p25: pct(all, 0.25), med: pct(all, 0.5), p75: pct(all, 0.75) },
    pre: { n: pre.length, p25: pct(pre, 0.25), med: pct(pre, 0.5), p75: pct(pre, 0.75), unknown: protos.filter((p) => !p.gecko_id && !p.symbol && !p.listed_at).length },
    live: { n: live.length, p25: pct(live, 0.25), med: pct(live, 0.5), p75: pct(live, 0.75), unknown: protos.filter((p) => (p.gecko_id || p.symbol) && !p.listed_at).length },
  };
})();
// D-62 disposition strip + D-09 gray zone + D-54 confidence
const d62 = (() => {
  const isElig = (p: Proto): boolean => elig.some((e) => e.slug === p.slug);
  const hasTok = (p: Proto): boolean => !!(p.gecko_id || p.symbol);
  const vers = (p: Proto): boolean => VERS.test(p.name);
  const wrapped = (p: Proto): boolean => WRAP.test(p.name);
  const rows = {
    ranked: elig.length,
    hasToken: protos.filter((p) => hasTok(p)).length,
    bridge: protos.filter((p) => ['Bridge', 'Canonical Bridge'].includes(p.category ?? '')).length,
    liquidStaking: protos.filter((p) => ['Liquid Staking', 'Liquid Restaking', 'Restaked BTC'].includes(p.category ?? '')).length,
    exchangeCustody: protos.filter((p) => p.category === 'CEX' || EXCH.test(p.name)).length,
    versioned: protos.filter((p) => vers(p)).length,
    wrapped: protos.filter((p) => wrapped(p)).length,
    other: 0,
  };
  // verify the split sums to 758 and overlaps are handled by the ordered rule
  const covered = new Set<string>();
  const mark = (ps: Proto[]): number => {
    let n = 0;
    for (const p of ps) if (!covered.has(p.slug)) { covered.add(p.slug); n++; }
    return n;
  };
  const ordered = {
    ranked: mark(elig),
    hasToken: mark(protos.filter((p) => hasTok(p))),
    bridge: mark(protos.filter((p) => ['Bridge', 'Canonical Bridge'].includes(p.category ?? ''))),
    liquidStaking: mark(protos.filter((p) => ['Liquid Staking', 'Liquid Restaking', 'Restaked BTC'].includes(p.category ?? ''))),
    exchangeCustody: mark(protos.filter((p) => p.category === 'CEX' || EXCH.test(p.name))),
    versioned: mark(protos.filter((p) => vers(p))),
    wrapped: mark(protos.filter((p) => wrapped(p))),
    other: 0,
  };
  ordered.other = protos.length - covered.size;
  void rows;
  return { ...ordered, total: protos.length };
})();
const grayZone = elig.filter((p) => (p.tvl_usd ?? 0) > 50e6 && !watchlist.includes(p.slug));
const confScore = (p: Proto): number => {
  let s = 100;
  if (p.change_7d === null || p.change_7d === undefined) s -= 30;
  if (!p.listed_at) s -= 30;
  if (!p.category) s -= 20;
  if (!p.chains || p.chains.length === 0) s -= 20;
  return s;
};
const confCounts = (() => {
  const c: Record<number, number> = {};
  for (const p of elig) c[confScore(p)] = (c[confScore(p)] || 0) + 1;
  return c;
})();
// D-05 numbers already computed above (d05)

// ---------------- bootstrap (200 refits, seeded) ----------------
function bootstrap(): {
  rankP10: number[]; rankP50: number[]; rankP90: number[]; medWidth: number;
  top20Stability: number; slopeMean: number; slopeSd: number; slopeFull: number;
} {
  const rng = mulberry32(20261124);
  const baseOrder = [...impliedCapped].map((v, i) => i).sort((a, b) => impliedCapped[b] - impliedCapped[a]);
  const ranks: number[][] = Array.from({ length: elig.length }, () => []);
  const slopes: number[] = [];
  for (let b = 0; b < 200; b++) {
    const idx: number[] = [];
    for (let i = 0; i < 92; i++) idx.push(Math.floor(rng() * 92));
    const m = ridgeFit(idx.map((i) => Xtraded[i]), idx.map((i) => y[i]), 30);
    const pred = ridgePred(m, elig.map(feats));
    const cap = pred.map((v, i) => Math.min(Math.pow(10, v), capP90 * (elig[i].tvl_usd as number)));
    const order = [...cap].map((v, i) => i).sort((a, c) => cap[c] - cap[a]);
    const rank = new Array<number>(elig.length);
    order.forEach((eligIdx, r) => { rank[eligIdx] = r + 1; });
    for (let i = 0; i < elig.length; i++) ranks[i].push(rank[i]);
    // "slope" = the standardised ridge coefficient on log10(TVL) (b[1]);
    // the research reports it in standardised units (0.19 +- 0.063).
    slopes.push(m.b[1]);
  }
  const rankP10 = ranks.map((r) => Math.round(quantile(r, 0.1)));
  const rankP50 = ranks.map((r) => Math.round(quantile(r, 0.5)));
  const rankP90 = ranks.map((r) => Math.round(quantile(r, 0.9)));
  const medWidth = median(rankP90.map((v, i) => v - rankP10[i]));
  const top20 = baseOrder.slice(0, 20);
  const stab = top20.map((eligIdx) => mean(ranks[eligIdx].map((r) => (r <= 20 ? 1 : 0))));
  return {
    rankP10, rankP50, rankP90, medWidth,
    top20Stability: mean(stab),
    slopeMean: mean(slopes), slopeSd: stdPop(slopes),
    slopeFull: modelAll.b[1],
  };
}
const boot = bootstrap();

// ---------------- verdict economics (Lampiran A) ----------------
const GAS: Record<string, number> = { Ethereum: 8.0, Base: 0.05, Solana: 0.01, Arbitrum: 0.2, Binance: 0.15, Avalanche: 0.3 };
const gasOf = (p: Proto): number => Math.min(...p.chains.map((c) => GAS[c] ?? 1.0));
const cheapestChain = (p: Proto): string => {
  let best = p.chains[0] ?? 'other', bg = Infinity;
  for (const c of p.chains) { const g = GAS[c] ?? 1.0; if (g < bg) { bg = g; best = c; } }
  return best;
};
type Econ = { slice: number; costs: number; net: number; be: number | null; walk: number; evCost: number; gas: number };
function econ(p: Proto, implied: number, odds: number, plan = 5000, horizonWk = 12, drop = 0.07): Econ {
  const gas = gasOf(p);
  const slice = 1000 * (implied / (p.tvl_usd as number)) * drop * odds;
  const costs = 2 * gas + plan * 0.001 + plan * 0.04 * (horizonWk / 52);
  const net = slice * (plan / 1000) - costs;
  const denom = slice / 1000 - 0.001 - 0.04 * (horizonWk / 52);
  const be = denom > 0 ? (2 * gas) / denom : null;
  const walk = costs > 0 ? (slice * (plan / 1000)) / costs : 0;
  return { slice, costs, net, be, walk, evCost: walk, gas };
}
const verdictOf = (net: number): 'FARM' | 'MARGINAL' | 'SKIP' => (net > 25 ? 'FARM' : net < -25 ? 'SKIP' : 'MARGINAL');
// per-row econ at the default plan
const econs = elig.map((p, i) => econ(p, impliedCapped[i], oddsElig[i]));
const verdicts = econs.map((e) => verdictOf(e.net));
const verdictCounts = { FARM: verdicts.filter((v) => v === 'FARM').length, MARGINAL: verdicts.filter((v) => v === 'MARGINAL').length, SKIP: verdicts.filter((v) => v === 'SKIP').length };
// D-03 break-even capital
const d03 = (() => {
  const bes = econs.map((e) => e.be).filter((b): b is number => b !== null);
  return { finite: bes.length, never: econs.length - bes.length, median: bes.length ? median(bes) : 0 };
})();
// D-04 walk-away TVL (FARM rows only)
const d04 = (() => {
  const farm = econs.filter((_, i) => verdicts[i] === 'FARM');
  const ks = farm.map((e) => e.walk);
  return { n: farm.length, med: median(ks), p10: quantile(ks, 0.1), p90: quantile(ks, 0.9), min: Math.min(...ks), max: Math.max(...ks), fragile: ks.filter((k) => k < 2).length };
})();
// D-50 EV/cost
const d50 = (() => {
  const evs = econs.map((e) => e.evCost);
  const sorted = [...evs].sort((a, b) => b - a);
  const top5 = [...evs].map((v, i) => i).sort((a, b) => evs[b] - evs[a]).slice(0, 5).map((i) => ({ name: elig[i].name, ev: evs[i] }));
  return { median: median(evs), p90: quantile(evs, 0.9), max: Math.max(...evs), gt1: evs.filter((v) => v > 1).length, gt3: evs.filter((v) => v > 3).length, top5 };
})();
// D-47 vesting haircut
function pvFactor(tge: number, cliff: number, months: number, disc: number): number {
  const rm = Math.pow(1 + disc, 1 / 12) - 1;
  let s = 0;
  for (let m = cliff + 1; m <= cliff + months; m++) s += Math.pow(1 + rm, -m);
  return tge + (1 - tge) * (1 / months) * s;
}
const d47 = (['typical', 'harsh', 'generous'] as const).map((label) => {
  const params = label === 'typical' ? [0.2, 0, 12, 0.2] : label === 'harsh' ? [0.1, 6, 24, 0.3] : [0.5, 0, 12, 0.2];
  const pv = pvFactor(params[0], params[1], params[2], params[3]);
  const counts = { FARM: 0, MARGINAL: 0, SKIP: 0 };
  elig.forEach((p, i) => {
    const e = econ(p, impliedCapped[i] * 1, oddsElig[i]);
    const netV = (e.slice * pv) * 5 - e.costs;
    counts[verdictOf(netV)]++;
  });
  return { label, pv, counts };
});
// D-49 log-share (slice * ln(1+plan/1000)/(plan/1000))
const d49 = [1000, 5000, 25000].map((plan) => {
  const counts = { FARM: 0, MARGINAL: 0, SKIP: 0 };
  elig.forEach((p, i) => {
    const e = econ(p, impliedCapped[i], oddsElig[i], plan);
    const adj = e.slice * (Math.log(1 + plan / 1000) / (plan / 1000));
    const net = adj * (plan / 1000) - e.costs;
    counts[verdictOf(net)]++;
  });
  return { plan, counts };
});
// D-48 bear/base/bull (context for D-49)
const d48 = [0.33, 1, 2.5, 3.0].map((f) => {
  const counts = { FARM: 0, MARGINAL: 0, SKIP: 0 };
  const names: string[] = [];
  elig.forEach((p, i) => {
    const e = econ(p, impliedCapped[i] * f, oddsElig[i]);
    const v = verdictOf(e.net);
    counts[v]++;
    if (f === 0.33 && v === 'FARM') names.push(elig[i].name);
  });
  return { factor: f, counts, survivors: names };
});
// 12-scenario sensitivity grid: plans x drops at 12 weeks
const sensGrid = [1000, 5000, 10000, 25000].flatMap((plan) =>
  [0.05, 0.07, 0.15].map((drop) => {
    const counts = { FARM: 0, MARGINAL: 0, SKIP: 0 };
    elig.forEach((p, i) => {
      const e = econ(p, impliedCapped[i], oddsElig[i], plan, 12, drop);
      counts[verdictOf(e.net)]++;
    });
    return { plan, drop, counts };
  }),
);
// extrapolation + global-category flags
const ltTraded = traded.map((p) => log10(p.tvl_usd as number));
const ltRange = [Math.min(...ltTraded), Math.max(...ltTraded)];
const gTraded = traded.map((p) => p.change_7d ?? 0);
const gRange = [Math.min(...gTraded), Math.max(...gTraded)];
const isExtrap = (p: Proto): boolean => {
  const lt = log10(p.tvl_usd as number);
  const g = p.change_7d ?? 0;
  return lt < ltRange[0] || lt > ltRange[1] || g < gRange[0] || g > gRange[1];
};
const extrapCount = elig.filter(isExtrap).length;
const globalCatCount = elig.filter((p) => !(p.category && catsTraded[p.category])).length;
const tradedInCat = (p: Proto): number => (p.category && catsTraded[p.category]) || 0;

// ---------------- farm steps (6 per row, all unique, >=2 data points each) ----------------
const fmtMoney = (x: number): string => '$' + Math.round(x).toLocaleString('en-US');
const fmtPct = (x: number, d = 1): string => (x * 100).toFixed(d) + '%';
function mechanism(p: Proto): { mech: string; act: string; second: string } {
  const c = p.category ?? '';
  switch (c) {
    case 'Dexs': return { mech: 'LP', act: 'add liquidity to the main pool', second: 'route a small swap through the same pool' };
    case 'Lending': return { mech: 'lend', act: 'lend the deposit into the lending market', second: 'borrow a small amount against it, then repay it the same week' };
    case 'CDP': return { mech: 'CDP', act: 'open a collateralised debt position', second: 'mint a small amount of the CDP stablecoin, then repay it the same week' };
    case 'Yield': case 'Yield Aggregator': case 'Risk Curators': case 'Onchain Capital Allocator':
      return { mech: 'vault', act: 'deposit into the vault', second: 'deposit a second tranche into the same vault on a second chain' };
    case 'RWA': return { mech: 'RWA vault', act: 'deposit into the RWA vault', second: 'redeposit the yield back into the same vault' };
    case 'Basis Trading': return { mech: 'basis trade', act: 'open the basis position', second: 'rebalance the hedge after a funding-rate move' };
    case 'Restaking': case 'Staking Pool': return { mech: 'restake', act: 'restake the deposit', second: 'claim the restaking rewards and restake them' };
    case 'Derivatives': return { mech: 'perps hedge', act: 'open a hedged perps position', second: 'close the hedge, then reopen it the next week' };
    case 'Prediction Market': return { mech: 'prediction', act: 'take a position in a live market', second: 'open a second position in a different market' };
    case 'Cross Chain Bridge': return { mech: 'bridge', act: 'bridge the deposit across', second: 'bridge a small amount back the same week' };
    case 'Indexes': return { mech: 'index', act: 'deposit into the index', second: 'rebalance into the index a second time' };
    case 'Leveraged Farming': return { mech: 'leveraged farm', act: 'open the leveraged farm position', second: 'deleverage slightly, then re-leverage the same week' };
    case 'Stablecoin Wrapper': return { mech: 'wrap', act: 'wrap the deposit into the stablecoin', second: 'unwrap a small amount, then re-wrap it' };
    case 'CeDeFi': return { mech: 'CeDeFi vault', act: 'deposit into the CeDeFi vault', second: 'move a small tranche to a second CeDeFi product' };
    case 'Insurance': return { mech: 'cover', act: 'buy cover with the deposit', second: 'renew the cover for a second period' };
    case 'OTC Marketplace': return { mech: 'OTC', act: 'place an OTC order', second: 'fill a second small OTC order' };
    case 'Governance Incentives': return { mech: 'governance', act: 'stake the deposit for governance incentives', second: 'vote on a live proposal with the staked position' };
    case 'Interest Rate Derivatives': return { mech: 'rate swap', act: 'open the rate position', second: 'roll the rate position to the next tenor' };
    case 'Liquidity Manager': return { mech: 'LP manager', act: 'deposit into the managed LP', second: 'rebalance the managed range once' };
    case 'Collateral Markets': return { mech: 'collateral', act: 'post the deposit as collateral', second: 'borrow a small amount against it, then repay it' };
    case 'Dual-Token Stablecoin': return { mech: 'stablecoin', act: 'mint the stablecoin with the deposit', second: 'redeem a small amount, then re-mint it' };
    case 'Anchor BTC': case 'Decentralized BTC': return { mech: 'BTC vault', act: 'deposit into the BTC vault', second: 'move a small tranche to a second BTC vault' };
    case 'Chain': return { mech: 'chain deposit', act: 'deposit on the chain', second: 'bridge a small amount to a second chain' };
    case 'Crypto Card Issuer': return { mech: 'card top-up', act: 'top up the card with the deposit', second: 'spend a small amount through the card' };
    case 'Farm': return { mech: 'farm', act: 'deposit into the farm', second: 'harvest and compound the farm rewards' };
    case 'CDP Manager': return { mech: 'CDP manager', act: 'open a managed CDP', second: 'adjust the collateral ratio once' };
    case 'Uncollateralized Lending': return { mech: 'unsecured lend', act: 'lend the deposit unsecured', second: 'recall and re-lend a small tranche' };
    case 'Payments': return { mech: 'payment channel', act: 'fund the payment channel', second: 'route a small payment through the channel' };
    default: return { mech: 'deposit', act: 'deposit into the protocol', second: 'make a second small deposit the following week' };
  }
}
function farmSteps(p: Proto, i: number): string[] {
  const e = econs[i];
  const mech = mechanism(p);
  const chain = cheapestChain(p);
  const odds = oddsElig[i];
  const tier = tierOf(odds);
  const net = e.net;
  const netH = net / 6; // 30 min/week x 12 weeks = 6 hours
  const oddsLabel = `${Math.round(odds * 100)}% launch odds (${tier}, WF-tested)`;
  const sharePct = ((5000 / (p.tvl_usd as number)) * 100).toFixed(2);
  const walkTvl = (p.tvl_usd as number) * e.walk;
  const beTxt = e.be === null ? 'never (the slice never covers gas at $5K)' : fmtMoney(e.be);
  const steps = [
    `${p.name}: deposit $5,000 on ${chain} and ${mech.act}; $5,000 is ${sharePct}% of its ${fmtMoney(p.tvl_usd as number)} TVL, and ${tradedInCat(p)} traded comps in ${p.category ?? 'no category'} back the estimate. Gas about ${fmtMoney(e.gas)} for the deposit leg.`,
    `${p.name}: ${mech.second} on ${chain} in week 2 (gas about ${fmtMoney(e.gas)}); a second on-chain action keeps the position active beyond a single deposit.`,
    `${p.name}: each week (30 min, 12 weeks) do one small activity on ${chain} — farming often needs activity beyond the first deposit, so a single deposit alone may not qualify for any airdrop.`,
    `${p.name}: walk away if TVL falls below ${fmtMoney(walkTvl)} (${e.walk.toFixed(2)}x of current TVL); break-even deposit is ${beTxt} at the 7% drop assumption.`,
    `${p.name}: at TGE or after 12 weeks, claim and withdraw — expected net ${fmtMoney(net)} (${fmtMoney(netH)}/h over 6 h) after ${fmtMoney(e.costs)} in fees, at a 7% drop and ${oddsLabel}.`,
    `${p.name}: risk — a token launch does not guarantee you qualify, and eligibility rules are unknown until the team publishes them; the ${verdicts[i]} verdict prices value, not eligibility, and ${oddsLabel} is a probability, not a promise.`,
  ];
  return steps;
}

// ---------------- board rows ----------------
const order = [...impliedCapped].map((v, i) => i).sort((a, b) => impliedCapped[b] - impliedCapped[a]);
const rows = order.map((i, r) => {
  const p = elig[i];
  const e = econs[i];
  const implied = impliedCapped[i];
  const lo25 = implied / Math.pow(10, hwIn);
  const hi75 = implied * Math.pow(10, hwIn);
  const lo10 = implied / Math.pow(10, hwOut);
  const hi90 = implied * Math.pow(10, hwOut);
  return {
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    rank: r + 1,
    tvl: p.tvl_usd as number,
    growth: p.change_7d,
    ageDays: p.listed_at ? ageDays(p) : null,
    mult: implied / (p.tvl_usd as number),
    implied_value_usd: impliedRounded[i],
    uncapped_value_usd: Math.max(1, Math.round(impliedUncapped[i])),
    lo25: Math.max(1, Math.round(lo25)),
    hi75: Math.max(1, Math.round(hi75)),
    lo10: Math.max(1, Math.round(lo10)),
    hi90: Math.max(1, Math.round(hi90)),
    slice: e.slice,
    odds: oddsElig[i],
    tier: tierOf(oddsElig[i]),
    verdict: verdicts[i],
    net: e.net,
    netPerHour: e.net / 6,
    fee: e.costs,
    holdWeeks: 12,
    beCapital: e.be,
    walkAwayTvl: (p.tvl_usd as number) * e.walk,
    walkK: e.walk,
    evCost: e.evCost,
    conf: confScore(p),
    rankLo: boot.rankP10[i],
    rankMed: boot.rankP50[i],
    rankHi: boot.rankP90[i],
    extrap: isExtrap(p),
    grayZone: grayZone.some((g) => g.slug === p.slug),
    globalCat: !(p.category && catsTraded[p.category]),
    onWatchlist: watchlist.includes(p.slug),
    comps: tradedInCat(p),
    mech: mechanism(p).mech,
    gas: e.gas,
    chain: cheapestChain(p),
    farm_steps: farmSteps(p, i),
  };
});
// farm-steps self-check (f5): length 20-600, unique across all rows
const allSteps = rows.flatMap((r) => r.farm_steps);
const stepsUnique = new Set(allSteps).size === allSteps.length;
const stepsLenOk = allSteps.every((s) => s.length >= 20 && s.length <= 600);
const stepsPerRowOk = rows.every((r) => r.farm_steps.length >= 3 && r.farm_steps.length <= 12);

// ---------------- meta (all evidence numbers, rounded) ----------------
const meta = {
  asOf: snap.as_of,
  snapshotSha: '42a71213519479f3a180cc5010cbbf6bd18a2447fa0ad29e4c5122b6c9184393',
  version: 'v8',
  flow: 'evidence (C1+C4+C3)',
  coeffs: { b: modelAll.b, mu: modelAll.mu, sd: modelAll.sd, topcats: TOPCATS },
  counts: { protocols: protos.length, traded: traded.length, eligible: elig.length, watchlist: watchlist.length, watchlistInElig: watchInElig.length },
  ledger: d62,
  models: {
    A: modelA, B: modelB, C: modelC, flat: modelFlat,
    sqrtMat: modelSqrtMat, linMat: modelLinMat, combo: modelCombo, asym: modelAsym,
    curve: modelCurve, curveMat: modelCurveMat, curveGrowth: modelCurveGrowth, fullCurve: modelFullCurve,
    catShift3: modelCat3, catShift8: modelCat8, prior: modelPrior,
  },
  ablations,
  innerLoo,
  d05, spearmanLooA, spearmanLooB, r2: r2Res,
  odds: {
    baseRate, wf: oddsWF,
    tierActuals: { HIGH: tierActuals[2], MED: tierActuals[1], LOW: tierActuals[0] },
    tiersOnBoard: { HIGH: rows.filter((r) => r.tier === 'HIGH').length, MED: rows.filter((r) => r.tier === 'MED').length, LOW: rows.filter((r) => r.tier === 'LOW').length },
  },
  ranges: {
    kIn: rangeRes.kIn, kOut: rangeRes.kOut, covIn: rangeRes.covIn, covOut: rangeRes.covOut,
    covInCuts: rangeRes.covInCuts, covOutCuts: rangeRes.covOutCuts, q50: rangeRes.q50, q80: rangeRes.q80,
    hwIn, hwOut, cleanCut: cleanCutRes, timeSplit50, timeSplit67, jackknifePlus: jkPlus,
    mondrian: mondrianRes, cqr: cqrRes, d43,
  },
  cap: { p80: capP80, p85: capP85, p90: capP90, table: capTab },
  board: { top1: boardTop1, total: boardTotal, top1Name: rows[0].name, top1Slug: rows[0].slug },
  variants: {
    curve: { top1: curveBoardRes.top1, total: curveBoardRes.total, spearmanVsA: curveBoardRes.spearmanVsA, top10Overlap: curveBoardRes.top10Overlap },
    fullCurve: { top1: fullCurveBoardRes.top1, total: fullCurveBoardRes.total },
    catShift3: { top1: cat3Board.top1, total: cat3Board.total },
    catShift8: { top1: cat8Board.top1, total: cat8Board.total },
    prior: { top1: priorBoardRes.top1, total: priorBoardRes.total, spearmanVsA: priorBoardRes.spearmanVsA, top10Overlap: priorBoardRes.top10Overlap },
  },
  bootstrap: { medWidth: boot.medWidth, top20Stability: boot.top20Stability, slopeMean: boot.slopeMean, slopeSd: boot.slopeSd, slopeFull: boot.slopeFull },
  verdicts: verdictCounts,
  d03, d04, d47, d49, d48, d50, sensGrid,
  d28, d58, d59,
  confCounts, extrapCount, globalCatCount, grayZoneCount: grayZone.length,
  grayZoneSlugs: grayZone.map((p) => p.slug),
  ltRange, gRange,
  farmStepsCheck: { unique: stepsUnique, lenOk: stepsLenOk, perRowOk: stepsPerRowOk, total: allSteps.length },
  econDefaults: { plan: 5000, horizonWeeks: 12, drop: 0.07, hoursTotal: 6, hoursPerWeek: 0.5 },
};
const board = { meta, rows };

// ---------------- outputs ----------------
mkdirSync(OUT, { recursive: true });
mkdirSync(join(OUT, 'dashboard'), { recursive: true });
mkdirSync(join(OUT, 'screenshots'), { recursive: true });
writeFileSync(join(OUT, 'board.json'), JSON.stringify(board));
const dataJs = 'window.__RADAR__ = ' + JSON.stringify(board) + ';\n';
writeFileSync(join(OUT, 'data.js'), dataJs);
// copy dashboard + screenshots (mkdir + copy only; never delete /output)
cpSync(join(ENTRY, 'dashboard'), join(OUT, 'dashboard'), { recursive: true });
cpSync(join(ENTRY, 'screenshots'), join(OUT, 'screenshots'), { recursive: true });
const dossierBytes = buildDossier(OUT, {
  text_max_bytes: 65536,
  screenshots: { max: 4, max_bytes: 524288 },
  dashboard: { max_files: 10, max_bytes: 65536 },
});
writeFileSync(join(OUT, 'dossier.json'), Buffer.from(dossierBytes));
const dossierText = JSON.parse(Buffer.from(dossierBytes).toString('utf8')).text as string;
const dossierWhole = !dossierText.includes('[Cut at');
const dossierSize = dossierBytes.length;

// ---------------- console summary ----------------
const fmt = (x: number, d = 2): string => x.toFixed(d);
console.log('=== token-radar-01 v8 (evidence flow) ===');
console.log(`snapshot ${snap.as_of} | protos ${protos.length} traded ${traded.length} elig ${elig.length} watchlist ${watchlist.length}/${watchInElig.length}`);
console.log(`ledger ${d62.ranked}+${d62.hasToken}+${d62.bridge}+${d62.liquidStaking}+${d62.exchangeCustody}+${d62.versioned}+${d62.wrapped}+${d62.other} = ${d62.total}`);
console.log(`A lam30: medLOO x/${fmt(modelA.medLOO)} meanLOO x/${fmt(modelA.meanLOO)} medWF x/${fmt(modelA.medWF)} meanWF x/${fmt(modelA.meanWF)} cuts [${modelA.wfCutsMed.map((v) => fmt(v)).join(' ')}] med35 x/${fmt(modelA.med35)} mean35 x/${fmt(modelA.mean35)}`);
console.log(`B lam3: meanWF x/${fmt(modelB.meanWF)} medLOO x/${fmt(modelB.medLOO)} | C pow: meanWF x/${fmt(modelC.meanWF)} medLOO x/${fmt(modelC.medLOO)} | flat: medLOO x/${fmt(modelFlat.medLOO)} meanWF x/${fmt(modelFlat.meanWF)}`);
console.log(`D-06 R2: A ${r2Res.r2A.toFixed(3)} flat ${r2Res.r2Flat.toFixed(3)} rand [${r2Res.r2Rand.map((v) => v.toFixed(2)).join(', ')}] | Spearman LOO A ${spearmanLooA.toFixed(3)} B ${spearmanLooB.toFixed(3)}`);
console.log(`D-05: r(7d, log mult) Pearson ${d05.pearson.toFixed(3)} Spearman ${d05.spearman.toFixed(3)} std growth coef ${d05.stdGrowthCoef.toFixed(3)}`);
console.log(`odds WF Brier ens [${oddsWF.cuts.map((c) => c.brier.toFixed(3)).join(' ')}] logit [${oddsWF.cuts.map((c) => c.brierLogit.toFixed(3)).join(' ')}] base [${oddsWF.cuts.map((c) => c.base.toFixed(3)).join(' ')}] called-right ens [${oddsWF.cuts.map((c) => (c.calledRight * 100).toFixed(0)).join('/')}%] tiers per cut [${oddsWF.cuts.map((c) => c.tiers.map((t) => (t * 100).toFixed(0)).join('/')).join(' | ')}] pooled HIGH/MED/LOW actual ${(tierActuals[2] * 100).toFixed(0)}/${(tierActuals[1] * 100).toFixed(0)}/${(tierActuals[0] * 100).toFixed(0)}%`);
console.log(`ranges: kIn x${rangeRes.kIn} -> ${(rangeRes.covIn * 100).toFixed(0)}% | kOut x${rangeRes.kOut} -> ${(rangeRes.covOut * 100).toFixed(0)}% | clean-cut inner ${(cleanCutRes.covIn * 100).toFixed(0)}% outer ${(cleanCutRes.covOut * 100).toFixed(0)}% (n=${cleanCutRes.n}) per-TVL inner [${cleanCutRes.byTvl.inner.map((v) => (v * 100).toFixed(0)).join('/')}%] outer [${cleanCutRes.byTvl.outer.map((v) => (v * 100).toFixed(0)).join('/')}%] medErr [${cleanCutRes.byTvl.medErr.map((v) => fmt(v)).join('/')}]`);
console.log(`D-02 time-split 50/50 med x/${fmt(timeSplit50.med)} mean x/${fmt(timeSplit50.mean)} | 67/33 med x/${fmt(timeSplit67.med)} mean x/${fmt(timeSplit67.mean)}`);
console.log(`jackknife+ inner ${(jkPlus.covIn * 100).toFixed(0)}% width x/${fmt(jkPlus.widthIn)} | outer ${(jkPlus.covOut * 100).toFixed(0)}% width x/${fmt(jkPlus.widthOut)}`);
console.log(`Mondrian inner 0%shrink ${(mondrianRes.covIn0 * 100).toFixed(0)}% [${mondrianRes.byTercileIn0.map((v) => (v * 100).toFixed(0)).join('/')}%] width x/${mondrianRes.widthIn0.toFixed(2)} outer ${(mondrianRes.covOut0 * 100).toFixed(0)}% width x/${mondrianRes.widthOut0.toFixed(2)} | 50%shrink inner ${(mondrianRes.covIn05 * 100).toFixed(0)}% outer ${(mondrianRes.covOut05 * 100).toFixed(0)}%`);
console.log(`CQR-lite inner ok=${cqrRes.inner.ok} Q=${cqrRes.inner.Q.toFixed(3)} coverage ${(cqrRes.inner.cov * 100).toFixed(0)}% width x/${cqrRes.inner.width.toFixed(2)} fracs lo ${cqrRes.inner.fracLo.toFixed(2)} hi ${cqrRes.inner.fracHi.toFixed(2)} | outer ok=${cqrRes.outer.ok} Q=${cqrRes.outer.Q.toFixed(3)} coverage ${(cqrRes.outer.cov * 100).toFixed(0)}% width x/${cqrRes.outer.width.toFixed(2)} fracs lo ${cqrRes.outer.fracLo.toFixed(2)} hi ${cqrRes.outer.fracHi.toFixed(2)} | verdict ${cqrRes.verdict}`);
console.log(`D-43 |resid| vs features: ${Object.keys(d43.cors).map((k) => k + ' P' + d43.cors[k].pearson.toFixed(2) + '/S' + d43.cors[k].spearman.toFixed(2)).join(' | ')} | strongest ${d43.strongest} (Spearman ${d43.strongestSpearman.toFixed(2)}) sigma=${d43.a.toFixed(3)}${d43.b >= 0 ? '+' : ''}${d43.b.toFixed(3)}*${d43.strongest} outlier ${d43.outlier} | normalized inner ${(d43.covIn * 100).toFixed(0)}% outer ${(d43.covOut * 100).toFixed(0)}% widths x/${d43.widthIn.toFixed(2)}/x/${d43.widthOut.toFixed(2)}`);
console.log(`cap p90 x/${capP90.toFixed(2)} (p85 ${capP85.toFixed(2)} p80 ${capP80.toFixed(2)}) | top-1 ${rows[0].name} ${fmtMoney(rows[0].implied_value_usd)} | total ${fmtMoney(boardTotal)} | board top1 ${fmtMoney(boardTop1)}`);
console.log(`cap table: ${capTab.map((c) => `${c.level} binds ${c.bound} top1 ${fmtMoney(c.top1)} total ${fmtMoney(c.total)}`).join(' | ')}`);
console.log(`variants board: curve top1 ${fmtMoney(curveBoardRes.top1)} total ${fmtMoney(curveBoardRes.total)} Spearman ${curveBoardRes.spearmanVsA.toFixed(2)} top10 ${curveBoardRes.top10Overlap}/10 | fullCurve top1 ${fmtMoney(fullCurveBoardRes.top1)} total ${fmtMoney(fullCurveBoardRes.total)} | cat3 top1 ${fmtMoney(cat3Board.top1)} total ${fmtMoney(cat3Board.total)} | cat8 top1 ${fmtMoney(cat8Board.top1)} total ${fmtMoney(cat8Board.total)} | prior top1 ${fmtMoney(priorBoardRes.top1)} total ${fmtMoney(priorBoardRes.total)} Spearman ${priorBoardRes.spearmanVsA.toFixed(2)} top10 ${priorBoardRes.top10Overlap}/10`);
console.log(`bootstrap: slope full ${boot.slopeFull.toFixed(2)} mean ${boot.slopeMean.toFixed(2)} +- ${boot.slopeSd.toFixed(3)} | top-20 stability ${(boot.top20Stability * 100).toFixed(0)}% | rank-range median width ${boot.medWidth}`);
console.log(`verdicts ${verdictCounts.FARM}/${verdictCounts.MARGINAL}/${verdictCounts.SKIP} | D-03 BE finite ${d03.finite}/never ${d03.never} median ${fmtMoney(d03.median)} | D-04 walk-away FARM med x/${d04.med.toFixed(2)} p10 ${d04.p10.toFixed(2)} p90 ${d04.p90.toFixed(2)} fragile ${d04.fragile}/${d04.n} | D-50 EV/cost med ${d50.median.toFixed(2)} p90 ${d50.p90.toFixed(2)} max ${d50.max.toFixed(2)} >1 ${d50.gt1} >3 ${d50.gt3}`);
console.log(`D-47 vesting: ${d47.map((v) => `${v.label} PV ${v.pv.toFixed(2)} -> ${v.counts.FARM}/${v.counts.MARGINAL}/${v.counts.SKIP}`).join(' | ')}`);
console.log(`D-49 log-share: ${d49.map((v) => `$${v.plan} -> ${v.counts.FARM}/${v.counts.MARGINAL}/${v.counts.SKIP}`).join(' | ')}`);
console.log(`D-48 bear/base/bull: ${d48.map((v) => `x${v.factor} -> ${v.counts.FARM}/${v.counts.MARGINAL}/${v.counts.SKIP}`).join(' | ')} bear survivors: ${d48[0].survivors.join(', ')}`);
console.log(`D-28 global med mult ${d28.globalMed.toFixed(3)} | <1x ${(d28.lt1 * 100).toFixed(0)}% 1-5x ${(d28.oneTo5 * 100).toFixed(0)}% >5x ${(d28.gt5 * 100).toFixed(0)}% >10x ${(d28.gt10 * 100).toFixed(0)}% | Spearman logTVL vs log mcap ${d28.spearmanTvlMcap.toFixed(3)}`);
console.log(`D-59 ages days all p25/med/p75 ${d59.all.p25}/${d59.all.med}/${d59.all.p75} (n=${d59.all.n}) pre ${d59.pre.p25}/${d59.pre.med}/${d59.pre.p75} (n=${d59.pre.n}, unknown ${d59.pre.unknown}) live ${d59.live.p25}/${d59.live.med}/${d59.live.p75} (n=${d59.live.n}, unknown ${d59.live.unknown})`);
console.log(`D-54 conf counts ${JSON.stringify(confCounts)} | extrap ${extrapCount} | global-cat ${globalCatCount} | gray-zone ${grayZone.length}`);
console.log(`farm steps: ${allSteps.length} total, unique=${stepsUnique} lenOk=${stepsLenOk} perRowOk=${stepsPerRowOk}`);
console.log(`dossier ${dossierSize} bytes (<=1572864: ${dossierSize <= 1572864}) text whole=${dossierWhole} | board.json ${Buffer.byteLength(JSON.stringify(board), 'utf8')} bytes | data.js ${Buffer.byteLength(dataJs, 'utf8')} bytes`);
