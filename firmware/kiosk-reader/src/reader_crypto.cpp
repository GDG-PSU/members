#include "reader_crypto.h"

#include <esp_system.h>
#include <mbedtls/md.h>

#include <cstring>

namespace gdgcrypto {

namespace {

const char kAlphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

int DecodeChar(char ch) {
  if (ch >= 'A' && ch <= 'Z') return ch - 'A';
  if (ch >= 'a' && ch <= 'z') return ch - 'a' + 26;
  if (ch >= '0' && ch <= '9') return ch - '0' + 52;
  if (ch == '-') return 62;
  if (ch == '_') return 63;
  return -1;
}

void BuildNonce(uint8_t direction, uint64_t counter, uint8_t nonce[12]) {
  nonce[0] = direction;
  nonce[1] = 0;
  nonce[2] = 0;
  nonce[3] = 0;
  for (int index = 0; index < 8; index += 1) {
    nonce[4 + index] = static_cast<uint8_t>(counter >> (56 - 8 * index));
  }
}

}  // namespace

size_t Base64UrlEncode(const uint8_t* data, size_t length, char* out, size_t outSize) {
  const size_t needed = Base64UrlLength(length);
  if (out == nullptr || outSize < needed + 1) return 0;

  size_t written = 0;
  size_t index = 0;
  while (index + 3 <= length) {
    const uint32_t group = (static_cast<uint32_t>(data[index]) << 16) |
                           (static_cast<uint32_t>(data[index + 1]) << 8) | data[index + 2];
    out[written++] = kAlphabet[(group >> 18) & 0x3F];
    out[written++] = kAlphabet[(group >> 12) & 0x3F];
    out[written++] = kAlphabet[(group >> 6) & 0x3F];
    out[written++] = kAlphabet[group & 0x3F];
    index += 3;
  }
  const size_t rest = length - index;
  if (rest == 1) {
    const uint32_t group = static_cast<uint32_t>(data[index]) << 16;
    out[written++] = kAlphabet[(group >> 18) & 0x3F];
    out[written++] = kAlphabet[(group >> 12) & 0x3F];
  } else if (rest == 2) {
    const uint32_t group =
        (static_cast<uint32_t>(data[index]) << 16) | (static_cast<uint32_t>(data[index + 1]) << 8);
    out[written++] = kAlphabet[(group >> 18) & 0x3F];
    out[written++] = kAlphabet[(group >> 12) & 0x3F];
    out[written++] = kAlphabet[(group >> 6) & 0x3F];
  }
  out[written] = '\0';
  return written;
}

bool Base64UrlDecode(const char* text, size_t textLength, uint8_t* out, size_t outSize,
                     size_t& outLength) {
  outLength = 0;
  if (text == nullptr || out == nullptr) return false;
  // A single leftover character cannot hold a whole byte.
  if (textLength % 4 == 1) return false;

  uint32_t group = 0;
  int bits = 0;
  for (size_t index = 0; index < textLength; index += 1) {
    const int value = DecodeChar(text[index]);
    if (value < 0) return false;
    group = (group << 6) | static_cast<uint32_t>(value);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (outLength >= outSize) return false;
      out[outLength++] = static_cast<uint8_t>((group >> bits) & 0xFF);
    }
  }
  return true;
}

bool Hmac(const uint8_t key[kKeyBytes], const uint8_t* const parts[], const size_t lengths[],
          size_t count, uint8_t out[kProofBytes]) {
  const mbedtls_md_info_t* info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  if (info == nullptr) return false;

  mbedtls_md_context_t context;
  mbedtls_md_init(&context);
  bool ok = mbedtls_md_setup(&context, info, 1) == 0 &&
            mbedtls_md_hmac_starts(&context, key, kKeyBytes) == 0;
  for (size_t index = 0; ok && index < count; index += 1) {
    ok = mbedtls_md_hmac_update(&context, parts[index], lengths[index]) == 0;
  }
  ok = ok && mbedtls_md_hmac_finish(&context, out) == 0;
  mbedtls_md_free(&context);
  return ok;
}

bool ConstantTimeEqual(const uint8_t* left, const uint8_t* right, size_t length) {
  volatile uint8_t difference = 0;
  for (size_t index = 0; index < length; index += 1) {
    difference = difference | (left[index] ^ right[index]);
  }
  return difference == 0;
}

void RandomBytes(uint8_t* out, size_t length) { esp_fill_random(out, length); }

void Wipe(void* data, size_t length) {
  volatile uint8_t* bytes = static_cast<volatile uint8_t*>(data);
  for (size_t index = 0; index < length; index += 1) bytes[index] = 0;
}

bool Seal(mbedtls_gcm_context* gcm, uint8_t direction, uint64_t counter, const uint8_t* plain,
          size_t plainLength, uint8_t* out, size_t outSize, size_t& outLength) {
  outLength = 0;
  if (outSize < plainLength + kSealOverhead) return false;

  uint8_t nonce[12];
  BuildNonce(direction, counter, nonce);
  memcpy(out, nonce + 4, kCounterBytes);
  const int result = mbedtls_gcm_crypt_and_tag(gcm, MBEDTLS_GCM_ENCRYPT, plainLength, nonce,
                                               sizeof(nonce), nullptr, 0, plain,
                                               out + kCounterBytes, kTagBytes,
                                               out + kCounterBytes + plainLength);
  if (result != 0) return false;
  outLength = plainLength + kSealOverhead;
  return true;
}

bool Open(mbedtls_gcm_context* gcm, uint8_t direction, const uint8_t* frame, size_t frameLength,
          uint64_t& counter, uint8_t* plain, size_t plainSize, size_t& plainLength) {
  plainLength = 0;
  if (frameLength < kSealOverhead) return false;
  const size_t length = frameLength - kSealOverhead;
  if (plainSize < length) return false;

  counter = 0;
  for (size_t index = 0; index < kCounterBytes; index += 1) {
    counter = (counter << 8) | frame[index];
  }
  uint8_t nonce[12];
  BuildNonce(direction, counter, nonce);
  const int result =
      mbedtls_gcm_auth_decrypt(gcm, length, nonce, sizeof(nonce), nullptr, 0,
                               frame + kCounterBytes + length, kTagBytes, frame + kCounterBytes,
                               plain);
  if (result != 0) return false;
  plainLength = length;
  return true;
}

}  // namespace gdgcrypto
