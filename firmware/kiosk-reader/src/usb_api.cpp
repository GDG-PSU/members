#include "usb_api.h"

#include <ArduinoJson.h>
#include <esp_system.h>

#include <cstring>

#include "gdg_config.h"

namespace {

void SendDocument(JsonDocument& doc) {
  serializeJson(doc, Serial);
  Serial.println();
}

String ChipId() {
  char value[17] = {0};
  snprintf(value, sizeof(value), "%012llx",
           static_cast<unsigned long long>(ESP.getEfuseMac()));
  return String(value);
}

}  // namespace

void UsbApi::Begin(NfcLane* nfc) {
  nfc_ = nfc;
  lineLength_ = 0;

  const String chipId = ChipId();
  snprintf(deviceId_, sizeof(deviceId_), "esp32-%s", chipId.c_str());

  Serial.println("[usb] JSON control API ready");
  Serial.printf("[usb] device id %s\n", deviceId_);
}

void UsbApi::Tick() {
  while (Serial.available() > 0) {
    const char ch = static_cast<char>(Serial.read());
    if (ch == '\r') continue;
    if (ch == '\n') {
      if (lineLength_ == 0) continue;
      line_[lineLength_] = '\0';
      HandleLine(line_);
      lineLength_ = 0;
      continue;
    }
    if (lineLength_ >= sizeof(line_) - 1) {
      lineLength_ = 0;
      SendError(0, "line_too_long");
      continue;
    }
    line_[lineLength_++] = ch;
  }
}

void UsbApi::HandleLine(const char* line) {
  JsonDocument doc;
  const DeserializationError parseError = deserializeJson(doc, line);
  if (parseError) {
    SendError(0, "bad_json");
    return;
  }

  const long id = doc["id"] | 0;
  const char* cmd = doc["cmd"] | "";
  if (cmd == nullptr || cmd[0] == '\0') {
    SendError(id, "missing_cmd");
    return;
  }

  if (strcmp(cmd, "info") == 0) {
    SendInfo(id);
  } else if (strcmp(cmd, "nfc.status") == 0) {
    SendStatus(id);
  } else if (strcmp(cmd, "nfc.read") == 0) {
    HandleRead(id);
  } else if (strcmp(cmd, "nfc.write") == 0) {
    HandleWrite(id, doc["uri"] | "");
  } else if (strcmp(cmd, "reboot") == 0) {
    HandleReboot(id);
  } else {
    SendError(id, "unknown_cmd");
  }
}

void UsbApi::SendInfo(long id) {
  JsonDocument doc;
  doc["id"] = id;
  doc["ok"] = true;
  JsonObject result = doc["result"].to<JsonObject>();
  result["protocol"] = 2;
  result["firmware"] = GDG_FIRMWARE_VERSION;
  result["deviceId"] = deviceId_;
  result["chipId"] = ChipId();
  result["transport"] = "usb-serial";
  result["nfcReady"] = nfc_ != nullptr && nfc_->IsReady();
  result["nfcFirmware"] = nfc_ != nullptr ? nfc_->FirmwareVersion() : 0;
  result["uptimeMs"] = millis();
  SendDocument(doc);
}

void UsbApi::SendStatus(long id) {
  JsonDocument doc;
  doc["id"] = id;
  doc["ok"] = true;
  JsonObject result = doc["result"].to<JsonObject>();
  result["ready"] = nfc_ != nullptr && nfc_->IsReady();
  result["firmware"] = nfc_ != nullptr ? nfc_->FirmwareVersion() : 0;
  SendDocument(doc);
}

void UsbApi::HandleRead(long id) {
  if (nfc_ == nullptr) {
    SendError(id, "nfc_unavailable");
    return;
  }

  String uri;
  String error;
  const bool ok = nfc_->ReadCardUri(uri, error);

  JsonDocument doc;
  doc["id"] = id;
  doc["ok"] = ok;
  if (ok) {
    JsonObject result = doc["result"].to<JsonObject>();
    result["uri"] = uri;
  } else {
    doc["error"] = error.isEmpty() ? "read_failed" : error;
  }
  SendDocument(doc);
}

void UsbApi::HandleWrite(long id, const char* uri) {
  if (nfc_ == nullptr) {
    SendError(id, "nfc_unavailable");
    return;
  }
  if (uri == nullptr || uri[0] == '\0') {
    SendError(id, "missing_uri");
    return;
  }

  String error;
  const bool ok = nfc_->WriteCardUri(String(uri), error);

  JsonDocument doc;
  doc["id"] = id;
  doc["ok"] = ok;
  if (ok) {
    JsonObject result = doc["result"].to<JsonObject>();
    result["uriLength"] = static_cast<unsigned int>(strlen(uri));
    result["readBack"] = true;
  } else {
    doc["error"] = error.isEmpty() ? "write_failed" : error;
  }
  SendDocument(doc);
}

void UsbApi::HandleReboot(long id) {
  JsonDocument doc;
  doc["id"] = id;
  doc["ok"] = true;
  SendDocument(doc);
  delay(150);
  ESP.restart();
}

void UsbApi::SendError(long id, const char* error) {
  JsonDocument doc;
  doc["id"] = id;
  doc["ok"] = false;
  doc["error"] = error != nullptr ? error : "error";
  SendDocument(doc);
}
