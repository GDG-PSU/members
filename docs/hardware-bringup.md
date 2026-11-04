# Hardware bring-up — USB-only ESP32 + PN532 lane

> **Status: NOT TESTED END-TO-END.** No physical board, PN532 breakout, NTAG
> card, or two-lane setup has been validated. Everything below is the procedure
> to complete the hardware gate.

The firmware lives in [`firmware/kiosk-reader/`](../firmware/kiosk-reader). It is
USB-only: it exposes a local JSON API over the CP210x serial bridge and has no
WiFi, server, registration, heartbeat, kiosk, or writer-job code. It does not
hold a Supabase key, member email, or network credentials.

## 1. Bill of materials

| Item                           | Needed                          | Current state                                     |
| ------------------------------ | ------------------------------- | ------------------------------------------------- |
| ESP32 dev board                | 2 (lane A, lane B)              | **Not supplied** — exact variant unknown          |
| PN532 NFC breakout             | 2                               | **8-pin SPI module**; set `SEL0=OFF, SEL1=ON`     |
| NTAG21x cards (213/215/216)    | 3 test cards + production batch | **Not supplied** — capacity/lock state unverified |
| USB data cables                | 2                               | Unknown                                           |
| Chrome or Edge on the admin PC | 1 browser with Web Serial       | Web Serial requires HTTPS or localhost            |

Do not assume every cheap PN532 breakout has identical wiring, power, or logic
levels. Verify the silkscreen, DIP switches, and vendor datasheet for the exact
batch before connecting anything.

## 2. Interface and pin map

Set the PN532 module to **SPI**: `SEL0 = OFF, SEL1 = ON` (on a 2-position DIP
block, `1 = OFF, 2 = ON`). Verify against the silkscreen; the module must not be
in I²C or HSU mode.

| Signal     | ESP32 GPIO | Macro in `include/gdg_config.h` | Notes                                                             |
| ---------- | ---------- | ------------------------------- | ----------------------------------------------------------------- |
| SPI SCK    | 18         | `GDG_NFC_SPI_SCK`               | VSPI clock                                                        |
| SPI MISO   | 19         | `GDG_NFC_SPI_MISO`              | VSPI MISO                                                         |
| SPI MOSI   | 23         | `GDG_NFC_SPI_MOSI`              | VSPI MOSI                                                         |
| SPI SS     | 5          | `GDG_NFC_SPI_SS`                | Chip select; high idle                                            |
| PN532 IRQ  | 4          | `GDG_NFC_IRQ`                   | Optional; this driver polls SPI status and does not require IRQ   |
| PN532 RSTC | 15         | `GDG_NFC_RESET`                 | Active-low reset; toggled at boot and between retries             |
| VCC        | 3V3 or 5V  | —                               | Use 5V/VIN if the breakout has a 5V regulator; signals stay 3.3 V |
| GND        | GND        | —                               | Common ground is mandatory                                        |
| Status LED | 2          | `GDG_STATUS_LED`                | Onboard LED on many dev boards; set to -1 if none                 |

The Adafruit PN532 library is constructed with the hardware-SPI SS pin, so it
uses the ESP32 VSPI bus (18/19/23/5). Do not use the old I²C SDA/SCL pins for
SPI. The PN532 signal pins are 3.3 V logic. If the module has a 5 V regulator,
powering VCC from 5 V can be more stable than the ESP32 3.3 V rail, but never
put 5 V on SCK/MISO/MOSI/SS/IRQ/RSTC.

## 3. Build inputs

No secrets file is needed or read. Device identity is derived at runtime from
the ESP32 chip (`esp32-<chip-id>`); there is no registration or per-device
credential. `platformio.ini` contains only safe build configuration.

## 4. Pinned toolchain

`platformio.ini` pins:

- `espressif32@6.9.0` (Arduino-ESP32 2.x line)
- `adafruit/Adafruit PN532@1.3.4`
- `bblanchon/ArduinoJson@7.4.2`

Before a production flash, check the pinned platform's release notes and confirm
the PN532 library still exposes `ntag2xx_ReadPage` / `ntag2xx_WritePage`. Do not
float versions during an event.

## 5. Compile and flash

```bash
cd firmware/kiosk-reader
pio run
pio run --target upload --upload-port COM3
pio device monitor -b 115200
```

If esptool loses the port while resetting the board, unplug the PN532 during the
flash and reconnect it afterward. The board's CP210x is the browser transport;
do not expect raw WebUSB.

After boot, the serial monitor should show:

```text
[boot] GDG@PSU USB lane firmware 2.0.0
[nfc] PN532 SPI firmware 0x... ready
[usb] JSON control API ready
[usb] device id esp32-...
```

If the PN532 is absent, `info` reports `nfcReady: false` and retries every 10 s;
the USB API itself still works.

## 6. USB API smoke test

Use the admin page at `/admin/usb` in Chrome or Edge, or a serial terminal. Send
one JSON object per line:

```json
{"id":1,"cmd":"info"}
{"id":2,"cmd":"nfc.status"}
{"id":3,"cmd":"nfc.read"}
```

`info` should return a unique `deviceId`, `chipId`, `protocol: 2`, and
`transport: "usb-serial"`. There is no `mode`, `wifi`, heartbeat, or server
request. See [usb-api.md](usb-api.md) for the full protocol.

## 7. Wiring checklist

- [ ] Module silkscreen identified and DIP switches set to SPI:
      `SEL0 = OFF, SEL1 = ON` (commonly `1 = OFF, 2 = ON`).
- [ ] SCK→18, MISO→19, MOSI→23, SS→5, RSTC→15, GND→GND.
- [ ] IRQ→4 is optional; the current driver polls SPI status instead of using it.
- [ ] VCC measured at the PN532 before first boot: 3.3 V, or 5 V only if the
      breakout has its own 5 V regulator.
- [ ] No 5 V on any PN532 signal pin.
- [ ] Serial monitor shows the PN532 firmware version and `[usb] JSON control API ready`.
- [ ] `info` shows `nfcReady: true` and a stable `deviceId`.
- [ ] Unplugging the PN532 produces bounded retries, not a hang.
- [ ] Both lanes show different `deviceId` values.

## 8. Card batch verification (before writing production cards)

For each card batch, test at least three cards:

- [ ] Reads as ISO14443A with a 7-byte UID (NTAG21x).
- [ ] Capability container page 3 is `E1 10 <size>` and capacity is ≥ the NDEF
      message needed for the URL.
- [ ] A phone reads the written URL and opens the exact HTTPS origin.
- [ ] Blank/never-written card can be written.
- [ ] Already-written card can be rewritten (not locked/read-only).
- [ ] Locked/read-only card produces `page_write_failed`, not a false success.
- [ ] Too-small card produces `tag_too_small`.
- [ ] Write is followed by read-back; tampering/removal mid-write yields a
      failure, never "written".
- [ ] Old card token is revoked in the admin portal and the old URL shows the
      neutral expired-card page.

Do not infer capacity from the product listing. Measure it.

## 9. USB functional checklist

- [ ] Admin opens `/admin/usb` in Chrome/Edge on HTTPS or localhost.
- [ ] Admin selects COM3 and connects; `info` renders.
- [ ] A blank NTAG215 read returns a stable error such as `ndef_record_missing`.
- [ ] Writing a test URL to a non-production card succeeds and reads back.
- [ ] Removing the card during a read/write returns an error, not a false success.
- [ ] Two lanes connect independently and show distinct chip-derived IDs.
- [ ] No WiFi traffic, heartbeat, device row, or server session is needed for
      read/write/status.
- [ ] Unplugging USB disconnects the browser cleanly; reconnecting works.

## 10. Troubleshooting

| Symptom                         | Likely cause                                       | Action                                                                |
| ------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------- |
| `PN532 SPI did not respond`     | Wrong DIP switch, wiring, power, or no RSTC        | Confirm `SEL0=OFF, SEL1=ON`; check SCK/MISO/MOSI/SS, RSTC→15, VCC/GND |
| `no_card`                       | Tag not NTAG21x or not presented long enough       | Use an NTAG21x card; hold ~1 s                                        |
| `unsupported_tag`               | Not ISO14443A / wrong UID length / not NDEF Type 2 | Use a supported NTAG card                                             |
| `tag_too_small`                 | URL does not fit                                   | Use a larger NTAG or shorten the host                                 |
| `read_back_mismatch`            | Tag removed/locked during write                    | Re-seat card, retry; discard tag if repeatable                        |
| `ndef_record_missing`           | Blank card or no NDEF URI record                   | Write the card first                                                  |
| Repeated reboots                | Brown-out / watchdog                               | Powered hub or external 3V3 supply; check serial reset reason         |
| `Could not open COM3` on upload | USB re-enumeration / PN532 power during reset      | Unplug PN532 during flash; reconnect after                            |

NFC reads have a 300 ms timeout; the main loop yields with `delay()`. There are
no WiFi or HTTP waits.

## 11. Remaining hardware blockers

1. Confirm the exact ESP32 board and the 8-pin SPI PN532 module; DIP switches must be `SEL0=OFF, SEL1=ON`.
2. Supply the purchased NTAG card batch for capacity/write-state verification.
3. Provide USB/debug access and two complete units for two-lane testing.
4. Verify the admin page's Web Serial connection in Chrome/Edge on the event
   machine, including reconnect behavior.
5. Provide a non-production card for an end-to-end write/read test.

Until these are done, the firmware is **compile/review-ready only** and must not
be described as hardware-validated.
