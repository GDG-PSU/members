# GDG@PSU USB NFC lane firmware

ESP32 + PN532 USB-only firmware for the GDG@PSU member system. A lane is a
local serial device: an admin browser connects to it over Web Serial and uses a
small JSON API to read and write NDEF card URLs. The firmware has no WiFi,
server, registration, heartbeat, kiosk, or writer-job path.

**Hardware status: read/write/read-back tested on 2026-11-04** with a PN532 over
SPI and a writable NTAG215. See
[docs/hardware-bringup.md](../../docs/hardware-bringup.md) for wiring and
[docs/usb-api.md](../../docs/usb-api.md) for the protocol.

## Layout

```text
platformio.ini                 pinned platform + libraries
include/gdg_config.h           pins and NFC limits (safe to commit)
src/main.cpp                   boot, PN532 retry, USB API pump
src/usb_api.cpp                newline-delimited JSON control API
lib/nfc_lane/                  PN532 NTAG read/write + NDEF TLV parsing
```

No `secrets.h` is needed or read. The device ID reported by the API is derived
from the ESP32 chip (`esp32-<chip-id>`); there is no device registration step.

## Build and flash

```bash
pio run
pio run --target upload --upload-port COM3
pio device monitor -b 115200
```

If esptool loses the port while resetting the board, unplug the PN532 during
the flash and reconnect it afterward.

## USB API

The protocol is newline-delimited JSON at 115200 baud; plain boot/status lines
are ignored by clients. Commands are `info`, `nfc.status`, `nfc.read`,
`nfc.write`, and `reboot`. See [docs/usb-api.md](../../docs/usb-api.md).

A browser must use Chrome or Edge over HTTPS or localhost and Web Serial
(`navigator.serial`). The CP210x is a USB-UART bridge; raw WebUSB would require
an ESP32-S2/S3 with native USB.

The browser verifies the read-back before the admin activates the pending card.
There is no firmware-side URL host parser or server call; the firmware treats
the URI as opaque NDEF bytes.
