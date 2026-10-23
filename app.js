// Charney Pitching — app shell: upload, trim, track, analyse, view, history.
import { FilesetResolver, PoseLandmarker } from "./lib/vision_bundle.mjs";
import { analyse } from "./pipeline.js";
import { toFrame, poseBox, pickPitcher, fuseSoft } from "./fuse.js";
import { combineViews, findOffset, verticalMismatch, SAME_PITCH_LIMIT } from "./multiview.js";
import { loadRTM, rtmLook, toLook, rtmBackend } from "./rtm.js";
import { buildReport, reportHTML } from "./report.js";

const $ = id => document.getElementById(id);
const views = ["home", "prep", "progress", "results"];
function show(v) { views.forEach(x => $(x).hidden = x !== v); window.scrollTo({ top: 0 }); document.body.dataset.view = v }
const fmtTime = s => `${s.toFixed(2)} s`;
const opts = { hand: "auto", slow: 1, quality: "max" };
let current = null;      // {file|blob, url, name}
let viewer = null, lastResult = null, lastRaw = null;

// ---------------------------------------------------------------- option chips
function chips(groupId, key, parse = v => v) {
  $(groupId).querySelectorAll("button").forEach(b => b.onclick = () => {
    opts[key] = parse(b.dataset.v);
    $(groupId).querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b));
  });
}
// options are drop-down menus
$("handSel").onchange = e => { opts.hand = e.target.value };
$("slowSel").onchange = e => { opts.slow = Number(e.target.value) };
$("qualSel").onchange = e => { opts.quality = e.target.value; $("qualHint").textContent = QUAL_HINT[e.target.value] };
const QUAL_HINT = {
  max: "Max accuracy takes a few minutes. Keep this tab open.",
  high: "High is about a third of the time of Max accuracy, a little less exact.",
  fast: "Fast is a quick look. Least exact.",
};

// ---------------------------------------------------------------- upload: two or three camera angles of the same pitch
const drop = $("drop"), fileIn = $("fileIn");
let angles = [];                 // [{blob, url, name, label}], angles[0] is the main angle (the one you trim and watch)
const LABELS = ["Side", "Behind", "Front", "Other"];
const isVideo = f => f.type.startsWith("video/") || /\.(mp4|mov|webm|m4v)$/i.test(f.name);
fileIn.onchange = () => { const fs = [...fileIn.files]; fileIn.value = ""; if (fs.length) addAngles(fs) };   // cleared so the same file can be chosen again
$("fileIn2").onchange = () => { const fs = [...$("fileIn2").files]; $("fileIn2").value = ""; if (fs.length) addAngles(fs) };
$("addAngle").onclick = () => $("fileIn2").click();
["dragenter", "dragover"].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.add("over") }));
["dragleave", "drop"].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.remove("over") }));
drop.addEventListener("drop", ev => { const fs = [...(ev.dataTransfer?.files || [])].filter(isVideo); if (fs.length) addAngles(fs) });
drop.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileIn.click() } });

function addAngles(files) {
  if (!$("home").hidden) { angles.forEach(a => URL.revokeObjectURL(a.url)); angles = []; $("pitchName").value = "" }   // a fresh set from the home screen
  for (const f of files.filter(isVideo)) {
    if (angles.length >= 3) break;
    const used = angles.map(a => a.label), label = LABELS.find(l => !used.includes(l)) || "Other";
    angles.push({ blob: f, url: URL.createObjectURL(f), name: f.name.replace(/\.[^.]+$/, "") || "Pitch", label });
  }
  setMain(0, true);
  show("prep");
}
function setMain(i, keepTrim) {
  if (i > 0) { const [m] = angles.splice(i, 1); angles.unshift(m) }
  current = angles[0];
  if (!current) { show("home"); return }
  if (!$("pitchName").value || !keepTrim) $("pitchName").value = current.name;
  const v = $("prepVideo"); if (v.src !== current.url) { v.src = current.url; $("prepErr").hidden = true }
  v.onloadedmetadata = () => {
    const d = v.duration || 0;
    $("trimStart").max = $("trimEnd").max = d.toFixed(2);
    $("trimStart").value = 0; $("trimEnd").value = Math.min(d, 8).toFixed(2);
    updateTrim();
  };
  v.onerror = () => { $("prepErr").hidden = false; $("prepErr").textContent = "This browser can't play that video file. Try an MP4 (H.264) export, or open it in Safari for iPhone .mov files." };
  renderAngles();
}
function renderAngles() {
  const list = $("angleList"); list.innerHTML = "";
  angles.forEach((a, i) => {
    const li = document.createElement("li"); li.className = "angle" + (i === 0 ? " main" : "");
    li.innerHTML = `<video muted playsinline preload="metadata"></video><div class="ainfo"><b>${i === 0 ? "Main angle" : "Angle " + (i + 1)}</b>
      <select aria-label="Which angle is this">${LABELS.map(l => `<option${l === a.label ? " selected" : ""}>${l}</option>`).join("")}</select>
      <span class="abtns">${i ? '<button class="mk">Make main</button>' : ""}<button class="rm" aria-label="Remove this angle">Remove</button></span></div>`;
    li.querySelector("video").src = a.url + "#t=0.5";
    li.querySelector("select").onchange = e => { a.label = e.target.value };
    if (i) li.querySelector(".mk").onclick = () => setMain(i, true);
    li.querySelector(".rm").onclick = () => { URL.revokeObjectURL(a.url); angles.splice(i, 1); angles.length ? setMain(0, true) : (current = null, show("home")) };
    list.append(li);
  });
  $("analyze").disabled = !angles.length; $("addAngle").hidden = angles.length >= 3;
  $("angleList").hidden = angles.length < 2;
  $("angleNote").textContent = angles.length > 1 ? `${angles.length} angles of the same pitch. Trim the main angle; the others are lined up automatically.`
    : "Optional: if a second camera filmed this same pitch at the same time, add it for measured 3D.";
  $("angleNote").classList.remove("warn");
}
function updateTrim(changed) {
  const s = +$("trimStart").value, e = +$("trimEnd").value;
  if (changed === "s" && s > e - 0.4) $("trimStart").value = Math.max(0, e - 0.4);
  if (changed === "e" && e < s + 0.4) $("trimEnd").value = s + 0.4;
  const S = +$("trimStart").value, E = +$("trimEnd").value, d = +$("trimStart").max || 1;
  $("trimFill").style.left = (S / d * 100) + "%"; $("trimFill").style.width = ((E - S) / d * 100) + "%";
  $("trimLabel").textContent = `${fmtTime(S)} → ${fmtTime(E)} · ${(E - S).toFixed(1)} s analysed`;
  $("trimWarn").hidden = E - S <= 8;
}
$("trimStart").oninput = () => { updateTrim("s"); $("prepVideo").currentTime = +$("trimStart").value };
$("trimEnd").oninput = () => { updateTrim("e"); $("prepVideo").currentTime = +$("trimEnd").value };
$("setStart").onclick = () => { $("trimStart").value = $("prepVideo").currentTime.toFixed(2); updateTrim("s") };
$("setEnd").onclick = () => { $("trimEnd").value = $("prepVideo").currentTime.toFixed(2); updateTrim("e") };
$("backHome").onclick = () => show("home");

// ---------------------------------------------------------------- pose tracking in the browser
// Models ship as base64 text (a file type the page host serves); the 30 MB high-accuracy model is split in parts.
const MODELS = {
  max: { label: "30 MB high-accuracy", files: ["model/heavy.b64.part0.txt", "model/heavy.b64.part1.txt", "model/heavy.b64.part2.txt", "model/heavy.b64.part3.txt"] },
  high: { label: "30 MB high-accuracy", files: ["model/heavy.b64.part0.txt", "model/heavy.b64.part1.txt", "model/heavy.b64.part2.txt", "model/heavy.b64.part3.txt"] },
  fast: { label: "9 MB fast", files: ["pose_landmarker_full.b64.txt"] },
};
const modelCache = {};
let trackers = [];
const BASE = () => new URL(".", document.baseURI).href;
async function modelBytes(q) {
  q = q === "max" ? "high" : q;                   // same model file
  if (modelCache[q]) return modelCache[q];
  const parts = await Promise.all(MODELS[q].files.map(f => fetch(BASE() + f).then(r => { if (!r.ok) throw new Error("The tracking model didn't download. Check your connection and try again."); return r.text() })));
  const bin = atob(parts.join("").replace(/\s+/g, "")), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return (modelCache[q] = bytes);
}
async function makeTracker(q, { mode = "VIDEO", poses = 1 } = {}) {
  const fileset = { wasmLoaderPath: BASE() + "wasm/vision_wasm_internal.js", wasmBinaryPath: BASE() + "wasm/vision_wasm_internal.wasm" };
  const bytes = await modelBytes(q);
  const make = delegate => PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetBuffer: bytes.slice(), delegate },      // a copy: the tracker may take ownership of the buffer
    runningMode: mode, numPoses: poses, minPoseDetectionConfidence: 0.3, minPosePresenceConfidence: 0.3, minTrackingConfidence: 0.3,
  });
  let t; try { t = await make("GPU") } catch (e) { t = await make("CPU") }
  trackers.push(t); return t;
}
function closeTrackers() { trackers.forEach(t => { try { t.close() } catch (e) {} }); trackers = [] }
const MIRJ = j => ({1:4,2:5,3:6,4:1,5:2,6:3,7:8,8:7,9:10,10:9,11:12,12:11,13:14,14:13,15:16,16:15,17:18,18:17,19:20,20:19,21:22,22:21,23:24,24:23,25:26,26:25,27:28,28:27,29:30,30:29,31:32,32:31})[j] ?? j;
const once = (el, ev, ms = 8000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("The video stopped responding while it was being read.")), ms); el.addEventListener(ev, () => { clearTimeout(t); res() }, { once: true }) });
async function estimateFps(v) {
  if (!v.requestVideoFrameCallback) return 30;
  const times = [];
  await new Promise(res => {
    const cb = (now, meta) => { times.push(meta.mediaTime); if (times.length < 14) v.requestVideoFrameCallback(cb); else res() };
    v.requestVideoFrameCallback(cb); v.muted = true; v.play().catch(res); setTimeout(res, 1500);
  });
  v.pause();
  const d = times.slice(1).map((t, i) => t - times[i]).filter(x => x > 0.001).sort((a, b) => a - b);
  const fps = d.length ? 1 / d[Math.floor(d.length / 2)] : 30;
  return [24, 25, 30, 48, 50, 60, 90, 100, 120, 240].reduce((a, b) => Math.abs(b - fps) < Math.abs(a - fps) ? b : a);
}
let cancelled = false;
$("cancelRun").onclick = () => { cancelled = true };
function step(id, state, text) { const el = $(id); el.dataset.state = state; if (text != null) el.querySelector("small").textContent = text }
function bar(p) { $("bar").style.width = (p * 100).toFixed(1) + "%" }

$("analyze").onclick = () => run();
async function run() {
  cancelled = false; show("progress"); bar(0);
  ["stModel", "stTrack", "stBuild"].forEach(s => step(s, "todo", ""));
  try {
    if (!angles.length) throw new Error("Choose a pitching video first.");
    const q = opts.quality, K = angles.length, S = +$("trimStart").value, E = Math.max(S + 0.4, +$("trimEnd").value);
    await holdWake();
    const span = 0.93 / K, views = [], hints = [null];
    // main angle: the trimmed window
    const m = await trackOne(q, { url: angles[0].url, start: S, end: E, prog: { prefix: `Angle 1 of ${K} (${angles[0].label})`, from: 0, to: span } });
    views.push({ fps: m.sampleFps, videoFps: m.sampleFps, width: m.W, height: m.H, start: S, frames: m.frames, label: angles[0].label });
    if (K === 1) {                                    // one video: the standard single-camera skeleton
      step("stTrack", "done", `${m.N} frames at ${m.sampleFps} fps`);
      step("stBuild", "doing", "Rebuilding the 3D skeleton");
      await new Promise(r => setTimeout(r, 30));
      const raw = { fps: m.sampleFps * opts.slow, videoFps: m.sampleFps, width: m.W, height: m.H, start: S, frames: m.frames };
      lastRaw = raw; window.__lastRaw = raw;
      const data = analyse(raw, { hand: opts.hand });
      data.name = $("pitchName").value.trim() || current.name; data.quality = { max: "max accuracy", high: "high", fast: "fast" }[q];
      if (q === "max" && window.__engine && window.__engine !== "MediaPipe") data.quality += " · stronger tracker";
      bar(1); step("stBuild", "done", "Done");
      closeTrackers(); releaseWake();
      const id = await saveHistory(data, current.blob);
      return openResults(data, current.url, { id, raw });
    }
    for (let k = 1; k < K; k++) {
      const a = angles[k], base = span * k;
      // find this pitch in the other video: a quick look at the whole clip, lined up on the body's motion
      const vd = await videoDuration(a.url);
      const c = await trackOne("fast", { url: a.url, start: 0, end: Math.min(vd, 40), fpsCap: 30, maxFrames: 1200, prog: { prefix: `Angle ${k + 1} of ${K} (${a.label}): finding the pitch`, from: base, to: base + span * 0.12 } });
      const sync = findOffset(views[0], { fps: c.sampleFps, width: c.W, height: c.H, frames: c.frames });
      const coarse = { fps: c.sampleFps, width: c.W, height: c.H, frames: c.frames };
      if (sync.confidence < 0.45 || verticalMismatch(views[0], coarse, sync.offset) > SAME_PITCH_LIMIT)
        throw new Error(`The ${a.label.toLowerCase()} video doesn't show the same pitch as the main angle. JP Pitching combines different camera angles of ONE pitch, filmed at the same moment (start every camera, clap, then pitch). Two clips of different pitches, even by the same pitcher, can't be combined.`);
      const ws = Math.max(0, sync.offset - 0.35), we = Math.min(vd, sync.offset + (E - S) + 0.35);
      const p = await trackOne(q, { url: a.url, start: ws, end: we, prog: { prefix: `Angle ${k + 1} of ${K} (${a.label})`, from: base + span * 0.12, to: base + span } });
      views.push({ fps: p.sampleFps, videoFps: p.sampleFps, width: p.W, height: p.H, start: ws, frames: p.frames, label: a.label });
      hints.push(sync.offset - ws);
    }
    step("stTrack", "done", `${K} angles tracked`);
    step("stBuild", "doing", "Lining up the angles and measuring every joint in 3D");
    await new Promise(r => setTimeout(r, 30));
    const raw = combineViews(views, { hints });
    raw.fps = views[0].fps * opts.slow; raw.videoFps = views[0].fps; raw.start = S;
    lastRaw = raw; window.__lastRaw = raw;
    const data = analyse(raw, { hand: opts.hand });
    data.name = $("pitchName").value.trim() || current.name; data.quality = { max: "max accuracy", high: "high", fast: "fast" }[q];
    data.cameras = raw.cameras; data.agreeCm = raw.agreeCm;
    bar(1); step("stBuild", "done", "Done");
    closeTrackers(); releaseWake();
    const id = await saveHistory(data, current.blob);
    openResults(data, current.url, { id, raw });
  } catch (e) {
    closeTrackers(); releaseWake();
    if (e.message === "cancelled") { show("prep"); return }
    console.error(e);
    show("prep"); $("prepErr").hidden = false;
    $("prepErr").textContent = /WebAssembly|wasm|CompileError|instantiate/i.test(String(e))
      ? "This browser blocked the tracking engine (WebAssembly). Open the page in Chrome, Edge or Safari on a computer."
      : (e.message || "Something went wrong while analysing these videos.");
  }
}
function videoDuration(url) { return new Promise((res, rej) => { const v = document.createElement("video"); v.preload = "metadata"; v.muted = true; v.onloadedmetadata = () => res(v.duration || 0); v.onerror = () => rej(new Error("One of the videos can't be played in this browser. Try MP4 (H.264).")); v.src = url }) }
function progress(prog) {
  const t0 = performance.now();
  return (label, frac) => {
    const el = (performance.now() - t0) / 1000, left = frac > 0.08 ? el / frac * (1 - frac) : null;
    const eta = left != null ? ` · about ${left > 90 ? Math.ceil(left / 60) + " min" : Math.max(5, Math.round(left / 5) * 5) + " s"} left for this angle` : "";
    step("stTrack", "doing", `${prog.prefix} · ${label}${eta}`); bar(prog.from + (prog.to - prog.from) * Math.min(1, frac));
  };
}
async function trackOne(q, src) { return q === "max" ? trackMax(src) : trackSimple(q, src) }
async function openVideo(url) {
  const v = document.createElement("video");
  v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
  await once(v, "loadeddata", 15000);
  return v;
}
async function trackSimple(q, src) {
  const high = q === "high", say = progress(src.prog);
  step("stModel", "doing", `Downloading the ${MODELS[q].label} tracking model (first time only)`);
  closeTrackers();                                   // fresh trackers per video: timestamps and tracking state start clean
  const lmA = await makeTracker(q);
  const lmB = high ? await makeTracker(q) : null, lmC = high ? await makeTracker(q) : null;
  step("stModel", "done", "Ready");
  const v = await openVideo(src.url);
  const W = v.videoWidth, H = v.videoHeight, start = src.start, end = Math.max(start + 0.4, src.end);
  v.currentTime = start; await once(v, "seeked");
  const native = await estimateFps(v);
  const sampleFps = Math.min(native, src.fpsCap || (high ? 120 : 60)), N = Math.min(src.maxFrames || (high ? 900 : 600), Math.floor((end - start) * sampleFps));
  const frames = [], passes = high ? 2 : 1;
  const seekTo = async i => { v.currentTime = start + (i + 0.5) / sampleFps; await once(v, "seeked") };
  for (let i = 0; i < N; i++) {
    if (cancelled) throw new Error("cancelled");
    await seekTo(i);
    const r = lmA.detectForVideo(v, Math.round(i * 1000 / sampleFps) + 1);
    frames.push(r.landmarks && r.landmarks[0] ? { img: r.landmarks[0].map(p => [p.x, p.y, p.visibility ?? 1]), world: r.worldLandmarks[0].map(p => [p.x, p.y, p.z]) } : null);
    if (i % 3 === 0 || i === N - 1) say(`pass 1 of ${passes}: frame ${i + 1} of ${N}`, (i + 1) / N * (high ? 0.33 : 1));
  }
  if (high) {
    const ok = frames.map(Boolean);
    const raw = frames.map(f => { if (!f) return null; const xs = f.img.map(p => p[0] * W), ys = f.img.map(p => p[1] * H);
      return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2, Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 1.45] });
    const fillB = raw.map((b0, i) => { if (b0) return b0; let k = 1; while (k < N) { if (raw[i - k]) return raw[i - k]; if (raw[i + k]) return raw[i + k]; k++ } return [W / 2, H / 2, Math.max(W, H)] });
    const sig = 2 * sampleFps / 30, r = Math.ceil(sig * 3);
    const boxes = fillB.map((_, i) => { const acc = [0, 0, 0]; let ws = 0; for (let k = -r; k <= r; k++) { const j = Math.min(N - 1, Math.max(0, i + k)), w = Math.exp(-0.5 * (k / sig) ** 2); for (let d = 0; d < 3; d++) acc[d] += fillB[j][d] * w; ws += w } return acc.map(x => x / ws) });
    const CS = 512, cropA = document.createElement("canvas"), cropB = document.createElement("canvas");
    cropA.width = cropA.height = cropB.width = cropB.height = CS;
    const ga = cropA.getContext("2d"), gb = cropB.getContext("2d");
    for (let i = 0; i < N; i++) {
      if (cancelled) throw new Error("cancelled");
      if (!ok[i]) continue;
      await seekTo(i);
      const ts = Math.round(i * 1000 / sampleFps) + 1, [cx, cy, side] = boxes[i], sx = cx - side / 2, sy = cy - side / 2, sc = CS / side;
      ga.setTransform(1, 0, 0, 1, 0, 0); ga.fillStyle = "#000"; ga.fillRect(0, 0, CS, CS);
      ga.setTransform(sc, 0, 0, sc, -sx * sc, -sy * sc); ga.drawImage(v, 0, 0, W, H);
      gb.setTransform(1, 0, 0, 1, 0, 0); gb.fillStyle = "#000"; gb.fillRect(0, 0, CS, CS);
      gb.setTransform(-sc, 0, 0, sc, CS + sx * sc, -sy * sc); gb.drawImage(v, 0, 0, W, H);
      const rb = lmB.detectForVideo(cropA, ts), rc = lmC.detectForVideo(cropB, ts);
      const pb = rb.landmarks && rb.landmarks[0], pc = rc.landmarks && rc.landmarks[0];
      if (pb || pc) frames[i].img = frames[i].img.map((p0, j) => {
        const c = [];
        if (pb) c.push([pb[j].x, pb[j].y, pb[j].visibility ?? 1]);
        if (pc) { const m = pc[MIRJ(j)]; c.push([1 - m.x, m.y, m.visibility ?? 1]) }
        const x = c.reduce((a, q) => a + q[0], 0) / c.length, y = c.reduce((a, q) => a + q[1], 0) / c.length, vis = c.reduce((a, q) => a + q[2], 0) / c.length;
        return [(sx + x * side) / W, (sy + y * side) / H, vis];
      });
      if (i % 2 === 0 || i === N - 1) say(`pass 2 of 2 (zoomed, mirrored): frame ${i + 1} of ${N}`, 0.33 + (i + 1) / N * 0.67);
    }
  }
  const found = frames.filter(Boolean).length;
  if (found < N * 0.5) throw new Error(`The tracker only found the pitcher in ${found} of ${N} frames of one angle. Use clips where his whole body stays in view.`);
  return { frames, N, sampleFps, W, H, start, label: high ? "high" : "fast" };
}

// ---------------------------------------------------------------- max accuracy: many independent looks, kept where they agree
let wake = null;
async function holdWake() { try { wake = await navigator.wakeLock?.request("screen") } catch (e) { wake = null } }
function releaseWake() { try { wake?.release() } catch (e) {} wake = null }
const FJ = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const poseDistLook = (a, b, W, H) => FJ.reduce((s, j) => s + Math.hypot((a.img[j][0] - b.img[j][0]) * W, (a.img[j][1] - b.img[j][1]) * H), 0) / FJ.length;
function drawCrop(g, v, CS, W, H, crop) {
  const sc = CS / crop.side;
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = "#000"; g.fillRect(0, 0, CS, CS);
  if (crop.mirror) g.setTransform(-sc, 0, 0, sc, CS + crop.sx * sc, -crop.sy * sc); else g.setTransform(sc, 0, 0, sc, -crop.sx * sc, -crop.sy * sc);
  g.drawImage(v, 0, 0, W, H);
}
async function trackMax(src) {
  const q = "max", say = progress(src.prog);
  step("stModel", "doing", `Downloading the ${MODELS[q].label} tracking model (first time only)`);
  closeTrackers();
  // tracking one person keeps MediaPipe's frame-to-frame stabilising on; a separate multi-person look finds the pitcher
  const full = await makeTracker(q), finder = await makeTracker(q, { mode: "IMAGE", poses: 3 });
  // the stronger body tracker (sees blurred arms and legs far better); if it can't load, carry on without it
  let rtm = false;
  if (opts.engine !== "standard") {
    try {
      await loadRTM((f, got) => step("stModel", "doing", `Loading the stronger body tracker (${Math.round(got / 1e6)} MB)`));
      rtm = true;
    } catch (e) { console.warn("stronger tracker unavailable, using the built-in one", e) }
  }
  window.__engine = rtm ? "RTMPose + MediaPipe (" + rtmBackend() + ")" : "MediaPipe";
  step("stModel", "done", rtm ? `Ready · stronger tracker on the ${rtmBackend() === "webgpu" ? "graphics chip" : "processor"}` : "Ready · the stronger tracker couldn't load, so arms may be less exact");
  const v = await openVideo(src.url);
  const W = v.videoWidth, H = v.videoHeight;
  const start = src.start, end = Math.max(start + 0.4, src.end);
  v.currentTime = start; await once(v, "seeked");
  const native = await estimateFps(v);
  const sampleFps = Math.min(native, 240), N = Math.min(1500, Math.floor((end - start) * sampleFps));
  const seekTo = async i => { v.currentTime = start + (i + 0.5) / sampleFps; await once(v, "seeked") };
  const ts = k => Math.round(k * 1000 / sampleFps) + 1;
  // progress with a time estimate: pass 1 = 1 unit per frame, zoomed passes 3, backward passes 2
  const units = N * 6; let doneU = 0;
  const tick = (label, i) => { doneU++; if (doneU % 3 && i !== N - 1) return; say(`${label}: frame ${i + 1} of ${N}`, doneU / units) };
  // pass 1: the whole picture, every frame; pick out the pitcher if other people are in view
  const looks = Array.from({ length: N }, () => []), first = new Array(N).fill(null);
  let ref = null;
  for (let i = 0; i < N; i++) {
    if (cancelled) throw new Error("cancelled");
    await seekTo(i);
    const who = pickPitcher(finder.detect(v), null, W, H, ref);         // the pitcher among everyone in view
    const f = pickPitcher(full.detectForVideo(v, ts(i)), null, W, H, who || ref);
    if (f) { f.src = "full"; looks[i].push(f) }
    const id = who || f;
    if (id) { first[i] = id; ref = id }
    tick("Pass 1 of 3 · full picture", i);
  }
  if (first.filter(Boolean).length < N * 0.5) throw new Error(`The tracker only found the pitcher in ${first.filter(Boolean).length} of ${N} frames. Use a clip where his whole body stays in view.`);
  // a smooth crop path that follows the pitcher over the whole clip
  const near = i => { if (first[i]) return first[i]; for (let k = 1; k < N; k++) { if (first[i - k]) return first[i - k]; if (first[i + k]) return first[i + k] } return null };
  const raw = Array.from({ length: N }, (_, i) => poseBox(near(i), W, H));
  const sig = 2 * sampleFps / 30, r = Math.ceil(sig * 3);
  const boxes = raw.map((_, i) => { const acc = [0, 0, 0]; let ws = 0; for (let k = -r; k <= r; k++) { const j = Math.min(N - 1, Math.max(0, i + k)), w = Math.exp(-0.5 * (k / sig) ** 2); for (let d = 0; d < 3; d++) acc[d] += raw[j][d] * w; ws += w } return acc.map(x => x / ws) });
  const cropAt = (i, scale, mirror) => { const [cx, cy, s0] = boxes[i], side = s0 * scale; return { sx: cx - side / 2, sy: cy - side / 2, side, mirror } };
  const CS = 512, cv = document.createElement("canvas"); cv.width = cv.height = CS; const g = cv.getContext("2d", { willReadFrequently: false });
  const look = (tracker, i, k, crop, video, src) => {
    drawCrop(g, v, CS, W, H, crop);
    const res = video ? tracker.detectForVideo(cv, ts(k)) : tracker.detect(cv);
    const f = pickPitcher(res, crop, W, H, near(i)); if (f) { f.src = src; looks[i].push(f) }
  };
  // pass 2 (forward): zoomed in at three sizes, normal and mirrored; two follow the motion, two judge each frame fresh
  full.close(); finder.close(); trackers = trackers.filter(t => t !== full && t !== finder);
  const zA = await makeTracker(q), zB = await makeTracker(q), still = rtm ? null : await makeTracker(q, { mode: "IMAGE" });
  for (let i = 0; i < N; i++) {
    if (cancelled) throw new Error("cancelled");
    await seekTo(i);
    look(zA, i, i, cropAt(i, 1.4, false), true, "zoom"); tick("Pass 2 of 3 · zoomed in", i);
    look(zB, i, i, cropAt(i, 1.4, true), true, "zoomMirror"); tick("Pass 2 of 3 · zoomed in", i);
    if (rtm) {
      // the stronger tracker, normal and mirrored, on the pitcher's box (its own padding adds room for the arm)
      const [cx, cy, s0] = boxes[i], box = [cx - s0 / 2, cy - s0 / 2, cx + s0 / 2, cy + s0 / 2];
      for (const m of [false, true]) {
        const h = await rtmLook(v, W, H, box, m), f = toLook(h, W, H, m ? "rtmMirror" : "rtm");
        const ref = near(i); if (!ref || poseDistLook(f, ref, W, H) < 0.6 * poseBox(ref, W, H)[2]) looks[i].push(f);
      }
      tick("Pass 2 of 3 · stronger tracker", i);
    } else { look(still, i, i, cropAt(i, 1.2, false), false, "stillClose"); look(still, i, i, cropAt(i, 1.75, true), false, "stillWideMirror"); tick("Pass 2 of 3 · zoomed in", i) }
  }
  // pass 3 (backward in time): tracking that follows the motion lags a little; running it in reverse lags the other way
  [zA, zB].forEach(t => t.close()); trackers = trackers.filter(t => t !== zA && t !== zB);
  const bA = await makeTracker(q), bB = await makeTracker(q);
  for (let k = 0; k < N; k++) {
    if (cancelled) throw new Error("cancelled");
    const i = N - 1 - k;
    await seekTo(i);
    look(bA, i, k, cropAt(i, 1.4, false), true, "back"); tick("Pass 3 of 3 · backwards", k);
    look(bB, i, k, cropAt(i, 1.55, true), true, "backMirror"); tick("Pass 3 of 3 · backwards", k);
  }
  say("combining the seven passes", 1);
  await new Promise(r => setTimeout(r, 20));
  window.__lastLooks = { W, H, fps: sampleFps, looks };
  const frames = looks.map(c => fuseSoft(c, W, H, { k: 4, srcW: { stillClose: 0.3, stillWideMirror: 0.3, rtm: 3, rtmMirror: 3 } }));
  return { frames, N, sampleFps, W, H, start, label: "max accuracy" };
}

// ---------------------------------------------------------------- results
function openResults(data, url, meta = {}) {
  if (viewer) { viewer.stop(); viewer = null }
  lastResult = { data, url, meta }; window.__lastData = data;
  const mount = $("viewerMount"); mount.innerHTML = ""; mount.append($("viewerTpl").content.cloneNode(true));
  $("resName").textContent = data.name || "Pitch";
  const dur = data.frames / data.fps;
  $("resMeta").textContent = `${data.throwHand === "L" ? "Left" : "Right"}-handed · ${data.frames} frames · ${Math.round(data.videoFps || data.fps)} fps${data.fps !== (data.videoFps || data.fps) ? ` (${Math.round(data.fps / data.videoFps)}× slow motion)` : ""} · ${dur.toFixed(2)} s${data.quality ? ` · ${data.quality}` : ""}${data.cameras ? ` · 3D measured from ${data.cameras.length} angles (${data.cameras.map(c => c.label).join(", ")}), cameras agree within ${data.agreeCm} cm` : data.match ? ` · skeleton within ${data.match.medianCm} cm of the video` : ""}`;
  show("results");
  const onPhases = meta.raw ? (phases, frame) => {
    const d2 = analyse(meta.raw, { hand: data.throwHand, phases }); d2.name = data.name;
    if (meta.id != null) updateHistory(meta.id, d2);
    openResults(d2, url, { ...meta, startFrame: frame });
  } : null;
  $("phaseEditNote").hidden = !!onPhases;
  viewer = window.startViewer(data, url, { onPhases, startFrame: meta.startFrame });
  try {
    const box = $("report");
    if (box) {
      box.innerHTML = reportHTML(buildReport(data));
      box.querySelectorAll(".rshow").forEach(b => b.onclick = () => { if (viewer && viewer.seek) { viewer.seek(+b.dataset.f); $("viewerMount").scrollIntoView({ behavior: "smooth", block: "start" }) } });
    }
  } catch (e) { console.warn("report failed", e) }
}
$("newBtn").onclick = () => { if (viewer) { viewer.stop(); viewer = null } show("home"); renderHistory() };
$("brand").onclick = e => { e.preventDefault(); $("newBtn").onclick() };


// CSV export: inside claude.ai through the viewer's download prompt; on a normal website as a direct download
(async () => {
  const inClaude = !!window.claude?.use;
  const dl = inClaude ? await window.claude.use("downloads").catch(() => null) : null;
  if (inClaude && !dl) return;                       // claude.ai view without downloads: keep the button hidden
  $("csvBtn").hidden = false;
  $("csvBtn").onclick = async () => {
    if (!viewer || !lastResult) return;
    const name = (lastResult.data.name || "pitch").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_") || "pitch";
    const filename = `${name}_angles.csv`, csv = viewer.csv();
    if (dl) {
      try { await dl.save({ filename, data: csv }) }
      catch (e) { if (e?.code === "unavailable" || e?.code === "not_granted") $("csvBtn").hidden = true }
      return;
    }
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
})();

// ---------------------------------------------------------------- history (this browser only)
const DB_NAME = "charney-pitching", STORE = "analyses";
function idb() {
  return new Promise((res, rej) => {
    try {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    } catch (e) { rej(e) }
  });
}
async function tx(mode, fn) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction(STORE, mode), s = t.objectStore(STORE); const out = fn(s); t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = () => rej(t.error) }) }
async function saveHistory(data, blob) {
  try {
    const all = await tx("readonly", s => s.getAll());
    const extra = (all || []).sort((a, b) => b.date - a.date).slice(5);
    for (const x of extra) await tx("readwrite", s => s.delete(x.id));
    return await tx("readwrite", s => s.add({ date: Date.now(), name: data.name, hand: data.throwHand, frames: data.frames, fps: data.fps, data, blob, raw: lastRaw }));
  } catch (e) { return null }
}
async function updateHistory(id, data) { try { const rec = await tx("readonly", s => s.get(id)); if (rec) { rec.data = data; await tx("readwrite", s => s.put(rec)) } } catch (e) {} }
async function renderHistory() {
  const list = $("recent"); let items = [];
  try { items = (await tx("readonly", s => s.getAll())) || [] } catch (e) {}
  items.sort((a, b) => b.date - a.date);
  $("recentWrap").hidden = !items.length; list.innerHTML = "";
  items.forEach(it => {
    const li = document.createElement("li");
    const d = new Date(it.date);
    li.innerHTML = `<button class="rec-open"><span class="rec-name"></span><span class="rec-meta">${it.hand === "L" ? "LHP" : "RHP"} · ${(it.frames / it.fps).toFixed(1)} s · ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span></button><button class="rec-del" aria-label="Remove">✕</button>`;
    li.querySelector(".rec-name").textContent = it.name || "Pitch";
    li.querySelector(".rec-open").onclick = () => {
      const url = URL.createObjectURL(it.blob); lastRaw = it.raw;
      let data = it.data;
      if (it.raw) {                     // rebuild with the current skeleton engine (tracking is reused, so it's instant)
        try { const d = analyse(it.raw, { hand: it.hand || "auto" }); d.name = it.data.name; d.quality = it.data.quality; data = d; updateHistory(it.id, d) } catch (e) { }
      }
      openResults(data, url, { id: it.id, raw: it.raw });
    };
    li.querySelector(".rec-del").onclick = async () => { await tx("readwrite", s => s.delete(it.id)).catch(() => {}); renderHistory() };
    list.append(li);
  });
}
renderHistory();
show("home");
// start downloading the default model in the background so the first analysis begins sooner
setTimeout(() => modelBytes(opts.quality).catch(() => {}), 1500);
