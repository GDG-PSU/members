#include "ble_link.h"

#include <ArduinoJson.h>
#include <NimBLEDevice.h>

#include <cctype>
#include <cstring>

namespace {

// One service: the computer writes commands to RX and the reader notifies on TX.
const char kServiceUuid[] = "7c1f0001-5b0a-4f6e-9a54-6d5b2c8e41a7";
const char kRxUuid[] = "7c1f0002-5b0a-4f6e-9a54-6d5b2c8e41a7";
const char kTxUuid[] = "7c1f0003-5b0a-4f6e-9a54-6d5b2c8e41a7";

const char kAuthContext[] = "gdg-reader-auth-v1";
constexpr uint16_t kNoConnection = 0xFFFF;
constexpr size_t kReceiveBufferBytes = 2048;
constexpr size_t kFrameBytes = GDG_BLE_PLAIN_BYTES + gdgcrypto::kSealOverhead;

BleLink* activeLink = nullptr;

// Only the main loop touches these, one frame at a time.
uint8_t frameBuffer[kFrameBytes];
char plainBuffer[GDG_BLE_PLAIN_BYTES + 1];
char wireBuffer[GDG_BLE_LINE_BYTES + 2];

class ServerEvents : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* server, ble_gap_conn_desc* desc) override {
    // A short interval keeps a card tap as quick as it is over the cable.
    server->updateConnParams(desc->conn_handle, 6, 12, 0, 200);
    if (activeLink != nullptr) activeLink->OnConnect(desc->conn_handle);
  }

  void onDisconnect(NimBLEServer* server) override {
    (void)server;
    if (activeLink != nullptr) activeLink->OnDisconnect();
  }
};

class ReceiveEvents : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* characteristic) override {
    const NimBLEAttValue value = characteristic->getValue();
    if (activeLink != nullptr) activeLink->OnWrite(value.data(), value.length());
  }
};

}  // namespace

void BleLink::Begin(const char* deviceId, const char* firmware) {
  strlcpy(deviceId_, deviceId, sizeof(deviceId_));
  firmware_ = firmware;

  // The last four characters of the device ID tell two readers apart in the
  // browser's Bluetooth chooser.
  const size_t idLength = strlen(deviceId_);
  char suffix[5] = {0};
  for (size_t index = 0; index < 4 && index < idLength; index += 1) {
    const size_t start = idLength >= 4 ? idLength - 4 : 0;
    suffix[index] = static_cast<char>(toupper(static_cast<unsigned char>(deviceId_[start + index])));
  }
  snprintf(name_, sizeof(name_), "%s%s", GDG_BLE_NAME_PREFIX, suffix);

  receive_ = xStreamBufferCreate(kReceiveBufferBytes, 1);
  activeLink = this;
}

void BleLink::SetHandler(LineHandler handler, void* context) {
  handler_ = handler;
  handlerContext_ = context;
}

void BleLink::SetKey(const uint8_t* key, uint32_t epoch) {
  if (key == nullptr) {
    gdgcrypto::Wipe(key_, sizeof(key_));
    hasKey_ = false;
    epoch_ = 0;
  } else {
    memcpy(key_, key, sizeof(key_));
    hasKey_ = true;
    epoch_ = epoch;
  }
  // A session opened with the old key must not outlive it.
  Disconnect();
}

const char* BleLink::StateName() const {
  switch (state_) {
    case State::Advertising:
      return "advertising";
    case State::Connected:
      return "connected";
    case State::Secure:
      return "secure";
    case State::Off:
    default:
      return "off";
  }
}

void BleLink::EnsureStarted() {
  if (started_) return;
  started_ = true;

  NimBLEDevice::init(name_);
  NimBLEDevice::setPower(ESP_PWR_LVL_P9);
  NimBLEDevice::setMTU(247);

  server_ = NimBLEDevice::createServer();
  server_->setCallbacks(new ServerEvents());
  // Tick() decides when the reader may be found again.
  server_->advertiseOnDisconnect(false);

  NimBLEService* service = server_->createService(kServiceUuid);
  NimBLECharacteristic* rx = service->createCharacteristic(
      kRxUuid, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  rx->setCallbacks(new ReceiveEvents());
  tx_ = service->createCharacteristic(kTxUuid, NIMBLE_PROPERTY::NOTIFY);
  service->start();

  NimBLEAdvertising* advertising = NimBLEDevice::getAdvertising();
  advertising->addServiceUUID(kServiceUuid);
  advertising->setScanResponse(true);
  // 30 to 60 ms: the reader shows up in the chooser almost at once.
  advertising->setMinInterval(48);
  advertising->setMaxInterval(96);
}

void BleLink::StartAdvertising() {
  NimBLEDevice::getAdvertising()->start();
  state_ = State::Advertising;
}

void BleLink::StopAdvertising() {
  if (started_) NimBLEDevice::getAdvertising()->stop();
}

void BleLink::OnConnect(uint16_t handle) { pendingConnection_.store(handle); }

void BleLink::OnDisconnect() { pendingDisconnect_.store(true); }

void BleLink::OnWrite(const uint8_t* data, size_t length) {
  if (receive_ == nullptr || length == 0) return;
  if (xStreamBufferSend(receive_, data, length, 0) != length) receiveOverflow_.store(true);
}

void BleLink::BeginSession(uint32_t now) {
  state_ = State::Connected;
  connectedAtMs_ = now;
  disconnectRequested_ = false;
  authStage_ = AuthStage::None;
  sendCounter_ = 0;
  lastReceiveCounter_ = 0;
}

void BleLink::EndSession() {
  if (sessionKeyed_) {
    mbedtls_gcm_free(&gcm_);
    sessionKeyed_ = false;
  }
  gdgcrypto::Wipe(clientNonce_, sizeof(clientNonce_));
  gdgcrypto::Wipe(readerNonce_, sizeof(readerNonce_));
  authStage_ = AuthStage::None;
  disconnectRequested_ = false;
  lineLength_ = 0;
  discardingLine_ = false;
  receiveOverflow_.store(false);
  // Nothing of this session may be read as the start of the next one.
  if (receive_ != nullptr) xStreamBufferReset(receive_);
}

void BleLink::Disconnect() {
  if (connection_ == kNoConnection || disconnectRequested_ || server_ == nullptr) return;
  disconnectRequested_ = true;
  server_->disconnect(connection_);
}

void BleLink::Drop(const char* takenBy) {
  if (!HasPeer() || disconnectRequested_) return;
  char event[64];
  snprintf(event, sizeof(event), "{\"event\":\"transport\",\"to\":\"%s\"}", takenBy);
  SendLine(event);
  // Let the notification leave before the link goes.
  delay(40);
  Disconnect();
}

void BleLink::Tick(uint32_t now) {
  const uint16_t connected = pendingConnection_.exchange(kNoConnection);
  if (connected != kNoConnection) {
    connection_ = connected;
    BeginSession(now);
  }
  const bool gone = pendingDisconnect_.exchange(false) ||
                    (disconnectRequested_ && server_ != nullptr &&
                     server_->getConnectedCount() == 0);
  if (gone) {
    EndSession();
    connection_ = kNoConnection;
    state_ = State::Off;
  }

  if (!wanted_) {
    if (HasPeer()) {
      Disconnect();
    } else if (state_ == State::Advertising) {
      StopAdvertising();
      state_ = State::Off;
    }
    return;
  }

  if (state_ == State::Off) {
    if (quietForMs_ != 0 && now - quietStartMs_ < quietForMs_) return;
    quietForMs_ = 0;
    EnsureStarted();
    StartAdvertising();
    lastAdvertiseCheckMs_ = now;
    return;
  }

  if (state_ == State::Advertising) {
    // Advertising should never stop by itself; if it has, bring it back.
    if (now - lastAdvertiseCheckMs_ >= 3000) {
      lastAdvertiseCheckMs_ = now;
      if (!NimBLEDevice::getAdvertising()->isAdvertising() &&
          server_->getConnectedCount() == 0 && pendingConnection_.load() == kNoConnection) {
        StartAdvertising();
      }
    }
    return;
  }

  // Someone connected. They get a few seconds to prove who they are.
  if (state_ == State::Connected && now - connectedAtMs_ > GDG_BLE_AUTH_DEADLINE_MS) {
    Disconnect();
    return;
  }
  if (receiveOverflow_.exchange(false)) {
    Disconnect();
    return;
  }
  PumpReceive(now);
}

void BleLink::PumpReceive(uint32_t now) {
  uint8_t chunk[128];
  while (HasPeer() && !disconnectRequested_) {
    const size_t received = xStreamBufferReceive(receive_, chunk, sizeof(chunk), 0);
    if (received == 0) return;

    for (size_t index = 0; index < received; index += 1) {
      const char ch = static_cast<char>(chunk[index]);
      if (ch == '\r') continue;
      if (ch == '\n') {
        const bool complete = !discardingLine_ && lineLength_ > 0;
        discardingLine_ = false;
        if (complete) {
          line_[lineLength_] = '\0';
          HandleLine(now);
        }
        lineLength_ = 0;
        if (!HasPeer() || disconnectRequested_) return;
        continue;
      }
      if (discardingLine_) continue;
      if (lineLength_ >= sizeof(line_) - 1) {
        // No real frame is this long, so the sender is not one of ours.
        discardingLine_ = true;
        lineLength_ = 0;
        Disconnect();
        return;
      }
      line_[lineLength_++] = ch;
    }
  }
}

void BleLink::HandleLine(uint32_t now) {
  if (state_ == State::Connected) {
    HandleAuthLine(now);
    return;
  }

  // From here on every frame is sealed. Anything else ends the session.
  if (line_[0] != '#') {
    Disconnect();
    return;
  }
  size_t frameLength = 0;
  if (!gdgcrypto::Base64UrlDecode(line_ + 1, lineLength_ - 1, frameBuffer, sizeof(frameBuffer),
                                  frameLength)) {
    Disconnect();
    return;
  }
  uint64_t counter = 0;
  size_t plainLength = 0;
  if (!gdgcrypto::Open(&gcm_, gdgcrypto::kToReader, frameBuffer, frameLength, counter,
                       reinterpret_cast<uint8_t*>(plainBuffer), GDG_BLE_PLAIN_BYTES,
                       plainLength) ||
      counter <= lastReceiveCounter_) {
    // Forged, corrupted or replayed.
    Disconnect();
    return;
  }
  lastReceiveCounter_ = counter;
  plainBuffer[plainLength] = '\0';
  if (handler_ != nullptr) handler_(plainBuffer, handlerContext_);
}

bool BleLink::BuildProof(const char* label, uint8_t out[gdgcrypto::kProofBytes]) {
  char epochText[12];
  snprintf(epochText, sizeof(epochText), "%lu", static_cast<unsigned long>(epoch_));
  const uint8_t zero = 0;
  const uint8_t* const parts[] = {
      reinterpret_cast<const uint8_t*>(label),
      &zero,
      reinterpret_cast<const uint8_t*>(kAuthContext),
      &zero,
      reinterpret_cast<const uint8_t*>(deviceId_),
      &zero,
      reinterpret_cast<const uint8_t*>(epochText),
      &zero,
      clientNonce_,
      readerNonce_,
  };
  const size_t lengths[] = {
      strlen(label),         1, sizeof(kAuthContext) - 1, 1,
      strlen(deviceId_),     1, strlen(epochText),        1,
      sizeof(clientNonce_), sizeof(readerNonce_),
  };
  return gdgcrypto::Hmac(key_, parts, lengths, sizeof(lengths) / sizeof(lengths[0]), out);
}

void BleLink::HandleAuthLine(uint32_t now) {
  JsonDocument request;
  if (deserializeJson(request, line_)) {
    FailAuth(now, 0, "bad_json");
    return;
  }
  const long id = request["id"] | 0;
  const char* cmd = request["cmd"] | "";

  if (strcmp(cmd, "auth.begin") == 0) {
    if (!hasKey_) {
      SendPlainError(id, "not_paired");
      return;
    }
    const char* nonce = request["nonce"] | "";
    size_t nonceLength = 0;
    if (!gdgcrypto::Base64UrlDecode(nonce, strlen(nonce), clientNonce_, sizeof(clientNonce_),
                                    nonceLength) ||
        nonceLength != sizeof(clientNonce_)) {
      SendPlainError(id, "bad_nonce");
      return;
    }
    gdgcrypto::RandomBytes(readerNonce_, sizeof(readerNonce_));
    authStage_ = AuthStage::Began;

    char readerNonce[gdgcrypto::Base64UrlLength(gdgcrypto::kNonceBytes) + 1];
    gdgcrypto::Base64UrlEncode(readerNonce_, sizeof(readerNonce_), readerNonce,
                               sizeof(readerNonce));
    JsonDocument reply;
    reply["id"] = id;
    reply["ok"] = true;
    JsonObject result = reply["result"].to<JsonObject>();
    result["deviceId"] = deviceId_;
    result["epoch"] = epoch_;
    result["nonce"] = readerNonce;
    result["firmware"] = firmware_;
    char out[256];
    serializeJson(reply, out, sizeof(out));
    SendLine(out);
    return;
  }

  if (strcmp(cmd, "auth.finish") == 0) {
    if (authStage_ != AuthStage::Began) {
      FailAuth(now, id, "auth_out_of_order");
      return;
    }
    const char* proofText = request["proof"] | "";
    uint8_t proof[gdgcrypto::kProofBytes];
    size_t proofLength = 0;
    uint8_t expected[gdgcrypto::kProofBytes];
    if (!gdgcrypto::Base64UrlDecode(proofText, strlen(proofText), proof, sizeof(proof),
                                    proofLength) ||
        proofLength != sizeof(proof) || !BuildProof("client", expected) ||
        !gdgcrypto::ConstantTimeEqual(proof, expected, sizeof(proof))) {
      FailAuth(now, id, "auth_failed");
      return;
    }

    uint8_t readerProof[gdgcrypto::kProofBytes];
    uint8_t sessionKey[gdgcrypto::kKeyBytes];
    mbedtls_gcm_init(&gcm_);
    sessionKeyed_ = true;
    const bool keyed = BuildProof("reader", readerProof) && BuildProof("session", sessionKey) &&
                       mbedtls_gcm_setkey(&gcm_, MBEDTLS_CIPHER_ID_AES, sessionKey, 256) == 0;
    gdgcrypto::Wipe(sessionKey, sizeof(sessionKey));
    if (!keyed) {
      FailAuth(now, id, "auth_failed");
      return;
    }

    char readerProofText[gdgcrypto::Base64UrlLength(gdgcrypto::kProofBytes) + 1];
    gdgcrypto::Base64UrlEncode(readerProof, sizeof(readerProof), readerProofText,
                               sizeof(readerProofText));
    JsonDocument reply;
    reply["id"] = id;
    reply["ok"] = true;
    reply["result"]["proof"] = readerProofText;
    char out[128];
    serializeJson(reply, out, sizeof(out));
    // The reader's own proof goes out in the clear; everything after is sealed.
    SendLine(out);
    state_ = State::Secure;
    authStage_ = AuthStage::None;
    return;
  }

  SendPlainError(id, "auth_required");
}

void BleLink::FailAuth(uint32_t now, long id, const char* code) {
  SendPlainError(id, code);
  // A short pause, not a growing one. The key is far too long to guess, so a
  // longer silence would protect nothing and would let anyone nearby keep the
  // reader off the air by failing on purpose.
  quietStartMs_ = now;
  quietForMs_ = GDG_BLE_FAILED_PROOF_PAUSE_MS;
  delay(30);
  Disconnect();
}

void BleLink::SendPlainError(long id, const char* code) {
  char out[96];
  snprintf(out, sizeof(out), "{\"id\":%ld,\"ok\":false,\"error\":\"%s\"}", id, code);
  SendLine(out);
}

bool BleLink::SendLine(const char* json) {
  if (!HasPeer() || json == nullptr) return false;
  const size_t length = strlen(json);

  if (state_ != State::Secure) {
    if (length + 1 > sizeof(wireBuffer)) return false;
    memcpy(wireBuffer, json, length);
    wireBuffer[length] = '\n';
    return Transmit(wireBuffer, length + 1);
  }

  if (length > GDG_BLE_PLAIN_BYTES) return false;
  size_t frameLength = 0;
  sendCounter_ += 1;
  if (!gdgcrypto::Seal(&gcm_, gdgcrypto::kToHost, sendCounter_,
                       reinterpret_cast<const uint8_t*>(json), length, frameBuffer,
                       sizeof(frameBuffer), frameLength)) {
    return false;
  }
  wireBuffer[0] = '#';
  const size_t encoded = gdgcrypto::Base64UrlEncode(frameBuffer, frameLength, wireBuffer + 1,
                                                    sizeof(wireBuffer) - 2);
  if (encoded == 0) return false;
  wireBuffer[1 + encoded] = '\n';
  return Transmit(wireBuffer, encoded + 2);
}

bool BleLink::Transmit(const char* text, size_t length) {
  if (connection_ == kNoConnection || tx_ == nullptr || server_ == nullptr) return false;

  uint16_t mtu = server_->getPeerMTU(connection_);
  if (mtu < 23) mtu = 23;
  size_t chunk = static_cast<size_t>(mtu) - 3;
  if (chunk > 244) chunk = 244;

  size_t offset = 0;
  while (offset < length) {
    const size_t part = length - offset < chunk ? length - offset : chunk;
    tx_->setValue(reinterpret_cast<const uint8_t*>(text) + offset, part);
    tx_->notify();
    offset += part;
    // A long reply is several notifications; give the radio room between them.
    if (offset < length) delay(4);
  }
  return true;
}
