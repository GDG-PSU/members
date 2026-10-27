#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

struct HeartbeatResult {
  bool ok = false;
  bool authorized = false;
  String mode;
  String session;
  String serverTime;
  int httpStatus = 0;
  String error;
};

struct ScanAck {
  bool ok = false;
  String scanId;
  String status;
  int httpStatus = 0;
  String error;
};

struct WriteJob {
  bool present = false;
  String id;
  String cardUrl;
  String expiresAt;
  int httpStatus = 0;
  String error;
};

struct WriteAck {
  bool ok = false;
  int httpStatus = 0;
  String error;
};

/**
 * Narrow HTTPS client for the device middleware API. It never talks to
 * Supabase, never stores a Supabase key and never logs payloads or tokens.
 */
class DeviceApiClient {
 public:
  void Begin(const char* host, uint16_t port, const char* rootCaPem, const char* deviceId,
             const char* deviceSecret);

  HeartbeatResult Heartbeat(const String& firmwareVersion, const char* mode);
  ScanAck ReportScan(const String& cardToken, const String& idempotencyKey,
                     const String& firmwareVersion);
  WriteJob ClaimWriteJob(const String& firmwareVersion);
  WriteAck CompleteWriteJob(const String& jobId, bool written, bool readBackMatches,
                            const String& failureCode, size_t ndefLength);

 private:
  bool PostJson(const char* path, const JsonDocument& payload, String& responseBody, int& status,
                String& error);
  String NewRequestId() const;

  const char* host_ = nullptr;
  uint16_t port_ = 443;
  const char* rootCaPem_ = nullptr;
  const char* deviceId_ = nullptr;
  const char* deviceSecret_ = nullptr;
};
