#pragma once

#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/stream_buffer.h>
#include <mbedtls/gcm.h>

#include <atomic>

#include "gdg_config.h"
#include "reader_crypto.h"

class NimBLEServer;
class NimBLECharacteristic;

/**
 * The reader's Bluetooth Low Energy link.
 *
 * It carries the same newline-delimited JSON as the cable, over one GATT
 * service with a write characteristic and a notify characteristic. Unlike the
 * cable, radio is reachable by anyone nearby, so nothing is trusted until both
 * ends have proved they hold the pairing key, and every frame after that is
 * sealed with a key made for that one session.
 *
 * NimBLE runs its callbacks on its own task. They only hand bytes and events
 * across; everything else happens in Tick(), on the main loop.
 */
class BleLink {
 public:
  enum class State : uint8_t { Off, Advertising, Connected, Secure };
  using LineHandler = void (*)(const char* line, void* context);

  void Begin(const char* deviceId, const char* firmware);
  /** Commands from an authenticated session are passed here as plain JSON. */
  void SetHandler(LineHandler handler, void* context);
  /** The pairing key, or nullptr when the reader has none. Ends any session. */
  void SetKey(const uint8_t* key, uint32_t epoch);

  /** Whether the radio should be reachable. Tick() moves it there. */
  void SetWanted(bool wanted) { wanted_ = wanted; }
  void Tick(uint32_t now);

  /** Sends one JSON line to the connected computer, sealed once authenticated. */
  bool SendLine(const char* json);
  /** Tells the computer which link took over, then lets go of it. */
  void Drop(const char* takenBy);

  State state() const { return state_; }
  const char* StateName() const;
  const char* Name() const { return name_; }
  bool HasPeer() const { return state_ == State::Connected || state_ == State::Secure; }

  // Called on the NimBLE task.
  void OnConnect(uint16_t handle);
  void OnDisconnect();
  void OnWrite(const uint8_t* data, size_t length);

 private:
  enum class AuthStage : uint8_t { None, Began };

  void EnsureStarted();
  void StartAdvertising();
  void StopAdvertising();
  void BeginSession(uint32_t now);
  void EndSession();
  void Disconnect();
  void PumpReceive(uint32_t now);
  void HandleLine(uint32_t now);
  void HandleAuthLine(uint32_t now);
  void FailAuth(uint32_t now, long id, const char* code);
  bool Transmit(const char* text, size_t length);
  void SendPlainError(long id, const char* code);
  bool BuildProof(const char* label, uint8_t out[gdgcrypto::kProofBytes]);

  char deviceId_[32] = {0};
  char name_[24] = {0};
  const char* firmware_ = "";
  LineHandler handler_ = nullptr;
  void* handlerContext_ = nullptr;

  bool hasKey_ = false;
  uint8_t key_[gdgcrypto::kKeyBytes] = {0};
  uint32_t epoch_ = 0;

  bool started_ = false;
  bool wanted_ = false;
  State state_ = State::Off;
  NimBLEServer* server_ = nullptr;
  NimBLECharacteristic* tx_ = nullptr;
  StreamBufferHandle_t receive_ = nullptr;

  std::atomic<uint16_t> pendingConnection_{0xFFFF};
  std::atomic<bool> pendingDisconnect_{false};
  std::atomic<bool> receiveOverflow_{false};

  uint16_t connection_ = 0xFFFF;
  bool disconnectRequested_ = false;
  uint32_t connectedAtMs_ = 0;
  uint32_t lastAdvertiseCheckMs_ = 0;
  // After a failed proof the radio stays quiet for a moment.
  uint32_t quietStartMs_ = 0;
  uint32_t quietForMs_ = 0;

  AuthStage authStage_ = AuthStage::None;
  uint8_t clientNonce_[gdgcrypto::kNonceBytes] = {0};
  uint8_t readerNonce_[gdgcrypto::kNonceBytes] = {0};

  mbedtls_gcm_context gcm_;
  bool sessionKeyed_ = false;
  uint64_t sendCounter_ = 0;
  uint64_t lastReceiveCounter_ = 0;

  char line_[GDG_BLE_LINE_BYTES];
  size_t lineLength_ = 0;
  bool discardingLine_ = false;
};
