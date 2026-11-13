#pragma once

#include <Arduino.h>
#include <mbedtls/gcm.h>

/**
 * The few primitives a session needs: HMAC-SHA-256 to prove both ends hold the
 * reader's key, AES-256-GCM to seal every line after that, and unpadded
 * base64url to carry bytes inside newline-delimited text.
 *
 * The matching browser code is apps/web/src/lib/reader/secure-channel.ts and the
 * server's is apps/web/src/lib/reader/keys.ts; docs/usb-api.md states the format.
 */
namespace gdgcrypto {

constexpr size_t kKeyBytes = 32;
constexpr size_t kNonceBytes = 16;
constexpr size_t kProofBytes = 32;
constexpr size_t kTagBytes = 16;
constexpr size_t kCounterBytes = 8;
/** Counter and tag: what sealing adds to a frame. */
constexpr size_t kSealOverhead = kCounterBytes + kTagBytes;

constexpr uint8_t kToReader = 1;
constexpr uint8_t kToHost = 2;

/** Characters needed to encode `length` bytes, without the terminator. */
constexpr size_t Base64UrlLength(size_t length) { return (length * 4 + 2) / 3; }

/** Writes a terminated string. Returns its length, or 0 when it does not fit. */
size_t Base64UrlEncode(const uint8_t* data, size_t length, char* out, size_t outSize);
bool Base64UrlDecode(const char* text, size_t textLength, uint8_t* out, size_t outSize,
                     size_t& outLength);

/** HMAC-SHA-256 over the parts in order. */
bool Hmac(const uint8_t key[kKeyBytes], const uint8_t* const parts[], const size_t lengths[],
          size_t count, uint8_t out[kProofBytes]);
bool ConstantTimeEqual(const uint8_t* left, const uint8_t* right, size_t length);
void RandomBytes(uint8_t* out, size_t length);
void Wipe(void* data, size_t length);

/**
 * out = counter (8 bytes, big-endian) || ciphertext || tag (16 bytes).
 * The nonce is the direction byte, three zero bytes, then the counter, so the
 * two directions never share a nonce under the one session key.
 */
bool Seal(mbedtls_gcm_context* gcm, uint8_t direction, uint64_t counter, const uint8_t* plain,
          size_t plainLength, uint8_t* out, size_t outSize, size_t& outLength);
bool Open(mbedtls_gcm_context* gcm, uint8_t direction, const uint8_t* frame, size_t frameLength,
          uint64_t& counter, uint8_t* plain, size_t plainSize, size_t& plainLength);

}  // namespace gdgcrypto
