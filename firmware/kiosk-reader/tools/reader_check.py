"""Checks a physical reader over its cable and over Bluetooth.

    pip install pyserial bleak cryptography
    python reader_check.py --port COM3              # cable only
    python reader_check.py --port COM3 --bluetooth  # cable, then Bluetooth

It speaks the protocol in docs/usb-api.md from the outside, the way the admin
pages do, so it shows what the firmware does without a browser in the way.

The Bluetooth checks pair the reader with a throwaway key and leave it unpaired
at the end. The admin pages set it up again the next time it is plugged in. Put
no card on the reader while this runs: it only ever reads, never writes.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import hmac
import json
import os
import sys
import time

import serial

SERVICE = "7c1f0001-5b0a-4f6e-9a54-6d5b2c8e41a7"
RX = "7c1f0002-5b0a-4f6e-9a54-6d5b2c8e41a7"
TX = "7c1f0003-5b0a-4f6e-9a54-6d5b2c8e41a7"
AUTH_CONTEXT = b"gdg-reader-auth-v1"
TO_READER, TO_HOST = 1, 2

results: list[tuple[bool, str]] = []


def check(ok: bool, what: str, detail: str = "") -> bool:
    results.append((ok, what))
    print(f"  {'PASS' if ok else 'FAIL'}  {what}{f'  ({detail})' if detail else ''}", flush=True)
    return ok


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def key_check(key: bytes) -> str:
    return hmac.new(key, b"gdg-reader-kcv-v1", hashlib.sha256).digest()[:8].hex()


def proof(key: bytes, label: bytes, device_id: str, epoch: int, client: bytes, reader: bytes) -> bytes:
    message = b"\0".join([label, AUTH_CONTEXT, device_id.encode(), str(epoch).encode(), b""])
    return hmac.new(key, message + client + reader, hashlib.sha256).digest()


class Cable:
    """The reader's USB serial port."""

    def __init__(self, port: str):
        self.port = serial.Serial()
        self.port.port = port
        self.port.baudrate = 115200
        self.port.timeout = 0.05
        # Left low so that opening the port does not restart the board by itself.
        self.port.dtr = False
        self.port.rts = False
        self.port.open()
        self.next_id = 0
        self.events: list[dict] = []
        self.pending = b""

    def restart(self) -> None:
        """Pulls the board's reset line, as a browser opening the port does."""
        self.port.rts = True
        time.sleep(0.12)
        self.port.rts = False
        self.pending = b""

    def lines(self, seconds: float):
        deadline = time.time() + seconds
        while time.time() < deadline:
            self.pending += self.port.read(4096)
            while b"\n" in self.pending:
                raw, self.pending = self.pending.split(b"\n", 1)
                text = raw.decode("utf-8", "replace").strip()
                if text.startswith("{"):
                    try:
                        yield json.loads(text)
                    except json.JSONDecodeError:
                        pass

    def wait_event(self, name: str, seconds: float) -> dict | None:
        for message in self.lines(seconds):
            if message.get("event") == name:
                return message
            if "event" in message:
                self.events.append(message)
        return None

    def send(self, cmd: str, seconds: float = 4.0, **extra) -> dict:
        self.next_id += 1
        request = {"id": self.next_id, "cmd": cmd, **extra}
        self.port.write((json.dumps(request) + "\n").encode())
        for message in self.lines(seconds):
            if message.get("id") == self.next_id:
                return message
            if "event" in message:
                self.events.append(message)
        return {"ok": False, "error": "no_reply"}

    def close(self) -> None:
        self.port.close()


class Radio:
    """One Bluetooth connection to the reader."""

    def __init__(self, client):
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        self.aesgcm_type = AESGCM
        self.client = client
        self.buffer = b""
        self.lines: asyncio.Queue[str] = asyncio.Queue()
        self.session = None
        self.sent = 0
        self.received = 0
        self.next_id = 0
        self.events: list[dict] = []
        self.last_sealed: str | None = None

    async def start(self) -> None:
        await self.client.start_notify(TX, self.on_notify)

    def on_notify(self, _sender, data: bytearray) -> None:
        self.buffer += bytes(data)
        while b"\n" in self.buffer:
            raw, self.buffer = self.buffer.split(b"\n", 1)
            self.lines.put_nowait(raw.decode("utf-8", "replace").strip())

    async def write_line(self, line: str) -> None:
        data = (line + "\n").encode()
        for offset in range(0, len(data), 180):
            await self.client.write_gatt_char(RX, data[offset : offset + 180], response=True)

    def nonce(self, direction: int, counter: int) -> bytes:
        return bytes([direction, 0, 0, 0]) + counter.to_bytes(8, "big")

    def seal(self, text: str) -> str:
        self.sent += 1
        sealed = self.session.encrypt(self.nonce(TO_READER, self.sent), text.encode(), None)
        return "#" + b64(self.sent.to_bytes(8, "big") + sealed)

    def open(self, line: str) -> dict:
        frame = unb64(line[1:])
        counter = int.from_bytes(frame[:8], "big")
        if counter <= self.received:
            raise ValueError("the reader repeated a counter")
        self.received = counter
        return json.loads(self.session.decrypt(self.nonce(TO_HOST, counter), frame[8:], None))

    async def read(self, seconds: float) -> dict | None:
        try:
            line = await asyncio.wait_for(self.lines.get(), seconds)
        except asyncio.TimeoutError:
            return None
        if self.session is not None:
            return self.open(line) if line.startswith("#") else {"plain_after_auth": line}
        return json.loads(line)

    async def send(self, cmd: str, seconds: float = 6.0, **extra) -> dict:
        self.next_id += 1
        text = json.dumps({"id": self.next_id, "cmd": cmd, **extra})
        if self.session is not None:
            self.last_sealed = self.seal(text)
            await self.write_line(self.last_sealed)
        else:
            await self.write_line(text)
        deadline = time.time() + seconds
        while time.time() < deadline:
            message = await self.read(deadline - time.time())
            if message is None:
                break
            if message.get("id") == self.next_id:
                return message
            if "event" in message:
                self.events.append(message)
        return {"ok": False, "error": "no_reply"}

    async def authenticate(self, key: bytes) -> tuple[bool, str]:
        client_nonce = os.urandom(16)
        begun = await self.send("auth.begin", nonce=b64(client_nonce))
        if not begun.get("ok"):
            return False, begun.get("error", "?")
        result = begun["result"]
        reader_nonce = unb64(result["nonce"])
        args = (result["deviceId"], result["epoch"], client_nonce, reader_nonce)
        finished = await self.send("auth.finish", proof=b64(proof(key, b"client", *args)))
        if not finished.get("ok"):
            return False, finished.get("error", "?")
        if unb64(finished["result"]["proof"]) != proof(key, b"reader", *args):
            return False, "the reader's own proof is wrong"
        self.session = self.aesgcm_type(proof(key, b"session", *args))
        return True, result["deviceId"]

    async def gone_within(self, seconds: float) -> bool:
        deadline = time.time() + seconds
        while time.time() < deadline:
            if not self.client.is_connected:
                return True
            await asyncio.sleep(0.1)
        return not self.client.is_connected


async def find_reader(name: str, seconds: float):
    """The reader if it is on the air, found by its service and its name."""
    from bleak import BleakScanner

    def matches(device, advertisement) -> bool:
        uuids = [uuid.lower() for uuid in (advertisement.service_uuids or [])]
        return SERVICE in uuids and (advertisement.local_name or device.name) == name

    return await BleakScanner.find_device_by_filter(matches, timeout=seconds)


async def connect(name: str, seconds: float = 12.0) -> Radio | None:
    from bleak import BleakClient

    device = await find_reader(name, seconds)
    if device is None:
        return None
    client = BleakClient(device)
    await client.connect()
    radio = Radio(client)
    await radio.start()
    return radio


async def hang_up(radio: Radio | None) -> None:
    if radio is None:
        return
    try:
        await radio.client.disconnect()
    except Exception:
        pass


def cable_checks(cable: Cable) -> dict:
    print("Cable")
    cable.restart()
    ready = cable.wait_event("ready", 6)
    check(ready is not None, "says when it has finished starting", str(ready and ready.get("firmware")))

    info = cable.send("info").get("result", {})
    check(info.get("protocol") == 3, "speaks protocol 3", f"firmware {info.get('firmware')}")
    check(info.get("transport") == "usb-serial", "knows it is on the cable")
    check("bluetooth" in info, "reports its Bluetooth state", json.dumps(info.get("bluetooth")))
    check(info.get("mode") == "auto", "starts by preferring the cable")
    check(cable.send("ping").get("ok") is True, "answers a ping")
    check(cable.send("nope").get("error") == "unknown_cmd", "refuses an unknown command")
    print(f"  ....  NFC module {'ready' if info.get('nfcReady') else 'NOT ready'}")
    return info


async def bluetooth_checks(cable: Cable, info: dict) -> None:
    name = info["bluetooth"]["name"]
    key = os.urandom(32)
    wrong = os.urandom(32)

    print("Pairing over the cable")
    cable.send("pair.clear")
    cable.send("usb.release")
    check(await find_reader(name, 6) is None, "stays off the air until it has been paired")

    paired = cable.send("pair.set", key=b64(key), epoch=1)
    check(paired.get("result", {}).get("check") == key_check(key), "stores the key it is given")
    check(cable.send("pair.set", key="short", epoch=1).get("error") == "bad_key", "refuses a bad key")
    bluetooth = cable.send("info")["result"]["bluetooth"]
    check(bluetooth.get("paired") and "key" not in json.dumps(bluetooth), "never reports the key back")

    print("Bluetooth with no computer on the cable")
    cable.send("ping")
    check(await find_reader(name, 4) is None, "is off the air while a computer uses the cable")
    cable.send("usb.release")
    started = time.time()
    radio = await connect(name)
    if not check(radio is not None, "appears once the cable is released", f"{time.time() - started:.1f}s"):
        return

    reply = await radio.send("info")
    check(reply.get("error") == "auth_required", "answers nothing before the handshake")
    ok, device_id = await radio.authenticate(key)
    check(ok and device_id == info["deviceId"], "proves it holds the key, and accepts our proof", device_id)

    reply = await radio.send("info")
    over_air = reply.get("result", {})
    check(over_air.get("transport") == "bluetooth", "answers sealed commands", f"mtu {radio.client.mtu_size}")
    check(over_air.get("bluetooth", {}).get("state") == "secure", "knows the session is secure")
    started = time.time()
    reads = [await radio.send("nfc.read") for _ in range(5)]
    each = (time.time() - started) / len(reads) * 1000
    outcomes = {r.get("error") or "card" for r in reads}
    check(all("id" in r for r in reads), "reads over Bluetooth", f"{each:.0f} ms each, {outcomes}")
    check((await radio.send("pair.clear")).get("error") == "usb_only", "takes pairing commands from the cable only")
    check((await radio.send("transport.set", mode="auto")).get("error") == "usb_only", "takes transport commands from the cable only")

    await radio.write_line(radio.last_sealed)
    check(await radio.gone_within(4), "hangs up on a replayed line")
    await hang_up(radio)

    print("People who should not get in")
    radio = await connect(name)
    if check(radio is not None, "comes back on the air after hanging up"):
        ok, error = await radio.authenticate(wrong)
        check(not ok and error == "auth_failed", "refuses the wrong key", error)
        check(await radio.gone_within(4), "hangs up after a failed proof")
        await hang_up(radio)

    radio = await connect(name)
    if check(radio is not None, "comes back after a failed proof"):
        started = time.time()
        check(await radio.gone_within(14), "hangs up on a caller who never proves anything", f"{time.time() - started:.1f}s")
        await hang_up(radio)

    radio = await connect(name)
    if check(radio is not None, "is still reachable afterwards"):
        ok, _ = await radio.authenticate(key)
        check(ok, "still accepts the right key")
        await radio.write_line(json.dumps({"id": 99, "cmd": "info"}))
        check(await radio.gone_within(4), "hangs up on an unsealed line after the handshake")
        await hang_up(radio)

    print("The cable wins")
    radio = await connect(name)
    if check(radio is not None, "is on Bluetooth again") and (await radio.authenticate(key))[0]:
        check(cable.send("info").get("ok") is True, "answers the cable while on Bluetooth")
        message = await radio.read(4)
        check(message == {"event": "transport", "to": "usb"}, "tells Bluetooth the cable took over", str(message))
        check(await radio.gone_within(4), "then lets go of Bluetooth")
        await hang_up(radio)
        quiet = True
        for _ in range(4):
            cable.send("ping")
            quiet = quiet and await find_reader(name, 2) is None
        check(quiet, "stays off the air while the cable keeps talking")
        started = time.time()
        check(await find_reader(name, 12) is not None, "returns to the air when the cable goes quiet", f"{time.time() - started:.1f}s")

    print("The organizer's choice")
    check(cable.send("transport.set", mode="bluetooth").get("ok") is True, "accepts being asked for Bluetooth")
    radio = await connect(name)
    if check(radio is not None, "is on the air with a computer on the cable") and (await radio.authenticate(key))[0]:
        held = True
        for _ in range(3):
            held = held and cable.send("ping").get("ok") is True
            held = held and (await radio.send("ping")).get("ok") is True
        check(held, "keeps Bluetooth while the cable talks")
        check(cable.send("transport.set", mode="auto").get("ok") is True, "accepts being told to prefer the cable again")
        check(await radio.gone_within(4), "and lets go of Bluetooth")
        await hang_up(radio)

    print("Switching Bluetooth off")
    check(cable.send("bluetooth.set", enabled=False).get("ok") is True, "accepts Bluetooth being switched off")
    cable.send("usb.release")
    check(await find_reader(name, 6) is None, "stays off the air while switched off")
    check(cable.send("transport.set", mode="bluetooth").get("error") == "bluetooth_off", "refuses to be asked for Bluetooth then")
    cable.send("bluetooth.set", enabled=True)
    cable.send("pair.clear")
    cable.send("usb.release")
    check(await find_reader(name, 6) is None, "is off the air again once unpaired")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", required=True, help="the reader's serial port, for example COM3")
    parser.add_argument("--bluetooth", action="store_true", help="also check Bluetooth")
    args = parser.parse_args()

    cable = Cable(args.port)
    try:
        info = cable_checks(cable)
        if args.bluetooth and info.get("protocol") == 3:
            asyncio.run(bluetooth_checks(cable, info))
            print("  ....  The reader is left unpaired. Plug it into the admin pages to set it up again.")
    finally:
        cable.close()

    failed = [what for ok, what in results if not ok]
    print(f"\n{len(results) - len(failed)} of {len(results)} checks passed.")
    for what in failed:
        print(f"  failed: {what}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
