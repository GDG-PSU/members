#include "api_client.h"

#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_system.h>

#include "config.h"
#include "ndef_url.h"

namespace {

const char* kHeartbeatPath = "/api/device/v1/heartbeat";
const char* kScanPath = "/api/device/v1/scans";
const char* kClaimPath = "/api/device/v1/write-jobs/claim";
const char* kCompletePath = "/api/device/v1/write-jobs/complete";

}  // namespace

void DeviceApiClient::Begin(const char* host, uint16_t port, const char* rootCaPem,
                            const char* deviceId, const char* deviceSecret) {
  host_ = host;
  port_ = port;
  rootCaPem_ = rootCaPem;
  deviceId_ = deviceId;
  deviceSecret_ = deviceSecret;
}

String DeviceApiClient::NewRequestId() const {
  String id;
  id.reserve(32);
  char buffer[3];
  for (int i = 0; i < 16; ++i) {
    const uint8_t value = static_cast<uint8_t>(esp_random() & 0xFF);
    snprintf(buffer, sizeof(buffer), "%02x", value);
    id += buffer;
  }
  return id;
}

bool DeviceApiClient::PostJson(const char* path, const JsonDocument& payload, String& responseBody,
                               int& status, String& error) {
  responseBody = "";
  status = 0;
  error = "";

  if (host_ == nullptr || rootCaPem_ == nullptr || deviceId_ == nullptr ||
      deviceSecret_ == nullptr) {
    error = "client_not_configured";
    return false;
  }

  String body;
  body.reserve(192);
  serializeJson(payload, body);
  if (body.length() > 4096) {
    error = "payload_too_large";
    return false;
  }

  WiFiClientSecure secureClient;
  secureClient.setCACert(rootCaPem_);
  secureClient.setTimeout(GDG_HTTP_TIMEOUT_MS / 1000);

  HTTPClient http;
  http.setTimeout(GDG_HTTP_TIMEOUT_MS);
  http.setConnectTimeout(GDG_HTTP_CONNECT_TIMEOUT_MS);
  http.setReuse(false);

  if (!http.begin(secureClient, host_, port_, path, true)) {
    error = "tls_begin_failed";
    http.end();
    return false;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("Accept", "application/json");
  http.addHeader("x-device-id", deviceId_);
  http.addHeader("x-device-secret", deviceSecret_);
  http.addHeader("x-request-id", NewRequestId());
  http.addHeader("User-Agent", "gdgpsu-kiosk/" GDG_FIRMWARE_VERSION);

  status = http.POST(body);
  if (status <= 0) {
    error = "network_error";
    http.end();
    return false;
  }
  responseBody = http.getString();
  http.end();

  if (status < 200 || status >= 300) {
    error = "http_status";
    return false;
  }
  return true;
}

HeartbeatResult DeviceApiClient::Heartbeat(const String& firmwareVersion, const char* mode) {
  HeartbeatResult result;

  JsonDocument payload;
  payload["firmwareVersion"] = firmwareVersion;
  payload["mode"] = mode;
  JsonObject diagnostics = payload["diagnostics"].to<JsonObject>();
  diagnostics["rssi"] = WiFi.RSSI();
  diagnostics["uptimeSeconds"] = static_cast<uint32_t>(millis() / 1000);

  String body;
  String error;
  int status = 0;
  if (!PostJson(kHeartbeatPath, payload, body, status, error)) {
    result.httpStatus = status;
    result.error = error;
    return result;
  }

  JsonDocument response;
  if (deserializeJson(response, body) != DeserializationError::Ok) {
    result.httpStatus = status;
    result.error = "invalid_response";
    return result;
  }

  result.ok = true;
  result.authorized = true;
  result.httpStatus = status;
  result.mode = String(response["mode"] | "kiosk");
  result.session = String(response["session"] | "");
  result.serverTime = String(response["serverTime"] | "");
  return result;
}

ScanAck DeviceApiClient::ReportScan(const String& cardToken, const String& idempotencyKey,
                                    const String& firmwareVersion) {
  ScanAck ack;

  const std::string token(cardToken.c_str());
  if (!gdg::IsCardToken(token)) {
    ack.error = "invalid_card_token";
    return ack;
  }

  JsonDocument payload;
  payload["cardToken"] = cardToken;
  payload["idempotencyKey"] = idempotencyKey;
  payload["firmwareVersion"] = firmwareVersion;

  String body;
  String error;
  int status = 0;
  if (!PostJson(kScanPath, payload, body, status, error)) {
    ack.httpStatus = status;
    ack.error = error;
    return ack;
  }

  JsonDocument response;
  if (deserializeJson(response, body) != DeserializationError::Ok) {
    ack.httpStatus = status;
    ack.error = "invalid_response";
    return ack;
  }

  ack.ok = true;
  ack.httpStatus = status;
  ack.scanId = String(response["scanId"] | "");
  ack.status = String(response["status"] | "pending");
  return ack;
}

WriteJob DeviceApiClient::ClaimWriteJob(const String& firmwareVersion) {
  WriteJob job;

  JsonDocument payload;
  payload["firmwareVersion"] = firmwareVersion;

  String body;
  String error;
  int status = 0;
  if (!PostJson(kClaimPath, payload, body, status, error)) {
    job.httpStatus = status;
    job.error = error;
    return job;
  }

  JsonDocument response;
  if (deserializeJson(response, body) != DeserializationError::Ok) {
    job.httpStatus = status;
    job.error = "invalid_response";
    return job;
  }

  JsonObject jobObject = response["job"].as<JsonObject>();
  job.httpStatus = status;
  if (jobObject.isNull()) {
    return job;
  }

  job.present = true;
  job.id = String(jobObject["id"] | "");
  job.cardUrl = String(jobObject["cardUrl"] | "");
  job.expiresAt = String(jobObject["expiresAt"] | "");
  if (job.id.isEmpty() || job.cardUrl.isEmpty()) {
    job.present = false;
    job.error = "invalid_job";
  }
  return job;
}

WriteAck DeviceApiClient::CompleteWriteJob(const String& jobId, bool written, bool readBackMatches,
                                           const String& failureCode, size_t ndefLength) {
  WriteAck ack;

  if (jobId.isEmpty()) {
    ack.error = "missing_job_id";
    return ack;
  }

  JsonDocument payload;
  payload["jobId"] = jobId;
  payload["status"] = written ? "written" : "failed";
  payload["readBackMatches"] = readBackMatches;
  if (!failureCode.isEmpty()) {
    payload["failureCode"] = failureCode;
  }
  if (ndefLength > 0 && ndefLength <= 1024) {
    payload["ndefLength"] = static_cast<uint16_t>(ndefLength);
  }

  String body;
  String error;
  int status = 0;
  if (!PostJson(kCompletePath, payload, body, status, error)) {
    ack.httpStatus = status;
    ack.error = error;
    return ack;
  }

  ack.ok = true;
  ack.httpStatus = status;
  return ack;
}
