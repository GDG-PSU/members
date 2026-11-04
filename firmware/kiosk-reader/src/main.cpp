// GDG@PSU USB NFC lane firmware.
//
// One physical lane per ESP32 + PN532. The lane is a USB serial device: it
// exposes read/write/status commands over the CP210x and has no WiFi, server,
// registration, heartbeat, kiosk, or writer-job code.

#include <Arduino.h>

#include "gdg_config.h"
#include "nfc_lane.h"
#include "usb_api.h"

namespace {

NfcLane nfc;
UsbApi usbApi;
uint32_t lastNfcInitMs = 0;

void SetLed(bool on) {
#if GDG_STATUS_LED >= 0
  digitalWrite(GDG_STATUS_LED, on ? HIGH : LOW);
#else
  (void)on;
#endif
}

void EnsureNfc(uint32_t now) {
  if (nfc.IsReady()) return;
  if (now - lastNfcInitMs < 10000) return;
  lastNfcInitMs = now;
  nfc.Begin();
}

}  // namespace

void setup() {
  Serial.begin(GDG_SERIAL_BAUD);
  delay(250);
  Serial.println();
  Serial.printf("[boot] GDG@PSU USB lane firmware %s\n", GDG_FIRMWARE_VERSION);

#if GDG_STATUS_LED >= 0
  pinMode(GDG_STATUS_LED, OUTPUT);
#endif
  SetLed(false);

  nfc.Begin();
  lastNfcInitMs = millis();
  usbApi.Begin(&nfc);

  Serial.println("[boot] USB-only mode; no WiFi or server connection");
}

void loop() {
  const uint32_t now = millis();
  usbApi.Tick();
  EnsureNfc(now);
  SetLed(nfc.IsReady());
  delay(10);
}
