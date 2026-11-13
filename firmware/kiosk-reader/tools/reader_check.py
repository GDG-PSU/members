"""Checks a physical reader over its cable and over Bluetooth.

    pip install pyserial bleak cryptography
    python reader_check.py --port COM3              # cable only
    python reader_check.py --port COM3 --bluetooth  # cable, then Bluetooth

It speaks the protocol in docs/usb-api.md from the outside, the way the admin
pages do, so it shows what the firmware does without a browser in the way.

The reader must hold no key when this starts. It is given a throwaway one, and
left with none at the end, so run provision_reader.py afterwards to put it back
into use. If the reader already holds a key, take it off first with
`provision_reader.py --port COM3 --clear`. Put no card on the reader while this
runs: it only ever reads, never writes.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
import traceback

from reader_link import PROTOCOL, Cable, b64, connect, find_reader, hang_up, key_check

results: list[tuple[bool, str]] = []
# Every key the reader was given, oldest first, so it can always be cleared.
given: list[bytes] = []


def check(ok: bool, what: str, detail: str = "") -> bool:
    results.append((bool(ok), what))
    print(f"  {'PASS' if ok else 'FAIL'}  {what}{f'  ({detail})' if detail else ''}", flush=True)
    return bool(ok)


def cable_checks(cable: Cable) -> dict:
    print("Cable")
    cable.restart()
    ready = cable.wait_event("ready", 6)
    check(ready is not None, "says when it has finished starting", str(ready and ready.get("firmware")))

    info = cable.send("info").get("result", {})
    check(info.get("protocol") == PROTOCOL, f"speaks protocol {PROTOCOL}", f"firmware {info.get('firmware')}")
    check(info.get("transport") == "usb-serial", "knows it is on the cable")
    check("bluetooth" in info, "reports its key and Bluetooth state", json.dumps(info.get("bluetooth")))
    check(info.get("mode") == "auto", "starts by preferring the cable")
    check(cable.send("ping").get("ok") is True, "answers a ping")
    print(f"  ....  NFC module {'ready' if info.get('nfcReady') else 'NOT ready'}")
    return info


def lock_checks(cable: Cable, key: bytes) -> bool:
    """The cable obeys nothing but a session opened with the reader's key."""
    print("A reader with no key")
    check(cable.send("nfc.read").get("error") == "not_paired", "reads no card until it has a key")
    check(cable.send("auth.begin", nonce=b64(os.urandom(16))).get("error") == "not_paired", "has no session to open yet")
    check(cable.send("pair.set", key="short", epoch=1).get("error") == "bad_key", "refuses a bad key")
    paired = cable.send("pair.set", key=b64(key), epoch=1).get("result", {})
    if paired.get("check") == key_check(key):
        given.append(key)
    check(paired.get("check") == key_check(key) and paired.get("epoch") == 1, "takes its first key over the cable")

    print("The cable, locked")
    info = cable.send("info").get("result", {})
    check(info.get("locked") is True, "says it is locked")
    check("key" not in json.dumps(info), "never reports the key back")
    for cmd in ("nfc.read", "nfc.status", "pair.clear", "reboot"):
        check(cable.send(cmd).get("error") == "locked", f"refuses {cmd} outside a session")
    check(cable.send("pair.set", key=b64(os.urandom(32)), epoch=2).get("error") == "locked", "refuses a second key outside a session")
    check(cable.send("transport.set", mode="bluetooth").get("error") == "locked", "refuses transport changes outside a session")

    ok, error = cable.authenticate(os.urandom(32))
    check(not ok and error == "auth_failed", "refuses the wrong key", error)
    check(cable.send("auth.finish", proof=b64(os.urandom(32))).get("error") == "auth_out_of_order", "takes one proof per attempt")
    ok, device_id = cable.authenticate(key)
    if not check(ok, "opens a session for the right key", device_id):
        return False

    print("The cable, in a session")
    info = cable.send("info").get("result", {})
    check(info.get("locked") is False, "answers sealed commands")
    started = time.time()
    reads = [cable.send("nfc.read") for _ in range(5)]
    each = (time.time() - started) / len(reads) * 1000
    check(all("id" in r for r in reads), "reads over the cable", f"{each:.0f} ms each, { {r.get('error') or 'card' for r in reads} }")
    check(cable.send("nope").get("error") == "unknown_cmd", "refuses an unknown command")
    check(cable.send("nfc.read", sealed=False).get("error") == "locked", "still refuses a command sent in the clear")

    cable.write_line(cable.session.last_sealed)
    check(cable.wait_event("locked", 3) is not None, "ends the session on a replayed line")
    check(cable.send("ping").get("error") == "locked_event", "and obeys nothing sealed with it afterwards")
    check(cable.authenticate(key)[0], "opens a new session afterwards")

    cable.release()
    check(cable.send("nfc.read").get("error") == "locked", "is locked again once the computer lets go")
    return True


def key_change_checks(cable: Cable, key: bytes, new_key: bytes) -> bool:
    print("Changing the key")
    if not check(cable.authenticate(key)[0], "opens a session with the first key"):
        return False
    changed = cable.send("pair.set", key=b64(new_key), epoch=2).get("result", {})
    if changed.get("check") == key_check(new_key):
        given.append(new_key)
    check(changed.get("check") == key_check(new_key) and changed.get("epoch") == 2, "takes a new key inside a session")
    check(cable.send("pair.set", key=b64(os.urandom(32)), epoch=2).get("error") == "bad_epoch", "refuses a key that is not newer")
    check(cable.send("ping").get("ok") is True, "keeps the session that made the change")
    cable.release()
    ok, error = cable.authenticate(key)
    check(not ok and error == "auth_failed", "no longer accepts the old key", error)
    check(cable.authenticate(new_key)[0], "accepts the new key")

    cable.restart()
    check(cable.wait_event("ready", 6) is not None, "restarts")
    check(cable.send("nfc.read").get("error") == "locked", "is locked after a restart")
    check(cable.authenticate(new_key)[0], "kept the new key across the restart")
    cable.release()
    return True


async def bluetooth_checks(cable: Cable, info: dict, key: bytes) -> None:
    name = info["bluetooth"]["name"]

    print("Bluetooth with no computer on the cable")
    cable.send("ping", sealed=False)
    check(await find_reader(name, 4) is None, "is off the air while a computer uses the cable")
    cable.release()
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
    check((await radio.send("pair.clear")).get("error") == "usb_only", "gives its key up over the cable only")
    check((await radio.send("transport.set", mode="auto")).get("error") == "usb_only", "takes transport commands from the cable only")

    newer = os.urandom(32)
    # Counted as given before the answer comes back: the reader may have kept it
    # even if the reply is lost.
    given.append(newer)
    changed = (await radio.send("pair.set", key=b64(newer), epoch=3)).get("result", {})
    if check(changed.get("check") == key_check(newer), "takes a new key inside a Bluetooth session"):
        key = newer
    check((await radio.send("ping")).get("ok") is True, "keeps the session that made the change")

    await radio.write_line(radio.session.last_sealed)
    check(await radio.gone_within(4), "hangs up on a replayed line")
    await hang_up(radio)

    print("People who should not get in")
    radio = await connect(name)
    if check(radio is not None, "comes back on the air after hanging up"):
        ok, error = await radio.authenticate(os.urandom(32))
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
        check(ok, "accepts the key it was given over the air")
        await radio.write_line(json.dumps({"id": 99, "cmd": "info"}))
        check(await radio.gone_within(4), "hangs up on an unsealed line after the handshake")
        await hang_up(radio)

    print("The cable wins")
    radio = await connect(name)
    if check(radio is not None, "is on Bluetooth again") and (await radio.authenticate(key))[0]:
        check(cable.send("info", sealed=False).get("ok") is True, "answers the cable while on Bluetooth")
        message = await radio.read(4)
        check(message == {"event": "transport", "to": "usb"}, "tells Bluetooth the cable took over", str(message))
        check(await radio.gone_within(4), "then lets go of Bluetooth")
        await hang_up(radio)
        quiet = True
        for _ in range(4):
            cable.send("ping", sealed=False)
            quiet = quiet and await find_reader(name, 2) is None
        check(quiet, "stays off the air while the cable keeps talking")
        started = time.time()
        check(await find_reader(name, 12) is not None, "returns to the air when the cable goes quiet", f"{time.time() - started:.1f}s")

    print("The organizer's choice")
    check(cable.authenticate(key)[0], "opens a cable session")
    check(cable.send("transport.set", mode="bluetooth").get("ok") is True, "accepts being asked for Bluetooth")
    radio = await connect(name)
    if check(radio is not None, "is on the air with a computer on the cable") and (await radio.authenticate(key))[0]:
        held = True
        for _ in range(3):
            held = held and cable.send("ping").get("ok") is True
            held = held and (await radio.send("ping")).get("ok") is True
        check(held, "keeps both sessions while the cable talks")
        check(cable.send("transport.set", mode="auto").get("ok") is True, "accepts being told to prefer the cable again")
        check(await radio.gone_within(4), "and lets go of Bluetooth")
        await hang_up(radio)

    print("Switching Bluetooth off")
    check(cable.send("bluetooth.set", enabled=False).get("ok") is True, "accepts Bluetooth being switched off")
    check(cable.send("transport.set", mode="bluetooth").get("error") == "bluetooth_off", "refuses to be asked for Bluetooth then")
    cable.release()
    check(await find_reader(name, 6) is None, "stays off the air while switched off")
    check(cable.authenticate(key)[0], "still opens a cable session")
    cable.send("bluetooth.set", enabled=True)
    cable.release()


def clear_key(cable: Cable) -> bool:
    """Takes the key off the reader, trying every key it was given, newest first."""
    cable.session = None
    for key in reversed(given):
        if cable.authenticate(key)[0]:
            cleared = cable.send("pair.clear").get("ok") is True
            cable.session = None
            return cleared
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", required=True, help="the reader's serial port, for example COM3")
    parser.add_argument("--bluetooth", action="store_true", help="also check Bluetooth")
    args = parser.parse_args()

    cable = Cable(args.port)
    try:
        info = cable_checks(cable)
        if info.get("protocol") != PROTOCOL:
            print("  ....  This is not the firmware these checks are for. Flash the reader first.")
        elif info.get("bluetooth", {}).get("paired"):
            print("  ....  This reader holds a key, so nothing more can be checked from outside.")
            print("        Take it off with provision_reader.py --clear, then run this again.")
            check(False, "starts with no key")
        else:
            try:
                key = os.urandom(32)
                if lock_checks(cable, key):
                    newer = os.urandom(32)
                    if key_change_checks(cable, key, newer):
                        key = newer
                    if args.bluetooth:
                        asyncio.run(bluetooth_checks(cable, info, key))
            except Exception:
                # Whatever went wrong, the reader must not be left holding a key
                # that only this run knew.
                traceback.print_exc()
                check(False, "ran to the end")
            finally:
                if given:
                    check(clear_key(cable), "gives its key up inside a cable session")
            info = cable.send("info").get("result", {})
            check(info.get("bluetooth", {}).get("paired") is False, "holds no key at the end")
            if args.bluetooth:
                cable.send("usb.release")
                check(asyncio.run(find_reader(info["bluetooth"]["name"], 6)) is None, "is off the air with no key")
            if info.get("bluetooth", {}).get("paired") is False:
                print("  ....  The reader holds no key. Run provision_reader.py to put it back into use.")
            else:
                print("  ....  The reader still holds a key from this run. Erase it and flash it again.")
    finally:
        cable.close()

    failed = [what for ok, what in results if not ok]
    print(f"\n{len(results) - len(failed)} of {len(results)} checks passed.")
    for what in failed:
        print(f"  failed: {what}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
