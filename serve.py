#!/usr/bin/env python3
"""Serve a single-page app: real files if they exist, index.html if they do not.

WHY THIS EXISTS. `python -m http.server` was serving the Meshtastic client, and the client
routes on the path — it redirects `/` to `/messages/broadcast/0`. Reloading that URL asks
the static server for a FILE at that path, which does not exist, so Peter got:

    Error code: 404
    Message: File not found.

and then "nothing is connected", because the 404 page is not the app at all. Nothing to do
with their client or with mesh-gw; a plain file server cannot host a path-routed SPA.

So: anything that exists on disk is served as itself, and anything that does not falls back
to index.html, which is what every SPA host does. A missing ASSET still 404s — the fallback
is only for extensionless paths, so a genuinely missing .js or .png reports itself instead
of silently returning HTML, which is the failure mode that wastes an afternoon.
"""
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = sys.argv[1]
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8089


class SPAHandler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def send_head(self):
        path = self.translate_path(self.path)
        # A directory or an existing file behaves exactly as before.
        if os.path.isdir(path) or os.path.exists(path):
            return super().send_head()
        # AN EXTENSION MEANS AN ASSET, and a missing asset must say so. Only a route —
        # which has no extension — falls back to the app.
        _, ext = os.path.splitext(self.path.split("?")[0])
        if ext:
            return super().send_head()
        self.path = "/index.html"
        return super().send_head()

    def end_headers(self):
        # NO CACHING, because this is a build being replaced under the browser while it is
        # being tested, and a cached index.html pointing at a deleted bundle looks exactly
        # like the app being broken.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        # Timestamped, so a request burst can be read against the gateway's own log.
        sys.stderr.write("%s %s\n" % (self.log_date_time_string(), fmt % args))


ThreadingHTTPServer.allow_reuse_address = True
srv = ThreadingHTTPServer(("0.0.0.0", PORT), SPAHandler)
print(f"serving {ROOT} on 0.0.0.0:{PORT} with SPA fallback", flush=True)
srv.serve_forever()
