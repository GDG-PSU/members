# Hardware bring-up: ESP32 + PN532 card reader

How to wire, flash, set up and check a reader. What has been tested on real
hardware, and what has not, is recorded in [test-plan.md](test-plan.md); claim
only what it lists. The protocol is in [usb-api.md](usb-api.md).

## Adding a reader

Any number of readers can be in use; each is its own lane at an event.

1. Wire an ESP32 to a PN532 (section 2).
2. Flash it and give it its key (section 4). That is two commands, and the only
   step that needs a developer's computer.
3. Check it (section 5).

Nothing is registered in the admin pages. From then on every organizer can
connect it at `/admin/cards` or `/admin/kiosk`, by cable or Bluetooth, and it
shows up under its own name, `GDG Reader` and four characters of its ID. A browser tab
connects to one reader at a time, so two lanes need two computers, or two tabs
on one. Two readers in use at once has not been tried yet.

## 1. Parts

| Item                  | Needed                      | Notes                                            |
| --------------------- | --------------------------- | ------------------------------------------------ |
| ESP32 dev board       | One per reader              | With a CP210x USB serial bridge                  |
| PN532 NFC breakout    | One per reader              | 8-pin SPI module; set `SEL0 = OFF, SEL1 = ON`    |
| NTAG213, 215 or 216   | Test cards, then the batch  | Measure a batch before trusting it (section 6)   |
| USB data cable        | One, for flashing and setup | A charge-only cable works for power afterwards   |
| Chrome or Edge        | On the organizer's computer | Web Serial and Web Bluetooth; HTTPS or localhost |
| Bluetooth adapter     | Optional                    | Only for using a reader without a data cable     |
| Charger or power bank | Optional                    | Powers a reader that is used over Bluetooth      |

Cheap PN532 breakouts differ in wiring, power and logic levels. Check the
silkscreen, the DIP switches and the datasheet for your batch before connecting
anything.

## 2. Wiring

Set the PN532 to **SPI**: `SEL0 = OFF, SEL1 = ON` (on a two-position DIP block,
`1 = OFF, 2 = ON`).

| Signal     | ESP32 GPIO | Macro in `include/gdg_config.h` | Notes                                         |
| ---------- | ---------- | ------------------------------- | --------------------------------------------- |
| SPI SCK    | 18         | `GDG_NFC_SPI_SCK`               | VSPI clock                                    |
| SPI MISO   | 19         | `GDG_NFC_SPI_MISO`              |                                               |
| SPI MOSI   | 23         | `GDG_NFC_SPI_MOSI`              |                                               |
| SPI SS     | 5          | `GDG_NFC_SPI_SS`                | Chip select                                   |
| PN532 IRQ  | 4          | `GDG_NFC_IRQ`                   | Optional; the driver polls instead            |
| PN532 RSTC | 15         | `GDG_NFC_RESET`                 | Active-low reset, pulsed at start-up          |
| VCC        | 3V3 or 5V  |                                 | 5V only if the breakout has its own regulator |
| GND        | GND        |                                 | A common ground is required                   |
| Status LED | 2          | `GDG_STATUS_LED`                | The board's own LED; set to -1 if it has none |

The signal pins are 3.3 V logic. Never put 5 V on SCK, MISO, MOSI, SS, IRQ or
RSTC.

## 3. Toolchain

`platformio.ini` pins `espressif32@6.9.0`, `Adafruit PN532@1.3.4`,
`ArduinoJson@7.4.2` and `NimBLE-Arduino@1.4.3`. Do not float versions before an
event. No secrets file is needed: nothing secret is compiled in.

## 4. Flash and set up

Close any browser tab connected to the reader first; a tab holds the port. If
esptool loses the port while resetting the board, unplug the PN532 for the
flash.

```bash
pio run -d firmware/kiosk-reader --target upload --upload-port COM3
python firmware/kiosk-reader/tools/provision_reader.py --port COM3
```

The second command gives the reader its key and stores it with the site; the
[firmware README](../firmware/kiosk-reader/README.md) explains its options.
After a flash, take power off the reader for a few seconds before testing: a
serial reset can leave the PN532's radio unresponsive.

On start-up the serial monitor (`pio device monitor -b 115200`) shows:

```text
[boot] GDG@PSU reader firmware 2.2.1
[nfc] PN532 SPI firmware 0x... ready
[usb] JSON control API ready
[usb] device id esp32-...
[boot] key set; Bluetooth allowed; no WiFi or server connection
{"event":"ready","protocol":4,"firmware":"2.2.1","deviceId":"esp32-..."}
```

With the PN532 absent, `info` reports `nfcReady: false` and the reader retries
every 10 seconds; everything else still works.

The status light:

| Light                                     | Meaning                                    |
| ----------------------------------------- | ------------------------------------------ |
| Off                                       | The NFC module is not answering            |
| Two quick flashes every two seconds       | The reader has no key and cannot be used   |
| Steady                                    | Ready, on the cable or idle                |
| Slow blink, about once a second           | On the air, waiting for a Bluetooth caller |
| Steady with a short dip every two seconds | In use over Bluetooth                      |

## 5. Check a reader

From the outside, with no browser, on a reader that holds no key:

```bash
python firmware/kiosk-reader/tools/reader_check.py --port COM3 --bluetooth
```

Then, from the pages, on a reader that has been set up:

- [ ] `/admin/cards` in Chrome or Edge: **Connect reader** shows **Reader
      connected** with a **USB** badge.
- [ ] **Reader tools** shows the reader's ID, firmware 2.2.1 and **NFC ready**,
      and says Bluetooth is ready under a name such as `GDG Reader A415`.
- [ ] **Read a card** on a blank card says it has no readable URL on it.
- [ ] **Write a link by hand** writes a test link to a spare card and reads it
      back.
- [ ] Lifting a card during a write gives an error, never a success.
- [ ] With the reader on a charger, its light blinks slowly, **Use Bluetooth**
      lists it, and reading and writing work as they do on the cable.
- [ ] Plugging it into the computer moves the page to USB without a click.
      **Switch to Bluetooth** and **Switch to USB** both work with the cable in.
- [ ] Moving the cable from the computer to a charger falls back to Bluetooth.
- [ ] **Rotate key** succeeds, and the reader still connects afterwards.
- [ ] Signed out, nothing reaches the reader: its light stays as it was.
- [ ] Two readers show different names and different IDs.

## 6. Check a batch of cards

Test at least three cards from each batch before writing members' cards:

- [ ] A blank card can be written, and a written card can be written again.
- [ ] A phone reads the link and opens the right site.
- [ ] A locked card gives `page_write_failed`, not a success.
- [ ] A card too small for the link gives `tag_too_small`.
- [ ] Switching a card off in the admin pages sends its link to the neutral
      unavailable page.

Measure capacity; do not trust the listing.

## 7. Troubleshooting

| Symptom                                     | Likely cause                                                 | What to do                                                             |
| ------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `PN532 SPI did not respond`                 | DIP switches, wiring, power, or no RSTC                      | `SEL0=OFF, SEL1=ON`; check SCK, MISO, MOSI, SS, RSTC→15, VCC, GND      |
| `no_card`                                   | No card, or one held too briefly or off-centre               | Centre an NTAG21x card on the antenna for about a second               |
| `unsupported_tag`                           | Not an NTAG21x card, or firmware before 2.2.1 and an NTAG216 | Use an NTAG213, 215 or 216; flash the reader                           |
| `tag_too_small`                             | The link does not fit                                        | Use a larger card                                                      |
| `read_back_mismatch`                        | The card moved or is locked                                  | Re-seat it and retry; discard the card if it repeats                   |
| `ndef_record_missing`                       | A blank card                                                 | Write it first                                                         |
| Repeated restarts                           | Power dips                                                   | A powered hub or a better cable                                        |
| `Could not open COM3`, "Access is denied"   | A browser tab holds the port, or the PN532 on reset          | Disconnect or close the tab; unplug the PN532 for the flash            |
| Two quick flashes                           | The reader has no key                                        | Run `provision_reader.py`, or plug it in at `/admin/cards`             |
| Not in the Bluetooth list                   | No key, a computer on its cable, or Bluetooth off            | The light should blink slowly; steady means a computer is on the cable |
| "did not accept this site"                  | The reader holds a key from another site or database         | Erase it (`pio run --target erase`), flash it, and provision it again  |
| "This site does not hold this reader's key" | The same, seen from the site's side                          | The same                                                               |

The ESP32 cannot tell a charger from a computer by the cable, so a reader offers
Bluetooth whenever no computer has spoken over the cable for 6 seconds.

## 8. Still to do on real hardware

1. Check the purchased card batch (section 6).
2. Run two readers at one event.
3. Use a reader from Chrome or Edge themselves, including the port picker, and
   from Chrome on Android.
4. Power a reader from a charger with no cable to the computer.
5. Write a card for a live member on the production site.
