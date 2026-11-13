# Reader API: USB and Bluetooth

Each reader is an ESP32 with a PN532. An organizer's browser drives it with a
small JSON API, over the USB cable or, when no computer is using the cable, over
Bluetooth. The reader has no WiFi and never reaches the network by itself.

This describes firmware **2.2** (protocol 4). Older firmware has no key and no
session: 2.0.x and 2.1.0 are spoken to in the clear, over the cable only, and
anyone holding one can use it. Flash them. Firmware 2.2.1 added NTAG216 cards;
2.2.0 accepts NTAG213 and NTAG215 only.

The same messages are built in four places that must agree: the firmware
(`secure_session.cpp`, `reader_crypto.cpp`), the website
(`apps/web/src/lib/reader`), the tools (`firmware/kiosk-reader/tools/reader_link.py`)
and the stand-in reader in `tests/e2e/support/fake-reader.ts`.

## The reader's key

Each reader holds one random 32-byte key of its own, with a version number
(`epoch`). The website stores the same key in `reader_keys`, sealed with
`CARD_WRITE_ENCRYPTION_KEY`, so every organizer can use every reader and nobody
else can.

- **At flashing:** `provision_reader.py` makes the key, gives it to the reader
  over the cable with `pair.set`, and stores it with the site.
- **A reader with no key** (erased, or flashed without the tool) does nothing
  but take one. The first organizer to plug it in gives it one
  (`registerReaderAction`).
- **Rotate key** in Reader tools replaces it: the site stores the next version
  (`rotateReaderKeyAction`), the browser sends it with `pair.set` inside the
  open session, and the old version is retired once the reader has it
  (`confirmReaderKeyAction`). Both versions work in between, so a change that
  is cut short locks nobody out, and asking again hands out the same new key.
- **A reader whose key the site does not hold** cannot be used. Erase its flash
  and provision it again.

A key is never reported back. `info` gives its version and `check`, the first 8
bytes of `HMAC-SHA-256(key, "gdg-reader-kcv-v1")` in hex.

## Sessions

A reader that holds a key obeys only a session opened with it, on the cable and
over Bluetooth alike. The browser never holds the key for this: the server works
out the proofs, and only for a signed-in organizer.

```text
browser → reader   {"id":1,"cmd":"auth.begin","nonce":"<client nonce>"}
reader  → browser  {"id":1,"ok":true,"result":{"deviceId":"…","epoch":3,"nonce":"<reader nonce>"}}
browser → server   openReaderSessionAction(deviceId, epoch, both nonces)
server  → browser  proof, expect, sessionKey
browser → reader   {"id":2,"cmd":"auth.finish","proof":"<proof>"}
reader  → browser  {"id":2,"ok":true,"result":{"proof":"<expect>"}}
```

Nonces are 16 random bytes, sent as unpadded base64url. With `T` the bytes
`"gdg-reader-auth-v1" 00 deviceId 00 epoch 00 clientNonce readerNonce` (the
epoch as decimal text):

```text
proof      = HMAC-SHA-256(key, "client" 00 T)    sent to the reader
expect     = HMAC-SHA-256(key, "reader" 00 T)    what a genuine reader answers
sessionKey = HMAC-SHA-256(key, "session" 00 T)   seals this session only
```

The reader checks `proof` in constant time and allows one per `auth.begin`. The
browser checks the reader's answer against `expect` and sends nothing more if it
differs. Both nonces are in every value, so a recording of an earlier session
proves nothing.

After the handshake every line in both directions is sealed with AES-256-GCM:

```text
line  = "#" base64url( counter(8 bytes, big-endian) || ciphertext || tag(16 bytes) )
nonce = direction(1 byte) 00 00 00 counter(8 bytes)     direction 1 = to reader, 2 = to browser
```

Each side counts its own lines from 1. A line that does not verify, or whose
counter is not higher than the last one accepted, ends the session.

## Commands

Newline-delimited JSON. A request carries an `id` and the reply echoes it.

| Command                       | What it does                                           | Where it is accepted                       |
| ----------------------------- | ------------------------------------------------------ | ------------------------------------------ |
| `info`                        | Firmware, device ID, link, key version, NFC state      | Anywhere on the cable; in a session        |
| `ping`                        | Tells the reader a computer is on the cable            | Anywhere on the cable; in a session        |
| `auth.begin`, `auth.finish`   | Open a session                                         | In the clear, on either link               |
| `nfc.status`                  | Whether the PN532 is answering                         | In a session                               |
| `nfc.read`                    | The card's NDEF link, or an error code                 | In a session                               |
| `nfc.write` `{"uri"}`         | Writes one link and verifies it by read-back           | In a session                               |
| `reboot`                      | Restarts the reader                                    | In a session                               |
| `pair.set` `{"key","epoch"}`  | Gives the reader its key                               | In the clear on the cable when it has none |
|                               |                                                        | In a session, with a higher `epoch`        |
| `pair.clear`                  | Takes the key off the reader                           | In a cable session                         |
| `bluetooth.set` `{"enabled"}` | Switches Bluetooth on or off for this reader           | In a cable session                         |
| `transport.set` `{"mode"}`    | `bluetooth` keeps the radio on with a computer plugged | In a cable session                         |
|                               | in; `auto` or a restart ends that                      |                                            |
| `usb.release`                 | The computer is done; ends the cable session           | Anywhere on the cable                      |

`nfc.read` reads only the NDEF TLV and retries transient page-read failures.
`nfc.write` does not check that the link is a member card link. Both work on
NTAG213, NTAG215 and NTAG216 cards, and use at most the first 512 bytes of a
card, which is far more than a link needs.

Errors are stable codes: `{ "id": 4, "ok": false, "error": "no_card" }`. The
ones about access are `locked` (the cable, outside a session), `not_paired` (the
reader has no key), `auth_required` (Bluetooth, before the handshake),
`auth_failed`, `auth_out_of_order`, `bad_epoch`, and `usb_only` (a cable-only
command sent over Bluetooth).

`info` in a cable session:

```json
{
  "id": 1,
  "ok": true,
  "result": {
    "protocol": 4,
    "firmware": "2.2.1",
    "deviceId": "esp32-…",
    "transport": "usb-serial",
    "mode": "auto",
    "locked": false,
    "nfcReady": true,
    "bluetooth": {
      "name": "GDG Reader 2DF4",
      "enabled": true,
      "paired": true,
      "state": "off",
      "epoch": 3,
      "check": "e6d75f18e12a0cf6"
    }
  }
}
```

`locked` is true when `info` was asked in the clear of a reader that holds a key.
`bluetooth.paired` means the reader holds a key. `bluetooth.state` is `off`,
`advertising`, `connected` (someone connected but has not proved anything) or
`secure`.

## The cable

The ESP32 DevKit's CP210x appears to browsers as **Web Serial**, so the pages use
`navigator.serial` and need Chrome or Edge on HTTPS or localhost. 115200 baud,
8N1. Boot and status lines are plain text and start with neither `{` nor `#`.

Opening the port resets the board. When it has started the reader prints
`{"event":"ready","protocol":4,"firmware":"2.2.1","deviceId":"esp32-…"}`.

A sealed line the reader cannot open, including one from a session it no longer
has because it restarted, is answered with `{"event":"locked"}` in the clear. The
browser then opens a new session and sends the command again.

A line longer than the firmware's buffer is discarded whole and answered once
with `line_too_long` and `id` 0.

## Bluetooth

Bluetooth Low Energy, one GATT service, through Web Bluetooth
(`navigator.bluetooth`): Chrome and Edge on a computer, Chrome on Android.

| Item    | UUID                                   | Use                                |
| ------- | -------------------------------------- | ---------------------------------- |
| Service | `7c1f0001-5b0a-4f6e-9a54-6d5b2c8e41a7` | Advertised; the browser filters it |
| RX      | `7c1f0002-5b0a-4f6e-9a54-6d5b2c8e41a7` | The browser writes commands        |
| TX      | `7c1f0003-5b0a-4f6e-9a54-6d5b2c8e41a7` | The reader notifies replies        |

The reader advertises as `GDG Reader ` followed by the last four characters of
its device ID, and takes one connection. The bytes are the same lines as on the
cable; a line may be split across several writes or notifications.

Before the handshake the reader answers only `auth.begin` and `auth.finish`. A
connection that has not finished within 8 seconds is dropped, and so is one that
sends anything unsealed afterwards. After a failed proof the reader hangs up and
stays off the air for one second. The pause does not grow: the key is far too
long to guess, and a growing pause would let anyone nearby silence the reader by
failing on purpose.

## Which link is used

The cable always wins.

- The ESP32 cannot tell a charger from a computer electrically, because the
  board's USB chip is separate from it. So "on USB" means **a computer is talking
  over the cable**: it has sent a command within the last 6 seconds. The browser
  sends `ping` every 2 seconds when it has nothing else to say.
- While a computer is on the cable, the radio is off. If a Bluetooth session is
  open when one speaks, the reader tells the Bluetooth side
  `{"event":"transport","to":"usb"}` and drops it.
- With no computer on the cable, a reader that holds a key advertises. After
  power-on it waits 3 seconds for the cable first.
- `transport.set {"mode":"bluetooth"}` is the organizer's override, and
  `usb.release` lets the reader offer Bluetooth at once instead of after 6 seconds.

The browser applies the same rule (`reader-manager.ts`). A reader it has used
before is opened the moment it is plugged in, and any Bluetooth link is let go,
whichever reader it was to. When the cable is pulled it goes back to the reader
it last used over Bluetooth. A command caught in a switch is sent again on the
new link.

## The status light

| Light                                     | Meaning                                    |
| ----------------------------------------- | ------------------------------------------ |
| Off                                       | The NFC module is not answering            |
| Two quick flashes every two seconds       | The reader has no key and cannot be used   |
| Steady                                    | Ready, on the cable or idle                |
| Slow blink, about once a second           | On the air, waiting for a Bluetooth caller |
| Steady with a short dip every two seconds | In use over Bluetooth                      |

## What this protects, and what it does not

- Someone who picks up a reader, or stands near one, cannot read or write a card
  with it, read what is sent, or pass a fake reader off on an organizer's
  browser. They would need the reader's key, and the site releases only session
  keys, only to a signed-in organizer.
- Someone whose access was removed can no longer open a session.
- Someone nearby can still connect over Bluetooth and be hung up on, which keeps
  others from connecting while they do. The cable is unaffected.
- **A reader's flash is not encrypted.** Someone with the reader and a flashing
  tool can read its key out, or erase it and install firmware of their own. So a
  lost reader's key is treated as known: when the reader comes back, use
  **Rotate key**. A reader that never comes back holds a key only for itself,
  and no other reader shares it.
- A reader with no key takes one from whoever holds its cable. That is how an
  erased reader is put back into use, and it is why erasing needs a flashing
  tool.
- A card read is still only a preview until an organizer checks the person and
  confirms. A card link is a routing identifier, not a credential.

## Tools

In `firmware/kiosk-reader/tools`, needing `pip install pyserial bleak cryptography`:

- `provision_reader.py --port COM3` gives a flashed reader its key and stores it
  with the site named in the environment or the root `.env.local`. A hosted
  project needs `--confirm <project-ref>`. `--clear` takes the key off again.
- `reader_check.py --port COM3 --bluetooth` checks a reader that holds no key
  from the outside, over both links, and leaves it with no key.
