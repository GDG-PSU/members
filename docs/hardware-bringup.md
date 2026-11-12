# Hardware bring-up — ESP32 + PN532 lane

> **Status: firmware 2.1.0 tested on one reader on 2026-11-12, over its cable and
> over Bluetooth, with a card.** On `esp32-a4156cc92df4` on COM3:
> `tools/reader_check.py --bluetooth` passed 44 of 44 checks from this computer's
> Bluetooth adapter, and `reader-hardware.spec.ts` took the real Cards page
> through being set up by cable, writing a card over the cable, connecting by
> Bluetooth, reading that card and writing a new one over the air, moving to the
> cable when it was plugged in, the organizer choosing Bluetooth and going back,
> and falling back to Bluetooth. Section 9b has the details and the timings.
>
> **Firmware 2.0.2 was tested end to end with a card on 2026-11-04.** One ESP32 +
> 8-pin SPI PN532 on COM3, with one writable NTAG215, on a local stack: invite,
> setup, prepare, write, read back, activate, the card URL resolving to the
> profile, check-in, check-out, and the points grant. A second run on the same
> reader covered malformed commands, oversized lines, and the PN532 being off.
>
> **Not covered:** the kiosk over Bluetooth, which reads cards the same way but
> was not itself run; a reader powered from a charger with no cable to the
> computer; the browser's own Web Serial picker (the
> tests relayed `navigator.serial` to COM3, because the picker cannot be
> automated); Chrome or Edge themselves, and Chrome on Android; a hosted run on
> the production origin; an empty antenna, a locked or too-small card, removing a
> card mid-write, a card batch, and two lanes. The checklists below still apply
> to those.

The firmware lives in [`firmware/kiosk-reader/`](../firmware/kiosk-reader). It
exposes a local JSON API over the CP210x serial bridge and, from 2.1.0, over
Bluetooth when no computer is using the cable. It has no WiFi, server,
registration, heartbeat, kiosk, or writer-job code, and does not hold a Supabase
key, member email, or network credentials. The one secret it holds is its own
Bluetooth pairing key, which it is given over the cable.

## 1. Bill of materials

| Item                           | Needed                          | Current state                                     |
| ------------------------------ | ------------------------------- | ------------------------------------------------- |
| ESP32 dev board                | 2 (lane A, lane B)              | **Not supplied** — exact variant unknown          |
| PN532 NFC breakout             | 2                               | **8-pin SPI module**; set `SEL0=OFF, SEL1=ON`     |
| NTAG21x cards (213/215/216)    | 3 test cards + production batch | **Not supplied** — capacity/lock state unverified |
| USB data cables                | 2                               | Unknown                                           |
| Chrome or Edge on the admin PC | 1 browser with Web Serial       | Web Serial requires HTTPS or localhost            |
| Bluetooth on the admin PC      | Optional                        | Only for using a reader without a data cable      |
| USB power for the reader       | Optional                        | A charger or power bank, for Bluetooth use        |

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
the ESP32 chip (`esp32-<chip-id>`); there is no registration step.
`platformio.ini` contains only safe build configuration. The Bluetooth pairing
key is not a build input: the admin pages give it to the reader over the cable.

## 4. Pinned toolchain

`platformio.ini` pins:

- `espressif32@6.9.0` (Arduino-ESP32 2.x line)
- `adafruit/Adafruit PN532@1.3.4`
- `bblanchon/ArduinoJson@7.4.2`
- `h2zero/NimBLE-Arduino@1.4.3`, built as a peripheral for one connection

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

After flashing, fully remove power from the reader for a few seconds and
reconnect it before testing. A serial-port reset can leave the PN532 RF stage
unresponsive; a full power-cycle restores it.

After boot, the serial monitor should show:

```text
[boot] GDG@PSU reader firmware 2.1.0
[nfc] PN532 SPI firmware 0x... ready
[usb] JSON control API ready
[usb] device id esp32-...
[boot] Bluetooth not paired; no WiFi or server connection
{"event":"ready","protocol":3,"firmware":"2.1.0","deviceId":"esp32-..."}
```

If the PN532 is absent, `info` reports `nfcReady: false` and retries every 10 s;
the API itself still works on both links.

The status LED says which link is in use:

| LED                               | Meaning                                         |
| --------------------------------- | ----------------------------------------------- |
| Off                               | The NFC module is not answering                 |
| Steady                            | Ready; on the cable, or Bluetooth is not in use |
| Slow blink                        | Waiting for a Bluetooth connection              |
| Steady, short dip every 2 seconds | In use over Bluetooth                           |

## 6. USB API smoke test

Use the admin page at `/admin/cards` in Chrome or Edge, or a serial terminal. Send
one JSON object per line:

```json
{"id":1,"cmd":"info"}
{"id":2,"cmd":"nfc.status"}
{"id":3,"cmd":"nfc.read"}
```

`info` should return a unique `deviceId`, `chipId`, `protocol: 3`,
`transport: "usb-serial"`, `mode: "auto"`, and a `bluetooth` block. There is no
`wifi`, heartbeat, or server request. See [usb-api.md](usb-api.md) for the full
protocol.

`firmware/kiosk-reader/tools/reader_check.py` runs these checks and the
Bluetooth ones against a plugged-in reader:

```bash
pip install pyserial bleak cryptography
python firmware/kiosk-reader/tools/reader_check.py --port COM3 --bluetooth
```

It needs the port to itself, so close any browser tab connected to the reader. It
leaves the reader unpaired; connect it at `/admin/cards` afterwards to set it up
for Bluetooth again.

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

- [ ] Admin opens `/admin/cards` in Chrome/Edge on HTTPS or localhost.
- [ ] Admin selects COM3 and connects; `info` renders.
- [ ] A blank NTAG215 read returns a stable error such as `ndef_record_missing`.
- [ ] Writing a test URL to a non-production card succeeds and reads back.
- [ ] Removing the card during a read/write returns an error, not a false success.
- [ ] Two lanes connect independently and show distinct chip-derived IDs.
- [ ] No WiFi traffic, heartbeat, device row, or server session is needed for
      read/write/status.
- [ ] Unplugging USB disconnects the browser cleanly; reconnecting works.

## 9a. Bluetooth functional checklist

- [ ] Connected by cable at `/admin/cards`, **Reader tools** says Bluetooth is
      ready and names the reader, for example `GDG Reader 2DF4`.
- [ ] With the reader on a charger and no cable to the computer, the LED blinks
      slowly, **Use Bluetooth** lists the reader, and choosing it connects.
- [ ] A card can be read and written over Bluetooth, and the kiosk reads a card.
- [ ] Plugging the reader into the computer moves the page to USB without a click.
- [ ] **Switch to Bluetooth** works with the cable plugged in, and **Switch to
      USB** goes back.
- [ ] Moving the cable from the computer to a charger falls back to Bluetooth.
- [ ] A reader that has never been plugged into an organizer's computer does not
      appear in the Bluetooth chooser.
- [ ] Two readers show different names in the chooser.

## 9b. What the Bluetooth run on 2026-11-12 showed

Reader `esp32-a4156cc92df4`, firmware 2.1.0, on COM3 of a Windows 11 laptop with
an Intel Bluetooth adapter. The NFC module was unplugged for the flash and for
the first two runs below, then plugged back in with one writable NTAG card for
the rest.

`tools/reader_check.py --port COM3 --bluetooth`, 44 of 44, NFC module unplugged:

- On the cable: the `ready` line after a restart, protocol 3, `ping`, an unknown
  command refused.
- Pairing: off the air until paired, the key stored and never reported back, a
  bad key refused.
- Over the air: off the air while a computer used the cable and on it 2.3 s after
  the cable was released; nothing answered before the handshake; the handshake
  both ways; sealed commands at an MTU of 247; pairing and transport commands
  refused with `usb_only`; a replayed line ending the session.
- Keeping people out: the wrong key refused and hung up on, a caller who proved
  nothing dropped after 8.1 s, an unsealed line after the handshake ending the
  session, and the reader reachable again after each.
- The cable winning: a command on the cable made the reader tell the Bluetooth
  side `{"event":"transport","to":"usb"}` and drop it; it stayed off the air
  while the cable kept talking and came back 3.9 s after it went quiet.
- The override: with `transport.set` to `bluetooth` the reader held a Bluetooth
  session while the cable kept talking, and let it go when set back to `auto`.
- Bluetooth switched off, and unpaired: off the air both times.

A command over Bluetooth took about 31 ms (the middle of 30 pings, 16 to 61 ms).
Finding and connecting took 1.7 s and the handshake 0.06 s.

With the NFC module back and a card on it, straight to the reader over
Bluetooth: the card read over the air was the card read over the cable (397 ms);
a link was written and read back by the reader (538 ms); reading it again over
the air gave exactly what was written (299 ms); and the card's own link was then
written back and confirmed over the cable. The card sat slightly off the antenna
and was found on 30 to 35 of every 40 reads, which is why the pages retry.

`reader-hardware.spec.ts`, the real Cards page in Playwright's Chromium with a
window, real Web Bluetooth with its chooser answered over the DevTools protocol,
and the real server actions on a local stack. Two runs, the first with the NFC
module unplugged and the second with `READER_CARD=1` and the card:

| Step                                             | No module | With a card |
| ------------------------------------------------ | --------- | ----------- |
| Connect by cable, from a click to connected      | 1.9 s     | 1.4 s       |
| Set up for Bluetooth by the real `pair.set`      | by itself | by itself   |
| Write a card with the one button, over the cable | —         | 1.7 s       |
| Connect by Bluetooth, from a click to connected  | 3.5 s     | 6.0 s       |
| Read over Bluetooth the card the cable wrote     | —         | 0.8 s       |
| Connect by Bluetooth again on a fresh page       | —         | 7.6 s       |
| Write a card with the one button, over Bluetooth | —         | 1.7 s       |
| Move to the cable when it was plugged in         | 1.9 s     | 1.4 s       |
| Switch to Bluetooth with the cable in            | 5.0 s     | 4.0 s       |
| Switch back to the cable                         | instant   | instant     |
| Fall back to Bluetooth when the cable went       | 7.5 s     | 8.1 s       |

No error was shown at any step. With no module, a read over the air answered
`nfc_not_ready`. With the card, each write was prepared, written, read back and
switched on by the page, the card written over Bluetooth replaced the one written
over the cable, and afterwards the card was given back the link it came with.

Connecting by Bluetooth took between 1.9 and 7.6 seconds across the runs; most
of it is the browser finding the reader and Windows opening the connection.
`navigator.serial` was relayed to COM3, with the board restarted on open as a
browser does. "Pulling the cable" closed that port while the reader stayed
powered from it, which is why falling back took the 6 seconds the reader waits
before it decides no computer is there; a reader moved to a charger restarts
instead and is back in about 3.

## 10. Troubleshooting

| Symptom                         | Likely cause                                         | Action                                                                |
| ------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------- |
| `PN532 SPI did not respond`     | Wrong DIP switch, wiring, power, or no RSTC          | Confirm `SEL0=OFF, SEL1=ON`; check SCK/MISO/MOSI/SS, RSTC→15, VCC/GND |
| `no_card`                       | Tag not NTAG21x or not presented long enough         | Use an NTAG21x card; hold ~1 s                                        |
| `unsupported_tag`               | Not ISO14443A / wrong UID length / not NDEF Type 2   | Use a supported NTAG card                                             |
| `tag_too_small`                 | URL does not fit                                     | Use a larger NTAG or shorten the host                                 |
| `read_back_mismatch`            | Tag removed/locked during write                      | Re-seat card, retry; discard tag if repeatable                        |
| `ndef_record_missing`           | Blank card or no NDEF URI record                     | Write the card first                                                  |
| Repeated reboots                | Brown-out / watchdog                                 | Powered hub or external 3V3 supply; check serial reset reason         |
| `Could not open COM3` on upload | USB re-enumeration / PN532 power during reset        | Unplug PN532 during flash; reconnect after                            |
| Not in the Bluetooth chooser    | Never paired, on a computer's cable, or switched off | Plug it in at `/admin/cards` once; then power it from a charger       |
| "did not accept this site"      | The reader holds an old or foreign pairing key       | Plug it in at `/admin/cards`; it is set up again by itself            |

NFC reads have a 300 ms timeout; the main loop yields with `delay()`. There are
no WiFi or HTTP waits. The ESP32 cannot tell a charger from a computer by the
cable alone, so the reader offers Bluetooth whenever no computer has spoken over
the cable for 6 seconds.

## 11. Remaining hardware checks

1. Run the card batch verification in section 8 on the purchased NTAG batch.
2. Connect two complete units to test two lanes.
3. Verify the admin page's Web Serial connection in Chrome/Edge on the event
   machine, including the port picker and reconnecting.
4. Write one production card for a live member on the hosted origin.

Until these are done, describe the firmware as tested on one reader, not as
validated for an event.
