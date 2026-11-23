"""Start the production service on the platform-provided port."""
import os
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
port = int(os.environ.get('PORT', '5317'))
if not 1 <= port <= 65535:
    raise SystemExit('PORT must be between 1 and 65535')
os.execv(sys.executable, [sys.executable, '-m', 'uvicorn', 'main:app',
    '--app-dir', str(root / 'sai-room-backend'), '--host', '0.0.0.0',
    '--port', str(port), '--workers', '1'])
