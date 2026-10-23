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
  return Math.abs(z) <= 1 ? 0 : Math.abs(z) <= 2 ? 1 : 2;
}
function gradePct(v, p, side = "both") {
  if (v == null || !Number.isFinite(v)) return null;
  if (side === "low") return v >= p[1] ? 0 : v >= p[0] ? 1 : 2;
  return v >= p[1] && v <= p[3] ? 0 : v >= p[0] && v <= p[4] ? 1 : 2;
}

export function buildReport(D, levelKey) {
  const lv = LEVELS[levelKey] ? levelKey : (LEVELS[D.level] ? D.level : "hs"), L = LEVELS[lv];
  const M = D.metrics, T = D.frames, FPS = D.fps, P = D.pose;
  const ph = Object.fromEntries(D.phases.map(p => [p.name, p.frame]));
  const LL = ph["Peak leg lift"], FS = ph["Foot strike"], AC = ph["Arm cocked"], R = ph["Release"];
  const at = (k, f) => (M[k] && M[k][f] != null ? M[k][f] : null);
  const range = (k, a, b) => { const v = []; for (let t = Math.max(0, a); t <= Math.min(T - 1, b); t++) if (M[k] && M[k][t] != null) v.push(M[k][t]); return v };
  const LH = D.throwHand === "L";
  const lead = LH ? 28 : 27, back = LH ? 27 : 28, wrist = LH ? 15 : 16;

  // body size from the skeleton's own bones (hip joint to ankle is about 49% of standing height: Drillis & Contini)
  const bl = (a, b) => { const k = D.bones[a + "," + b] ?? D.bones[b + "," + a]; return k ?? null };
  const leg = (bl(23, 25) ?? 0.42) + (bl(25, 27) ?? 0.42);
  const skelH = leg / 0.49;
  const realH = D.heightIn > 0 ? D.heightIn * 0.0254 : null;            // metres, when the pitcher's height is entered
  const toIn = m => realH ? m * (realH / skelH) / 0.0254 : null;           // skeleton length -> real inches

  const side = Math.abs((D.cameraDir || [0, 0, 1])[2]) >= 0.9;          // camera within ~25° of side-on
  const sideConf = side ? "solid" : "est";
  const items = [];
  const add = (o) => { o.level = o.raw == null || CAP[o.conf] === 0 ? null : Math.min(o.raw, CAP[o.conf]); items.push(o) };
  const sdTxt = ([m, s]) => `${r0(m - s)}–${r0(m + s)}`;
  const pctTxt = p => `${p[1]}–${p[3]}`;

  // 1. Stride length (% of height)
  {
    const Fr = P[FS], s = Fr ? Math.hypot(Fr[lead][0] - Fr[back][0], Fr[lead][2] - Fr[back][2]) : null, pct = s != null ? 100 * s / skelH : null;
    const n = F.stride[lv]; let raw = gradeSD(pct, n, "low"); if (pct != null && pct > n[0] + 2 * n[1]) raw = 1;
    const inch = s != null ? toIn(s) : null;
    add({ id: "stride", area: "Lower half", name: "Stride length", value: fmt(pct, "% of height") + (inch ? ` (${ftin(inch)})` : ""), target: `${L}: ${sdTxt(n)}% of height (average ${n[0]}%)`, src: "fleisig", frame: FS, conf: sideConf, raw,
      why: "A long, direct stride moves the body toward the plate and gives the hips time to turn before the arm comes through.",
      fix: pct != null && pct < n[0] ? "Stride is short for this level. Drive off the rubber longer before the front foot lands." : "Stride is very long. Over-striding makes it hard to get over the front leg.",
      drill: `Stride-length line drill: mark ${n[0]}% of height${realH ? ` (${ftin(D.heightIn * n[0] / 100)})` : ""} from the rubber and land on it for 10 throws; add step-behind (crow-hop) throws to feel the push.` });
  }
  // 2. Lead knee at foot strike
  {
    const k = at("leadKnee", FS), n = F.kneeFC[lv];
    add({ id: "kneeFC", area: "Lower half", name: "Front knee bend at landing", value: fmt(k), target: `${L}: ${sdTxt(n)}° (average ${n[0]}°)`, src: "fleisig", frame: FS, conf: "est", raw: gradeSD(k, n),
      why: "Landing on a front knee that is bent but braced lets the leg absorb the stride and then push back against it.",
      fix: k != null && k < n[0] ? "The front leg lands quite straight. Land softer, with the knee slightly more bent, so it can brace and push back." : "The front knee is very bent at landing. Land on a firmer front leg so it can brace.",
      drill: "Stride-and-stick drill: stride, land and hold the landing for 2 s with the front knee bent and stable over the ankle." });
  }
  // 3. Lead leg firming up from landing to release
  {
    const kFS = at("leadKnee", FS), kR = at("leadKnee", R), ch = kR != null && kFS != null ? kR - kFS : null, n = F.kneeBR[lv];
    add({ id: "block", area: "Lower half", name: "Front leg firming up", value: ch == null ? "—" : `${fmt(kFS)} at landing → ${fmt(kR)} at release`, target: `Knee straightens after landing (${L} average ${F.kneeFC[lv][0]}° → ${n[0]}°)`, src: "fleisig", frame: R, conf: "est",
      raw: ch == null ? null : ch <= 5 ? 0 : ch <= 20 ? 1 : 2,
      why: "A front leg that firms up after landing stops the body's forward drift and turns it into rotation. A knee that keeps bending leaks that energy. More than 20° of extra bend is what Uplift flags as a knee collapse.",
      fix: "The front knee keeps bending after landing. Land on a braced knee and push back into the ground through release.",
      drill: "Lead-leg block holds: stride, land and freeze at release for 3 s; then med-ball rotational throws stepping into a firm front leg." });
  }
  // 4. Hip-shoulder separation
  {
    const sep = Math.max(...range("separation", LL, AC), -999), p = U.xfac[lv], v = sep > -999 ? sep : null;
    add({ id: "sep", area: "Rotation", name: "Hip–shoulder separation", value: fmt(v), target: `${L}: ${pctTxt(p)}° (middle half; median ${p[2]}°)`, src: "uplift", frame: FS, conf: "est", raw: gradePct(v, p, "low"),
      why: "Hips turning ahead of the shoulders stretches the trunk like a spring. Research links it to velocity, though the link is modest and varies from pitcher to pitcher.",
      fix: "The hips and shoulders turn together. Lead with the hips and keep the front shoulder closed a moment longer.",
      drill: "Hip-lead drills: rocker throws and step-behind throws with the glove arm held closed; med-ball scoop tosses leading with the hip." });
  }
  // 5. Forward trunk tilt at release
  {
    const f = at("trunkFwd", R), n = F.fwdBR[lv];
    add({ id: "fwd", area: "Trunk", name: "Forward lean at release", value: fmt(f), target: `${L}: ${sdTxt(n)}° (average ${n[0]}°)`, src: "fleisig", frame: R, conf: sideConf, raw: gradeSD(f, n),
      why: "Getting the chest out over the front leg moves release closer to the plate (extension) and uses the trunk's flexion to add speed.",
      fix: f != null && f < n[0] ? "Release is early or upright for this level. Finish with the chest over the front knee." : "Leaning far over at release can pull the head and arm off line.",
      drill: "Towel drill to a partner's glove at full extension; chest-to-knee finishes, holding the end position for 2 s." });
  }
  // 6. Side tilt at release
  {
    const l = at("trunkLat", R), p = U.lat[lv];
    add({ id: "lat", area: "Trunk", name: "Side tilt at release", value: fmt(l), target: `${L}: ${pctTxt(p)}° (middle half; median ${p[2]}°)`, src: "uplift", frame: R, conf: "est", raw: gradePct(l, p),
      why: "Leaning toward the glove side raises the arm slot. A lot of side tilt adds stress on the arm and can hurt command; very little usually means a lower slot.",
      fix: l != null && l > p[3] ? "More side tilt than most pitchers at this level. Make sure it's the arm slot you want and that it repeats." : "Less side tilt than most at this level, which usually means a lower arm slot. Fine if that's the slot you want.",
      drill: "Film several pitches and compare this number: repeating the same tilt matters more than the exact value." });
  }
  // 7. Elbow height (shoulder abduction) at release
  {
    const a = at("throwAbd", R);
    add({ id: "abd", area: "Throwing arm", name: "Elbow height at release", value: fmt(a), target: "About 90° (elbow level with the shoulders), all levels", src: "ffa", frame: R, conf: "est", raw: gradeSD(a, [90, 10]),
      why: "Around 90° the shoulder is in its strongest, safest position. A dropped or very high elbow adds stress on the elbow and shoulder.",
      fix: a != null && a < 90 ? "The elbow sits low at release. Get the elbow up to shoulder height as the trunk turns." : "The elbow is high at release. Check this matches the arm slot you want.",
      drill: "Wall drills for arm path; reverse throws and connection-ball throws to keep the elbow at shoulder height." });
  }
  // 8. Arm ready at foot strike (elbow bend)
  {
    const e = at("throwElbow", FS), n = F.elbowFC[lv];
    add({ id: "timing", area: "Throwing arm", name: "Arm ready at landing", value: fmt(e) + " elbow bend", target: `${L}: ${sdTxt(n)}° (average ${n[0]}°)`, src: "fleisig", frame: FS, conf: "est", raw: gradeSD(e, n),
      why: "At landing the arm should be up and bent so it's ready to turn with the trunk. A straight (long) or late arm has to rush to catch up.",
      fix: e != null && e < n[0] ? "The arm is long (straighter) at landing and may be running late. Break the hands earlier." : "The arm is very bent at landing. Check it isn't early.",
      drill: "Arm-path drills: 'up and show' throws (arm up at landing), plyo-ball pivot picks." });
  }
  // ---- shown with the research value but not graded (one side camera can't measure these well enough)
  {
    const er = Math.max(...range("throwER", FS, R).filter(v => v != null), -999), n = F.mer[lv];
    add({ id: "er", area: "Throwing arm", name: "Layback", value: er >= 90 && er <= 220 ? fmt(er) : "couldn't measure", target: `${L}: ${sdTxt(n)}° (average ${n[0]}°)`, src: "fleisig", frame: AC, conf: "rough", raw: null,
      why: "How far the forearm lays back before it whips forward. A single camera can't see it, so treat this as a rough guide.", fix: "", drill: "" });
  }
  {
    const sp = k => { const a = M[k], v = a.map((_, i) => (a[Math.min(T - 1, i + 1)] - a[Math.max(0, i - 1)]) * FPS / (Math.min(T - 1, i + 1) - Math.max(0, i - 1))); return v };
    const ps = sp("pelvisRot"), ts = sp("trunkRot");
    let pm = FS, tm = FS; for (let t = LL; t <= Math.min(T - 1, R + 3); t++) { if (ps[t] > ps[pm]) pm = t; if (ts[t] > ts[tm]) tm = t }
    add({ id: "speed", area: "Rotation", name: "Hip and trunk turning speed", value: `hips ${Math.round(ps[pm])}°/s, trunk ${Math.round(ts[tm])}°/s`, target: `${L} average: hips ${F.pelvisV[lv][0]}°/s, trunk ${F.trunkV[lv][0]}°/s`, src: "fleisig", frame: pm, conf: "rough", raw: null,
      why: "How fast the hips and then the trunk turn. Video, especially below 240 fps, reads these low, so compare your own sessions rather than the research average.", fix: "",
      drill: "For a true reading, film at 240 fps; compare the same pitcher week to week." });
  }
  {
    const h = at("leadHip", LL);
    add({ id: "lift", area: "Lower half", name: "Leg lift height", value: fmt(h), target: "No research standard: style varies", src: null, frame: LL, conf: "rough", raw: null,
      why: "The leg lift loads the back hip and sets up the stride. Its height is a style choice; there is no published range to grade it against.", fix: "", drill: "" });
  }
  {
    const tr = at("trunkRot", FS);
    add({ id: "closed", area: "Rotation", name: "Shoulders at landing", value: tr == null ? "—" : tr <= 0 ? `closed (turned back ${Math.round(-tr)}°)` : `open ${Math.round(tr)}°`, target: "Coaching guide: still mostly facing the side", src: null, frame: FS, conf: "rough", raw: null,
      why: "If the shoulders are already turning toward the plate at landing, the trunk has less left to stretch. Shown for reference: measured from one side camera.", fix: "", drill: "" });
  }
  if (realH) {
    const fx = Math.sign((P[FS] ? P[FS][lead][0] : 1) - (P[0] ? P[0][back][0] : 0)) || 1;
    const rub = (D.rubber || [0, 0])[0], hx = P[R] ? P[R][wrist][0] : null;
    const ext = hx != null ? toIn(Math.max(0, (hx - rub) * fx)) : null;
    if (ext) add({ id: "ext", area: "Release", name: "Release extension", value: `${ftin(ext)} in front of the rubber`, target: "No level norm; MLB pitchers are often around 6–7 ft", src: null, frame: R, conf: "rough", raw: null,
      why: "How far toward the plate the ball is let go. More extension makes the pitch reach the hitter sooner. Measured from the hand, so it reads slightly short of where the ball leaves.", fix: "", drill: "" });
  }

  const graded = items.filter(i => i.level != null);
  const work = graded.filter(i => i.level === 2), check = graded.filter(i => i.level === 1), good = graded.filter(i => i.level === 0), info = items.filter(i => i.level == null);
  const score = graded.length ? Math.round(100 * graded.reduce((a, i) => a + (2 - i.level), 0) / (2 * graded.length)) : null;
  const used = [...new Set(items.map(i => i.src).filter(Boolean))].map(k => SRC[k]);
  return { items, work, check, good, info, score, height: skelH, level: lv, levelName: L, heightIn: D.heightIn || null, sources: used };
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
export function reportHTML(rep) {
  const card = (i) => `<article class="rcard lv${i.level ?? "n"}">
    <div class="rhead"><span class="rtag">${i.level == null ? "Info" : LEVEL[i.level]}</span><h4>${esc(i.name)}</h4><button class="rshow" data-f="${i.frame}" type="button">Show</button></div>
    <div class="rnums"><span><b>${esc(i.value)}</b></span><span>${esc(i.target)}</span><span class="rconf">${CONF[i.conf]}</span></div>
    <p>${esc(i.level ? i.fix : i.why)}</p>
    ${i.level ? `<p class="rwhy">${esc(i.why)}</p>` : ""}
    ${i.level && i.drill ? `<p class="rdrill"><b>Drill:</b> ${esc(i.drill)}</p>` : (i.level == null && i.drill ? `<p class="rwhy">${esc(i.drill)}</p>` : "")}
    ${i.src ? `<p class="rsrc">Source: ${esc(SRC[i.src])}</p>` : ""}
  </article>`;
  const sec = (title, list, note) => list.length ? `<h3 class="rsec">${title}</h3>${note ? `<p class="rnote">${note}</p>` : ""}<div class="rgrid">${list.map(card).join("")}</div>` : "";
  const top = rep.work.length ? rep.work : rep.check;
  const summary = top.length
    ? `Top priorities: ${top.slice(0, 3).map(i => `<b>${esc(i.name.toLowerCase())}</b>`).join(", ")}.`
    : `Nothing stands out. Every graded check is in the typical ${esc(rep.levelName.toLowerCase())} range.`;
  const opts = Object.entries(LEVELS).map(([k, v]) => `<option value="${k}"${k === rep.level ? " selected" : ""}>${v}</option>`).join("");
  return `<div class="rsum">
      <div class="rscore"><span>${rep.score ?? "—"}</span><small>/ 100</small></div>
      <div><p class="rlead">${summary}</p>
      <div class="rctl"><label>Compared with <select id="repLevel">${opts}</select></label>${rep.heightIn ? `<span>Height ${ftin(rep.heightIn)}</span>` : `<span>Height not entered (add it on the home page for real distances)</span>`}</div>
      <p class="rnote">${rep.work.length} to work on · ${rep.check.length} to check · ${rep.good.length} good. Graded against published research for ${esc(rep.levelName.toLowerCase())} pitchers. <b>Solid</b> checks are measured directly from a side-on video; <b>estimated</b> ones need depth one camera can't see well, so they're never graded worse than "Check".</p></div>
    </div>
    ${sec("Work on", rep.work)}
    ${sec("Check", rep.check, "Outside the middle of the range for this level, or measured less reliably. Press Show to jump to the moment.")}
    ${sec("Good", rep.good)}
    ${sec("For reference (not graded)", rep.info)}
    <p class="rnote rsources"><b>Sources:</b> ${rep.sources.map(esc).join(" · ")}.</p>`;
}
