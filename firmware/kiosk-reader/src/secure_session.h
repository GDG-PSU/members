#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <mbedtls/gcm.h>

#include "gdg_config.h"
#include "pairing_store.h"
#include "reader_crypto.h"

/**
 * One authenticated, sealed conversation with a computer. The cable and the
 * Bluetooth link each have their own.
 *
 * The reader obeys nothing until both ends have proved they hold its key:
 * `auth.begin` and `auth.finish` travel in the clear, and every line after
 * them is sealed with a key made for that one session. The website holds the
 * key, so only a signed-in organizer's browser can open a session.
 *
 * The matching code is apps/web/src/lib/reader (keys.ts on the server,
 * handshake.ts and secure-channel.ts in the browser), and docs/usb-api.md
 * states the format.
 */
class SecureSession {
 public:
  enum class AuthResult : uint8_t {
    /** Not a handshake command; nothing was written. */
    NotAuth,
    /** Send the reply in the clear. No session is open yet. */
    Reply,
    /** Send the reply in the clear. The proof was wrong or out of order. */
    Failed,
    /** Send the reply in the clear. Everything after it is sealed. */
    Opened,
  };

  void Begin(const char* deviceId, const char* firmware, const PairingStore* store);
  bool open() const { return open_; }
  /** Forgets the session and any handshake under way. */
  void End();

  /** Answers auth.begin and auth.finish. The reply is one terminated JSON line. */
  AuthResult HandleAuth(const char* cmd, long id, JsonDocument& request, char* out,
                        size_t outSize);

  /**
   * Opens a "#..." line. False when it was forged, corrupted or replayed, or no
   * session is open. `plain` is not terminated.
   */
  bool Open(const char* line, size_t lineLength, char* plain, size_t plainSize,
            size_t& plainLength);
  /** Writes a terminated "#..." line with no newline. Returns its length, or 0. */
  size_t Seal(const char* json, char* out, size_t outSize);

 private:
  bool BuildProof(const char* label, uint8_t out[gdgcrypto::kProofBytes]) const;

  const char* deviceId_ = "";
  const char* firmware_ = "";
  const PairingStore* store_ = nullptr;

  bool began_ = false;
  uint8_t clientNonce_[gdgcrypto::kNonceBytes] = {0};
  uint8_t readerNonce_[gdgcrypto::kNonceBytes] = {0};

  bool open_ = false;
  mbedtls_gcm_context gcm_;
  uint64_t sendCounter_ = 0;
  uint64_t lastReceiveCounter_ = 0;
};
