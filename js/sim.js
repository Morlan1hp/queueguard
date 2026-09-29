/* QueueGuard — traffic microsimulation and end-of-queue warning strategies.
 *
 * Plain browser JavaScript, no build step. Exposes window.QG.
 *
 * Model summary (details and sources in docs/ASSUMPTIONS.md):
 *  - One-way freeway, two lanes, right lane closed for a work zone.
 *  - Car following: Intelligent Driver Model (Treiber et al. 2000) with the
 *    IIDM free-road term above the desired speed.
 *  - Lane changes: forced merge out of the closed lane with a MOBIL-style
 *    safety check, plus cooperative (zipper) yielding at the closure.
 *  - Driver distraction: short "eyes-off-road" episodes during which the
 *    driver keeps the current acceleration. A driver who has noticed a queue
 *    warning stays alert (no episodes) for a limited time window.
 *  - Safety metric: end-of-queue conflicts, i.e. a follower approaching a
 *    queued leader (< 30 km/h) with time-to-collision <= 1 s or
 *    deceleration-rate-to-avoid-crash >= 3.4 m/s^2 (thresholds used in the
 *    TfNSW / Deakin Work Zone End of Queue Study, 2025).
 */
(function (root) {
  'use strict';

  var KMH = 1 / 3.6;

  // ---------------------------------------------------------------- random
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function mix(a, b) {
    var h = ((a >>> 0) ^ Math.imul((b >>> 0) + 0x632BE5AB, 0x9E3779B1)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B);
    h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function hash01(a, b) { return mix(a, b) / 4294967296; }
  function gauss(r) {
    var u = r(); if (u < 1e-12) u = 1e-12;
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
  }
  function expo(r, mean) { return -Math.log(1 - r()) * mean; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // ---------------------------------------------------------------- config
  var DEFAULTS = {
    seed: 1,
    strategy: 'queueguard',      // 'static' | 'fixedqws' | 'queueguard'
    dt: 0.1,                     // s
    duration: 4200,              // s simulated (70 min)
    warmup: 300,                 // s excluded from statistics
    roadLength: 7200,            // m
    closureStart: 6000,          // right lane closed from here ...
    closureEnd: 6600,            // ... to here
    mergeFrom: 4900,             // "RIGHT LANE CLOSED" sign: early mergers may move over from here
    speedLimit: 100,             // km/h
    truckShare: 0.10,
    demandBase: 900,             // veh/h both lanes, first 10 min
    demandPeak: 1800,            // veh/h, 15–40 min
    demandAfter: 600,            // veh/h, after 45 min
    // behaviour — stated assumptions, varied in the sensitivity analysis
    pNotice: 0.6,                // chance a driver notices a warning and responds
    alertWindow: 60,             // s a warned driver stays alert
    warnSpeedCap: 80,            // km/h desired-speed cap while alert
    pComply: 0.7,                // share of drivers who obey posted / variable limits
    proneShare: 0.25,            // share of distraction-prone drivers
    recogMin: 150, recogMax: 300,// m at which an unwarned driver recognises stopped traffic ahead
    recogAlert: 500,             // m for a warned driver who expects the queue
    reactionTime: 1.0,           // s perception–reaction time after recognition
    // metric thresholds
    ttcThreshold: 1.0,           // s   (TfNSW / Deakin 2025)
    dracThreshold: 3.4,          // m/s^2 (TfNSW / Deakin 2025)
    queueSpeed: 30,              // km/h — slower than this = in the queue
    coverageMin: 150,            // m   a warning closer than this to the tail is too late
    coverageMax: 1500,           // m   a warning further than this is likely forgotten
    // infrastructure
    detStart: 1000, detSpacing: 400, detEnd: 5800,   // radar detectors (e.g. on VMS trailers)
    detHalfZone: 25,
    vms: [2000, 3200, 4400, 5200],                   // portable VMS boards (QueueGuard chain)
    vsl: [2600, 3800, 5000, 5600],                   // portable variable speed limit signs
    staticSigns: [
      { x: 4500, text: ['ROADWORKS', 'AHEAD'], warn: true },
      { x: 4900, text: ['RIGHT LANE', 'CLOSED'], warn: false },
      { x: 5000, text: ['PREPARE', 'TO STOP'], warn: true }
    ],
    staticSpeed: [ { x: 5200, v: 80 }, { x: 5800, v: 60 }, { x: 6700, v: 100 } ],
    fixedQws: { vms: 4400, detector: 5400 },         // detection-only system at fixed positions
    controlPeriod: 20,           // s
    horizon: 90,                 // s tail prediction horizon
    trendWindow: 180,            // s of tail history used to estimate the tail velocity
    trendDamping: 1.0,           // 0..1 shrinkage applied to the extrapolated movement
    warnOffset: 300,             // m stopping sight distance at 100 km/h + sign legibility
    holdTime: 60,                // s minimum display time before relaxing a message
    commsLossAt: -1,             // s; >= 0 simulates loss of detector data from that time
    useVSL: true,                // ablation switch: QueueGuard without variable speed limits
    usePrediction: true,         // ablation switch: place warnings on the current (not predicted) tail
    uhf: true,                   // semi-automatic UHF CB broadcast to heavy vehicles
    uhfConfirmDelay: 20,         // s for the supervisor to confirm a drafted message
    recordTimeSpace: true
  };

  function merge(base, over) {
    var o = {}, k;
    for (k in base) o[k] = base[k];
    if (over) for (k in over) if (over[k] !== undefined) o[k] = over[k];
    return o;
  }

  function demandAt(cfg, t) {
    var b = cfg.demandBase, p = cfg.demandPeak, a = cfg.demandAfter;
    if (t < 600) return b;
    if (t < 900) return b + (p - b) * (t - 600) / 300;
    if (t < 2400) return p;
    if (t < 2700) return p + (a - p) * (t - 2400) / 300;
    return a;
  }

  // ---------------------------------------------------------------- vehicles
  function makeVehicle(sim, id, lane, t) {
    var cfg = sim.cfg;
    var r = mulberry32(mix(cfg.seed * 7919 + 17, id));
    var truck = r() < cfg.truckShare;
    var v = {
      id: id, lane: lane, x: 0, px: 0, v: 0, a: 0,
      truck: truck,
      len: truck ? 12 + 6 * r() : 4.3 + 0.6 * r(),
      v0f: clamp(1 + 0.08 * gauss(r), 0.85, 1.2) * (truck ? 0.9 : 1),
      T: truck ? 1.7 + 0.3 * r() : 1.2 + 0.4 * r(),
      s0: 2,
      amax: truck ? 0.8 : 1.4 + 0.3 * r(),
      b: truck ? 1.6 : 2.0,
      bmax: truck ? 6.0 : 8.0,
      prone: r() < cfg.proneShare,
      comply: r() < cfg.pComply,
      coop: r() < 0.5,
      earlyMerge: r() < 0.7,
      yieldId: -1, yieldSince: 0,
      recog: cfg.recogMin + (cfg.recogMax - cfg.recogMin) * r(),
      seenId: -1, seenAt: 0, laneSince: t,
      rng: null,
      nextEp: 0, epEnd: -1, epDur: 0, aFrozen: 0,
      alertUntil: -1,
      limit: cfg.speedLimit, vslV: 0,
      ev: 0,                      // index of next roadside event
      warnXs: [],                 // positions of the queue warnings passed
      joined: false, approached: false, inConflict: false,
      entryT: t, colliding: -1
    };
    v.rng = mulberry32(mix(cfg.seed * 104729 + 3, id));
    scheduleEpisode(v, t);
    return v;
  }

  function scheduleEpisode(v, t) {
    var r = v.rng;
    var gap = v.prone ? expo(r, 25) : expo(r, 70);
    var dur = v.prone ? 1.5 + 2.0 * r() : 0.5 + 1.0 * r();
    v.nextEp = t + gap;
    v.epDur = dur;
  }

  // IDM with the IIDM free-road term when faster than desired.
  function idm(veh, v, v0, gap, vLead) {
    var dv = v - vLead;
    var sStar = veh.s0 + Math.max(0, v * veh.T + v * dv / (2 * Math.sqrt(veh.amax * veh.b)));
    var g = gap > 0.1 ? gap : 0.1;
    var inter = (sStar / g) * (sStar / g);
    var free;
    if (v <= v0) { var q = v / v0; q *= q; free = veh.amax * (1 - q * q); }
    else free = -veh.b * (1 - Math.pow(v0 / v, veh.amax * 4 / veh.b));
    return free - veh.amax * inter;
  }

  function desiredSpeed(sim, veh, t) {
    var lim = veh.limit;
    if (veh.vslV > 0 && veh.vslV < lim) lim = veh.vslV;
    var eff = veh.comply ? lim : Math.min(sim.cfg.speedLimit, lim + 15);
    if (t < veh.alertUntil && eff > sim.cfg.warnSpeedCap) eff = sim.cfg.warnSpeedCap;
    return eff * KMH * veh.v0f;
  }

  // ---------------------------------------------------------------- simulation
  function Sim(options) {
    var cfg = this.cfg = merge(DEFAULTS, options || {});
    this.t = 0;
    this.step = 0;
    this.lanes = [[], []];
    this.pending = [[], []];
    this.nextId = 1;
    this.arrRng = mulberry32(mix(cfg.seed * 31337 + 11, 0));
    this.nextStat = 1;

    // detectors
    this.det = [];
    for (var x = cfg.detStart; x <= cfg.detEnd + 1e-6; x += cfg.detSpacing) {
      this.det.push({ x: x, sum: 0, n: 0, mean: null, state: 'free', lowCount: 0, highCount: 0, lastData: 0 });
    }
    // roadside elements
    this.boards = [];
    var useChain = cfg.strategy === 'queueguard';
    if (useChain) {
      for (var i = 0; i < cfg.vms.length; i++) {
        this.boards.push({ x: cfg.vms[i], lines: ['', ''], level: 'off', warn: false, since: 0, key: 100 + i });
      }
    } else if (cfg.strategy === 'fixedqws') {
      this.boards.push({ x: cfg.fixedQws.vms, lines: ['ROADWORKS', 'AHEAD'], level: 'idle', warn: false, since: 0, key: 100 });
    }
    this.vsl = [];
    if (useChain && cfg.useVSL) for (var j = 0; j < cfg.vsl.length; j++) this.vsl.push({ x: cfg.vsl[j], v: 0, since: 0 });

    // sorted roadside event list: signs, boards, speed signs, VSL, detectors (for spot speeds)
    var ev = [];
    cfg.staticSigns.forEach(function (s, k) { ev.push({ x: s.x, type: 'sign', ref: s, key: 1 + k }); });
    cfg.staticSpeed.forEach(function (s) { ev.push({ x: s.x, type: 'speed', ref: s }); });
    var self = this;
    this.boards.forEach(function (b) { ev.push({ x: b.x, type: 'board', ref: b, key: b.key }); });
    this.vsl.forEach(function (s) { ev.push({ x: s.x, type: 'vsl', ref: s }); });
    this.det.forEach(function (d, k) { ev.push({ x: d.x, type: 'det', ref: d, idx: k }); });
    ev.sort(function (a, b) { return a.x - b.x; });
    this.events = ev;

    // controller state
    this.ctrl = {
      queue: false, tailEst: null, tailPred: null, w: 0, riskPoint: null,
      hist: [], stale: false, failsafe: false, lastL3: {}, uhfDraft: null, uhfActive: false,
      uhfNextBroadcast: 0, fixedActive: false, fixedLow: 0, fixedHigh: 0, everQueue: false
    };
    this.alerts = [];

    // ground truth + metrics
    this.tailTrue = null;
    this.m = {
      conflicts: 0, conflictsTruck: 0, conflictEvents: [], collisions: 0, collisionEvents: [], mergeCollisions: 0,
      approachSpeeds: [], joins: 0, covered: 0, tooLate: 0, tooEarly: 0, none: 0,
      warnTime: 0, credibleTime: 0, dynWarnTime: 0, dynCredibleTime: 0, queueTime: 0, uncoveredQueueTime: 0, tet: 0,
      exits: 0, travelTimeSum: 0, predErrSum: 0, predErrN: 0, nowErrSum: 0, nowErrN: 0, overrunPred: 0, overrunNow: 0,
      maxQueueLen: 0, alertsL3: 0, uhfBroadcasts: 0, trucksReached: 0
    };
    this.series = { t: [], tailTrue: [], tailEst: [], tailPred: [] };
    this.predLog = [];                           // [t, tailPred, tailEst] for error measurement

    // time–space diagram
    this.tsBin = 50; this.tsEvery = 10;
    this.tsBins = Math.ceil(cfg.roadLength / this.tsBin);
    this.ts = [];                                // array of Float32Array columns (km/h, NaN = empty)
    this.tsSum = new Float64Array(this.tsBins); this.tsN = new Float64Array(this.tsBins);

    // truth bins
    this.tBin = 25;
    this.tBins = Math.ceil(cfg.closureStart / this.tBin);
    this.tSum = new Float64Array(this.tBins); this.tN = new Float64Array(this.tBins);

    if (cfg.strategy === 'queueguard') this.updateQueueGuardIdle();
  }

  Sim.prototype.log = function (level, text) {
    this.alerts.push({ t: this.t, level: level, text: text });
    if (this.alerts.length > 200) this.alerts.shift();
  };

  // --------------------------------------------------------- arrivals
  Sim.prototype.arrivals = function () {
    var cfg = this.cfg, dt = cfg.dt;
    var rate = demandAt(cfg, this.t) / 3600;
    if (this.arrRng() < rate * dt) {
      var lane = this.arrRng() < 0.5 ? 0 : 1;
      this.pending[lane].push(makeVehicle(this, this.nextId++, lane, this.t));
    }
    for (var l = 0; l < 2; l++) {
      var q = this.pending[l];
      if (!q.length) continue;
      var arr = this.lanes[l];
      var last = arr.length ? arr[arr.length - 1] : null;
      var veh = q[0];
      var v0 = desiredSpeed(this, veh, this.t);
      var vIn = v0;
      if (last) {
        var gap = last.x - last.len;
        if (gap < veh.s0 + 6) continue;
        var safe = Math.max(0, (gap - veh.s0) / Math.max(veh.T, 0.5));
        vIn = Math.min(v0, safe, last.v + 5);
      }
      q.shift();
      veh.v = vIn; veh.x = 0; veh.px = 0; veh.entryT = this.t;
      arr.push(veh);
    }
  };

  // --------------------------------------------------------- lane changes
  function findSplit(arr, x) {             // first index with arr[i].x < x (arr sorted desc)
    var lo = 0, hi = arr.length;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (arr[mid].x >= x) lo = mid + 1; else hi = mid; }
    return lo;
  }

  Sim.prototype.laneChanges = function () {
    var cfg = this.cfg, L1 = this.lanes[1], L0 = this.lanes[0];
    for (var i = 0; i < L1.length; i++) {
      var veh = L1[i];
      if (veh.x < cfg.mergeFrom) break;
      if (veh.x >= cfg.closureStart) continue;
      var toEnd = cfg.closureStart - veh.x;
      if (!veh.earlyMerge && toEnd > 250) continue;
      var k = findSplit(L0, veh.x);
      var lead = k > 0 ? L0[k - 1] : null, fol = k < L0.length ? L0[k] : null;
      var gapA = lead ? lead.x - lead.len - veh.x : 1e9;
      var gapB = fol ? veh.x - veh.len - fol.x : 1e9;
      var slow = veh.v < 5;
      var minGap = slow ? 1 : 2;
      if (gapA < minGap || gapB < minGap) continue;
      var bSafe = toEnd < 100 ? 4 : 3;
      var aSelf = lead ? idm(veh, veh.v, desiredSpeed(this, veh, this.t), gapA, lead.v) : 0;
      if (aSelf < -bSafe) continue;
      if (fol) {
        var aFol = idm(fol, fol.v, desiredSpeed(this, fol, this.t), gapB, veh.v);
        if (aFol < -bSafe) continue;
      }
      L1.splice(i, 1); i--;
      veh.lane = 0; veh.laneSince = this.t;
      L0.splice(k, 0, veh);
    }
  };

  // --------------------------------------------------------- dynamics
  Sim.prototype.accelerations = function () {
    var cfg = this.cfg, t = this.t;
    var L1 = this.lanes[1];
    var waiting = (L1.length && L1[0].x > cfg.closureStart - 30 && L1[0].v < 3) ? L1[0] : null;
    for (var l = 0; l < 2; l++) {
      var arr = this.lanes[l];
      for (var i = 0; i < arr.length; i++) {
        var veh = arr[i];
        var v0 = desiredSpeed(this, veh, t);
        var inMergeZone = l === 1 && veh.x > cfg.mergeFrom;
        if (inMergeZone) {
          // drivers in the closing lane match the speed of the adjacent lane before merging
          var L0 = this.lanes[0], k0 = findSplit(L0, veh.x);
          var nb = k0 > 0 ? L0[k0 - 1] : null;
          if (nb && nb.x - veh.x < 150) v0 = Math.min(v0, Math.max(nb.v + 20 * KMH, 20 * KMH));
        }
        var gap, vl;
        if (i > 0) {
          var ld = arr[i - 1]; gap = ld.x - ld.len - veh.x; vl = ld.v;
          // Limited perception of a much slower vehicle far ahead: until the driver recognises
          // it (and has reacted), they drive as if the leader were moving at their own speed.
          if (vl < veh.v - 3 && !inMergeZone) {
            var recog = t < veh.alertUntil ? cfg.recogAlert : veh.recog;
            if (gap > recog) { vl = veh.v; veh.seenId = -1; }
            else {
              if (veh.seenId !== ld.id) { veh.seenId = ld.id; veh.seenAt = t; }
              if (t - veh.seenAt < cfg.reactionTime) vl = veh.v;
            }
          }
        }
        else { gap = 1e4; vl = v0; }
        if (l === 1 && veh.x < cfg.closureStart) {          // end of the closed lane
          var gEnd = cfg.closureStart - veh.x;
          if (gEnd < gap) { gap = gEnd; vl = 0; }
        }
        if (l === 0 && waiting && veh.coop && waiting.x > veh.x && waiting.x - veh.x < 40) {
          // zipper: a cooperative driver holds back so the waiting car can merge in front.
          // Only when there is room to stop behind it, and never for more than 8 s (no deadlock).
          var gW = waiting.x - waiting.len - veh.x;
          if (veh.yieldId !== waiting.id) { veh.yieldId = waiting.id; veh.yieldSince = t; }
          if (gW >= 3 && gW < gap && t - veh.yieldSince < 8) { gap = gW; vl = waiting.v; }
        }
        var a = idm(veh, veh.v, v0, gap, vl);
        // distraction episodes (suppressed while alert)
        if (t >= veh.nextEp) {
          if (veh.epEnd < 0) {
            if (t < veh.alertUntil) { scheduleEpisode(veh, t); }
            else { veh.epEnd = t + veh.epDur; veh.aFrozen = clamp(veh.a, -veh.b, 0.3); }
          }
          if (veh.epEnd >= 0) {
            if (t < veh.epEnd) a = veh.aFrozen;
            else { veh.epEnd = -1; scheduleEpisode(veh, t); }
          }
        }
        if (a < -veh.bmax) a = -veh.bmax;
        veh.a = a;
      }
    }
  };

  Sim.prototype.move = function () {
    var cfg = this.cfg, dt = cfg.dt, t = this.t + dt;
    var dH = cfg.detHalfZone, dS = cfg.detStart, dSp = cfg.detSpacing, nDet = this.det.length;
    for (var l = 0; l < 2; l++) {
      var arr = this.lanes[l];
      for (var i = 0; i < arr.length; i++) {
        var veh = arr[i];
        var v1 = veh.v + veh.a * dt;
        veh.px = veh.x;
        if (v1 < 0) { veh.x += veh.v * veh.v / (2 * Math.max(-veh.a, 1e-6)); v1 = 0; }
        else veh.x += 0.5 * (veh.v + v1) * dt;
        veh.v = v1;
        // collision handling
        if (i > 0) {
          var ld = arr[i - 1], g = ld.x - ld.len - veh.x;
          if (g < 0) {
            if (veh.colliding !== ld.id) {
              veh.colliding = ld.id;
              if (t > cfg.warmup) {
                // End-of-queue collision: leader settled in the lane, upstream of the merge taper.
                if (t - ld.laneSince > 3 && veh.x < (l === 0 ? cfg.closureStart - 150 : cfg.mergeFrom)) {
                  this.m.collisions++;
                  this.m.collisionEvents.push({ t: t, x: veh.x, truck: veh.truck });
                } else this.m.mergeCollisions++;
              }
            }
            veh.x = ld.x - ld.len - 0.05;
            if (veh.v > ld.v) veh.v = ld.v;
          }
        } else if (l === 1 && veh.x > cfg.closureStart - 0.05 && veh.px <= cfg.closureStart) {
          veh.x = cfg.closureStart - 0.05; veh.v = 0;
        }
        // roadside events passed this step
        var ev = this.events;
        while (veh.ev < ev.length && ev[veh.ev].x <= veh.x) {
          this.passEvent(veh, ev[veh.ev], t);
          veh.ev++;
        }
        // detector zone occupancy
        var k = Math.round((veh.x - dS) / dSp);
        if (k >= 0 && k < nDet) {
          var d = this.det[k];
          if (veh.x > d.x - dH && veh.x < d.x + dH) { d.sum += veh.v; d.n++; }
        }
      }
    }
  };

  Sim.prototype.passEvent = function (veh, e, t) {
    var cfg = this.cfg;
    switch (e.type) {
      case 'speed': veh.limit = e.ref.v; if (e.ref.v >= cfg.speedLimit) veh.vslV = 0; break;
      case 'vsl': veh.vslV = e.ref.v; break;
      case 'sign':
        if (e.ref.warn) this.warn(veh, e.x, e.key, t);
        break;
      case 'board':
        if (e.ref.warn) this.warn(veh, e.x, e.key, t);
        break;
      case 'det':
        this.spotSpeed(veh, e.ref, t);
        break;
    }
  };

  Sim.prototype.warn = function (veh, x, key, t) {
    veh.warnXs.push(x);
    if (veh.epEnd >= 0 && t < veh.epEnd) return;          // eyes off the road: sign missed
    if (hash01(mix(this.cfg.seed, veh.id), key) < this.cfg.pNotice) {
      veh.alertUntil = t + this.cfg.alertWindow;
    }
  };

  Sim.prototype.spotSpeed = function (veh, d, t) {
    var c = this.ctrl;
    if (this.cfg.strategy !== 'queueguard' || !c.queue || c.stale || c.tailEst === null) return;
    if (d.x < c.tailEst - 450 || d.x > c.tailEst) return;
    if (veh.v * 3.6 < 80) return;
    var last = c.lastL3[d.x] || -1e9;
    if (t - last < 30) return;
    c.lastL3[d.x] = t;
    if (t > this.cfg.warmup) this.m.alertsL3++;
    this.log(3, 'HIGH-SPEED APPROACH ' + Math.round(veh.v * 3.6) + ' km/h at km ' + (d.x / 1000).toFixed(1) +
      ', ' + Math.round(c.tailEst - d.x) + ' m before the queue — worker alert sent');
  };

  // --------------------------------------------------------- measurement
  Sim.prototype.measure = function () {
    var cfg = this.cfg, t = this.t, qv = cfg.queueSpeed * KMH;
    var afterWarm = t > cfg.warmup;
    for (var l = 0; l < 2; l++) {
      var arr = this.lanes[l];
      // End-of-queue region: upstream of the merge taper (lane 0) / of the merge zone (closing lane).
      var xMax = l === 0 ? cfg.closureStart - 150 : cfg.mergeFrom;
      for (var i = 1; i < arr.length; i++) {
        var veh = arr[i], ld = arr[i - 1];
        if (ld.v < qv && veh.v > ld.v + 0.1 && veh.x < xMax && t - ld.laneSince > 3) {
          var gap = ld.x - ld.len - veh.x;
          if (gap > 0) {
            var dv = veh.v - ld.v;
            var ttc = gap / dv, drac = dv * dv / (2 * gap);
            if (ttc < 3 && afterWarm) this.m.tet += cfg.dt;     // time exposed to TTC < 3 s
            var severe = ttc <= cfg.ttcThreshold || drac >= cfg.dracThreshold;
            if (severe && !veh.inConflict) {
              veh.inConflict = true;
              if (afterWarm) {
                this.m.conflicts++;
                if (veh.truck) this.m.conflictsTruck++;
                this.m.conflictEvents.push({ t: t, x: veh.x, lane: l, ttc: ttc, drac: drac, truck: veh.truck, v: veh.v * 3.6 });
              }
            } else if (!severe) veh.inConflict = false;
            if (!veh.approached && gap < 200) {
              veh.approached = true;
              if (afterWarm) this.m.approachSpeeds.push(veh.v * 3.6);
            }
          } else veh.inConflict = false;
        } else veh.inConflict = false;
        if (!veh.joined && veh.v < qv && veh.x < xMax && veh.x > 800) this.join(veh);
      }
      if (arr.length && !arr[0].joined && arr[0].v < qv && arr[0].x < xMax && arr[0].x > 800) this.join(arr[0]);
    }
  };

  Sim.prototype.join = function (veh) {
    veh.joined = true;
    if (this.t <= this.cfg.warmup) return;
    this.m.joins++;
    var ws = veh.warnXs, lo = this.cfg.coverageMin, hi = this.cfg.coverageMax, late = false, early = false;
    for (var i = 0; i < ws.length; i++) {
      var d = veh.x - ws[i];
      if (d >= lo && d <= hi) { this.m.covered++; return; }
      if (d < lo) late = true; else early = true;
    }
    if (!ws.length) this.m.none++;
    else if (late) this.m.tooLate++;
    else this.m.tooEarly++;
  };

  // ground-truth queue tail from 25 m speed bins (both lanes)
  Sim.prototype.truthTail = function () {
    var cfg = this.cfg, n = this.tBins, S = this.tSum, N = this.tN, b = this.tBin;
    S.fill(0); N.fill(0);
    for (var l = 0; l < 2; l++) {
      var arr = this.lanes[l];
      for (var i = 0; i < arr.length; i++) {
        var x = arr[i].x;
        if (x >= cfg.closureStart || x < 0) continue;
        var k = (x / b) | 0; S[k] += arr[i].v; N[k]++;
      }
    }
    var thr = 40 * KMH, tail = null, miss = 0, started = false;
    for (var k2 = n - 1; k2 >= 0; k2--) {
      var q = N[k2] > 0 && S[k2] / N[k2] < thr;
      if (q) { tail = k2 * b; started = true; miss = 0; }
      else { miss++; if (miss > (started ? 3 : 4)) break; }
    }
    if (tail !== null && tail > cfg.closureStart - 100) tail = null;   // merge friction only
    return tail;
  };

  Sim.prototype.secondly = function () {
    var cfg = this.cfg, t = this.t, m = this.m;
    var tail = this.tailTrue = this.truthTail();
    var afterWarm = t > cfg.warmup;
    if (tail !== null && afterWarm) {
      m.queueTime++;
      var len = cfg.closureStart - tail;
      if (len > m.maxQueueLen) m.maxQueueLen = len;
    }
    // warning credibility and placement, per second
    var activeWarn = [];
    cfg.staticSigns.forEach(function (s) { if (s.warn) activeWarn.push([s.x, false]); });
    this.boards.forEach(function (b) { if (b.warn) activeWarn.push([b.x, true]); });
    if (afterWarm) {
      var coveredNow = false;
      for (var i = 0; i < activeWarn.length; i++) {
        var x = activeWarn[i][0], dyn = activeWarn[i][1];
        var credible = tail !== null && tail > x && tail - x <= 2500;
        m.warnTime++; if (credible) m.credibleTime++;
        if (dyn) { m.dynWarnTime++; if (credible) m.dynCredibleTime++; }
        if (tail !== null && tail - x >= cfg.coverageMin && tail - x <= cfg.coverageMax) coveredNow = true;
      }
      if (tail !== null && !coveredNow) m.uncoveredQueueTime++;
    }
    // prediction error: prediction made `horizon` s ago vs truth now
    if (cfg.strategy === 'queueguard' && afterWarm) {
      while (this.predLog.length && this.predLog[0][0] < t - cfg.horizon - 0.5) this.predLog.shift();
      if (this.predLog.length && Math.abs(this.predLog[0][0] + cfg.horizon - t) < 0.5) {
        if (tail !== null) {
          var pl = this.predLog[0];
          m.predErrSum += Math.abs(pl[1] - tail); m.predErrN++;
          m.nowErrSum += Math.abs(pl[2] - tail); m.nowErrN++;
          // warning point overrun: did the real tail reach within 150 m of the planned warning point?
          var wPred = Math.min(pl[1], pl[2]) - cfg.warnOffset, wNow = pl[2] - cfg.warnOffset;
          if (tail < wPred + cfg.coverageMin) m.overrunPred++;
          if (tail < wNow + cfg.coverageMin) m.overrunNow++;
        }
        this.predLog.shift();
      }
    }
    if ((t | 0) % 5 === 0) {
      this.series.t.push(t);
      this.series.tailTrue.push(tail);
      this.series.tailEst.push(this.ctrl.queue ? this.ctrl.tailEst : null);
      this.series.tailPred.push(this.ctrl.queue ? this.ctrl.tailPred : null);
    }
  };

  Sim.prototype.timeSpace = function (final) {
    var S = this.tsSum, N = this.tsN, b = this.tsBin;
    for (var l = 0; l < 2; l++) {
      var arr = this.lanes[l];
      for (var i = 0; i < arr.length; i++) {
        var k = (arr[i].x / b) | 0;
        if (k >= 0 && k < this.tsBins) { S[k] += arr[i].v * 3.6; N[k]++; }
      }
    }
    if (final) {
      var col = new Float32Array(this.tsBins);
      for (var j = 0; j < this.tsBins; j++) col[j] = N[j] ? S[j] / N[j] : NaN;
      this.ts.push(col);
      S.fill(0); N.fill(0);
    }
  };

  // --------------------------------------------------------- controllers
  Sim.prototype.readDetectors = function () {
    var cfg = this.cfg, t = this.t;
    var lost = cfg.commsLossAt >= 0 && t >= cfg.commsLossAt;
    for (var i = 0; i < this.det.length; i++) {
      var d = this.det[i];
      if (lost) { d.sum = 0; d.n = 0; continue; }
      d.mean = d.n > 0 ? (d.sum / d.n) * 3.6 : null;   // km/h, null = no vehicles seen
      d.sum = 0; d.n = 0; d.lastData = t;
      var s = d.mean === null ? cfg.speedLimit : d.mean;
      if (s < 35) { d.lowCount++; d.highCount = 0; } else if (s > 55) { d.highCount++; d.lowCount = 0; }
      else { d.highCount = 0; }
      if (d.state === 'free' && (d.lowCount >= 2 || s < 20)) d.state = 'queued';
      else if (d.state === 'queued' && d.highCount >= 2) d.state = 'free';
    }
    return lost;
  };

  // tail estimate from detectors only (no ground truth)
  Sim.prototype.estimateTail = function () {
    var det = this.det, n = det.length;
    if (det[n - 1].state !== 'queued') return null;
    var j = n - 1;
    while (j > 0 && det[j - 1].state === 'queued') j--;
    var xq = det[j].x, sq = det[j].mean === null ? 10 : det[j].mean;
    if (j === 0) return xq - this.cfg.detSpacing / 2;
    var xf = det[j - 1].x, sf = det[j - 1].mean === null ? this.cfg.speedLimit : det[j - 1].mean;
    var f = sf > sq ? clamp((sf - 40) / (sf - sq), 0, 1) : 0.5;
    return xf + (xq - xf) * f;
  };

  Sim.prototype.control = function () {
    var cfg = this.cfg;
    var lost = this.readDetectors();
    if (cfg.strategy === 'fixedqws') this.controlFixed();
    else if (cfg.strategy === 'queueguard') this.controlQueueGuard(lost);
  };

  Sim.prototype.controlFixed = function () {
    var c = this.ctrl, cfg = this.cfg;
    var d = null;
    for (var i = 0; i < this.det.length; i++) if (Math.abs(this.det[i].x - cfg.fixedQws.detector) < 1) d = this.det[i];
    var b = this.boards[0];
    var on = d && d.state === 'queued';
    if (on) { b.lines = ['QUEUE AHEAD', 'PREPARE TO STOP']; b.level = 'primary'; b.warn = true; b.since = this.t; }
    else if (b.warn && this.t - b.since >= cfg.holdTime) { b.lines = ['ROADWORKS', 'AHEAD']; b.level = 'idle'; b.warn = false; b.since = this.t; }
  };

  Sim.prototype.updateQueueGuardIdle = function () {
    var cfg = this.cfg, near = -1;
    for (var i = 0; i < this.boards.length; i++) if (this.boards[i].x <= cfg.closureStart - 500) near = i;
    for (var k = 0; k < this.boards.length; k++) {
      var b = this.boards[k];
      if (k === near) this.setBoard(b, 'idle', ['ROADWORKS', 'RIGHT LANE CLOSED'], false, true);
      else this.setBoard(b, 'off', ['', ''], false, true);
    }
    for (var j = 0; j < this.vsl.length; j++) this.vsl[j].v = 0;
  };

  var LEVEL_RANK = { off: 0, idle: 1, inqueue: 2, secondary: 3, primary: 4, fallback: 5 };

  Sim.prototype.setBoard = function (b, level, lines, warn, force) {
    var now = this.t;
    var cur = LEVEL_RANK[b.level] || 0, nxt = LEVEL_RANK[level] || 0;
    // Escalate at once; relax only after the current message has not been re-confirmed for holdTime.
    if (!force && nxt < cur && now - b.since < this.cfg.holdTime) return;
    b.since = now;
    b.level = level; b.lines = lines; b.warn = warn;
  };

  Sim.prototype.controlQueueGuard = function (lost) {
    var cfg = this.cfg, c = this.ctrl, t = this.t, self = this;
    // fail-safe on stale data
    var stale = lost && cfg.commsLossAt >= 0 && t - cfg.commsLossAt >= 60;
    if (stale) {
      if (!c.failsafe) { c.failsafe = true; this.log(2, 'Detector data lost for 60 s — FAIL-SAFE: all boards show PREPARE TO STOP, VSL 80'); }
      this.boards.forEach(function (b) { self.setBoard(b, 'fallback', ['ROADWORKS AHEAD', 'PREPARE TO STOP'], true, true); });
      this.vsl.forEach(function (s) { s.v = 80; });
      c.queue = false; c.stale = true;
      return;
    }
    if (lost) return;                     // wait for 60 s before declaring the data stale
    var tail = this.estimateTail();
    if (tail === null) {
      if (c.queue) { this.log(1, 'Queue cleared — boards return to normal after hold time'); }
      c.queue = false; c.hist.length = 0; c.tailEst = null; c.tailPred = null; c.riskPoint = null;
      c.uhfDraft = null; c.uhfActive = false;
      // relax boards respecting the hold time
      var near = -1;
      for (var i = 0; i < this.boards.length; i++) if (this.boards[i].x <= cfg.closureStart - 500) near = i;
      this.boards.forEach(function (b, k) {
        if (k === near) self.setBoard(b, 'idle', ['ROADWORKS', 'RIGHT LANE CLOSED'], false);
        else self.setBoard(b, 'off', ['', ''], false);
      });
      this.vsl.forEach(function (s) { if (s.v !== 0 && t - s.since >= cfg.holdTime) { s.v = 0; s.since = t; } });
      return;
    }
    if (!c.queue) {
      this.log(1, 'Queue detected — tail near km ' + (tail / 1000).toFixed(2) + '. Supervisor notified.');
      c.everQueue = true;
    }
    c.queue = true;
    c.tailEst = tail;
    c.hist.push([t, tail]);
    while (c.hist.length && c.hist[0][0] < t - cfg.trendWindow) c.hist.shift();
    // tail velocity by least squares (equivalent to the shockwave speed)
    var w = 0;
    if (c.hist.length >= 3) {
      var n = c.hist.length, st = 0, sx = 0, stt = 0, stx = 0;
      c.hist.forEach(function (h) { st += h[0]; sx += h[1]; stt += h[0] * h[0]; stx += h[0] * h[1]; });
      var den = n * stt - st * st;
      if (den > 1e-9) w = (n * stx - st * sx) / den;
    }
    w = clamp(w, -4, 2);
    c.w = w;
    var pred = cfg.usePrediction ? clamp(tail + cfg.trendDamping * w * cfg.horizon, 0, cfg.closureStart - 100) : tail;
    c.tailPred = pred;
    this.predLog.push([t, pred, tail]);
    var risk = Math.min(tail, pred);
    c.riskPoint = risk;
    var warnPoint = risk - cfg.warnOffset;

    // VMS chain
    var primaryIdx = -1;
    for (var i2 = 0; i2 < this.boards.length; i2++) if (this.boards[i2].x < warnPoint) primaryIdx = i2;
    this.boards.forEach(function (b, k) {
      if (b.x >= tail) {
        if (b.x < cfg.closureStart) self.setBoard(b, 'inqueue', ['SLOW TRAFFIC', 'RIGHT LANE CLOSED'], false);
      } else if (b.x >= warnPoint || k === primaryIdx) {
        self.setBoard(b, 'primary', ['STOPPED TRAFFIC', 'PREPARE TO STOP'], true);
      } else if (risk - b.x <= 2500) {
        var km = Math.max(0.5, Math.round((risk - b.x) / 500) / 2);
        self.setBoard(b, 'secondary', ['QUEUE AHEAD', km.toFixed(1) + ' KM'], true);
      } else {
        self.setBoard(b, 'off', ['', ''], false);
      }
    });

    // VSL chain: 60 within 900 m of the risk point, 80 up to 2.1 km, steps of at most 20 km/h
    var vals = this.vsl.map(function (s) {
      var d = risk - s.x;
      if (s.x >= tail || d <= 900) return 60;
      if (d <= 2100) return 80;
      return 0;
    });
    for (var j = vals.length - 2; j >= 0; j--) {        // upstream sign may not be more than 20 above the next
      var nextV = vals[j + 1] || cfg.speedLimit, curV = vals[j] || cfg.speedLimit;
      if (curV - nextV > 20) vals[j] = nextV + 20 >= cfg.speedLimit ? 0 : nextV + 20;
    }
    this.vsl.forEach(function (s, k) {
      var v = vals[k], cur = s.v || cfg.speedLimit, nv = v || cfg.speedLimit;
      if (nv <= cur) { s.v = v; s.since = t; }                    // tighten (or confirm) at once
      else if (t - s.since >= cfg.holdTime) { s.v = v; s.since = t; }   // relax after hold time
    });

    // Level 2: queue growing past the warning chain -> semi-automatic UHF message
    var firstWarn = null;
    this.boards.forEach(function (b) { if (b.warn && (firstWarn === null || b.x < firstWarn)) firstWarn = b.x; });
    var tailIn5 = clamp(tail + w * 300, 0, cfg.closureStart);
    if (cfg.uhf && w < -0.5 && !c.uhfDraft && !c.uhfActive) {
      c.uhfDraft = { t: t, text: 'All trucks: stopped traffic at km ' + (risk / 1000).toFixed(1) + ', right lane closed ahead — prepare to stop.' };
      this.log(2, 'Queue growing ' + Math.round(-w * 3.6) + ' km/h upstream. UHF CB 40 message drafted — awaiting supervisor confirmation.');
    }
    if (c.uhfDraft && !c.uhfActive && t - c.uhfDraft.t >= cfg.uhfConfirmDelay) {
      c.uhfActive = true; c.uhfNextBroadcast = t;
      this.log(2, 'Supervisor confirmed. Broadcasting on UHF CB 40: "' + c.uhfDraft.text + '"');
    }
    if (c.uhfActive) {
      c.uhfDraft.text = 'All trucks: stopped traffic at km ' + (risk / 1000).toFixed(1) + ', right lane closed ahead — prepare to stop.';
      if (t >= c.uhfNextBroadcast) { this.broadcastUHF(risk); c.uhfNextBroadcast = t + 120; }
    }
    if (firstWarn !== null && tailIn5 < firstWarn + cfg.warnOffset && (!c.lastExtend || t - c.lastExtend > 300)) {
      c.lastExtend = t;
      this.log(2, 'Tail may pass the most upstream active board within 5 min — deploy an extra VMS upstream of km ' + (firstWarn / 1000).toFixed(1));
    }
  };

  Sim.prototype.broadcastUHF = function (risk) {
    var cfg = this.cfg, t = this.t, n = 0;
    for (var l = 0; l < 2; l++) {
      var arr = this.lanes[l];
      for (var i = 0; i < arr.length; i++) {
        var v = arr[i];
        if (!v.truck || v.x > risk || v.x < risk - 3000) continue;
        n++;
        if (hash01(mix(cfg.seed, v.id), 900 + ((t / 120) | 0)) < cfg.pNotice) v.alertUntil = Math.max(v.alertUntil, t + cfg.alertWindow);
      }
    }
    if (t > cfg.warmup) { this.m.uhfBroadcasts++; this.m.trucksReached += n; }
  };

  // --------------------------------------------------------- main step
  Sim.prototype.stepOnce = function () {
    var cfg = this.cfg, dt = cfg.dt;
    this.arrivals();
    this.laneChanges();
    this.accelerations();
    this.move();
    this.t = Math.round((this.t + dt) * 1000) / 1000;
    this.step++;
    this.measure();
    // exits
    for (var l = 0; l < 2; l++) {
      var arr = this.lanes[l];
      while (arr.length && arr[0].x > cfg.roadLength) {
        var v = arr.shift();
        if (this.t > cfg.warmup) { this.m.exits++; this.m.travelTimeSum += this.t - v.entryT; }
      }
    }
    var tInt = Math.round(this.t * 10);
    if (tInt % 10 === 0) this.secondly();
    if (cfg.recordTimeSpace && tInt % 10 === 0) this.timeSpace(tInt % (this.tsEvery * 10) === 0);
    if (tInt % (cfg.controlPeriod * 10) === 0) this.control();
  };

  Sim.prototype.runUntil = function (tEnd) {
    var cfg = this.cfg;
    tEnd = Math.min(tEnd, cfg.duration);
    while (this.t < tEnd - 1e-9) this.stepOnce();
  };

  Sim.prototype.done = function () { return this.t >= this.cfg.duration - 1e-9; };

  Sim.prototype.vehicleCount = function () { return this.lanes[0].length + this.lanes[1].length; };

  // --------------------------------------------------------- results
  function pct(a, p) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; });
    var i = Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))));
    return s[i];
  }

  Sim.prototype.results = function () {
    var m = this.m, cfg = this.cfg;
    var hours = Math.max(1e-9, (this.t - cfg.warmup) / 3600);
    var mean = function (a) { if (!a.length) return null; var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s / a.length; };
    return {
      strategy: cfg.strategy, seed: cfg.seed, pNotice: cfg.pNotice,
      simHours: hours,
      eoqConflicts: m.conflicts,
      eoqConflictsPerHour: m.conflicts / hours,
      truckConflicts: m.conflictsTruck,
      collisions: m.collisions,
      queueJoins: m.joins,
      timelyWarningShare: m.joins ? m.covered / m.joins : null,
      noWarningShare: m.joins ? m.none / m.joins : null,
      tooLateShare: m.joins ? m.tooLate / m.joins : null,
      tooEarlyShare: m.joins ? m.tooEarly / m.joins : null,
      warningCredibility: m.warnTime ? m.credibleTime / m.warnTime : null,
      dynamicWarningCredibility: m.dynWarnTime ? m.dynCredibleTime / m.dynWarnTime : null,
      ttcExposure: m.tet,
      collisionXs: m.collisionEvents.map(function (e) { return Math.round(e.x); }),
      conflictXs: m.conflictEvents.map(function (e) { return Math.round(e.x); }),
      conflictTs: m.conflictEvents.map(function (e) { return Math.round(e.t); }),
      mergeCollisions: m.mergeCollisions,
      queueTimeUncoveredShare: m.queueTime ? m.uncoveredQueueTime / m.queueTime : null,
      approachSpeedMean: mean(m.approachSpeeds),
      approachSpeedP85: pct(m.approachSpeeds, 0.85),
      throughputPerHour: m.exits / hours,
      meanTravelTime: m.exits ? m.travelTimeSum / m.exits : null,
      maxQueueLength: m.maxQueueLen,
      queueMinutes: m.queueTime / 60,
      tailPredMAE: m.predErrN ? m.predErrSum / m.predErrN : null,
      tailNowMAE: m.nowErrN ? m.nowErrSum / m.nowErrN : null,
      warnOverrunPred: m.predErrN ? m.overrunPred / m.predErrN : null,
      warnOverrunNow: m.nowErrN ? m.overrunNow / m.nowErrN : null,
      highSpeedAlerts: m.alertsL3,
      uhfBroadcasts: m.uhfBroadcasts
    };
  };

  function runScenario(options) {
    var s = new Sim(merge(options || {}, { recordTimeSpace: false }));
    s.runUntil(s.cfg.duration);
    return s.results();
  }

  root.QG = {
    KMH: KMH, DEFAULTS: DEFAULTS, Sim: Sim, runScenario: runScenario, demandAt: demandAt,
    merge: merge, mulberry32: mulberry32, mix: mix
  };
})(typeof window !== 'undefined' ? window : this);
