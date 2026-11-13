#pragma once

#include <Arduino.h>

#include "reader_crypto.h"

/**
 * What the reader remembers across power cycles: its key, the key's number
 * (its epoch), and whether Bluetooth is allowed.
 *
 * The first key arrives over the cable, normally straight after flashing. A
 * later one arrives inside a session opened with the key it replaces. Without
 * a key the radio stays off and the reader does nothing but take one.
 */
class PairingStore {
 public:
  void Begin();

  bool HasKey() const { return hasKey_; }
  const uint8_t* Key() const { return key_; }
  uint32_t Epoch() const { return epoch_; }
  bool BluetoothEnabled() const { return bluetoothEnabled_; }

  bool SetKey(const uint8_t key[gdgcrypto::kKeyBytes], uint32_t epoch);
  void ClearKey();
  void SetBluetoothEnabled(bool enabled);

  /**
   * A short fingerprint of the key, so whoever set it can tell the reader kept
   * it without the key leaving the reader again.
   */
  void KeyCheck(char out[17]) const;

 private:
  bool hasKey_ = false;
  bool bluetoothEnabled_ = true;
  uint32_t epoch_ = 0;
  uint8_t key_[gdgcrypto::kKeyBytes] = {0};
};
