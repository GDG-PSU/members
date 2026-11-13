#pragma once

#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/stream_buffer.h>

#include <atomic>

#include "gdg_config.h"
#include "pairing_store.h"
#include "secure_session.h"

class NimBLEServer;
class NimBLECharacteristic;

/**
 * The reader's Bluetooth Low Energy link.
 *
 * It carries the same newline-delimited JSON as the cable, over one GATT
 * service with a write characteristic and a notify characteristic. Radio is
 * reachable by anyone nearby, so a connection gets a few seconds to open a
 * SecureSession and is dropped the moment it sends anything else.
 *
 * NimBLE runs its callbacks on its own task. They only hand bytes and events
 * across; everything else happens in Tick(), on the main loop.
 */
class BleLink {
 public:
  enum class State : uint8_t { Off, Advertising, Connected, Secure };
  using LineHandler = void (*)(const char* line, void* context);

  void Begin(const char* deviceId, const char* firmware, const PairingStore* store);
  /** Commands from an authenticated session are passed here as plain JSON. */
  void SetHandler(LineHandler handler, void* context);

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
  /** Keeps the radio quiet for a moment, then lets go of the caller. */
  void Quiet(uint32_t now);
  bool Transmit(const char* text, size_t length);
  void SendPlainError(long id, const char* code);

  char name_[24] = {0};
  LineHandler handler_ = nullptr;
  void* handlerContext_ = nullptr;
  SecureSession session_;

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

  char line_[GDG_LINE_BYTES];
  size_t lineLength_ = 0;
  bool discardingLine_ = false;
};
