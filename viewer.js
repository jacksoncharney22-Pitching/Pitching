// Charney Pitching — 3D skeleton viewer component (uses global THREE + OrbitControls)
window.startViewer = function startViewer(DATA, videoSrc, opts = {}) {
const AC = new AbortController();
let alive = true;
const T = DATA.frames, FPS = DATA.fps, PH = DATA.phases, M = DATA.metrics;
const AB = { "Start": "S", "Peak leg lift": "LL", "Foot strike": "FS", "Arm cocked": "AC", "Release": "R", "Finish": "F" };
const KEYPH = PH.filter(p => !["Start", "Finish"].includes(p.name));
const relF = PH.find(p => p.name === "Release").frame;
const BLUR = [relF - 1, relF + 1];
const LH = DATA.throwHand === "L";
const MIRJ = j => { const p = {1:4,2:5,3:6,7:8,9:10,11:12,13:14,15:16,17:18,19:20,21:22,23:24,25:26,27:28,29:30,31:32}; for (const k in p) { if (+k === j) return p[k]; if (p[k] === j) return +k } return j };
const m = j => LH ? MIRJ(j) : j;          // throwing-side / lead-side indices for left-handers
const WRIST = m(16);
const T0 = DATA.start || 0, VFPS = DATA.videoFps || FPS;
const PINK = 0xff6fae, CYAN = 0x62d0ff, AMBER = 0xffb347;

// rotation speeds (deg/s) derived from rotation angles
function speedOf(arr) {
  const v = arr.map((_, i) => (arr[Math.min(T - 1, i + 1)] - arr[Math.max(0, i - 1)]) / ((Math.min(T - 1, i + 1) - Math.max(0, i - 1)) / FPS));
  return v.map((_, i) => (v[Math.max(0, i - 1)] + 2 * v[i] + v[Math.min(T - 1, i + 1)]) / 4);
}
M.pelvisSpd = speedOf(M.pelvisRot); M.trunkSpd = speedOf(M.trunkRot);

// metric catalogue: label, unit, group, short definition
const MET = {
  throwElbow: ["Elbow flexion", "°", "Throwing arm", "0° is a straight arm."],
  throwAbd: ["Shoulder abduction", "°", "Throwing arm", "Upper arm vs the side of the trunk. 90° puts the elbow at shoulder height."],
  throwER: ["Layback (modelled)", "°", "Throwing arm", "Shoulder external rotation. Shaped to a typical pitching layback: this 30 fps single-camera video can't show the forearm laying back."],
  throwHorz: ["Horizontal abduction", "°", "Throwing arm", "Elbow behind (+) or in front of (−) the chest line. Shown when the arm is raised."],
  gloveElbow: ["Elbow flexion", "°", "Glove arm", ""],
  gloveAbd: ["Shoulder abduction", "°", "Glove arm", ""],
  leadHip: ["Hip flexion", "°", "Lead leg", "Thigh vs the line of the trunk. 90° is a thigh lifted level."],
  leadKnee: ["Knee flexion", "°", "Lead leg", "0° is a straight leg. Firming up after foot strike gives the body something to rotate over."],
  backHip: ["Hip flexion", "°", "Back leg", ""],
  backKnee: ["Knee flexion", "°", "Back leg", ""],
  pelvisRot: ["Rotation", "°", "Pelvis", `Direction the hips face, seen from above. 0° = ${LH ? "first" : "third"}-base side, 90° = home plate.`],
  pelvisTilt: ["Lateral tilt", "°", "Pelvis", "Hip line vs level. Positive means the lead hip is higher."],
  pelvisSpd: ["Rotation speed", "°/s", "Pelvis", ""],
  trunkRot: ["Rotation", "°", "Trunk", "Direction the shoulders face, on the same scale as the pelvis."],
  trunkFwd: ["Forward tilt", "°", "Trunk", "Lean toward home plate. Negative leans back toward second base."],
  trunkLat: ["Lateral tilt", "°", "Trunk", "Side bend. Positive leans toward the glove side."],
  trunkSpd: ["Rotation speed", "°/s", "Trunk", ""],
  separation: ["Hip–shoulder separation", "°", "Trunk", "How far the hips have turned ahead of the shoulders."],
};
const GROUPS = ["Throwing arm", "Glove arm", "Lead leg", "Back leg", "Pelvis", "Trunk"];
const GCOL = { "Pelvis": "var(--pelvis)", "Trunk": "var(--trunk)", "Throwing arm": "var(--throw)", "Glove arm": "var(--glove)", "Lead leg": "var(--glove)", "Back leg": "var(--throw)" };
function valAt(arr, ft) {
  const a = Math.max(0, Math.min(T - 1, Math.floor(ft))), b = Math.min(T - 1, a + 1), t = ft - a;
  if (arr[a] == null || arr[b] == null) return arr[Math.round(ft)] ?? null;
  return arr[a] + (arr[b] - arr[a]) * t;
}
const fmt = (v, u) => v == null ? "—" : (u === "°/s" ? Math.round(v).toLocaleString("en-US") : (Math.round(v * 10) / 10).toFixed(0)) + u;

// ---------- state & video ----------
const state = { f: 0, playing: true, rate: 0.5, overlay: true, path: true, ghosts: false, angleMode: "key", follow: false, ovAngles: true, style: "mocap", clock: 0, videoOK: true, vFrame: null };
const video = document.getElementById("video");
video.loop = false; video.src = videoSrc; video.currentTime = T0 + 0.5 / VFPS;
video.playbackRate = state.rate;
video.addEventListener("error", () => { state.videoOK = false });
{ const p = video.play(); if (p && p.catch) p.catch(() => {}) }

// ---------- skeleton kinematics ----------
// tree: -2 = hip-centre root, -1 = shoulder-centre
const TREE = [[-2,23],[-2,24],[-2,-1],[-1,11],[-1,12],[11,13],[13,15],[15,17],[15,19],[15,21],[12,14],[14,16],[16,18],[16,20],[16,22],[23,25],[25,27],[27,29],[27,31],[24,26],[26,28],[28,30],[28,32]];
const BL = {}; TREE.forEach(([a, b]) => BL[a + "," + b] = DATA.bones[a + "," + b]);
const V3 = THREE.Vector3;
function cr(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
const POSE = { j: Array.from({ length: 33 }, () => new V3()), hip: new V3(), sh: new V3() };
function computePose(ft) {
  ft = Math.max(0, Math.min(T - 1, ft));
  const i = Math.floor(ft), t = ft - i, c = k => Math.max(0, Math.min(T - 1, k));
  const A = DATA.pose[c(i - 1)], B = DATA.pose[c(i)], C = DATA.pose[c(i + 1)], D = DATA.pose[c(i + 2)];
  const raw = [];
  for (let j = 0; j < 33; j++) raw.push(new V3(cr(A[j][0], B[j][0], C[j][0], D[j][0], t), cr(A[j][1], B[j][1], C[j][1], D[j][1], t), cr(A[j][2], B[j][2], C[j][2], D[j][2], t)));
  const node = (P, k) => k === -2 ? P[23].clone().add(P[24]).multiplyScalar(.5) : k === -1 ? P[11].clone().add(P[12]).multiplyScalar(.5) : P[k];
  const out = { "-2": node(raw, -2) };
  TREE.forEach(([a, b]) => {
    const d = node(raw, b).clone().sub(node(raw, a)).normalize();
    out[b] = out[a].clone().addScaledVector(d, BL[a + "," + b]);
  });
  const off = out[-1].clone().sub(node(raw, -1));
  for (let k = 0; k < 33; k++) POSE.j[k].copy(k <= 10 ? raw[k].clone().add(off) : out[k]);
  POSE.hip.copy(out[-2]); POSE.sh.copy(out[-1]);
  return POSE;
}

// ---------- 3D scene ----------
const panel = document.getElementById("threePanel");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
if ("outputEncoding" in renderer) renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
panel.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.Fog(0x000000, 7, 15);
const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 100);
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.1; controls.minDistance = 1.2; controls.maxDistance = 12;
controls.maxPolarAngle = Math.PI * 0.495;
const travel = DATA.pose[T - 1][23][0];
const TARGET = new V3((DATA.pose[0][23][0] + DATA.pose[T - 1][23][0]) / 2, 0.95, 0);
controls.target.copy(TARGET);

scene.add(new THREE.HemisphereLight(0xffffff, 0x202020, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 1.0);
key.position.set(1.5, 5, 3); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048); key.shadow.radius = 6; key.shadow.bias = -0.0005;
Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 12 });
key.target.position.set(travel * 0.5, 0, 0); scene.add(key, key.target);
const rim = new THREE.DirectionalLight(0xcfe3ff, 0.55); rim.position.set(-3, 2.5, -3); scene.add(rim);
const fill = new THREE.DirectionalLight(0xffffff, 0.25); fill.position.set(2, 1, -2); scene.add(fill);

// mound: soft radial dirt disc fading into black, with a flat-topped rubber
function radialTex() {
  const c = document.createElement("canvas"); c.width = c.height = 512; const g = c.getContext("2d");
  const gr = g.createRadialGradient(256, 256, 20, 256, 256, 256);
  gr.addColorStop(0, "#3a3a3a"); gr.addColorStop(0.55, "#262626"); gr.addColorStop(1, "#000000");
  g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
  return new THREE.CanvasTexture(c);
}
// mound surface: flat table around the rubber, sloping down toward home to the landing spot
const DROP = DATA.moundDrop, LAND = DATA.landX, SLOPE0 = 0.2, SLOPE1 = Math.max(SLOPE0 + 0.2, LAND - 0.12);
function groundAt(x) { return x <= SLOPE0 ? DROP : x >= SLOPE1 ? 0 : DROP * (1 - (x - SLOPE0) / (SLOPE1 - SLOPE0)) }
const MCX = 0.9;
const moundGeo = new (THREE.PlaneBufferGeometry || THREE.PlaneGeometry)(6.4, 6.4, 160, 160);
moundGeo.rotateX(-Math.PI / 2);
{ const pos = moundGeo.attributes.position; for (let i = 0; i < pos.count; i++) pos.setY(i, groundAt(pos.getX(i) + MCX)); moundGeo.computeVertexNormals() }
const mound = new THREE.Mesh(moundGeo, new THREE.MeshStandardMaterial({ map: radialTex(), roughness: 1 }));
mound.position.set(MCX, 0, 0); mound.receiveShadow = true; scene.add(mound);
const rubberTop = DATA.rubberTop;
const rubber = new THREE.Mesh(new THREE.BoxGeometry(0.152, rubberTop + 0.01, 0.61), new THREE.MeshStandardMaterial({ color: 0xe9e9e6, roughness: .6 }));
rubber.position.set(DATA.rubber[0], DROP + (rubberTop - 0.01) / 2, DATA.rubber[1]); rubber.castShadow = rubber.receiveShadow = true; scene.add(rubber);
// direction to home plate
const arrowMat = new THREE.MeshBasicMaterial({ color: 0x5a5a5a });
const arrow = new THREE.Group();
const shaft = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.02), arrowMat); shaft.position.x = 0.35; arrow.add(shaft);
const headG = new THREE.BufferGeometry(); headG.setAttribute("position", new THREE.Float32BufferAttribute([0.7, 0.05, 0, 0.7, -0.05, 0, 0.82, 0, 0], 3));
arrow.add(new THREE.Mesh(headG, arrowMat));
arrow.rotation.x = -Math.PI / 2; arrow.position.set(travel + 0.9, 0.004, -1.0); scene.add(arrow);
const plateLbl = (() => {
  const c = document.createElement("canvas"); c.width = 512; c.height = 96; const g = c.getContext("2d");
  g.fillStyle = "#7a7a7a"; g.font = "500 46px 'IBM Plex Mono', monospace"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("TO HOME PLATE", 256, 48);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthWrite: false, fog: false }));
  s.scale.set(0.9, 0.17, 1); s.position.set(travel + 1.3, 0.14, -1.0); scene.add(s); return s;
})();

// ---- figure: clean white line skeleton ----
// the skeleton itself is drawn as crisp 2D lines (see drawSkeleton2D); these meshes only cast its soft shadow
const boneMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
const figure = new THREE.Group(); scene.add(figure);
const UPV = new V3(0, 1, 0);
const SBONES = [[11,13],[13,15],[15,19],[12,14],[14,16],[16,20],[11,12],[23,24],
  [23,25],[25,27],[27,29],[29,31],[27,31],[24,26],[26,28],[28,30],[30,32],[28,32]];
const SJOINTS = [11,12,13,14,15,16,23,24,25,26,27,28];
const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 12), ballGeo = new THREE.SphereGeometry(1, 20, 14);
function part(geo) { const m = new THREE.Mesh(geo, boneMat); m.castShadow = true; figure.add(m); return m }
const boneMeshes = SBONES.map(() => part(cylGeo));
const spine = part(cylGeo), neck = part(cylGeo);
const jointMeshes = SJOINTS.map(() => part(ballGeo));
const headBall = part(ballGeo); headBall.scale.setScalar(0.085);
const vA = new V3();
function placeBone(m, a, b, r) {
  vA.subVectors(b, a); const len = vA.length(); if (len < 1e-5) return;
  m.position.copy(a).addScaledVector(vA, 0.5); m.quaternion.setFromUnitVectors(UPV, vA.divideScalar(len)); m.scale.set(r, len, r);
}
function drawFigure(P) {
  const J = P.j;
  SBONES.forEach(([a, b], i) => placeBone(boneMeshes[i], J[a], J[b], 0.02));
  const headC = J[7].clone().add(J[8]).multiplyScalar(0.5);
  placeBone(spine, P.hip, P.sh, 0.015); placeBone(neck, P.sh, headC, 0.013);
  SJOINTS.forEach((j, i) => { jointMeshes[i].position.copy(J[j]); jointMeshes[i].scale.setScalar(j === 15 || j === 16 ? 0.024 : 0.021) });
  headBall.position.copy(headC);
}

// ---- 2D line skeleton projected from the 3D pose: curved spine, collarbones, pelvis, dotted head ----
const skel = document.getElementById("skel"), sg = skel.getContext("2d");
const pj = new V3();
function toScreen(v) { pj.copy(v).project(camera); return [(pj.x + 1) / 2 * skel.width, (1 - pj.y) / 2 * skel.height, pj.z] }
// sparse dotted head shell (unit points on an ellipsoid, oriented by the face each frame)
const HEAD_DOTS = (() => { const n = 34, pts = [], g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) { const y = 1 - (i / (n - 1)) * 2, r = Math.sqrt(1 - y * y), th = g * i; pts.push([Math.cos(th) * r, y, Math.sin(th) * r]) }
  return pts.filter(p => p[1] > -0.55); })();          // leave the jaw/neck area open
const FACE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
function bez(p0, p1, p2, p3, u) { const v = 1 - u; return p0.clone().multiplyScalar(v*v*v).addScaledVector(p1, 3*v*v*u).addScaledVector(p2, 3*v*u*u).addScaledVector(p3, u*u*u) }
function drawMocap(P) {
  const dpr = skel.width / Math.max(1, panel.clientWidth);
  sg.clearRect(0, 0, skel.width, skel.height);
  const J = P.j, W = 2.2 * dpr, FA = 0.5;
  const camDist = v => camera.position.distanceTo(v);
  const leftFar = camDist(J[11]) + camDist(J[23]) > camDist(J[12]) + camDist(J[24]);
  const far = j => j !== 0 && j <= 32 && ((j % 2 === 1) === leftFar);
  const S = {}; for (let j = 0; j < 33; j++) S[j] = toScreen(J[j]);
  const ear = toScreen(J[7].clone().add(J[8]).multiplyScalar(0.5)), shm = toScreen(P.sh);
  sg.lineCap = "round"; sg.lineJoin = "round"; sg.strokeStyle = "#fff"; sg.fillStyle = "#fff";
  const seg = (a, b, al) => { sg.globalAlpha = al; sg.lineWidth = W; sg.beginPath(); sg.moveTo(a[0], a[1]); sg.lineTo(b[0], b[1]); sg.stroke() };
  const BONES = [[11,13],[13,15],[15,19],[12,14],[14,16],[16,20],[23,25],[25,27],[27,29],[29,31],[27,31],[24,26],[26,28],[28,30],[30,32],[28,32],[11,23],[12,24],[11,12],[23,24]];
  BONES.map(([a, b]) => ({ a, b, al: far(a) && far(b) ? FA : 1 })).sort((x, y) => x.al - y.al).forEach(s => seg(S[s.a], S[s.b], s.al));
  seg(shm, ear, 0.9);
  [11,12,13,14,15,16,23,24,25,26,27,28,29,30,31,32].forEach(j => { sg.globalAlpha = far(j) ? FA + 0.1 : 1; sg.beginPath(); sg.arc(S[j][0], S[j][1], (j >= 29 ? 2.2 : 3.0) * dpr, 0, 7); sg.fill() });
  [0,1,2,3,4,5,6,7,8,9,10].forEach(j => { sg.globalAlpha = 1; sg.beginPath(); sg.arc(S[j][0], S[j][1], (j === 0 || j === 7 || j === 8 ? 3.0 : 2.2) * dpr, 0, 7); sg.fill() });
  sg.globalAlpha = 1;
}
function drawSkeleton2D(P) {
  if (state.style === "mocap") return drawMocap(P);
  const dpr = skel.width / Math.max(1, panel.clientWidth);
  sg.clearRect(0, 0, skel.width, skel.height);
  const J = P.j, W = 2.0 * dpr;
  const camDist = v => camera.position.distanceTo(v);
  const leftFar = camDist(J[11]) + camDist(J[23]) > camDist(J[12]) + camDist(J[24]);
  const far = j => j !== 0 && ((j % 2 === 1) === leftFar);      // odd landmarks are the left side
  // trunk frame
  const d = P.sh.clone().sub(P.hip), Ltr = d.length(); d.normalize();
  const shR = J[12].clone().sub(J[11]).normalize(), hpR = J[24].clone().sub(J[23]).normalize();
  const chestF = new V3().crossVectors(d, shR).normalize();
  const pelUp = UPV.clone().multiplyScalar(0.5).addScaledVector(d, 0.5).normalize();
  const pelF = new V3().crossVectors(pelUp, hpR).normalize();
  // spine sits behind the joint line; gentle curve, lumbar more upright than the thoracic spine
  const base = P.hip.clone().addScaledVector(pelF, -0.035);
  const neckB = P.sh.clone().addScaledVector(chestF, -0.03).addScaledVector(d, 0.025);
  const c1 = base.clone().addScaledVector(pelUp, Ltr * 0.38);
  const c2 = neckB.clone().addScaledVector(d, -Ltr * 0.36).addScaledVector(chestF, -0.025);
  const spinePts = []; for (let i = 0; i <= 14; i++) spinePts.push(bez(base, c1, c2, neckB, i / 14));
  const sternum = P.sh.clone().addScaledVector(chestF, 0.02).addScaledVector(d, -0.01);
  // head frame from the face landmarks
  const earMid = J[7].clone().add(J[8]).multiplyScalar(0.5);
  const hX = J[8].clone().sub(J[7]).normalize();
  const hF = J[0].clone().sub(earMid); hF.addScaledVector(hX, -hF.dot(hX)).normalize();
  const hU = new V3().crossVectors(hX, hF).normalize();
  const headC = earMid.clone().addScaledVector(hU, 0.025).addScaledVector(hF, 0.012);
  const skullBase = earMid.clone().addScaledVector(hU, -0.035).addScaledVector(hF, -0.01);

  const S = v => toScreen(v);
  sg.lineCap = "round"; sg.lineJoin = "round"; sg.strokeStyle = "#ffffff"; sg.fillStyle = "#ffffff";
  function line(a, b, alpha, w = W) { const A = S(a), B = S(b); sg.globalAlpha = alpha; sg.lineWidth = w; sg.beginPath(); sg.moveTo(A[0], A[1]); sg.lineTo(B[0], B[1]); sg.stroke() }
  function poly(pts, alpha, w = W) { sg.globalAlpha = alpha; sg.lineWidth = w; sg.beginPath(); pts.forEach((p, i) => { const q = S(p); i ? sg.lineTo(q[0], q[1]) : sg.moveTo(q[0], q[1]) }); sg.stroke() }
  function dot(v, r, alpha) { const q = S(v); sg.globalAlpha = alpha; sg.beginPath(); sg.arc(q[0], q[1], r, 0, Math.PI * 2); sg.fill() }
  const FA = 0.45;
  // far-side limbs first so the near side reads on top
  const limbs = side => side === "L"
    ? [[11, 13], [13, 15], [15, 17, .7], [15, 19, .7], [15, 21, .7], [23, 25], [25, 27], [27, 29], [29, 31], [27, 31]]
    : [[12, 14], [14, 16], [16, 18, .7], [16, 20, .7], [16, 22, .7], [24, 26], [26, 28], [28, 30], [30, 32], [28, 32]];
  const order = leftFar ? ["L", "R"] : ["R", "L"];
  const drawSide = side => {
    const al = (side === "L") === leftFar ? FA : 1;
    limbs(side).forEach(([a, b, wm]) => line(J[a], J[b], al, W * (wm || 1)));
    // collarbone and pelvis bone for this side
    line(sternum, J[side === "L" ? 11 : 12], al); line(base, J[side === "L" ? 23 : 24], al);
  };
  drawSide(order[0]);
  // spine with vertebra dots, neck
  poly(spinePts, 1, W * 1.05);
  line(neckB, sternum, 0.8, W * 0.8);
  poly([neckB, neckB.clone().lerp(skullBase, 0.5).addScaledVector(hF, 0.01), skullBase], 1, W);
  spinePts.forEach((p, i) => { if (i % 2 === 0) dot(p, 1.5 * dpr, 0.9) });
  drawSide(order[1]);
  // joints
  [11, 12, 13, 14, 23, 24, 25, 26].forEach(j => dot(J[j], 2.5 * dpr, far(j) ? FA + 0.1 : 1));
  [15, 16, 27, 28].forEach(j => dot(J[j], 2.0 * dpr, far(j) ? FA + 0.1 : 1));
  // head: dotted shell (dimmer on the far side), face landmarks brighter
  const camHead = camDist(headC);
  HEAD_DOTS.forEach(([x, y, z]) => {
    const v = headC.clone().addScaledVector(hX, x * 0.078).addScaledVector(hU, y * 0.1).addScaledVector(hF, z * 0.092);
    const near = camDist(v) < camHead;
    dot(v, 1.3 * dpr, near ? 0.75 : 0.25);
  });
  FACE.forEach(j => dot(J[j], (j === 0 ? 2.0 : 1.6) * dpr, 1));
  sg.globalAlpha = 1;
}

// ---- hand path, ghosts ----
// throwing-hand trail: only the last quarter-second, like the video overlay
const pathPts = [];
for (let k = 0; k <= (T - 1) * 4; k++) pathPts.push(computePose(k / 4).j[WRIST].clone());
const pathNow = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pathPts), new THREE.LineBasicMaterial({ color: AMBER, transparent: true, opacity: 0.9 }));
scene.add(pathNow);
const ghostGroup = new THREE.Group(); ghostGroup.visible = false; scene.add(ghostGroup);
const ghostMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22 });
KEYPH.forEach(p => {
  const P = computePose(p.frame), v = [];
  TREE.forEach(([a, b]) => { if (a >= 0 && b >= 0 && b <= 28 && ![17,18,19,20,21,22].includes(b)) v.push(...P.j[a].toArray(), ...P.j[b].toArray()) });
  v.push(...P.hip.toArray(), ...P.sh.toArray(), ...P.j[23].toArray(), ...P.j[24].toArray(), ...P.j[11].toArray(), ...P.j[12].toArray());
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  ghostGroup.add(new THREE.LineSegments(g, ghostMat));
});

// ---- angle annotations ----
const annot = new THREE.Group(); scene.add(annot);
function dynLine(color, n, opacity = 1) {
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, depthTest: false }));
  l.renderOrder = 10; l.frustumCulled = false; annot.add(l); return l;
}
function setLine(l, pts) { const a = l.geometry.attributes.position; pts.forEach((p, i) => a.setXYZ(i, p.x, p.y, p.z)); a.needsUpdate = true; l.geometry.setDrawRange(0, pts.length) }
function dynFan(color, n, opacity) {
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 9), 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, side: THREE.DoubleSide }));
  m.renderOrder = 9; m.frustumCulled = false; annot.add(m); return m;
}
function setFan(m, V, pts) {
  const a = m.geometry.attributes.position; let k = 0;
  for (let i = 0; i < pts.length - 1; i++) { [V, pts[i], pts[i + 1]].forEach(p => a.setXYZ(k++, p.x, p.y, p.z)) }
  a.needsUpdate = true; m.geometry.setDrawRange(0, k);
}
function arcPts(V, a, b, r, n = 24) {
  const th = Math.acos(Math.max(-1, Math.min(1, a.dot(b)))), out = [];
  if (th < 1e-3) return [V.clone().addScaledVector(a, r), V.clone().addScaledVector(a, r)];
  for (let i = 0; i <= n; i++) { const s = i / n; const p = a.clone().multiplyScalar(Math.sin((1 - s) * th)).addScaledVector(b, Math.sin(s * th)).divideScalar(Math.sin(th)); out.push(V.clone().addScaledVector(p, r)) }
  return out;
}
// each joint annotation: vertex, reference direction, measured direction, metric key
const labelsEl = document.getElementById("labels");
function mkLabel(cls, name) { const d = document.createElement("div"); d.className = "lbl " + cls; d.innerHTML = name + "<b></b>"; labelsEl.appendChild(d); return d }
const JOINT_ANN = [
  { key: "throwElbow", tier: 1, name: "Elbow", f: J => [J[m(14)], J[m(14)].clone().sub(J[m(12)]).normalize(), J[m(16)].clone().sub(J[m(14)]).normalize()], r: 0.09 },
  { key: "throwAbd", tier: 1, name: "Shoulder", f: (J, P) => [J[m(12)], P.hip.clone().sub(P.sh).normalize(), J[m(14)].clone().sub(J[m(12)]).normalize()], r: 0.12 },
  { key: "leadHip", tier: 2, name: "Lead hip", f: (J, P) => [J[m(23)], P.hip.clone().sub(P.sh).normalize(), J[m(25)].clone().sub(J[m(23)]).normalize()], r: 0.14 },
  { key: "leadKnee", tier: 1, name: "Lead knee", f: J => [J[m(25)], J[m(25)].clone().sub(J[m(23)]).normalize(), J[m(27)].clone().sub(J[m(25)]).normalize()], r: 0.11 },
  { key: "backKnee", tier: 2, name: "Back knee", f: J => [J[m(26)], J[m(26)].clone().sub(J[m(24)]).normalize(), J[m(28)].clone().sub(J[m(26)]).normalize()], r: 0.11 },
  { key: "trunkFwd", tier: 1, name: "Trunk tilt", f: (J, P) => [P.hip, UPV.clone(), P.sh.clone().sub(P.hip).normalize()], r: 0.34 },
].map(a => ({ ...a, arc: dynLine(AMBER, 25), fan: dynFan(AMBER, 24, 0.2), ref: dynLine(0xffffff, 2, 0.35), lbl: mkLabel("arc", a.name) }));
JOINT_ANN.forEach(a => a.lbl.ann = a);
// pelvis / trunk dial on the floor under the pelvis
const DIAL_R = 0.42;
const dialRing = dynLine(0x6a6a6a, 65, 0.8);
const dialTicks = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x6a6a6a, depthTest: false })); dialTicks.renderOrder = 10; annot.add(dialTicks);
const pelLine = dynLine(PINK, 2), trkLine = dynLine(CYAN, 2), sepArc = dynLine(0xffffff, 25, 0.6), sepFan = dynFan(0xffffff, 24, 0.16);
const pelBar = dynLine(PINK, 2), trkBar = dynLine(CYAN, 2);
const pelLbl = mkLabel("pel", "Pelvis"), trkLbl = mkLabel("trk", "Trunk"), sepLbl = mkLabel("", "Separation");
const heading = deg => new V3(Math.sin(deg * Math.PI / 180), 0, Math.cos(deg * Math.PI / 180));
const dialParts = [dialRing, dialTicks, pelLine, trkLine, sepArc, sepFan];
function drawAnnotations(P, ft) {
  const mode = state.angleMode, tierMax = mode === "all" ? 2 : mode === "key" ? 1 : 0;
  annot.visible = tierMax > 0;
  JOINT_ANN.forEach(a => { const on = a.tier <= tierMax; a.on = on; a.arc.visible = a.fan.visible = a.ref.visible = on });
  dialParts.forEach(o => o.visible = tierMax >= 2);
  pelLbl.on = trkLbl.on = tierMax >= 1; sepLbl.on = tierMax >= 2;
  if (!tierMax) return;
  const J = P.j;
  JOINT_ANN.forEach(a => {
    if (!a.on) return;
    const [V, d1, d2] = a.f(J, P);
    const ap = arcPts(V, d1, d2, a.r); setLine(a.arc, ap); setFan(a.fan, V, ap); a.fan.visible = a.r < 0.3;
    setLine(a.ref, [V, V.clone().addScaledVector(d1, a.r * 1.6)]);
    const bis = d1.clone().add(d2); if (bis.lengthSq() < 1e-4) bis.copy(d1); bis.normalize();
    a.lbl.pos = V.clone().addScaledVector(bis, a.r + 0.08);
    a.lbl.lastChild.textContent = fmt(valAt(M[a.key], ft), "°");
  });
  // pelvis and shoulder lines through the joints; labels sit at the glove-side end of each line
  const hx = new V3().subVectors(J[24], J[23]), sx = new V3().subVectors(J[12], J[11]);
  const pA = J[23].clone().addScaledVector(hx, -0.5), sA = J[11].clone().addScaledVector(sx, -0.45);
  setLine(pelBar, [pA, J[24].clone().addScaledVector(hx, 0.5)]);
  setLine(trkBar, [sA, J[12].clone().addScaledVector(sx, 0.45)]);
  const pr = valAt(M.pelvisRot, ft), tr = valAt(M.trunkRot, ft);
  pelLbl.lastChild.textContent = fmt(pr, "°"); trkLbl.lastChild.textContent = fmt(tr, "°");
  pelLbl.pos = pA.clone().addScaledVector(hx.clone().normalize(), -0.08);
  trkLbl.pos = sA.clone().addScaledVector(sx.clone().normalize(), -0.08);
  if (tierMax >= 2) {
    const C = new V3(P.hip.x, groundAt(P.hip.x) + 0.008, P.hip.z), ring = [];
    for (let i = 0; i <= 64; i++) { const t = i / 64 * Math.PI * 2; ring.push(C.clone().add(new V3(Math.cos(t) * DIAL_R, 0, Math.sin(t) * DIAL_R))) }
    setLine(dialRing, ring);
    const tk = []; [0, 90, 180, 270].forEach(d => { const h = heading(d); tk.push(...C.clone().addScaledVector(h, DIAL_R).toArray(), ...C.clone().addScaledVector(h, DIAL_R + 0.06).toArray()) });
    dialTicks.geometry.setAttribute("position", new THREE.Float32BufferAttribute(tk, 3));
    const ph = heading(pr), th = heading(tr);
    setLine(pelLine, [C, C.clone().addScaledVector(ph, DIAL_R)]);
    setLine(trkLine, [C, C.clone().addScaledVector(th, DIAL_R * 0.85)]);
    const sp = arcPts(C, ph, th, DIAL_R * 0.55); setLine(sepArc, sp); setFan(sepFan, C, sp);
    const mid = ph.clone().add(th); if (mid.lengthSq() < 1e-4) mid.copy(ph); mid.normalize();
    sepLbl.pos = C.clone().addScaledVector(mid, -DIAL_R - 0.16);
    sepLbl.lastChild.textContent = fmt(valAt(M.separation, ft), "°");
  }
}
const pv = new V3();
function placeLabels() {
  const w = panel.clientWidth, h = panel.clientHeight;
  [...JOINT_ANN.map(a => a.lbl), pelLbl, trkLbl, sepLbl].forEach(l => {
    const on = l.ann ? l.ann.on : l.on;
    if (!on || !l.pos) { l.style.display = "none"; return }
    pv.copy(l.pos).project(camera);
    if (pv.z > 1 || Math.abs(pv.x) > 1.1 || Math.abs(pv.y) > 1.1) { l.style.display = "none"; return }
    l.style.display = ""; l._x = (pv.x + 1) / 2 * w; l._y = (1 - pv.y) / 2 * h;
  });
  // nudge overlapping labels apart vertically
  const vis = [...JOINT_ANN.map(a => a.lbl), pelLbl, trkLbl, sepLbl].filter(l => l.style.display !== "none");
  vis.forEach(l => { l._w = l.offsetWidth; l._h = l.offsetHeight });
  vis.sort((a, b) => a._y - b._y);
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < vis.length; i++) for (let j = 0; j < i; j++) {
      const a = vis[j], b = vis[i];
      const ox = (a._w + b._w) / 2 + 4 - Math.abs(a._x - b._x), oy = (a._h + b._h) / 2 + 3 - Math.abs(a._y - b._y);
      if (ox > 0 && oy > 0) { if (b._y >= a._y) b._y += oy; else b._y -= oy }
    }
  }
  vis.forEach(l => { l.style.left = l._x.toFixed(1) + "px"; l.style.top = l._y.toFixed(1) + "px" });
}

// ---- cameras ----
// camera presets: direction + how wide the scene to fit is (m). Distance is computed so the whole delivery fills the panel.
const SPAN = Math.abs(DATA.pose[T - 1][23][0] - DATA.pose[0][23][0]) + 1.15;
const CAMS = [
  ["Video view", [DATA.cameraDir[0], 0.0, DATA.cameraDir[2]], () => SPAN],
  ["Broadcast", [DATA.cameraDir[0], 0.14, DATA.cameraDir[2]], () => SPAN],
  ["Arm side", [0, 0.1, LH ? -1 : 1], () => SPAN],
  ["Glove side", [0, 0.1, LH ? 1 : -1], () => SPAN],
  ["Catcher", [1, 0.12, 0], () => 1.7],
  ["Behind", [-1, 0.2, 0], () => 1.7],
  ["Overhead", [0.001, 1, 0.001], () => SPAN],
];
let camIdx = 0;
function fitDist(i) {
  const width = state.follow ? 1.6 : CAMS[i][2](), height = CAMS[i][0] === "Overhead" ? 1.7 : CAMS[i][0] === "Video view" ? 2.5 : 2.0, t = Math.tan(camera.fov * Math.PI / 360);
  return Math.max((height / 2) / t, (width / 2) / (t * Math.max(camera.aspect, 0.2))) * 1.0;
}
const camWrap = document.getElementById("cams"); let camAnim = null;
CAMS.forEach(([name], i) => {
  const b = document.createElement("button"); b.textContent = name; b.setAttribute("aria-pressed", i === 0);
  b.onclick = () => { setCam(i, true); camWrap.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b)) };
  camWrap.appendChild(b);
});
function setCam(i, animate) {
  const [, dir] = CAMS[i], dist = fitDist(i); camIdx = i;
  const to = new V3(...dir).normalize().multiplyScalar(dist).add(TARGET);
  if (!animate || matchMedia("(prefers-reduced-motion: reduce)").matches) { camera.position.copy(to); controls.target.copy(TARGET); controls.update(); return }
  camAnim = { from: camera.position.clone(), fromT: controls.target.clone(), to, t0: performance.now() };
}
setCam(0, false);
controls.addEventListener("start", () => { camAnim = null; camIdx = null; camWrap.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", false)) });

// ---------- video overlay ----------
const ov = document.getElementById("ov"), og = ov.getContext("2d");
const OBONES = [[11,13],[13,15],[15,19],[12,14],[14,16],[16,20],[11,12],[23,24],[11,23],[12,24],[23,25],[25,27],[27,29],[29,31],[27,31],[24,26],[26,28],[28,30],[30,32],[28,32]];
const OJOINTS = [11,12,13,14,15,16,23,24,25,26,27,28];
const THROW_ARM = [12, 14, 16, 20].map(m);
function drawOverlay(ft) {
  og.clearRect(0, 0, ov.width, ov.height); if (!state.overlay) return;
  const vw = DATA.width, vh = DATA.height, s = Math.min(ov.width / vw, ov.height / vh), ox = (ov.width - vw * s) / 2, oy = (ov.height - vh * s) / 2;
  const f = Math.max(0, Math.min(T - 1, Math.round(ft))), I = DATA.img[f];
  const X = (j, Fr = I) => ox + Fr[j][0] * vw * s, Y = (j, Fr = I) => oy + Fr[j][1] * vh * s;
  const lw = Math.max(2.5, ov.width / 260), blurred = f >= BLUR[0] && f <= BLUR[1];
  og.lineCap = "round"; og.lineJoin = "round";
  const tr = []; for (let k = Math.max(0, f - 7); k <= f; k++) tr.push([X(WRIST, DATA.img[k]), Y(WRIST, DATA.img[k])]);
  for (let i = 1; i < tr.length - 1; i++) {
    const a = (i + 1) / tr.length, m0 = [(tr[i - 1][0] + tr[i][0]) / 2, (tr[i - 1][1] + tr[i][1]) / 2], m1 = [(tr[i][0] + tr[i + 1][0]) / 2, (tr[i][1] + tr[i + 1][1]) / 2];
    og.strokeStyle = `rgba(255,179,71,${(0.9 * a).toFixed(3)})`; og.lineWidth = lw * (0.5 + 1.1 * a);
    og.beginPath(); og.moveTo(m0[0], m0[1]); og.quadraticCurveTo(tr[i][0], tr[i][1], m1[0], m1[1]); og.stroke();
  }
  const Pp = pt => [ox + pt[0] * vw * s, oy + pt[1] * vh * s];
  const sh = [(I[11][0] + I[12][0]) / 2, (I[11][1] + I[12][1]) / 2], hp = [(I[23][0] + I[24][0]) / 2, (I[23][1] + I[24][1]) / 2];
  const isArm = (a, b) => THROW_ARM.includes(a) && THROW_ARM.includes(b);
  for (const pass of [0, 1]) {
    OBONES.forEach(([a, b]) => {
      const fade = blurred && isArm(a, b);
      og.globalAlpha = fade ? 0.35 : 1; og.setLineDash(fade ? [lw * 1.5, lw * 2] : []);
      og.strokeStyle = pass ? "#ffffff" : "rgba(0,0,0,.55)"; og.lineWidth = pass ? lw : lw + 3;
      og.beginPath(); og.moveTo(X(a), Y(a)); og.lineTo(X(b), Y(b)); og.stroke();
    });
    og.setLineDash([]); og.globalAlpha = 1;
    const [sx, sy] = Pp(sh), [hx, hy] = Pp(hp);
    og.strokeStyle = pass ? "#ffffff" : "rgba(0,0,0,.55)"; og.lineWidth = pass ? lw : lw + 3;
    og.beginPath(); og.moveTo(hx, hy); og.lineTo(sx, sy); og.stroke();
  }
  const ex = (X(7) + X(8)) / 2, ey = (Y(7) + Y(8)) / 2, torso = Math.hypot(Pp(sh)[0] - Pp(hp)[0], Pp(sh)[1] - Pp(hp)[1]), er = Math.max(torso * 0.2, lw * 4);
  og.lineWidth = lw + 3; og.strokeStyle = "rgba(0,0,0,.55)"; og.beginPath(); og.arc(ex, ey, er, 0, 7); og.stroke();
  og.lineWidth = lw; og.strokeStyle = "#fff"; og.beginPath(); og.arc(ex, ey, er, 0, 7); og.stroke();
  OJOINTS.forEach(j => {
    og.globalAlpha = blurred && THROW_ARM.includes(j) ? 0.35 : 1;
    og.beginPath(); og.arc(X(j), Y(j), lw * 1.35, 0, 7); og.fillStyle = "#fff"; og.fill();
    og.lineWidth = lw * 0.7; og.strokeStyle = "rgba(0,0,0,.6)"; og.stroke();
  });
  og.globalAlpha = 1;
  if (state.ovAngles) drawOverlayAngles(f, X, Y, Pp, sh, hp, lw);
}
// pelvis and spine angles on the source video: colored lines on the body, values in a corner panel
function drawOverlayAngles(f, X, Y, Pp, sh, hp, lw) {
  const deg = k => { const v = M[k][f]; return v == null ? "—" : Math.round(v) + "°" };
  const [hx, hy] = Pp(hp), [sx, sy] = Pp(sh);
  og.lineCap = "round"; og.globalAlpha = 0.95;
  const ax = X(23), ay = Y(23), bx = X(24), by = Y(24), ex = (bx - ax) * 0.45, ey = (by - ay) * 0.45;
  og.strokeStyle = "#ff6fae"; og.lineWidth = lw * 1.4;
  og.beginPath(); og.moveTo(ax - ex, ay - ey); og.lineTo(bx + ex, by + ey); og.stroke();
  og.strokeStyle = "#62d0ff"; og.beginPath(); og.moveTo(hx, hy); og.lineTo(sx, sy); og.stroke();
  const L = Math.hypot(sx - hx, sy - hy);
  og.setLineDash([lw * 2, lw * 2]); og.strokeStyle = "rgba(255,255,255,.65)"; og.lineWidth = lw * 0.8;
  og.beginPath(); og.moveTo(hx, hy); og.lineTo(hx, hy - L * 0.75); og.stroke(); og.setLineDash([]);
  const a0 = -Math.PI / 2, a1 = Math.atan2(sy - hy, sx - hx);
  og.strokeStyle = "#62d0ff"; og.lineWidth = lw; og.beginPath(); og.arc(hx, hy, L * 0.3, Math.min(a0, a1), Math.max(a0, a1)); og.stroke();
  og.globalAlpha = 1;
  // corner panel (top right), sized in CSS pixels
  const sc = ov.width / Math.max(1, ov.clientWidth), fs = 12 * sc, pad = 9 * sc, rowH = 19 * sc;
  const rows = [["#ff6fae", "Pelvis rotation", deg("pelvisRot")], ["#62d0ff", "Spine tilt", deg("trunkFwd")],
                ["#62d0ff", "Spine rotation", deg("trunkRot")], ["#ffffff", "Hip–shoulder sep.", deg("separation")]];
  og.font = `500 ${fs}px "IBM Plex Mono", ui-monospace, monospace`; og.textBaseline = "middle";
  const labW = Math.max(...rows.map(r => og.measureText(r[1]).width)), valW = og.measureText("-000°").width;
  const w = pad * 2 + 10 * sc + labW + 12 * sc + valW, h = pad * 2 + rowH * rows.length - 4 * sc;
  const x0 = ov.width - w - 10 * sc, y0 = 10 * sc;
  og.fillStyle = "rgba(0,0,0,.66)"; og.beginPath(); if (og.roundRect) og.roundRect(x0, y0, w, h, 8 * sc); else og.rect(x0, y0, w, h); og.fill();
  rows.forEach(([c, lab, val], i) => {
    const yy = y0 + pad + rowH * i + rowH / 2 - 2 * sc;
    og.fillStyle = c; og.fillRect(x0 + pad, yy - 5 * sc, 4 * sc, 10 * sc);
    og.fillStyle = "#cfcfcf"; og.textAlign = "left"; og.fillText(lab, x0 + pad + 10 * sc, yy);
    og.fillStyle = "#ffffff"; og.textAlign = "right"; og.fillText(val, x0 + w - pad, yy);
  });
  og.textAlign = "left";
}
if (video.requestVideoFrameCallback) {
  const onFrame = (now, meta) => { state.vFrame = Math.round((meta.mediaTime - T0) * VFPS - 0.01); if (state.playing) drawOverlay(state.vFrame); video.requestVideoFrameCallback(onFrame) };
  video.requestVideoFrameCallback(onFrame);
}

// ---------- toggles & transport ----------
function toggle(id, key, after) { const b = document.getElementById(id); b.onclick = () => { state[key] = !state[key]; b.setAttribute("aria-pressed", state[key]); after && after(); lastShown = -1 } }
toggle("ovBtn", "overlay", () => drawOverlay(state.f));
toggle("pathBtn", "path", () => { pathNow.visible = state.path });
toggle("followBtn", "follow", () => { if (camIdx != null) setCam(camIdx, true) });
toggle("ovAngBtn", "ovAngles", () => drawOverlay(state.vFrame ?? state.f));
toggle("ghostBtn", "ghosts", () => { ghostGroup.visible = state.ghosts });
document.querySelectorAll("#angModes button").forEach(b => b.onclick = () => {
  state.angleMode = b.dataset.m; document.querySelectorAll("#angModes button").forEach(x => x.setAttribute("aria-pressed", x === b)); lastShown = -1;
});
const playBtn = document.getElementById("playBtn");
function setPlaying(on) {
  state.playing = on; playBtn.textContent = on ? "❚❚" : "▶"; playBtn.setAttribute("aria-label", on ? "Pause" : "Play");
  if (state.videoOK) { if (on) { const r = video.play(); if (r && r.catch) r.catch(() => {}) } else video.pause() }
}
playBtn.onclick = () => setPlaying(!state.playing);
function seek(f) {
  f = Math.max(0, Math.min(T - 1, f)); setPlaying(false); state.f = f; state.clock = (f + 0.5) / VFPS;
  if (state.videoOK) video.currentTime = T0 + (Math.round(f) + 0.5) / VFPS;
}
document.getElementById("prevBtn").onclick = () => seek(Math.round(state.f) - 1);
document.getElementById("nextBtn").onclick = () => seek(Math.round(state.f) + 1);
const speeds = document.getElementById("speeds");
[[1, "1×"], [0.5, "½×"], [0.25, "¼×"], [0.125, "⅛×"]].forEach(([r, l]) => {
  const b = document.createElement("button"); b.textContent = l; b.setAttribute("aria-pressed", r === state.rate);
  b.onclick = () => { state.rate = r; video.playbackRate = r; speeds.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b)); if (!state.playing) setPlaying(true) };
  speeds.appendChild(b);
});
addEventListener("keydown", e => {
  if (!panel.isConnected) return;
  if (e.target.closest && e.target.closest("input,textarea,select")) return;
  if (e.key === " " && e.target.tagName !== "BUTTON") { e.preventDefault(); setPlaying(!state.playing) }
  else if (e.key === "ArrowRight") { e.preventDefault(); seek(Math.round(state.f) + 1) }
  else if (e.key === "ArrowLeft") { e.preventDefault(); seek(Math.round(state.f) - 1) }
  else if (e.key === "Home" && e.target.id === "scrub") seek(0);
  else if (e.key === "End" && e.target.id === "scrub") seek(T - 1);
}, { signal: AC.signal });
const scrub = document.getElementById("scrub"), knob = document.getElementById("knob"), fillEl = document.getElementById("fill");
KEYPH.forEach(p => { const d = document.createElement("div"); d.className = "tick"; d.style.left = (p.frame / (T - 1) * 100) + "%"; d.innerHTML = `<span>${AB[p.name]}</span>`; document.getElementById("ticks").appendChild(d) });
function scrubTo(e) { const r = scrub.getBoundingClientRect(); seek(Math.round((e.clientX - r.left) / r.width * (T - 1))) }
scrub.addEventListener("pointerdown", e => { scrub.setPointerCapture(e.pointerId); scrubTo(e) });
scrub.addEventListener("pointermove", e => { if (scrub.hasPointerCapture(e.pointerId)) scrubTo(e) });
const phWrap = document.getElementById("phases");
PH.forEach(p => {
  const b = document.createElement("button"); b.dataset.f = p.frame;
  b.innerHTML = `<span class="ab">${AB[p.name]}</span>${p.name}<span class="ab">${(p.frame / FPS).toFixed(2)} s</span>`;
  b.onclick = () => seek(p.frame); phWrap.appendChild(b);
});
function currentPhase(f) { let cur = PH[0]; PH.forEach(p => { if (f >= p.frame - 0.5) cur = p }); return cur }

// ---------- live sheet ----------
const sheet = document.getElementById("sheet"), liveCells = {};
GROUPS.forEach(g => {
  const d = document.createElement("div"); d.className = "grp";
  d.innerHTML = `<div class="gh"><i class="sw" style="background:${GCOL[g]}"></i>${g}</div>`;
  Object.entries(MET).filter(([, m]) => m[2] === g).forEach(([k, m]) => {
    const r = document.createElement("div"); r.className = "row"; r.innerHTML = `<span>${m[0]}</span><span class="v">—</span>`;
    d.appendChild(r); liveCells[k] = r.lastChild;
  });
  sheet.appendChild(d);
});

// ---------- phase table ----------
(() => {
  const t = document.getElementById("ptable");
  let h = `<thead><tr><th>Angle</th>${KEYPH.map(p => `<th data-f="${p.frame}">${AB[p.name]}<span>${p.name} · ${(p.frame / FPS).toFixed(2)} s</span></th>`).join("")}</tr></thead><tbody>`;
  GROUPS.forEach(g => {
    h += `<tr class="gr"><td colspan="${KEYPH.length + 1}">${g}</td></tr>`;
    Object.entries(MET).filter(([, m]) => m[2] === g).forEach(([k, m]) => {
      h += `<tr><td>${m[0]}</td>${KEYPH.map(p => { const v = M[k][p.frame]; const bl = p.frame >= BLUR[0] && p.frame <= BLUR[1] && g === "Throwing arm"; return `<td>${fmt(v, m[1])}${bl && v != null ? "*" : ""}</td>` }).join("")}</tr>`;
    });
  });
  h += `<tr><td colspan="${KEYPH.length + 1}" style="font-family:var(--body);color:var(--muted);font-size:12px">* Arm is motion-blurred in the video at release, so this value is approximate.</td></tr></tbody>`;
  t.innerHTML = h;
  t.querySelectorAll("th[data-f]").forEach(th => th.onclick = () => seek(+th.dataset.f));
})();

// ---------- charts ----------
const CHARTS = [
  { title: "Pelvis and trunk rotation", series: [["pelvisRot", "--pelvis", "Pelvis"], ["trunkRot", "--trunk", "Trunk"]], unit: "°", def: `0° faces ${LH ? "first" : "third"} base, 90° faces home. The gap between the lines is hip–shoulder separation.` },
  { title: "Rotation speed", series: [["pelvisSpd", "--pelvis", "Pelvis"], ["trunkSpd", "--trunk", "Trunk"]], unit: "°/s", def: "In an efficient delivery the pelvis peaks first, then the trunk.", peaks: true },
  { title: "Hip–shoulder separation", series: [["separation", "--fg"]], unit: "°", def: MET.separation[3] },
  { title: "Throwing elbow flexion", series: [["throwElbow", "--throw"]], unit: "°", def: MET.throwElbow[3], blur: true },
  { title: "Throwing shoulder abduction", series: [["throwAbd", "--throw"]], unit: "°", def: MET.throwAbd[3], blur: true },
  { title: "Layback (modelled)", series: [["throwER", "--throw"]], unit: "°", def: MET.throwER[3], blur: true },
  { title: "Shoulder horizontal abduction", series: [["throwHorz", "--throw"]], unit: "°", def: MET.throwHorz[3], blur: true },
  { title: "Lead hip flexion", series: [["leadHip", "--glove"]], unit: "°", def: MET.leadHip[3] },
  { title: "Lead knee flexion", series: [["leadKnee", "--glove"]], unit: "°", def: MET.leadKnee[3] },
  { title: "Back knee flexion", series: [["backKnee", "--throw"]], unit: "°", def: "Flex of the drive leg as he loads and pushes off the rubber." },
  { title: "Trunk forward tilt", series: [["trunkFwd", "--trunk"]], unit: "°", def: MET.trunkFwd[3] },
  { title: "Trunk lateral tilt", series: [["trunkLat", "--trunk"]], unit: "°", def: MET.trunkLat[3] },
  { title: "Pelvis lateral tilt", series: [["pelvisTilt", "--pelvis"]], unit: "°", def: MET.pelvisTilt[3] },
];
const chartWrap = document.getElementById("charts");
CHARTS.forEach(c => {
  const el = document.createElement("article"); el.className = "card";
  el.innerHTML = `<div class="head"><div><h3>${c.title}</h3><p class="def">${c.def}</p></div><div class="val" data-val>—</div></div><svg class="chart" tabindex="0" aria-label="${c.title} over time"></svg>`;
  chartWrap.appendChild(el); c.svg = el.querySelector("svg"); c.val = el.querySelector("[data-val]");
  const go = e => { const r = c.svg.getBoundingClientRect(); seek(Math.round((e.clientX - r.left - 40) / (r.width - 48) * (T - 1))) };
  c.svg.addEventListener("pointerdown", e => { c.svg.setPointerCapture(e.pointerId); go(e) });
  c.svg.addEventListener("pointermove", e => { if (c.svg.hasPointerCapture(e.pointerId)) go(e) });
});
function niceStep(span) { const raw = span / 4, p = Math.pow(10, Math.floor(Math.log10(raw))); return [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= raw) }
function drawCharts() {
  CHARTS.forEach(c => {
    const w = c.svg.clientWidth || 320, h = c.svg.clientHeight || 120, L = 40, R = 8, Tp = 14, B = 16;
    const vals = c.series.flatMap(([k]) => M[k].filter(v => v != null));
    let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo) * 0.1 + 1; lo -= pad; hi += pad;
    const x = f => L + f / (T - 1) * (w - L - R), y = v => Tp + (1 - (v - lo) / (hi - lo)) * (h - Tp - B);
    c.x = x; c.y = y;
    let s = c.blur ? `<rect x="${x(BLUR[0])}" y="${Tp}" width="${x(BLUR[1]) - x(BLUR[0])}" height="${h - Tp - B}" fill="var(--blur)"/>` : "";
    const st = niceStep(hi - lo);
    for (let t = Math.ceil(lo / st) * st; t <= hi; t += st) s += `<line x1="${L}" x2="${w - R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)"/><text x="${L - 5}" y="${y(t) + 3.5}" text-anchor="end">${(Math.round(t) || 0).toLocaleString("en-US")}${c.unit === "°" ? "°" : ""}</text>`;
    if (lo < 0 && hi > 0) s += `<line x1="${L}" x2="${w - R}" y1="${y(0)}" y2="${y(0)}" stroke="var(--muted)" opacity=".6"/>`;
    [0, 0.5, 1, 1.5, 2].forEach(sec => { const f = sec * FPS; if (f <= T - 1) s += `<text x="${x(f)}" y="${h - 3}" text-anchor="${sec === 0 ? "start" : "middle"}">${sec}s</text>` });
    KEYPH.forEach(p => s += `<line x1="${x(p.frame)}" x2="${x(p.frame)}" y1="${Tp}" y2="${h - B}" stroke="var(--muted)" stroke-dasharray="3 3" opacity=".7"/><text x="${x(p.frame) + 3}" y="${Tp - 3}">${AB[p.name]}</text>`);
    c.series.forEach(([k, col], si) => {
      let d = "", pen = false;
      M[k].forEach((v, f) => { if (v == null) { pen = false; return } d += (pen ? "L" : "M") + x(f).toFixed(1) + " " + y(v).toFixed(1); pen = true });
      s += `<path d="${d}" fill="none" stroke="var(${col})" stroke-width="2.1" stroke-linejoin="round"/>`;
      if (c.peaks) { let pf = 0; M[k].forEach((v, f) => { if (v > M[k][pf]) pf = f }); s += `<circle cx="${x(pf)}" cy="${y(M[k][pf])}" r="3.5" fill="none" stroke="var(${col})" stroke-width="1.6"/><text x="${si === 0 ? x(pf) - 6 : x(pf) + 6}" y="${y(M[k][pf]) + 3}" text-anchor="${si === 0 ? "end" : "start"}" style="fill:var(${col})">${Math.round(M[k][pf]).toLocaleString("en-US")}°/s</text>` }
    });
    s += `<line data-cur y1="${Tp}" y2="${h - B}" stroke="var(--fg)" stroke-width="1.2"/>` + c.series.map(([, col]) => `<circle data-dot r="4" fill="var(${col})" stroke="var(--panel)" stroke-width="2"/>`).join("");
    c.svg.setAttribute("viewBox", `0 0 ${w} ${h}`); c.svg.innerHTML = s;
    c.cur = c.svg.querySelector("[data-cur]"); c.dots = [...c.svg.querySelectorAll("[data-dot]")];
  });
}

// ---------- main loop ----------
function resize() {
  const w = panel.clientWidth, h = panel.clientHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  const dpr = Math.min(devicePixelRatio || 1, 2), sw = Math.round(w * dpr), sh = Math.round(h * dpr);
  const vp = document.getElementById("vidPanel"), ow = vp.clientWidth * 2, oh = vp.clientHeight * 2;
  let changed = false;
  if (skel.width !== sw || skel.height !== sh) { skel.width = sw; skel.height = sh; changed = true }
  if (ov.width !== ow || ov.height !== oh) { ov.width = ow; ov.height = oh; changed = true }
  if (changed && typeof POSE !== "undefined" && typeof state !== "undefined") { try { drawSkeleton2D(computePose(state.f)); drawOverlay(state.vFrame != null && state.playing ? state.vFrame : state.f) } catch (e) {} }
}
let last = performance.now(), lastShown = -1;
function tick(now) {
  const dt = (now - last) / 1000; last = now;
  if (state.playing) {
    // The skeleton runs on its own continuous clock. The video's currentTime only advances once per
    // video frame, so reading it directly makes the whole body hold, then jump, every frame.
    const dur = T / VFPS;
    state.clock += Math.min(dt, 0.1) * state.rate;
    if (state.clock >= dur) state.clock -= dur;
    if (state.videoOK && video.readyState >= 2 && !video.seeking && !video.paused) {
      if (video.currentTime >= T0 + T / VFPS - 0.5 / VFPS) video.currentTime = T0;   // loop the analysed window
      let drift = video.currentTime - T0 + 0.5 / VFPS - state.clock;          // currentTime lags ~half a frame on average
      if (drift > dur / 2) drift -= dur; else if (drift < -dur / 2) drift += dur;
      if (Math.abs(drift) > 0.25) state.clock = video.currentTime - T0;      // loop restart or a stall: resync
      else state.clock += drift * Math.min(1, dt * 1.5);                 // otherwise drift gently back in step
      if (state.clock < 0) state.clock += dur;
    }
    state.f = Math.max(0, Math.min(T - 1, state.clock * VFPS - 0.5));
  }
  const ft = state.f;
  if (camAnim) {
    const k = Math.min(1, (now - camAnim.t0) / 650), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    camera.position.lerpVectors(camAnim.from, camAnim.to, e); controls.target.lerpVectors(camAnim.fromT, TARGET, e);
    if (k >= 1) camAnim = null;
  }
  const P = computePose(ft);
  if (state.follow && !camAnim) {
    const k = Math.min(1, dt * 5), dx = (P.hip.x - TARGET.x) * k;
    TARGET.x += dx; controls.target.x += dx; camera.position.x += dx;
  }
  drawFigure(P); drawAnnotations(P, ft);
  { const end = Math.floor(ft * 4) + 1, start = Math.max(0, end - 32); pathNow.geometry.setDrawRange(start, end - start) }
  controls.update(); plateLbl.visible = camera.position.x < travel + 0.8;
  renderer.render(scene, camera); drawSkeleton2D(P); placeLabels();

  if (Math.abs(ft - lastShown) > 0.01) {
    lastShown = ft; const fr = Math.round(ft), pct = ft / (T - 1) * 100;
    knob.style.left = pct + "%"; fillEl.style.width = pct + "%"; scrub.setAttribute("aria-valuenow", fr);
    document.getElementById("tNow").textContent = (ft / FPS).toFixed(2) + " s";
    document.getElementById("fNow").textContent = fr;
    const ph = currentPhase(ft);
    document.getElementById("phName").textContent = ph.name === "Start" ? "Set position" : ph.name === "Finish" ? "Follow-through" : ph.name;
    document.getElementById("phFrame").textContent = `frame ${fr} · ${(ft / FPS).toFixed(2)} s`;
    phWrap.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", +b.dataset.f === ph.frame));
    Object.entries(liveCells).forEach(([k, el]) => { const v = valAt(M[k], ft); el.textContent = fmt(v, MET[k][1]); el.classList.toggle("na", v == null) });
    CHARTS.forEach(c => {
      if (!c.cur) return; const X = c.x(ft); c.cur.setAttribute("x1", X); c.cur.setAttribute("x2", X);
      const vs = c.series.map(([k], i) => { const v = valAt(M[k], ft); c.dots[i].setAttribute("cx", X); c.dots[i].setAttribute("cy", v == null ? -99 : c.y(v)); return v });
      c.val.innerHTML = c.series.length > 1 ? vs.map((v, i) => `<small>${c.series[i][2]} ${fmt(v, c.unit)}</small>`).join("") : fmt(vs[0], c.unit);
    });
    if (!(state.playing && state.vFrame != null && state.videoOK)) drawOverlay(ft);
  }
  if (alive) requestAnimationFrame(tick);
}
const RO = new ResizeObserver(() => { resize(); drawCharts(); if (camIdx != null && !camAnim) setCam(camIdx, false); lastShown = -1 });
RO.observe(document.body); RO.observe(panel); RO.observe(document.getElementById("vidPanel"));
// full screen: video + skeleton + play controls fill the monitor
const theater = document.getElementById("theater"), fsBtn = document.getElementById("fsBtn");
if (fsBtn && theater) {
  if (!document.fullscreenEnabled && !document.webkitFullscreenEnabled) fsBtn.hidden = true;
  fsBtn.onclick = async () => {
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else await (theater.requestFullscreen || theater.webkitRequestFullscreen).call(theater);
    } catch (e) { fsBtn.hidden = true }
  };
  document.addEventListener("fullscreenchange", () => { const on = !!document.fullscreenElement; fsBtn.textContent = on ? "Exit full screen" : "Full screen"; fsBtn.setAttribute("aria-pressed", on) }, { signal: AC.signal });
}
document.getElementById("fMax").textContent = T - 1; scrub.setAttribute("aria-valuemax", T - 1);
resize(); drawCharts(); requestAnimationFrame(tick);
// skeleton style + phase editing hooks
document.querySelectorAll("#styleModes button").forEach(b => b.onclick = () => {
  state.style = b.dataset.s; document.querySelectorAll("#styleModes button").forEach(x => x.setAttribute("aria-pressed", x === b)); lastShown = -1;
});
const phaseSel = document.getElementById("phaseSel"), phaseSet = document.getElementById("phaseSet");
if (phaseSel && phaseSet && opts.onPhases) phaseSet.onclick = () => {
  const cur = { legLift: PH[1].frame, footStrike: PH[2].frame, armCocked: PH[3].frame, release: PH[4].frame };
  cur[phaseSel.value] = Math.round(state.f);
  opts.onPhases(cur, Math.round(state.f));
};
if (opts.startFrame != null) seek(opts.startFrame);
return {
  seek: f => seek(f),
  frame: () => Math.round(state.f),
  csv: () => {
    const keys = Object.keys(MET);
    const head = ["frame", "time_s", "phase", ...keys.map(k => `${MET[k][2]} ${MET[k][0]} (${MET[k][1]})`)];
    const rows = [head.map(h => `"${h}"`).join(",")];
    for (let f = 0; f < T; f++) rows.push([f, (f / FPS).toFixed(4), `"${currentPhase(f).name}"`, ...keys.map(k => M[k][f] == null ? "" : Math.round(M[k][f] * 10) / 10)].join(","));
    return rows.join("\n");
  },
  stop() {
    alive = false; AC.abort(); RO.disconnect();
    try { video.pause(); video.removeAttribute("src"); video.load() } catch (e) {}
    try { controls.dispose(); renderer.dispose(); renderer.forceContextLoss && renderer.forceContextLoss() } catch (e) {}
  },
};

};
