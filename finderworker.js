// The pitch finder's pose model, run in a background worker so the page doesn't freeze at every look it takes
// (reading the pose back from the graphics chip blocks whatever thread runs the model). The page still seeks the
// video and sends each look here as a picture; this only runs the model and sends the joints back.
// If anything here fails, the page falls back to running the model itself, as it always did.

// MediaPipe loads its runtime with importScripts, which module workers don't have: fetch it and run it at global scope
self.importScripts = (...urls) => {
  for (const u of urls) {
    const x = new XMLHttpRequest(); x.open("GET", u, false); x.send();
    if (x.status && x.status >= 400) throw new Error("couldn't load " + u);
    (0, eval)(x.responseText);
  }
};

const stamp = new URL(self.location.href).search;            // same ?v= as the page, so a new release isn't mixed with old files
let PL = null, fileset = null, bytes = null, tr = null;

async function make() {
  if (tr) { try { tr.close() } catch (e) {} tr = null }
  const mk = delegate => PL.createFromOptions(fileset, {
    baseOptions: { modelAssetBuffer: bytes.slice(), delegate },
    runningMode: "VIDEO", numPoses: 1, minPoseDetectionConfidence: 0.3, minPosePresenceConfidence: 0.3, minTrackingConfidence: 0.3,
  });
  try { tr = await mk("GPU") } catch (e) { tr = await mk("CPU") }
}

self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === "init") {
      PL = (await import("./lib/vision_bundle.mjs" + stamp)).PoseLandmarker;
      fileset = { wasmLoaderPath: m.base + "wasm/vision_wasm_internal.js", wasmBinaryPath: m.base + "wasm/vision_wasm_internal.wasm" };
      bytes = m.bytes; await make();
      self.postMessage({ id: m.id, ok: true });
    } else if (m.type === "reset") {                     // a camera cut: start the model's tracking afresh
      await make(); self.postMessage({ id: m.id, ok: true });
    } else if (m.type === "detect") {
      const r = tr.detectForVideo(m.bitmap, m.ts); m.bitmap.close();
      const L = r.landmarks && r.landmarks[0];
      self.postMessage({ id: m.id, ok: true, L: L ? L.map(q => [q.x, q.y]) : null });
    } else if (m.type === "close") {
      if (tr) { try { tr.close() } catch (e) {} tr = null }
      self.postMessage({ id: m.id, ok: true }); self.close();
    }
  } catch (e) { self.postMessage({ id: m.id, ok: false, err: String(e && e.message || e) }) }
};
