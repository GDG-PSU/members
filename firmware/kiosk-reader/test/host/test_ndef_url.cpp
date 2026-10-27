// Host-side unit test for the pure C++ NDEF card-URL parser.
//
/* Build & run from the repository root (no hardware, no PlatformIO):
 *
 *   g++ -std=c++17 -Wall -Wextra -Werror \
 *     -I firmware/kiosk-reader/lib/ndef_url \
 *     firmware/kiosk-reader/test/host/test_ndef_url.cpp \
 *     firmware/kiosk-reader/lib/ndef_url/ndef_url.cpp \
 *     -o /tmp/ndef_test && /tmp/ndef_test
 */
//
// The same file is also runnable through PlatformIO's native test runner if
// one is configured; it deliberately uses no test framework.

#include <cassert>
#include <cstdio>
#include <string>

#include "ndef_url.h"

namespace {

using gdg::BuildCardUrl;
using gdg::IsCardToken;
using gdg::kCardTokenLength;
using gdg::MaskCardUrl;
using gdg::NdefUrlError;
using gdg::NdefUrlErrorName;
using gdg::ParseCardUrl;

const char* kHost = "member.gdgpsu.dev";
const char* kToken = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde";  // 43 chars

void ExpectToken(const std::string& url, gdg::NdefUrlError expected) {
  const auto result = ParseCardUrl(url, kHost);
  if (result.error != expected) {
    std::printf("unexpected error for %s: got %s, want %s\n", url.c_str(),
                NdefUrlErrorName(result.error), NdefUrlErrorName(expected));
    assert(false);
  }
}

}  // namespace

int main() {
  static_assert(kCardTokenLength == 43, "card token length contract changed");
  assert(std::string(kToken).size() == 43);

  // Token format
  assert(IsCardToken(kToken));
  assert(!IsCardToken("short"));
  assert(IsCardToken(std::string(43, 'a')));
  assert(!IsCardToken("AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abc!"));
  assert(!IsCardToken("AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abc="));

  // Valid URL and exact token extraction
  const std::string valid = BuildCardUrl(kHost, kToken);
  assert(valid == std::string("https://member.gdgpsu.dev/c/") + kToken);
  const auto parsed = ParseCardUrl(valid, kHost);
  assert(parsed.error == NdefUrlError::kOk);
  assert(parsed.token == kToken);
  assert(ParseCardUrl(valid, "MEMBER.GDGPSU.DEV").error == NdefUrlError::kOk);

  // Rejections
  ExpectToken("", NdefUrlError::kEmpty);
  ExpectToken(std::string("http://member.gdgpsu.dev/c/") + kToken, NdefUrlError::kNotHttps);
  ExpectToken(std::string("HTTPS://member.gdgpsu.dev/c/") + kToken, NdefUrlError::kNotHttps);
  ExpectToken(std::string("https://evil.example/c/") + kToken, NdefUrlError::kWrongHost);
  ExpectToken(std::string("https://member.gdgpsu.dev.evil.example/c/") + kToken,
              NdefUrlError::kWrongHost);
  ExpectToken(std::string("https://member.gdgpsu.dev:443/c/") + kToken, NdefUrlError::kWrongHost);
  ExpectToken(std::string("https://user@member.gdgpsu.dev/c/") + kToken, NdefUrlError::kUserInfo);
  ExpectToken(std::string("https://member.gdgpsu.dev/c/") + kToken + "?x=1",
              NdefUrlError::kQueryOrFragment);
  ExpectToken(std::string("https://member.gdgpsu.dev/c/") + kToken + "#frag",
              NdefUrlError::kQueryOrFragment);
  ExpectToken(std::string("https://member.gdgpsu.dev/c/") + kToken + "/extra",
              NdefUrlError::kWrongPath);
  ExpectToken(std::string("https://member.gdgpsu.dev/m/") + kToken, NdefUrlError::kWrongPath);
  ExpectToken(std::string("https://member.gdgpsu.dev/c/") + std::string(kToken).substr(0, 42),
              NdefUrlError::kBadToken);
  ExpectToken(std::string("https://member.gdgpsu.dev/c/") + kToken + "a",
              NdefUrlError::kBadToken);
  ExpectToken("https://member.gdgpsu.dev/c/", NdefUrlError::kBadToken);
  ExpectToken(std::string("https://member.gdgpsu.dev/c/") + std::string(43, '='),
              NdefUrlError::kBadToken);
  ExpectToken(std::string("https://member.gdgpsu.dev/\n/c/") + kToken,
              NdefUrlError::kInvalidCharacters);
  ExpectToken("https://member.gdgpsu.dev/c/" + std::string(200, 'a'), NdefUrlError::kBadToken);
  ExpectToken("https://member.gdgpsu.dev/c/" + std::string(400, 'a'), NdefUrlError::kTooLong);

  // Builder rejects malformed host/token
  assert(BuildCardUrl("", kToken).empty());
  assert(BuildCardUrl("member.gdgpsu.dev/c", kToken).empty());
  assert(BuildCardUrl("member.gdgpsu.dev", "short").empty());
  assert(BuildCardUrl("localhost", kToken).empty());

  // Display masking never includes the token
  const std::string masked = MaskCardUrl(valid);
  assert(masked == "https://member.gdgpsu.dev/c/...");
  assert(masked.find(kToken) == std::string::npos);
  assert(MaskCardUrl("nonsense") == "[invalid-url]");

  // Long-form URLs are rejected before parsing
  assert(ParseCardUrl(std::string(400, 'h'), kHost).error == NdefUrlError::kTooLong);

  std::printf("ndef_url: all checks passed (%s)\n", NdefUrlErrorName(NdefUrlError::kOk));
  return 0;
}
