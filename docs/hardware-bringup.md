# Hardware bring-up — ESP32 + PN532 lane

> **Status: BLOCKED / NOT TESTED ON HARDWARE.** No physical board, PN532 breakout,
> NTAG card or campus network was available to the implementation environment.
> Everything below is the exact procedure to complete the hardware gate. Do not
> mark the firmware lane as production-ready until every checkbox has been run on
> the real units.

The firmware lives in [`firmware/kiosk-reader/`](../firmware/kiosk-reader). It talks
only to the narrow device middleware API over HTTPS. It never talks to Supabase and
never holds a Supabase key, member email or the member database.

## 1. Bill of materials and unknowns

| Item                            | Needed                                   | Current state                                                                                                    |
| ------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| ESP32 dev board                 | 2 (lane A, lane B)                       | **Not supplied** — exact board variant unknown                                                                   |
| PN532 NFC breakout              | 2                                        | **Not supplied** — I²C/SPI/UART variant and DIP-switch layout unknown                                            |
| NTAG21x cards (NTAG213/215/216) | At least 3 test cards + production batch | **Not supplied** — batch capacity/lock state unverified                                                          |
| USB data cables                 | 2                                        | Unknown                                                                                                          |
| Approved network                | 1 SSID for both lanes                    | **Unverified**; confirm with PSU IT before flashing (see [psu-network-validation.md](psu-network-validation.md)) |
| Deployed HTTPS origin           | `GDG_API_HOST`                           | Must be deployed with a trusted certificate                                                                      |

Do **not** assume every cheap PN532 breakout has identical wiring, power or logic
levels. Verify the silkscreen, the DIP switches and the vendor datasheet for the
exact batch in hand before connecting anything.

## 2. Interface and pin map

Default interface is **I²C**. The PN532 breakout's DIP switches must be set for
I²C (commonly `1=ON, 2=OFF` on the red Adafruit-style board — confirm against your
vendor's silkscreen).

| Signal      | ESP32 GPIO | Macro in `include/gdg_config.h` | Notes                                                         |
| ----------- | ---------- | ------------------------------- | ------------------------------------------------------------- |
| I²C SDA     | 21         | `GDG_NFC_I2C_SDA`               | Default ESP32 bus                                             |
| I²C SCL     | 22         | `GDG_NFC_I2C_SCL`               | Default ESP32 bus                                             |
| PN532 IRQ   | 4          | `GDG_NFC_IRQ`                   | Required by `Adafruit_PN532(irq, reset)`                      |
| PN532 RESET | 5          | `GDG_NFC_RESET`                 | Active-low reset                                              |
| Status LED  | 2          | `GDG_STATUS_LED`                | Onboard LED on many dev boards; set `-1` if none              |
| 3V3         | 3V3        | —                               | PN532 boards are 3.3 V logic; do not feed 5 V into ESP32 pins |
| GND         | GND        | —                               | Common ground is mandatory                                    |

SPI/UART alternatives are declared in `gdg_config.h` (`GDG_NFC_INTERFACE_SPI`,
`GDG_NFC_INTERFACE_UART`, SPI pins 18/19/23/5). If you switch, you must also change
the `Adafruit_PN532` constructor/transport usage in `lib/nfc_lane` and re-verify
wiring. The committed implementation uses the I²C constructor.

The PN532 draws current peaks that can brown out a weak USB port. Use a stable
3.3 V supply and a short, thick ground connection.

## 3. Secrets and build inputs

```bash
cd firmware/kiosk-reader
cp include/secrets.example.h include/secrets.h
```

Fill in **only** in `include/secrets.h` (gitignored, never commit):

- `GDG_WIFI_SSID` / `GDG_WIFI_PASSWORD` — an approved device network, not a
  student's personal Penn State credentials.
- `GDG_API_HOST` — bare host, e.g. `member.gdgpsu.dev` (no scheme, no slash).
- `GDG_API_PORT` — `443`.
- `GDG_DEVICE_ID` — e.g. `lane-a`, created in Admin → Devices.
- `GDG_DEVICE_SECRET` — the one-time secret shown when the device is registered.
  One independent secret per physical unit.
- `GDG_ROOT_CA_PEM` — PEM root CA that actually signs the deployed certificate.
  Certificate validation is never disabled in firmware.

The firmware signs each request with `x-device-id`, `x-device-timestamp`,
`x-device-signature` and `x-request-id`; the raw device secret is never sent.
NTP synchronization is required before signed requests are accepted. Rotate existing
secrets after migration 0007, and provision each device with its own new key.

## 4. Pinned toolchain

`platformio.ini` pins:

- `espressif32@6.9.0` (Arduino-ESP32 2.x line)
- `adafruit/Adafruit PN532@1.3.4`
- `bblanchon/ArduinoJson@7.4.2`

Before a production flash, check the pinned platform's release notes and confirm
the PN532 library still exposes `ntag2xx_ReadPage` / `ntag2xx_WritePage`. Do not
float versions during an event.

## 5. Host-side parser test (no hardware)

The NDEF URL parser is pure C++ in `lib/ndef_url` and has a plain `main()` test.

```bash
g++ -std=c++17 -Wall -Wextra -Werror \
  -I firmware/kiosk-reader/lib/ndef_url \
  firmware/kiosk-reader/test/host/test_ndef_url.cpp \
  firmware/kiosk-reader/lib/ndef_url/ndef_url.cpp \
  -o /tmp/ndef_test && /tmp/ndef_test
```

Expected output: `ndef_url: all checks passed (ok)`.

This test covers exact HTTPS host matching, 43-character base64url tokens, query/
fragment/userinfo/port rejection, path exactness, long-form rejection and
display-safe masking. It is the only firmware test that can run without hardware.

The host parser passed locally. A PlatformIO compile with placeholder credentials also passed; neither validates physical hardware.

## 6. Compile and flash

```bash
cd firmware/kiosk-reader
pio run                     # compile for esp32dev
pio run --target upload     # flash over USB
pio device monitor -b 115200
```

Record the exact board (`platformio.ini` `board = esp32dev`) and adjust for the
purchased board. A different ESP32 module may need a different `board` value,
partition scheme and USB bridge driver.

### Serial output (no secrets)

The firmware prints state transitions, `PENDING scan <id>`, `write+read-back
confirmed`, and stable error codes such as `no_card`, `unsupported_tag`,
`tag_too_small`, `read_back_mismatch`, `device_rejected`. It never prints card
tokens, full card URLs, Wi-Fi passwords, the device secret or member data. Writer
mode prints the masked host path only (`https://host/c/...`).

## 7. Wiring checklist

- [ ] Board silkscreen and PN532 variant identified; I²C DIP switches confirmed.
- [ ] 3V3 and GND measured at the PN532 with a multimeter before first boot.
- [ ] SDA→21, SCL→22, IRQ→4, RESET→5, with ESP32 and PN532 grounds common.
- [ ] No 5 V logic on PN532 signal pins.
- [ ] Serial monitor shows `PN532 firmware 0x...` and a mode (`ONLINE_KIOSK` or
      `ONLINE_WRITER`) assigned by the server.
- [ ] Unplugging the PN532 produces bounded error output, not a hang.

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

## 9. Kiosk + writer functional checklist (hardware-in-the-loop)

Kiosk mode:

- [ ] Admin assigns the device to an event/session and mode `kiosk`.
- [ ] Tapping a valid member card produces a **pending** scan in Admin → Kiosk.
- [ ] No attendance or points exist until an organizer confirms check-in/check-out.
- [ ] A random NDEF tag (e.g. a URL to another site) is rejected locally.
- [ ] Duplicate taps within the cooldown produce one pending scan (or a benign
      duplicate response), never duplicate attendance.
- [ ] Unplugging the network shows `OFFLINE` and the LED blink pattern; scans are
      not buffered or replayed later.
- [ ] Server-side device disable rejects the next request (`device_rejected`).

Writer mode:

- [ ] An admin queues exactly one card write job for this device.
- [ ] The unit claims the job, writes one NDEF URI record, reads it back, and only
      then reports `written`.
- [ ] The card opens the member's `/m/` profile through `/c/`.
- [ ] The admin portal shows the card as active and the member's digital ID works.
- [ ] While in writer mode the unit does not accept attendance scans.
- [ ] An expired job is not written (`job_expired`).
- [ ] A second unit cannot claim or complete the first unit's job.

Two-lane checks: both units report distinct IDs, authenticate independently, and
disabling lane A does not affect lane B.

## 10. Troubleshooting

| Symptom                 | Likely cause                                       | Action                                                        |
| ----------------------- | -------------------------------------------------- | ------------------------------------------------------------- |
| `PN532 did not respond` | Wrong DIP switch, wiring, power                    | Re-check interface table; measure 3V3; try a shorter cable    |
| `tls_begin_failed`      | Wrong CA, clock skew, blocked network              | Confirm `GDG_ROOT_CA_PEM`, device time, network policy        |
| `http_status 401/403`   | Wrong/rotated device secret or disabled device     | Re-register/rotate in Admin → Devices                         |
| `no_card`               | Tag not NTAG21x or not presented long enough       | Use an NTAG21x card; hold ~1 s                                |
| `unsupported_tag`       | Not ISO14443A / wrong UID length / not NDEF Type 2 | Use a supported NTAG card                                     |
| `tag_too_small`         | URL does not fit                                   | Use a larger NTAG or shorten the host                         |
| `read_back_mismatch`    | Tag removed/locked during write                    | Re-seat card, retry; discard tag if repeatable                |
| `job_expired`           | Admin queued a job too long ago                    | Queue a fresh job (30–900 s TTL)                              |
| Repeated reboots        | Brown-out / watchdog                               | Powered hub or external 3V3 supply; check serial reset reason |

The loop is bounded: HTTP has connect/read timeouts, Wi-Fi connection attempts
have deadlines, NFC reads have a 300 ms timeout, and the main loop yields with
`delay()`. There are no unbounded waits.

## 11. Remaining hardware blockers

1. Supply the exact ESP32 board and PN532 breakout variants (photos/silkscreen).
2. Supply the purchased NTAG card batch for capacity/write-state verification.
3. Provide USB/debug access and two complete units for two-lane testing.
4. Get PSU IT approval for the network path in
   [psu-network-validation.md](psu-network-validation.md).
5. Deploy the HTTPS API with a certificate whose root CA is pinned in firmware.
6. Provide an actual event environment for the end-to-end kiosk/writer rehearsal.

Until these are done, the firmware is **compile/review-ready only** and must not
be described as hardware-validated.
