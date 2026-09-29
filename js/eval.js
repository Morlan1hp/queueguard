/* QueueGuard — batch evaluation: many seeds, ablations and sensitivity analysis.
 * Works in the browser (progress UI) and headless (tools/evaluate.ps1 -> results/results.js). */
(function (root) {
  'use strict';

  var VARIANTS = {
    'static':        { label: 'Static signs', opt: { strategy: 'static' } },
    'fixedqws':      { label: 'Fixed-position QWS', opt: { strategy: 'fixedqws' } },
    'queueguard':    { label: 'QueueGuard', opt: { strategy: 'queueguard' } },
    'qg-novsl':      { label: 'QueueGuard without VSL', opt: { strategy: 'queueguard', useVSL: false } },
    'qg-nopred':     { label: 'QueueGuard without prediction', opt: { strategy: 'queueguard', usePrediction: false } }
  };

  var METRICS = [
    ['eoqConflictsPerHour', 'Severe EoQ conflicts per hour', 2],
    ['collisionsPerHour', 'EoQ collisions per hour', 3],
    ['ttcExposurePerHour', 'Time exposed to TTC < 3 s (s per hour)', 0],
    ['approachSpeedP85', 'Arrival speed at the queue, 85th pct (km/h)', 1],
    ['timelyWarningShare', 'Queue joiners warned 150–1500 m ahead', 3],
    ['queueTimeUncoveredShare', 'Queue time with no timely warning', 3],
    ['dynamicWarningCredibility', 'Dynamic warning credibility', 3],
    ['throughputPerHour', 'Throughput (veh/h)', 0],
    ['meanTravelTime', 'Mean travel time (s)', 0],
    ['maxQueueLength', 'Max queue length (m)', 0],
    ['tailPredMAE', 'Tail error, predicted +90 s (m)', 0],
    ['tailNowMAE', 'Tail error, no prediction (m)', 0],
    ['warnOverrunPred', 'Tail overran the warning point (predicted placement)', 3],
    ['warnOverrunNow', 'Tail overran the warning point (current-tail placement)', 3]
  ];

  function experiments(n) {
    var list = [];
    // 1. main comparison + ablations
    ['static', 'fixedqws', 'queueguard', 'qg-novsl', 'qg-nopred'].forEach(function (v) {
      list.push({ exp: 'main', group: v, variant: v, param: null, seeds: n });
    });
    // 2. sensitivity: chance a driver notices a warning
    [0.2, 0.4, 0.6, 0.8].forEach(function (p) {
      ['static', 'queueguard'].forEach(function (v) {
        list.push({ exp: 'pNotice', group: v, variant: v, param: { pNotice: p }, x: p, seeds: Math.ceil(n / 2) });
      });
    });
    // 3. sensitivity: how far ahead unwarned drivers recognise stopped traffic
    [[100, 200], [150, 300], [250, 450]].forEach(function (r) {
      ['static', 'queueguard'].forEach(function (v) {
        list.push({ exp: 'recog', group: v, variant: v, param: { recogMin: r[0], recogMax: r[1] }, x: r[0] + '–' + r[1] + ' m', seeds: Math.ceil(n / 2) });
      });
    });
    // 4. sensitivity: peak demand (queue length)
    [1600, 1800, 2000].forEach(function (d) {
      ['static', 'queueguard'].forEach(function (v) {
        list.push({ exp: 'demand', group: v, variant: v, param: { demandPeak: d }, x: d, seeds: Math.ceil(n / 2) });
      });
    });
    return list;
  }

  function runOne(cell, seed) {
    var opt = QG.merge(VARIANTS[cell.variant].opt, cell.param || {});
    opt.seed = seed;
    var r = QG.runScenario(opt);
    var h = r.simHours;
    r.collisionsPerHour = r.collisions / h;
    r.ttcExposurePerHour = r.ttcExposure / h;
    delete r.collisionXs; delete r.conflictXs; delete r.conflictTs;
    return r;
  }

  function stats(vals) {
    var a = vals.filter(function (v) { return v !== null && v !== undefined && v === v; });
    if (!a.length) return null;
    var n = a.length, m = 0, i;
    for (i = 0; i < n; i++) m += a[i];
    m /= n;
    var ss = 0; for (i = 0; i < n; i++) ss += (a[i] - m) * (a[i] - m);
    var sd = n > 1 ? Math.sqrt(ss / (n - 1)) : 0;
    return { mean: m, sd: sd, n: n, ci: 1.96 * sd / Math.sqrt(n) };
  }

  function summarise(cell, runs) {
    var out = { exp: cell.exp, group: cell.group, variant: cell.variant, label: VARIANTS[cell.variant].label, x: cell.x, param: cell.param, n: runs.length, m: {} };
    METRICS.forEach(function (mt) { out.m[mt[0]] = stats(runs.map(function (r) { return r[mt[0]]; })); });
    out.totals = {
      conflicts: runs.reduce(function (s, r) { return s + r.eoqConflicts; }, 0),
      collisions: runs.reduce(function (s, r) { return s + r.collisions; }, 0),
      hours: runs.reduce(function (s, r) { return s + r.simHours; }, 0)
    };
    return out;
  }

  // synchronous run (headless)
  function runAllSync(n, only) {
    var cells = experiments(n).filter(function (c) { return !only || only.indexOf(c.exp) >= 0; });
    return cells.map(function (c) {
      var runs = [];
      for (var s = 1; s <= c.seeds; s++) runs.push(runOne(c, s));
      return summarise(c, runs);
    });
  }

  // asynchronous run with progress callback (browser UI)
  function runAllAsync(n, only, onProgress, onDone) {
    var cells = experiments(n).filter(function (c) { return !only || only.indexOf(c.exp) >= 0; });
    var total = cells.reduce(function (s, c) { return s + c.seeds; }, 0), done = 0;
    var results = [], ci = 0, seed = 1, runs = [];
    function tick() {
      var t0 = performance.now();
      while (performance.now() - t0 < 60 && ci < cells.length) {
        runs.push(runOne(cells[ci], seed)); done++; seed++;
        if (seed > cells[ci].seeds) { results.push(summarise(cells[ci], runs)); ci++; seed = 1; runs = []; }
      }
      onProgress(done, total);
      if (ci < cells.length) setTimeout(tick, 0); else onDone(results);
    }
    tick();
  }

  root.QGEval = { VARIANTS: VARIANTS, METRICS: METRICS, experiments: experiments, runAllSync: runAllSync, runAllAsync: runAllAsync, stats: stats };
})(window);
