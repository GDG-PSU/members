#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

#include "ble_link.h"
#include "gdg_config.h"
#include "nfc_lane.h"
#include "pairing_store.h"

/** Which link a command arrived on, and so where its answer goes. */
enum class Link : uint8_t { Usb, Bluetooth };

/**
 * Auto prefers the cable: while a computer is talking over USB, Bluetooth is
 * off. Bluetooth is the organizer's override, set over the cable, and lasts
 * until they set it back or the reader restarts.
 */
enum class TransportMode : uint8_t { Auto, Bluetooth };

/**
 * The reader's control API: newline-delimited JSON, the same commands on both
 * links. Boot and status logs are plain lines on the cable; a client ignores
 * any line that does not start with '{'.
 *
 * The cable is trusted because it is physical. Bluetooth commands only reach
 * this class after BleLink has authenticated the session, and the commands that
 * decide who may use Bluetooth at all are accepted from the cable alone.
 */
class ReaderApi {
 public:
  void Begin(NfcLane* nfc, BleLink* ble, PairingStore* store);
  /** Reads the serial port and answers every complete line. */
  void TickUsb(uint32_t now);
  /** One authenticated command from the Bluetooth link. */
  void HandleBluetoothLine(const char* line);
  /** Tells a waiting computer the reader has finished starting. */
  void AnnounceReady();

  /** True while a computer has spoken over the cable recently. */
  bool UsbSessionLive(uint32_t now) const;
  TransportMode mode() const { return mode_; }
  const char* deviceId() const { return deviceId_; }

 private:
  void HandleLine(Link link, const char* line, uint32_t now);
  void Send(Link link, JsonDocument& doc);
  void SendOk(Link link, long id);
  void SendError(Link link, long id, const char* error);
  void SendInfo(Link link, long id);
  void SendStatus(Link link, long id);
  void HandleRead(Link link, long id);
  void HandleWrite(Link link, long id, const char* uri);
  void HandleReboot(Link link, long id);
  void HandlePairSet(long id, const char* key, long epoch);
  void HandleTransportSet(long id, const char* mode);

  NfcLane* nfc_ = nullptr;
  BleLink* ble_ = nullptr;
  PairingStore* store_ = nullptr;
  TransportMode mode_ = TransportMode::Auto;
  bool usbSeen_ = false;
  uint32_t lastUsbFrameMs_ = 0;
  char deviceId_[32] = {0};
  char line_[1024];
  size_t lineLength_ = 0;
  bool discardingLine_ = false;
};
