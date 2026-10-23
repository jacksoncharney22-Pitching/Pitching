// Feole Pitching: the report. Grades the delivery against published research ranges for the pitcher's level
// (middle school, high school, college, professional), with a drill for each item.
//
// Where the ranges come from:
//  - Fleisig et al. 1999, J Biomech 32:1371 ("Kinematic and kinetic comparison of baseball pitching among various
//    levels of development"): lab motion capture, 231 pitchers (youth 23, high school 33, college 115, pro 60).
//    Mean ± SD for stride, lead knee, elbow, forward trunk tilt, layback, rotation speeds.
//  - Uplift Labs baseball pitching norms (2025 sessions; youth 206, high school 226, college 167, pro 155):
//    video-based, 5th/25th/50th/75th/95th percentiles for side tilt and hip-shoulder separation (max X factor).
//  - Fortenbaugh, Fleisig & Andrews 2009, Sports Health 1(4): shoulder abducted about 90° at foot contact and release.
//  Middle school uses the youth groups of these studies.
//
// Three readings instead of one score, because elite pitchers are often elite BECAUSE they move differently:
//  - Performance: measurements research links to velocity (front leg firming up and trunk speed: NCAA D1 in-game study;
//    stride and forward lean: level research). Weighted by how strong that link is.
//  - Arm health: measurements linked to elbow and shoulder load (elbow height: Fortenbaugh 2009; excessive side tilt
//    raises velocity AND joint loads: Oyama et al., 72 high school pitchers). Never excused by velocity.
//  - Style: everything else, described against the level but not graded.
// With the pitcher's velocity: when it's high for the level, a performance measurement outside the range is marked
// "Works for him" (it's clearly not costing velocity) instead of a fault. When it's low, those are flagged as likely gains.
//
// Grading: "Good" inside the middle of the level's range (mean ± 1 SD, or 25th-75th percentile), "Check" inside the
// wide range (± 2 SD, or 5th-95th), "Work on" outside it. Every check also carries how well one camera can measure
// it: only "solid" checks (in the camera's view from the side) can be graded "Work on"; "estimated" ones (need depth)
// top out at "Check"; "rough" ones are shown with the research value but not graded.

export const LEVELS = { ms: "Middle school", hs: "High school", col: "College", pro: "Professional" };
const FL = { ms: "youth", hs: "high school", col: "college", pro: "professional" };
const SRC = {
  fleisig: "Fleisig et al. 1999, J Biomech (lab motion capture, 231 pitchers)",
  uplift: "Uplift Labs pitching norms, 2025 (video, about 750 pitchers)",
  ffa: "Fortenbaugh, Fleisig & Andrews 2009, Sports Health",
  uplift_flag: "Uplift Labs 'knee collapse' flag (more than 20° of extra bend from landing to release)",
  ncaa: "Kinematic predictors of in-game fastball velocity in NCAA Division I pitchers, IJESAB (front knee extension and trunk speed)",
  oyama: "Oyama et al., excessive contralateral trunk tilt in 72 high school pitchers (higher velocity and higher elbow/shoulder loads)",
  velo: "Fastball velocity by age (Eisenmann, showcase data: about 65 mph at 13, 87 mph at 18); MLB average fastball about 94 mph",
};
export const SOURCES = SRC;
// Fleisig 1999 mean, SD by level
const F = {
  stride:   { ms: [85, 8], hs: [85, 9], col: [85, 6], pro: [86, 5] },          // % of height, at foot contact
  kneeFC:   { ms: [43, 12], hs: [50, 9], col: [48, 12], pro: [46, 8] },
  kneeBR:   { ms: [36, 11], hs: [43, 13], col: [39, 13], pro: [38, 13] },
  elbowFC:  { ms: [74, 17], hs: [82, 17], col: [85, 18], pro: [87, 15] },
  mer:      { ms: [177, 12], hs: [174, 9], col: [173, 10], pro: [175, 11] },
  fwdBR:    { ms: [32, 9], hs: [31, 9], col: [33, 10], pro: [33, 9] },
  pelvisV:  { ms: [650, 110], hs: [640, 90], col: [670, 90], pro: [620, 80] },
  trunkV:   { ms: [1180, 110], hs: [1130, 110], col: [1190, 100], pro: [1200, 80] },
};
// Uplift Labs percentiles [5, 25, 50, 75, 95] by level
const U = {
  lat:  { ms: [3, 10, 16, 23, 30], hs: [2, 10, 15, 21, 30], col: [-5, 8, 15, 21, 27], pro: [-9, 5, 13, 18, 26] },
  xfac: { ms: [9, 17, 23, 29, 38], hs: [12, 19, 26, 31, 39], col: [12, 22, 29, 35, 41], pro: [7, 14, 20, 26, 37] },
};

const CONF = { solid: "Solid", est: "Estimated", rough: "Rough" };
const CAP = { solid: 2, est: 1, rough: 0 };            // 2 = can be "Work on", 1 = up to "Check", 0 = not graded
const LEVEL = ["Good", "Check", "Work on"];
const r0 = v => Math.round(v);
function fmt(v, u = "°") { return v == null || !Number.isFinite(v) ? "—" : Math.round(v) + u }
const ftin = inches => { const f = Math.floor(inches / 12), i = Math.round(inches - 12 * f); return i === 12 ? `${f + 1}′ 0″` : `${f}′ ${i}″` };

// grading helpers: sd = [mean, sd]; pct = [p5, p25, p50, p75, p95]; side: "both" | "low" (only too little is a problem)
function gradeSD(v, [m, s], side = "both") {
  if (v == null || !Number.isFinite(v)) return null;
  const z = (v - m) / s;
  if (side === "low") return z >= -1 ? 0 : z >= -2 ? 1 : 2;
  if (side === "high") return z <= 1 ? 0 : z <= 2 ? 1 : 2;
  return Math.abs(z) <= 1 ? 0 : Math.abs(z) <= 2 ? 1 : 2;
}
function gradePct(v, p, side = "both") {
  if (v == null || !Number.isFinite(v)) return null;
  if (side === "low") return v >= p[1] ? 0 : v >= p[0] ? 1 : 2;
  if (side === "high") return v <= p[3] ? 0 : v <= p[4] ? 1 : 2;
  return v >= p[1] && v <= p[3] ? 0 : v >= p[0] && v <= p[4] ? 1 : 2;
}


// fastball velocity by level, mph: [typical, high]. Approximate, from the sources in SRC.velo.
const VELO = { ms: [65, 72], hs: [80, 87], col: [88, 92], pro: [94, 96] };
const GROUPS = { health: "Arm health", perf: "Performance", style: "Style" };

export function buildReport(D, levelKey) {
  const lv = LEVELS[levelKey] ? levelKey : (LEVELS[D.level] ? D.level : "hs"), L = LEVELS[lv], lvl = L.toLowerCase();
  const M = D.metrics, T = D.frames, FPS = D.fps, P = D.pose;
  const ph = Object.fromEntries(D.phases.map(p => [p.name, p.frame]));
  const LL = ph["Peak leg lift"], FS = ph["Foot strike"], AC = ph["Arm cocked"], R = ph["Release"];
  const at = (k, f) => (M[k] && M[k][f] != null ? M[k][f] : null);
  const range = (k, a, b) => { const v = []; for (let t = Math.max(0, a); t <= Math.min(T - 1, b); t++) if (M[k] && M[k][t] != null) v.push(M[k][t]); return v };
  const LH = D.throwHand === "L";
  const lead = LH ? 28 : 27, back = LH ? 27 : 28, wrist = LH ? 15 : 16;

  // body size from the skeleton's own bones (hip joint to ankle is about 49% of standing height: Drillis & Contini)
  const bl = (a, b) => { const k = D.bones[a + "," + b] ?? D.bones[b + "," + a]; return k ?? null };
  const skelH = ((bl(23, 25) ?? 0.42) + (bl(25, 27) ?? 0.42)) / 0.49;
  const realH = D.heightIn > 0 ? D.heightIn * 0.0254 : null;
  const toIn = m => realH ? m * (realH / skelH) / 0.0254 : null;

  // velocity band for this level
  const mph = D.velo > 0 ? D.velo : null, vb = VELO[lv];
  const band = mph == null ? null : mph >= vb[1] ? "high" : mph >= vb[0] - 4 ? "typical" : "low";

  const side = Math.abs((D.cameraDir || [0, 0, 1])[2]) >= 0.9;
  const sideConf = side ? "solid" : "est";
  const items = [];
  const add = (o) => { o.level = o.raw == null || CAP[o.conf] === 0 || o.group === "style" ? null : Math.min(o.raw, CAP[o.conf]); items.push(o); return o };
  const sdTxt = ([m, s]) => `${r0(m - s)}–${r0(m + s)}`;
  const pctTxt = p => `${p[1]}–${p[3]}`;

  // ================= PERFORMANCE (linked to velocity)
  let stridePct = null;
  {
    const Fr = P[FS], s = Fr ? Math.hypot(Fr[lead][0] - Fr[back][0], Fr[lead][2] - Fr[back][2]) : null; stridePct = s != null ? 100 * s / skelH : null;
    const n = F.stride[lv]; let raw = gradeSD(stridePct, n, "low"); if (stridePct != null && stridePct > n[0] + 2 * n[1]) raw = 1;
    const inch = s != null ? toIn(s) : null;
    add({ id: "stride", group: "perf", weight: 2, name: "Stride length", value: fmt(stridePct, "% of height") + (inch ? ` (${ftin(inch)})` : ""), target: `${L}: ${sdTxt(n)}% of height (average ${n[0]}%)`, src: "fleisig", frame: FS, conf: sideConf, raw,
      why: "A long, direct stride moves the body toward the plate and gives the hips time to turn before the arm comes through.",
      fix: stridePct != null && stridePct < n[0] ? `Stride is short for ${lvl} pitchers. Drive off the rubber longer before the front foot lands.` : "Stride is very long. Over-striding makes it hard to get over the front leg.",
      drill: `Stride-length line drill: mark ${n[0]}% of height${realH ? ` (${ftin(D.heightIn * n[0] / 100)})` : ""} from the rubber and land on it for 10 throws; add step-behind (crow-hop) throws to feel the push.` });
  }
  {
    const kFS = at("leadKnee", FS), kR = at("leadKnee", R), ch = kR != null && kFS != null ? kR - kFS : null, n = F.kneeBR[lv];
    add({ id: "block", group: "perf", weight: 3, name: "Front leg firming up", value: ch == null ? "—" : `${fmt(kFS)} at landing → ${fmt(kR)} at release`, target: `Straightens after landing (${L} average ${F.kneeFC[lv][0]}° → ${n[0]}°)`, src: "ncaa", frame: R, conf: "est",
      raw: ch == null ? null : ch <= 5 ? 0 : ch <= 20 ? 1 : 2,
      why: "Straightening the front knee into release is one of the strongest links to velocity in the research: it stops the body's forward drift and turns it into rotation. More than 20° of extra bend is what Uplift flags as a knee collapse.",
      fix: "The front knee keeps bending after landing. Land on a braced knee and push back into the ground through release.",
      drill: "Lead-leg block holds: stride, land and freeze at release for 3 s; then med-ball rotational throws stepping into a firm front leg." });
  }
  let fwdV = null;
  {
    fwdV = at("trunkFwd", R); const n = F.fwdBR[lv];
    add({ id: "fwd", group: "perf", weight: 2, name: "Forward lean at release", value: fmt(fwdV), target: `${L}: ${sdTxt(n)}° (average ${n[0]}°)`, src: "fleisig", frame: R, conf: sideConf, raw: gradeSD(fwdV, n, "low"),
      why: "Getting the chest out over the front leg moves release closer to the plate (extension) and uses the trunk's flexion to add speed.",
      fix: `Release is early or upright for ${lvl} pitchers. Finish with the chest over the front knee.`,
      drill: "Towel drill to a partner's glove at full extension; chest-to-knee finishes, holding the end position for 2 s." });
  }
  {
    const sep = Math.max(...range("separation", LL, AC), -999), p = U.xfac[lv], v = sep > -999 ? sep : null;
    add({ id: "sep", group: "perf", weight: 1, name: "Hip–shoulder separation", value: fmt(v), target: `${L}: ${pctTxt(p)}° (middle half; median ${p[2]}°)`, src: "uplift", frame: FS, conf: "est", raw: gradePct(v, p, "low"),
      why: "Hips turning ahead of the shoulders stretches the trunk like a spring. Its link to velocity is real but small and varies a lot from pitcher to pitcher, so it counts least.",
      fix: "The hips and shoulders turn together. Lead with the hips and keep the front shoulder closed a moment longer.",
      drill: "Hip-lead drills: rocker throws and step-behind throws with the glove arm held closed; med-ball scoop tosses leading with the hip." });
  }

  // ================= ARM HEALTH (linked to elbow and shoulder load: never excused by velocity)
  {
    const a = at("throwAbd", R);
    add({ id: "abd", group: "health", weight: 3, name: "Elbow height at release", value: fmt(a), target: "About 90° (elbow level with the shoulders), all levels", src: "ffa", frame: R, conf: "est", raw: gradeSD(a, [90, 10]),
      why: "Around 90–100° the shoulder is in its strongest, safest position. A dropped or very high elbow increases stress on the elbow and shoulder.",
      fix: a != null && a < 90 ? "The elbow sits low at release. Get the elbow up to shoulder height as the trunk turns." : "The elbow is high at release. Check this matches the arm slot you want.",
      drill: "Wall drills for arm path; reverse throws and connection-ball throws to keep the elbow at shoulder height." });
  }
  {
    const l = at("trunkLat", R), p = U.lat[lv];
    add({ id: "lat", group: "health", weight: 2, name: "Side tilt at release", value: fmt(l), target: `${L}: up to ${p[3]}° (75th percentile; median ${p[2]}°)`, src: "oyama", frame: R, conf: "est", raw: gradePct(l, p, "high"),
      why: "Leaning hard toward the glove side raises the arm slot and can add velocity, but research on high school pitchers found it also raises elbow and shoulder loads. A trade-off worth managing, not ignoring.",
      fix: "More side tilt than most pitchers at this level. It may be helping velocity, but it loads the arm more: watch workload and keep it from growing.",
      drill: "Film several pitches and keep this number steady; core and hip mobility work so the tilt isn't covering for a lack of rotation." });
  }
  {
    const e = at("throwElbow", FS), n = F.elbowFC[lv];
    add({ id: "timing", group: "health", weight: 2, name: "Arm ready at landing", value: fmt(e) + " elbow bend", target: `${L}: ${sdTxt(n)}° (average ${n[0]}°)`, src: "fleisig", frame: FS, conf: "est", raw: gradeSD(e, n),
      why: "At landing the arm should be up and bent so it turns with the trunk. A long (straight) or late arm has to rush to catch up, which loads the shoulder and elbow.",
      fix: e != null && e < n[0] ? "The arm is long (straighter) at landing and may be running late. Break the hands earlier." : "The arm is very bent at landing. Check it isn't early.",
      drill: "Arm-path drills: 'up and show' throws (arm up at landing), plyo-ball pivot picks." });
  }

  // ================= STYLE (described against the level, not graded)
  {
    const k = at("leadKnee", FS), n = F.kneeFC[lv];
    add({ id: "kneeFC", group: "style", name: "Front knee bend at landing", value: fmt(k), target: `${L}: ${sdTxt(n)}° (average ${n[0]}°)`, src: "fleisig", frame: FS, conf: "est",
      why: k == null ? "" : k < n[0] - n[1] ? "Lands on a straighter front leg than most at this level." : k > n[0] + n[1] ? "Lands on a more bent front leg than most at this level." : "Lands with a typical front-knee bend for this level." });
  }
  {
    const h = at("leadHip", LL);
    add({ id: "lift", group: "style", name: "Leg lift height", value: fmt(h), target: "Style choice: no research standard", src: null, frame: LL, conf: "solid",
      why: h == null ? "" : h >= 100 ? "A high leg lift." : h >= 75 ? "A medium leg lift (thigh about level)." : "A low or short leg lift." });
  }
  {
    const er = Math.max(...range("throwER", FS, R).filter(v => v != null), -999), n = F.mer[lv];
    add({ id: "er", group: "style", name: "Layback", value: er >= 90 && er <= 220 ? fmt(er) : "couldn't measure", target: `${L}: ${sdTxt(n)}° (average ${n[0]}°)`, src: "fleisig", frame: AC, conf: "rough",
      why: "How far the forearm lays back before it whips forward. One camera can't see it well; a rough guide only." });
  }
  {
    const sp = k => { const a = M[k]; return a.map((_, i) => (a[Math.min(T - 1, i + 1)] - a[Math.max(0, i - 1)]) * FPS / (Math.min(T - 1, i + 1) - Math.max(0, i - 1))) };
    const ps = sp("pelvisRot"), ts = sp("trunkRot");
    let pm = FS, tm = FS; for (let t = LL; t <= Math.min(T - 1, R + 3); t++) { if (ps[t] > ps[pm]) pm = t; if (ts[t] > ts[tm]) tm = t }
    const gap = Math.round((tm - pm) / FPS * 1000);
    add({ id: "speed", group: "style", name: "Hip and trunk turning", value: `hips ${Math.round(ps[pm])}°/s, trunk ${Math.round(ts[tm])}°/s; ${gap >= 0 ? `hips peak first by ${gap} ms` : `trunk peaks first by ${-gap} ms`}`, target: `${L} average: hips ${F.pelvisV[lv][0]}°/s, trunk ${F.trunkV[lv][0]}°/s, hips first`, src: "fleisig", frame: pm, conf: "rough",
      why: "Trunk speed is a strong velocity predictor in the research, but video (especially below 240 fps) reads turning speed low and its order unreliably. Compare your own sessions; film at 240 fps for a real reading." });
  }
  {
    const tr = at("trunkRot", FS);
    add({ id: "closed", group: "style", name: "Shoulders at landing", value: tr == null ? "—" : tr <= 0 ? `closed (turned back ${Math.round(-tr)}°)` : `open ${Math.round(tr)}°`, target: "Most pitchers are still mostly facing the side", src: null, frame: FS, conf: "rough",
      why: "Opening early leaves the trunk less to stretch and, in research on high school pitchers, rotation out of order went with higher shoulder load. Measured from one side camera: reference only." });
  }
  if (realH) {
    const fx = Math.sign((P[FS] ? P[FS][lead][0] : 1) - (P[0] ? P[0][back][0] : 0)) || 1;
    const rub = (D.rubber || [0, 0])[0], hx = P[R] ? P[R][wrist][0] : null;
    const ext = hx != null ? toIn(Math.max(0, (hx - rub) * fx)) : null;
    if (ext) add({ id: "ext", group: "style", name: "Release extension", value: `${ftin(ext)} in front of the rubber`, target: "MLB pitchers are often around 6–7 ft", src: null, frame: R, conf: "rough",
      why: "How far toward the plate the ball is let go: more extension gets the pitch to the hitter sooner. Measured from the hand, so slightly short of the ball." });
  }

  // ---- compensations: one strength making up for another
  const byId = Object.fromEntries(items.map(i => [i.id, i]));
  const n = F.fwdBR[lv];
  if (byId.stride && byId.stride.level >= 1 && stridePct != null && stridePct < F.stride[lv][0] && fwdV != null && fwdV >= n[0]) {
    byId.stride.level -= 1; byId.stride.note = `Partly made up for by a strong forward lean at release (${fmt(fwdV)}), which also carries the release toward the plate.`;
  }
  // ---- velocity: high for the level -> a performance measurement outside the range is clearly not costing velocity
  for (const i of items) {
    if (i.group !== "perf" || i.level == null || i.level === 0) continue;
    if (band === "high") { i.works = true; i.prevLevel = i.level; i.level = 0; i.note = `Outside the typical ${lvl} range, but at ${mph} mph it is clearly working for him: treat it as part of his style. Change it only with a coach, and only if it costs nothing else.` }
    else if (band === "low") i.note = `With velocity below typical for ${lvl} pitchers, this is a likely place to gain.`;
  }
  if (band === "high") for (const i of items) if (i.group === "health" && i.level) i.note = `He throws hard (${mph} mph), so arm stress matters even more here.`;

  // ---- scores (weighted), priorities
  const score = g => { const gi = items.filter(i => i.group === g && i.level != null); const w = gi.reduce((a, i) => a + i.weight, 0); return w ? Math.round(100 * gi.reduce((a, i) => a + i.weight * (2 - i.level), 0) / (2 * w)) : null };
  const graded = items.filter(i => i.level != null);
  const work = graded.filter(i => i.level === 2), check = graded.filter(i => i.level === 1), good = graded.filter(i => i.level === 0 && !i.works), works = items.filter(i => i.works);
  const rank = i => (i.group === "health" ? 0 : 1) + (2 - i.level) * 2 - i.weight * 0.1;
  const priorities = [...work, ...check].sort((a, b) => rank(a) - rank(b));
  const used = [...new Set([...items.map(i => i.src), mph ? "velo" : null].filter(Boolean))].map(k => SRC[k]);
  return { items, work, check, good, works, priorities, style: items.filter(i => i.group === "style"),
    perfScore: score("perf"), healthScore: score("health"), score: null,
    level: lv, levelName: L, heightIn: D.heightIn || null, velo: mph, band, veloRef: vb, sources: used, height: skelH };
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
export const tagOf = i => i.works ? "Works for him" : i.level == null ? (i.group === "style" ? "Style" : "Info") : LEVEL[i.level];
export function veloLine(rep) {
  if (!rep.velo) return `Add the pitcher's velocity to tell style from faults (typical ${rep.levelName.toLowerCase()}: about ${rep.veloRef[0]} mph).`;
  return rep.band === "high" ? `${rep.velo} mph is high for ${rep.levelName.toLowerCase()} pitchers (typical about ${rep.veloRef[0]}): unusual performance measurements are treated as his style.`
    : rep.band === "low" ? `${rep.velo} mph is below typical for ${rep.levelName.toLowerCase()} pitchers (about ${rep.veloRef[0]}): performance flags are likely places to gain.`
    : `${rep.velo} mph is typical for ${rep.levelName.toLowerCase()} pitchers (about ${rep.veloRef[0]}).`;
}
export function reportHTML(rep) {
  const card = (i) => `<article class="rcard lv${i.works ? "w" : i.level ?? "n"}">
    <div class="rhead"><span class="rtag">${tagOf(i)}</span><h4>${esc(i.name)}</h4><button class="rshow" data-f="${i.frame}" type="button">Show</button></div>
    <div class="rnums"><span><b>${esc(i.value)}</b></span><span>${esc(i.target)}</span><span class="rconf">${CONF[i.conf]}</span></div>
    ${i.level ? `<p>${esc(i.fix)}</p>` : ""}
    ${i.note ? `<p class="rnote2">${esc(i.note)}</p>` : ""}
    ${i.why ? `<p class="${i.level ? "rwhy" : ""}">${esc(i.why)}</p>` : ""}
    ${i.level && i.drill ? `<p class="rdrill"><b>Drill:</b> ${esc(i.drill)}</p>` : ""}
    ${i.src ? `<p class="rsrc">Source: ${esc(SRC[i.src])}</p>` : ""}
  </article>`;
  const grp = (g, title, note) => { const list = rep.items.filter(i => i.group === g).sort((a, b) => (b.level ?? -1) - (a.level ?? -1) || (b.weight || 0) - (a.weight || 0)); return list.length ? `<h3 class="rsec">${title}</h3>${note ? `<p class="rnote">${note}</p>` : ""}<div class="rgrid">${list.map(card).join("")}</div>` : "" };
  const summary = rep.priorities.length
    ? `Top priorities: ${rep.priorities.slice(0, 3).map(i => `<b>${esc(i.name.toLowerCase())}</b>`).join(", ")}.`
    : `Nothing to fix. Every graded check is in the ${esc(rep.levelName.toLowerCase())} range${rep.works.length ? " or clearly working for him" : ""}.`;
  const opts = Object.entries(LEVELS).map(([k, v]) => `<option value="${k}"${k === rep.level ? " selected" : ""}>${v}</option>`).join("");
  const ring = (v, lbl) => `<div class="rscore"><span>${v ?? "—"}</span><small>${lbl}</small></div>`;
  return `<div class="rsum">
      <div class="rrings">${ring(rep.healthScore, "Arm health")}${ring(rep.perfScore, "Performance")}</div>
      <div><p class="rlead">${summary}</p>
      <div class="rctl"><label>Compared with <select id="repLevel">${opts}</select></label><label>Velocity <input id="repVelo" type="number" min="30" max="110" step="0.5" inputmode="decimal" placeholder="mph" value="${rep.velo ?? ""}"> mph</label>${rep.heightIn ? `<span>Height ${ftin(rep.heightIn)}</span>` : `<span>Height not entered</span>`}</div>
      <p class="rnote">${esc(veloLine(rep))} Arm health is never excused by velocity. Style is described, not graded. <b>Solid</b> = measured directly from a side-on video; <b>estimated</b> = needs depth one camera can't see well, so never graded worse than "Check".</p></div>
    </div>
    ${grp("health", "Arm health", "Linked to stress on the elbow and shoulder.")}
    ${grp("perf", "Performance", "Linked to velocity in the research, weighted by how strong that link is.")}
    ${grp("style", "Style profile", "How this delivery is put together, compared with " + esc(rep.levelName.toLowerCase()) + " pitchers. Not graded: many great pitchers are outside these.")}
    <p class="rnote rsources"><b>Sources:</b> ${rep.sources.map(esc).join(" · ")}.</p>`;
}
