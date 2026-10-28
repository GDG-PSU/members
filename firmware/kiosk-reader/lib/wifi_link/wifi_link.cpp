#include "wifi_link.h"

#include <WiFi.h>

#include "gdg_config.h"

void WifiLink::Begin(const char* ssid, const char* password) {
  ssid_ = ssid;
  password_ = password;
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);
  if (ssid_ != nullptr && ssid_[0] != '\0') {
    WiFi.begin(ssid_, password_);
    started_ = true;
    lastAttemptMs_ = millis();
  }
}

bool WifiLink::IsConnected() const { return WiFi.status() == WL_CONNECTED; }

int32_t WifiLink::Rssi() const { return IsConnected() ? WiFi.RSSI() : 0; }

bool WifiLink::EnsureConnected(uint32_t timeoutMs) {
  if (IsConnected()) return true;
  if (!started_) return false;

  const uint32_t now = millis();
  // Avoid hammering the AP: at most one new attempt every 5 seconds.
  if (now - lastAttemptMs_ < 5000 && lastAttemptMs_ != 0) return false;
  lastAttemptMs_ = now;

  WiFi.disconnect(false, false);
  WiFi.begin(ssid_, password_);

  const uint32_t deadline = millis() + timeoutMs;
  while (millis() < deadline) {
    if (WiFi.status() == WL_CONNECTED) {
      return true;
    }
    delay(50);
  }
  return WiFi.status() == WL_CONNECTED;
}
