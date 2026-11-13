#include "secure_session.h"

#include <cstring>

namespace {

const char kAuthContext[] = "gdg-reader-auth-v1";

// Only the main loop seals and opens, one line at a time, on either link.
uint8_t frameBuffer[GDG_PLAIN_BYTES + gdgcrypto::kSealOverhead];

void WriteError(char* out, size_t outSize, long id, const char* code) {
  snprintf(out, outSize, "{\"id\":%ld,\"ok\":false,\"error\":\"%s\"}", id, code);
}

}  // namespace

void SecureSession::Begin(const char* deviceId, const char* firmware, const PairingStore* store) {
  deviceId_ = deviceId;
  firmware_ = firmware;
  store_ = store;
}

void SecureSession::End() {
  if (open_) {
    mbedtls_gcm_free(&gcm_);
    open_ = false;
  }
  gdgcrypto::Wipe(clientNonce_, sizeof(clientNonce_));
  gdgcrypto::Wipe(readerNonce_, sizeof(readerNonce_));
  began_ = false;
  sendCounter_ = 0;
  lastReceiveCounter_ = 0;
}

bool SecureSession::BuildProof(const char* label, uint8_t out[gdgcrypto::kProofBytes]) const {
  char epochText[12];
  snprintf(epochText, sizeof(epochText), "%lu", static_cast<unsigned long>(store_->Epoch()));
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
  return gdgcrypto::Hmac(store_->Key(), parts, lengths, sizeof(lengths) / sizeof(lengths[0]), out);
}

SecureSession::AuthResult SecureSession::HandleAuth(const char* cmd, long id,
                                                    JsonDocument& request, char* out,
                                                    size_t outSize) {
  if (strcmp(cmd, "auth.begin") == 0) {
    if (store_ == nullptr || !store_->HasKey()) {
      WriteError(out, outSize, id, "not_paired");
      return AuthResult::Reply;
    }
    const char* nonce = request["nonce"] | "";
    size_t nonceLength = 0;
    if (!gdgcrypto::Base64UrlDecode(nonce, strlen(nonce), clientNonce_, sizeof(clientNonce_),
                                    nonceLength) ||
        nonceLength != sizeof(clientNonce_)) {
      began_ = false;
      WriteError(out, outSize, id, "bad_nonce");
      return AuthResult::Reply;
    }
    gdgcrypto::RandomBytes(readerNonce_, sizeof(readerNonce_));
    began_ = true;

    char readerNonce[gdgcrypto::Base64UrlLength(gdgcrypto::kNonceBytes) + 1];
    gdgcrypto::Base64UrlEncode(readerNonce_, sizeof(readerNonce_), readerNonce,
                               sizeof(readerNonce));
    JsonDocument reply;
    reply["id"] = id;
    reply["ok"] = true;
    JsonObject result = reply["result"].to<JsonObject>();
    result["deviceId"] = deviceId_;
    result["epoch"] = store_->Epoch();
    result["nonce"] = readerNonce;
    result["firmware"] = firmware_;
    serializeJson(reply, out, outSize);
    return AuthResult::Reply;
  }

  if (strcmp(cmd, "auth.finish") == 0) {
    if (!began_ || store_ == nullptr || !store_->HasKey()) {
      WriteError(out, outSize, id, "auth_out_of_order");
      return AuthResult::Failed;
    }
    // One proof per auth.begin, so a wrong one cannot be tried again.
    began_ = false;

    const char* proofText = request["proof"] | "";
    uint8_t proof[gdgcrypto::kProofBytes];
    size_t proofLength = 0;
    uint8_t expected[gdgcrypto::kProofBytes];
    if (!gdgcrypto::Base64UrlDecode(proofText, strlen(proofText), proof, sizeof(proof),
                                    proofLength) ||
        proofLength != sizeof(proof) || !BuildProof("client", expected) ||
        !gdgcrypto::ConstantTimeEqual(proof, expected, sizeof(proof))) {
      WriteError(out, outSize, id, "auth_failed");
      return AuthResult::Failed;
    }

    uint8_t readerProof[gdgcrypto::kProofBytes];
    uint8_t sessionKey[gdgcrypto::kKeyBytes];
    // A session already open on this link ends here: its place is taken.
    if (open_) mbedtls_gcm_free(&gcm_);
    mbedtls_gcm_init(&gcm_);
    open_ = BuildProof("reader", readerProof) && BuildProof("session", sessionKey) &&
            mbedtls_gcm_setkey(&gcm_, MBEDTLS_CIPHER_ID_AES, sessionKey, 256) == 0;
    gdgcrypto::Wipe(sessionKey, sizeof(sessionKey));
    if (!open_) {
      mbedtls_gcm_free(&gcm_);
      WriteError(out, outSize, id, "auth_failed");
      return AuthResult::Failed;
    }
    sendCounter_ = 0;
    lastReceiveCounter_ = 0;

    char readerProofText[gdgcrypto::Base64UrlLength(gdgcrypto::kProofBytes) + 1];
    gdgcrypto::Base64UrlEncode(readerProof, sizeof(readerProof), readerProofText,
                               sizeof(readerProofText));
    JsonDocument reply;
    reply["id"] = id;
    reply["ok"] = true;
    reply["result"]["proof"] = readerProofText;
    serializeJson(reply, out, outSize);
    return AuthResult::Opened;
  }

  return AuthResult::NotAuth;
}

bool SecureSession::Open(const char* line, size_t lineLength, char* plain, size_t plainSize,
                         size_t& plainLength) {
  if (!open_ || lineLength < 2 || line[0] != '#') return false;

  size_t frameLength = 0;
  if (!gdgcrypto::Base64UrlDecode(line + 1, lineLength - 1, frameBuffer, sizeof(frameBuffer),
                                  frameLength)) {
    return false;
  }
  uint64_t counter = 0;
  if (!gdgcrypto::Open(&gcm_, gdgcrypto::kToReader, frameBuffer, frameLength, counter,
                       reinterpret_cast<uint8_t*>(plain), plainSize, plainLength) ||
      counter <= lastReceiveCounter_) {
    return false;
  }
  lastReceiveCounter_ = counter;
  return true;
}

size_t SecureSession::Seal(const char* json, char* out, size_t outSize) {
  if (!open_ || json == nullptr || outSize < 3) return 0;
  const size_t length = strlen(json);
  if (length > GDG_PLAIN_BYTES) return 0;

  size_t frameLength = 0;
  sendCounter_ += 1;
  if (!gdgcrypto::Seal(&gcm_, gdgcrypto::kToHost, sendCounter_,
                       reinterpret_cast<const uint8_t*>(json), length, frameBuffer,
                       sizeof(frameBuffer), frameLength)) {
    return 0;
  }
  out[0] = '#';
  const size_t encoded =
      gdgcrypto::Base64UrlEncode(frameBuffer, frameLength, out + 1, outSize - 1);
  return encoded == 0 ? 0 : encoded + 1;
}
