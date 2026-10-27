#pragma once

#include <Arduino.h>

/**
 * Station-mode Wi-Fi lifecycle with bounded connect attempts. Uses a standard
 * WPA2-PSK network approved for devices; enterprise/EAP onboarding is a PSU
 * policy decision documented in docs/psu-network-validation.md and is NOT
 * silently bypassed here.
 */
class WifiLink {
 public:
  void Begin(const char* ssid, const char* password);
  bool EnsureConnected(uint32_t timeoutMs);
  bool IsConnected() const;
  int32_t Rssi() const;

 private:
  const char* ssid_ = nullptr;
  const char* password_ = nullptr;
  uint32_t lastAttemptMs_ = 0;
  bool started_ = false;
};
