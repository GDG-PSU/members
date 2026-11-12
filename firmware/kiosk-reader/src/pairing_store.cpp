#include "pairing_store.h"

#include <Preferences.h>

#include <cstring>

namespace {

const char kNamespace[] = "gdg-reader";
const char kKeyName[] = "key";
const char kEpochName[] = "epoch";
const char kBluetoothOffName[] = "bleoff";
const char kCheckLabel[] = "gdg-reader-kcv-v1";

}  // namespace

void PairingStore::Begin() {
  Preferences prefs;
  if (!prefs.begin(kNamespace, true)) {
    // Nothing has been stored on this reader yet.
    return;
  }
  bluetoothEnabled_ = !prefs.getBool(kBluetoothOffName, false);
  epoch_ = prefs.getUInt(kEpochName, 0);
  hasKey_ = prefs.getBytesLength(kKeyName) == sizeof(key_) &&
            prefs.getBytes(kKeyName, key_, sizeof(key_)) == sizeof(key_);
  if (!hasKey_) gdgcrypto::Wipe(key_, sizeof(key_));
  prefs.end();
}

bool PairingStore::SetKey(const uint8_t key[gdgcrypto::kKeyBytes], uint32_t epoch) {
  Preferences prefs;
  if (!prefs.begin(kNamespace, false)) return false;
  const bool stored = prefs.putBytes(kKeyName, key, gdgcrypto::kKeyBytes) == gdgcrypto::kKeyBytes;
  if (stored) prefs.putUInt(kEpochName, epoch);
  prefs.end();
  if (!stored) return false;

  memcpy(key_, key, sizeof(key_));
  epoch_ = epoch;
  hasKey_ = true;
  return true;
}

void PairingStore::ClearKey() {
  Preferences prefs;
  if (prefs.begin(kNamespace, false)) {
    prefs.remove(kKeyName);
    prefs.remove(kEpochName);
    prefs.end();
  }
  gdgcrypto::Wipe(key_, sizeof(key_));
  epoch_ = 0;
  hasKey_ = false;
}

void PairingStore::SetBluetoothEnabled(bool enabled) {
  Preferences prefs;
  if (prefs.begin(kNamespace, false)) {
    prefs.putBool(kBluetoothOffName, !enabled);
    prefs.end();
  }
  bluetoothEnabled_ = enabled;
}

void PairingStore::KeyCheck(char out[17]) const {
  out[0] = '\0';
  if (!hasKey_) return;

  uint8_t digest[gdgcrypto::kProofBytes];
  const uint8_t* const parts[] = {reinterpret_cast<const uint8_t*>(kCheckLabel)};
  const size_t lengths[] = {sizeof(kCheckLabel) - 1};
  if (!gdgcrypto::Hmac(key_, parts, lengths, 1, digest)) return;
  for (int index = 0; index < 8; index += 1) {
    snprintf(out + index * 2, 3, "%02x", digest[index]);
  }
}
