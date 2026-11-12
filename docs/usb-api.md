# Reader API: USB and Bluetooth

Each lane is an ESP32 with a PN532. An organizer's browser drives it with a small
JSON API, over the USB cable or, when no computer is using the cable, over
Bluetooth. The commands are the same on both links. The reader has no WiFi and
never reaches the network or the server by itself.

This describes firmware **2.1.0** (protocol 3). Firmware 2.0.x speaks protocol 2:
the cable only, without `ping`, pairing or Bluetooth. The admin pages work with
both and only offer Bluetooth for protocol 3.

## Which link is used

The cable always wins.

- The ESP32 cannot tell a charger from a computer electrically: the board's USB
  chip (a CP210x) is separate from it. So "on USB" means **a computer is talking
  over the cable**. The reader counts a computer as present while it has sent a
  command within the last 6 seconds; the browser sends `ping` every 2 seconds
  when it has nothing else to say.
- While a computer is on the cable, the radio is off. If a Bluetooth session is
  open when a computer speaks over the cable, the reader tells the Bluetooth side
  `{"event":"transport","to":"usb"}` and drops it.
- With no computer on the cable, a paired reader advertises and accepts one
  Bluetooth connection. After power-on it waits 3 seconds for the cable first.
- The organizer can override this from the cable with
  `transport.set {"mode":"bluetooth"}`: the radio comes on and cable traffic no
  longer drops Bluetooth. `{"mode":"auto"}`, or a restart, ends the override.
- `usb.release` tells the reader the computer is done with the cable, so it
  offers Bluetooth at once instead of waiting 6 seconds.

The browser applies the same rule from its side
(`apps/web/src/lib/reader/reader-manager.ts`). A reader the browser has used
before is opened the moment it is plugged in, and any Bluetooth link is let go,
whichever reader it was to. When the cable is pulled it goes back to the reader
it last used over Bluetooth. A command caught in the middle of a switch is sent
again on the new link.

## USB

The ESP32 DevKit's CP210x appears to browsers as **Web Serial**, not raw WebUSB.
The pages use `navigator.serial` and need Chrome or Edge on HTTPS or localhost.

- 115200 baud, 8 data bits, no parity, 1 stop bit
- Newline-delimited JSON, one request and one response per line
- Boot and status lines are plain text and do not start with `{`
- Requests carry an `id`; responses echo it

Opening the port resets the board. When it has started again the reader prints
`{"event":"ready","protocol":3,"firmware":"2.1.0","deviceId":"esp32-…"}`, so the
browser does not have to wait a fixed time.

## Commands

```json
{"id":1,"cmd":"info"}
{"id":2,"cmd":"ping"}
{"id":3,"cmd":"nfc.status"}
{"id":4,"cmd":"nfc.read"}
{"id":5,"cmd":"nfc.write","uri":"https://example.test/c/token"}
{"id":6,"cmd":"reboot"}
```

`nfc.read` returns the NDEF URI or a stable error code; it reads only the NDEF
TLV rather than the full tag capacity, and retries transient page-read failures.
`nfc.write` writes one URI and verifies it by read-back; it does not check that
the URI is a member card URL.

These are accepted **from the cable only**. Over Bluetooth they answer `usb_only`:

```json
{"id":7,"cmd":"pair.set","key":"<32 bytes, base64url>","epoch":1}
{"id":8,"cmd":"pair.clear"}
{"id":9,"cmd":"bluetooth.set","enabled":false}
{"id":10,"cmd":"transport.set","mode":"bluetooth"}
{"id":11,"cmd":"usb.release"}
```

`info` over the cable:

```json
{
  "id": 1,
  "ok": true,
  "result": {
    "protocol": 3,
    "firmware": "2.1.0",
    "deviceId": "esp32-…",
    "chipId": "…",
    "transport": "usb-serial",
    "mode": "auto",
    "nfcReady": true,
    "bluetooth": {
      "name": "GDG Reader 2DF4",
      "enabled": true,
      "paired": true,
      "state": "off",
      "epoch": 1,
      "check": "e6d75f18e12a0cf6"
    }
  }
}
```

`bluetooth.state` is `off`, `advertising`, `connected` (someone connected but has
not proved anything) or `secure`. `check` is a fingerprint of the pairing key,
the first 8 bytes of `HMAC-SHA-256(key, "gdg-reader-kcv-v1")`. The key itself is
never reported.

An error response:

```json
{ "id": 4, "ok": false, "error": "ndef_record_missing" }
```

A line longer than the firmware's buffer is discarded whole and answered with a
single `line_too_long` error, with `id` 0 because the request was never parsed.

## Bluetooth

Bluetooth Low Energy, one GATT service. The browser uses Web Bluetooth
(`navigator.bluetooth`), which works in Chrome and Edge on a computer and in
Chrome on Android.

| Item    | UUID                                   | Use                                |
| ------- | -------------------------------------- | ---------------------------------- |
| Service | `7c1f0001-5b0a-4f6e-9a54-6d5b2c8e41a7` | Advertised; the browser filters it |
| RX      | `7c1f0002-5b0a-4f6e-9a54-6d5b2c8e41a7` | The browser writes commands        |
| TX      | `7c1f0003-5b0a-4f6e-9a54-6d5b2c8e41a7` | The reader notifies replies        |

The reader advertises as `GDG Reader ` followed by the last four characters of
its device ID. The bytes are the same newline-delimited lines as on the cable; a
line may be split across several writes or notifications.

### Pairing

A reader can be reached over Bluetooth only after it has been given a pairing
key over the cable. That happens by itself: when a signed-in organizer's browser
connects a reader by cable, it asks the server for that reader's key
(`pairReaderAction`) and sends it with `pair.set`. The reader keeps it in its own
storage. A reader that already has the current key is sent nothing.

The key is derived on the server, so nothing is stored there:

```text
secret = HKDF-SHA-256(CARD_WRITE_ENCRYPTION_KEY, info "gdg-reader-pairing-v1")
key    = HMAC-SHA-256(secret, "reader-key" 00 deviceId 00 epoch)
```

`epoch` is `READER_KEY_EPOCH` in `apps/web/src/lib/reader/keys.ts`. Raising it
retires every reader's key at once; each reader pairs again the next time it is
plugged in. A reader without a key keeps its radio off.

### Handshake

Radio can be heard and written to by anyone nearby, so nothing is trusted until
both ends have proved they hold the key. The browser never holds it: the server
does the proving for it, and only for a signed-in organizer.

```text
browser → reader   {"id":1,"cmd":"auth.begin","nonce":"<client nonce>"}
reader  → browser  {"id":1,"ok":true,"result":{"deviceId":"…","epoch":1,"nonce":"<reader nonce>"}}
browser → server   openReaderSessionAction(deviceId, epoch, both nonces)
server  → browser  proof, expect, sessionKey
browser → reader   {"id":2,"cmd":"auth.finish","proof":"<proof>"}
reader  → browser  {"id":2,"ok":true,"result":{"proof":"<expect>"}}
```

Nonces are 16 random bytes. With `T` the bytes
`"gdg-reader-auth-v1" 00 deviceId 00 epoch 00 clientNonce readerNonce`
(the epoch as decimal text):

```text
proof      = HMAC-SHA-256(key, "client" 00 T)    sent to the reader
expect     = HMAC-SHA-256(key, "reader" 00 T)    what a genuine reader answers
sessionKey = HMAC-SHA-256(key, "session" 00 T)   seals this session only
```

The reader checks `proof` in constant time; the browser checks the reader's
answer against `expect` and sends nothing more if it differs. Both nonces are in
every value, so a recording of an earlier session proves nothing.

Before the handshake the reader answers only `auth.begin` and `auth.finish`;
anything else gets `auth_required`. A connection that has not finished within 8
seconds is dropped. After a failed proof the reader hangs up and stays off the
air for one second. The pause does not grow: the key is far too long to guess,
and a growing pause would let anyone nearby silence the reader by failing on
purpose.

### Sealed lines

After the handshake every line in both directions is sealed with AES-256-GCM
under `sessionKey`:

```text
line  = "#" base64url( counter(8 bytes, big-endian) || ciphertext || tag(16 bytes) )
nonce = direction(1 byte) 00 00 00 counter(8 bytes)     direction 1 = to reader, 2 = to browser
```

Each side counts its own lines from 1. The receiver refuses a counter that is not
higher than the last one it accepted, and refuses a line that does not verify. On
either, or on a line that is not sealed, the reader hangs up.

## Checking a reader

`firmware/kiosk-reader/tools/reader_check.py` runs all of the above against a
physical reader from the outside, the way the pages do:

```bash
pip install pyserial bleak cryptography
python firmware/kiosk-reader/tools/reader_check.py --port COM3 --bluetooth
```

It pairs the reader with a throwaway key and leaves it unpaired; the admin pages
set it up again the next time it is plugged in.

## Security boundary

- **Cable:** physical access is the trust boundary. There is no login on the
  serial port; anyone who can plug in can issue the same commands, which is also
  what lets the cable be the place a reader is paired. Do not expose the port
  through a network serial proxy.
- **Bluetooth:** the trust boundary is the pairing key plus a signed-in
  organizer. Someone nearby without them can see that a reader is there, and can
  connect and be hung up on, which keeps others from connecting while they do.
  They cannot read or write a card, read what is sent, or pass a fake reader off
  on an organizer's browser. Someone whose access was removed can no longer open
  a session. The cable is unaffected by anything done over the air.
- **Either link:** a card read is still only a preview until an organizer checks
  the person and confirms. A card link is a routing identifier, not a credential.

A reader that is lost should be treated as a lost key: anyone who opens it can
read the key from its flash, and with it can pass off a copy of _that_ reader.
Raise `READER_KEY_EPOCH`. Bluetooth can also be switched off for one reader from
**Reader tools** on `/admin/cards` (`bluetooth.set`); it stays off until switched
back on over the cable.
