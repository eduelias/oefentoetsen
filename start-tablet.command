#!/bin/bash
# Double-click in Finder: starts the server for the tablet (home network) and keeps the Mac awake.
cd "$(dirname "$0")"
echo "Laat dit venster open staan zolang de toets gemaakt wordt."
(sleep 1; open "http://localhost:8765") &
caffeinate -i python3 serve.py --lan
