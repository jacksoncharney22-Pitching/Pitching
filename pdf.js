// Feole Pitching: downloadable PDF. The pitcher at the four key moments (video frame with the skeleton drawn on it,
// plus a clean side-view skeleton) and the key angles at each phase. Built in the browser with jsPDF (bundled in
// lib/), so nothing is uploaded anywhere.

const BASE = () => new URL(".", document.baseURI).href;
function loadScript(src) {
  return new Promise((res, rej) => { if (window.jspdf) return res(); const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("couldn't load the PDF maker")); document.head.append(s) });
}
// jsPDF's built-in fonts only cover Latin-1: swap the few other characters we use
const clean = s => String(s ?? "").replace(/→/g, "->").replace(/′/g, "'").replace(/″/g, '"').replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, "...").replace(/·/g, "|").replace(/≈/g, "~").replace(/[^\x00-\xff]/g, "");

// MediaPipe 33-point skeleton
const BONES = [[11, 12], [11, 23], [12, 24], [23, 24], [11, 13], [13, 15], [12, 14], [14, 16], [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32], [15, 19], [16, 20]];
const once = (el, ev) => new Promise(r => el.addEventListener(ev, r, { once: true }));

async function videoFrames(data, url, frames) {
  const v = document.createElement("video"); v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
  try { await Promise.race([once(v, "loadeddata"), new Promise((_, j) => setTimeout(() => j(new Error("video timeout")), 8000))]) } catch (e) { return frames.map(() => null) }
  const VFPS = data.videoFps || data.fps, T0 = data.start || 0, out = [];
  for (const f of frames) {
    v.currentTime = T0 + (Math.round(f) + 0.5) / VFPS;
    await Promise.race([once(v, "seeked"), new Promise(r => setTimeout(r, 3000))]);
    const W = v.videoWidth, H = v.videoHeight, I = data.img[f];
    // crop round the pitcher (from the tracked points), tall 3:4 box
    const xs = I.map(p => p[0] * W), ys = I.map(p => p[1] * H);
    let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2; let h = (y1 - y0) * 1.25, w = (x1 - x0) * 1.25;
    if (w / h > 0.8) h = w / 0.8; else w = h * 0.8;
    const sx = cx - w / 2, sy = cy - h / 2;
    const c = document.createElement("canvas"); c.width = 480; c.height = 600; const g = c.getContext("2d");
    g.fillStyle = "#000"; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(v, sx, sy, w, h, 0, 0, c.width, c.height);
    const P = j => [(I[j][0] * W - sx) / w * c.width, (I[j][1] * H - sy) / h * c.height];
    const throwArm = data.throwHand === "L" ? [11, 13, 15] : [12, 14, 16];
    g.lineCap = "round"; g.lineWidth = 5;
    for (const [a, b] of BONES) { g.strokeStyle = throwArm.includes(a) && throwArm.includes(b) ? "#ffb347" : "#ffffff"; g.beginPath(); g.moveTo(...P(a)); g.lineTo(...P(b)); g.stroke() }
    g.fillStyle = "#62d0ff"; for (const j of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) { const p = P(j); g.beginPath(); g.arc(p[0], p[1], 5, 0, 7); g.fill() }
    out.push(c.toDataURL("image/jpeg", 0.85));
  }
  v.removeAttribute("src"); v.load();
  return out;
}

// clean side view of the 3D skeleton, same scale for every phase, ground line, throwing arm in amber
function sideViews(data, frames) {
  const P = data.pose, all = frames.flatMap(f => P[f]);
  const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
  const x0 = Math.min(...xs) - 0.15, x1 = Math.max(...xs) + 0.15, yTop = Math.max(...ys) + 0.15;
  const W = 480, H = 600, s = Math.min(W / (x1 - x0), (H - 30) / (yTop + 0.05));
  const throwArm = data.throwHand === "L" ? [11, 13, 15] : [12, 14, 16];
  // face the same way as the pitcher in the video: compare the stride direction on screen and in 3D at foot strike
  const fsF = (data.phases.find(p => p.name === "Foot strike") || {}).frame ?? frames[0];
  const lead = data.throwHand === "L" ? 28 : 27, back = data.throwHand === "L" ? 27 : 28;
  const onScreen = Math.sign(data.img[fsF][lead][0] - data.img[fsF][back][0]), in3D = Math.sign(P[fsF][lead][0] - P[fsF][back][0]);
  const flip = onScreen !== 0 && in3D !== 0 && onScreen !== in3D;
  return frames.map(f => {
    const c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d");
    g.fillStyle = "#0b0b0b"; g.fillRect(0, 0, W, H);
    const gy = H - 20; g.strokeStyle = "#444"; g.lineWidth = 2; g.beginPath(); g.moveTo(0, gy); g.lineTo(W, gy); g.stroke();
    const Q = j => { const u = (P[f][j][0] - x0) * s + (W - (x1 - x0) * s) / 2; return [flip ? W - u : u, gy - P[f][j][1] * s] };
    // far side first (dimmer), so the near side reads on top
    const far = data.throwHand === "L" ? new Set([12, 14, 16, 24, 26, 28, 30, 32]) : new Set([11, 13, 15, 23, 25, 27, 29, 31]);
    const order = [...BONES].sort((a, b) => (far.has(b[0]) ? 1 : 0) - (far.has(a[0]) ? 1 : 0));
    g.lineCap = "round";
    for (const [a, b] of order) {
      const isThrow = throwArm.includes(a) && throwArm.includes(b);
      g.strokeStyle = isThrow ? "#ffb347" : far.has(a) || far.has(b) ? "#7a7a7a" : "#ffffff"; g.lineWidth = isThrow ? 7 : 6;
      g.beginPath(); g.moveTo(...Q(a)); g.lineTo(...Q(b)); g.stroke();
    }
    // head
    const nose = Q(0), sh = [(Q(11)[0] + Q(12)[0]) / 2, (Q(11)[1] + Q(12)[1]) / 2];
    g.strokeStyle = "#fff"; g.lineWidth = 5; g.beginPath(); g.moveTo(...sh); g.lineTo(nose[0], nose[1] + 10); g.stroke();
    g.beginPath(); g.arc(nose[0], nose[1] - 4, 0.11 * s, 0, 7); g.stroke();
    g.fillStyle = "#62d0ff"; for (const j of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) { const p = Q(j); g.beginPath(); g.arc(p[0], p[1], 5, 0, 7); g.fill() }
    return c.toDataURL("image/jpeg", 0.9);
  });
}

async function logoData() {
  try { const r = await fetch(BASE() + "logo.png"); if (!r.ok) return null; const b = await r.blob(); return await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b) }) } catch (e) { return null }
}

export async function downloadPDF(data, url, onStatus = () => {}) {
  onStatus("Preparing PDF…");
  await loadScript(BASE() + "lib/jspdf.umd.min.js");
  const { jsPDF } = window.jspdf;
  const PH = data.phases.filter(p => !["Start", "Finish"].includes(p.name));
  const frames = PH.map(p => p.frame);
  onStatus("Capturing the key moments…");
  const [vid, side, logo] = [await videoFrames(data, url, frames), sideViews(data, frames), await logoData()];

  const doc = new jsPDF({ unit: "pt", format: "letter" }), PW = 612, PHt = 792, M = 40, CW = PW - 2 * M;
  let y = 0;
  const footer = () => { doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(140); doc.text(clean(`Feole Pitching | ${data.name || "Pitch"} | page ${doc.getNumberOfPages()}`), PW / 2, PHt - 20, { align: "center" }) };
  const newPage = () => { footer(); doc.addPage(); y = M };
  const need = h => { if (y + h > PHt - 44) newPage() };
  const text = (s, size = 10, { bold = false, color = 20, indent = 0, gap = 4 } = {}) => {
    doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor(color);
    const lines = doc.splitTextToSize(clean(s), CW - indent); const lh = size * 1.3;
    for (const ln of lines) { need(lh); doc.text(ln, M + indent, y + size); y += lh }
    y += gap;
  };

  // ---- header band
  doc.setFillColor(0, 0, 0); doc.rect(0, 0, PW, 78, "F");
  if (logo) try { doc.addImage(logo, "PNG", M, 19, 59, 40) } catch (e) {}
  doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.text("FEOLE PITCHING", M + 72, 40);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.text("Skeleton and angles", M + 72, 56);
  doc.setFontSize(9); doc.text(clean(new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })), PW - M, 40, { align: "right" });
  y = 100;
  text(data.name || "Pitch", 18, { bold: true, gap: 2 });
  const fpsTxt = `${Math.round(data.videoFps || data.fps)} fps`;
  const hIn = data.heightIn, htTxt = hIn ? ` | ${Math.floor(hIn / 12)} ft ${hIn % 12} in` : "";
  text(`${data.throwHand === "L" ? "Left" : "Right"}-handed${htTxt} | ${fpsTxt} | ${(data.frames / data.fps).toFixed(2)} s analysed${data.quality ? " | " + data.quality : ""}`, 9, { color: 110, gap: 10 });

  y += 8;

  // ---- key moments: video + skeleton
  text("The delivery at four key moments", 12, { bold: true, gap: 6 });
  const cw = (CW - 3 * 8) / 4, ch = cw * 1.25;
  need(ch * 2 + 40);
  PH.forEach((p, i) => {
    const x = M + i * (cw + 8);
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(0); doc.text(clean(p.name), x, y + 9);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(120); doc.text(`${(p.frame / data.fps).toFixed(2)} s`, x + cw, y + 9, { align: "right" });
    if (vid[i]) doc.addImage(vid[i], "JPEG", x, y + 14, cw, ch); else { doc.setFillColor(30); doc.rect(x, y + 14, cw, ch, "F") }
    doc.addImage(side[i], "JPEG", x, y + 20 + ch, cw, ch);
  });
  y += 24 + ch * 2 + 6;
  text("Top: the video with the tracked skeleton. Bottom: the 3D skeleton seen from the side. The throwing arm is in orange; the far-side limbs are grey.", 8, { color: 120, gap: 8 });

  // ---- angles at each phase
  need(250);                                  // heading and table stay together
  text("Key angles at each phase", 13, { bold: true, gap: 6 });
  const M_ = data.metrics, rows = [
    ["Throwing elbow flexion", "throwElbow"], ["Throwing shoulder abduction", "throwAbd"], ["Glove arm abduction", "gloveAbd"],
    ["Lead knee flexion", "leadKnee"], ["Lead hip flexion", "leadHip"], ["Back knee flexion", "backKnee"],
    ["Pelvis rotation", "pelvisRot"], ["Trunk rotation", "trunkRot"], ["Hip-shoulder separation", "separation"],
    ["Trunk forward tilt", "trunkFwd"], ["Trunk side tilt", "trunkLat"], ["Pelvis tilt", "pelvisTilt"]];
  const colW = [CW * 0.36, ...PH.map(() => CW * 0.64 / PH.length)];
  need(20 + rows.length * 16);
  doc.setFillColor(0); doc.rect(M, y, CW, 18, "F"); doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(8.5);
  doc.text("Angle", M + 6, y + 12); let cx = M + colW[0];
  PH.forEach((p, i) => { doc.text(clean(p.name), cx + colW[i + 1] - 6, y + 12, { align: "right" }); cx += colW[i + 1] });
  y += 18;
  rows.forEach(([lbl, k], r) => {
    if (r % 2) { doc.setFillColor(242); doc.rect(M, y, CW, 16, "F") }
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(30); doc.text(lbl, M + 6, y + 11);
    let x = M + colW[0];
    PH.forEach((p, i) => { const v = M_[k] ? M_[k][p.frame] : null; doc.text(v == null ? "-" : Math.round(v) + "\xB0", x + colW[i + 1] - 6, y + 11, { align: "right" }); x += colW[i + 1] });
    y += 16;
  });
  y += 10;
  text("Rotation is measured from the set position: 0\u00B0 faces the third-base side for a righty (first-base side for a lefty), 90\u00B0 faces home plate.", 8, { color: 120 });
  footer();
  const name = (data.name || "pitch").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_") || "pitch";
  onStatus("");
  doc.save(`${name}_Feole_Pitching.pdf`);
}
