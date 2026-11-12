"""Relays a reader's serial port to reader-hardware.spec.ts.

The browser's own port picker cannot be automated, so the spec replaces
`navigator.serial` with a port that talks to this script instead. Every byte
still goes to and from the real reader; only the picker is skipped.

One JSON object per line. In: {"op": "open" | "write" | "close", "data"?: str}.
Out: {"opened": true}, {"closed": true}, or {"data": str} for what the reader sent.
"""

import json
import sys
import threading
import time

import serial

port_name = sys.argv[1]
port: serial.Serial | None = None
lock = threading.Lock()


def say(message: dict) -> None:
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def pump() -> None:
    while True:
        with lock:
            current = port
        if current is None:
            time.sleep(0.02)
            continue
        try:
            data = current.read(4096)
        except (serial.SerialException, OSError, TypeError):
            data = b""
            time.sleep(0.02)
        if data:
            say({"data": data.decode("utf-8", "replace")})


threading.Thread(target=pump, daemon=True).start()

for line in sys.stdin:
    request = json.loads(line)
    op = request.get("op")
    if op == "open":
        opened = serial.Serial()
        opened.port = port_name
        opened.baudrate = 115200
        opened.timeout = 0.02
        opened.dtr = False
        opened.rts = False
        opened.open()
        # A browser opening the port restarts the board; do the same.
        opened.rts = True
        time.sleep(0.12)
        opened.rts = False
        with lock:
            port = opened
        say({"opened": True})
    elif op == "write" and port is not None:
        try:
            port.write(request.get("data", "").encode())
        except (serial.SerialException, OSError):
            pass
    elif op == "close":
        with lock:
            closing, port = port, None
        if closing is not None:
            closing.close()
        say({"closed": True})
