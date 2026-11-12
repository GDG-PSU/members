#include "reader_api.h"

#include <esp_system.h>

#include <cstring>

namespace {

constexpr int kProtocol = 3;

String ChipId() {
  char value[17] = {0};
  snprintf(value, sizeof(value), "%012llx",
           static_cast<unsigned long long>(ESP.getEfuseMac()));
  return String(value);
}

/** Commands that decide who may use Bluetooth are taken from the cable only. */
bool IsCableOnly(const char* cmd) {
  return strcmp(cmd, "pair.set") == 0 || strcmp(cmd, "pair.clear") == 0 ||
         strcmp(cmd, "bluetooth.set") == 0 || strcmp(cmd, "transport.set") == 0 ||
         strcmp(cmd, "usb.release") == 0;
}

}  // namespace

void ReaderApi::Begin(NfcLane* nfc, BleLink* ble, PairingStore* store) {
  nfc_ = nfc;
  ble_ = ble;
  store_ = store;
  lineLength_ = 0;

  const String chipId = ChipId();
  snprintf(deviceId_, sizeof(deviceId_), "esp32-%s", chipId.c_str());

  Serial.println("[usb] JSON control API ready");
  Serial.printf("[usb] device id %s\n", deviceId_);
}

void ReaderApi::AnnounceReady() {
  JsonDocument doc;
  doc["event"] = "ready";
  doc["protocol"] = kProtocol;
  doc["firmware"] = GDG_FIRMWARE_VERSION;
  doc["deviceId"] = deviceId_;
  Send(Link::Usb, doc);
}

bool ReaderApi::UsbSessionLive(uint32_t now) const {
  return usbSeen_ && now - lastUsbFrameMs_ < GDG_USB_SESSION_TIMEOUT_MS;
}

void ReaderApi::TickUsb(uint32_t now) {
  while (Serial.available() > 0) {
    const char ch = static_cast<char>(Serial.read());
    if (ch == '\r') continue;
    if (ch == '\n') {
      const bool complete = !discardingLine_ && lineLength_ > 0;
      discardingLine_ = false;
      if (complete) {
        line_[lineLength_] = '\0';
        HandleLine(Link::Usb, line_, now);
      }
      lineLength_ = 0;
      continue;
    }
    if (discardingLine_) continue;
    if (lineLength_ >= sizeof(line_) - 1) {
      // The rest of this line is not a command, so nothing may parse it as one.
      discardingLine_ = true;
      lineLength_ = 0;
      SendError(Link::Usb, 0, "line_too_long");
      continue;
    }
    line_[lineLength_++] = ch;
  }
}

void ReaderApi::HandleBluetoothLine(const char* line) {
  HandleLine(Link::Bluetooth, line, millis());
}

void ReaderApi::HandleLine(Link link, const char* line, uint32_t now) {
  JsonDocument doc;
  const DeserializationError parseError = deserializeJson(doc, line);
  if (parseError) {
    SendError(link, 0, "bad_json");
    return;
  }

  const long id = doc["id"] | 0;
  const char* cmd = doc["cmd"] | "";
  if (cmd == nullptr || cmd[0] == '\0') {
    SendError(link, id, "missing_cmd");
    return;
  }

  if (link == Link::Usb) {
    // Line noise on an idle cable must not look like a computer, so only a
    // well-formed command counts as one.
    usbSeen_ = true;
    lastUsbFrameMs_ = now;
  } else if (IsCableOnly(cmd)) {
    SendError(link, id, "usb_only");
    return;
  }

  if (strcmp(cmd, "info") == 0) {
    SendInfo(link, id);
  } else if (strcmp(cmd, "ping") == 0) {
    SendOk(link, id);
  } else if (strcmp(cmd, "nfc.status") == 0) {
    SendStatus(link, id);
  } else if (strcmp(cmd, "nfc.read") == 0) {
    HandleRead(link, id);
  } else if (strcmp(cmd, "nfc.write") == 0) {
    HandleWrite(link, id, doc["uri"] | "");
  } else if (strcmp(cmd, "reboot") == 0) {
    HandleReboot(link, id);
  } else if (strcmp(cmd, "pair.set") == 0) {
    HandlePairSet(id, doc["key"] | "", doc["epoch"] | 0L);
  } else if (strcmp(cmd, "pair.clear") == 0) {
    store_->ClearKey();
    ble_->SetKey(nullptr, 0);
    SendOk(link, id);
  } else if (strcmp(cmd, "bluetooth.set") == 0) {
    if (!doc["enabled"].is<bool>()) {
      SendError(link, id, "missing_enabled");
      return;
    }
    store_->SetBluetoothEnabled(doc["enabled"].as<bool>());
    SendOk(link, id);
  } else if (strcmp(cmd, "transport.set") == 0) {
    HandleTransportSet(id, doc["mode"] | "");
  } else if (strcmp(cmd, "usb.release") == 0) {
    // The computer is done with the cable, so Bluetooth need not wait for the
    // session to time out.
    SendOk(link, id);
    usbSeen_ = false;
  } else {
    SendError(link, id, "unknown_cmd");
  }

  // Writing a card can take a while. The computer was on the cable for all of
  // it, so the session is counted from when the answer went out.
  if (link == Link::Usb && usbSeen_) lastUsbFrameMs_ = millis();
}

void ReaderApi::Send(Link link, JsonDocument& doc) {
  if (link == Link::Usb) {
    serializeJson(doc, Serial);
    Serial.println();
    return;
  }

  char out[GDG_BLE_PLAIN_BYTES + 1];
  if (measureJson(doc) > GDG_BLE_PLAIN_BYTES) {
    ble_->SendLine("{\"id\":0,\"ok\":false,\"error\":\"reply_too_long\"}");
    return;
  }
  serializeJson(doc, out, sizeof(out));
  ble_->SendLine(out);
}

void ReaderApi::SendOk(Link link, long id) {
  JsonDocument doc;
  doc["id"] = id;
  doc["ok"] = true;
  Send(link, doc);
}

void ReaderApi::SendError(Link link, long id, const char* error) {
  JsonDocument doc;
  doc["id"] = id;
  doc["ok"] = false;
  doc["error"] = error != nullptr ? error : "error";
  Send(link, doc);
}

void ReaderApi::SendInfo(Link link, long id) {
  JsonDocument doc;
  doc["id"] = id;
  doc["ok"] = true;
  JsonObject result = doc["result"].to<JsonObject>();
  result["protocol"] = kProtocol;
  result["firmware"] = GDG_FIRMWARE_VERSION;
  result["deviceId"] = deviceId_;
  result["chipId"] = ChipId();
  result["transport"] = link == Link::Usb ? "usb-serial" : "bluetooth";
  result["mode"] = mode_ == TransportMode::Bluetooth ? "bluetooth" : "auto";
  result["nfcReady"] = nfc_ != nullptr && nfc_->IsReady();
  result["nfcFirmware"] = nfc_ != nullptr ? nfc_->FirmwareVersion() : 0;
  result["uptimeMs"] = millis();

  JsonObject bluetooth = result["bluetooth"].to<JsonObject>();
  bluetooth["name"] = ble_->Name();
  bluetooth["enabled"] = store_->BluetoothEnabled();
  bluetooth["paired"] = store_->HasKey();
  bluetooth["state"] = ble_->StateName();
  if (store_->HasKey()) {
    char check[17];
    store_->KeyCheck(check);
    bluetooth["epoch"] = store_->Epoch();
    bluetooth["check"] = check;
  }
  Send(link, doc);
}

void ReaderApi::SendStatus(Link link, long id) {
  JsonDocument doc;
  doc["id"] = id;
  doc["ok"] = true;
  JsonObject result = doc["result"].to<JsonObject>();
  result["ready"] = nfc_ != nullptr && nfc_->IsReady();
  result["firmware"] = nfc_ != nullptr ? nfc_->FirmwareVersion() : 0;
  Send(link, doc);
}

void ReaderApi::HandleRead(Link link, long id) {
  if (nfc_ == nullptr) {
    SendError(link, id, "nfc_unavailable");
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
  Send(link, doc);
}

void ReaderApi::HandleWrite(Link link, long id, const char* uri) {
  if (nfc_ == nullptr) {
    SendError(link, id, "nfc_unavailable");
    return;
  }
  if (uri == nullptr || uri[0] == '\0') {
    SendError(link, id, "missing_uri");
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
  Send(link, doc);
}

void ReaderApi::HandleReboot(Link link, long id) {
  SendOk(link, id);
  delay(150);
  ESP.restart();
}

void ReaderApi::HandlePairSet(long id, const char* key, long epoch) {
  uint8_t bytes[gdgcrypto::kKeyBytes];
  size_t length = 0;
  if (epoch < 1 ||
      !gdgcrypto::Base64UrlDecode(key, strlen(key), bytes, sizeof(bytes), length) ||
      length != sizeof(bytes)) {
    SendError(Link::Usb, id, "bad_key");
    return;
  }

  const bool stored = store_->SetKey(bytes, static_cast<uint32_t>(epoch));
  gdgcrypto::Wipe(bytes, sizeof(bytes));
  if (!stored) {
    SendError(Link::Usb, id, "key_not_saved");
    return;
  }
  ble_->SetKey(store_->Key(), store_->Epoch());

  JsonDocument doc;
  doc["id"] = id;
  doc["ok"] = true;
  char check[17];
  store_->KeyCheck(check);
  doc["result"]["check"] = check;
  Send(Link::Usb, doc);
}

void ReaderApi::HandleTransportSet(long id, const char* mode) {
  if (strcmp(mode, "auto") == 0) {
    mode_ = TransportMode::Auto;
  } else if (strcmp(mode, "bluetooth") == 0) {
    if (!store_->HasKey() || !store_->BluetoothEnabled()) {
      SendError(Link::Usb, id, store_->HasKey() ? "bluetooth_off" : "not_paired");
      return;
    }
    mode_ = TransportMode::Bluetooth;
  } else {
    SendError(Link::Usb, id, "bad_mode");
    return;
  }
  SendOk(Link::Usb, id);
}
