# Saving a pitch when the browser's storage misbehaves: the results must still open, and the coach must be told.
#   python3 tools/test/serve.py . 8766 &
#   python3 tools/test/storage_check.py
# Three cases, each in a fresh page: (1) storage full when the video is stored (the save is cut off, as a phone with a full
# disk does) -> saved without the video, with a note; (2) storage that never answers (seen on some iPhones: the database
# never opens) -> the save gives up within seconds instead of leaving the coach on "Building" forever; (3) normal save
# still stores the video and shows no note. Exits 1 on a failure or a page error. THREE_JS / ORBIT_JS as in clip_run.py.
import sys, os, time
from playwright.sync_api import sync_playwright
URL = os.environ.get("APP_URL", "http://127.0.0.1:8766/"); T3, ORB = os.environ.get("THREE_JS"), os.environ.get("ORBIT_JS")
bad, errs = [], []
FULL = """() => { const add = IDBObjectStore.prototype.add, put = IDBObjectStore.prototype.put;
  // a full disk: storing anything with a video in it aborts the whole write, the way a quota error does
  const cut = function (f) { return function (v, ...a) { if (v && v.blob) { const t = this.transaction; const r = f.call(this, v, ...a); setTimeout(() => { try { t.abort() } catch (e) {} }, 0); return r } return f.call(this, v, ...a) } };
  IDBObjectStore.prototype.add = cut(add); IDBObjectStore.prototype.put = cut(put) }"""
HANG = """() => { indexedDB.open = () => ({}) }"""   # a request whose callbacks never fire
SAVE = """async () => { const t0 = performance.now(); const id = await window.__saveHistory({ name: 'P', throwHand: 'R', frames: 100, fps: 60 }, new Blob(['x'.repeat(5000)], { type: 'video/webm' }));
  return [id, Math.round(performance.now() - t0), window.__saveNote || ''] }"""
STORED = """() => new Promise((res, rej) => { const r = indexedDB.open('charney-pitching', 1); r.onsuccess = () => { const q = r.result.transaction('analyses').objectStore('analyses').getAll();
  q.onsuccess = () => res(q.result.map(x => !!x.blob)) }; r.onerror = () => rej(r.error) })"""
if __name__ == "__main__":
  with sync_playwright() as p:
      b = p.chromium.launch()
      for case in ("full", "hang", "normal"):
          ctx = b.new_context(viewport={"width": 1280, "height": 900}); pg = ctx.new_page()
          if T3: pg.route("**/three.min.js", lambda r: r.fulfill(path=T3, content_type="application/javascript"))
          if ORB: pg.route("**/OrbitControls.js", lambda r: r.fulfill(path=ORB, content_type="application/javascript"))
          pg.route("https://fonts.googleapis.com/**", lambda r: r.fulfill(body="", content_type="text/css"))
          pg.on("pageerror", lambda e: errs.append(str(e)))
          pg.goto(URL); pg.wait_for_timeout(1500)
          if case == "full": pg.evaluate(FULL)
          if case == "hang": pg.evaluate(HANG)
          try: id_, ms, note = pg.evaluate(f"() => Promise.race([({SAVE})(), new Promise(r => setTimeout(() => r(['STUCK', 30000, '']), 30000))])")
          except Exception as e: id_, ms, note = "ERR " + str(e)[:100], 0, ""
          stored = pg.evaluate(STORED) if case != "hang" else None
          print(f"{case:7s} save -> id {id_}, {ms} ms, stored with video: {stored}, note: {note[:110]!r}")
          if id_ == "STUCK": bad.append(f"{case}: save never finished")
          if case == "full" and (stored != [False] or "video" not in note): bad.append("full: not saved without video, or no note")
          if case == "hang" and (ms > 10000 or not note): bad.append("hang: took too long or no note")
          if case == "normal" and (stored != [True] or note): bad.append("normal save changed")
          ctx.close()
      b.close()
  print("page errors:", errs)
  if errs or bad: print("FAIL", bad); sys.exit(1)
  print("ok")
