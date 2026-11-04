# Local USB device API

Each lane is a USB-only serial device. It exposes a local JSON API over its
CP210x bridge. There is no WiFi, server registration, device secret, heartbeat,
or kiosk/writer path in the firmware.

## Browser transport

The ESP32 DevKit uses a **CP210x USB-to-UART bridge**. Browsers expose that as
**Web Serial**, not raw WebUSB. The admin page is `/admin/usb` and uses
`navigator.serial`; it must run in Chrome or Edge on HTTPS or localhost.

WebUSB would require a native-USB ESP32 (for example ESP32-S2/S3) with a custom
WebUSB interface. The current DevKit cannot provide that through the CP210x.

## Serial settings

- 115200 baud, 8 data bits, no parity, 1 stop bit
- Newline-delimited JSON, one request/response per line
- Boot/status lines are plain text and do not start with `{`
- Client requests carry an `id`; responses echo it

## Commands

```json
{"id":1,"cmd":"info"}
{"id":2,"cmd":"nfc.status"}
{"id":3,"cmd":"nfc.read"}
{"id":4,"cmd":"nfc.write","uri":"https://example.test/c/token"}
{"id":5,"cmd":"reboot"}
```

`info` returns the firmware version, chip-derived device ID, chip ID, transport,
NFC readiness and firmware version, and uptime. `nfc.read` returns the NDEF URI
or a stable error code. `nfc.write` writes one URI and verifies it by read-back;
it does not validate that the URI is a member card URL.

A typical response:

```json
{
  "id": 1,
  "ok": true,
  "result": {
    "protocol": 2,
    "deviceId": "esp32-…",
    "chipId": "…",
    "transport": "usb-serial",
    "nfcReady": true
  }
}
```

An error response:

```json
{ "id": 3, "ok": false, "error": "ndef_record_missing" }
```

## Security boundary

The USB API trusts physical USB access. It has no login, device secret, or
server session. The admin page is protected by the existing admin/MFA session,
but anyone with a serial terminal and physical access can issue the same
commands. Do not expose this serial port through a network serial proxy.
