#include "ndef_url.h"

#include <cctype>

namespace gdg {
namespace {

bool IsBase64UrlChar(char c) {
  const unsigned char value = static_cast<unsigned char>(c);
  return (value >= 'A' && value <= 'Z') || (value >= 'a' && value <= 'z') ||
         (value >= '0' && value <= '9') || value == '-' || value == '_';
}

bool IsHostChar(char c) {
  const unsigned char value = static_cast<unsigned char>(c);
  return (value >= 'A' && value <= 'Z') || (value >= 'a' && value <= 'z') ||
         (value >= '0' && value <= '9') || value == '.' || value == '-';
}

std::string LowerAscii(const std::string& input) {
  std::string output;
  output.reserve(input.size());
  for (char c : input) {
    output.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
  }
  return output;
}

bool StartsWith(const std::string& value, const std::string& prefix) {
  return value.size() >= prefix.size() && value.compare(0, prefix.size(), prefix) == 0;
}

bool IsValidHost(const std::string& host) {
  if (host.empty() || host.size() > 253) return false;
  if (host.front() == '.' || host.back() == '.') return false;
  for (char c : host) {
    if (!IsHostChar(c)) return false;
  }
  return host.find('.') != std::string::npos;
}

NdefUrlResult Fail(NdefUrlError error) {
  NdefUrlResult result;
  result.error = error;
  return result;
}

}  // namespace

bool IsCardToken(const std::string& token) {
  if (token.size() != kCardTokenLength) return false;
  for (char c : token) {
    if (!IsBase64UrlChar(c)) return false;
  }
  return true;
}

NdefUrlResult ParseCardUrl(const std::string& url, const std::string& expectedHost) {
  if (url.empty()) return Fail(NdefUrlError::kEmpty);
  if (url.size() > kMaxUrlLength) return Fail(NdefUrlError::kTooLong);
  if (!IsValidHost(expectedHost)) return Fail(NdefUrlError::kWrongHost);
  if (url.find('?') != std::string::npos || url.find('#') != std::string::npos) {
    return Fail(NdefUrlError::kQueryOrFragment);
  }
  for (char c : url) {
    const unsigned char value = static_cast<unsigned char>(c);
    if (value < 0x21 || value > 0x7e) return Fail(NdefUrlError::kInvalidCharacters);
  }
  if (!StartsWith(url, "https://")) return Fail(NdefUrlError::kNotHttps);

  const size_t authorityStart = 8;
  const size_t pathStart = url.find('/', authorityStart);
  if (pathStart == std::string::npos) return Fail(NdefUrlError::kWrongPath);

  const std::string authority = url.substr(authorityStart, pathStart - authorityStart);
  if (authority.find('@') != std::string::npos) return Fail(NdefUrlError::kUserInfo);
  if (LowerAscii(authority) != LowerAscii(expectedHost)) return Fail(NdefUrlError::kWrongHost);

  const std::string path = url.substr(pathStart);
  if (path.size() < 3 || path.compare(0, 3, "/c/") != 0) return Fail(NdefUrlError::kWrongPath);

  const std::string token = path.substr(3);
  if (token.find('/') != std::string::npos) return Fail(NdefUrlError::kWrongPath);
  if (!IsCardToken(token)) return Fail(NdefUrlError::kBadToken);

  NdefUrlResult result;
  result.error = NdefUrlError::kOk;
  result.token = token;
  return result;
}

std::string BuildCardUrl(const std::string& host, const std::string& token) {
  if (!IsValidHost(host) || !IsCardToken(token)) return std::string();
  return "https://" + host + "/c/" + token;
}

std::string MaskCardUrl(const std::string& url) {
  const size_t scheme = url.find("://");
  if (scheme == std::string::npos) return "[invalid-url]";
  const size_t path = url.find("/c/", scheme + 3);
  if (path == std::string::npos) {
    return url.substr(0, scheme + 3) + "[...]";
  }
  return url.substr(0, path + 3) + "...";
}

const char* NdefUrlErrorName(NdefUrlError error) {
  switch (error) {
    case NdefUrlError::kOk:
      return "ok";
    case NdefUrlError::kEmpty:
      return "empty";
    case NdefUrlError::kTooLong:
      return "too_long";
    case NdefUrlError::kInvalidCharacters:
      return "invalid_characters";
    case NdefUrlError::kNotHttps:
      return "not_https";
    case NdefUrlError::kQueryOrFragment:
      return "query_or_fragment";
    case NdefUrlError::kUserInfo:
      return "userinfo";
    case NdefUrlError::kWrongHost:
      return "wrong_host";
    case NdefUrlError::kWrongPath:
      return "wrong_path";
    case NdefUrlError::kBadToken:
      return "bad_token";
  }
  return "unknown";
}

}  // namespace gdg
