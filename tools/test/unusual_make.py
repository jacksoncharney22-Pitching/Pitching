# Makes test views of UNUSUAL lab deliveries (rebuild step 4): does the app, and the lab-matched body fit
# (`?bodyfit=1`, bodyfit.js), follow a sidearm, a very short/long stride, a quick leg lift, a big trunk tilt, a lefty?
#
# The benchmark (tools/test/bench) has 12 fairly ordinary pitches. This takes the most unusual deliveries in the
# OpenBiomechanics lab data (not benchmark athletes) and makes benchmark-format views of them for the same 5 cameras:
#   - truth: the lab's 3D joints put in the benchmark's frame (the same lab->benchmark turn as a donor benchmark pitch),
#     sampled at 60 fps in the pitcher's OWN timing; the face/hand/foot points the lab doesn't have are borrowed from
#     the donor in the nearest body segment's own axes;
#   - tracker output: the truth seen through the donor view's camera (fitted from the donor's truth and tracker
#     points) PLUS the donor view's own tracker error at the same moment of the delivery (2D points, 3D "world"
#     points and the learned-depth model's output), so the noise is real tracker noise, not made up.
# So the views test how the skeleton handles the DELIVERY, with the tracker error of an ordinary one.
#
# usage: python3 tools/test/unusual_make.py <landmarks.csv> <metadata.csv> <outdir> [--list]
#   writes <outdir>/<sp>_<view>.raw.json.gz / .truth.json.gz (same format as tools/test/bench), <outdir>/picks.json
#   (why each pitch was picked) and <outdir>/exclude_users.txt (for bodylib_build.py --exclude, so the fit's library
#   never contains the test pitchers). --list: only print the picks.
#   --selftest: remake each benchmark pitch from ANOTHER benchmark pitch's noise (validation: the app's error on the
#   remade views should be about the same as on the real ones).
# Keep <outdir> OUTSIDE the repo (lab data, CC BY-NC-SA; the repo is the public website).
import sys, json, gzip, numpy as np, pandas as pd
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
BENCH = ROOT / 'tools/test/bench'
VIEWS = ['behind', 'behind_3b', 'front_3b', 'side_back', 'side_open']
LABJ = ['rear_ankle_jc', 'rear_knee_jc', 'rear_hip', 'lead_ankle_jc', 'lead_knee_jc', 'lead_hip', 'shoulder_jc',
        'elbow_jc', 'wrist_jc', 'glove_shoulder_jc', 'glove_elbow_jc', 'glove_wrist_jc']
# lab joint -> MediaPipe landmark, right-hander (throwing side = right = even numbers)
MP_R = [28, 26, 24, 27, 25, 23, 12, 14, 16, 11, 13, 15]
MIR = {a: b for a, b in [(11, 12), (13, 14), (15, 16), (23, 24), (25, 26), (27, 28)]}; MIR.update({b: a for a, b in MIR.items()})
# extra landmarks borrowed from the donor in a segment's own axes: (origin, axis point, plane point)
SEG = {}
for j in range(11): SEG[j] = (11, 12, 23)            # face: shoulders + hip
for j in (17, 19, 21): SEG[j] = (15, 13, 11)         # left hand: wrist, elbow, shoulder
for j in (18, 20, 22): SEG[j] = (16, 14, 12)
for j in (29, 31): SEG[j] = (27, 25, 23)             # left foot: ankle, knee, hip
for j in (30, 32): SEG[j] = (28, 26, 24)

def frame3(P, o, a, b):
    """orthonormal axes (3x3 rows) at P[o] from P[a]-P[o] and P[b]-P[o]"""
    x = P[a] - P[o]; x = x / (np.linalg.norm(x) + 1e-9)
    y = P[b] - P[o]; y = y - x * (x @ y); y = y / (np.linalg.norm(y) + 1e-9)
    return np.stack([x, y, np.cross(x, y)])

def load_lab(lm, meta):
    d = pd.read_csv(lm); m = pd.read_csv(meta).set_index('session_pitch'); out = {}
    for sp, p in d.groupby('session_pitch', sort=False):
        r = p.iloc[0]; ev = dict(pkh=r.pkh_time, fs=r.fp_10_time, mer=r.MER_time, br=r.BR_time)
        if not all(np.isfinite(v) for v in ev.values()) or sp not in m.index: continue
        if not (0.2 < ev['fs'] - ev['pkh'] < 1.3 and 0.04 < ev['mer'] - ev['fs'] < 0.3 and 0 < ev['br'] - ev['mer'] < 0.08): continue
        J = np.stack([p[[f'{j}_{a}' for a in 'xyz']].values for j in LABJ], 1)
        if not np.all(np.isfinite(J)): continue
        ib = int(np.argmin(abs(p.time.values - ev['br'])))
        lefty = J[ib, 6, 1] - J[ib, 9, 1] > 0
        out[sp] = dict(sp=sp, t=p.time.values, J=J, ev=ev, h=float(m.loc[sp, 'session_height_m']), user=int(m.loc[sp, 'user']),
                       mph=float(m.loc[sp, 'pitch_speed_mph']), lefty=bool(lefty))
    return out

def features(L):
    """what makes a delivery unusual, in plain terms"""
    J, t, ev, h = L['J'], L['t'], L['ev'], L['h']
    at = lambda s: int(np.argmin(abs(t - s)))
    ib, ifs = at(ev['br']), at(ev['fs'])
    sh, wr = J[ib, 6], J[ib, 8]; gs = J[ib, 9]
    # arm slot: throwing arm (shoulder -> wrist) above the horizontal at release, 90 = straight up, 0 = sidearm
    v = wr - sh; slot = np.degrees(np.arctan2(v[2], np.hypot(v[0], v[1])))
    # trunk side tilt at release: shoulder line against the horizontal (glove shoulder above throwing shoulder = +;
    # most pitchers are negative: glove side down, throwing shoulder up)
    s = gs - sh; tilt = np.degrees(np.arctan2(s[2], np.hypot(s[0], s[1])))
    stride = np.hypot(*(J[ifs, 3, :2] - J[0, 0, :2])) / h * 100
    return dict(slot=round(float(slot), 1), stride=round(float(stride), 1), tilt=round(float(tilt), 1),
                lift=round(float(ev['fs'] - ev['pkh']), 3), lefty=L['lefty'], mph=L['mph'], h=L['h'])

def picks(lab, bench_users):
    F = {sp: features(L) for sp, L in lab.items() if L['user'] not in bench_users}
    used, out = set(), []
    def take(key, rev, n, why):
        for sp in sorted(F, key=lambda s: F[s][key], reverse=rev):
            if len([o for o in out if o['why'] == why]) >= n: break
            if lab[sp]['user'] in used: continue
            used.add(lab[sp]['user']); out.append(dict(sp=sp, why=why, **F[sp]))
    take('slot', False, 2, 'low arm slot (sidearm-ish)')
    take('slot', True, 2, 'very high arm slot')
    take('stride', False, 2, 'short stride')
    take('stride', True, 2, 'long stride')
    take('lift', False, 2, 'quick leg lift (slide-step-like)')
    take('tilt', False, 2, 'big side tilt at release')
    lefties = {sp: f for sp, f in F.items() if f['lefty']}
    for sp in sorted(lefties, key=lambda s: lefties[s]['mph'], reverse=True):
        if len([o for o in out if o['why'] == 'left-hander']) >= 2: break
        if lab[sp]['user'] in used: continue
        used.add(lab[sp]['user']); out.append(dict(sp=sp, why='left-hander', **F[sp]))
    med = {k: float(np.median([f[k] for f in F.values()])) for k in ('slot', 'stride', 'tilt', 'lift')}
    return out, med

# ---- donor: one benchmark view (truth + tracker output) and how its truth maps to the lab
def jz(path): return json.load(gzip.open(path))

def fit_dlt(X, x):
    A, b = [], []
    for (X1, Y1, Z1), (u, v) in zip(X, x):
        A.append([X1, Y1, Z1, 1, 0, 0, 0, 0, -u * X1, -u * Y1, -u * Z1]); b.append(u)
        A.append([0, 0, 0, 0, X1, Y1, Z1, 1, -v * X1, -v * Y1, -v * Z1]); b.append(v)
    p = np.linalg.lstsq(np.array(A), np.array(b), rcond=None)[0]; return np.append(p, 1).reshape(3, 4)

def proj(M, X):
    H = np.c_[X, np.ones(len(X))] @ M.T; return H[:, :2] / H[:, 2:]

def rigid(A, B):
    """rotation R, translation c: B ~ A @ R + c"""
    ma, mb = A.mean(0), B.mean(0); U, S, Vt = np.linalg.svd((A - ma).T @ (B - mb))
    D = np.eye(3); D[2, 2] = np.sign(np.linalg.det(U @ Vt)); R = U @ D @ Vt; return R, mb - ma @ R

def simil(A, B):
    """scale s, rotation R, translation c: B ~ s A @ R + c"""
    ma, mb = A.mean(0), B.mean(0); A0, B0 = A - ma, B - mb; U, S, Vt = np.linalg.svd(A0.T @ B0)
    D = np.eye(3); D[2, 2] = np.sign(np.linalg.det(U @ Vt)); R = U @ D @ Vt; s = (S * np.diag(D)).sum() / (A0 ** 2).sum()
    return s, R, mb - s * ma @ R

def h36(P):
    """MediaPipe 33 -> the 17 joints of the learned-depth model (pipeline.js H36 map)"""
    Q = np.zeros((17, 3)); pel = (P[23] + P[24]) / 2; tho = (P[11] + P[12]) / 2
    for mp, k in {11: 11, 12: 14, 13: 12, 14: 15, 15: 13, 16: 16, 23: 4, 24: 1, 25: 5, 26: 2, 27: 6, 28: 3}.items(): Q[k] = P[mp]
    Q[0] = pel; Q[7] = (pel + tho) / 2; Q[8] = tho; Q[9] = P[0]; Q[10] = (P[7] + P[8]) / 2 + (P[0] - tho) * 0.3
    return Q

def lab_to_mp(J, lefty):
    """lab joints (n x 12 x 3) -> MediaPipe-indexed dict of arrays"""
    out = {}
    for i, mp in enumerate(MP_R): out[MIR[mp] if lefty else mp] = J[:, i]
    return out

class Donor:
    def __init__(self, sp, view, lab):
        self.tr = jz(BENCH / f'{sp}_{view}.truth.json.gz'); self.raw = jz(BENCH / f'{sp}_{view}.raw.json.gz')
        P = np.array(self.tr['P']); self.P = P; T = len(P); fps = self.tr.get('fps', 60)
        W, H = self.raw['width'], self.raw['height']
        I = np.array([f['img'] for f in self.raw['frames']], dtype=float); self.vis = I[:, :, 2:].copy()
        self.I = I[:, :, :2] * [W, H]
        Wd = np.array([f['world'] for f in self.raw['frames']], dtype=float); self.Wd = Wd
        J = list(range(11, 29))
        self.M = fit_dlt(P[:, J].reshape(-1, 3), self.I[:, J].reshape(-1, 2))
        self.Inoise = self.I - np.stack([proj(self.M, P[t]) for t in range(T)])
        Pc = P - (P[:, 23:24] + P[:, 24:25]) / 2
        self.Rw, _ = rigid(Pc[:, J].reshape(-1, 3), Wd[:, J, :3].reshape(-1, 3))
        self.Wnoise = Wd[:, :, :3] - Pc @ self.Rw
        self.l3 = self.raw.get('l3'); self.l3fit = []
        if self.l3:
            for t in range(T):
                L = np.array(self.l3[t]); Q = h36(P[t]); s, R, c = simil(Q, L); self.l3fit.append((s, R, c, L - (s * Q @ R + c)))
        # lab time of every truth frame (events: frames here vs seconds in the lab)
        Ld = lab[sp]; ev = self.tr['events']
        offs = [Ld['ev']['fs'] - ev['fs'] / fps, Ld['ev']['mer'] - ev['mer'] / fps, Ld['ev']['br'] - ev['br'] / fps]
        self.t0 = float(np.median(offs)); self.fps = fps; self.lab = Ld
        self.tl = self.t0 + np.arange(T) / fps
        # lab -> benchmark-truth turn: lab joints at each frame's lab time vs the truth's same joints
        JL = np.stack([np.stack([np.interp(self.tl, Ld['t'], Ld['J'][:, i, k]) for k in range(3)], 1) for i in range(12)], 1)
        A = np.concatenate([JL[:, i] for i in range(12)]); B = np.concatenate([P[:, MP_R[i]] for i in range(12)])
        self.Rl, self.cl = rigid(A, B)
        self.fit_cm = float(np.median(np.linalg.norm(A @ self.Rl + self.cl - B, axis=1)) * 100)
        self.view = view; self.sp = sp

    def phase_time(self, ev_src, ts):
        """map times in another pitch's lab clock to this donor's lab clock, piecewise by events"""
        ks = ['pkh', 'fs', 'mer', 'br']; a = [ev_src[k] for k in ks]; b = [self.lab['ev'][k] for k in ks]
        a = [a[0] - 1] + a + [a[-1] + 1]; b = [b[0] - 1] + b + [b[-1] + 1]
        return np.interp(ts, a, b)

def make(Ld, D, hand_mirror=False):
    """benchmark-format truth + raw for lab pitch Ld seen like donor D"""
    ev, fps = Ld['ev'], D.fps
    pre = D.lab['ev']['pkh'] - D.tl[0]; post = D.tl[-1] - D.lab['ev']['br']
    t0 = max(Ld['t'][0], ev['pkh'] - pre); t1 = min(Ld['t'][-1], ev['br'] + post)
    ts = t0 + np.arange(int((t1 - t0) * fps) + 1) / fps; T = len(ts)
    JL = np.stack([np.stack([np.interp(ts, Ld['t'], Ld['J'][:, i, k]) for k in range(3)], 1) for i in range(12)], 1)
    # place: back ankle at the start where the donor's was (lab ground plane), then the donor's lab->truth turn
    dJ0 = np.array([np.interp(D.tl[0], D.lab['t'], D.lab['J'][:, 0, k]) for k in range(3)])
    JL = JL - np.r_[JL[0, 0, :2], 0] + np.r_[dJ0[:2], 0]
    X = JL @ D.Rl + D.cl
    # the matching donor frame for every frame (same moment of the delivery)
    df = np.clip((D.phase_time(ev, ts) - D.tl[0]) * fps, 0, len(D.P) - 1)
    fi = np.round(df).astype(int)
    P = np.zeros((T, 33, 3))
    mp = lab_to_mp(X, Ld['lefty'])
    for j, a in mp.items(): P[:, j] = a
    for t in range(T):
        Pd = D.P[fi[t]]
        for j, (o, a, b) in SEG.items():
            Fd, Fn = frame3(Pd, o, a, b), frame3(P[t], o, a, b)
            P[t, j] = P[t, o] + ((Pd[j] - Pd[o]) @ Fd.T) @ Fn
    # tracker output: true projection + the donor's own tracker error at the same moment
    W, H = D.raw['width'], D.raw['height']
    frames, l3 = [], []
    Pc = P - (P[:, 23:24] + P[:, 24:25]) / 2
    for t in range(T):
        img = proj(D.M, P[t]) + D.Inoise[fi[t]]
        img = np.c_[img[:, 0] / W, img[:, 1] / H, D.vis[fi[t]]]
        wd = Pc[t] @ D.Rw + D.Wnoise[fi[t]]
        f = {'img': np.round(img, 5).tolist(), 'world': np.round(wd, 5).tolist()}
        sp_ = D.raw['frames'][fi[t]].get('spread')
        if sp_ is not None: f['spread'] = sp_
        frames.append(f)
        if D.l3fit:
            s, R, c, res = D.l3fit[fi[t]]; l3.append(np.round(s * h36(P[t]) @ R + c + res, 5).tolist())
    raw = {k: D.raw[k] for k in ('fps', 'videoFps', 'width', 'height')}; raw.update(start=0, frames=frames)
    if l3: raw['l3'] = l3
    at = lambda s: int(round((s - ts[0]) * fps))
    truth = {'P': np.round(P, 5).tolist(), 'events': {'fs': at(ev['fs']), 'mer': at(ev['mer']), 'br': at(ev['br'])},
             'height': Ld['h'], 'hand': 'L' if Ld['lefty'] else 'R', 'speed': Ld['mph'], 'view': D.view, 'sp': Ld['sp']}
    return raw, truth

def write(outdir, name, raw, truth):
    for suf, obj in (('raw', raw), ('truth', truth)):
        with gzip.open(outdir / f'{name}.{suf}.json.gz', 'wt') as f: json.dump(obj, f, separators=(',', ':'))

if __name__ == '__main__':
    lm, meta, outdir = sys.argv[1], sys.argv[2], Path(sys.argv[3]); outdir.mkdir(parents=True, exist_ok=True)
    lab = load_lab(lm, meta)
    bench_sp = sorted({f.name[:6] for f in BENCH.glob('*_side_open.truth.json.gz')})
    # the benchmark's lefty (3036) is stored as a right-handed mirror image, so it can't lend its camera/noise
    donor_sp = [s for s in bench_sp if lab.get(s) and not lab[s]['lefty']]
    m = pd.read_csv(meta).set_index('session_pitch'); bench_users = {int(m.loc[s, 'user']) for s in bench_sp if s in m.index}
    P, med = picks(lab, bench_users)
    print(f'{len(lab)} lab deliveries; median slot {med["slot"]:.0f}°, stride {med["stride"]:.0f}% of height, '
          f'side tilt {med["tilt"]:.0f}°, leg lift to foot strike {med["lift"]:.2f} s')
    for p in P: print(f"  {p['sp']:8s} {p['why']:34s} slot {p['slot']:5.1f}  stride {p['stride']:5.1f}  tilt {p['tilt']:5.1f}  lift {p['lift']:.2f}  {'L' if p['lefty'] else 'R'}")
    if '--list' in sys.argv: sys.exit(0)
    donors = {}
    def donor(sp, v):
        if (sp, v) not in donors: donors[(sp, v)] = Donor(sp, v, lab)
        return donors[(sp, v)]
    if '--selftest' in sys.argv:
        for i, sp in enumerate(bench_sp):
            dsp = [d for d in donor_sp if d != sp][i % (len(donor_sp) - 1)]
            for v in VIEWS:
                D = donor(dsp, v); raw, truth = make(lab[sp], D); write(outdir, f'{sp}_{v}', raw, truth)
            print(f'  remade {sp} from {dsp} (donor lab->truth fit {D.fit_cm:.1f} cm)')
        sys.exit(0)
    json.dump({'picks': P, 'median': med}, open(outdir / 'picks.json', 'w'), indent=1)
    open(outdir / 'exclude_users.txt', 'w').write('\n'.join(str(lab[p['sp']]['user']) for p in P) + '\n')
    for i, p in enumerate(P):
        dsp = donor_sp[i % len(donor_sp)]
        for v in VIEWS:
            D = donor(dsp, v); raw, truth = make(lab[p['sp']], D); write(outdir, f"{p['sp']}_{v}", raw, truth)
        print(f"  made {p['sp']} ({p['why']}) with {dsp}'s tracker noise, {len(truth['P'])} frames")
