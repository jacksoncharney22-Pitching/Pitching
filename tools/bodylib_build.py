# Builds bodylib.json: a compact model of whole-body pitching deliveries, from the Driveline OpenBiomechanics
# landmarks (411 lab pitches; see TODO.md "the pitching-aware rebuild" for how to download landmarks.csv and
# metadata.csv; keep both OUTSIDE this repo, it is the public website).
#
# Why: the rebuild fits a whole believable delivery to the video instead of building the body frame by frame.
# This is step 1, the "space of real deliveries" that fit searches in.
#
# Every pitch is turned into the same shape so pitches can be averaged and compared:
#   - right-handed (left-handers mirrored: the lab names joints throwing/glove side, so only the side axis flips),
#   - lab axes: x toward the plate, y toward a right-hander's glove side... (lab y, kept), z up,
#   - origin: the back (pivot) ankle on the ground at the start of the window; sizes divided by the pitcher's height,
#   - time-warped to the delivery's own events, a fixed number of samples per phase:
#       0.25 s before peak leg lift | leg lift -> foot strike | foot strike -> max layback | max layback -> release |
#       0.09 s after release.
# Then a PCA (principal shapes) over all those normalised deliveries: the mean delivery plus K shapes of how
# pitchers differ. Phase durations (seconds) are stored too, for the fit's timing.
#
# usage: python3 tools/bodylib_build.py <landmarks.csv> <metadata.csv> [--eval]
#   writes bodylib.json (all pitches) and tools/test/bench/bodylib_holdout.json (benchmark athletes left out);
#   --eval prints how well K shapes rebuild the benchmark pitches they never saw (cm, per joint).
import sys, json, base64, numpy as np, pandas as pd
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JOINTS = ['rear_ankle_jc', 'rear_knee_jc', 'rear_hip', 'lead_ankle_jc', 'lead_knee_jc', 'lead_hip',
          'shoulder_jc', 'elbow_jc', 'wrist_jc', 'hand_jc', 'glove_shoulder_jc', 'glove_elbow_jc', 'glove_wrist_jc',
          'glove_hand_jc', 'thorax_prox', 'thorax_dist', 'thorax_ap']
PHASES = [('pre', 12), ('pkh_fs', 30), ('fs_mer', 12), ('mer_br', 6), ('post', 6)]   # samples per phase
PRE, POST = 0.25, 0.09
NS = sum(n for _, n in PHASES)

def warp_times(ev):
    """the lab times of the NS canonical samples (piecewise linear between events)"""
    knots = [ev['pkh'] - PRE, ev['pkh'], ev['fs'], ev['mer'], ev['br'], ev['br'] + POST]
    ts = []
    for k, (_, n) in enumerate(PHASES):
        a, b = knots[k], knots[k + 1]
        ts += list(a + (b - a) * np.arange(n) / n)
    return np.array(ts)

def load(lm_csv, meta_csv):
    d = pd.read_csv(lm_csv); meta = pd.read_csv(meta_csv).set_index('session_pitch')
    out = []
    for sp, p in d.groupby('session_pitch', sort=False):
        t = p.time.values; r = p.iloc[0]
        ev = dict(pkh=r.pkh_time, fs=r.fp_10_time, mer=r.MER_time, br=r.BR_time)
        if not all(np.isfinite(v) for v in ev.values()): continue
        # plausible deliveries only: a real leg lift and a foot strike in the usual place
        if not (0.3 < ev['fs'] - ev['pkh'] < 1.1 and 0.04 < ev['mer'] - ev['fs'] < 0.3 and 0 < ev['br'] - ev['mer'] < 0.08): continue
        if ev['pkh'] - PRE < t[0] or ev['br'] + POST > t[-1] + 1e-6: continue
        if sp not in meta.index: continue
        h = float(meta.loc[sp, 'session_height_m'])
        ts = warp_times(ev)
        J = np.stack([np.stack([np.interp(ts, t, p[f'{j}_{a}'].values) for a in 'xyz'], 1) for j in JOINTS], 1)   # NS x nJ x 3
        if not np.all(np.isfinite(J)): continue
        # handedness: at release a right-hander's throwing shoulder is on the -y side of the glove shoulder
        ib = PHASES[0][1] + PHASES[1][1] + PHASES[2][1] + PHASES[3][1]
        lefty = J[ib, 6, 1] - J[ib, 10, 1] > 0
        if lefty: J[..., 1] *= -1
        J[..., 0] -= J[0, 0, 0]; J[..., 1] -= J[0, 0, 1]     # back ankle at the start = origin on the ground
        # heading: turn about the vertical so the stride (back ankle at the start -> front ankle at foot strike) points
        # along +x. The fit finds the camera's direction anyway, so where the lab's plate line happened to be is noise.
        ifs = PHASES[0][1] + PHASES[1][1]
        a = np.arctan2(J[ifs, 3, 1], J[ifs, 3, 0]); c, s_ = np.cos(-a), np.sin(-a)
        x, y = J[..., 0].copy(), J[..., 1].copy(); J[..., 0] = c * x - s_ * y; J[..., 1] = s_ * x + c * y
        J /= h
        dur = [ev['fs'] - ev['pkh'], ev['mer'] - ev['fs'], ev['br'] - ev['mer']]
        out.append(dict(sp=sp, user=int(meta.loc[sp, 'user']), h=h, lefty=bool(lefty), J=J, dur=dur,
                        mph=float(meta.loc[sp, 'pitch_speed_mph'])))
    return out

def pca(X, K):
    mu = X.mean(0); U, S, Vt = np.linalg.svd(X - mu, full_matrices=False)
    sd = S[:K] / np.sqrt(len(X) - 1)
    return mu, Vt[:K], sd, (S ** 2) / (S ** 2).sum()

def pack(P, K):
    X = np.stack([p['J'].ravel() for p in P]); mu, V, sd, ev = pca(X, K)
    D = np.array([p['dur'] for p in P])
    # components stored as int16 of (component x 32767); mean as float32 (base64)
    b64 = lambda a: base64.b64encode(a.tobytes()).decode()
    return {
        'note': 'Whole-body lab deliveries, right-handed, x toward the plate, y lab side, z up, divided by height, '
                'origin = back ankle at window start. Delivery = mean + sum(c_k * sd_k * comp_k), c ~ N(0,1). '
                'Sample layout NS x joints x 3 (row-major). mean float32 base64; comps int16 base64 (/32767).',
        'joints': JOINTS, 'phases': PHASES, 'pre': PRE, 'post': POST, 'ns': NS, 'k': K, 'n_pitches': len(P),
        'mean': b64(mu.astype(np.float32)), 'comps': b64(np.round(V * 32767).astype(np.int16)),
        'sd': [round(float(s), 6) for s in sd], 'explained': [round(float(e), 5) for e in ev[:K]],
        'dur_mean': [round(float(v), 4) for v in D.mean(0)], 'dur_sd': [round(float(v), 4) for v in D.std(0)],
        'dur_corr': np.round(np.corrcoef(D.T), 3).tolist(),
    }

def evaluate(P, bench_users):
    tr = [p for p in P if p['user'] not in bench_users]; te = [p for p in P if p['user'] in bench_users]
    X = np.stack([p['J'].ravel() for p in tr]); Y = np.stack([p['J'].ravel() for p in te])
    mu, V, sd, ev = pca(X, 80)
    nJ = len(JOINTS)
    print(f'{len(tr)} library pitches, {len(te)} benchmark-athlete pitches held out')
    print(' K   var%   held-out joint error cm (mean / throwing hand / 90th pct)')
    for K in [0, 3, 5, 10, 15, 20, 30, 40, 60, 80]:
        Vk = V[:K]; R = mu + ((Y - mu) @ Vk.T) @ Vk
        e = np.linalg.norm((R - Y).reshape(len(te), NS, nJ, 3), axis=-1) * np.array([p['h'] for p in te])[:, None, None] * 100
        print(f'{K:3d} {100 * ev[:K].sum():6.1f}   {e.mean():5.1f} / {e[:, :, 9].mean():5.1f} / {np.percentile(e, 90):5.1f}')

if __name__ == '__main__':
    lm, meta = sys.argv[1], sys.argv[2]
    P = load(lm, meta)
    bench_sp = [f.name.split('_')[0] + '_' + f.name.split('_')[1] for f in (ROOT / 'tools/test/bench').glob('*_side_open.truth.json.gz')]
    m = pd.read_csv(meta).set_index('session_pitch'); bench_users = {int(m.loc[s, 'user']) for s in bench_sp if s in m.index}
    print(len(P), 'deliveries kept;', sum(p['lefty'] for p in P), 'left-handed (mirrored);', len(bench_users), 'benchmark athletes')
    if '--eval' in sys.argv: evaluate(P, bench_users)
    K = int(__import__("os").environ.get("BODYLIB_K", 80))
    json.dump(pack(P, K), open(ROOT / 'bodylib.json', 'w'), separators=(',', ':'))
    json.dump(pack([p for p in P if p['user'] not in bench_users], K), open(ROOT / 'tools/test/bench/bodylib_holdout.json', 'w'), separators=(',', ':'))
    print('wrote bodylib.json', (ROOT / 'bodylib.json').stat().st_size // 1024, 'KB')
