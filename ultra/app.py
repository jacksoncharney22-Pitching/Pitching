# Feole Pitching "Ultra": GVHMR (SIGGRAPH Asia 2024; world-grounded 3D human motion) on a cloud GPU (Modal).
# The browser sends the pitching video and the chosen window; this returns the 3D joints of the SMPL-X body for
# every video frame (camera axes and world axes), the camera's intrinsics and the 2D keypoints it saw.
#
# Deployed by .github/workflows/ultra.yml with the repo secrets MODAL_TOKEN_ID / MODAL_TOKEN_SECRET.
# The SMPL-X body model is registration-gated (smpl-x.is.tue.mpg.de): it's fetched with the owner's login, kept in
# the Modal secret "smplx" (SMPLX_USER / SMPLX_PW), and never stored in this repo.
import modal

app = modal.App("feole-ultra")
cache = modal.Volume.from_name("feole-ultra-cache", create_if_missing=True)
CACHE = "/cache"
ALLOWED = ["https://sunny-marshmallow-78536f.netlify.app", "http://127.0.0.1:8766", "http://localhost:8766"]

image = (
    modal.Image.from_registry("nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04", add_python="3.11")
    .apt_install("ffmpeg", "git", "libgl1", "libglib2.0-0", "libegl1", "build-essential", "clang")
    .pip_install("torch==2.6.0", "torchvision==0.21.0", index_url="https://download.pytorch.org/whl/cu124")
    # two dependencies are old-style source packages that need numpy/cython present while they build
    .pip_install("numpy<2", "cython", "setuptools<70", "wheel")
    .run_commands("python -m pip install --no-build-isolation chumpy cython-bbox")
    .pip_install("gvhmr[preproc]==1.6.1", "fastapi[standard]", "python-multipart")
    .env({"HF_HOME": f"{CACHE}/hf", "GVHMR_HOME": f"{CACHE}/gvhmr", "XDG_CACHE_HOME": f"{CACHE}/xdg", "TORCH_HOME": f"{CACHE}/torch"})
)


@app.cls(image=image, gpu="L4", secrets=[modal.Secret.from_name("smplx")], volumes={CACHE: cache},
         timeout=900, scaledown_window=120, max_containers=2)
class Ultra:
    @modal.enter()
    def load(self):
        import gvhmr
        self.pipe = gvhmr.pipeline("human-motion-recovery", device="cuda")
        cache.commit()

    def run(self, video_bytes: bytes, start: float, end: float, static: bool) -> dict:
        import json, subprocess, tempfile, os
        import numpy as np, torch
        from gvhmr.inference._smpl import _load_assets
        d = tempfile.mkdtemp()
        src, clip = os.path.join(d, "in"), os.path.join(d, "clip.mp4")
        open(src, "wb").write(video_bytes)
        probe = json.loads(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                                           "stream=width,height,avg_frame_rate,r_frame_rate", "-of", "json", src],
                                          capture_output=True, text=True).stdout)["streams"][0]
        num, den = (probe.get("avg_frame_rate") or probe["r_frame_rate"]).split("/")
        fps = float(num) / float(den or 1)
        # keep EVERY frame: GVHMR works at 30 frames per second, so a 60 or 240 fps clip is handed over as a
        # slowed-down 30 fps clip (frame k of the result = frame k of the chosen window)
        vf = f"setpts=N/(30*TB)"
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{start:.3f}", "-to", f"{end:.3f}", "-i", src,
                        "-vf", vf, "-r", "30", "-an", "-c:v", "libx264", "-crf", "16", "-preset", "veryfast", clip], check=True)
        res = self.pipe(clip, static_camera=static, flip_test=True, progress=False, output_dir=os.path.join(d, "out"))
        smplx, _, _, _ = _load_assets("cuda")
        to = lambda p: {k: v.to("cuda") for k, v in p.items()}
        with torch.no_grad():
            jc = smplx(**to(res.smpl_params_camera)).joints[:, :76].cpu().numpy()
            jw = smplx(**to(res.smpl_params_world)).joints[:, :76].cpu().numpy()
        K = res.intrinsics.cpu().numpy() if hasattr(res.intrinsics, "cpu") else np.asarray(res.intrinsics)
        kp = res.kp2d.cpu().numpy() if res.kp2d is not None and hasattr(res.kp2d, "cpu") else None
        r = lambda a: np.round(a, 4).tolist()
        return {"ok": True, "fps": fps, "start": start, "width": int(probe["width"]), "height": int(probe["height"]),
                "frames": int(jc.shape[0]), "camera": res.camera, "joints_camera": r(jc), "joints_world": r(jw),
                "K": r(K), "kp2d": r(kp) if kp is not None else None, "model": "GVHMR (SMPL-X)"}

    @modal.asgi_app()
    def web(self):
        from fastapi import FastAPI, File, Form, UploadFile
        from fastapi.middleware.cors import CORSMiddleware
        api = FastAPI()
        api.add_middleware(CORSMiddleware, allow_origins=ALLOWED, allow_methods=["*"], allow_headers=["*"])

        @api.get("/health")
        def health():
            return {"ok": True}

        @api.post("/analyze")
        async def analyze(video: UploadFile = File(...), start: float = Form(0.0), end: float = Form(1e9), static: bool = Form(True)):
            try:
                data = await video.read()
                if len(data) > 800 * 1024 * 1024:
                    return {"ok": False, "error": "That video is too large for Ultra (over 800 MB). Trim it or export a smaller copy."}
                return self.run(data, start, end, static)
            except Exception as e:  # report the reason to the app instead of a bare 500
                return {"ok": False, "error": f"{type(e).__name__}: {e}"}

        return api
