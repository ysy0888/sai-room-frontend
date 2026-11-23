"""Vercel ASGI entrypoint; serve the frontend and API from the same origin."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / 'sai-room-backend'))
from main import app  # noqa: E402,F401
