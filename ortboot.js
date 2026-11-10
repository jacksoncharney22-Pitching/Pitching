// Feole Pitching: starts onnxruntime-web (the engine that runs the stronger body tracker and the learned 3D model).
// Shared by rtm.js and lifter.js so both use one copy, set up once.
//
// Without a graphics chip the models run on the processor (WebAssembly), and on the page that froze it for seconds at a
// time. onnxruntime's "proxy" runs the same code in a background worker instead (same numbers, page stays responsive).
// But if that worker can't start on some phone or browser, the stronger tracker and the learned 3D would quietly drop
// out. So the worker is tried first with a tiny test model (a few bytes, time-limited); if it fails or doesn't answer,
// onnxruntime is loaded again fresh without the worker, exactly as before. `window.__ortProxy` says what happened.
// Only the stronger body tracker (Max accuracy) asks for the worker: that's where the freeze was (17 s). The learned 3D
// model alone hardly freezes the page (0.1 s) and starts 1-2 s slower with the worker, so Fast/High keep it on the page.
// Whoever starts onnxruntime first decides (in Max the tracker always loads before the learned 3D).
// `?ortproxy=0` turns the worker off.

// a one-step model (y = -x), 62 bytes: enough to make onnxruntime start its worker and answer
const TINY = "CAcSADoyCgsKAXgSAXkiA05lZxIBdFoPCgF4EgoKCAgBEgQKAggBYg8KAXkSCgoICAESBAoCCAFCBAoAEA0=";
const PROXY_WAIT = 30000;                        // a worker that hasn't answered in 30 s is treated as not working

function addScript(src) {
  return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("couldn't load " + src)); document.head.append(s) });
}
function setup(wasmPaths, threads) { window.ort.env.wasm.wasmPaths = wasmPaths; window.ort.env.wasm.numThreads = threads }
async function tryProxy() {
  const bytes = Uint8Array.from(atob(TINY), c => c.charCodeAt(0));
  const test = (async () => {
    const s = await window.ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
    const out = await s.run({ x: new window.ort.Tensor("float32", new Float32Array([2]), [1]) });
    if (out.y.data[0] !== -2) throw new Error("test model gave a wrong answer");
    try { await s.release() } catch (e) {}
  })();
  let timer;
  const late = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("background worker didn't answer")), window.__ortProxyWait || PROXY_WAIT) });
  try { await Promise.race([test, late]) } finally { clearTimeout(timer) }
}

let boot = null;
// src: the onnxruntime script; wasmPaths: where its .wasm files are. Returns once window.ort is ready to create sessions.
// The first caller's script is the one used (the bundled copy and the CDN copy are the same version).
export function ortReady(src, wasmPaths, threads, wantProxy = false) {
  if (boot) return boot;
  boot = (async () => {
    if (!window.ort) await addScript(src);
    setup(wasmPaths, threads);
    let gpu = null;
    try { gpu = navigator.gpu ? await navigator.gpu.requestAdapter().catch(() => null) : null } catch (e) {}
    if (gpu) { window.__ortProxy = { on: false, why: "graphics chip" }; return }      // WebGPU already runs off the page
    if (!wantProxy) { window.__ortProxy = { on: false, why: "not needed" }; return }
    if (/[?&]ortproxy=0/.test(location.search)) { window.__ortProxy = { on: false, why: "turned off" }; return }
    window.ort.env.wasm.proxy = true;
    const t0 = performance.now();
    try {
      await tryProxy();
      window.__ortProxy = { on: true, ms: Math.round(performance.now() - t0) };
    } catch (e) {
      // onnxruntime can't be started a second time once a start has failed, so load a fresh copy without the worker
      await addScript(src);
      setup(wasmPaths, threads);
      window.ort.env.wasm.proxy = false;
      window.__ortProxy = { on: false, why: "background worker failed: " + (e && e.message || e), fellBack: true };
      console.warn("Feole: onnxruntime background worker failed, running on the page instead:", e);
    }
  })();
  boot.catch(() => { boot = null });
  return boot;
}
