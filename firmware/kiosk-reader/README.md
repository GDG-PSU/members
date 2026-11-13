# GDG@PSU card reader firmware

Firmware for an ESP32 with a PN532. An organizer's browser drives the reader to
read and write the link on a membership card (NTAG213, NTAG215 or NTAG216),
over the USB cable (Web Serial) or, when no computer is using the cable, over
Bluetooth (Web Bluetooth). The reader has no WiFi and never reaches the network
by itself.

- Wiring, flashing checklists and troubleshooting:
  [docs/hardware-bringup.md](../../docs/hardware-bringup.md)
- The protocol, the reader's key, and what the design protects:
  [docs/usb-api.md](../../docs/usb-api.md)

## Layout

```text
platformio.ini            pinned platform and libraries, firmware version
include/gdg_config.h      pins, NFC limits and link timings
src/main.cpp              start-up, which link is in use, the status light
src/reader_api.cpp        the commands, and what each needs before it is obeyed
src/secure_session.cpp    the handshake and sealed lines, for both links
src/ble_link.cpp          Bluetooth: the GATT service and its connection
src/reader_crypto.cpp     HMAC-SHA-256, AES-256-GCM, base64url (mbedTLS)
src/pairing_store.cpp     the reader's key, kept in its own storage
lib/nfc_lane/             PN532 read and write, NDEF parsing
tools/provision_reader.py gives a flashed reader its key and stores it with the site
tools/reader_check.py     checks a reader from the outside, over both links
tools/reader_link.py      the protocol in Python, shared by the two tools
```

No secret is compiled in. The device ID is the chip's own (`esp32-<chip-id>`).

## Flash a reader and put it into use

Unplug the PN532 first if esptool loses the port, and close any browser tab
connected to the reader: a tab holds the port.

```bash
pio run -d firmware/kiosk-reader --target upload --upload-port COM3
pip install pyserial bleak cryptography
python firmware/kiosk-reader/tools/provision_reader.py --port COM3
```

`provision_reader.py` gives the reader a random key of its own and stores the
same key with the site named by `NEXT_PUBLIC_SUPABASE_URL`, a Supabase service
key and `CARD_WRITE_ENCRYPTION_KEY`, read from the environment or the root
`.env.local`. The first run against a hosted project only says which project it
would write to; add the `--confirm <project-ref>` it prints. After that every
organizer can use the reader, by cable or Bluetooth, and nobody else can.

- A reader that already holds a key the site knows is given a new one.
- `--clear` takes the key off the reader and forgets it on the site.
- A reader holding a key the site does not know must be erased first:
  `pio run -d firmware/kiosk-reader --target erase --upload-port COM3`, then
  flash and provision again.

Do not plug a reader with no key into a site still running older pages: they
would give it a key the current pages cannot use, and it would need erasing.

Bump `GDG_FIRMWARE_VERSION` in `platformio.ini` with any firmware change; `info`
reports it to the admin pages. Flashing a newer version keeps the reader's key,
so a reader that is already in use needs only the upload.

## Check a reader

```bash
python firmware/kiosk-reader/tools/reader_check.py --port COM3 --bluetooth
```

It needs a reader with no key and a Bluetooth adapter. It gives the reader a
throwaway key, runs about 77 checks over the cable and over real radio, and
takes the key off again, whatever happens along the way. Put no card on the
reader: it only reads.

## Notes

- Chrome or Edge, on HTTPS or localhost. The board's CP210x is a USB serial
  bridge; raw WebUSB would need an ESP32-S2/S3 with native USB.
- The firmware treats a link as opaque bytes. It does not check that a link is a
  membership card link; the admin page reads the card back before switching it
  on.
- The Bluetooth stack is NimBLE, built as a peripheral for one connection.
- Firmware older than 2.2.0 has no key. The admin pages still talk to it over
  the cable, in the clear, and say that it should be flashed.
