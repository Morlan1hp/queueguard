(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var $ = function (id) { return document.getElementById(id); };

  // headless batch mode: ?headless=1&n=40&exp=main,pNotice
  if (params.get('headless') === '1') {
    var n = +(params.get('n') || 20), only = params.get('exp') ? params.get('exp').split(',') : null;
    var t0 = performance.now();
    var res = QGEval.runAllSync(n, only);
    $('out').textContent = JSON.stringify({ n: n, ms: Math.round(performance.now() - t0), results: res });
    return;
  }
  if (params.get('repo')) $('assump').href = params.get('repo') + '/blob/main/docs/ASSUMPTIONS.md';

  var COLORS = { 'static': '#8A949E', 'fixedqws': '#B8C0C8', 'queueguard': '#F5A623', 'qg-novsl': '#C98A1E', 'qg-nopred': '#E3B566' };
  var ORDER = ['static', 'fixedqws', 'queueguard', 'qg-novsl', 'qg-nopred'];

  function fmt(s, d) {
    if (!s) return '–';
    return s.mean.toFixed(d) + ' <span class="muted">± ' + s.ci.toFixed(d) + '</span>';
  }
  function pct(s) { return s ? (s.mean * 100).toFixed(1) + '% <span class="muted">± ' + (s.ci * 100).toFixed(1) + '</span>' : '–'; }

  function bars(el, rows, key, opt) {
    opt = opt || {};
    var W = 640, H = 230, ml = 240, mr = 70, bh = 26, gap = 12, top = 10;
    var max = 0;
    rows.forEach(function (r) { var s = r.m[key]; if (s) max = Math.max(max, (s.mean + s.ci) * (opt.scale || 1)); });
    if (!max) max = 1;
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + key + '">';
    rows.forEach(function (r, i) {
      var s = r.m[key]; if (!s) return;
      var y = top + i * (bh + gap), sc = opt.scale || 1;
      var w = (W - ml - mr) * s.mean * sc / max, e = (W - ml - mr) * s.ci * sc / max;
      svg += '<text x="' + (ml - 10) + '" y="' + (y + bh / 2 + 5) + '" fill="#C9CFD6" font-size="14" text-anchor="end" font-family="IBM Plex Sans, Arial">' + r.label + '</text>';
      svg += '<rect x="' + ml + '" y="' + y + '" width="' + Math.max(1, w) + '" height="' + bh + '" rx="3" fill="' + (COLORS[r.variant] || '#888') + '"/>';
      svg += '<line x1="' + (ml + w - e) + '" x2="' + (ml + w + e) + '" y1="' + (y + bh / 2) + '" y2="' + (y + bh / 2) + '" stroke="#E8EAED" stroke-width="2"/>';
      var label = opt.pct ? (s.mean * 100).toFixed(0) + '%' : s.mean.toFixed(opt.d || 0);
      svg += '<text x="' + (ml + w + e + 8) + '" y="' + (y + bh / 2 + 5) + '" fill="#E8EAED" font-size="14" font-family="IBM Plex Sans, Arial">' + label + '</text>';
    });
    el.innerHTML = svg + '</svg>';
  }

  function grouped(el, cells, key, opt) {
    opt = opt || {};
    var xs = [];
    cells.forEach(function (c) { if (xs.indexOf(String(c.x)) < 0) xs.push(String(c.x)); });
    var W = 600, H = 250, ml = 50, mb = 44, mt = 14, pw = W - ml - 20, ph = H - mt - mb;
    var max = 0;
    cells.forEach(function (c) { var s = c.m[key]; if (s) max = Math.max(max, s.mean + s.ci); });
    if (!max) max = 1;
    var gw = pw / xs.length, bw = gw * 0.32;
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    for (var g = 0; g <= 4; g++) {
      var yy = mt + ph - ph * g / 4;
      svg += '<line x1="' + ml + '" x2="' + (W - 20) + '" y1="' + yy + '" y2="' + yy + '" stroke="#28303A"/>';
      svg += '<text x="' + (ml - 6) + '" y="' + (yy + 4) + '" fill="#98A2AD" font-size="12" text-anchor="end" font-family="IBM Plex Sans, Arial">' + (max * g / 4).toFixed(opt.d || 0) + '</text>';
    }
    xs.forEach(function (x, i) {
      ['static', 'queueguard'].forEach(function (v, j) {
        var c = cells.filter(function (cc) { return String(cc.x) === x && cc.variant === v; })[0];
        if (!c || !c.m[key]) return;
        var s = c.m[key], h = ph * s.mean / max, e = ph * s.ci / max;
        var bx = ml + gw * i + gw / 2 - bw + j * bw;
        svg += '<rect x="' + bx + '" y="' + (mt + ph - h) + '" width="' + (bw - 4) + '" height="' + Math.max(1, h) + '" rx="3" fill="' + COLORS[v] + '"/>';
        svg += '<line x1="' + (bx + bw / 2 - 2) + '" x2="' + (bx + bw / 2 - 2) + '" y1="' + (mt + ph - h - e) + '" y2="' + (mt + ph - h + e) + '" stroke="#E8EAED" stroke-width="2"/>';
      });
      svg += '<text x="' + (ml + gw * i + gw / 2) + '" y="' + (H - mb + 20) + '" fill="#C9CFD6" font-size="13" text-anchor="middle" font-family="IBM Plex Sans, Arial">' + (opt.xfmt ? opt.xfmt(x) : x) + '</text>';
    });
    svg += '<rect x="' + (ml + 4) + '" y="' + (H - 16) + '" width="12" height="12" fill="' + COLORS['static'] + '"/><text x="' + (ml + 22) + '" y="' + (H - 6) + '" fill="#C9CFD6" font-size="12" font-family="IBM Plex Sans, Arial">Static signs</text>';
    svg += '<rect x="' + (ml + 124) + '" y="' + (H - 16) + '" width="12" height="12" fill="' + COLORS['queueguard'] + '"/><text x="' + (ml + 142) + '" y="' + (H - 6) + '" fill="#C9CFD6" font-size="12" font-family="IBM Plex Sans, Arial">QueueGuard</text>';
    svg += '<text x="' + (W - 20) + '" y="' + (H - 6) + '" fill="#98A2AD" font-size="12" text-anchor="end" font-family="IBM Plex Sans, Arial">' + (opt.ylabel || '') + '</text>';
    el.innerHTML = svg + '</svg>';
  }

  function show(data, source) {
    var res = data.results;
    var main = ORDER.map(function (v) { return res.filter(function (r) { return r.exp === 'main' && r.variant === v; })[0]; }).filter(Boolean);
    var by = {}; main.forEach(function (r) { by[r.variant] = r; });
    // headline
    var st = by['static'], qg = by['queueguard'], fx = by['fixedqws'];
    if (st && qg) {
      var a = st.m.eoqConflictsPerHour.mean, b = qg.m.eoqConflictsPerHour.mean;
      var red = a > 0 ? Math.round((1 - b / a) * 100) : 0;
      var ap = st.m.approachSpeedP85.mean - qg.m.approachSpeedP85.mean;
      $('headline').innerHTML = 'Across <b>' + qg.n + ' seeds</b> (' + qg.totals.hours.toFixed(0) + ' simulated hours per variant), QueueGuard cut severe end-of-queue conflicts from <b>' +
        a.toFixed(2) + '</b> to <b>' + b.toFixed(2) + '</b> per hour (<b>−' + red + '%</b>), lowered the 85th-percentile arrival speed at the queue by <b>' + ap.toFixed(0) + ' km/h</b>, ' +
        'and left <b>' + (qg.m.queueTimeUncoveredShare.mean * 100).toFixed(0) + '%</b> of queue time without a timely warning versus <b>' + (st.m.queueTimeUncoveredShare.mean * 100).toFixed(0) + '%</b> with static signs' +
        (fx ? ' and <b>' + (fx.m.queueTimeUncoveredShare.mean * 100).toFixed(0) + '%</b> with a fixed-position queue warning system' : '') +
        ' — with throughput of ' + qg.m.throughputPerHour.mean.toFixed(0) + ' vs ' + st.m.throughputPerHour.mean.toFixed(0) + ' veh/h.';
    }
    // table
    var cols = [['eoqConflictsPerHour', 2], ['collisionsPerHour', 3], ['ttcExposurePerHour', 0], ['approachSpeedP85', 1], ['timelyWarningShare', 'p'], ['queueTimeUncoveredShare', 'p'], ['dynamicWarningCredibility', 'p'], ['throughputPerHour', 0], ['meanTravelTime', 0]];
    var head = '<tr><th>Variant</th><th>Severe EoQ conflicts /h</th><th>EoQ collisions /h</th><th>TTC&lt;3 s exposure (s/h)</th><th>Arrival speed p85</th><th>Warned in time</th><th>Queue time uncovered</th><th>Warning credibility</th><th>Throughput veh/h</th><th>Travel time s</th></tr>';
    var body = main.map(function (r) {
      return '<tr class="' + (r.variant === 'queueguard' ? 'qg' : '') + '"><td>' + r.label + '</td>' + cols.map(function (c) {
        var s = r.m[c[0]]; return '<td>' + (c[1] === 'p' ? pct(s) : fmt(s, c[1])) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    $('main').innerHTML = head + body;
    bars($('c-conf'), main, 'eoqConflictsPerHour', { d: 2 });
    bars($('c-app'), main, 'approachSpeedP85', { d: 0 });
    bars($('c-unc'), main, 'queueTimeUncoveredShare', { pct: true });
    bars($('c-thr'), main, 'throughputPerHour', { d: 0 });
    grouped($('s-pn'), res.filter(function (r) { return r.exp === 'pNotice'; }), 'eoqConflictsPerHour', { d: 2, ylabel: 'severe conflicts / h', xfmt: function (x) { return Math.round(x * 100) + '% notice'; } });
    grouped($('s-rec'), res.filter(function (r) { return r.exp === 'recog'; }), 'eoqConflictsPerHour', { d: 2, ylabel: 'severe conflicts / h' });
    grouped($('s-dem'), res.filter(function (r) { return r.exp === 'demand'; }), 'eoqConflictsPerHour', { d: 2, ylabel: 'severe conflicts / h', xfmt: function (x) { return x + ' veh/h'; } });
    var qgm = by['queueguard'];
    if (qgm) {
      var rows = [
        { label: 'Placed on current tail', variant: 'qg-nopred', m: { e: qgm.m.warnOverrunNow } },
        { label: 'Placed on predicted tail', variant: 'queueguard', m: { e: qgm.m.warnOverrunPred } }
      ];
      bars($('s-pred'), rows, 'e', { pct: true });
      $('s-pred-note').textContent = 'Mean absolute tail error after 90 s: ' + (qgm.m.tailNowMAE ? qgm.m.tailNowMAE.mean.toFixed(0) : '–') + ' m (current estimate) vs ' +
        (qgm.m.tailPredMAE ? qgm.m.tailPredMAE.mean.toFixed(0) : '–') + ' m (prediction). The error is dominated by the 400 m detector spacing; the prediction mainly moves warnings upstream while the queue grows.';
    }
    $('src').textContent = source;
    $('meta').textContent = 'Seeds per main variant: ' + (st ? st.n : '?') + '. Sensitivity cells use half as many seeds. Mean ± 95% confidence interval (normal approximation). ' +
      (data.generated ? 'Generated ' + data.generated + '.' : '') + (data.ms ? ' Compute time ' + (data.ms / 1000).toFixed(0) + ' s.' : '');
  }

  if (window.QG_RESULTS) show(window.QG_RESULTS, 'Showing pre-computed results (results/results.js).');
  else $('headline').textContent = 'No pre-computed results found — press "Re-run in this browser".';

  $('rerun').onclick = function () {
    var n = +$('n').value, prog = $('prog'), btn = this, t0 = performance.now();
    prog.hidden = false; btn.disabled = true;
    QGEval.runAllAsync(n, null, function (d, t) { prog.value = d / t; $('src').textContent = 'Running ' + d + ' / ' + t + ' simulations…'; },
      function (res) { btn.disabled = false; prog.hidden = true; show({ results: res, ms: performance.now() - t0 }, 'Showing results computed in this browser.'); });
  };
})();
