# GDG@PSU kiosk reader/writer firmware

ESP32 + PN532 lane firmware for the GDG@PSU member system. The unit reads an NDEF
HTTPS card URL, reports a **pending** scan to the device middleware API, and (in
writer mode) writes exactly one card URL and verifies it by read-back. It never
awards attendance or points itself and never talks to Supabase.

**Hardware status: not tested.** See [docs/hardware-bringup.md](../../docs/hardware-bringup.md)
and [docs/psu-network-validation.md](../../docs/psu-network-validation.md) before
connecting a board.

## Layout

```text
platformio.ini                 pinned platform + libraries
include/gdg_config.h           pins, timeouts, state constants (safe to commit)
include/secrets.example.h      template for credentials/CA (copy → secrets.h)
include/secrets.h              untracked; never commit
src/main.cpp                   boot + loop, mode dispatch, feedback
lib/api_client/                narrow HTTPS device API client
lib/wifi_link/                 bounded station connection
lib/nfc_lane/                  PN532 NTAG read/write + NDEF TLV parsing
lib/lane_state/                explicit state machine + kiosk/writer guard
lib/ndef_url/                  pure C++ URL contract (host-testable)
test/host/test_ndef_url.cpp    g++-runnable parser test
```

## Build

```bash
cp include/secrets.example.h include/secrets.h   # fill in real values locally
pio run
pio run --target upload
pio device monitor -b 115200
```

The API contract is:

- `POST /api/device/v1/heartbeat`
- `POST /api/device/v1/scans`
- `POST /api/device/v1/write-jobs/claim`
- `POST /api/device/v1/write-jobs/complete`

with `x-device-id`, `x-device-timestamp`, `x-device-signature`, `x-request-id` and JSON bodies.
The signature is lowercase HMAC-SHA-256 over `METHOD\nPATH\nTIMESTAMP\nNONCE\nSHA256(body)`;
timestamps are Unix seconds and the nonce is a fresh 128-bit hex value. TLS validates the
configured CA. Requests fail closed until NTP synchronizes the clock. Existing devices must
have their secret rotated after migration 0007 and firmware updated together. The card token
is exactly 43 base64url characters; see `lib/ndef_url`.

Scans are not persisted offline: a failed report requires the member to tap again. Do not
use this firmware for an event until offline behavior and physical read/write are verified.

## Host parser test

```bash
g++ -std=c++17 -Wall -Wextra -Werror \
  -I lib/ndef_url \
  test/host/test_ndef_url.cpp \
  lib/ndef_url/ndef_url.cpp \
  -o /tmp/ndef_test && /tmp/ndef_test
```

No hardware is required for this test. The firmware compile and all PN532/card
behavior remain hardware-in-the-loop gates.
