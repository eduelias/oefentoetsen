#!/usr/bin/env python3
"""Oefentoetsen: tiny local server (stdlib only).

Serves the static player and stores attempts in results/.

  python3 serve.py            # http://localhost:8765
  python3 serve.py --port 9000
  python3 serve.py --lan      # also reachable from other devices on the home network (tablet)

API
  GET  /api/tests             -> [{id, title, subject, group, emoji, lesson, archived}]
  GET  /api/results           -> [{file, test, student, submitted, auto, manual_done, points, max, cijfer?}]
  GET  /api/results/<file>    -> attempt JSON
  POST /api/results           -> save attempt, returns {file}
  POST /api/grade/<file>      -> merge {"manual": {...}} into an attempt
  POST /api/progress          -> overwrite results/progress/<testId>.json (unfinished attempt, from autosave);
                                 for lesson logs (les-*) earlier answers and done:true are kept (merge, never wiped)
  GET  /api/progress/<testId> -> that progress file, or {} (lesson.js loads its earlier log on open)
  GET  /api/lessons           -> {lessonId: {done, updated, solved, total}} from results/progress/les-*.json
  GET  /api/switch            -> {on, until}            Switch lesson mode (captive portal, see --portal-port)
  POST /api/switch            -> {"minutes": n} on / {"minutes": 0} off (from the Switch itself: only "off")

Switch portal (--portal-port 80, optional): a DNS rewrite on your own network (e.g. AdGuard Home) points the Switch's connection test (ctest.cdn.nintendo.net,
conntest.nintendowifi.net) at this host. Normally we answer it ourselves with 200 + "X-Organization: Nintendo" (all the Switch checks), so it is
online as usual. While lesson mode is on, the test gets our page instead (no X-Organization header), so the Switch opens its
built-in browser on rekenlessen.html.
"""
import argparse
import http.server
import json
import re
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TESTS = ROOT / "tests"
RESULTS = ROOT / "results"
PROGRESS = RESULTS / "progress"  # live copy of an unfinished attempt, one file per test
SAFE = re.compile(r"^[A-Za-z0-9._-]+\.json$")
KEYFILE = ROOT / "grade.key"  # grading code; created on first start, never served
SWITCH_STATE = RESULTS / "switch" / "mode.json"  # {"until": epoch seconds}; lesson mode is on while now < until


def switch_until():
    try:
        return float(json.loads(SWITCH_STATE.read_text()).get("until", 0))
    except (OSError, ValueError):
        return 0.0


def set_switch(minutes):
    SWITCH_STATE.parent.mkdir(parents=True, exist_ok=True)
    until = time.time() + minutes * 60 if minutes > 0 else 0
    SWITCH_STATE.write_text(json.dumps({"until": until, "set": time.strftime("%Y-%m-%d %H:%M:%S")}))
    return until


def grade_key():
    if not KEYFILE.exists():
        import secrets
        KEYFILE.write_text(secrets.token_hex(4) + "\n")
        KEYFILE.chmod(0o600)
    return KEYFILE.read_text().strip()


def total_points(r):
    """Final score of an attempt: auto points per question, overridden by manual points (open questions, leniency)."""
    manual = r.get("manual", {})
    pts = 0.0
    for qid, pq in (r.get("perQuestion") or {}).items():
        m = manual.get(qid)
        pts += m["points"] if isinstance(m, dict) and m.get("points") is not None else (pq.get("points") or 0)
    mx = r.get("max") or sum(pq.get("max", 0) for pq in (r.get("perQuestion") or {}).values())
    out = {"points": round(pts, 1), "max": mx}
    if manual.get("_done") and mx:
        out["cijfer"] = round(pts / mx * 9 + 1, 1)
    return out


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def log_message(self, fmt, *args):
        if "/api/" in str(args[0] if args else ""):
            super().log_message(fmt, *args)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False, indent=2).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        path = self.path.split("?")[0]
        if path.endswith(("grade.key", ".py")) or path.startswith("/results"):
            return self._json({"error": "not found"}, 404)
        if self.path == "/api/tests":
            out = []
            for f in sorted(TESTS.glob("*/test.json")):
                t = json.loads(f.read_text())
                out.append({k: t.get(k) for k in ("id", "title", "subject", "group", "student", "emoji", "lesson", "archived")} | {"id": f.parent.name})
            return self._json(out)
        if self.path == "/api/results":
            out = []
            for f in sorted(RESULTS.glob("*.json"), reverse=True):
                r = json.loads(f.read_text())
                out.append({
                    "file": f.name,
                    "test": r.get("testId"),
                    "title": r.get("title"),
                    "student": r.get("student"),
                    "submitted": r.get("submitted"),
                    "auto": r.get("auto"),
                    "manual_done": bool(r.get("manual", {}).get("_done")),
                    **total_points(r),
                })
            return self._json(out)
        if self.path == "/api/lessons":
            out = {}
            for f in sorted(PROGRESS.glob("les-*.json")):
                try:
                    p = json.loads(f.read_text())
                except ValueError:
                    continue
                ans = p.get("answers") or {}
                out[f.stem[4:]] = {"done": bool(p.get("done")), "updated": p.get("updated"), "page": p.get("page"),
                                   "solved": sum(1 for a in ans.values() if a.get("ok")), "tried": len(ans)}
            return self._json(out)
        if self.path == "/api/switch":
            u = switch_until()
            return self._json({"on": time.time() < u, "until": time.strftime("%H:%M", time.localtime(u)) if u else None})
        m = re.match(r"^/api/progress/([A-Za-z0-9-]+)$", path)
        if m:
            f = PROGRESS / f"{m.group(1)}.json"
            try:
                return self._json(json.loads(f.read_text()) if f.exists() else {})
            except ValueError:
                return self._json({})
        m = re.match(r"^/api/results/(.+)$", self.path)
        if m:
            name = m.group(1)
            if not SAFE.match(name) or not (RESULTS / name).exists():
                return self._json({"error": "not found"}, 404)
            return self._json(json.loads((RESULTS / name).read_text()))
        return super().do_GET()

    def do_POST(self):
        if self.path == "/api/results":
            r = self._body()
            RESULTS.mkdir(exist_ok=True)
            stamp = time.strftime("%Y-%m-%d_%H%M%S")
            name = f"{stamp}_{re.sub(r'[^A-Za-z0-9-]', '', r.get('testId', 'toets'))}.json"
            r["submitted"] = time.strftime("%Y-%m-%d %H:%M")
            r["file"] = name
            (RESULTS / name).write_text(json.dumps(r, ensure_ascii=False, indent=2))
            (PROGRESS / f"{re.sub(r'[^A-Za-z0-9-]', '', r.get('testId', ''))}.json").unlink(missing_ok=True)
            return self._json({"file": name})
        if self.path == "/api/progress":
            r = self._body()
            PROGRESS.mkdir(parents=True, exist_ok=True)
            r["updated"] = time.strftime("%Y-%m-%d %H:%M:%S")
            name = re.sub(r"[^A-Za-z0-9-]", "", r.get("testId", "toets")) or "toets"
            f = PROGRESS / f"{name}.json"
            if name.startswith("les-") and f.exists():
                # a reopened lesson must never wipe the earlier log: keep old answers it doesn't mention, and keep done
                try:
                    old = json.loads(f.read_text())
                except ValueError:
                    old = {}
                r["answers"] = {**(old.get("answers") or {}), **(r.get("answers") or {})}
                r["done"] = bool(old.get("done") or r.get("done"))
            f.write_text(json.dumps(r, ensure_ascii=False, indent=2))
            return self._json({"ok": True})
        if self.path == "/api/switch":
            minutes = float(self._body().get("minutes", 0))
            local = self.client_address[0] in ("127.0.0.1", "::1")
            if minutes > 0 and not local and self.headers.get("X-Grade-Key", "") != grade_key():
                return self._json({"error": "nakijkcode nodig"}, 403)  # turning it ON is for parents; OFF is allowed for everyone
            set_switch(min(minutes, 240))
            return self._json({"ok": True, "on": minutes > 0})
        m = re.match(r"^/api/grade/(.+)$", self.path)
        if m:
            local = self.client_address[0] in ("127.0.0.1", "::1")
            if not local and self.headers.get("X-Grade-Key", "") != grade_key():
                return self._json({"error": "nakijkcode nodig"}, 403)
            name = m.group(1)
            path = RESULTS / name
            if not SAFE.match(name) or not path.exists():
                return self._json({"error": "not found"}, 404)
            r = json.loads(path.read_text())
            r.setdefault("manual", {}).update(self._body().get("manual", {}))
            path.write_text(json.dumps(r, ensure_ascii=False, indent=2))
            return self._json({"ok": True})
        return self._json({"error": "unknown endpoint"}, 404)


def lan_ip():
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))  # UDP connect sends nothing; it only picks the outgoing interface
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "?"


PORTAL_TARGET = "http://localhost:8765/rekenlessen.html"  # set in main to this host's LAN address
PORTAL_HTML = """<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>Rekenlessen</title>
<meta http-equiv="refresh" content="1;url={0}"></head>
<body style="font-family:sans-serif;font-size:32px;text-align:center;padding:60px">
<p>📚 Rekenlessen worden geopend…</p><p><a href="{0}" style="font-size:40px">▶ Naar de rekenlessen</a></p>
<script>location.replace("{0}")</script></body></html>"""


class PortalHandler(http.server.BaseHTTPRequestHandler):
    """Port 80: answers the Switch's connection test. Lesson mode -> our page; otherwise 200 + X-Organization: Nintendo."""
    timeout = 15

    def log_message(self, fmt, *args):
        print(f"[portal] {self.client_address[0]} {self.headers.get('Host', '')} {fmt % args}", flush=True)

    def do_GET(self):
        host = (self.headers.get("Host") or "").split(":")[0]
        if time.time() < switch_until() or not host.endswith((".nintendo.net", ".nintendowifi.net")):
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            page = PORTAL_HTML.format(PORTAL_TARGET).encode()
            self.send_header("Content-Length", str(len(page)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(page)
            return
        # Normal mode: answer the connection test ourselves with what the Switch checks for (200 + X-Organization).
        # Forwarding to Nintendo is not reliable: their ctest CDN (Akamai) answers 403 to requests relayed through a home server.
        body = b"ok"
        self.send_response(200)
        self.send_header("X-Organization", "Nintendo")
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    do_HEAD = do_GET


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--lan", action="store_true", help="listen on the home network too (for the tablet)")
    ap.add_argument("--portal-port", type=int, default=0, help="also answer the Switch connection test on this port (80)")
    args = ap.parse_args()
    RESULTS.mkdir(exist_ok=True)
    grade_key()
    host = "0.0.0.0" if args.lan else "127.0.0.1"
    print(f"Oefentoetsen draait op http://localhost:{args.port}  (Ctrl+C om te stoppen)")
    if args.lan:
        import socket
        print(f"Op de tablet:  http://{lan_ip()}:{args.port}   of   http://{socket.gethostname().removesuffix('.local')}.local:{args.port}")
    if args.portal_port:
        PORTAL_TARGET = f"http://{lan_ip()}:{args.port}/rekenlessen.html"
        portal = ThreadingHTTPServer((host, args.portal_port), PortalHandler)
        threading.Thread(target=portal.serve_forever, daemon=True).start()
        print(f"Switch-portaal op poort {args.portal_port}")
    ThreadingHTTPServer((host, args.port), Handler).serve_forever()
