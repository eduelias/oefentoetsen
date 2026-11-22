#!/bin/bash
# Double-click in Finder: starts the server and opens the browser.
cd "$(dirname "$0")"
(sleep 1; open "http://localhost:8765") &
python3 serve.py
