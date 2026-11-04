#pragma once

// ---------------------------------------------------------------------------
// USB-only build configuration. There are no WiFi, server, device-secret, or
// registration settings. Device identity is derived from the ESP32 chip.
// ---------------------------------------------------------------------------

// PN532 interface: SPI. The I2C transport is intentionally not built.
#define GDG_NFC_INTERFACE_SPI 2

#ifndef GDG_NFC_INTERFACE
#define GDG_NFC_INTERFACE GDG_NFC_INTERFACE_SPI
#endif

#if GDG_NFC_INTERFACE != GDG_NFC_INTERFACE_SPI
#error "Only the SPI PN532 transport is implemented; do not flash with a different interface."
#endif

// Hardware SPI (ESP32 VSPI). The Adafruit hardware-SPI constructor uses the
// default SPI bus; these are the ESP32 VSPI defaults.
#define GDG_NFC_SPI_SCK 18
#define GDG_NFC_SPI_MISO 19
#define GDG_NFC_SPI_MOSI 23
#define GDG_NFC_SPI_SS 5

// PN532 control pins. IRQ is optional and not used by the polling driver.
// RSTC/RSTPD_N is driven low then high at startup to recover a wedged module.
#define GDG_NFC_IRQ 4
#define GDG_NFC_RESET 15

// Status LED. Set to -1 when the board has no usable LED.
#define GDG_STATUS_LED 2

// NFC timing and bounded-operation limits.
#define GDG_NFC_READ_TIMEOUT_MS 300
#define GDG_MAX_NDEF_BYTES 512
