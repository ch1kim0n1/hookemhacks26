"""Vercel serverless handler — individual endpoint approach."""

import sys
import json
from pathlib import Path
from http.server import BaseHTTPRequestHandler

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from detector.verdict import detect
from extractor import extract_all
from skill.handler import scan_only
from store import sqlite as db


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/api/health':
            self._json({"status": "ok"})
        elif path.startswith('/api/detections'):
            self._json(db.get_recent_detections(50))
        elif path.startswith('/api/stats'):
            self._json(db.get_stats())
        elif path.startswith('/api/threats'):
            self._json(db.get_all_cached_threats(100))
        else:
            self._json({"error": "not found"}, 404)

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)

        path = self.path.split('?')[0]
        if path in ('/api/scan', '/api/replay'):
            try:
                data = json.loads(body)
                content = data.get('content', '')
                tool_name = data.get('tool_name', 'manual')
                result = scan_only(content, tool_name=tool_name)
                self._json(result)
            except Exception as e:
                self._json({"error": str(e)}, 500)
        else:
            self._json({"error": "not found"}, 404)

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors_headers()
        self.end_headers()

    def _json(self, data, status=200):
        self.send_response(status)
        self._cors_headers()
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data, default=str).encode())

    def _cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
