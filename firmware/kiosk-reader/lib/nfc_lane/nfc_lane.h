#pragma once

#include <Adafruit_PN532.h>
#include <Arduino.h>

#include "gdg_config.h"

/**
 * PN532/NTAG lane.
 *
 * Read: selects a passive ISO14443A tag, reads the Type 2 capability container,
 * parses the NDEF TLV and returns the URI text. The chip UID is never used as a
 * credential.
 *
 * Write: writes exactly one NDEF URI record as an NTAG TLV, reads the pages back
 * and compares them byte-for-byte. A write is only "written" when that check
 * passes.
 */
class NfcLane {
 public:
  NfcLane();

  bool Begin();
  bool IsReady() const { return ready_; }

  /**
   * Reads a URI from the tag. Returns false with a stable error code when no
   * tag is present or the tag is not a compatible NDEF URI tag.
   */
  bool ReadCardUri(String& uri, String& errorCode);

  /**
   * Writes one URI. Returns false with a stable error code on capacity,
   * locking, write or read-back failure.
   */
  bool WriteCardUri(const String& uri, String& errorCode);

 private:
  bool SelectTag(String& errorCode);
  bool ReadCapability(String& errorCode);
  bool ReadNtagBytes(uint8_t* buffer, size_t requested, size_t& read, String& errorCode);
  bool ParseNdefUri(const uint8_t* buffer, size_t length, String& uri, String& errorCode);
  bool WriteNtagPayload(const uint8_t* data, size_t length, String& errorCode);
  bool EnsureReady(String& errorCode);

  Adafruit_PN532 nfc_;
  bool ready_ = false;
  uint16_t capacity_ = 0;
  uint8_t buffer_[GDG_MAX_NDEF_BYTES];
};
