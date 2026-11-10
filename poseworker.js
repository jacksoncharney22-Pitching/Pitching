// MediaPipe pose models (the pitch finder's and the Fast/High tracker's), run in a background worker so the page doesn't
// freeze at every frame (reading the pose back from the graphics chip blocks whatever thread runs the model). The page
// still seeks the video and sends each frame here as a picture; this only runs the model(s) and sends the joints back.
// A worker can hold several models (High runs three: full picture, zoomed crop, mirrored crop), each by its key.
// If anything here fails, the page falls back to running the models itself, as it always did.

// MediaPipe loads its runtime with importScripts, which module workers don't have: fetch it and run it at global scope
self.importScripts = (...urls) => {
  for (const u of urls) {
    const x = new XMLHttpRequest(); x.open("GET", u, false); x.send();
    if (x.status && x.status >= 400) throw new Error("couldn't load " + u);
    (0, eval)(x.responseText);
  }
};

const stamp = new URL(self.location.href).search;            // same ?v= as the page, so a new release isn't mixed with old files
let PL = null, fileset = null;
const models = new Map();                                   // key -> { bytes, mode, poses, tr }

async function make(key) {
  const m = models.get(key);
  if (m.tr) { try { m.tr.close() } catch (e) {} m.tr = null }
  const mk = delegate => PL.createFromOptions(fileset, {
    baseOptions: { modelAssetBuffer: m.bytes.slice(), delegate },
    runningMode: m.mode, numPoses: m.poses, minPoseDetectionConfidence: 0.3, minPosePresenceConfidence: 0.3, minTrackingConfidence: 0.3,
  });
  if (m.cpu) { m.tr = await mk("CPU"); return }
  try { m.tr = await mk("GPU") } catch (e) { m.cpu = true; m.tr = await mk("CPU") }
}
// Safari's engine (seen in WebKit 2026-11-10) can START the graphics-chip model in a worker but not run it ("GLctx is
// undefined" at the first picture): then that model is rebuilt on the processor setting and the same picture is tried
// again, so the model stays off the page (the page would freeze at every look) instead of the whole run falling back.
const fakeGpuFail = /[?&]gpufail=1/.test(stamp);          // tests: act like that engine (finder_check.py --gpufail)
function run(x, m) {
  if (fakeGpuFail && !x.cpu) throw new Error("undefined is not an object (evaluating 'GLctx.activeTexture') [test]");
  return x.mode === "IMAGE" ? x.tr.detect(m.bitmap) : x.tr.detectForVideo(m.bitmap, m.ts);
}

self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === "init") {
      if (!PL) {
        PL = (await import("./lib/vision_bundle.mjs" + stamp)).PoseLandmarker;
        fileset = { wasmLoaderPath: m.base + "wasm/vision_wasm_internal.js", wasmBinaryPath: m.base + "wasm/vision_wasm_internal.wasm" };
      }
      // VIDEO follows the motion frame to frame; IMAGE (Max's pitcher finder, still looks) judges each picture fresh
      models.set(m.key, { bytes: m.bytes, mode: m.mode || "VIDEO", poses: m.poses || 1, tr: null }); await make(m.key);
      self.postMessage({ id: m.id, ok: true });
    } else if (m.type === "reset") {                     // a camera cut: start the model's tracking afresh
      await make(m.key); self.postMessage({ id: m.id, ok: true });
    } else if (m.type === "detect") {
      const x = models.get(m.key); let r;
      try { r = run(x, m) }
      catch (e) { if (x.cpu) throw e; x.cpu = true; self.__gpuFailed = String(e && e.message || e); await make(m.key); r = run(x, m) }
      m.bitmap.close();
      const plain = a => a ? a.map(p => p.map(q => ({ x: q.x, y: q.y, z: q.z, visibility: q.visibility }))) : [];
      self.postMessage({ id: m.id, ok: true, cpu: !!x.cpu, r: { landmarks: plain(r.landmarks), worldLandmarks: plain(r.worldLandmarks) } });
    } else if (m.type === "close") {
      for (const x of models.values()) if (x.tr) { try { x.tr.close() } catch (e) {} }
      models.clear(); self.postMessage({ id: m.id, ok: true }); self.close();
    }
  } catch (e) { self.postMessage({ id: m.id, ok: false, err: String(e && e.message || e) }) }
};
