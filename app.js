// Charney Pitching — app shell: upload, trim, track, analyse, view, history.
import { FilesetResolver, PoseLandmarker } from "./lib/vision_bundle.mjs";
import { analyse, detectSlowFactor } from "./pipeline.js";
import { toFrame, poseBox, pickPitcher, fuseSoft } from "./fuse.js";
import { combineViews, findOffset, verticalMismatch, SAME_PITCH_LIMIT } from "./multiview.js";
import { loadRTM, rtmLook, toLook, rtmBackend } from "./rtm.js";
import { buildReport, reportHTML } from "./report.js";
import { downloadPDF } from "./pdf.js";
import { createEditor } from "./editor.js";
import { learnDepth } from "./lifter.js";

const $ = id => document.getElementById(id);
const views = ["home", "prep", "progress", "results"];
function show(v) { views.forEach(x => $(x).hidden = x !== v); window.scrollTo({ top: 0 }); document.body.dataset.view = v }
const fmtTime = s => `${s.toFixed(2)} s`;
const opts = { hand: "auto", slow: "auto", quality: "max", level: "hs", heightIn: null, velo: null };
// level and height are remembered in this browser (a convenience; everything works without it)
try { const sv = JSON.parse(localStorage.getItem("fp-pitcher") || "{}"); if (sv.level) opts.level = sv.level; if (sv.heightIn) opts.heightIn = sv.heightIn } catch (e) {}
const keepPitcher = () => { try { localStorage.setItem("fp-pitcher", JSON.stringify({ level: opts.level, heightIn: opts.heightIn })) } catch (e) {} };
// carry the pitcher's details onto a freshly analysed result
const tagResult = (d, from) => { d.name = from.name; if (from.quality) d.quality = from.quality; if (from.cameras) { d.cameras = from.cameras; d.agreeCm = from.agreeCm } d.level = from.level || opts.level; d.heightIn = from.heightIn ?? opts.heightIn; d.velo = from.velo ?? null; d.slowNote = from.slowNote || ""; return d };
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
$("slowSel").onchange = e => { opts.slow = e.target.value === "auto" ? "auto" : Number(e.target.value); if ($("trimStart").max) updateTrim() };
// how much the clip is slowed: detected from the motion (a delivery's timing is nearly the same for every pitcher).
// A manual choice is kept unless the motion clearly says otherwise (then the detected speed is used, and the results say so).
function resolveSlow(raw) {
  const det = detectSlowFactor(raw);
  if (opts.slow === "auto") return { factor: det.factor, note: det.factor > 1 ? `${det.factor}× slow motion detected` : "" };
  const chosen = opts.slow || 1;
  if (det.basis === "leg lift to release" && Math.abs(Math.log2(det.factor) - Math.log2(chosen)) >= 1)
    return { factor: det.factor, note: `You chose ${chosen === 1 ? "normal speed" : chosen + "× slow"}, but the motion is ${det.factor === 1 ? "normal speed" : det.factor + "× slow"}: used ${det.factor === 1 ? "normal speed" : det.factor + "×"}` };
  return { factor: chosen, note: "" };
}
$("qualSel").onchange = e => { opts.quality = e.target.value; $("qualHint").textContent = QUAL_HINT[e.target.value] };
$("levelSel").value = opts.level;
if (opts.heightIn) { $("heightFt").value = String(Math.floor(opts.heightIn / 12)); $("heightIn").value = String(opts.heightIn % 12) } else $("heightFt").value = "";
$("levelSel").onchange = e => { opts.level = e.target.value; keepPitcher() };
const readHeight = () => { const f = $("heightFt").value; opts.heightIn = f === "" ? null : Number(f) * 12 + Number($("heightIn").value); $("heightIn").disabled = f === ""; keepPitcher() };
$("veloIn").oninput = e => { const v = parseFloat(e.target.value); opts.velo = v >= 30 && v <= 110 ? v : null };
$("heightFt").onchange = readHeight; $("heightIn").onchange = readHeight; $("heightIn").disabled = $("heightFt").value === "";
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
    $("trimStart").value = 0; $("trimEnd").value = d.toFixed(2);         // the whole clip by default: any length works
    editor.load(current.url, d);
    updateTrim();
    scanPitches(current);                                                  // then narrow it to one pitch, automatically
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
function updateTrim() {
  const S = +$("trimStart").value, E = +$("trimEnd").value;
  $("trimLabel").textContent = `${fmtTime(S)} → ${fmtTime(E)} · ${(E - S).toFixed(1)} s analysed`;
  // real time covered (a slowed clip covers less real time than it plays for)
  const real = (E - S) / (typeof opts.slow === "number" ? opts.slow : 1);
  $("trimWarn").hidden = real <= 8;
}
const editor = createEditor({ root: $("clipEditor"), video: $("prepVideo"), startInput: $("trimStart"), endInput: $("trimEnd"), onChange: () => updateTrim() });
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
    if (scan && scan.state === "busy" && scan.promise) { step("stModel", "doing", "Finding the pitch in this clip"); await scan.promise.catch(() => {}) }
    const q = opts.quality, K = angles.length, S = +$("trimStart").value, E = Math.max(S + 0.4, +$("trimEnd").value);
    await holdWake();
    const span = 0.93 / K, views = [], hints = [null];
    // main angle: the trimmed window
    const m = keepOneShot(await trackOne(q, { url: angles[0].url, start: S, end: E, prog: { prefix: `Angle 1 of ${K} (${angles[0].label})`, from: 0, to: span } }));
    views.push({ fps: m.sampleFps, videoFps: m.sampleFps, width: m.W, height: m.H, start: m.start, frames: m.frames, label: angles[0].label });
    if (K === 1) {                                    // one video: the standard single-camera skeleton
      step("stTrack", "done", `${m.N} frames at ${m.sampleFps} fps${m.repeats ? ` · ${m.repeats} repeated frames skipped` : ""}`);
      step("stBuild", "doing", "Rebuilding the 3D skeleton");
      await new Promise(r => setTimeout(r, 30));
      const raw = { fps: m.sampleFps, videoFps: m.sampleFps, width: m.W, height: m.H, start: m.start, frames: m.frames };
      const sl = resolveSlow(raw); raw.fps = m.sampleFps * sl.factor; raw.slowNote = sl.note;
      // learned 3D motion model: how far each joint is toward/away from the camera, from how real bodies move
      try { step("stBuild", "doing", "Learned 3D motion model: reading the whole motion");
        raw.l3 = await learnDepth(raw, f => step("stBuild", "doing", `Learned 3D motion model ${Math.round(100 * f)}%`)) }
      catch (e) { console.warn("learned 3D model unavailable", e); raw.l3 = null }
      step("stBuild", "doing", "Rebuilding the 3D skeleton"); await new Promise(r => setTimeout(r, 30));
      lastRaw = raw; window.__lastRaw = raw;
      const data = analyse(raw, { hand: opts.hand }); data.slowNote = raw.slowNote || "";
      data.name = $("pitchName").value.trim() || current.name; data.quality = { max: "max accuracy", high: "high", fast: "fast" }[q];
      if (q === "max" && window.__engine && window.__engine !== "MediaPipe") data.quality += " · stronger tracker";
      if (data.learned) data.quality += " · learned 3D";
      data.level = opts.level; data.heightIn = opts.heightIn; data.velo = opts.velo;
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
        throw new Error(`The ${a.label.toLowerCase()} video doesn't show the same pitch as the main angle. Feole Pitching combines different camera angles of ONE pitch, filmed at the same moment (start every camera, clap, then pitch). Two clips of different pitches, even by the same pitcher, can't be combined.`);
      const ws = Math.max(0, sync.offset - 0.35), we = Math.min(vd, sync.offset + (E - S) + 0.35);
      const p = await trackOne(q, { url: a.url, start: ws, end: we, prog: { prefix: `Angle ${k + 1} of ${K} (${a.label})`, from: base + span * 0.12, to: base + span } });
      views.push({ fps: p.sampleFps, videoFps: p.sampleFps, width: p.W, height: p.H, start: ws, frames: p.frames, label: a.label });
      hints.push(sync.offset - ws);
    }
    step("stTrack", "done", `${K} angles tracked`);
    step("stBuild", "doing", "Lining up the angles and measuring every joint in 3D");
    await new Promise(r => setTimeout(r, 30));
    const raw = combineViews(views, { hints });
    raw.fps = views[0].fps; raw.videoFps = views[0].fps; raw.start = S;
    { const sl = resolveSlow(raw); raw.fps = views[0].fps * sl.factor; raw.slowNote = sl.note }
    lastRaw = raw; window.__lastRaw = raw;
    const data = analyse(raw, { hand: opts.hand }); data.slowNote = raw.slowNote || "";
    data.name = $("pitchName").value.trim() || current.name; data.quality = { max: "max accuracy", high: "high", fast: "fast" }[q];
    data.cameras = raw.cameras; data.agreeCm = raw.agreeCm;
    data.level = opts.level; data.heightIn = opts.heightIn; data.velo = opts.velo;
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
  // cover the WHOLE chosen window: if it's long, sample a little less densely rather than cutting the end off
  const capF = src.maxFrames || (high ? 900 : 600), want = Math.min(native, src.fpsCap || (high ? 120 : 60));
  const sampleFps = Math.max(1, Math.min(want, capF / Math.max(0.05, end - start))), N = Math.max(1, Math.min(capF, Math.floor((end - start) * sampleFps)));
  const frames = [], passes = high ? 2 : 1, diffs = []; let prevSig = null;
  const seekTo = async i => { v.currentTime = start + (i + 0.5) / sampleFps; await once(v, "seeked") };
  for (let i = 0; i < N; i++) {
    if (cancelled) throw new Error("cancelled");
    await seekTo(i);
    { const sg = frameSig(v); diffs.push(i ? sigDiff(sg, prevSig) : 1e9); prevSig = sg }
    const r = lmA.detectForVideo(v, Math.round(i * 1000 / sampleFps) + 1);
    frames.push(r.landmarks && r.landmarks[0] ? { img: r.landmarks[0].map(p => [p.x, p.y, p.visibility ?? 1]), world: r.worldLandmarks[0].map(p => [p.x, p.y, p.z]) } : null);
    if (i % 3 === 0 || i === N - 1) say(`pass 1 of ${passes}: frame ${i + 1} of ${N}`, (i + 1) / N * (high ? 0.33 : 1));
  }
  const dupS = repeatedFrames(diffs);
  dupS.forEach((d, i) => { if (d) frames[i] = null });                 // repeats: filled in smoothly later
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
  const nReal = N - dupS.filter(Boolean).length, found = frames.filter(Boolean).length;
  if (found < nReal * 0.5) throw new Error(`The tracker only found the pitcher in ${found} of ${nReal} frames of one angle. Use clips where his whole body stays in view.`);
  return { frames, N, sampleFps, W, H, start, label: high ? "high" : "fast", repeats: N - nReal, diffs };
}


// ---------------------------------------------------------------- finding the pitches in a clip
// Clips from the internet often hold several pitches, the pitcher walking around between them, and camera cuts.
// Built as one skeleton, that jumps at every cut and every reset. A quick scan (about 8 looks a second) finds each
// delivery (a leg lift followed by a long stride) and every camera cut, and trims to one pitch inside one shot.
let scan = null;                                                           // { forUrl, promise, pitches, cuts }
function fmtClock(t) { const m = Math.floor(t / 60), s = t - 60 * m; return `${m}:${s.toFixed(1).padStart(4, "0")}` }
async function findPitches(url, onProgress) {
  const v = await openVideo(url), dur = v.duration || 0, W = v.videoWidth, H = v.videoHeight;
  if (!(dur > 0)) return { pitches: [], cuts: [] };
  const sf = Math.min(8, Math.max(5, 400 / dur)), n = Math.max(2, Math.floor(dur * sf));
  let tr = await makeTracker("fast", { mode: "VIDEO" });
  const S = []; let prev = null, k0 = 0;
  for (let i = 0; i < n; i++) {
    if (scan && scan.forUrl !== url) break;                                 // another clip was chosen
    v.currentTime = Math.min(dur - 0.01, (i + 0.5) / sf); await once(v, "seeked");
    const sg = frameSig(v), dif = prev ? sigDiff(sg, prev) : 0; prev = sg;
    // a camera cut is a one-off spike in picture change (steady big change is just the camera panning or fast motion)
    const recent = S.slice(-5).map(x => x.dif).sort((p, q) => p - q), med = recent.length ? recent[recent.length >> 1] : 0;
    const cut = dif > 16 && dif > 3.5 * Math.max(med, 2);
    if (cut) { try { tr.close() } catch (e) {} trackers = trackers.filter(x => x !== tr); tr = await makeTracker("fast", { mode: "VIDEO" }); k0 = i }
    const r = tr.detectForVideo(v, Math.round((i - k0) * 1000 / sf) + 1), L = r.landmarks && r.landmarks[0];
    S.push({ t: (i + 0.5) / sf, cut, dif, p: L ? L.map(q => [q.x * W, q.y * H]) : null });
    if (onProgress && i % 5 === 0) onProgress(i / n);
  }
  try { tr.close() } catch (e) {} trackers = trackers.filter(x => x !== tr);
  // final cut list: a spike compared with the looks on BOTH sides
  const cuts = [];
  for (let i = 1; i < S.length; i++) {
    const loc = [...S.slice(Math.max(1, i - 5), i), ...S.slice(i + 1, i + 6)].map(x => x.dif).sort((p, q) => p - q), med = loc.length ? loc[loc.length >> 1] : 0;
    if (S[i].dif > 16 && S[i].dif > 3.5 * Math.max(med, 2)) cuts.push(S[i].t - 0.5 / sf);
  }
  // per look: stride (ankle to ankle, in body heights) and leg lift (front-most knee height relative to the hips)
  const sig = S.map(x => {
    if (!x.p) return null; const P = x.p, ys = [0, 27, 28].map(j => P[j][1]), h = Math.max(...ys) - Math.min(...ys);
    if (!(h > 20)) return null;
    const hipY = (P[23][1] + P[24][1]) / 2;
    return { stride: Math.abs(P[27][0] - P[28][0]) / h, lift: Math.max(hipY - P[25][1], hipY - P[26][1]) / h };
  });
  const sm = (k, i) => { let a = 0, c = 0; for (let j = i - 1; j <= i + 1; j++) if (sig[j]) { a += sig[j][k]; c++ } return c ? a / c : null };
  const stride = S.map((_, i) => sm("stride", i)), lift = S.map((_, i) => sm("lift", i));
  const segOf = t => { let a = 0, b = dur; for (const c of cuts) { if (c <= t) a = Math.max(a, c); else { b = Math.min(b, c); break } } return [a, b] };
  // deliveries: a stride peak clearly wider than how he stands in that shot, after a real leg lift, 1.5 s+ apart
  const baseOf = (a, b) => { const v = []; S.forEach((x, i) => { if (x.t >= a && x.t < b && stride[i] != null) v.push(stride[i]) }); v.sort((p, q) => p - q); return v.length ? v[Math.floor(v.length * 0.3)] : 0.2 };
  const cand = [];
  for (let i = 1; i < S.length - 1; i++) {
    const v0 = stride[i]; if (v0 == null || v0 < 0.7) continue;
    if ((stride[i - 1] ?? 0) > v0 || (stride[i + 1] ?? 0) > v0) continue;
    const [segA, segB] = segOf(S[i].t); if (v0 - baseOf(segA, segB) < 0.3) continue;
    // the leg lift: highest knee in the 4 s before, in the same shot, up near hip height
    let ll = null;
    for (let j = i; j >= 0 && S[j].t >= Math.max(segA, S[i].t - 4); j--) if (lift[j] != null && (ll == null || lift[j] > lift[ll])) ll = j;
    if (ll == null || lift[ll] < -0.08 || S[i].t - S[ll].t < 0.15) continue;
    cand.push({ i, t: S[i].t, s: v0, ll, seg: [segA, segB] });
  }
  const wins = [];
  for (const pk of cand) {
    const llT = S[pk.ll].t, span = Math.max(0.25, pk.t - llT);
    const a = Math.max(pk.seg[0], llT - Math.max(0.35, 0.6 * span)), b = Math.min(pk.seg[1], pk.t + Math.max(0.8, 1.6 * span));
    if (b - a >= 0.6) wins.push({ start: +a.toFixed(2), end: +b.toFixed(2), t: pk.t, s: pk.s });
  }
  // strongest first: a detection inside a pitch already kept is that same pitch (slow motion holds the stride for seconds)
  const kept = [];
  for (const w of wins.sort((x, y) => y.s - x.s)) if (!kept.some(o => (o.start <= w.t && w.t <= o.end) || (w.start <= o.t && o.t <= w.end))) kept.push(w);
  const pitches = kept.sort((x, y) => x.start - y.start).map(w => ({ start: w.start, end: w.end }));
  return { pitches, cuts };
}
function showPitches() {
  const box = $("pitchFind"), msg = $("pitchFindMsg"), chips = $("pitchChips");
  if (!scan) { box.hidden = true; return }
  box.hidden = false; chips.innerHTML = "";
  if (scan.state === "busy") { msg.innerHTML = `Finding the pitch in this clip… <small>${Math.round(100 * (scan.prog || 0))}%</small>`; return }
  const P = scan.pitches || [], nc = (scan.cuts || []).length;
  if (!P.length) { msg.innerHTML = `Couldn't spot a single pitch automatically${nc ? ` (the camera cuts ${nc} time${nc > 1 ? "s" : ""})` : ""}, so the whole clip will be analysed. For the smoothest skeleton, drag the trim to just one pitch.`; return }
  msg.innerHTML = P.length === 1 ? `<b>Found the pitch</b> and trimmed to it${nc ? `, inside one camera shot` : ""}.` : `<b>Found ${P.length} pitches</b>${nc ? ` and ${nc} camera cut${nc > 1 ? "s" : ""}` : ""}. Analysing one at a time keeps the skeleton smooth: pick which one.`;
  P.forEach((p, k) => {
    const b = document.createElement("button"); b.type = "button"; b.textContent = `Pitch ${k + 1} · ${fmtClock(p.start)}`;
    b.setAttribute("aria-pressed", String(k === scan.sel)); b.onclick = () => pickPitch(k); chips.append(b);
  });
  const all = document.createElement("button"); all.type = "button"; all.textContent = "Whole clip"; all.setAttribute("aria-pressed", String(scan.sel === -1));
  all.onclick = () => pickPitch(-1); chips.append(all);
}
function pickPitch(k) {
  if (!scan) return; scan.sel = k;
  const d = +$("trimStart").max || 0, p = k >= 0 ? scan.pitches[k] : { start: 0, end: d };
  editor.select(p.start, Math.min(d, p.end)); updateTrim(); showPitches();
}
function scanPitches(item) {
  if (!item) return;
  if (angles.length > 1) { scan = null; showPitches(); return }          // several angles: they're lined up their own way
  scan = { forUrl: item.url, state: "busy", prog: 0, sel: 0 };
  const mine = scan; showPitches();
  mine.promise = findPitches(item.url, f => { if (scan === mine) { mine.prog = f; showPitches() } })
    .then(r => { if (scan !== mine) return; Object.assign(mine, r, { state: "done" }); editor.markers(r.pitches, r.cuts); if (r.pitches.length) pickPitch(0); else showPitches() })
    .catch(e => { console.warn("pitch finder", e); if (scan === mine) { mine.state = "done"; mine.pitches = []; showPitches() } });
}

// a camera cut inside the chosen window: keep the one shot with the most tracked frames (one skeleton never spans a cut)
function keepOneShot(m) {
  const d = m.diffs; if (!d) return m;
  const cuts = []; for (let i = 1; i < d.length; i++) if (d[i] > 16 && d[i] < 1e8) cuts.push(i);
  if (!cuts.length) return m;
  const bounds = [0, ...cuts, m.frames.length]; let best = [0, m.frames.length], bn = -1;
  for (let k = 0; k < bounds.length - 1; k++) { const a = bounds[k], b = bounds[k + 1], n = m.frames.slice(a, b).filter(Boolean).length; if (n > bn) { bn = n; best = [a, b] } }
  const [a, b] = best;
  return { ...m, frames: m.frames.slice(a, b), N: b - a, start: m.start + a / m.sampleFps, diffs: d.slice(a, b), cutTrimmed: cuts.length };
}
// ---------------------------------------------------------------- repeated frames
// A lot of slow-motion video online (and every screen recording) repeats frames: the same picture 2, 4 or 9 times,
// then a jump to the next real one. Tracked as they are, the skeleton freezes and jumps: freeze, jump, freeze, jump.
// Each frame gets a tiny greyscale fingerprint; a frame that barely differs from the one before it is a repeat, is
// not tracked, and is filled in smoothly from the real frames either side.
const SIG_W = 96, SIG_H = 54, sigCv = document.createElement("canvas"); sigCv.width = SIG_W; sigCv.height = SIG_H;
const sigG = sigCv.getContext("2d", { willReadFrequently: true });
function frameSig(v) { try { sigG.drawImage(v, 0, 0, SIG_W, SIG_H); const d = sigG.getImageData(0, 0, SIG_W, SIG_H).data, o = new Uint8Array(SIG_W * SIG_H); for (let i = 0; i < o.length; i++) o[i] = (d[i * 4] * 3 + d[i * 4 + 1] * 6 + d[i * 4 + 2]) / 10; return o } catch (e) { return null } }
const sigDiff = (a, b) => { if (!a || !b) return 1e9; let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length };
function repeatedFrames(diffs) {          // diffs[i]: change from the previous sampled frame
  const N = diffs.length, dup = new Array(N).fill(false);
  for (let i = 1; i < N; i++) {
    const w = []; for (let k = Math.max(1, i - 20); k <= Math.min(N - 1, i + 20); k++) if (diffs[k] > 0.15 && diffs[k] < 1e8) w.push(diffs[k]);
    w.sort((a, b) => a - b); const med = w.length ? w[w.length >> 1] : 1;
    dup[i] = diffs[i] < Math.max(0.12, 0.35 * med);
  }
  if (dup.filter(d => !d).length < Math.max(6, N * 0.08)) return new Array(N).fill(false);   // a still video: keep everything
  return dup;
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
  const sampleFps = Math.max(1, Math.min(native, 240, 1500 / Math.max(0.05, end - start))), N = Math.max(1, Math.min(1500, Math.floor((end - start) * sampleFps)));
  const seekTo = async i => { v.currentTime = start + (i + 0.5) / sampleFps; await once(v, "seeked") };
  const ts = k => Math.round(k * 1000 / sampleFps) + 1;
  // progress with a time estimate: pass 1 = 1 unit per frame, zoomed passes 3, backward passes 2
  const units = N * 6; let doneU = 0;
  const tick = (label, i) => { doneU++; if (doneU % 3 && i !== N - 1) return; say(`${label}: frame ${i + 1} of ${N}`, doneU / units) };
  // pass 1: the whole picture, every frame; pick out the pitcher if other people are in view
  const looks = Array.from({ length: N }, () => []), first = new Array(N).fill(null);
  let ref = null; const diffs = []; let prevSig = null;
  for (let i = 0; i < N; i++) {
    if (cancelled) throw new Error("cancelled");
    await seekTo(i);
    { const sg = frameSig(v); diffs.push(i ? sigDiff(sg, prevSig) : 1e9); prevSig = sg }
    const who = pickPitcher(finder.detect(v), null, W, H, ref);         // the pitcher among everyone in view
    const f = pickPitcher(full.detectForVideo(v, ts(i)), null, W, H, who || ref);
    if (f) { f.src = "full"; looks[i].push(f) }
    const id = who || f;
    if (id) { first[i] = id; ref = id }
    tick("Pass 1 of 3 · full picture", i);
  }
  const dup = repeatedFrames(diffs), nRep = dup.filter(Boolean).length;
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
    if (dup[i]) { tick("Pass 2 of 3 · zoomed in", i); tick("Pass 2 of 3 · zoomed in", i); tick("Pass 2 of 3 · zoomed in", i); continue }
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
    if (dup[i]) { tick("Pass 3 of 3 · backwards", k); tick("Pass 3 of 3 · backwards", k); continue }
    await seekTo(i);
    look(bA, i, k, cropAt(i, 1.4, false), true, "back"); tick("Pass 3 of 3 · backwards", k);
    look(bB, i, k, cropAt(i, 1.55, true), true, "backMirror"); tick("Pass 3 of 3 · backwards", k);
  }
  say("combining the seven passes", 1);
  await new Promise(r => setTimeout(r, 20));
  window.__lastLooks = { W, H, fps: sampleFps, looks };
  const frames = looks.map((c, i) => dup[i] ? null : fuseSoft(c, W, H, { k: 4, srcW: { stillClose: 0.3, stillWideMirror: 0.3, rtm: 3, rtmMirror: 3 } }));
  return { frames, N, sampleFps, W, H, start, label: "max accuracy", repeats: nRep, diffs };
}

// ---------------------------------------------------------------- results
function openResults(data, url, meta = {}) {
  if (viewer) { viewer.stop(); viewer = null }
  lastResult = { data, url, meta }; window.__lastData = data;
  const mount = $("viewerMount"); mount.innerHTML = ""; mount.append($("viewerTpl").content.cloneNode(true));
  $("resName").textContent = data.name || "Pitch";
  const dur = data.frames / data.fps;
  $("resMeta").textContent = `${data.throwHand === "L" ? "Left" : "Right"}-handed · ${data.frames} frames · ${Math.round(data.videoFps || data.fps)} fps${data.fps !== (data.videoFps || data.fps) ? ` (${Math.round(data.fps / data.videoFps)}× slow motion)` : ""}${data.slowNote && /chose/.test(data.slowNote) ? ` · ${data.slowNote}` : ""} · ${dur.toFixed(2)} s${data.quality ? ` · ${data.quality}` : ""}${data.cameras ? ` · 3D measured from ${data.cameras.length} angles (${data.cameras.map(c => c.label).join(", ")}), cameras agree within ${data.agreeCm} cm` : data.match ? ` · skeleton within ${data.match.medianCm} cm of the video` : ""}`;
  show("results");
  const onPhases = meta.raw ? (phases, frame) => {
    const d2 = tagResult(analyse(meta.raw, { hand: data.throwHand, phases }), data);
    if (meta.id != null) updateHistory(meta.id, d2);
    openResults(d2, url, { ...meta, startFrame: frame });
  } : null;
  $("phaseEditNote").hidden = !!onPhases;
  viewer = window.startViewer(data, url, { onPhases, startFrame: meta.startFrame });
  try {
    const box = $("report");
    if (box) {
      const draw = () => {
        box.innerHTML = reportHTML(buildReport(data));
        box.querySelectorAll(".rshow").forEach(b => b.onclick = () => { if (viewer && viewer.seek) { viewer.seek(+b.dataset.f); $("viewerMount").scrollIntoView({ behavior: "smooth", block: "start" }) } });
        const ls = box.querySelector("#repLevel");
        if (ls) ls.onchange = () => { data.level = ls.value; if (meta.id != null) updateHistory(meta.id, data); draw() };
        const vi = box.querySelector("#repVelo");
        if (vi) vi.onchange = () => { const v = parseFloat(vi.value); data.velo = v >= 30 && v <= 110 ? v : null; if (meta.id != null) updateHistory(meta.id, data); draw() };
      };
      draw();
    }
  } catch (e) { console.warn("report failed", e) }
}
$("pdfBtn").onclick = async () => {
  if (!lastResult) return;
  const b = $("pdfBtn"), label = b.textContent; b.disabled = true;
  try { await downloadPDF(lastResult.data, lastResult.url, msg => { b.textContent = msg || label }) }
  catch (e) { console.warn(e); alert("Couldn't make the PDF: " + (e.message || e)) }
  finally { b.disabled = false; b.textContent = label }
};
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
        try { const d = tagResult(analyse(it.raw, { hand: it.hand || "auto" }), it.data); data = d; updateHistory(it.id, d) } catch (e) { }
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
