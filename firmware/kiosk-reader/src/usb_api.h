#pragma once

#include <Arduino.h>

#include "nfc_lane.h"

/**
 * Local USB (CP210x serial) control API.
 *
 * The lane speaks newline-delimited JSON at 115200 baud. Boot/status logs are
 * still printed as plain lines; a client should ignore lines that do not start
 * with '{'. The API is intentionally local: physical USB access is the trust
 * boundary. There is no WiFi, server, device registration, or secret.
 */
class UsbApi {
 public:
  void Begin(NfcLane* nfc);
  void Tick();

 private:
  void HandleLine(const char* line);
  void SendInfo(long id);
  void SendStatus(long id);
  void HandleRead(long id);
  void HandleWrite(long id, const char* uri);
  void HandleReboot(long id);
  void SendError(long id, const char* error);

  NfcLane* nfc_ = nullptr;
  char deviceId_[32] = {0};
  char line_[1024];
  size_t lineLength_ = 0;
};
