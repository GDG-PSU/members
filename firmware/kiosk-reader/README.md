# GDG@PSU NFC reader firmware

ESP32 + PN532 firmware for the GDG@PSU member system. A lane is a local device:
an admin browser drives it with a small JSON API to read and write NDEF card
URLs, over the USB cable (Web Serial) or, when no computer is using the cable,
over Bluetooth (Web Bluetooth). The firmware has no WiFi, server, registration,
heartbeat, kiosk, or writer-job path, and never reaches the network by itself.

See [docs/hardware-bringup.md](../../docs/hardware-bringup.md) for wiring, what
has been tested on a physical reader and what has not, and
[docs/usb-api.md](../../docs/usb-api.md) for the protocol on both links.

Firmware 2.0.1 reads only the NDEF TLV instead of the full tag capacity and
retries transient page-read failures. Firmware 2.0.2 reports an overlong command
line once instead of once per chunk. Firmware 2.1.0 adds Bluetooth, `ping`, and
a `ready` line when it has finished starting. Re-run a write/read-back check
before an event.

## Layout

```text
platformio.ini                 pinned platform + libraries
include/gdg_config.h           pins, NFC limits and link timings (safe to commit)
src/main.cpp                   boot, PN532 retry, which link is in use, status LED
src/reader_api.cpp             the JSON commands, the same on both links
src/ble_link.cpp               Bluetooth: the GATT service, handshake and sealing
src/reader_crypto.cpp          HMAC-SHA-256, AES-256-GCM, base64url (mbedTLS)
src/pairing_store.cpp          the pairing key, kept in the reader's own storage
lib/nfc_lane/                  PN532 NTAG read/write + NDEF TLV parsing
tools/reader_check.py          checks a physical reader over both links
```

No `secrets.h` is needed or read, and no secret is compiled in. The device ID
reported by the API is derived from the ESP32 chip (`esp32-<chip-id>`); there is
no device registration step.

## Build and flash

```bash
pio run
pio run --target upload --upload-port COM3
pio device monitor -b 115200
```

If esptool loses the port while resetting the board, unplug the PN532 during
the flash and reconnect it afterward. A browser tab connected to the reader
holds the port, so disconnect it first.

Bump `GDG_FIRMWARE_VERSION` in `platformio.ini` with any firmware change; `info`
reports it to the admin page.

## Which link is used

The cable always wins. The ESP32 cannot tell a charger from a computer
electrically, because the board's USB chip is separate from it, so "on USB" means
a computer is talking over the cable. While one is, the radio is off. With no
computer on the cable, a reader that has been paired offers Bluetooth; one that
has not keeps its radio off. An organizer can ask for Bluetooth with the cable
plugged in, from the admin page.

## Bluetooth

A reader is paired by being plugged into an organizer's computer once: the admin
page gives it a key over the cable. Over Bluetooth nothing is answered until the
reader and the browser have each proved they hold that key, and every line after
that is sealed with a key made for that session. Commands that decide who may
use Bluetooth are accepted from the cable only.

The stack is NimBLE, built as a peripheral for one connection.

## Checking a reader

```bash
pip install pyserial bleak cryptography
python tools/reader_check.py --port COM3 --bluetooth
```

It runs the cable and Bluetooth checks from the outside, pairing the reader with
a throwaway key and leaving it unpaired. The admin pages set it up again the next
time it is plugged in.

## Notes

A browser must be Chrome or Edge on HTTPS or localhost. The CP210x is a USB-UART
bridge; raw WebUSB would require an ESP32-S2/S3 with native USB.

The browser verifies the read-back before the admin activates the pending card.
There is no firmware-side URL host parser or server call; the firmware treats
the URI as opaque NDEF bytes.
