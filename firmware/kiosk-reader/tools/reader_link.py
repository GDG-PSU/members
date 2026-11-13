"""Speaks the reader's protocol from Python: the cable, Bluetooth, and the
session that both need. Shared by reader_check.py and provision_reader.py.

docs/usb-api.md states the protocol. The same messages are built by the
firmware (secure_session.cpp, reader_crypto.cpp) and by the website
(apps/web/src/lib/reader).
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import os
import time

import serial
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

SERVICE = "7c1f0001-5b0a-4f6e-9a54-6d5b2c8e41a7"
RX = "7c1f0002-5b0a-4f6e-9a54-6d5b2c8e41a7"
TX = "7c1f0003-5b0a-4f6e-9a54-6d5b2c8e41a7"
AUTH_CONTEXT = b"gdg-reader-auth-v1"
TO_READER, TO_HOST = 1, 2
PROTOCOL = 4


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def key_check(key: bytes) -> str:
    """The fingerprint the reader reports for a key, so it never reports the key."""
    return hmac.new(key, b"gdg-reader-kcv-v1", hashlib.sha256).digest()[:8].hex()


def proof(key: bytes, label: bytes, device_id: str, epoch: int, client: bytes, reader: bytes) -> bytes:
    message = b"\0".join([label, AUTH_CONTEXT, device_id.encode(), str(epoch).encode(), b""])
    return hmac.new(key, message + client + reader, hashlib.sha256).digest()


class Session:
    """One open session: seals what goes to the reader and opens what comes back."""

    def __init__(self, session_key: bytes):
        self.cipher = AESGCM(session_key)
        self.sent = 0
        self.received = 0
        self.last_sealed: str | None = None

    @staticmethod
    def nonce(direction: int, counter: int) -> bytes:
        return bytes([direction, 0, 0, 0]) + counter.to_bytes(8, "big")

    def seal(self, text: str) -> str:
        self.sent += 1
        sealed = self.cipher.encrypt(self.nonce(TO_READER, self.sent), text.encode(), None)
        self.last_sealed = "#" + b64(self.sent.to_bytes(8, "big") + sealed)
        return self.last_sealed

    def open(self, line: str) -> dict:
        frame = unb64(line[1:])
        counter = int.from_bytes(frame[:8], "big")
        if counter <= self.received:
            raise ValueError("the reader repeated a counter")
        message = json.loads(self.cipher.decrypt(self.nonce(TO_HOST, counter), frame[8:], None))
        self.received = counter
        return message


def answer_handshake(key: bytes, begun: dict, client_nonce: bytes):
    """From the reader's answer to auth.begin: our proof, its proof, the session key."""
    result = begun["result"]
    args = (result["deviceId"], result["epoch"], client_nonce, unb64(result["nonce"]))
    return (
        proof(key, b"client", *args),
        proof(key, b"reader", *args),
        proof(key, b"session", *args),
    )


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
        self.session: Session | None = None

    def restart(self) -> None:
        """Pulls the board's reset line, as a browser opening the port does."""
        self.port.rts = True
        time.sleep(0.12)
        self.port.rts = False
        self.pending = b""
        self.session = None

    def lines(self, seconds: float):
        """Yields (message, sealed) for every reply or event that can be read."""
        deadline = time.time() + seconds
        while time.time() < deadline:
            self.pending += self.port.read(4096)
            while b"\n" in self.pending:
                raw, self.pending = self.pending.split(b"\n", 1)
                text = raw.decode("utf-8", "replace").strip()
                try:
                    if text.startswith("{"):
                        yield json.loads(text), False
                    elif text.startswith("#") and self.session is not None:
                        yield self.session.open(text), True
                except Exception:
                    pass

    def wait_event(self, name: str, seconds: float) -> dict | None:
        for message, _sealed in self.lines(seconds):
            if message.get("event") == name:
                return message
            if "event" in message:
                self.events.append(message)
        return None

    def write_line(self, line: str) -> None:
        self.port.write((line + "\n").encode())

    def send(self, cmd: str, seconds: float = 4.0, sealed: bool | None = None, **extra) -> dict:
        """Sealed when a session is open, unless `sealed` says otherwise."""
        self.next_id += 1
        text = json.dumps({"id": self.next_id, "cmd": cmd, **extra})
        use_session = self.session is not None if sealed is None else sealed
        self.write_line(self.session.seal(text) if use_session and self.session else text)
        for message, was_sealed in self.lines(seconds):
            if "event" in message:
                self.events.append(message)
                if message["event"] == "locked":
                    return {"ok": False, "error": "locked_event"}
                continue
            # Inside a session only what it sealed is the reader's word.
            if message.get("id") == self.next_id and was_sealed == use_session:
                return message
        return {"ok": False, "error": "no_reply"}

    def authenticate(self, key: bytes) -> tuple[bool, str]:
        """Opens a session. Returns (True, device ID) or (False, why not)."""
        self.session = None
        client_nonce = os.urandom(16)
        begun = self.send("auth.begin", nonce=b64(client_nonce))
        if not begun.get("ok"):
            return False, begun.get("error", "?")
        ours, theirs, session_key = answer_handshake(key, begun, client_nonce)
        finished = self.send("auth.finish", proof=b64(ours))
        if not finished.get("ok"):
            return False, finished.get("error", "?")
        if unb64(finished["result"]["proof"]) != theirs:
            return False, "the reader's own proof is wrong"
        self.session = Session(session_key)
        return True, begun["result"]["deviceId"]

    def release(self) -> None:
        """Tells the reader this computer is done; the reader ends the session."""
        self.send("usb.release", seconds=1.5)
        self.session = None

    def close(self) -> None:
        self.port.close()


class Radio:
    """One Bluetooth connection to the reader."""

    def __init__(self, client):
        self.client = client
        self.buffer = b""
        self.lines: asyncio.Queue[str] = asyncio.Queue()
        self.session: Session | None = None
        self.next_id = 0
        self.events: list[dict] = []

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

    async def read(self, seconds: float) -> dict | None:
        try:
            line = await asyncio.wait_for(self.lines.get(), seconds)
        except asyncio.TimeoutError:
            return None
        if self.session is not None:
            return self.session.open(line) if line.startswith("#") else {"plain_after_auth": line}
        return json.loads(line)

    async def send(self, cmd: str, seconds: float = 6.0, **extra) -> dict:
        self.next_id += 1
        text = json.dumps({"id": self.next_id, "cmd": cmd, **extra})
        await self.write_line(self.session.seal(text) if self.session else text)
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
        ours, theirs, session_key = answer_handshake(key, begun, client_nonce)
        finished = await self.send("auth.finish", proof=b64(ours))
        if not finished.get("ok"):
            return False, finished.get("error", "?")
        if unb64(finished["result"]["proof"]) != theirs:
            return False, "the reader's own proof is wrong"
        self.session = Session(session_key)
        return True, begun["result"]["deviceId"]

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
    try:
        await client.connect()
        radio = Radio(client)
        await radio.start()
    except Exception as error:
        # The reader can leave the air between being found and being called.
        print(f"  ....  could not connect over Bluetooth: {error}")
        return None
    return radio


async def hang_up(radio: Radio | None) -> None:
    if radio is None:
        return
    try:
        await radio.client.disconnect()
    except Exception:
        pass
