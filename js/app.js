/* QueueGuard — live side-by-side dashboard. */
(function () {
  'use strict';
  var R = window.QGRender;
  var params = new URLSearchParams(location.search);
  var record = params.has('record');
  var state = {
    playing: !record,
    speed: +(params.get('speed') || 20),
    seed: +(params.get('seed') || 9),
    failsafe: params.get('failsafe') === '1'
  };
  var simA, simB, lastWall = 0, lastDom = 0;
  var $ = function (id) { return document.getElementById(id); };

  if (params.get('repo')) $('repo').href = params.get('repo');
  $('ramp').style.background = R.legendGradient();
  $('speed').value = String(state.speed);
  $('seed').value = String(state.seed);
  $('failsafe').checked = state.failsafe;

  function build() {
    simA = new QG.Sim({ seed: state.seed, strategy: 'static' });
    simB = new QG.Sim({ seed: state.seed, strategy: 'queueguard', commsLossAt: state.failsafe ? 1800 : -1 });
    buildDevices();
    render(true);
  }

  function buildDevices() {
    var bh = '', vh = '';
    simB.boards.forEach(function (b, i) {
      bh += '<div><div class="led" id="led' + i + '"><span></span><span></span></div><div class="bcap">VMS km ' + (b.x / 1000).toFixed(1) + '</div></div>';
    });
    simB.vsl.forEach(function (s, i) {
      vh += '<div><div class="vsl blank" id="vsl' + i + '">100</div><div class="bcap">VSL km ' + (s.x / 1000).toFixed(1) + '</div></div>';
    });
    $('boards').innerHTML = bh; $('vsls').innerHTML = vh;
  }

  function mmss(t) {
    var m = Math.floor(t / 60), s = Math.floor(t % 60);
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  function p85(a) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; });
    return s[Math.round(0.85 * (s.length - 1))];
  }
  function live(sim) {
    var m = sim.m, hrs = Math.max(1e-6, (sim.t - sim.cfg.warmup) / 3600);
    return {
      conf: m.conflicts, coll: m.collisions,
      app: p85(m.approachSpeeds),
      timely: m.joins ? m.covered / m.joins : null,
      unc: m.queueTime ? m.uncoveredQueueTime / m.queueTime : null,
      thr: sim.t > sim.cfg.warmup + 120 ? m.exits / hrs : null,
      tet: m.tet
    };
  }
  function pct(v) { return v === null ? '–' : Math.round(v * 100) + '%'; }
  function num(v) { return v === null ? '–' : String(Math.round(v)); }

  function kpiHTML(k) {
    return '' +
      '<div class="kpi"><span class="k">Severe EoQ conflicts</span><span class="v ' + (k.conf ? 'bad' : 'good') + '">' + k.conf + '</span></div>' +
      '<div class="kpi"><span class="k">EoQ collisions</span><span class="v ' + (k.coll ? 'bad' : 'good') + '">' + k.coll + '</span></div>' +
      '<div class="kpi"><span class="k">Drivers warned in time<br>before joining the queue</span><span class="v">' + pct(k.timely) + '</span></div>' +
      '<div class="kpi"><span class="k">Time exposed to TTC &lt; 3 s</span><span class="v">' + Math.round(k.tet) + ' s</span></div>';
  }

  function setScore(id, a, b, fmt) {
    $(id + '-a').firstChild.nodeValue = fmt(a);
    $(id + '-b').firstChild.nodeValue = fmt(b);
  }

  function renderDom() {
    var t = simB.t;
    $('clock').firstChild.nodeValue = 'T+' + mmss(t);
    $('demand').textContent = Math.round(QG.demandAt(simB.cfg, t)) + ' veh/h';
    var a = live(simA), b = live(simB);
    $('kpi-a').innerHTML = kpiHTML(a);
    $('kpi-b').innerHTML = kpiHTML(b);
    setScore('sc-conf', a.conf, b.conf, String);
    setScore('sc-app', a.app, b.app, num);
    setScore('sc-unc', a.unc, b.unc, pct);
    setScore('sc-thr', a.thr, b.thr, num);
    simB.boards.forEach(function (bd, i) {
      var el = $('led' + i); if (!el) return;
      var flash = (bd.level === 'primary' || bd.level === 'fallback') && Math.floor(t * 2) % 2 === 1;
      el.className = 'led' + (bd.level !== 'off' ? ' on' : '') + (bd.warn ? ' warn' : '') + (flash ? ' flash-off' : '') + (bd.level === 'fallback' ? ' fallback' : '');
      el.children[0].textContent = bd.lines[0] || '';
      el.children[1].textContent = bd.lines[1] || '';
    });
    simB.vsl.forEach(function (s, i) {
      var el = $('vsl' + i); if (!el) return;
      el.textContent = s.v ? String(s.v) : '100';
      el.className = 'vsl' + (s.v ? '' : ' blank');
    });
    var c = simB.ctrl, btn = $('uhf-btn');
    if (c.uhfDraft) {
      $('uhf-text').textContent = (c.uhfActive ? 'Broadcasting: ' : 'Draft: ') + '"' + c.uhfDraft.text + '"';
      btn.disabled = !!c.uhfActive; btn.textContent = c.uhfActive ? 'On air' : 'Confirm';
    } else {
      $('uhf-text').textContent = c.failsafe ? 'Fail-safe active — manual control.' : 'No message drafted.';
      btn.disabled = true; btn.textContent = 'Confirm';
    }
    var items = simB.alerts.slice(-7).reverse().map(function (al) {
      return '<li class="l' + al.level + '"><b>T+' + mmss(al.t) + '</b>' + escapeHtml(al.text) + '</li>';
    });
    $('feed').innerHTML = items.join('') || '<li>No alerts yet — traffic is free-flowing.</li>';
  }
  function escapeHtml(s) { return s.replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]; }); }

  function zoomCenter(sim) {
    var tail = sim.tailTrue;
    if (tail === null) tail = simA.tailTrue !== null ? simA.tailTrue : simB.tailTrue;
    return tail === null ? sim.cfg.closureStart - 250 : tail;
  }

  function render(forceDom) {
    R.drawCorridor($('cor-a'), simA);
    R.drawCorridor($('cor-b'), simB);
    R.drawZoom($('zoom-a'), simA, zoomCenter(simA));
    R.drawZoom($('zoom-b'), simB, zoomCenter(simB));
    R.drawTimeSpace($('ts'), simB);
    var now = performance.now();
    if (forceDom || now - lastDom > 200) { renderDom(); lastDom = now; }
  }

  function advanceTo(t) {
    simA.runUntil(t); simB.runUntil(t);
  }

  function frame(now) {
    if (!lastWall) lastWall = now;
    var dt = Math.min(0.1, (now - lastWall) / 1000); lastWall = now;
    if (state.playing) {
      advanceTo(simB.t + dt * state.speed);
      if (simB.done()) { state.playing = false; $('play').textContent = 'Play'; }
    }
    render(false);
    requestAnimationFrame(frame);
  }

  $('play').onclick = function () {
    if (simB.done()) build();
    state.playing = !state.playing; this.textContent = state.playing ? 'Pause' : 'Play';
  };
  $('speed').onchange = function () { state.speed = +this.value; };
  $('restart').onclick = function () { state.seed = +$('seed').value || 1; state.failsafe = $('failsafe').checked; build(); };
  $('uhf-btn').onclick = function () {
    var c = simB.ctrl;
    if (c.uhfDraft && !c.uhfActive) {
      c.uhfActive = true; c.uhfNextBroadcast = simB.t;
      simB.log(2, 'Supervisor confirmed. Broadcasting on UHF CB 40: "' + c.uhfDraft.text + '"');
    }
  };
  window.addEventListener('resize', function () { render(true); });

  build();
  if (params.has('t')) { advanceTo(+params.get('t')); render(true); }
  if (!record) requestAnimationFrame(frame);

  // API used by tools/record.ps1 to capture the demo video frame by frame
  window.QGApp = {
    advanceTo: function (t) { advanceTo(t); render(true); return simB.t; },
    reset: function (seed, failsafe) { state.seed = seed; state.failsafe = !!failsafe; build(); return true; },
    caption: function (html) { var el = $('caption'); el.innerHTML = html || ''; el.className = 'caption' + (html ? ' show' : ''); return true; },
    sims: function () { return { a: simA, b: simB }; }
  };
})();
