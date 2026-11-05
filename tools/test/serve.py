# Serves the site folder locally for tests, with the right content types for .js/.mjs/.wasm.
#   python3 tools/test/serve.py [folder=repo root] [port=8766]
import http.server, functools, sys, os
root = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
port = int(sys.argv[2]) if len(sys.argv) > 2 else 8766
class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
                      '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.json': 'application/json'}
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*'); super().end_headers()
print(f"serving {os.path.abspath(root)} on http://127.0.0.1:{port}", flush=True)
http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(H, directory=root)).serve_forever()
