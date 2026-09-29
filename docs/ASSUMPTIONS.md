# Model and assumptions

QueueGuard is evaluated in a purpose-built traffic microsimulation (`js/sim.js`). This page lists every modelling choice that affects the results, why it was made, and whether it is varied in the sensitivity analysis (`eval.html`). The simulation compares strategies under the same assumptions; it does not predict real crash reductions. That needs a field pilot (see the README).

## Scenario

| Item | Value | Notes |
|---|---|---|
| Road | One direction, 2 lanes, 7.2 km, 100 km/h | Freeway or highway lane closure |
| Work zone | Right lane closed from km 6.0 to 6.6; 60 km/h through the zone | "RIGHT LANE CLOSED" sign at km 4.9 |
| Static signs (all strategies) | ROADWORKS AHEAD km 4.5, PREPARE TO STOP km 5.0, 80 km/h km 5.2, 60 km/h km 5.8 | Typical fixed advance-warning layout |
| Demand | 900 veh/h → 1,800 veh/h peak (15–40 min) → 600 veh/h | Peak exceeds work-zone capacity so a queue forms and dissipates; peak varied 1,600–2,000 |
| Heavy vehicles | 10% | 12–18 m long, lower acceleration and braking |
| Duration | 70 min per run; first 5 min excluded | |
| Emergent work-zone capacity | about 1,120 veh/h | Lower than many field values, so queues are conservatively long |

## Driver model

| Component | Choice | Source / rationale | Varied? |
|---|---|---|---|
| Car following | Intelligent Driver Model, with the improved (IIDM) free-road term above the desired speed | Treiber, Hennecke & Helbing (2000), *Phys. Rev. E* 62; Treiber & Kesting, *Traffic Flow Dynamics* (2013) | – |
| Merging | Forced merge out of the closed lane with a MOBIL-style safety check (new follower may not need to brake harder than 3–4 m/s²); 70% early mergers; cooperative zipper yielding at the taper | Kesting, Treiber & Helbing (2007), MOBIL, *Transp. Res. Record* 1999 | – |
| Speed compliance | 70% of drivers follow posted/variable limits; the rest drive 15 km/h above them | Assumption | – |
| Distraction | 25% of drivers are distraction-prone (eyes-off-road episodes of 1.5–3.5 s about every 25 s); others have 0.5–1.5 s episodes about every 70 s. During an episode the driver keeps the current acceleration and misses roadside signs | Assumption; the kind of glance behaviour that makes end-of-queue crashes possible | – |
| Recognising stopped traffic | An unwarned driver recognises a much slower vehicle ahead only within 150–300 m (uniform per driver), then reacts after 1.0 s | Assumption; drivers judge closing speed poorly at long range | Yes: 100–200, 150–300, 250–450 m |
| Effect of a warning | A driver who notices a queue warning expects the queue: recognises it up to 500 m ahead, has no distraction episodes and caps speed at 80 km/h for **60 s** | Assumption. The 60 s window is why *where* a warning is placed matters: too early and it is forgotten, too late and there is no time to stop | pNotice: 20–80% |
| Chance of noticing a warning | 60%, **identical for every sign type** (static sign, fixed QWS board, QueueGuard board) | Deliberately conservative: QueueGuard gets no credit for colour or flashing, only for placement and timing | Yes |
| UHF broadcast | Trucks within 3 km upstream of the tail may notice (same 60%) | Semi-automatic: drafted by the system, confirmed by the supervisor | – |

## What QueueGuard sees

The controller only uses what a real deployment would have: 20 s mean speeds from radar detectors every 400 m (km 1.0–5.8). It never reads the simulator's ground truth.

| Step | Rule |
|---|---|
| Queued detector | mean speed < 35 km/h for two periods (or < 20 km/h once); cleared > 55 km/h for two periods |
| Tail estimate | interpolated at 40 km/h between the most upstream queued detector and the next free one |
| Tail prediction | least-squares tail velocity over 180 s, extrapolated 90 s; warnings use the more upstream of current and predicted tail |
| Warning distance | 300 m (stopping sight distance at 100 km/h plus legibility) |
| VMS | first board upstream of the warning point shows STOPPED TRAFFIC / PREPARE TO STOP; boards further upstream (within 2.5 km) show QUEUE AHEAD x KM |
| VSL | 60 km/h within 900 m of the predicted tail, 80 km/h up to 2.1 km; steps ≤ 20 km/h; lowered at once, raised after 60 s |
| Fail-safe | no detector data for 60 s → every board PREPARE TO STOP, VSL 80 |

## Baselines

* **Static signs**: the fixed signs above, nothing else.
* **Fixed-position QWS**: static signs plus one VMS at km 4.4 that shows QUEUE AHEAD / PREPARE TO STOP while the detector at km 5.4 reads queued. This is how a detection-only queue warning system works when its sign and sensor are placed once for the whole shift.
* **Ablations**: QueueGuard without VSL; QueueGuard placing warnings on the current (not predicted) tail.

## Metrics

| Metric | Definition |
|---|---|
| Severe end-of-queue conflict | A follower approaching a queued leader (< 30 km/h, settled in its lane for > 3 s, upstream of the merge area) with TTC ≤ 1 s or DRAC ≥ 3.4 m/s². These are the serious-conflict thresholds used by TfNSW/Deakin (2025). Counted once per episode |
| End-of-queue collision | Overlap with such a leader. Merge-area overlaps are counted separately and excluded |
| TTC < 3 s exposure | Vehicle-seconds with TTC below 3 s against a queued leader (time-exposed TTC, Minderhoud & Bovy 2001) |
| Arrival speed | Speed when a vehicle first comes within 200 m of a queued leader; mean and 85th percentile |
| Warned in time | Share of vehicles joining the queue whose last queue warning was 150–1,500 m before the point where they joined |
| Queue time uncovered | Share of seconds with a queue during which no active warning sat 150–1,500 m upstream of the tail |
| Warning credibility | Share of warning-seconds with a real queue tail within 2.5 km downstream of the sign |
| Warning placed too late | Share of predictions after which the real tail, 90 s later, was within 150 m of the planned warning point |

## Known limitations

* No field calibration. Parameters are plausible but not fitted to Victorian data. The next step is calibration against radar and CCTV data from an RPM site (see the pilot plan in the README).
* One road geometry, no crests or curves. Sight-limited sites are exactly where QueueGuard matters most, and the guideline generator treats them as higher risk.
* The IDM is collision-free unless a driver is distracted or recognises the queue late, so collisions are rare; conflicts and TTC exposure are the main outcomes, as in the TfNSW/Deakin study.
* Colour, flashing and message wording are not modelled as better than static text. This is conservative for QueueGuard.
* The warning-effect model (alert for 60 s) is the central assumption; the sensitivity analysis shows how results change as the chance of noticing a warning drops to 20%.
