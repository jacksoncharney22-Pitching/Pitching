// Builds the 3D skeleton (pipeline.js) off the page, so the page doesn't freeze while it works: after tracking, the
// skeleton maths took the page over for several seconds on a laptop (~20 s in a headless test browser, longer on a
// phone), and nothing on screen could move. Same code as on the page, so the results are the same.
// The page sends the lab libraries once; each request is { id, op: "analyse" | "slow", raw, o }.
const stamp = new URL(self.location.href).search;            // same ?v= as the page, so a new release isn't mixed with old files
let P = null;
const libs = {};
// While it works it says "still here" to the page now and then (a request's arrival and each skeleton stage, at most once a
// second), so the page can tell a slow phone from a worker the browser silently stopped (it then builds on the page).
const alive = id => self.postMessage({ id, alive: true });
self.onmessage = async ({ data: m }) => {
  alive(m.id);
  try {
    if (m.libs) Object.assign(libs, m.libs);                 // before the first await, so the libraries arrive in order
    if (!P) P = await import("./pipeline.js" + stamp);
    let r = null;
    if (m.op === "analyse") {
      const o = { ...m.o };
      let last = Date.now();
      o._snap = () => { const n = Date.now(); if (n - last > 1000) { last = n; alive(m.id) } };
      if (m.useArm && libs.armLib) o.armLib = libs.armLib;
      if (m.useBody && libs.bodyLib) { o.bodyLib = libs.bodyLib; o.bodyFit = true }
      r = P.analyse(m.raw, o);
    } else if (m.op === "slow") r = P.detectSlowFactor(m.raw);
    else if (m.op !== "libs") throw new Error("unknown request " + m.op);
    self.postMessage({ id: m.id, ok: true, r });
  } catch (e) { self.postMessage({ id: m.id, ok: false, err: String((e && e.message) || e) }) }
};
