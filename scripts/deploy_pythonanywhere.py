#!/usr/bin/env python3
"""Deploy the public xiuqiu frontend to an existing PythonAnywhere web app."""

from __future__ import annotations

import mimetypes
import os
import sys
from pathlib import Path
from urllib.parse import quote

import requests


ROOT = Path(__file__).resolve().parents[1]
USERNAME = os.environ.get("PYTHONANYWHERE_USERNAME", "dupeng")
HOST = os.environ.get("PYTHONANYWHERE_HOST", "www.pythonanywhere.com")
DOMAIN = os.environ.get("PYTHONANYWHERE_DOMAIN", f"{USERNAME}.pythonanywhere.com")
TOKEN = os.environ.get("PYTHONANYWHERE_API_TOKEN", "").strip()
REMOTE_ROOT = f"/home/{USERNAME}/xiuqiu-website"
PUBLIC_URL = "/xiuqiu/"


def fail(message: str) -> None:
    print(f"Deployment failed: {message}", file=sys.stderr)
    raise SystemExit(1)


if not TOKEN:
    fail("GitHub Secret PYTHONANYWHERE_API_TOKEN is not configured")


session = requests.Session()
session.headers.update({"Authorization": f"Token {TOKEN}"})


def require_ok(response: requests.Response, action: str) -> requests.Response:
    if response.ok:
        return response
    detail = response.text[:500].replace(TOKEN, "[redacted]")
    fail(f"{action} returned HTTP {response.status_code}: {detail}")


def deployment_files() -> list[Path]:
    files = [ROOT / "index.html", ROOT / "chapter.html", ROOT / "3d-model.html"]
    files.extend(path for path in (ROOT / "lib").rglob("*") if path.is_file())
    missing = [str(path.relative_to(ROOT)) for path in files if not path.exists()]
    if missing:
        fail(f"required local files are missing: {', '.join(missing)}")
    return files


def upload(path: Path) -> None:
    relative = path.relative_to(ROOT).as_posix()
    remote_path = f"{REMOTE_ROOT}/{relative}"
    endpoint = (
        f"https://{HOST}/api/v0/user/{USERNAME}/files/path"
        f"{quote(remote_path, safe='/')}"
    )
    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    with path.open("rb") as source:
        response = session.post(
            endpoint,
            files={"content": (path.name, source, content_type)},
            timeout=90,
        )
    require_ok(response, f"uploading {relative}")
    print(f"Uploaded {relative}")


def configure_static_mapping() -> None:
    endpoint = (
        f"https://{HOST}/api/v0/user/{USERNAME}/webapps/"
        f"{DOMAIN}/static_files/"
    )
    response = require_ok(session.get(endpoint, timeout=30), "listing static mappings")
    mappings = response.json()
    existing = next((item for item in mappings if item.get("url") == PUBLIC_URL), None)
    payload = {"url": PUBLIC_URL, "path": REMOTE_ROOT}
    if existing:
        mapping_id = existing["id"]
        require_ok(
            session.patch(f"{endpoint}{mapping_id}/", data=payload, timeout=30),
            "updating the /xiuqiu/ static mapping",
        )
        print("Updated /xiuqiu/ static mapping")
    else:
        require_ok(
            session.post(endpoint, data=payload, timeout=30),
            "creating the /xiuqiu/ static mapping",
        )
        print("Created /xiuqiu/ static mapping")


def reload_webapp() -> None:
    endpoint = (
        f"https://{HOST}/api/v0/user/{USERNAME}/webapps/"
        f"{DOMAIN}/reload/"
    )
    require_ok(session.post(endpoint, timeout=60), "reloading the web app")
    print(f"Published: https://{DOMAIN}{PUBLIC_URL}index.html")


def main() -> None:
    for path in deployment_files():
        upload(path)
    configure_static_mapping()
    reload_webapp()


if __name__ == "__main__":
    main()
