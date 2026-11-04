#include "nfc_lane.h"

#include <SPI.h>

#include <cstring>

namespace {

constexpr uint8_t kFirstDataPage = 4;
constexpr uint8_t kCapabilityPage = 3;
constexpr uint8_t kNtagMagic = 0xE1;
constexpr uint8_t kNtagVersion = 0x10;
constexpr uint8_t kNdefMessageTlv = 0x03;
constexpr uint8_t kNdefTerminatorTlv = 0xFE;
constexpr size_t kNdefPrefixBytes = 16;
constexpr uint8_t kReadAttempts = 4;
constexpr uint16_t kReadRetryDelayMs = 30;

bool FindNdefMessageEnd(const uint8_t* buffer, size_t length, size_t& messageEnd,
                        String& errorCode) {
  size_t cursor = 0;
  while (cursor < length) {
    const uint8_t tlv = buffer[cursor++];
    if (tlv == 0x00) continue;
    if (tlv == kNdefTerminatorTlv) {
      errorCode = "ndef_record_missing";
      return false;
    }
    if (cursor >= length) {
      errorCode = "truncated_tlv";
      return false;
    }

    size_t tlvLength = buffer[cursor++];
    if (tlvLength == 0xFF) {
      if (cursor + 2 > length) {
        errorCode = "truncated_tlv";
        return false;
      }
      tlvLength = (static_cast<size_t>(buffer[cursor]) << 8) |
                  static_cast<size_t>(buffer[cursor + 1]);
      cursor += 2;
    }

    if (tlv == kNdefMessageTlv) {
      messageEnd = cursor + tlvLength;
      return true;
    }

    if (cursor + tlvLength > length) {
      errorCode = "truncated_tlv";
      return false;
    }
    cursor += tlvLength;
  }

  errorCode = "ndef_record_missing";
  return false;
}

bool IsTransientReadError(const String& errorCode) {
  return errorCode == "page_read_failed" || errorCode == "capability_read_failed";
}

}  // namespace

NfcLane::NfcLane() : nfc_(GDG_NFC_SPI_SS) {}

bool NfcLane::Begin() {
  ready_ = false;
  firmware_version_ = 0;

#if GDG_NFC_RESET >= 0
  pinMode(GDG_NFC_RESET, OUTPUT);
  digitalWrite(GDG_NFC_RESET, HIGH);
  delay(5);
  digitalWrite(GDG_NFC_RESET, LOW);
  delay(10);
  digitalWrite(GDG_NFC_RESET, HIGH);
  delay(100);
#endif

#if GDG_NFC_IRQ >= 0
  pinMode(GDG_NFC_IRQ, INPUT);
#endif

  uint32_t version = 0;
  for (uint8_t attempt = 0; attempt < 3 && version == 0; ++attempt) {
    if (!nfc_.begin()) {
      Serial.println("[nfc] PN532 SPI bus init failed");
      delay(100);
      continue;
    }
    version = nfc_.getFirmwareVersion();
    if (version == 0) {
      delay(150);
#if GDG_NFC_RESET >= 0
      digitalWrite(GDG_NFC_RESET, LOW);
      delay(10);
      digitalWrite(GDG_NFC_RESET, HIGH);
      delay(100);
#endif
    }
  }
  if (version == 0) {
    Serial.println("[nfc] PN532 SPI did not respond; check SCK/MISO/MOSI/SS, DIP switch, VCC/GND");
    return false;
  }
  nfc_.SAMConfig();
  nfc_.setPassiveActivationRetries(1);
  ready_ = true;
  firmware_version_ = version;
  Serial.print("[nfc] PN532 SPI firmware 0x");
  Serial.print(static_cast<unsigned long>(version), HEX);
  Serial.println(" ready");
  return true;
}

bool NfcLane::EnsureReady(String& errorCode) {
  if (ready_) return true;
  if (Begin()) return true;
  errorCode = "nfc_not_ready";
  return false;
}

bool NfcLane::SelectTag(String& errorCode) {
  if (!EnsureReady(errorCode)) return false;

  uint8_t uid[10] = {0};
  uint8_t uidLength = 0;
  if (!nfc_.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLength,
                                GDG_NFC_READ_TIMEOUT_MS)) {
    errorCode = "no_card";
    return false;
  }
  // NTAG21x uses a 7-byte UID. Anything else is intentionally refused rather
  // than guessed at (MIFARE Classic is not an NDEF member-card format here).
  if (uidLength != 7) {
    errorCode = "unsupported_tag";
    return false;
  }
  return true;
}

bool NfcLane::ReadCapability(String& errorCode) {
  uint8_t cc[4] = {0, 0, 0, 0};
  if (!nfc_.ntag2xx_ReadPage(kCapabilityPage, cc)) {
    errorCode = "capability_read_failed";
    return false;
  }
  if (cc[0] != kNtagMagic || cc[1] != kNtagVersion) {
    errorCode = "unsupported_tag";
    return false;
  }
  capacity_ = static_cast<uint16_t>(cc[2]) * 8;
  if (capacity_ < 32 || capacity_ > GDG_MAX_NDEF_BYTES) {
    errorCode = "tag_capacity_unexpected";
    return false;
  }
  return true;
}

bool NfcLane::ReadNtagBytes(uint8_t* buffer, size_t requested, size_t& read, String& errorCode) {
  read = 0;
  if (capacity_ == 0) {
    errorCode = "capacity_unknown";
    return false;
  }
  if (requested > capacity_) requested = capacity_;
  const size_t pages = (requested + 3) / 4;

  for (size_t page = 0; page < pages; ++page) {
    uint8_t pageData[4] = {0, 0, 0, 0};
    if (!nfc_.ntag2xx_ReadPage(static_cast<uint8_t>(kFirstDataPage + page), pageData)) {
      errorCode = "page_read_failed";
      return false;
    }
    for (size_t i = 0; i < 4 && read < requested; ++i) {
      buffer[read++] = pageData[i];
    }
  }
  return true;
}

bool NfcLane::ParseNdefUri(const uint8_t* buffer, size_t length, String& uri,
                           String& errorCode) {
  if (length < 4) {
    errorCode = "ndef_empty";
    return false;
  }

  size_t cursor = 0;
  bool found = false;
  size_t messageOffset = 0;
  size_t messageLength = 0;

  while (cursor + 2 <= length) {
    const uint8_t tlv = buffer[cursor++];
    if (tlv == 0x00) continue;
    if (tlv == kNdefTerminatorTlv) break;

    size_t tlvLength = buffer[cursor++];
    if (tlvLength == 0xFF) {
      if (cursor + 2 > length) {
        errorCode = "truncated_tlv";
        return false;
      }
      tlvLength = (static_cast<size_t>(buffer[cursor]) << 8) | buffer[cursor + 1];
      cursor += 2;
    }
    if (cursor + tlvLength > length) {
      errorCode = "truncated_tlv";
      return false;
    }
    if (tlv == kNdefMessageTlv) {
      messageOffset = cursor;
      messageLength = tlvLength;
      found = true;
      break;
    }
    cursor += tlvLength;
  }

  if (!found || messageLength < 5) {
    errorCode = "ndef_record_missing";
    return false;
  }

  const uint8_t* message = buffer + messageOffset;
  const uint8_t header = message[0];
  if ((header & 0x80) == 0) {
    errorCode = "ndef_not_first_record";
    return false;
  }

  size_t position = 1;
  const uint8_t typeLength = message[position++];
  size_t payloadLength = 0;
  if ((header & 0x10) != 0) {
    if (position >= messageLength) {
      errorCode = "truncated_record";
      return false;
    }
    payloadLength = message[position++];
  } else {
    if (position + 4 > messageLength) {
      errorCode = "truncated_record";
      return false;
    }
    payloadLength = (static_cast<size_t>(message[position]) << 24) |
                    (static_cast<size_t>(message[position + 1]) << 16) |
                    (static_cast<size_t>(message[position + 2]) << 8) |
                    static_cast<size_t>(message[position + 3]);
    position += 4;
  }

  if (position + typeLength > messageLength) {
    errorCode = "truncated_record";
    return false;
  }
  if (typeLength != 1 || message[position] != 'U') {
    errorCode = "not_uri_record";
    return false;
  }
  position += typeLength;

  if (payloadLength < 1 || position + payloadLength > messageLength) {
    errorCode = "truncated_payload";
    return false;
  }

  const uint8_t prefixCode = message[position];
  const uint8_t* text = message + position + 1;
  const size_t textLength = payloadLength - 1;

  String prefix;
  switch (prefixCode) {
    case 0x00:
      break;
    case 0x01:
      prefix = "http://www.";
      break;
    case 0x02:
      prefix = "https://www.";
      break;
    case 0x03:
      prefix = "http://";
      break;
    case 0x04:
      prefix = "https://";
      break;
    default:
      errorCode = "unsupported_uri_prefix";
      return false;
  }

  if (prefix.length() + textLength > 300) {
    errorCode = "uri_too_long";
    return false;
  }

  uri = prefix;
  for (size_t i = 0; i < textLength; ++i) {
    const uint8_t value = text[i];
    if (value < 0x21 || value > 0x7E) {
      errorCode = "uri_not_printable";
      return false;
    }
    uri += static_cast<char>(value);
  }
  return !uri.isEmpty();
}

bool NfcLane::ReadCardUri(String& uri, String& errorCode) {
  for (uint8_t attempt = 0; attempt < kReadAttempts; ++attempt) {
    uri = "";
    errorCode = "";
    if (ReadNdefUri(uri, errorCode)) return true;
    if (!IsTransientReadError(errorCode)) return false;

    if (attempt + 1 < kReadAttempts) {
      Serial.printf("[nfc] read retry %u/%u after %s\n", static_cast<unsigned>(attempt + 1),
                    static_cast<unsigned>(kReadAttempts), errorCode.c_str());
      delay(kReadRetryDelayMs);
    }
  }
  return false;
}

bool NfcLane::ReadNdefUri(String& uri, String& errorCode) {
  if (!SelectTag(errorCode)) return false;
  if (!ReadCapability(errorCode)) return false;

  // Read only enough of the TLV header to learn the NDEF message length. The
  // old path read the entire user-memory capacity, which is about 126 page
  // transactions on an NTAG215 even for a short card URL.
  size_t prefixRead = 0;
  if (!ReadNtagBytes(buffer_, kNdefPrefixBytes, prefixRead, errorCode)) return false;

  size_t messageEnd = 0;
  if (!FindNdefMessageEnd(buffer_, prefixRead, messageEnd, errorCode)) return false;
  if (messageEnd == 0 || messageEnd > capacity_) {
    errorCode = "truncated_tlv";
    return false;
  }

  size_t read = 0;
  if (!ReadNtagBytes(buffer_, messageEnd, read, errorCode)) return false;
  return ParseNdefUri(buffer_, read, uri, errorCode);
}

bool NfcLane::WriteNtagPayload(const uint8_t* data, size_t length, String& errorCode) {
  const size_t pages = (length + 3) / 4;
  for (size_t page = 0; page < pages; ++page) {
    uint8_t pageData[4] = {0, 0, 0, 0};
    for (size_t i = 0; i < 4; ++i) {
      const size_t index = page * 4 + i;
      if (index < length) pageData[i] = data[index];
    }
    if (!nfc_.ntag2xx_WritePage(static_cast<uint8_t>(kFirstDataPage + page), pageData)) {
      errorCode = "page_write_failed";
      return false;
    }
  }
  return true;
}

bool NfcLane::WriteCardUri(const String& uri, String& errorCode) {
  errorCode = "";
  if (!SelectTag(errorCode)) return false;
  if (!ReadCapability(errorCode)) return false;

  if (uri.length() > 250) {
    errorCode = "uri_too_long";
    return false;
  }

  uint8_t payload[GDG_MAX_NDEF_BYTES];
  size_t payloadLength = 0;
  payload[payloadLength++] = 0x00;  // no URI prefix abbreviation
  for (size_t i = 0; i < uri.length(); ++i) {
    payload[payloadLength++] = static_cast<uint8_t>(uri[i]);
  }
  if (payloadLength > 255) {
    errorCode = "uri_too_long";
    return false;
  }

  uint8_t message[GDG_MAX_NDEF_BYTES];
  size_t messageLength = 0;
  message[messageLength++] = 0xD1;  // MB + ME + SR + TNF well-known
  message[messageLength++] = 0x01;  // type length
  message[messageLength++] = static_cast<uint8_t>(payloadLength);
  message[messageLength++] = 'U';
  memcpy(message + messageLength, payload, payloadLength);
  messageLength += payloadLength;

  uint8_t tlv[GDG_MAX_NDEF_BYTES];
  size_t tlvLength = 0;
  tlv[tlvLength++] = kNdefMessageTlv;
  if (messageLength < 255) {
    tlv[tlvLength++] = static_cast<uint8_t>(messageLength);
  } else {
    tlv[tlvLength++] = 0xFF;
    tlv[tlvLength++] = static_cast<uint8_t>((messageLength >> 8) & 0xFF);
    tlv[tlvLength++] = static_cast<uint8_t>(messageLength & 0xFF);
  }
  memcpy(tlv + tlvLength, message, messageLength);
  tlvLength += messageLength;
  tlv[tlvLength++] = kNdefTerminatorTlv;

  if (tlvLength > capacity_) {
    errorCode = "tag_too_small";
    return false;
  }

  if (!WriteNtagPayload(tlv, tlvLength, errorCode)) return false;

  size_t verified = 0;
  if (!ReadNtagBytes(buffer_, tlvLength, verified, errorCode)) return false;
  if (verified != tlvLength || memcmp(buffer_, tlv, tlvLength) != 0) {
    errorCode = "read_back_mismatch";
    return false;
  }
  return true;
}
