# Builds armlib.json from the Driveline OpenBiomechanics landmarks (run next to its common.py loader).
# Library of lab throwing-arm motions (Driveline OpenBiomechanics, 411 pitches): the upper arm and forearm
# directions in the trunk's own axes, 240 samples a second, from 300 ms before release to 120 ms after.
# Stored as signed bytes (direction components x 127), base64. Second file leaves out the benchmark athletes.
import json, base64, numpy as np, sys
from common import *
FPS, T0, T1 = 240, -0.60, 0.25
ts_rel = np.arange(T0, T1 + 1e-9, 1 / FPS); N = len(ts_rel)
bench = open('../bench/pitches.txt').read().split()
bench_users = {meta.loc[sp, 'user'] for sp in bench}
def unit(v): return v / np.linalg.norm(v, axis=-1, keepdims=True)
out_all, out_hold = [], []
for sp in meta.index:
    try: t, J, ev, hand = pitch(sp)
    except Exception as e: continue
    br = ev['BR_time']; ts = br + ts_rel
    if not np.isfinite(br) or br - 0.30 < t[0] or br + 0.12 > t[-1]: continue     # must cover at least -300..+120 ms
    valid = (ts >= t[0]) & (ts <= t[-1])
    I = lambda a: np.stack([np.interp(ts, t, a[:, k]) for k in range(3)], 1)
    S, E, W = I(J['shoulder_jc']), I(J['elbow_jc']), I(J['wrist_jc'])
    Sg, Hr, Hl = I(J['glove_shoulder_jc']), I(J['rear_hip']), I(J['lead_hip'])
    up = unit((S + Sg) / 2 - (Hr + Hl) / 2); r = unit(S - Sg); fw = unit(np.cross(up, r)); r = np.cross(fw, up)   # same trunk axes as the app
    u, f = unit(E - S), unit(W - E)
    B = lambda v: np.stack([(v * r).sum(1), (v * up).sum(1), (v * fw).sum(1)], 1)
    a = np.concatenate([B(u), B(f)], 1)                 # N x 6
    valid &= np.all(np.isfinite(a), 1)
    a = np.where(valid[:, None], a, 0)
    q = np.clip(np.round(a * 127), -127, 127).astype(np.int8); q[~valid] = -128     # -128: not recorded
    rec = {'sp': sp, 'user': int(meta.loc[sp, 'user']), 'fs': (lambda v: round(v, 4) if np.isfinite(v) else None)(float(ev['fp_10_time'] - br)), 'mer': (lambda v: round(v, 4) if np.isfinite(v) else None)(float(ev['MER_time'] - br)), 'd': base64.b64encode(q.tobytes()).decode()}
    out_all.append(rec)
    if meta.loc[sp, 'user'] not in bench_users: out_hold.append(rec)
hdr = {'fps': FPS, 't0': T0, 'n': N, 'note': 'u (upper arm) then f (forearm) in trunk axes [right, up, forward], x127, int8, row-major n x 6; -128 = not recorded'}
json.dump({**hdr, 'pitches': out_all}, open('../app/armlib.json', 'w'), separators=(',', ':'), allow_nan=False)
json.dump({**hdr, 'pitches': out_hold}, open('../bench/armlib_holdout.json', 'w'), separators=(',', ':'), allow_nan=False)
print(len(out_all), 'pitches;', len(out_hold), 'without the benchmark athletes;', N, 'samples')
