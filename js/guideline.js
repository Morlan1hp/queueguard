/* QueueGuard — site end-of-queue (EoQ) guideline generator.
 * Planning aid only: every output must be checked by a qualified traffic management designer. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var IDS = ['site', 'speed', 'lanes', 'closed', 'demand', 'cap', 'hv', 'dur', 'sight', 'period'];

  function r50(x) { return Math.ceil(x / 50) * 50; }
  function km(x) { return (x / 1000).toFixed(1) + ' km'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function compute(p) {
    var open = Math.max(1, p.lanes - p.closed);
    var ET = 2.0;                                              // passenger-car equivalent of a heavy vehicle
    var fHV = 1 / (1 + p.hv / 100 * (ET - 1));
    var capacity = open * p.cap * fHV;                         // veh/h through the work zone
    var excess = Math.max(0, p.demand - capacity);
    var queued = excess * p.dur;                               // vehicles stored at the end of the peak
    var spacing = 7.5 * (1 - p.hv / 100) + 18 * (p.hv / 100);  // m per vehicle when stopped
    var slow = 1.3;                                            // queues creep, so spacing is larger than at jam
    var qLen = queued * spacing * slow / p.lanes;
    var kq = p.lanes * 1000 / (spacing * slow);                // veh/km in the queue
    var ku = p.demand / p.speed;                               // veh/km upstream
    var w = kq > ku ? excess / (kq - ku) : 0;                  // km/h the tail moves upstream (shockwave)
    function ssd(v, d, rt) { return v * rt / 3.6 + v * v / (254 * d); }
    var rt = p.sight ? 2.5 : 2.0;
    var ssdCar = ssd(p.speed, 0.36, rt), ssdTruck = ssd(p.speed, 0.29, rt);
    var legibility = p.speed >= 80 ? 150 : 100;
    var warnOffset = r50(ssdTruck + legibility);
    var coverage = Math.max(1000, r50(qLen * 1.5)) + warnOffset;          // chain must reach this far upstream of the taper
    var spacingDet = 400, spacingVms = 1200;
    var nDet = Math.ceil(coverage / spacingDet) + 1;
    var nVms = Math.max(2, Math.ceil(coverage / spacingVms) + 1);
    var nVsl = p.speed >= 80 ? nVms : 0;
    var risk = 'Low';
    if (qLen > 250 || p.sight) risk = 'Medium';
    if ((qLen > 500 && p.speed >= 80) || (p.sight && qLen > 150)) risk = 'High';
    return { open: open, capacity: capacity, excess: excess, queued: queued, qLen: qLen, w: w, ssdCar: ssdCar, ssdTruck: ssdTruck,
      warnOffset: warnOffset, coverage: coverage, nDet: nDet, nVms: nVms, nVsl: nVsl, risk: risk, rt: rt, spacingDet: spacingDet, spacingVms: spacingVms };
  }

  function layoutSVG(p, c) {
    var far = Math.max(c.coverage, 300 + (c.nVms - 1) * c.spacingVms, c.nVsl ? 900 + (c.nVsl - 1) * c.spacingVms : 0);
    var W = 900, H = 170, ml = 30, mr = 30, L = far + 300 + 700;
    var X = function (d) { return W - mr - (d + 700) / L * (W - ml - mr); };   // d = metres upstream of the taper
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Device layout">';
    s += '<rect x="' + ml + '" y="80" width="' + (W - ml - mr) + '" height="34" fill="#3A424C"/>';
    s += '<line x1="' + ml + '" x2="' + (W - mr) + '" y1="97" y2="97" stroke="#D9D9D9" stroke-dasharray="8 8"/>';
    s += '<polygon points="' + X(0) + ',114 ' + X(-150) + ',97 ' + X(-700) + ',97 ' + X(-700) + ',114" fill="#FF8A1F" opacity="0.7"/>';
    s += '<text x="' + X(-350) + '" y="134" font-size="12" text-anchor="middle" fill="#14181D">work zone</text>';
    if (c.qLen > 0) {
      s += '<rect x="' + X(c.qLen) + '" y="82" width="' + (X(0) - X(c.qLen)) + '" height="30" fill="#D63031" opacity="0.45"/>';
      s += '<text x="' + X(c.qLen) + '" y="150" font-size="12" text-anchor="middle" fill="#B3261E">expected tail ' + km(c.qLen) + '</text>';
    }
    for (var i = 0; i < c.nDet; i++) { var d = i * c.spacingDet; s += '<rect x="' + (X(d) - 3) + '" y="117" width="6" height="5" fill="#1E6B52"/>'; }
    for (var j = 0; j < c.nVms; j++) {
      var dv = 300 + j * c.spacingVms;
      s += '<rect x="' + (X(dv) - 16) + '" y="40" width="32" height="16" fill="#111" stroke="#F5A623"/><line x1="' + X(dv) + '" x2="' + X(dv) + '" y1="56" y2="80" stroke="#56606B"/>';
      s += '<text x="' + X(dv) + '" y="34" font-size="11" text-anchor="middle" fill="#14181D">VMS ' + km(dv) + '</text>';
    }
    for (var k = 0; k < c.nVsl; k++) {
      var ds = 900 + k * c.spacingVms;
      s += '<circle cx="' + X(ds) + '" cy="68" r="8" fill="#fff" stroke="#D93A2F" stroke-width="3"/>';
    }
    s += '<text x="' + (W - mr) + '" y="14" font-size="12" text-anchor="end" fill="#56606B">traffic →   (distances measured upstream of the taper)</text>';
    return s + '</svg>';
  }

  function render() {
    var p = {
      site: $('site').value, speed: +$('speed').value, lanes: +$('lanes').value, closed: +$('closed').value,
      demand: +$('demand').value, cap: +$('cap').value, hv: +$('hv').value, dur: +$('dur').value, sight: $('sight').value === '1', period: $('period').value
    };
    if (p.closed >= p.lanes) p.closed = p.lanes - 1;
    var c = compute(p);
    var vmsRows = '', vslRows = '';
    for (var j = 0; j < c.nVms; j++) vmsRows += '<tr><td>VMS ' + (j + 1) + '</td><td>' + km(300 + j * c.spacingVms) + ' upstream of taper</td><td>Colour/amber-capable board with radar; 4G link</td></tr>';
    for (var k = 0; k < c.nVsl; k++) vslRows += '<tr><td>VSL ' + (k + 1) + '</td><td>' + km(900 + k * c.spacingVms) + ' upstream of taper</td><td>Only values within the approved speed-zone authorisation</td></tr>';
    var now = new Date(), pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
    var h = '';
    h += '<h1>End-of-queue management plan</h1>';
    h += '<div class="sub">' + esc(p.site) + ' · ' + p.speed + ' km/h · ' + p.closed + ' of ' + p.lanes + ' lanes closed · ' + esc(p.period) + ' works · generated ' + today + ' by QueueGuard</div>';
    h += '<div class="kv">' +
      '<div><b>' + Math.round(c.capacity) + '</b><span>work-zone capacity (veh/h)</span></div>' +
      '<div><b>' + (c.qLen > 0 ? km(c.qLen) : 'none') + '</b><span>expected maximum queue</span></div>' +
      '<div><b>' + (c.w > 0 ? c.w.toFixed(1) + ' km/h' : '–') + '</b><span>tail growth (shockwave)</span></div>' +
      '<div><b><span class="risk ' + c.risk + '">' + c.risk + '</span></b><span>end-of-queue risk</span></div></div>';

    h += '<h2>1 · When QueueGuard is required</h2><ul>' +
      '<li>Required when the posted speed is 80 km/h or more <b>and</b> a queue longer than 250 m is expected, or whenever a crest or curve limits sight of the queue.</li>' +
      '<li>This site: demand ' + p.demand + ' veh/h against capacity ' + Math.round(c.capacity) + ' veh/h → ' + Math.round(c.queued) + ' vehicles stored after ' + p.dur + ' h, about <b>' + km(c.qLen) + '</b> of queue. Risk: <span class="risk ' + c.risk + '">' + c.risk + '</span>.</li></ul>';

    h += '<h2>2 · Device layout</h2>' + layoutSVG(p, c) +
      '<p>Warning distance = heavy-vehicle stopping sight distance (' + Math.round(c.ssdTruck) + ' m at ' + p.speed + ' km/h, reaction ' + c.rt + ' s) + sign legibility → <b>' + c.warnOffset + ' m</b>. ' +
      'The chain must cover ' + km(c.coverage) + ' upstream of the taper (1.5 × expected queue + warning distance).</p>' +
      '<table><tr><th>Device</th><th>Position</th><th>Notes</th></tr>' +
      '<tr><td>Radar detectors × ' + c.nDet + '</td><td>every ' + c.spacingDet + ' m from the taper to ' + km(c.coverage) + '</td><td>On VMS trailers where possible; 20 s speed averages</td></tr>' +
      vmsRows + vslRows + '</table>';

    h += '<h2>3 · Message library and display rules</h2><table><tr><th>State</th><th>Message</th><th>Shown on</th></tr>' +
      '<tr><td>Queue — first board upstream of (predicted tail − ' + c.warnOffset + ' m)</td><td><span class="led">STOPPED TRAFFIC / PREPARE TO STOP</span> flashing</td><td>1–2 boards</td></tr>' +
      '<tr><td>Queue — further upstream, within 2.5 km of the tail</td><td><span class="led">QUEUE AHEAD / 1.5 KM</span></td><td>remaining boards</td></tr>' +
      '<tr><td>Board inside the queue</td><td><span class="led">SLOW TRAFFIC / RIGHT LANE CLOSED</span></td><td>—</td></tr>' +
      '<tr><td>No queue</td><td><span class="led">ROADWORKS / RIGHT LANE CLOSED</span> on the board nearest the works; others blank</td><td>—</td></tr>' +
      '<tr><td>Detector data lost for 60 s</td><td><span class="led">ROADWORKS AHEAD / PREPARE TO STOP</span> on every board; VSL 80</td><td>all</td></tr></table>' +
      '<ul><li>Never show a queue message without a detected queue: every false warning trains drivers to ignore the next one.</li>' +
      '<li>Escalate immediately; relax a message only after it has not been re-confirmed for 60 s.</li>' +
      '<li>Use colour/amber flashing on the primary message. In the TfNSW/Deakin end-of-queue field trial (2025), monochrome VMS and a commercial queue warning system had limited or no measurable effect, while colour VMS and flashing queue-warning signs reduced speeding.</li>' +
      (c.nVsl ? '<li>VSL: 60 km/h within 900 m of the predicted tail, 80 km/h up to 2.1 km, otherwise blank; steps of at most 20 km/h between consecutive signs; lower at once, raise only after 60 s.</li>' : '') + '</ul>';

    h += '<h2>4 · Detection thresholds</h2><table><tr><th>Parameter</th><th>Value</th></tr>' +
      '<tr><td>Queued</td><td>mean speed &lt; 35 km/h for two 20 s periods (or &lt; 20 km/h once)</td></tr>' +
      '<tr><td>Cleared</td><td>mean speed &gt; 55 km/h for two 20 s periods</td></tr>' +
      '<tr><td>Tail estimate</td><td>interpolated between the last queued and first free detector at 40 km/h</td></tr>' +
      '<tr><td>Tail prediction</td><td>least-squares tail velocity over the last 180 s, extrapolated 90 s; warnings use the more upstream of current and predicted tail</td></tr></table>';

    h += '<h2>5 · Alerts and roles</h2><table><tr><th>Level</th><th>Trigger</th><th>Action</th><th>Who</th></tr>' +
      '<tr><td>1</td><td>Queue detected / cleared</td><td>Dashboard notification</td><td>Site supervisor</td></tr>' +
      '<tr><td>2</td><td>Tail growing &gt; 1.8 km/h, or predicted to pass the most upstream active board within 5 min</td><td>Draft UHF CB 40 message → supervisor confirms (semi-automatic); deploy an extra VMS or a TMA upstream</td><td>Site supervisor, traffic controllers</td></tr>' +
      '<tr><td>3</td><td>Vehicle faster than 80 km/h within 450 m of the tail</td><td>Vibration alert on worker phones / wearables; log the event</td><td>All workers near the tail</td></tr></table>' +
      '<p>UHF is semi-automatic on purpose: in the same field trial, manual UHF broadcasts reduced speeding while automatic ones showed no measurable effect.</p>';

    h += '<h2>6 · Monitoring and review</h2><ul>' +
      '<li>Daily: queue minutes, maximum queue length, share of queue time with a timely warning (target 100%), false-warning share (target &lt; 10%).</li>' +
      '<li>Weekly: 85th-percentile arrival speed at the tail from radar; severe conflicts (TTC ≤ 1 s or DRAC ≥ 3.4 m/s²) from CCTV-trailer video, the surrogate safety measure used by TfNSW/Deakin.</li>' +
      '<li>Escalate the plan if the tail passes the most upstream board on two shifts, or if severe conflicts exceed the baseline.</li></ul>';

    h += '<h2>7 · Alignment</h2><ul>' +
      '<li>Austroads Guide to Temporary Traffic Management (AGTTM), incorporated in Victoria\'s Code of Practice for Worksite Safety – Traffic Management (from 1 December 2023).</li>' +
      '<li>Transport for NSW / Deakin University, <i>Work Zone End of Queue Study – Summary Report</i> (iMOVE, April 2025).</li>' +
      '<li>Stopping sight distance per the Austroads road design method (reaction time and deceleration coefficients to be confirmed by the designer).</li></ul>' +
      '<div class="warnbox"><b>Planning aid only.</b> Capacity, queue length and device positions are estimates from simple queuing and shockwave theory. A qualified traffic management designer must verify them against the site, the approved traffic management plan and the speed-zone authorisation before deployment.</div>';
    $('doc').innerHTML = h;
  }

  IDS.forEach(function (id) { $(id).addEventListener('input', render); $(id).addEventListener('change', render); });
  render();
})();
