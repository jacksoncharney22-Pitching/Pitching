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
