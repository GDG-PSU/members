// GDG@PSU NFC reader firmware.
//
// One physical lane per ESP32 + PN532. An organizer's browser drives it with
// read/write/status commands, over the USB cable or, when no computer is on the
// cable, over Bluetooth. There is no WiFi, server, registration, heartbeat,
// kiosk, or writer-job code: the reader never reaches the network by itself.
//
// The cable always wins. A reader cannot tell a charger from a computer
// electrically, because the USB chip on the board is separate from the ESP32,
// so "on USB" means a computer is talking over the cable.

#include <Arduino.h>

#include "ble_link.h"
#include "gdg_config.h"
#include "nfc_lane.h"
#include "pairing_store.h"
#include "reader_api.h"

namespace {

NfcLane nfc;
PairingStore store;
BleLink ble;
ReaderApi api;
uint32_t lastNfcInitMs = 0;
bool bootGraceOver = false;

void SetLed(bool on) {
#if GDG_STATUS_LED >= 0
  digitalWrite(GDG_STATUS_LED, on ? HIGH : LOW);
#else
  (void)on;
#endif
}

// Off: the NFC module is not answering. Steady: ready, on the cable or idle.
// Slow blink: waiting for a Bluetooth connection. Steady with a short dip every
// two seconds: in use over Bluetooth.
void UpdateLed(uint32_t now) {
  if (!nfc.IsReady()) {
    SetLed(false);
    return;
  }
  switch (ble.state()) {
    case BleLink::State::Advertising:
      SetLed((now / 500) % 2 == 0);
      break;
    case BleLink::State::Connected:
    case BleLink::State::Secure:
      SetLed(now % 2000 >= 120);
      break;
    case BleLink::State::Off:
    default:
      SetLed(true);
      break;
  }
}

void EnsureNfc(uint32_t now) {
  if (nfc.IsReady()) return;
  if (now - lastNfcInitMs < 10000) return;
  lastNfcInitMs = now;
  nfc.Begin();
}

void OnBluetoothLine(const char* line, void* context) {
  static_cast<ReaderApi*>(context)->HandleBluetoothLine(line);
}

// Bluetooth is reachable only when the reader has been paired over the cable,
// has not had Bluetooth switched off, and no computer is using the cable. The
// organizer's override is the one exception to the last rule.
void UpdateTransport(uint32_t now) {
  if (!bootGraceOver && now >= GDG_USB_BOOT_GRACE_MS) bootGraceOver = true;

  const bool allowed = store.HasKey() && store.BluetoothEnabled();
  const bool cableInUse = api.UsbSessionLive(now) && api.mode() != TransportMode::Bluetooth;
  const bool wanted = bootGraceOver && allowed && !cableInUse;

  if (!wanted && ble.HasPeer()) ble.Drop(allowed && cableInUse ? "usb" : "off");
  ble.SetWanted(wanted);
  ble.Tick(now);
}

}  // namespace

void setup() {
  Serial.begin(GDG_SERIAL_BAUD);
  delay(250);
  Serial.println();
  Serial.printf("[boot] GDG@PSU reader firmware %s\n", GDG_FIRMWARE_VERSION);

#if GDG_STATUS_LED >= 0
  pinMode(GDG_STATUS_LED, OUTPUT);
#endif
  SetLed(false);

  nfc.Begin();
  lastNfcInitMs = millis();

  store.Begin();
  api.Begin(&nfc, &ble, &store);
  ble.Begin(api.deviceId(), GDG_FIRMWARE_VERSION);
  ble.SetHandler(OnBluetoothLine, &api);
  ble.SetKey(store.HasKey() ? store.Key() : nullptr, store.Epoch());

  Serial.printf("[boot] Bluetooth %s; no WiFi or server connection\n",
                !store.HasKey() ? "not paired" : store.BluetoothEnabled() ? "paired" : "off");
  // A computer that just opened the port is waiting for this line.
  api.AnnounceReady();
}

void loop() {
  const uint32_t now = millis();
  api.TickUsb(now);
  UpdateTransport(now);
  EnsureNfc(now);
  UpdateLed(now);
  // A Bluetooth command should not wait a full idle tick for its answer.
  delay(ble.HasPeer() ? 2 : 10);
}
