// Token Launch Radar v8 — dashboard. Reads window.__RADAR__ (data.js).
const R = window.__RADAR__, M = R.meta, ROWS = R.rows;
const $ = (id) => document.getElementById(id);
const money = (x) => '$' + Math.round(x).toLocaleString('en-US');
const moneyB = (x) => '$' + (x / 1e9).toFixed(2) + 'B';
const pct = (x, d) => (x * 100).toFixed(d === undefined ? 1 : d) + '%';
const xf = (x) => 'x/' + x.toFixed(2);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sgn = (x) => (x >= 0 ? '+' : '−') + money(Math.abs(x)).slice(1);
const moneyC = (x) => x >= 1e6 ? '$' + (x / 1e6).toFixed(1) + 'M' : x >= 1e3 ? '$' + (x / 1e3).toFixed(1) + 'K' : money(x);

// ---------- KPI strip ----------
(function () {
  const o = M.odds.wf.cuts;
  const cells = [
    ['198', 'pre-token rows ranked'],
    ['40/40', 'sealed watchlist in board'],
    [M.board.top1Name + ' ' + money(M.board.top1), 'top-1 implied value'],
    [moneyB(M.board.total), 'total capped implied value'],
    [M.verdicts.FARM + '/' + M.verdicts.MARGINAL + '/' + M.verdicts.SKIP, 'FARM / MARGINAL / SKIP ($5K · 12wk · 7%)'],
    [o.map((c) => c.brier.toFixed(3)).join(' / '), 'odds WF Brier, 3 cuts (base ' + o.map((c) => c.base.toFixed(3)).join('/') + ')'],
  ];
  $('kpi').innerHTML = cells.map((c) => '<div class="cell"><b>' + esc(c[0]) + '</b><span>' + esc(c[1]) + '</span></div>').join('');
})();
// ---------- disposition + farm-next strips ----------
(function () {
  const L = M.ledger;
  $('disp').innerHTML = '<b>758 accounted:</b> ' + L.ranked + ' ranked · ' + L.hasToken + ' has token · ' + L.bridge + ' bridge · ' + L.liquidStaking + ' liquid staking · ' + L.exchangeCustody + ' exchange custody · ' + L.versioned + ' versioned · ' + L.wrapped + ' wrapped · ' + L.other + ' other. &nbsp; Board total <b>' + money(M.board.total) + '</b> = sum of the 198 implied values (recompute from board.json). &nbsp; <b>' + M.grayZoneCount + ' gray-zone rows</b> above the $50M floor are not on the sealed watchlist. &nbsp; ' + M.extrapCount + ' rows flagged out-of-range (TVL or 7d growth outside the traded range).';
  const byChain = {};
  ROWS.forEach((r) => { if (r.verdict === 'FARM' && (!byChain[r.chain] || r.netPerHour > byChain[r.chain].netPerHour)) byChain[r.chain] = r; });
  const top3 = Object.values(byChain).sort((a, b) => b.netPerHour - a.netPerHour).slice(0, 3);
  $('farmnext').innerHTML = '<b>FARM NEXT — best $/hour, one per chain:</b> ' + top3.map((r) => '<a href="#detail=' + r.slug + '">' + esc(r.name) + '</a> ' + sgn(r.netPerHour) + '/h · net ' + sgn(r.net) + ' on ' + esc(r.chain)).join(' &nbsp;·&nbsp; ');
})();
// ---------- board table ----------
const state = { q: '', verdict: '', tier: '', flag: '', sort: 'rank' };
function bePct(r) {
  const d = r.fee / (5000 * r.mult * r.odds);
  return d;
}
function filtered() {
  let out = ROWS.filter((r) => {
    if (state.q) {
      const q = state.q.toLowerCase();
      if (!(r.name.toLowerCase().includes(q) || (r.category || '').toLowerCase().includes(q))) return false;
    }
    if (state.verdict && r.verdict !== state.verdict) return false;
    if (state.tier && r.tier !== state.tier) return false;
    if (state.flag === 'watch' && !r.onWatchlist) return false;
    if (state.flag === 'gray' && !r.grayZone) return false;
    if (state.flag === 'extrap' && !r.extrap) return false;
    if (state.flag === 'global' && !r.globalCat) return false;
    return true;
  });
  const s = state.sort;
  if (s === 'net') out = [...out].sort((a, b) => b.net - a.net);
  else if (s === 'hour') out = [...out].sort((a, b) => b.netPerHour - a.netPerHour);
  else if (s === 'odds') out = [...out].sort((a, b) => b.odds - a.odds);
  else if (s === 'tvl') out = [...out].sort((a, b) => b.tvl - a.tvl);
  else if (s === 'be') out = [...out].sort((a, b) => (a.beCapital === null ? 1e15 : a.beCapital) - (b.beCapital === null ? 1e15 : b.beCapital));
  return out;
}
function rowHtml(r) {
  const badges = (r.onWatchlist ? '<span class="badge w">WATCH</span>' : '') +
    (r.grayZone ? '<span class="badge g">NOT ON WATCHLIST</span>' : '') +
    (r.extrap ? '<span class="badge x">OUT-OF-RANGE</span>' : '') +
    (r.globalCat ? '<span class="badge c">NO COMPS</span>' : '') +
    (r.conf < 100 ? '<span class="badge">CONF ' + r.conf + '</span>' : '');
  const lo = r.lo10, hi = r.hi90, v = r.implied_value_usd;
  const span = Math.log10(hi) - Math.log10(lo);
  const left = ((Math.log10(r.lo25) - Math.log10(lo)) / span * 100).toFixed(1);
  const width = ((Math.log10(r.hi75) - Math.log10(r.lo25)) / span * 100).toFixed(1);
  const mark = ((Math.log10(v) - Math.log10(lo)) / span * 100).toFixed(1);
  const be = r.beCapital === null ? 'never' : money(r.beCapital);
  const beP = bePct(r);
  return '<tr><td>#' + r.rank + '<br><span style="color:#6b675c;font-size:11px">#' + r.rankLo + '–' + r.rankHi + '</span></td>' +
    '<td><a href="#detail=' + r.slug + '">' + esc(r.name) + '</a>' + badges + '<br><span style="color:#6b675c;font-size:11px">' + esc(r.category || 'no category') + ' · ' + esc(r.mech) + '</span></td>' +
    '<td>' + money(r.tvl) + '</td>' +
    '<td>' + (r.growth === null ? '—' : r.growth.toFixed(2) + '%') + '</td>' +
    '<td>' + (r.ageDays === null ? '—' : r.ageDays + 'd') + '</td>' +
    '<td>x/' + r.mult.toFixed(2) + '</td>' +
    '<td><b>' + money(v) + '</b><span class="rng"><i style="left:' + left + '%;width:' + width + '%"></i><b style="left:' + mark + '%"></b></span><span style="font-size:11px;color:#6b675c">' + moneyC(r.lo25) + '–' + moneyC(r.hi75) + '</span></td>' +
    '<td>' + money(r.slice) + '</td>' +
    '<td>' + be + '<br><span style="font-size:11px;color:#6b675c">max drop ' + (beP > 99 ? '>9999%' : pct(beP, 1)) + '</span></td>' +
    '<td>' + pct(r.odds, 0) + ' · ' + r.tier + '</td>' +
    '<td><span class="v' + r.verdict + '">' + r.verdict + '</span> · ' + sgn(r.net) + '</td>' +
    '<td>' + sgn(r.netPerHour) + '</td></tr>';
}
function renderBoard() {
  const out = filtered();
  $('tbody').innerHTML = out.map(rowHtml).join('');
  $('count').textContent = out.length + ' of 198 rows · ranges: inner bar = P25–P75, full bar = P10–P90 · rank sub-range = bootstrap p10–p90 (200 refits) · BE% = max airdrop drop share before net turns negative';
}
$('q').addEventListener('input', (e) => { state.q = e.target.value; renderBoard(); });
$('f-verdict').addEventListener('change', (e) => { state.verdict = e.target.value; renderBoard(); });
$('f-tier').addEventListener('change', (e) => { state.tier = e.target.value; renderBoard(); });
$('f-flag').addEventListener('change', (e) => { state.flag = e.target.value; renderBoard(); });
$('f-sort').addEventListener('change', (e) => { state.sort = e.target.value; renderBoard(); });
$('csv').addEventListener('click', () => {
  const head = 'rank,slug,name,category,tvl_usd,growth_7d,age_days,multiple,implied_value_usd,lo25,hi75,lo10,hi90,slice_per_1000,odds,tier,verdict,net_usd,net_per_hour,fee_usd,break_even_capital,walk_away_tvl,ev_cost,confidence,rank_lo,rank_med,rank_hi\n';
  const body = filtered().map((r) => [r.rank, r.slug, '"' + r.name.replace(/"/g, '""') + '"', '"' + (r.category || '') + '"', r.tvl, r.growth === null ? '' : r.growth, r.ageDays === null ? '' : r.ageDays, r.mult.toFixed(4), r.implied_value_usd, r.lo25, r.hi75, r.lo10, r.hi90, Math.round(r.slice), r.odds.toFixed(4), r.tier, r.verdict, Math.round(r.net), Math.round(r.netPerHour), Math.round(r.fee), r.beCapital === null ? '' : Math.round(r.beCapital), Math.round(r.walkAwayTvl), r.evCost.toFixed(3), r.conf, r.rankLo, r.rankMed, r.rankHi].join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([head + body], { type: 'text/csv' }));
  a.download = 'token-radar-v8-board.csv';
  a.click();
});
// ---------- detail view ----------
function rebuild(r) {
  const c = M.coeffs;
  const g = (r.growth === null ? 0 : r.growth) / 100;
  const x = [Math.log10(r.tvl), g].concat(c.topcats.map((t) => (r.category === t ? 1 : 0)));
  let s = c.b[0];
  for (let j = 0; j < x.length; j++) s += c.b[j + 1] * ((x[j] - c.mu[j]) / c.sd[j]);
  const unc = Math.pow(10, s);
  const cap = Math.min(unc, M.cap.p90 * r.tvl);
  return { unc, cap };
}
function showDetail(slug) {
  const r = ROWS.find((x) => x.slug === slug);
  if (!r) { $('detail').innerHTML = ''; return; }
  const rb = rebuild(r);
  const match = Math.abs(Math.round(rb.cap) - r.implied_value_usd) <= 1;
  const oddsLabel = Math.round(r.odds * 100) + '% launch odds (' + r.tier + ', WF-tested)';
  $('detail').innerHTML =
    '<h2>#' + r.rank + ' ' + esc(r.name) + '</h2>' +
    '<div>' + esc(r.category || 'no category') + ' · ' + r.chains.map(esc).join(', ') + ' · cheapest chain ' + esc(r.chain) + ' (gas ' + money(r.gas) + ') · ' + r.comps + ' traded comps in category · mechanism: ' + esc(r.mech) + '</div>' +
    '<div class="dk">' +
    '<div><b>' + money(r.implied_value_usd) + '</b><span>implied value (capped ' + M.cap.p90.toFixed(2) + 'x)</span></div>' +
    '<div><b>' + money(r.tvl) + '</b><span>TVL · mult x/' + r.mult.toFixed(2) + '</span></div>' +
    '<div><b>' + money(r.lo25) + '–' + money(r.hi75) + '</b><span>P25–P75 range</span></div>' +
    '<div><b>' + money(r.lo10) + '–' + money(r.hi90) + '</b><span>P10–P90 range</span></div>' +
    '<div><b>' + pct(r.odds, 0) + ' · ' + r.tier + '</b><span>launch odds (WF-tested)</span></div>' +
    '<div><b>' + r.verdict + ' ' + sgn(r.net) + '</b><span>net at $5K · 12wk · 7%</span></div>' +
    '<div><b>' + sgn(r.netPerHour) + '/h</b><span>net per hour (6 h total)</span></div>' +
    '<div><b>' + (r.beCapital === null ? 'never' : money(r.beCapital)) + '</b><span>break-even deposit</span></div>' +
    '<div><b>' + money(r.walkAwayTvl) + '</b><span>walk-away TVL (' + r.walkK.toFixed(2) + 'x)</span></div>' +
    '<div><b>' + r.evCost.toFixed(2) + 'x</b><span>expected value / cost</span></div>' +
    '<div><b>' + r.conf + '</b><span>confidence score</span></div>' +
    '<div><b>#' + r.rankLo + '–' + r.rankHi + '</b><span>bootstrap rank range (p10–p90)</span></div>' +
    '</div>' +
    '<div><button id="rb">Rebuild this row</button> <span id="rbout"></span> <span style="color:#6b675c">Rebuild recomputes the implied value from the row inputs × the published coefficients (ridge lam30, cap ' + M.cap.p90.toFixed(2) + 'x). Board value: ' + money(r.implied_value_usd) + '.</span></div>' +
    '<div class="calc"><label>Plan $<input id="w-plan" type="number" value="5000" min="100" step="500"></label>' +
    '<label>Horizon (weeks)<input id="w-wk" type="number" value="12" min="1" step="1"></label>' +
    '<label>Drop share %<input id="w-drop" type="number" value="7" min="0" step="1"></label>' +
    '<span id="w-out"></span></div>' +
    '<p><b>Farm plan</b> (' + esc(r.mech) + ', ' + esc(r.chain) + ', gas ' + money(r.gas) + '):</p>' +
    '<ol>' + r.farm_steps.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ol>' +
    '<p style="color:#8a5a00">Verdict does not price eligibility risk: a launch does not guarantee you qualify. Odds label: ' + oddsLabel + '.</p>';
  $('rb').addEventListener('click', () => {
    $('rbout').innerHTML = 'Rebuild: ' + money(rb.cap) + ' (uncapped ' + money(rb.unc) + ') vs board ' + money(r.implied_value_usd) + ' — <span class="' + (match ? 'match' : 'diff') + '">' + (match ? 'MATCH' : 'DIFF') + '</span>';
  });
  const whatif = () => {
    const plan = +$('w-plan').value || 5000, wk = +$('w-wk').value || 12, drop = (+$('w-drop').value || 7) / 100;
    const slice = r.slice * (drop / 0.07);
    const costs = 2 * r.gas + plan * 0.001 + plan * 0.04 * (wk / 52);
    const net = slice * (plan / 1000) - costs;
    const v = net > 25 ? 'FARM' : net < -25 ? 'SKIP' : 'MARGINAL';
    $('w-out').innerHTML = 'What-if: net <b>' + sgn(net) + '</b> (' + sgn(net / (wk * 0.5)) + '/h) → <b class="v' + v + '">' + v + '</b> · fee ' + money(costs);
  };
  ['w-plan', 'w-wk', 'w-drop'].forEach((id) => $(id).addEventListener('input', whatif));
  whatif();
}
function hashRoute() {
  const h = location.hash;
  if (h === '#evidence') {
    $('tab-evidence').click();
    return;
  }
  const fm = h.match(/#filter=verdict:(FARM|MARGINAL|SKIP)/);
  if (fm) {
    state.verdict = fm[1];
    $('f-verdict').value = fm[1];
    renderBoard();
    return;
  }
  const m = h.match(/#detail=([\w-]+)/);
  if (m) { showDetail(m[1]); $('detail').scrollIntoView(); }
}
window.addEventListener('hashchange', hashRoute);
// ---------- tabs ----------
$('tab-board').addEventListener('click', () => { $('tab-board').classList.add('on'); $('tab-evidence').classList.remove('on'); $('board-view').hidden = false; $('evidence-view').hidden = true; });
$('tab-evidence').addEventListener('click', () => { $('tab-evidence').classList.add('on'); $('tab-board').classList.remove('on'); $('board-view').hidden = true; $('evidence-view').hidden = false; renderEvidence(); });
// ---------- evidence tab ----------
function tbl(head, rows) {
  return '<table><thead><tr>' + head.map((h) => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' + rows.map((r) => '<tr>' + r.map((c) => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
}
let evDone = false;
function renderEvidence() {
  if (evDone) return; evDone = true;
  const m = M.models, ab = M.ablations;
  const modRow = (x) => [x.label, xf(x.medLOO), xf(x.meanLOO), xf(x.medWF), xf(x.meanWF), x.wfCutsMed.map((v) => v.toFixed(2)).join(' '), xf(x.med35), xf(x.mean35)];
  let h = '<h2>1 · Models compared (held out, 92 traded comps)</h2>';
  h += '<p>Selection rule, frozen before seeing results: lowest <b>mean walk-forward</b> wins; tie &lt;0.10x → lowest median LOO; still tied → B. Rule picks <b>A lam30</b>. WF = 3 time cuts (40/50/67% oldest as train) averaged. Newest-35 = train all but newest 35, test newest 35.</p>';
  h += tbl(['Model', 'med LOO', 'mean LOO', 'med WF', 'mean WF', 'WF cuts (med)', 'med newest-35', 'mean newest-35'],
    [modRow(m.A).concat([]), modRow(m.B), modRow(m.C), modRow(m.flat)].map((r, i) => i === 0 ? ['<b>' + r[0] + ' — KEPT</b>'].concat(r.slice(1)) : r));
  h += '<h3>Inner-LOO lambda (per WF train fold, median LOO)</h3>';
  h += tbl(['Cut', 'lam 1', 'lam 3', 'lam 10', 'lam 30', 'lam 100', 'lam 300'],
    M.innerLoo.map((c) => [c.cut].concat(c.rows.map((r) => xf(r.med)))));
  h += '<h2>2 · Ablation (ridge lam30 unless noted)</h2>';
  h += '<p>Size alone is ×/5.40 median LOO; adding category and growth is what makes A. Every extra factor was tested and <b>not</b> adopted: age and chains do not improve mean WF, the placebo random feature adds nothing, and the sign-flip is inconclusive because the growth coefficient is only −0.09 (see D-05). The maturity/growth multipliers improve the median but fatten the tail (D-32).</p>';
  const abRow = (k, label, note) => { const a = ab[k]; return [label, xf(a.medLOO), xf(a.meanLOO), xf(a.medWF), xf(a.meanWF), note]; };
  h += tbl(['Variant', 'med LOO', 'mean LOO', 'med WF', 'mean WF', 'Outcome'],
    [abRow('size', 'size only', '—'), abRow('size+cat', 'size + category', '—'),
     ['<b>size + category + growth (A)</b>', xf(ab['size+cat+growth'].medLOO), xf(ab['size+cat+growth'].meanLOO), xf(ab['size+cat+growth'].medWF), xf(ab['size+cat+growth'].meanWF), '<span class="kept">KEPT — board model</span>'],
     abRow('size+cat+growth+age', '+ age', 'NOT ADOPTED'), abRow('size+cat+growth+chains', '+ chains', 'NOT ADOPTED'),
     abRow('size+cat+growth+age+chains', '+ age + chains', 'NOT ADOPTED'),
     abRow('placebo', '+ random feature', 'NOT ADOPTED — mean WF ' + xf(ab.placebo.meanWF) + ' vs A ' + xf(ab['size+cat+growth'].meanWF) + '; the random feature adds nothing'),
     abRow('signflip', 'growth input sign-flipped at prediction (no refit)', 'INCONCLUSIVE — mean WF ' + xf(ab.signflip.meanWF) + ' (A ' + xf(ab['size+cat+growth'].meanWF) + '); medLOO ' + xf(ab.signflip.medLOO) + ' vs ' + xf(ab['size+cat+growth'].medLOO) + ', medWF ' + xf(ab.signflip.medWF) + ' vs ' + xf(ab['size+cat+growth'].medWF) + '. Growth coef is only −0.09, so its sign barely matters (D-05)')]);
  h += '<h3>Maturity / growth multipliers on A (D-31, D-32, D-26)</h3>';
  h += tbl(['Variant', 'med LOO', 'mean LOO', 'med WF', 'mean WF', 'Outcome'],
    [modRow(m.sqrtMat).slice(0, 5).concat(['NOT ADOPTED']), modRow(m.linMat).slice(0, 5).concat(['NOT ADOPTED']),
     modRow(m.asym).slice(0, 5).concat(['NOT ADOPTED']),
     modRow(m.combo).slice(0, 5).concat(['<span class="not">NOT ADOPTED — median better, tail fatter (D-32)</span>'])]);
  h += '<h2>3 · Flat vs A, and what the model can actually do (D-06, D-12)</h2>';
  h += '<p>A is only ~10% better than the flat median on walk-forward and nearly flat on LOO (×/3.43 vs ×/3.42) — the honest framing: TVL ranks, but the ranking signal is weak (R2 ' + M.r2.r2A.toFixed(3) + ', Spearman LOO ' + M.spearmanLooA.toFixed(3) + '). A random-feature control with the same dimension scores R2 ' + M.r2.r2Rand.map((v) => v.toFixed(2)).join(' / ') + ' vs A ' + M.r2.r2A.toFixed(3) + ' and flat ' + M.r2.r2Flat.toFixed(3) + ' — the signal is small but real, not a random-feature artefact.</p>';
  h += tbl(['Model', 'med LOO', 'mean LOO', 'med WF', 'mean WF', 'Spearman LOO'],
    [[m.A.label, xf(m.A.medLOO), xf(m.A.meanLOO), xf(m.A.medWF), xf(m.A.meanWF), M.spearmanLooA.toFixed(3)],
     [m.flat.label, xf(m.flat.medLOO), xf(m.flat.meanLOO), xf(m.flat.medWF), xf(m.flat.meanWF), '—'],
     ['B lam3 (multiple)', xf(m.B.medLOO), xf(m.B.meanLOO), xf(m.B.medWF), xf(m.B.meanWF), M.spearmanLooB.toFixed(3)]]);
  h += '<p>Growth does not predict the multiple: Pearson r(7d growth, log multiple) = ' + M.d05.pearson.toFixed(2) + ', Spearman ' + M.d05.spearman.toFixed(2) + ', standardised growth coefficient ' + M.d05.stdGrowthCoef.toFixed(2) + ' (D-05). The literature agrees: TVL does not predict return (D-35), and the Metcalfe elasticity here is 0.56–0.62 while Spearman log TVL vs log mcap is ' + M.d28.spearmanTvlMcap.toFixed(3) + ' vs 0.87 in the literature (D-36) — this snapshot is far noisier than the papers’ samples.</p>';
  h += '<h2>4 · Launch odds (D-10 base: 50% rich logistic + 30% empirical + 20% base rate)</h2>';
  h += '<p>Per-row odds come from the full fit; the formulation — not the per-row numbers — is what was walk-forward tested. Base rate: ' + pct(M.odds.baseRate, 1) + ' of all 758 protocols have a token.</p>';
  h += tbl(['WF cut', 'Brier ensemble', 'Brier logistic only', 'Brier base', 'Called-right ens.', 'Called-right logit', 'Tier actuals L/M/H'],
    M.odds.wf.cuts.map((c, i) => [['40/60', '50/50', '67/33'][i], c.brier.toFixed(3), c.brierLogit.toFixed(3), c.base.toFixed(3), pct(c.calledRight, 0), pct(c.calledRightLogit, 0), c.tiers.map((t) => pct(t, 0)).join(' / ')]));
  h += '<p>Pooled tier actuals (WF): HIGH ' + pct(M.odds.tierActuals.HIGH, 0) + ' · MED ' + pct(M.odds.tierActuals.MED, 0) + ' · LOW ' + pct(M.odds.tierActuals.LOW, 0) + '. Board tiers: HIGH ' + M.odds.tiersOnBoard.HIGH + ' · MED ' + M.odds.tiersOnBoard.MED + ' · LOW ' + M.odds.tiersOnBoard.LOW + '.</p>';
  h += '<h2>5 · Ranges (split-conformal, factors re-searched in-entry)</h2>';
  const rg = M.ranges;
  h += '<p>Widening factors re-searched on WF folds (cuts 50/67): inner ×' + rg.kIn + ' → ' + pct(rg.covIn, 0) + '% (target 50), outer ×' + rg.kOut + ' → ' + pct(rg.covOut, 0) + '% (target 80). Factors picked on WF residuals; coverage measured on the same WF folds. Train half-widths: q50 = ' + rg.q50.toFixed(3) + ' dex, q80 = ' + rg.q80.toFixed(3) + ' dex.</p>';
  h += tbl(['Test', 'Inner cov.', 'Outer cov.', 'Detail'],
    [['Clean-cut (train oldest 67%, n=' + rg.cleanCut.n + ')', pct(rg.cleanCut.covIn, 0), pct(rg.cleanCut.covOut, 0), 'per-TVL inner ' + rg.cleanCut.byTvl.inner.map((v) => pct(v, 0)).join('/') + ' · outer ' + rg.cleanCut.byTvl.outer.map((v) => pct(v, 0)).join('/') + ' · median |err| low ' + xf(rg.cleanCut.byTvl.medErr[0]) + ' vs high ' + xf(rg.cleanCut.byTvl.medErr[2])],
     ['Single time-split 50/50', 'med ' + xf(rg.timeSplit50.med), 'mean ' + xf(rg.timeSplit50.mean), 'D-02'],
     ['Single time-split 67/33', 'med ' + xf(rg.timeSplit67.med), 'mean ' + xf(rg.timeSplit67.mean), 'D-02'],
     ['Jackknife+ (D-45)', pct(rg.jackknifePlus.covIn, 0), pct(rg.jackknifePlus.covOut, 0), 'median half-width inner ' + xf(rg.jackknifePlus.widthIn) + ' · outer ' + xf(rg.jackknifePlus.widthOut)],
     ['Mondrian, 0% shrink (D-42)', pct(rg.mondrian.covIn0, 0), pct(rg.mondrian.covOut0, 0), 'by tercile inner ' + rg.mondrian.byTercileIn0.map((v) => pct(v, 0)).join('/') + ' · widths x/' + rg.mondrian.widthIn0.toFixed(2) + ' / x/' + rg.mondrian.widthOut0.toFixed(2)],
     ['Mondrian, 50% shrink (D-42)', pct(rg.mondrian.covIn05, 0), pct(rg.mondrian.covOut05, 0), 'shrunk halfway to the global quantile'],
     ['CQR-lite inner 50% (D-46)', rg.cqr.inner.ok ? pct(rg.cqr.inner.cov, 0) : 'not reported', 'width x/' + rg.cqr.inner.width.toFixed(2), 'Q=' + rg.cqr.inner.Q.toFixed(3) + ' · train fracs lo ' + rg.cqr.inner.fracLo.toFixed(2) + ' hi ' + rg.cqr.inner.fracHi.toFixed(2) + (rg.cqr.inner.ok ? '' : ' — outside the ±0.15 gate, so no coverage is claimed')],
     ['CQR-lite outer 80% (D-46)', rg.cqr.outer.ok ? pct(rg.cqr.outer.cov, 0) : 'not reported', 'width x/' + rg.cqr.outer.width.toFixed(2), 'Q=' + rg.cqr.outer.Q.toFixed(3) + ' · train fracs lo ' + rg.cqr.outer.fracLo.toFixed(2) + ' hi ' + rg.cqr.outer.fracHi.toFixed(2) + ' · verdict: ' + esc(rg.cqr.verdict)],
     ['Normalised score (D-43)', pct(rg.d43.covIn, 0), pct(rg.d43.covOut, 0), 'σ(' + esc(rg.d43.strongest) + ') = ' + rg.d43.a.toFixed(3) + (rg.d43.b >= 0 ? '+' : '') + rg.d43.b.toFixed(3) + '·z · widths x/' + rg.d43.widthIn.toFixed(2) + ' / x/' + rg.d43.widthOut.toFixed(2)]]);
  h += '<p>Coverage is uneven by TVL (D-01, D-41): the clean cut covers 40/30/73% inner by low→high TVL tercile — the range is honest about being worst where TVL is smallest. |resid| falls with growth (D-43): strongest feature ' + esc(rg.d43.strongest) + ' (Pearson ' + rg.d43.cors[rg.d43.strongest].pearson.toFixed(2) + ', Spearman ' + rg.d43.cors[rg.d43.strongest].spearman.toFixed(2) + '; all four: ' + Object.keys(rg.d43.cors).map((k) => k + ' ' + rg.d43.cors[k].pearson.toFixed(2) + '/' + rg.d43.cors[k].spearman.toFixed(2)).join(', ') + '), driven by one outlier (' + esc(rg.d43.outlier) + '). The normalised band (σ(' + esc(rg.d43.strongest) + ') = ' + rg.d43.a.toFixed(3) + (rg.d43.b >= 0 ? '+' : '') + rg.d43.b.toFixed(3) + '·z) covers ' + pct(rg.d43.covIn, 0) + '% inner / ' + pct(rg.d43.covOut, 0) + '% outer — it does not fix the unevenness. The Soloviov conditional-coverage paragraph (D-75): coverage under-covers by ~8 points where comps are thin, so the outer band is the one to trust.</p>';
  h += '<h2>6 · Curve duel (D-52)</h2>';
  h += tbl(['Model', 'med LOO', 'mean LOO', 'med WF', 'mean WF', 'Board top-1', 'Board total'],
    [[m.A.label, xf(m.A.medLOO), xf(m.A.meanLOO), xf(m.A.medWF), xf(m.A.meanWF), money(M.board.top1), moneyB(M.board.total)],
     ['curve-only', xf(m.curve.medLOO), xf(m.curve.meanLOO), xf(m.curve.medWF), xf(m.curve.meanWF), money(M.variants.curve.top1), moneyB(M.variants.curve.total)],
     ['curve + maturity', xf(m.curveMat.medLOO), xf(m.curveMat.meanLOO), xf(m.curveMat.medWF), xf(m.curveMat.meanWF), '—', '—'],
     ['curve + growth', xf(m.curveGrowth.medLOO), xf(m.curveGrowth.meanLOO), xf(m.curveGrowth.medWF), xf(m.curveGrowth.meanWF), '—', '—'],
     ['curve + growth + maturity', xf(m.fullCurve.medLOO), xf(m.fullCurve.meanLOO), xf(m.fullCurve.medWF), xf(m.fullCurve.meanWF), money(M.variants.fullCurve.top1), moneyB(M.variants.fullCurve.total)]]);
  h += '<p>Curve-only wins the median (medLOO ' + xf(m.curve.medLOO) + ' vs A ' + xf(m.A.medLOO) + ') but loses the mean WF (' + xf(m.curve.meanWF) + ' vs ' + xf(m.A.meanWF) + ') — the selection rule is mean WF, so A stays. Curve board vs A: Spearman ' + M.variants.curve.spearmanVsA.toFixed(2) + ', top-10 overlap ' + M.variants.curve.top10Overlap + '/10.</p>';
  h += '<h2>7 · Category multiples (D-28) and anchors (D-58)</h2>';
  h += '<p>Global median multiple ' + M.d28.globalMed.toFixed(2) + 'x. Shares: &lt;1x ' + pct(M.d28.lt1, 0) + ' · 1–5x ' + pct(M.d28.oneTo5, 0) + ' · &gt;5x ' + pct(M.d28.gt5, 0) + ' · &gt;10x ' + pct(M.d28.gt10, 0) + '.</p>';
  h += tbl(['Category', 'n', 'Median multiple'],
    M.d28.rows.map((r) => [esc(r.cat), String(r.n), r.med.toFixed(2) + 'x']));
  h += '<h3>Anchors — top 3 traded comps per category by multiple</h3>';
  h += M.d58.anchors.map((a) => '<p><b>' + esc(a.cat) + ':</b> ' + a.comps.map((c) => esc(c.name) + ' ' + c.mult.toFixed(1) + 'x').join(' · ') + '</p>').join('');
  h += '<p>CEX note: median CEX multiple ' + M.d58.cex.med.toFixed(2) + 'x (n=' + M.d58.cex.n + '); Nexo ' + M.d58.cex.nexoMult.toFixed(1) + 'x — the outlier that proves CEX is not a valuation category.</p>';
  h += '<h2>8 · Verdict sensitivity</h2>';
  h += '<p>Break-even capital (D-03): ' + M.d03.finite + ' rows finite / ' + M.d03.never + ' never, median ' + money(M.d03.median) + '. Walk-away TVL (D-04, FARM rows): median ' + M.d04.med.toFixed(2) + 'x, p10 ' + M.d04.p10.toFixed(2) + 'x, p90 ' + M.d04.p90.toFixed(2) + 'x, fragile (&lt;2x) ' + M.d04.fragile + '/' + M.d04.n + '. EV/cost (D-50): median ' + M.d50.median.toFixed(2) + 'x, p90 ' + M.d50.p90.toFixed(2) + 'x, max ' + M.d50.max.toFixed(2) + 'x; &gt;1x: ' + M.d50.gt1 + ' rows, &gt;3x: ' + M.d50.gt3 + ' rows. Top EV/cost: ' + M.d50.top5.map((t) => esc(t.name) + ' ' + t.ev.toFixed(1) + 'x').join(' · ') + '.</p>';
  h += tbl(['Vesting (D-47)', 'PV factor', 'FARM / MARGINAL / SKIP'],
    M.d47.map((v) => [v.label, v.pv.toFixed(2), v.counts.FARM + ' / ' + v.counts.MARGINAL + ' / ' + v.counts.SKIP]));
  h += tbl(['Log-share (D-49)', 'FARM / MARGINAL / SKIP'],
    M.d49.map((v) => ['$' + v.plan.toLocaleString('en-US'), v.counts.FARM + ' / ' + v.counts.MARGINAL + ' / ' + v.counts.SKIP]));
  h += tbl(['Value factor (D-48)', 'FARM / MARGINAL / SKIP', 'Note'],
    M.d48.map((v) => ['x' + v.factor, v.counts.FARM + ' / ' + v.counts.MARGINAL + ' / ' + v.counts.SKIP, v.factor === 0.33 ? 'bear survivors: ' + v.survivors.map(esc).join(', ') : v.factor === 1 ? 'base (same as board)' : '']));
  h += '<h3>12-scenario grid (plan × drop, 12 weeks)</h3>';
  h += tbl(['Plan', 'Drop 5%', 'Drop 7%', 'Drop 15%'],
    [1000, 5000, 10000, 25000].map((p) => ['$' + p.toLocaleString('en-US')].concat([0.05, 0.07, 0.15].map((d) => { const s = M.sensGrid.find((x) => x.plan === p && Math.abs(x.drop - d) < 1e-9); return s.counts.FARM + '/' + s.counts.MARGINAL + '/' + s.counts.SKIP; }))));
  h += '<h2>9 · Variants tested, not adopted (D-24, D-25)</h2>';
  h += tbl(['Variant', 'med LOO', 'mean LOO', 'med WF', 'mean WF', 'Board top-1', 'Board total', 'Outcome'],
    [[modRow(m.catShift3).slice(0, 5).concat([money(M.variants.catShift3.top1), moneyB(M.variants.catShift3.total), 'NOT ADOPTED as board model — v11 candidate']),
      modRow(m.catShift8).slice(0, 5).concat([money(M.variants.catShift8.top1), moneyB(M.variants.catShift8.total), 'NOT ADOPTED']),
      modRow(m.prior).slice(0, 5).concat([money(M.variants.prior.top1), moneyB(M.variants.prior.total), 'NOT ADOPTED — Spearman vs A ' + M.variants.prior.spearmanVsA.toFixed(2) + ', top-10 ' + M.variants.prior.top10Overlap + '/10'])]].flat());
  h += '<p>OLS + category-shift k=3 is the only variant beating the board model on mean WF (' + xf(m.catShift3.meanWF) + ' vs A ' + xf(m.A.meanWF) + ') — it stays a v11 candidate, not the board model, because the board model is the one the frozen selection rule picks and the shift adds a second fitting stage the rule did not pre-register.</p>';
  h += '<h2>10 · Disposition (D-62) and ledger</h2>';
  const L = M.ledger;
  h += '<p>' + L.ranked + ' ranked + ' + L.hasToken + ' has token + ' + L.bridge + ' bridge + ' + L.liquidStaking + ' liquid staking + ' + L.exchangeCustody + ' exchange custody + ' + L.versioned + ' versioned + ' + L.wrapped + ' wrapped + ' + L.other + ' other = <b>' + L.total + '</b> protocols. Every protocol in the snapshot is accounted for, in exactly one bucket.</p>';
  h += '<p>Confidence score (D-54): ' + Object.keys(M.confCounts).sort().map((k) => k + ': ' + M.confCounts[k] + ' rows').join(' · ') + '. Age percentiles, days (D-59): all p25/med/p75 ' + M.d59.all.p25 + '/' + M.d59.all.med + '/' + M.d59.all.p75 + ' (n=' + M.d59.all.n + '); pre-token ' + M.d59.pre.p25 + '/' + M.d59.pre.med + '/' + M.d59.pre.p75 + ' (n=' + M.d59.pre.n + ', ' + M.d59.pre.unknown + ' unknown); live-token ' + M.d59.live.p25 + '/' + M.d59.live.med + '/' + M.d59.live.p75 + ' (n=' + M.d59.live.n + ', ' + M.d59.live.unknown + ' unknown).</p>';
  h += '<p>Maturity hump (D-61): the median age of pre-token protocols (' + M.d59.pre.med + 'd) sits well below live-token (' + M.d59.live.med + 'd) — the board is young protocols, and age is not a valuation input precisely because the hump would flatter them. Revenue caveat (D-37): three lenders trade at 0.11x MC/TVL but 4.4x–95.8x P/S — TVL is not revenue, and this model never sees revenue.</p>';
  h += '<h2>11 · Integrity</h2>';
  h += '<p>Board total ' + money(M.board.total) + ' = sum of board.json rows to the last dollar. Farm steps: ' + M.farmStepsCheck.total + ' steps, unique = ' + M.farmStepsCheck.unique + ', length 20–600 = ' + M.farmStepsCheck.lenOk + ', 3–12 per row = ' + M.farmStepsCheck.perRowOk + '. Bootstrap slope (200 refits): ' + M.bootstrap.slopeMean.toFixed(2) + ' ± ' + M.bootstrap.slopeSd.toFixed(3) + ' (full fit ' + M.bootstrap.slopeFull.toFixed(2) + '); top-20 stability ' + pct(M.bootstrap.top20Stability, 0) + '; rank-range median width ' + M.bootstrap.medWidth + ' ranks. Dossier text holds the dashboard whole; the dossier is under the 1.5 MiB cap. Determinism: two runs of main.ts produce byte-identical board.json, data.js and dossier.json.</p>';
  $('evidence-view').innerHTML = h;
}
// ---------- boot ----------
renderBoard();
hashRoute();
