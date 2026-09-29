/* QueueGuard — canvas rendering for the live dashboard. Exposes window.QGRender. */
(function (root) {
  'use strict';

  var C = {
    road: '#2B323B', edge: '#56606B', laneMark: '#8A949E', text: '#E8EAED', muted: '#98A2AD',
    amber: '#F5A623', amberDim: '#6E5220', white: '#F2EFE8', red: '#FF5A4E', teal: '#3FC1A5',
    violet: '#C39BFF', board: '#0B0D10', cone: '#FF8A1F'
  };

  // speed colour ramp (km/h): red -> orange -> yellow -> teal -> blue
  var STOPS = [[0, [214, 48, 49]], [30, [242, 113, 33]], [55, [245, 200, 66]], [80, [95, 200, 165]], [105, [78, 161, 255]]];
  function speedRGB(k) {
    if (k <= STOPS[0][0]) return STOPS[0][1];
    for (var i = 1; i < STOPS.length; i++) {
      if (k <= STOPS[i][0]) {
        var a = STOPS[i - 1], b = STOPS[i], f = (k - a[0]) / (b[0] - a[0]);
        return [a[1][0] + (b[1][0] - a[1][0]) * f, a[1][1] + (b[1][1] - a[1][1]) * f, a[1][2] + (b[1][2] - a[1][2]) * f];
      }
    }
    return STOPS[STOPS.length - 1][1];
  }
  function speedColor(k) { var c = speedRGB(k); return 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')'; }

  function setup(canvas) {
    var dpr = root.devicePixelRatio || 1;
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }

  function fmtKm(x) { return (x / 1000).toFixed(1); }

  // ------------------------------------------------------------------ corridor overview
  function drawCorridor(canvas, sim, opt) {
    opt = opt || {};
    var s = setup(canvas), ctx = s.ctx, W = s.w, H = s.h, cfg = sim.cfg;
    var ml = 18, mr = 18, L = cfg.roadLength;
    var X = function (x) { return ml + x / L * (W - ml - mr); };
    var laneH = 13, roadTop = 84, roadH = laneH * 2;
    var isQG = cfg.strategy === 'queueguard';
    var t = sim.t;

    // km axis
    ctx.font = '11px "IBM Plex Sans", Arial, sans-serif';
    ctx.fillStyle = C.muted; ctx.strokeStyle = '#3A424C'; ctx.lineWidth = 1; ctx.textAlign = 'center';
    for (var km = 0; km <= L / 1000 + 1e-6; km++) {
      var xx = X(km * 1000);
      ctx.beginPath(); ctx.moveTo(xx, roadTop + roadH + 3); ctx.lineTo(xx, roadTop + roadH + 8); ctx.stroke();
      ctx.fillText('km ' + km, xx, H - 4);
    }

    // road
    ctx.fillStyle = C.road; ctx.fillRect(X(0), roadTop, X(L) - X(0), roadH);
    ctx.strokeStyle = C.edge; ctx.beginPath(); ctx.moveTo(X(0), roadTop); ctx.lineTo(X(L), roadTop);
    ctx.moveTo(X(0), roadTop + roadH); ctx.lineTo(X(L), roadTop + roadH); ctx.stroke();
    ctx.setLineDash([6, 8]); ctx.strokeStyle = C.laneMark; ctx.beginPath();
    ctx.moveTo(X(0), roadTop + laneH); ctx.lineTo(X(L), roadTop + laneH); ctx.stroke(); ctx.setLineDash([]);

    // work zone (right lane closed) with taper
    var z0 = X(cfg.closureStart), z1 = X(cfg.closureEnd), tp = X(cfg.closureStart - 120);
    ctx.fillStyle = 'rgba(255,138,31,0.28)';
    ctx.beginPath(); ctx.moveTo(tp, roadTop + roadH); ctx.lineTo(z0, roadTop + laneH); ctx.lineTo(z1, roadTop + laneH);
    ctx.lineTo(z1, roadTop + roadH); ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.cone;
    for (var cx = cfg.closureStart; cx <= cfg.closureEnd; cx += 60) ctx.fillRect(X(cx) - 1, roadTop + laneH + 1, 2, 3);
    ctx.fillStyle = C.cone; ctx.font = '600 11px "IBM Plex Sans", Arial, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('WORK ZONE', (z0 + z1) / 2, roadTop + roadH + 20);

    // vehicles
    for (var l = 0; l < 2; l++) {
      var arr = sim.lanes[l], y = roadTop + l * laneH + 2;
      for (var i = 0; i < arr.length; i++) {
        var v = arr[i], x1 = X(v.x), x0 = X(v.x - v.len);
        ctx.fillStyle = speedColor(v.v * 3.6);
        ctx.fillRect(x0, y, Math.max(2, x1 - x0), laneH - 4);
      }
    }

    // roadside: static signs (row 1), boards (row 2), VSL (row 3)
    var rowSign = roadTop - 13, rowBoard = roadTop - 40, rowVsl = roadTop - 69;
    ctx.textAlign = 'center';
    cfg.staticSigns.forEach(function (sg) {
      var px = X(sg.x);
      ctx.fillStyle = sg.warn ? C.amber : '#D9D9D9';
      ctx.beginPath(); ctx.moveTo(px, rowSign - 7); ctx.lineTo(px + 7, rowSign); ctx.lineTo(px, rowSign + 7); ctx.lineTo(px - 7, rowSign); ctx.closePath(); ctx.fill();
    });
    sim.boards.forEach(function (b) {
      var px = X(b.x), bw = 38, bh = 16;
      var flash = b.level === 'primary' || b.level === 'fallback';
      var on = b.level !== 'off';
      ctx.fillStyle = C.board; ctx.fillRect(px - bw / 2, rowBoard - bh / 2, bw, bh);
      ctx.strokeStyle = b.warn ? C.amber : '#4A525C'; ctx.lineWidth = b.warn ? 2 : 1;
      ctx.strokeRect(px - bw / 2, rowBoard - bh / 2, bw, bh);
      if (on) {
        var lit = !flash || Math.floor(t * 2) % 2 === 0;
        ctx.fillStyle = lit ? (b.warn ? C.amber : '#BFA36A') : C.amberDim;
        ctx.font = '700 8px "IBM Plex Mono", Consolas, monospace';
        ctx.fillText(abbrev(b.lines[0]), px, rowBoard + 3);
      }
      ctx.strokeStyle = '#4A525C'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, rowBoard + bh / 2); ctx.lineTo(px, roadTop); ctx.stroke();
    });
    sim.vsl.forEach(function (sg) {
      var px = X(sg.x);
      ctx.fillStyle = '#F4F1EA'; ctx.beginPath(); ctx.arc(px, rowVsl, 10, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#D93A2F'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(px, rowVsl, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#14181D'; ctx.font = '700 10px "IBM Plex Sans", Arial, sans-serif';
      ctx.fillText(sg.v ? String(sg.v) : '100', px, rowVsl + 3.5);
      ctx.strokeStyle = '#4A525C'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, rowVsl + 10); ctx.lineTo(px, rowBoard - 9); ctx.stroke();
    });

    // detectors (QueueGuard)
    if (isQG) {
      sim.det.forEach(function (d) {
        ctx.fillStyle = d.state === 'queued' ? C.red : C.teal;
        ctx.fillRect(X(d.x) - 3, roadTop + roadH + 10, 6, 4);
      });
    }

    // queue tail: truth (white), estimate (amber dashed), prediction (amber arrow)
    if (sim.tailTrue !== null) {
      var tx = X(sim.tailTrue);
      ctx.strokeStyle = C.white; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(tx, roadTop - 4); ctx.lineTo(tx, roadTop + roadH + 4); ctx.stroke();
      ctx.fillStyle = C.white; ctx.font = '600 11px "IBM Plex Sans", Arial, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText('queue tail', tx + 4, roadTop + roadH + 28);
    }
    var c = sim.ctrl;
    if (isQG && c.queue && c.tailEst !== null) {
      var ex = X(c.tailEst), pxp = X(c.tailPred);
      ctx.strokeStyle = C.amber; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(ex, roadTop - 6); ctx.lineTo(ex, roadTop + roadH + 6); ctx.stroke(); ctx.setLineDash([]);
      var ay = roadTop + roadH + 24;
      if (Math.abs(pxp - ex) > 3) {
        ctx.beginPath(); ctx.moveTo(ex, ay); ctx.lineTo(pxp, ay); ctx.stroke();
        var dir = pxp < ex ? -1 : 1;
        ctx.beginPath(); ctx.moveTo(pxp, ay); ctx.lineTo(pxp - dir * 6, ay - 4);
        ctx.lineTo(pxp - dir * 6, ay + 4); ctx.closePath(); ctx.fillStyle = C.amber; ctx.fill();
      }
      ctx.fillStyle = C.amber; ctx.textAlign = 'right'; ctx.font = '600 11px "IBM Plex Sans", Arial, sans-serif';
      ctx.fillText('predicted tail +' + cfg.horizon + ' s', Math.min(ex, pxp) - 8, ay + 4);
    }

    // recent end-of-queue conflicts
    var ev = sim.m.conflictEvents;
    for (var k = ev.length - 1; k >= 0 && t - ev[k].t < 30; k--) {
      var age = (t - ev[k].t) / 30;
      ctx.strokeStyle = 'rgba(255,90,78,' + (1 - age).toFixed(2) + ')'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(X(ev[k].x), roadTop + ev[k].lane * laneH + laneH / 2, 9 + 14 * age, 0, Math.PI * 2); ctx.stroke();
    }
  }

  function abbrev(s) { return s.length > 9 ? s.slice(0, 8) + '…' : s; }

  // ------------------------------------------------------------------ zoom on the queue tail
  function drawZoom(canvas, sim, center) {
    var s = setup(canvas), ctx = s.ctx, W = s.w, H = s.h, cfg = sim.cfg, t = sim.t;
    var span = 700, x0 = center - 480, x1 = x0 + span;
    var X = function (x) { return (x - x0) / span * W; };
    var laneH = 22, top = Math.round((H - 2 * laneH) / 2) - 4;
    ctx.fillStyle = C.road; ctx.fillRect(0, top, W, laneH * 2);
    ctx.strokeStyle = C.edge; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, top); ctx.lineTo(W, top); ctx.moveTo(0, top + 2 * laneH); ctx.lineTo(W, top + 2 * laneH); ctx.stroke();
    ctx.setLineDash([10, 14]); ctx.strokeStyle = C.laneMark;
    ctx.beginPath(); ctx.moveTo(0, top + laneH); ctx.lineTo(W, top + laneH); ctx.stroke(); ctx.setLineDash([]);
    if (cfg.closureStart < x1) {
      ctx.fillStyle = 'rgba(255,138,31,0.3)';
      ctx.fillRect(X(cfg.closureStart), top + laneH, X(Math.min(cfg.closureEnd, x1)) - X(cfg.closureStart), laneH);
    }
    for (var l = 0; l < 2; l++) {
      var arr = sim.lanes[l], y = top + l * laneH + 4;
      for (var i = 0; i < arr.length; i++) {
        var v = arr[i];
        if (v.x < x0 - 20 || v.x - v.len > x1 + 20) continue;
        var a = X(v.x - v.len), b = X(v.x), hgt = laneH - 8;
        ctx.fillStyle = speedColor(v.v * 3.6);
        ctx.fillRect(a, y, Math.max(3, b - a), hgt);
        if (v.a < -1.5) { ctx.fillStyle = '#FF2A2A'; ctx.fillRect(a - 1, y, 2, hgt); }          // brake lights
        if (v.epEnd >= 0 && t < v.epEnd) {                                                     // eyes off road
          ctx.strokeStyle = C.violet; ctx.lineWidth = 2; ctx.strokeRect(a - 1.5, y - 1.5, Math.max(3, b - a) + 3, hgt + 3);
        }
        if (t < v.alertUntil) { ctx.fillStyle = C.amber; ctx.beginPath(); ctx.arc((a + b) / 2, y + hgt / 2, 2.6, 0, Math.PI * 2); ctx.fill(); }
      }
    }
    // tail markers
    if (sim.tailTrue !== null && sim.tailTrue > x0 && sim.tailTrue < x1) {
      ctx.strokeStyle = C.white; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(X(sim.tailTrue), top - 8); ctx.lineTo(X(sim.tailTrue), top + 2 * laneH + 8); ctx.stroke();
    }
    // recent conflicts
    var ev = sim.m.conflictEvents;
    for (var k = ev.length - 1; k >= 0 && t - ev[k].t < 20; k--) {
      if (ev[k].x < x0 || ev[k].x > x1) continue;
      var age = (t - ev[k].t) / 20;
      ctx.strokeStyle = 'rgba(255,90,78,' + (1 - age).toFixed(2) + ')'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(X(ev[k].x), top + ev[k].lane * laneH + laneH / 2, 14 + 18 * age, 0, Math.PI * 2); ctx.stroke();
    }
    // scale bar and range label
    ctx.fillStyle = C.muted; ctx.font = '11px "IBM Plex Sans", Arial, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('km ' + fmtKm(x0) + ' – ' + fmtKm(x1) + '  (zoom on the queue tail)', 6, H - 4);
    var sb = 100 / span * W;
    ctx.strokeStyle = C.muted; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(W - sb - 10, H - 8); ctx.lineTo(W - 10, H - 8); ctx.stroke();
    ctx.textAlign = 'right'; ctx.fillText('100 m', W - 10, H - 12);
  }

  // ------------------------------------------------------------------ time–space diagram
  function drawTimeSpace(canvas, sim) {
    var s = setup(canvas), ctx = s.ctx, W = s.w, H = s.h, cfg = sim.cfg;
    var ml = 44, mb = 22, mt = 8, mr = 24, pw = W - ml - mr, ph = H - mt - mb;
    var cols = Math.ceil(cfg.duration / sim.tsEvery), bins = sim.tsBins;
    var off = sim._tsOff;
    if (!off) {
      off = sim._tsOff = document.createElement('canvas');
      off.width = cols; off.height = bins; sim._tsDrawn = 0;
      sim._tsImg = off.getContext('2d').createImageData(1, bins);
    }
    var octx = off.getContext('2d');
    for (var c = sim._tsDrawn; c < sim.ts.length; c++) {
      var col = sim.ts[c], img = sim._tsImg, d = img.data;
      for (var b = 0; b < bins; b++) {
        var p = (bins - 1 - b) * 4, k = col[b];
        var rgb = speedRGB(k === k ? k : 100);           // empty bin = free road
        d[p] = rgb[0]; d[p + 1] = rgb[1]; d[p + 2] = rgb[2]; d[p + 3] = 255;
      }
      octx.putImageData(img, c, 0);
    }
    sim._tsDrawn = sim.ts.length;
    ctx.fillStyle = '#12161B'; ctx.fillRect(ml, mt, pw, ph);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, cols, bins, ml, mt, pw, ph);
    var T = function (tt) { return ml + tt / cfg.duration * pw; };
    var Y = function (x) { return mt + ph - x / cfg.roadLength * ph; };
    // work zone band
    ctx.fillStyle = 'rgba(255,138,31,0.18)'; ctx.fillRect(ml, Y(cfg.closureEnd), pw, Y(cfg.closureStart) - Y(cfg.closureEnd));
    // series
    var sr = sim.series;
    function line(arr, color, dash, width) {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash); ctx.beginPath();
      var pen = false;
      for (var i = 0; i < sr.t.length; i++) {
        var v = arr[i];
        if (v === null || v === undefined) { pen = false; continue; }
        if (!pen) { ctx.moveTo(T(sr.t[i]), Y(v)); pen = true; } else ctx.lineTo(T(sr.t[i]), Y(v));
      }
      ctx.stroke(); ctx.setLineDash([]);
    }
    line(sr.tailTrue, C.white, [], 2);
    if (cfg.strategy === 'queueguard') { line(sr.tailEst, C.amber, [5, 4], 2); line(sr.tailPred, '#FFD27A', [2, 3], 1.5); }
    // now cursor
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(T(sim.t), mt); ctx.lineTo(T(sim.t), mt + ph); ctx.stroke();
    // axes
    ctx.fillStyle = C.muted; ctx.font = '11px "IBM Plex Sans", Arial, sans-serif'; ctx.textAlign = 'right';
    for (var km = 0; km <= cfg.roadLength / 1000; km += 2) ctx.fillText('km ' + km, ml - 4, Y(km * 1000) + 4);
    ctx.textAlign = 'center';
    for (var mn = 0; mn <= cfg.duration / 60; mn += 10) ctx.fillText(mn + ' min', T(mn * 60), H - 6);
  }

  function legendHTML() {
    var g = [];
    for (var k = 0; k <= 100; k += 5) g.push(speedColor(k) + ' ' + k + '%');
    return 'linear-gradient(90deg,' + g.join(',') + ')';
  }

  root.QGRender = { drawCorridor: drawCorridor, drawZoom: drawZoom, drawTimeSpace: drawTimeSpace, speedColor: speedColor, legendGradient: legendHTML, C: C };
})(window);
