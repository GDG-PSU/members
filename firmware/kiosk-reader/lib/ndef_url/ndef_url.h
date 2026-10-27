#pragma once

#include <stddef.h>

#include <string>

/**
 * Pure C++ card-URL parsing and building.
 *
 * This module intentionally has no Arduino/ESP-IDF dependencies so it can be
 * unit-tested on a development host. The card URL contract is:
 *
 *   https://<configured-host>/c/<43 base64url characters>
 *
 * No query string, fragment, userinfo or port is accepted. The chip UID is
 * never used as a credential.
 */
namespace gdg {

constexpr size_t kCardTokenLength = 43;
constexpr size_t kMaxUrlLength = 320;

enum class NdefUrlError {
  kOk = 0,
  kEmpty,
  kTooLong,
  kInvalidCharacters,
  kNotHttps,
  kQueryOrFragment,
  kUserInfo,
  kWrongHost,
  kWrongPath,
  kBadToken,
};

struct NdefUrlResult {
  NdefUrlError error;
  std::string token;
  bool ok() const { return error == NdefUrlError::kOk; }
};

/** True when `token` is exactly 43 base64url characters. */
bool IsCardToken(const std::string& token);

/**
 * Parses a card URL and returns the opaque token when (and only when) the
 * scheme, host and path match the contract exactly.
 */
NdefUrlResult ParseCardUrl(const std::string& url, const std::string& expectedHost);

/** Builds the canonical card URL. Returns an empty string on invalid input. */
std::string BuildCardUrl(const std::string& host, const std::string& token);

/** Returns a display/log-safe form with the token removed. */
std::string MaskCardUrl(const std::string& url);

const char* NdefUrlErrorName(NdefUrlError error);

}  // namespace gdg
