#pragma once

// ---------------------------------------------------------------------------
// Build configuration. There are no WiFi, server, or registration settings, and
// no secret is compiled in: the Bluetooth pairing key arrives over the cable and
// lives in the reader's own storage. Device identity is derived from the chip.
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

// Transport. A computer counts as "on the cable" while it has sent a command
// within this long; the browser sends one every two seconds when idle.
#define GDG_USB_SESSION_TIMEOUT_MS 6000
// After power-on the reader gives a computer this long to speak over the cable
// before it offers Bluetooth. Opening the serial port resets the board, so this
// must outlast the browser's first command after that reset.
#define GDG_USB_BOOT_GRACE_MS 3000

// Bluetooth. Shown in the browser's chooser, followed by four characters of the
// device ID.
#define GDG_BLE_NAME_PREFIX "GDG Reader "
// How long a new Bluetooth connection has to prove it holds the pairing key,
// and how long the reader stays off the air after one that failed to.
#define GDG_BLE_AUTH_DEADLINE_MS 8000
#define GDG_BLE_FAILED_PROOF_PAUSE_MS 1000
// Largest JSON line carried over Bluetooth, and the sealed, base64url line it
// becomes: 1 + ceil((GDG_BLE_PLAIN_BYTES + 24) * 4 / 3), with room to spare.
#define GDG_BLE_PLAIN_BYTES 760
#define GDG_BLE_LINE_BYTES 1100
