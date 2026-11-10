// Feole Pitching: keeps just the analysed pitch as a small video for Recent, instead of the whole uploaded file.
// A 60 s 4K phone clip is 300 MB+, and some iPhones cap a site at about 1 GB, so saving whole uploads fills the phone
// after a few pitches. While the tracker steps through the pitch frame by frame anyway, each frame it looks at is also
// written to a new MP4 (H.264, at most 1280 px on the long side): frame i at time i / fps, one frame per skeleton frame,
// so the overlay lines up exactly. If this browser can't write video, or anything goes wrong, nothing changes: the whole
// upload is saved as before.

const LONG = 1280;

function loadMuxer() {
  if (window.Mp4Muxer) return Promise.resolve();
  return new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = "lib/mp4-muxer.min.js"; sc.onload = res; sc.onerror = () => rej(new Error("couldn't load the video writer")); document.head.append(sc) });
}

// W, H: the video's size; fps: frames per second of the tracker's steps. Returns null if this browser can't do it.
export async function clipKeeper(W, H, fps) {
  try {
    if (!window.VideoEncoder || !window.VideoFrame || !(fps > 0)) return null;
    await loadMuxer();
    const k = Math.min(1, LONG / Math.max(W, H)), w = Math.max(2, Math.round(W * k / 2) * 2), h = Math.max(2, Math.round(H * k / 2) * 2);
    const bitrate = Math.round(Math.min(8e6, Math.max(2e6, w * h * 30 * 0.1)));
    let cfg = null, mcodec = "avc";
    for (const [codec, mc] of [["avc1.640028", "avc"], ["avc1.4d0028", "avc"], ["avc1.42e028", "avc"], ["vp09.00.40.08", "vp9"]]) {
      const c = { codec, width: w, height: h, bitrate, framerate: Math.round(fps) };
      try { if ((await VideoEncoder.isConfigSupported(c)).supported) { cfg = c; mcodec = mc; break } } catch (e) {}
    }
    if (!cfg) return null;
    const muxer = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: mcodec, width: w, height: h, frameRate: Math.round(fps) }, fastStart: "in-memory" });
    let err = null, n = 0, done = false;
    const enc = new VideoEncoder({ output: (chunk, meta) => { try { muxer.addVideoChunk(chunk, meta) } catch (e) { err = e } }, error: e => { err = e } });
    enc.configure(cfg);
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h; const g = cv.getContext("2d");
    const step = 1e6 / fps, keyEvery = Math.max(1, Math.round(fps / 2));      // a key frame every 1/2 s: quick, exact seeking
    return {
      // the video element showing frame i (called in order, i = 0, 1, 2 …)
      async add(v) {
        if (err || done) return;
        try {
          g.drawImage(v, 0, 0, w, h);
          const fr = new VideoFrame(cv, { timestamp: Math.round(n * step), duration: Math.round(step) });
          enc.encode(fr, { keyFrame: n % keyEvery === 0 }); fr.close(); n++;
          if (enc.encodeQueueSize > 8) await new Promise(r => setTimeout(r, 0));
        } catch (e) { err = e }
      },
      // the finished MP4, or null if it failed
      async finish() {
        if (done) return null; done = true;
        try { await enc.flush(); enc.close(); if (err || !n) return null; muxer.finalize(); return new Blob([muxer.target.buffer], { type: "video/mp4" }) }
        catch (e) { console.warn("Feole: couldn't keep the trimmed pitch video", e); return null }
      },
      frames: () => n,
    };
  } catch (e) { console.warn("Feole: no trimmed pitch video", e); return null }
}
