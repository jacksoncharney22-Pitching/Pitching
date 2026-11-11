// Safari's engine only gives real pictures from a video element that is ON the page: a video made in code and never
// added (how the app reads frames for the pitch finder, tracking, thumbnails and the PDF) draws as solid black there
// (found 2026-11-10 in WebKit: every pixel 0 after a seek, so the pose model saw nobody, 0 of 45 looks). parkVideo puts
// such a video in a tiny, nearly invisible corner box so it draws properly in every browser. Only the newest few stay
// parked; older ones are taken off the page (the code that made them has long finished with them).
const KEEP = 6;
let box = null;
export function parkVideo(v) {
  try {
    if (!box || !box.isConnected) {
      box = document.createElement("div"); box.id = "vidPark"; box.setAttribute("aria-hidden", "true");
      box.style.cssText = "position:fixed;left:0;bottom:0;width:2px;height:2px;overflow:hidden;opacity:0.01;pointer-events:none;z-index:-1";
      document.body.appendChild(box);
    }
    v.style.cssText = "width:2px;height:2px"; v.setAttribute("tabindex", "-1");
    box.appendChild(v);
    while (box.children.length > KEEP) box.firstElementChild.remove();
  } catch (e) {}
  return v;
}

// Safari's engine (WebKit, seen on Linux in our tests 2026-11-10) gives real pictures to only ONE video element at a time:
// while the trim player, the Recent list's little previews or the trim thumbnails hold a video, the copy the app reads
// frames from draws solid black, so the pose model sees nobody. soloVideo(v) checks for that once (only when the frame
// comes out pure black while other videos are loaded): it lets go of the other videos, looks again, and if the picture
// appears, remembers that this browser needs it and keeps them released until the reading is done (doneVideo puts the
// visible ones back where they were). In browsers without the rule nothing is touched. `?onevideo=1` fakes the rule in
// Chromium for the tests (a frame reads as black while any other video is loaded).
let oneVideo;                                                // undefined = not checked yet, true/false = known
const fake = typeof location !== "undefined" && /[?&]onevideo=1/.test(location.search);
function loadedOthers(v) { return [...document.querySelectorAll("video")].filter(e => e !== v && e.getAttribute("src")) }
function pixelSum(v) {
  try {
    if (fake && loadedOthers(v).length) return 0;
    const c = document.createElement("canvas"); c.width = c.height = 8;
    const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(v, 0, 0, 8, 8);
    const d = g.getImageData(0, 0, 8, 8).data; let s = 0;
    for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
    return s;
  } catch (e) { return -1 }                                   // can't tell: treat as fine
}
function releaseOthers(v) {
  const back = [];
  for (const e of loadedOthers(v)) {
    const parked = !!(box && box.contains(e));                // old reading copies / thumbnail video: they reload on their own when needed
    if (!parked) {
      back.push({ e, src: e.getAttribute("src"), t: e.currentTime || 0 });
      // the trim player re-reads the clip when it (re)loads (resets the trim, restarts the pitch finder): keep its
      // handlers aside while it's let go and put them back once it has loaded again
      if (!e.__vpH) e.__vpH = { lm: e.onloadedmetadata, er: e.onerror };
      e.onloadedmetadata = e.onerror = null;
    }
    try { e.pause(); e.removeAttribute("src"); e.load() } catch (x) {}
  }
  return () => {
    for (const b of back) {
      const e = b.e;
      if (!e.isConnected || e.getAttribute("src")) { e.__vpH = null; continue }   // gone, or the app already gave it a new video
      const back = () => { const h = e.__vpH; e.__vpH = null; if (h && !e.onloadedmetadata && !e.onerror) { e.onloadedmetadata = h.lm; e.onerror = h.er } };
      e.addEventListener("loadedmetadata", () => { try { if (b.t > 0) e.currentTime = b.t } catch (x) {} back() }, { once: true });
      e.addEventListener("error", back, { once: true });
      try { e.src = b.src } catch (x) {}
    }
  };
}
const seekTo = (v, t) => new Promise(res => { const done = () => { v.removeEventListener("seeked", done); res() }; v.addEventListener("seeked", done); setTimeout(done, 8000); try { v.currentTime = t } catch (e) { done() } });
// once the rule is known, readers take turns (pitch finder, tracking, trim thumbnails, PDF frames): each waits for the one
// before. A turn's end lets go of the reader's video, gives the others back and lets the next reader in.
let chain = Promise.resolve();
const noop = () => {};
async function take(v) {
  const prev = chain; let unlock; chain = new Promise(r => unlock = r);
  await prev;
  (window.__soloDbg = window.__soloDbg || []).push({ known: oneVideo, others: loadedOthers(v).map(e => e.id || e.parentNode && e.parentNode.id || "?") });   // for finder_check / CI
  if (oneVideo === false || !loadedOthers(v).length && oneVideo !== true) { unlock(); return noop }
  if (oneVideo === undefined && !(await needsSolo(v))) { unlock(); return noop }
  const restore = releaseOthers(v);
  return () => { try { v.pause(); v.removeAttribute("src"); v.load() } catch (e) {} restore(); unlock() };
}
// the first time only: is this video's picture black while other videos are loaded, and fine once they're let go?
async function needsSolo(v) {
  const dur = v.duration || 0, t0 = v.currentTime;
  await seekTo(v, dur > 0 ? dur * 0.5 : 0);
  let solo = false; const dbg = window.__soloDbg[window.__soloDbg.length - 1], s1 = dbg.sum1 = pixelSum(v);
  if (s1 !== 0) { if (!fake) oneVideo = false }
  else {
    const restore = releaseOthers(v);
    await seekTo(v, dur > 0 ? dur * 0.45 : 0);
    solo = (dbg.sum2 = pixelSum(v)) > 0;
    restore();                                                // just a black frame (a fade-in, a dark clip) if not solo
    if (solo) { oneVideo = true; window.__oneVideo = true }
  }
  await seekTo(v, t0);
  return solo;
}
export async function soloTurn(v) { return oneVideo === false ? noop : take(v) }
// a reading video for the finder/tracking/PDF: its turn ends with doneVideo(v)
export async function soloVideo(v) { v.__end = await soloTurn(v); return v }
// the app has finished reading frames from v: let go of it and give the other videos back
export function doneVideo(v) {
  try { v.pause(); v.removeAttribute("src"); v.load() } catch (e) {}
  const e = v.__end; v.__end = null;
  if (e) e();
}
