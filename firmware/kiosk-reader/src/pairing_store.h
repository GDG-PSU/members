#pragma once

#include <Arduino.h>

#include "reader_crypto.h"

/**
 * What the reader remembers across power cycles: the Bluetooth pairing key it
 * was given over the cable, the key's epoch, and whether Bluetooth is allowed.
 *
 * The key only ever arrives over USB. Without one the radio stays off, so a
 * reader that was never plugged into an organizer's computer cannot be reached
 * wirelessly at all.
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
   * A short fingerprint of the key, so the server can tell whether the reader
   * holds the current one without the key leaving the reader again.
   */
  void KeyCheck(char out[17]) const;

 private:
  bool hasKey_ = false;
  bool bluetoothEnabled_ = true;
  uint32_t epoch_ = 0;
  uint8_t key_[gdgcrypto::kKeyBytes] = {0};
};
