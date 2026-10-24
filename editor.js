// Feole Pitching: the clip editor on the trim screen. A filmstrip timeline of the video with start and end handles,
// frame-by-frame stepping, play-the-selection on a loop, zoom for precise cuts, and "Cut clip" to actually shorten
// the clip (with undo). It drives the two hidden trim values the rest of the app reads (#trimStart, #trimEnd).

const fmt = t => `${t.toFixed(2)} s`;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const MIN_SEL = 0.4;

export function createEditor({ root, video, startInput, endInput, onChange }) {
  root.innerHTML = `
  <div class="ed">
    <div class="ed-bar">
      <button type="button" class="ed-play" aria-label="Play">▶</button>
      <button type="button" class="ed-step" data-d="-10" aria-label="Back 10 frames">«</button>
      <button type="button" class="ed-step" data-d="-1" aria-label="Back one frame">‹ Frame</button>
      <button type="button" class="ed-step" data-d="1" aria-label="Forward one frame">Frame ›</button>
      <button type="button" class="ed-step" data-d="10" aria-label="Forward 10 frames">»</button>
      <span class="ed-time" aria-live="off">0.00 s</span>
      <span class="ed-sp" role="group" aria-label="Playback speed"><button type="button" data-r="1" aria-pressed="true">1×</button><button type="button" data-r="0.5">½×</button><button type="button" data-r="0.25">¼×</button></span>
      <label class="ed-loop"><input type="checkbox" checked> Loop selection</label>
    </div>
    <div class="ed-tl" tabindex="0" role="slider" aria-label="Timeline: drag the white handles to set the start and end" aria-valuemin="0">
      <canvas class="ed-strip"></canvas>
      <div class="ed-marks"></div>
      <div class="ed-dim ed-dl"></div><div class="ed-dim ed-dr"></div>
      <div class="ed-sel"><div class="ed-h ed-hl" title="Drag to set the start"><i></i></div><div class="ed-h ed-hr" title="Drag to set the end"><i></i></div></div>
      <div class="ed-ph"><b></b></div>
    </div>
    <div class="ed-ruler"></div>
    <div class="ed-row">
      <div class="ed-io">
        <span><button type="button" class="ed-in">Set start</button> <b class="ed-a">0.00 s</b></span>
        <span><button type="button" class="ed-out">Set end</button> <b class="ed-b">0.00 s</b></span>
        <span class="ed-len">Length 0.00 s</span>
      </div>
      <div class="ed-act">
        <button type="button" class="ed-zoom">Zoom to selection</button>
        <button type="button" class="ed-undo" hidden>Undo cut</button>
        <button type="button" class="ed-cut">Cut clip to selection</button>
      </div>
    </div>
    <p class="ed-msg" hidden></p>
    <p class="ed-keys">Drag the white handles, or drag the highlighted part to move it. Click anywhere on the strip to jump there. Keys: <kbd>Space</kbd> play · <kbd>←</kbd><kbd>→</kbd> one frame · <kbd>Shift</kbd> + arrows 10 frames · <kbd>I</kbd> set start · <kbd>O</kbd> set end · <kbd>Z</kbd> zoom</p>
  </div>`;
  const $ = s => root.querySelector(s);
  const tl = $(".ed-tl"), strip = $(".ed-strip"), sel = $(".ed-sel"), ph = $(".ed-ph"), dl = $(".ed-dl"), dr = $(".ed-dr"), marks = $(".ed-marks"), ruler = $(".ed-ruler");
  const playBtn = $(".ed-play"), timeEl = $(".ed-time"), loopBox = $(".ed-loop input"), msg = $(".ed-msg");
  const st = { dur: 0, clip: [0, 0], view: [0, 0], fps: 30, undo: [], markers: { pitches: [], cuts: [] }, url: null, thumbsToken: 0, drag: null };
  const thumbV = document.createElement("video"); thumbV.muted = true; thumbV.playsInline = true; thumbV.preload = "auto";

  const getSel = () => [+startInput.value || 0, +endInput.value || 0];
  function setSel(a, b, from) {
    a = clamp(a, st.clip[0], st.clip[1] - MIN_SEL); b = clamp(b, a + MIN_SEL, st.clip[1]);
    startInput.value = a.toFixed(3); endInput.value = b.toFixed(3);
    onChange && onChange(from); draw();
  }
  const tAt = x => { const r = tl.getBoundingClientRect(); return st.view[0] + clamp((x - r.left) / r.width, 0, 1) * (st.view[1] - st.view[0]) };
  const xOf = t => (t - st.view[0]) / Math.max(1e-6, st.view[1] - st.view[0]) * 100;
  const seek = t => { t = clamp(t, st.clip[0], Math.max(st.clip[0], st.clip[1] - 0.001)); try { video.currentTime = t } catch (e) {} draw() };
  const say = text => { msg.textContent = text || ""; msg.hidden = !text };

  function draw() {
    const [a, b] = getSel(), t = video.currentTime || 0;
    sel.style.left = xOf(a) + "%"; sel.style.width = Math.max(0, xOf(b) - xOf(a)) + "%";
    dl.style.width = clamp(xOf(a), 0, 100) + "%"; dr.style.left = clamp(xOf(b), 0, 100) + "%";
    ph.style.left = clamp(xOf(t), 0, 100) + "%"; ph.hidden = t < st.view[0] || t > st.view[1];
    timeEl.textContent = `${fmt(t - st.clip[0])} / ${fmt(st.clip[1] - st.clip[0])}`;
    $(".ed-a").textContent = fmt(a - st.clip[0]); $(".ed-b").textContent = fmt(b - st.clip[0]); $(".ed-len").textContent = `Length ${fmt(b - a)}`;
    tl.setAttribute("aria-valuemax", (st.clip[1] - st.clip[0]).toFixed(2)); tl.setAttribute("aria-valuenow", (t - st.clip[0]).toFixed(2));
    playBtn.textContent = video.paused ? "▶" : "❚❚"; playBtn.setAttribute("aria-label", video.paused ? "Play" : "Pause");
    $(".ed-undo").hidden = !st.undo.length;
    const zoomed = st.view[0] > st.clip[0] + 0.01 || st.view[1] < st.clip[1] - 0.01;
    $(".ed-zoom").textContent = zoomed ? "Zoom out" : "Zoom to selection";
  }
  function drawRuler() {
    const span = st.view[1] - st.view[0]; if (!(span > 0)) { ruler.innerHTML = ""; return }
    const steps = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60], step = steps.find(s => span / s <= 10) || 120;
    let h = ""; for (let t = Math.ceil((st.view[0] - st.clip[0]) / step) * step + st.clip[0]; t <= st.view[1] + 1e-6; t += step)
      h += `<span style="left:${xOf(t)}%">${(t - st.clip[0]).toFixed(step < 1 ? (step < 0.1 ? 2 : 1) : 0)}s</span>`;
    ruler.innerHTML = h;
  }
  function drawMarks() {
    let h = "";
    st.markers.pitches.forEach((p, k) => { const a = clamp(xOf(p.start), 0, 100), b = clamp(xOf(p.end), 0, 100); if (b > a) h += `<span class="ed-pm" style="left:${a}%;width:${b - a}%" title="Pitch ${k + 1}">${k + 1}</span>` });
    st.markers.cuts.forEach(c => { const x = xOf(c); if (x >= 0 && x <= 100) h += `<span class="ed-cm" style="left:${x}%" title="Camera cut"></span>` });
    marks.innerHTML = h;
  }
  async function drawThumbs() {
    const tok = ++st.thumbsToken, r = tl.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(200, Math.round(r.width * dpr)), H = Math.round(64 * dpr);
    strip.width = W; strip.height = H; const g = strip.getContext("2d"); g.fillStyle = "#111"; g.fillRect(0, 0, W, H);
    if (!st.url || !(st.view[1] > st.view[0])) return;
    if (thumbV.src !== st.url) { thumbV.src = st.url; await new Promise(res => { thumbV.onloadeddata = res; thumbV.onerror = res; setTimeout(res, 8000) }) }
    const ar = (thumbV.videoWidth || 16) / (thumbV.videoHeight || 9), cw = Math.max(24, Math.round(H * ar)), n = Math.ceil(W / cw);
    for (let i = 0; i < n; i++) {
      if (tok !== st.thumbsToken) return;
      const t = st.view[0] + (i + 0.5) / n * (st.view[1] - st.view[0]);
      thumbV.currentTime = clamp(t, 0, Math.max(0, st.dur - 0.01));
      await new Promise(res => { const done = () => { thumbV.removeEventListener("seeked", done); res() }; thumbV.addEventListener("seeked", done); setTimeout(done, 1500) });
      if (tok !== st.thumbsToken) return;
      try { g.drawImage(thumbV, i * (W / n), 0, W / n + 1, H) } catch (e) {}
    }
  }
  let thumbTimer = null;
  function setView(a, b) {
    const pad = (b - a) * 0.06; st.view = [clamp(a - pad, st.clip[0], st.clip[1]), clamp(b + pad, st.clip[0], st.clip[1])];
    if (st.view[1] - st.view[0] < 0.1) st.view = [st.clip[0], st.clip[1]];
    draw(); drawRuler(); drawMarks(); clearTimeout(thumbTimer); thumbTimer = setTimeout(drawThumbs, 60);
  }

  // ---- pointer: handles, move the selection, or scrub
  tl.addEventListener("pointerdown", e => {
    const r = tl.getBoundingClientRect(), x = e.clientX, [a, b] = getSel();
    const xa = r.left + xOf(a) / 100 * r.width, xb = r.left + xOf(b) / 100 * r.width, grab = e.pointerType === "touch" ? 22 : 12;
    let mode = "scrub";
    if (Math.abs(x - xa) <= grab && Math.abs(x - xa) <= Math.abs(x - xb)) mode = "a";
    else if (Math.abs(x - xb) <= grab) mode = "b";
    else if (x > xa && x < xb && e.target.closest(".ed-sel")) mode = "move";
    st.drag = { mode, t0: tAt(x), a, b, wasPlaying: !video.paused };
    if (mode !== "scrub") video.pause();
    tl.setPointerCapture(e.pointerId); move(e); e.preventDefault();
  });
  function move(e) {
    if (!st.drag) return; const t = tAt(e.clientX), d = st.drag;
    if (d.mode === "a") { setSel(Math.min(t, d.b - MIN_SEL), d.b, "a"); seek(+startInput.value) }
    else if (d.mode === "b") { setSel(d.a, Math.max(t, d.a + MIN_SEL), "b"); seek(+endInput.value) }
    else if (d.mode === "move") { const len = d.b - d.a, na = clamp(d.a + (t - d.t0), st.clip[0], st.clip[1] - len); setSel(na, na + len, "move"); seek(na) }
    else seek(t);
  }
  tl.addEventListener("pointermove", move);
  const end = () => { st.drag = null };
  tl.addEventListener("pointerup", end); tl.addEventListener("pointercancel", end);

  // ---- buttons
  const step = n => { video.pause(); seek((video.currentTime || 0) + n / st.fps) };
  playBtn.onclick = () => togglePlay();
  function togglePlay() {
    if (video.paused) { const [a, b] = getSel(); if (loopBox.checked && (video.currentTime < a - 0.01 || video.currentTime >= b - 0.02)) video.currentTime = a; const p = video.play(); if (p && p.catch) p.catch(() => {}) }
    else video.pause();
    draw();
  }
  root.querySelectorAll(".ed-step").forEach(bt => bt.onclick = () => step(+bt.dataset.d));
  root.querySelectorAll(".ed-sp button").forEach(bt => bt.onclick = () => { video.playbackRate = +bt.dataset.r; root.querySelectorAll(".ed-sp button").forEach(x => x.setAttribute("aria-pressed", String(x === bt))) });
  $(".ed-in").onclick = () => { const [, b] = getSel(); setSel(Math.min(video.currentTime, b - MIN_SEL), b, "a") };
  $(".ed-out").onclick = () => { const [a] = getSel(); setSel(a, Math.max(video.currentTime, a + MIN_SEL), "b") };
  $(".ed-zoom").onclick = () => { const zoomed = st.view[0] > st.clip[0] + 0.01 || st.view[1] < st.clip[1] - 0.01; if (zoomed) setView(st.clip[0], st.clip[1]); else { const [a, b] = getSel(); setView(a, b) } };
  $(".ed-cut").onclick = () => {
    const [a, b] = getSel(); if (b - a >= st.clip[1] - st.clip[0] - 0.02) { say("The selection is already the whole clip. Drag the handles in first."); return }
    st.undo.push({ clip: st.clip.slice(), view: st.view.slice() }); st.clip = [a, b];
    say(`Clip cut to ${fmt(b - a)}. Everything outside it is gone from this analysis. "Undo cut" brings it back.`);
    setSel(a, b, "cut"); setView(a, b); seek(a); onChange && onChange("cut");
  };
  $(".ed-undo").onclick = () => {
    const u = st.undo.pop(); if (!u) return; st.clip = u.clip; say("");
    const [a, b] = getSel(); setSel(a, b, "undo"); setView(u.view[0], u.view[1]); onChange && onChange("undo");
  };
  // ---- keyboard, while the trim screen is showing
  document.addEventListener("keydown", e => {
    if (!root.isConnected || root.closest("[hidden]")) return;
    if (e.target.closest && e.target.closest("input[type=text],input[type=number],textarea,select")) return;
    const k = e.key;
    if (k === " ") { e.preventDefault(); togglePlay() }
    else if (k === "ArrowLeft" || k === "ArrowRight") { e.preventDefault(); step((k === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 10 : 1)) }
    else if (k === "i" || k === "I") $(".ed-in").click();
    else if (k === "o" || k === "O") $(".ed-out").click();
    else if (k === "z" || k === "Z") $(".ed-zoom").click();
  });
  // ---- playback: keep inside the clip, loop the selection, measure the frame rate for frame steps
  let raf = 0;
  const tick = () => {
    const [a, b] = getSel();
    if (!video.paused) {
      if (loopBox.checked && video.currentTime >= b) video.currentTime = a;
      else if (video.currentTime >= st.clip[1]) { video.pause(); video.currentTime = st.clip[1] - 0.001 }
    }
    draw(); raf = requestAnimationFrame(tick);
  };
  video.addEventListener("play", () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(tick) });
  video.addEventListener("pause", () => { cancelAnimationFrame(raf); draw() });
  video.addEventListener("seeked", draw);
  video.addEventListener("click", togglePlay);
  if (video.requestVideoFrameCallback) {
    const ts = [];
    const cb = (now, m) => { ts.push(m.mediaTime); if (ts.length > 12) ts.shift();
      if (ts.length >= 6) { const d = ts.slice(1).map((t, i) => t - ts[i]).filter(x => x > 0.001).sort((p, q) => p - q); if (d.length) { const f = 1 / d[d.length >> 1]; st.fps = [24, 25, 30, 48, 50, 60, 90, 100, 120, 240].reduce((p, q) => Math.abs(q - f) < Math.abs(p - f) ? q : p) } }
      video.requestVideoFrameCallback(cb) };
    video.requestVideoFrameCallback(cb);
  }
  new ResizeObserver(() => { clearTimeout(thumbTimer); thumbTimer = setTimeout(drawThumbs, 120) }).observe(tl);

  return {
    load(url, dur) {
      st.url = url; st.dur = dur; st.clip = [0, dur]; st.undo = []; st.markers = { pitches: [], cuts: [] }; say("");
      setView(0, dur);
    },
    // a pitch picked from the finder: show it, inside the clip (restoring the full clip if it lies outside a cut)
    select(a, b) {
      if (a < st.clip[0] - 0.01 || b > st.clip[1] + 0.01) { st.clip = [0, st.dur]; st.undo = []; say("") }
      setSel(a, b, "pick"); setView(a, b); seek(a);
    },
    markers(pitches, cuts) { st.markers = { pitches: pitches || [], cuts: cuts || [] }; drawMarks() },
    redraw: draw,
  };
}
