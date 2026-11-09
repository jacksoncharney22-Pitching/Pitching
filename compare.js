import { deliveryCards } from "./pipeline.js";
// Two saved pitches side by side: the same pitcher on different days, or two pitchers. Numbers only (no video), rebuilt
// from the saved tracking with the current skeleton maths, so both pitches are measured the same way.
const PHASES = ["Peak leg lift", "Foot strike", "Arm cocked", "Release"];
const ROWS = [
  ["Throwing arm", [["Elbow flexion", "throwElbow"], ["Shoulder abduction", "throwAbd"], ["Layback", "throwER"]]],
  ["Lower half", [["Lead knee flexion", "leadKnee"], ["Lead hip flexion", "leadHip"], ["Back knee flexion", "backKnee"]]],
  ["Pelvis and trunk", [["Pelvis rotation", "pelvisRot"], ["Trunk rotation", "trunkRot"], ["Hip-shoulder separation", "separation"], ["Trunk forward tilt", "trunkFwd"], ["Trunk side tilt", "trunkLat"]]],
];
// How big a difference has to be, reading by reading, before it is the pitcher and not the camera: 4 in 5 pairs of lab
// pitches (same camera angle, against motion capture) read within this. `null` = the benchmark says a big difference
// here is usually not real (elbow at release barely differs between pitchers), so it is never bolded.
// Measured by tools/test/comparecheck.mjs --json; re-measure after changes to the skeleton.
const SIG = {"throwElbow|ll":18,"throwElbow|fs":15,"throwElbow|mer":18,"throwElbow|br":null,"throwAbd|ll":13,"throwAbd|fs":8,"throwAbd|mer":9,"throwAbd|br":11,"throwER|fs":10,"throwER|mer":15,"throwER|br":51,"leadKnee|ll":8,"leadKnee|fs":14,"leadKnee|mer":12,"leadKnee|br":15,"leadHip|ll":8,"leadHip|fs":10,"leadHip|mer":12,"leadHip|br":9,"backKnee|ll":9,"backKnee|fs":12,"backKnee|mer":11,"backKnee|br":8,"pelvisRot|ll":14,"pelvisRot|fs":15,"pelvisRot|mer":12,"pelvisRot|br":14,"trunkRot|ll":15,"trunkRot|fs":17,"trunkRot|mer":15,"trunkRot|br":20,"separation|ll":10,"separation|fs":14,"separation|mer":10,"separation|br":14,"trunkFwd|ll":null,"trunkFwd|fs":7,"trunkFwd|mer":9,"trunkFwd|br":9,"trunkLat|ll":9,"trunkLat|fs":7,"trunkLat|mer":9,"trunkLat|br":10};
const EV = { "Peak leg lift": "ll", "Foot strike": "fs", "Arm cocked": "mer", "Release": "br" };
const isReal = (d, k, ph) => { const th = SIG[k + "|" + EV[ph]]; return d != null && th != null && Math.abs(d) >= th };
const frameOf = (d, name) => (d.phases.find(p => p.name === name) || {}).frame;
const round = v => v == null ? null : +(Math.round(v * 10) / 10).toFixed(0).replace(/^-0$/, "0");
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const gap = (d, a, b) => { const x = frameOf(d, a), y = frameOf(d, b); return x == null || y == null ? null : (y - x) / d.fps };
const fmtD = (v, u) => v == null ? "–" : (v > 0 ? "+" : "") + v + u;

function timingRows(a, b) {
  const row = (lbl, x, y) => {
    const f = v => v == null ? "–" : v.toFixed(2) + " s", d = x == null || y == null ? null : Math.round((x - y) * 100) / 100;
    return `<tr><th scope="row">${lbl}</th><td>${f(x)}</td><td>${f(y)}</td><td>${d == null ? "–" : (d > 0 ? "+" : "") + d.toFixed(2) + " s"}</td></tr>`;
  };
  return row("Leg lift to foot strike", gap(a, "Peak leg lift", "Foot strike"), gap(b, "Peak leg lift", "Foot strike"))
    + row("Foot strike to release", gap(a, "Foot strike", "Release"), gap(b, "Foot strike", "Release"));
}

export function renderCompare(el, A, B) {
  const a = A.data, b = B.data, nameA = esc(A.label), nameB = esc(B.label);
  let html = `<div class="cmp-key"><span><i class="cmp-a">A</i> ${nameA}</span><span><i class="cmp-b">B</i> ${nameB}</span></div>`;
  html += `<div class="card cmp-card"><h3>Timing</h3><table class="cmp"><thead><tr><th></th><th class="cmp-a">A</th><th class="cmp-b">B</th><th>A vs B</th></tr></thead><tbody>${timingRows(a, b)}</tbody></table></div>`;
  { const da = deliveryCards(a), db = deliveryCards(b), keys = [...new Set([...da, ...db].map(c => c.k))].filter(k => k !== "tempo");   // tempo is in the Timing card above
    if (keys.length) {
      let rows = "";
      for (const k of keys) { const x = da.find(c => c.k === k), y = db.find(c => c.k === k), d = x && y ? Math.round((x.n - y.n)) : null;
        rows += `<tr><th scope="row">${(x || y).k === "stride" ? "Stride (% of height)" : (x || y).label}</th><td>${x ? x.short || x.value : "–"}</td><td>${y ? y.short || y.value : "–"}</td><td>${d == null ? "–" : (d > 0 ? "+" : "") + d + (x || y).unit}</td></tr>` }
      html += `<div class="card cmp-card"><h3>Delivery numbers</h3><table class="cmp"><thead><tr><th></th><th class="cmp-a">A</th><th class="cmp-b">B</th><th>A vs B</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    } }
  for (const ph of PHASES) {
    const fa = frameOf(a, ph), fb = frameOf(b, ph);
    let rows = "";
    for (const [group, list] of ROWS) {
      rows += `<tr class="cmp-g"><th colspan="4">${group}</th></tr>`;
      for (const [lbl, k] of list) {
        const x = fa == null || !a.metrics[k] ? null : round(a.metrics[k][fa]), y = fb == null || !b.metrics[k] ? null : round(b.metrics[k][fb]);
        const d = x == null || y == null ? null : x - y;
        rows += `<tr${isReal(d, k, ph) ? ' class="cmp-big"' : ""}><th scope="row">${lbl}</th><td>${x == null ? "–" : x + "°"}</td><td>${y == null ? "–" : y + "°"}</td><td>${fmtD(d, "°")}</td></tr>`;
      }
    }
    html += `<div class="card cmp-card"><h3>${ph}</h3><table class="cmp"><thead><tr><th></th><th class="cmp-a">A</th><th class="cmp-b">B</th><th>A vs B</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  html += `<p class="hint">Bold rows differ by more than one camera can misread: 8&ndash;20° depending on the reading (layback at release needs about 50°), measured against motion capture on lab pitches. Rows that are not bold may be the camera rather than the pitcher, and elbow at release is never bold because pitchers barely differ there. Film both pitches from the same spot for the fairest comparison.</p>`;
  el.innerHTML = html;
}
