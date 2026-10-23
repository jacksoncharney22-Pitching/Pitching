// Feole Pitching: the report. Turns the angles into "what to work on", graded against typical ranges from
// professional pitchers, with a drill for each item.
//
// Honesty rules:
//  - Every check carries how well one camera can measure it. Things that sit in the camera's view from the side
//    (forward lean, knee bend, stride) are "solid"; things that need depth (hip and shoulder turn, elbow height,
//    rotation speed) are "estimated"; layback and the order of rotation speeds are "rough".
//  - Only solid checks can be graded "Work on". Estimated ones top out at "Check", rough ones are shown, not graded.
//  - Ranges are wide on purpose: they describe what most good pro deliveries look like, not one ideal.

const CONF = { solid: "Solid", est: "Estimated", rough: "Rough" };
const CAP = { solid: 2, est: 1, rough: 0 };            // 2 = can be "Work on", 1 = up to "Check", 0 = not graded
const LEVEL = ["Good", "Check", "Work on"];

function fmt(v, u = "°") { return v == null || !Number.isFinite(v) ? "—" : Math.round(v) + u }

export function buildReport(D) {
  const M = D.metrics, T = D.frames, FPS = D.fps, P = D.pose;
  const ph = Object.fromEntries(D.phases.map(p => [p.name, p.frame]));
  const LL = ph["Peak leg lift"], FS = ph["Foot strike"], AC = ph["Arm cocked"], R = ph["Release"];
  const at = (k, f) => (M[k] && M[k][f] != null ? M[k][f] : null);
  const range = (k, a, b) => { const v = []; for (let t = Math.max(0, a); t <= Math.min(T - 1, b); t++) if (M[k][t] != null) v.push(M[k][t]); return v };
  const LH = D.throwHand === "L";
  const lead = LH ? 28 : 27, back = LH ? 27 : 28;

  // body size from the skeleton's own bones (hip-to-ankle is about 49% of standing height)
  const bl = (a, b) => { const k = D.bones[a + "," + b] ?? D.bones[b + "," + a]; return k ?? null };
  const leg = (bl(23, 25) ?? 0.42) + (bl(25, 27) ?? 0.42);
  const height = leg / 0.49;

  const side = Math.abs((D.cameraDir || [0, 0, 1])[2]) >= 0.9;          // camera within ~25° of side-on
  const sideConf = side ? "solid" : "est";
  const items = [];
  // grade: value -> 0/1/2 using [goodLo, goodHi] and [checkLo, checkHi]
  const grade = (v, good, check) => v == null ? null : (v >= good[0] && v <= good[1]) ? 0 : (v >= check[0] && v <= check[1]) ? 1 : 2;
  const add = (o) => { const raw = o.raw; o.level = raw == null ? null : Math.min(raw, CAP[o.conf]); if (CAP[o.conf] === 0) o.level = null; items.push(o) };

  // 1. Stride length
  {
    const F = P[FS], s = F ? Math.hypot(F[lead][0] - F[back][0], F[lead][2] - F[back][2]) : null, pct = s != null ? 100 * s / height : null;
    add({ id: "stride", area: "Lower half", name: "Stride length", value: fmt(pct, "% of height"), target: "75–95% of height", frame: FS, conf: sideConf,
      raw: grade(pct, [75, 100], [65, 105]),
      why: "A long, direct stride moves the body toward the plate and gives the hips time to turn before the arm comes through.",
      fix: pct != null && pct < 75 ? "Stride is short. Drive off the rubber longer before the front foot lands." : "Over-striding makes it hard to get over the front leg.",
      drill: "Stride-length line drill: mark 80–85% of height on the mound and land on it for 10 throws; add a step-behind (crow-hop) throw to feel the push." });
  }
  // 2. Lead leg block
  {
    const kFS = at("leadKnee", FS), kR = at("leadKnee", R), peak = Math.max(...range("leadKnee", FS, R)), ch = kR != null && kFS != null ? kR - kFS : null;
    add({ id: "block", area: "Lower half", name: "Lead leg firming up", value: ch == null ? "—" : `${fmt(kFS)} at landing → ${fmt(kR)} at release`, target: "Knee stays the same or straightens after landing", frame: R, conf: "est",
      raw: ch == null ? null : ch <= 8 ? 0 : ch <= 20 ? 1 : 2, peak,
      why: "A front leg that firms up after landing stops the body's forward drift and turns it into rotation. A knee that keeps bending leaks that energy.",
      fix: "The front knee keeps bending after landing. Land on a braced (slightly bent) knee and push back into the ground through release.",
      drill: "Lead-leg block holds: stride, land and freeze at release for 3 s; then med-ball rotational throws stepping into a firm front leg." });
  }
  // 3. Hip-shoulder separation
  {
    const sep = Math.max(...range("separation", FS - Math.round(0.05 * FPS), AC));
    add({ id: "sep", area: "Rotation", name: "Hip–shoulder separation", value: fmt(sep), target: "30°+ around foot strike", frame: FS, conf: "est",
      raw: grade(sep, [30, 80], [15, 90]),
      why: "Hips turning ahead of the shoulders stretches the trunk like a spring. More separation is strongly linked to velocity.",
      fix: "The hips and shoulders turn together. Lead with the hips and keep the front shoulder closed a moment longer.",
      drill: "Hip-lead drills: rocker throws and 'step-behind' throws with the glove arm held closed; med-ball scoop tosses leading with the hip." });
  }
  // 4. Shoulders closed at foot strike
  {
    const tr = at("trunkRot", FS);
    add({ id: "closed", area: "Rotation", name: "Shoulders closed at landing", value: tr == null ? "—" : tr <= 0 ? `closed (turned back ${Math.round(-tr)}°)` : `open ${Math.round(tr)}°`, target: "Open 20° or less (still facing the side)", frame: FS, conf: "est",
      raw: grade(tr, [-60, 20], [-80, 40]),
      why: "If the shoulders are already turning toward the plate when the foot lands, the trunk has nothing left to stretch, and the arm has to make up for it.",
      fix: "The front side is opening early. Keep the glove side pointing at the target until the front foot is down.",
      drill: "Closed-landing drill: throw with the glove arm pointed at the target and the chest facing the side until landing; mirror work to feel it." });
  }
  // 5. Forward trunk tilt at release
  {
    const f = at("trunkFwd", R);
    add({ id: "fwd", area: "Trunk", name: "Forward lean at release", value: fmt(f), target: "30–50°", frame: R, conf: sideConf,
      raw: grade(f, [30, 55], [20, 62]),
      why: "Getting the chest out over the front leg moves release closer to the plate (extension) and uses the trunk's flexion to add speed.",
      fix: f != null && f < 30 ? "Release is early or upright. Finish with the chest over the front knee." : "Leaning far over can pull the head and arm off line.",
      drill: "Towel drill to a partner's glove at extension; 'chest-to-knee' finishes holding the end position for 2 s." });
  }
  // 6. Elbow height (shoulder abduction) at release
  {
    const a = at("throwAbd", R), aFS = at("throwAbd", FS);
    add({ id: "abd", area: "Throwing arm", name: "Elbow height at release", value: fmt(a), target: "80–110° (elbow about shoulder height)", frame: R, conf: "est",
      raw: grade(a, [80, 112], [65, 125]), extra: aFS,
      why: "Around 90–100° the shoulder is in its strongest, safest position. A dropped elbow puts more stress on the elbow and shoulder.",
      fix: a != null && a < 80 ? "The elbow sits low at release. Get the elbow up to shoulder height as the trunk turns." : "The elbow is very high. Check this matches the arm slot you want.",
      drill: "Wall drills for arm path; reverse throws and connection-ball throws to keep the elbow at shoulder height." });
  }
  // 7. Arm on time at foot strike
  {
    const e = at("throwElbow", FS);
    add({ id: "timing", area: "Throwing arm", name: "Arm ready at landing", value: fmt(e) + " elbow bend", target: "60–120° bend, arm up", frame: FS, conf: "est",
      raw: grade(e, [60, 125], [40, 140]),
      why: "At landing the arm should be up and bent about 90° so it's ready to turn with the trunk. A straight or late arm has to rush to catch up.",
      fix: e != null && e < 60 ? "The arm is long (straight) at landing and may be running late. Break the hands earlier." : "The arm is very bent at landing. Check the arm isn't early.",
      drill: "Arm-path drills: 'up and show' throws (arm up at landing), plyo-ball pivot picks." });
  }
  // 8. Lead leg lift
  {
    const h = at("leadHip", LL);
    add({ id: "lift", area: "Lower half", name: "Leg lift height", value: fmt(h), target: "80°+ (thigh about level)", frame: LL, conf: "solid",
      raw: grade(h, [75, 150], [60, 160]),
      why: "The leg lift loads the back hip and sets up the stride. A low lift is fine if he still drives well.",
      fix: "The leg lift is low. If the stride is also short, a fuller lift can help load the back hip.",
      drill: "Balance-point holds at the top of the leg lift for 2 s before driving." });
  }
  // 9. Side bend (arm slot)
  {
    const l = at("trunkLat", R);
    add({ id: "lat", area: "Trunk", name: "Side bend at release", value: fmt(l), target: "Matches arm slot (most overhand throwers 15–35°)", frame: R, conf: "est",
      raw: l == null ? null : (l > 45 ? 1 : 0),
      why: "Leaning toward the glove side raises the arm slot. Very large side bend adds stress and can hurt command.",
      fix: "A lot of side bend. Make sure it's the slot he wants and that it repeats from pitch to pitch.",
      drill: "Film several pitches and compare this number; consistency matters more than the exact value." });
  }
  // 10. Sequence (shown, not graded: needs depth one side camera can't measure well)
  {
    const sp = k => { const a = M[k], v = a.map((_, i) => (a[Math.min(T - 1, i + 1)] - a[Math.max(0, i - 1)]) * FPS / (Math.min(T - 1, i + 1) - Math.max(0, i - 1))); return v };
    const ps = sp("pelvisRot"), ts = sp("trunkRot");
    let pm = FS, tm = FS; for (let t = LL; t <= Math.min(T - 1, R + 3); t++) { if (ps[t] > ps[pm]) pm = t; if (ts[t] > ts[tm]) tm = t }
    const gap = Math.round((tm - pm) / FPS * 1000);
    add({ id: "seq", area: "Rotation", name: "Hips before shoulders (sequence)", value: `${gap >= 0 ? "hips first by " + gap : "shoulders first by " + -gap} ms`, target: "Hips peak 30–50 ms before shoulders", frame: pm, conf: "rough",
      raw: null,
      why: "Energy should flow up the body: hips, then trunk, then arm. One side camera can't measure turning speed well, so this is shown but not graded.",
      fix: "", drill: "To check this properly, film from behind as well, or use a 240 fps clip." });
  }
  // 11. Layback (shown, not graded)
  {
    const er = Math.max(...range("throwER", FS, R).filter(v => v != null), -999);
    add({ id: "er", area: "Throwing arm", name: "Layback", value: er >= 90 && er <= 220 ? fmt(er) : "couldn't measure", target: "Pros often 160–185°", frame: AC, conf: "rough", raw: null,
      why: "How far the forearm lays back before it whips forward. A single camera can't see it, so treat this as a rough guide.", fix: "", drill: "" });
  }

  const graded = items.filter(i => i.level != null);
  const work = graded.filter(i => i.level === 2), check = graded.filter(i => i.level === 1), good = graded.filter(i => i.level === 0), info = items.filter(i => i.level == null);
  const score = graded.length ? Math.round(100 * graded.reduce((a, i) => a + (2 - i.level), 0) / (2 * graded.length)) : null;
  return { items, work, check, good, info, score, height };
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
export function reportHTML(rep) {
  const card = (i) => `<article class="rcard lv${i.level ?? "n"}">
    <div class="rhead"><span class="rtag">${i.level == null ? "Info" : LEVEL[i.level]}</span><h4>${esc(i.name)}</h4><button class="rshow" data-f="${i.frame}" type="button">Show</button></div>
    <div class="rnums"><span><b>${esc(i.value)}</b></span><span>Target: ${esc(i.target)}</span><span class="rconf">${CONF[i.conf]}</span></div>
    <p>${esc(i.level ? i.fix : i.why)}</p>
    ${i.level ? `<p class="rwhy">${esc(i.why)}</p>` : ""}
    ${i.level && i.drill ? `<p class="rdrill"><b>Drill:</b> ${esc(i.drill)}</p>` : (i.level == null && i.drill ? `<p class="rwhy">${esc(i.drill)}</p>` : "")}
  </article>`;
  const sec = (title, list, note) => list.length ? `<h3 class="rsec">${title}</h3>${note ? `<p class="rnote">${note}</p>` : ""}<div class="rgrid">${list.map(card).join("")}</div>` : "";
  const top = rep.work.length ? rep.work : rep.check;
  const summary = top.length
    ? `Top priorities: ${top.slice(0, 3).map(i => `<b>${esc(i.name.toLowerCase())}</b>`).join(", ")}.`
    : "Nothing stands out. Every graded check is in the typical pro range.";
  return `<div class="rsum">
      <div class="rscore"><span>${rep.score ?? "—"}</span><small>/ 100</small></div>
      <div><p class="rlead">${summary}</p>
      <p class="rnote">${rep.work.length} to work on · ${rep.check.length} to check · ${rep.good.length} good. Ranges are typical of professional pitchers. <b>Solid</b> checks are measured directly from the video; <b>estimated</b> ones rely on depth one camera can't see well, so they're never graded worse than "Check".</p></div>
    </div>
    ${sec("Work on", rep.work)}
    ${sec("Check", rep.check, "Worth a look on the video. Press Show to jump to the moment.")}
    ${sec("Good", rep.good)}
    ${sec("For reference (not graded)", rep.info)}`;
}
