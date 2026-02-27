"""CLI entry point: ``effi-analysis`` launches the backend + production UI."""

from __future__ import annotations

import argparse
import subprocess
import sys
import webbrowser
from pathlib import Path


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="effi-analysis",
        description="Launch the Effi reactor cycle-analysis web app.",
    )
    parser.add_argument("--port", type=int, default=8000, help="Port to serve on (default: 8000)")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind (default: 127.0.0.1)")
    parser.add_argument("--no-browser", action="store_true", help="Don't open a browser window")
    args = parser.parse_args(argv)

    # Ensure the production build exists
    dist = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
    if not dist.is_dir():
        print(f"⚠  Frontend build not found at {dist}")
        print("   Run: cd frontend && npm run build")
        sys.exit(1)

    url = f"http://{args.host}:{args.port}/app"
    print(f"Starting Effi Analysis at {url}")

    if not args.no_browser:
        # Open browser after a short delay so the server can start
        import threading
        threading.Timer(1.5, webbrowser.open, args=(url,)).start()

    import uvicorn
    uvicorn.run("backend.effi.api:app", host=args.host, port=args.port)


if __name__ == "__main__":
    main()
