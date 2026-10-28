// GDG@PSU kiosk reader/writer firmware.
//
// One physical lane per ESP32 + PN532. The unit authenticates to the narrow
// device middleware API with a per-device secret, reads NDEF card URLs and
// (after an admin confirms) never awards anything by itself. Attendance and
// points are server transactions; this firmware only reports a scan.

#include <Arduino.h>
#include <esp_system.h>
#include <time.h>

#include <string>

#include "api_client.h"
#include "gdg_config.h"
#include "lane_state.h"
#include "ndef_url.h"
#include "nfc_lane.h"
#include "wifi_link.h"

// secrets.h is intentionally untracked. See include/secrets.example.h.
#if __has_include("secrets.h")
#include "secrets.h"
#else
#error "Create include/secrets.h from include/secrets.example.h (it is gitignored)."
#endif

namespace {

constexpr const char* kFirmwareVersion = GDG_FIRMWARE_VERSION;

WifiLink wifi;
DeviceApiClient api;
NfcLane nfc;
LaneStateMachine lane;

uint32_t lastHeartbeatMs = 0;
uint32_t lastPollMs = 0;
uint32_t lastScanMs = 0;
uint32_t lastNfcInitMs = 0;
uint32_t nextWifiRetryMs = 0;
uint32_t backoffMs = GDG_BACKOFF_BASE_MS;
uint32_t scanCounter = 0;

void SetLed(bool on) {
#if GDG_STATUS_LED >= 0
  digitalWrite(GDG_STATUS_LED, on ? HIGH : LOW);
#else
  (void)on;
#endif
}

uint32_t ResetBackoff() {
  backoffMs = GDG_BACKOFF_BASE_MS;
  return backoffMs;
}

uint32_t NextBackoff() {
  const uint32_t jitterRange = (backoffMs / 2) + 1;
  const uint32_t jitter = esp_random() % jitterRange;
  const uint32_t wait = backoffMs + jitter;
  const uint32_t next = backoffMs * 2;
  backoffMs = next > GDG_BACKOFF_MAX_MS ? GDG_BACKOFF_MAX_MS : next;
  return wait;
}

void GoOffline(const char* reasonCode) {
  if (lane.IsOffline()) return;
  Serial.printf("[lane] offline (%s)\n", reasonCode);
  lane.TransitionTo(LaneState::Offline);
  SetLed(false);
}

String NewIdempotencyKey() {
  scanCounter += 1;
  String key(GDG_DEVICE_ID);
  key += "-";
  key += String(esp_random(), HEX);
  key += "-";
  key += String(scanCounter);
  key += "-";
  key += String(millis(), HEX);
  return key;
}

void DoHeartbeat() {
  const char* requestedMode = lane.CanHandleWriteJobs() ? "writer" : "kiosk";
  const HeartbeatResult result = api.Heartbeat(kFirmwareVersion, requestedMode);
  lastHeartbeatMs = millis();

  if (!result.ok) {
    GoOffline(result.httpStatus == 401 || result.httpStatus == 403 ? "device_rejected"
                                                                  : "heartbeat_failed");
    return;
  }

  if (!lane.ApplyServerMode(result.mode)) {
    Serial.printf("[lane] server mode unusable: %s\n", result.mode.c_str());
    lane.TransitionTo(LaneState::ErrorRecovery);
    return;
  }

  ResetBackoff();
  // Server assigns the mode; never process the other capability at the same time.
  Serial.printf("[lane] %s session=%s serverTime=%s\n", LaneStateName(lane.state()),
                result.session.c_str(), result.serverTime.c_str());
}

void KioskTick(uint32_t now) {
  if (now - lastScanMs < GDG_SCAN_COOLDOWN_MS) return;

  String uri;
  String errorCode;
  if (!nfc.ReadCardUri(uri, errorCode)) {
    if (errorCode != "no_card") {
      lastScanMs = now;
      Serial.printf("[kiosk] read failed: %s\n", errorCode.c_str());
    }
    return;
  }
  lastScanMs = now;

  const gdg::NdefUrlResult parsed =
      gdg::ParseCardUrl(std::string(uri.c_str()), std::string(GDG_API_HOST));
  if (!parsed.ok()) {
    // A tag carrying anything other than an exact member card URL is ignored.
    Serial.printf("[kiosk] rejected tag: %s\n", gdg::NdefUrlErrorName(parsed.error));
    return;
  }

  SetLed(true);
  const ScanAck ack =
      api.ReportScan(String(parsed.token.c_str()), NewIdempotencyKey(), kFirmwareVersion);
  SetLed(false);

  if (!ack.ok) {
    Serial.printf("[kiosk] scan not accepted: %s\n", ack.error.c_str());
    if (ack.httpStatus == 0) GoOffline("scan_network");
    return;
  }

  // This is only a pending item. An organizer must confirm it on the kiosk page.
  Serial.printf("[kiosk] PENDING scan %s — waiting for organizer confirmation\n",
                ack.scanId.c_str());
}

void WriterTick(uint32_t now) {
  if (now - lastPollMs < GDG_JOB_POLL_INTERVAL_MS) return;
  lastPollMs = now;

  const WriteJob job = api.ClaimWriteJob(kFirmwareVersion);
  if (!job.error.isEmpty() && job.httpStatus == 0) {
    GoOffline("job_claim_network");
    return;
  }
  if (!job.present) return;

  if (!job.error.isEmpty()) {
    Serial.printf("[writer] unusable job: %s\n", job.error.c_str());
    api.CompleteWriteJob(job.id, false, false, job.error, 0);
    return;
  }

  const gdg::NdefUrlResult parsed =
      gdg::ParseCardUrl(std::string(job.cardUrl.c_str()), std::string(GDG_API_HOST));
  if (!parsed.ok()) {
    Serial.printf("[writer] job URL rejected: %s\n", gdg::NdefUrlErrorName(parsed.error));
    api.CompleteWriteJob(job.id, false, false, "invalid_job_url", 0);
    return;
  }

  Serial.printf("[writer] job %s target=%s\n", job.id.c_str(),
                gdg::MaskCardUrl(std::string(job.cardUrl.c_str())).c_str());

  String errorCode;
  const bool written = nfc.WriteCardUri(job.cardUrl, errorCode);
  if (!written) {
    Serial.printf("[writer] write failed: %s\n", errorCode.c_str());
    api.CompleteWriteJob(job.id, false, false, errorCode, 0);
    return;
  }

  const WriteAck ack =
      api.CompleteWriteJob(job.id, true, true, "", static_cast<size_t>(job.cardUrl.length()));
  Serial.printf("[writer] write+read-back confirmed%s\n",
                ack.ok ? "" : " (server acknowledgement failed)");
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
  Serial.printf("[boot] GDG@PSU lane firmware %s\n", kFirmwareVersion);

#if GDG_STATUS_LED >= 0
  pinMode(GDG_STATUS_LED, OUTPUT);
#endif
  SetLed(false);

  api.Begin(GDG_API_HOST, GDG_API_PORT, GDG_ROOT_CA_PEM, GDG_DEVICE_ID, GDG_DEVICE_SECRET);

  nfc.Begin();
  lastNfcInitMs = millis();

  configTime(0, 0, GDG_NTP_SERVER);
  wifi.Begin(GDG_WIFI_SSID, GDG_WIFI_PASSWORD);
  if (wifi.EnsureConnected(GDG_WIFI_CONNECT_TIMEOUT_MS)) {
    DoHeartbeat();
  } else {
    GoOffline("wifi_boot");
    nextWifiRetryMs = millis() + NextBackoff();
  }
  lastHeartbeatMs = millis();
}

void loop() {
  const uint32_t now = millis();

  if (!wifi.IsConnected()) {
    if (!lane.IsOffline()) GoOffline("wifi_lost");
    // Unmistakable offline indicator; no attendance or write work is done.
    SetLed(((now / 500) % 2) == 0);
    if (now >= nextWifiRetryMs) {
      nextWifiRetryMs = now + NextBackoff();
      if (wifi.EnsureConnected(GDG_WIFI_CONNECT_TIMEOUT_MS)) {
        ResetBackoff();
        if (lane.IsOffline() || lane.state() == LaneState::ErrorRecovery) {
          lane.TransitionTo(LaneState::Booting);
        }
        DoHeartbeat();
      }
    }
    delay(25);
    return;
  }

  SetLed(true);
  EnsureNfc(now);

  if (lane.IsOffline() || lane.state() == LaneState::ErrorRecovery) {
    lane.TransitionTo(LaneState::Booting);
    DoHeartbeat();
  } else if (now - lastHeartbeatMs >= GDG_HEARTBEAT_INTERVAL_MS) {
    DoHeartbeat();
  }

  if (lane.CanHandleAttendance()) {
    KioskTick(now);
  } else if (lane.CanHandleWriteJobs()) {
    WriterTick(now);
  }

  delay(10);
}
