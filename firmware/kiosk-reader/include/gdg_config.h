#pragma once

// ---------------------------------------------------------------------------
// Build-time defaults. Pin/interface values may be overridden per board.
// These macros are safe to commit; credentials live in include/secrets.h.
// ---------------------------------------------------------------------------

// PN532 interface: I2C by default. For SPI/UART boards, change GDG_NFC_INTERFACE
// and the pin map, and verify the wiring against the vendor's documentation.
#define GDG_NFC_INTERFACE_I2C 1
#define GDG_NFC_INTERFACE_SPI 2
#define GDG_NFC_INTERFACE_UART 3

#ifndef GDG_NFC_INTERFACE
#define GDG_NFC_INTERFACE GDG_NFC_INTERFACE_I2C
#endif

#if GDG_NFC_INTERFACE != GDG_NFC_INTERFACE_I2C
#error "Only the I2C PN532 adapter is implemented; do not flash with a different interface."
#endif

// I2C wiring (ESP32 default bus). PN532 breakout DIP switches must be set for I2C.
#define GDG_NFC_I2C_SDA 21
#define GDG_NFC_I2C_SCL 22
#define GDG_NFC_I2C_ADDRESS 0x24

// Shared PN532 control pins.
#define GDG_NFC_IRQ 4
#define GDG_NFC_RESET 5

// SPI wiring (only used when GDG_NFC_INTERFACE == GDG_NFC_INTERFACE_SPI).
#define GDG_NFC_SPI_SCK 18
#define GDG_NFC_SPI_MISO 19
#define GDG_NFC_SPI_MOSI 23
#define GDG_NFC_SPI_SS 5

// Status LED. Set to -1 when the board has no usable LED.
#define GDG_STATUS_LED 2

// Timing and bounded-operation limits.
// Use an approved time source. Signed requests fail closed until time is synchronized.
#ifndef GDG_NTP_SERVER
#define GDG_NTP_SERVER "pool.ntp.org"
#endif
#define GDG_HTTP_TIMEOUT_MS 8000
#define GDG_HTTP_CONNECT_TIMEOUT_MS 5000
#define GDG_WIFI_CONNECT_TIMEOUT_MS 15000
#define GDG_SCAN_COOLDOWN_MS 4000
#define GDG_HEARTBEAT_INTERVAL_MS 30000
#define GDG_JOB_POLL_INTERVAL_MS 3000
#define GDG_BACKOFF_BASE_MS 1000
#define GDG_BACKOFF_MAX_MS 60000
#define GDG_WRITE_JOB_SAFETY_MARGIN_MS 5000
#define GDG_NFC_READ_TIMEOUT_MS 300
#define GDG_MAX_NDEF_BYTES 512

#if GDG_NFC_INTERFACE == GDG_NFC_INTERFACE_I2C
// Adafruit_PN532(IRQ, RESET) selects the I2C transport.
#define GDG_PN532_IRQ GDG_NFC_IRQ
#define GDG_PN532_RESET GDG_NFC_RESET
#else
#define GDG_PN532_IRQ GDG_NFC_IRQ
#define GDG_PN532_RESET GDG_NFC_RESET
#endif
