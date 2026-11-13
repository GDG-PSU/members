"""Gives a freshly flashed reader its key and stores that key with the website.

    pip install pyserial cryptography
    python provision_reader.py --port COM3            # says which site it would use
    python provision_reader.py --port COM3 --confirm <project-ref>
    python provision_reader.py --port COM3 --clear --confirm <project-ref>

Run it straight after flashing. The reader gets a random key of its own over
the cable, and the same key is stored, sealed, in the site's `reader_keys`
table. From then on every organizer can use that reader, over its cable or over
Bluetooth, and nobody else can.

A reader that already holds a key this site knows is given a new one, inside a
session opened with the old one. `--clear` takes the key off the reader and
forgets it on the site, which is what reader_check.py needs before it runs.
A reader holding a key this site does not know has to be erased
(`pio run -t erase`) and flashed again.

The site is read from NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY (or
SUPABASE_SERVICE_ROLE_KEY) and CARD_WRITE_ENCRYPTION_KEY, taken from the
environment or else from `.env.local` in the repository root. Nothing is
written to a hosted project without `--confirm` and its project ref, which the
first run prints. The key itself is never printed.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from reader_link import PROTOCOL, Cable, b64, key_check, unb64

ROOT = Path(__file__).resolve().parents[3]
NAMES = ("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "CARD_WRITE_ENCRYPTION_KEY")


class Stop(Exception):
    """Something the operator has to put right; the message says what."""


def settings() -> dict[str, str]:
    found: dict[str, str] = {}
    env_file = ROOT / ".env.local"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            name, separator, value = line.strip().partition("=")
            if separator and name in NAMES:
                found[name] = value.strip().strip("\"'")
    # The shell wins, as it does for the scripts in /scripts.
    for name in NAMES:
        if os.environ.get(name):
            found[name] = os.environ[name]
    return found


class Site:
    """The website's database, reached with its service key."""

    def __init__(self, values: dict[str, str]):
        self.url = values.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
        self.service_key = values.get("SUPABASE_SECRET_KEY") or values.get("SUPABASE_SERVICE_ROLE_KEY", "")
        raw = values.get("CARD_WRITE_ENCRYPTION_KEY", "")
        if not self.url or not self.service_key or not raw:
            raise Stop("Set NEXT_PUBLIC_SUPABASE_URL, a Supabase service key and CARD_WRITE_ENCRYPTION_KEY, or put them in .env.local.")
        # The same reading of the variable as lib/security/tokens.ts.
        try:
            decoded = base64.b64decode(raw.replace("-", "+").replace("_", "/") + "=" * (-len(raw) % 4))
        except ValueError:
            decoded = b""
        self.sealing_key = decoded if len(decoded) == 32 else hashlib.sha256(raw.encode()).digest()

        self.host = urllib.parse.urlparse(self.url).hostname or ""
        self.local = self.host in ("localhost", "127.0.0.1", "::1")
        self.ref = self.host.split(".")[0]

    def call(self, method: str, path: str, body: object | None = None):
        request = urllib.request.Request(
            f"{self.url}/rest/v1/{path}",
            method=method,
            data=None if body is None else json.dumps(body).encode(),
            headers={
                "apikey": self.service_key,
                "Authorization": f"Bearer {self.service_key}",
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                text = response.read().decode()
        except urllib.error.HTTPError as error:
            detail = error.read().decode()[:200]
            hint = " Has migration 0021 been applied?" if "reader_key" in detail else ""
            raise Stop(f"The site refused ({error.code}): {detail}{hint}") from None
        except urllib.error.URLError as error:
            raise Stop(f"The site could not be reached: {error.reason}") from None
        return json.loads(text) if text else None

    def seal(self, key: bytes) -> str:
        """lib/security/tokens.ts encryptSecret: v1.<iv>.<tag>.<ciphertext>."""
        iv = os.urandom(12)
        sealed = AESGCM(self.sealing_key).encrypt(iv, b64(key).encode(), None)
        return ".".join(["v1", b64(iv), b64(sealed[-16:]), b64(sealed[:-16])])

    def unseal(self, payload: str) -> bytes:
        version, iv, tag, data = payload.split(".")
        if version != "v1":
            raise ValueError("unsupported")
        return unb64(AESGCM(self.sealing_key).decrypt(unb64(iv), unb64(data) + unb64(tag), None).decode())

    def load(self, device_id: str, version: int) -> bytes | None:
        rows = self.call("GET", f"reader_keys?device_id=eq.{device_id}&version=eq.{version}&select=sealed_key")
        if not rows:
            return None
        try:
            return self.unseal(rows[0]["sealed_key"])
        except Exception:
            # Sealed under a different CARD_WRITE_ENCRYPTION_KEY.
            return None

    def store(self, device_id: str, version: int | None, key: bytes) -> int:
        return int(self.call("POST", "rpc/store_reader_key", {
            "p_device_id": device_id,
            "p_version": version,
            "p_sealed_key": self.seal(key),
            "p_actor": None,
        }))

    def retire(self, device_id: str, version: int) -> None:
        self.call("POST", "rpc/retire_reader_keys", {"p_device_id": device_id, "p_version": version})

    def forget(self, device_id: str) -> None:
        self.call("DELETE", f"reader_keys?device_id=eq.{device_id}")

    def audit(self, action: str, device_id: str, after: dict | None) -> None:
        self.call("POST", "rpc/log_audit", {
            "p_actor": None,
            "p_action": action,
            "p_target_type": "reader",
            "p_target_id": device_id,
            "p_after": after,
        })


def reader_info(cable: Cable) -> dict:
    cable.restart()
    if cable.wait_event("ready", 6) is None:
        raise Stop("The reader did not start. Check the port, and that no browser tab is using it.")
    info = cable.send("info").get("result") or {}
    if info.get("protocol") != PROTOCOL:
        raise Stop(f"This reader runs firmware {info.get('firmware', '?')}. Flash the current firmware first.")
    return info


def open_with_site_key(cable: Cable, site: Site, info: dict) -> None:
    device_id, epoch = info["deviceId"], info["bluetooth"]["epoch"]
    key = site.load(device_id, epoch)
    if key is None or not cable.authenticate(key)[0]:
        raise Stop(
            "This reader holds a key this site does not know. Erase it with "
            "`pio run -d firmware/kiosk-reader -t erase`, flash it again, and run this again."
        )


def provision(cable: Cable, site: Site) -> str:
    info = reader_info(cable)
    device_id, bluetooth = info["deviceId"], info["bluetooth"]
    key = os.urandom(32)

    if bluetooth.get("paired"):
        open_with_site_key(cable, site, info)
        version = bluetooth["epoch"] + 1
        site.store(device_id, version, key)
        # A change that was cut short is finished with the key already stored.
        key = site.load(device_id, version) or key
    else:
        version = site.store(device_id, None, key)

    kept = cable.send("pair.set", key=b64(key), epoch=version).get("result") or {}
    if kept.get("check") != key_check(key):
        raise Stop("The reader did not keep the key. Nothing else was changed; run this again.")

    # Proved from scratch, the way a browser will do it.
    if cable.session is not None:
        cable.release()
    if not cable.authenticate(key)[0]:
        raise Stop("The reader has the key but would not open a session with it. Run this again.")
    cable.release()
    site.retire(device_id, version)
    site.audit("reader.provisioned", device_id, {"epoch": version})
    return f"{bluetooth.get('name', device_id)} ({device_id}) holds key version {version}, stored with {site.host}."


def clear(cable: Cable, site: Site) -> str:
    info = reader_info(cable)
    device_id, bluetooth = info["deviceId"], info["bluetooth"]
    if bluetooth.get("paired"):
        open_with_site_key(cable, site, info)
        if cable.send("pair.clear").get("ok") is not True:
            raise Stop("The reader would not give up its key.")
        cable.session = None
    site.forget(device_id)
    site.audit("reader.cleared", device_id, None)
    return f"{bluetooth.get('name', device_id)} ({device_id}) holds no key, and {site.host} has forgotten it."


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", required=True, help="the reader's serial port, for example COM3")
    parser.add_argument("--clear", action="store_true", help="take the key off the reader and forget it on the site")
    parser.add_argument("--confirm", metavar="PROJECT_REF", help="the hosted project to write to")
    args = parser.parse_args()

    try:
        site = Site(settings())
        if not site.local and args.confirm != site.ref:
            print(f"This would {'clear a reader on' if args.clear else 'register a reader with'} {site.host}.")
            print(f"Nothing was changed. To go ahead, add: --confirm {site.ref}")
            return 2
        cable = Cable(args.port)
        try:
            print(clear(cable, site) if args.clear else provision(cable, site))
        finally:
            cable.close()
    except Stop as stop:
        print(f"Stopped: {stop}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
