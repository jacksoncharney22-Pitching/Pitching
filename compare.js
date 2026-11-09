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

// ---- one reading across all saved pitches, oldest to newest. Rebuilt from saved tracking like Compare; un-tick a pitch
// to leave it out (file names aren't reliable pitcher names, so the coach picks which pitches belong together).
const DELIVERY = [["Stride (% of height)", "stride"], ["Arm slot", "slot"], ["Peak hip-shoulder separation", "sep"], ["Leg lift to foot strike (s)", "tempo"]];
export function renderTrend(el, pts) {
  const st = { k: "separation", ph: "Foot strike", off: new Set() };
  const isDel = k => DELIVERY.some(d => d[1] === k);
  const val = (d, k, ph) => { if (isDel(k)) { const c = deliveryCards(d).find(c => c.k === k); return c ? (k === "tempo" ? c.n / 1000 : c.n) : null } const f = frameOf(d, ph), v = f == null || !d.metrics[k] ? null : d.metrics[k][f]; return Number.isFinite(v) ? Math.round(v) : null };
  const opts = ROWS.map(([g, l]) => `<optgroup label="${g}">${l.map(([n, k]) => `<option value="${k}">${n}</option>`).join("")}</optgroup>`).join("") + `<optgroup label="Delivery">${DELIVERY.map(([n, k]) => `<option value="${k}">${n}</option>`).join("")}</optgroup>`;
  el.innerHTML = `<div class="card cmp-card trend-card"><div class="cmp-pick trend-ctl"><label>Reading <select id="trK">${opts}</select></label><label id="trPhL">At <select id="trPh">${PHASES.map(p => `<option>${p}</option>`).join("")}</select></label></div><div id="trChart"></div><p class="hint" id="trNote"></p></div><div class="card cmp-card"><table class="cmp trend-t"><thead><tr><th>Use</th><th>Pitch</th><th>Value</th></tr></thead><tbody id="trRows"></tbody></table></div>`;
  const $ = id => el.querySelector("#" + id); $("trK").value = st.k; $("trPh").value = st.ph;
  const draw = () => {
    const unit = st.k === "stride" ? "%" : st.k === "tempo" ? " s" : "°", dec = st.k === "tempo" ? 2 : 0, vals = pts.map(p => st.off.has(p) ? null : val(p.data, st.k, st.ph)), use = pts.map((p, i) => ({ p, v: vals[i] })).filter(x => x.v != null);
    $("trPhL").hidden = isDel(st.k);
    const W = Math.max(300, $("trChart").clientWidth || 700), H = 260, L = 44, R = 14, T = 14, B = 34, n = Math.max(2, use.length), x = i => L + (W - L - R) * (use.length < 2 ? .5 : i / (n - 1));
    let svg = "";
    if (use.length) { const vs = use.map(u => u.v), span = Math.max(...vs) - Math.min(...vs), pad = Math.max(span * .15, st.k === "tempo" ? .03 : 3), lo = Math.min(...vs) - pad, hi = Math.max(...vs) + pad, y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
      for (let g = 0; g <= 3; g++) { const v = lo + (hi - lo) * g / 3; svg += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="tr-grid"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="tr-ax">${v.toFixed(dec)}</text>` }
      if (use.length > 1) svg += `<polyline fill="none" class="tr-line" points="${use.map((u, i) => x(i) + "," + y(u.v)).join(" ")}"/>`;
      const every = Math.max(1, Math.ceil(use.length / 7));
      use.forEach((u, i) => { svg += `<circle cx="${x(i)}" cy="${y(u.v)}" r="5" class="tr-dot"><title>${esc(u.p.label)}: ${u.v.toFixed(dec)}${unit}</title></circle>`; if (i % every === 0) svg += `<text x="${x(i)}" y="${H - 12}" text-anchor="${use.length > 1 && i === 0 ? "start" : use.length > 1 && i === use.length - 1 ? "end" : "middle"}" class="tr-ax">${esc(u.p.day)}</text>` });
    }
    $("trChart").innerHTML = use.length ? `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Reading across saved pitches" class="tr-svg">${svg}</svg>` : `<p class="hint">No value for this reading on the pitches ticked.</p>`;
    const th = SIG[st.k + "|" + EV[st.ph]];
    $("trNote").textContent = isDel(st.k) ? "Film from the same spot each time: a different camera angle moves these numbers too." : th == null ? "One camera can't show real differences on this reading, so treat this line as noise." : `A change smaller than about ${th}° may be the camera rather than the pitcher. Film from the same spot each time.`;
    $("trRows").innerHTML = pts.map((p, i) => { const v = val(p.data, st.k, st.ph); return `<tr><td><input type="checkbox" data-i="${i}" aria-label="Use this pitch"${st.off.has(p) ? "" : " checked"}></td><th scope="row">${esc(p.label)}</th><td>${v == null ? "–" : v.toFixed(dec) + unit}</td></tr>` }).join("");
    $("trRows").querySelectorAll("input").forEach(c => c.onchange = () => { const p = pts[+c.dataset.i]; c.checked ? st.off.delete(p) : st.off.add(p); draw() });
  };
  $("trK").onchange = e => { st.k = e.target.value; draw() }; $("trPh").onchange = e => { st.ph = e.target.value; draw() };
  draw();
}
