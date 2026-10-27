#pragma once

// ---------------------------------------------------------------------------
// Copy this file to include/secrets.h and fill in real values there.
// include/secrets.h is ignored by Git and must never be committed or shared.
//
// - GDG_WIFI_* is for an approved network only. Do not hard-code a student's
//   Penn State credentials. See docs/psu-network-validation.md.
// - GDG_DEVICE_SECRET is unique per physical unit and is created once by an
//   admin (Admin -> Devices). It is not a Supabase key and grants only
//   device-scoped endpoints.
// - GDG_ROOT_CA_PEM must be the PEM root CA that signs the deployed HTTPS
//   certificate. Certificate validation is never disabled in firmware.
// ---------------------------------------------------------------------------

#define GDG_WIFI_SSID "REPLACE_WITH_APPROVED_SSID"
#define GDG_WIFI_PASSWORD "REPLACE_WITH_APPROVED_NETWORK_PASSWORD"

// Web origin, without scheme or trailing slash (for example member.gdgpsu.dev).
#define GDG_API_HOST "member.gdgpsu.dev"
#define GDG_API_PORT 443

// One identity per physical unit; create/rotate in the admin portal.
#define GDG_DEVICE_ID "lane-a"
#define GDG_DEVICE_SECRET "REPLACE_WITH_64_CHAR_DEVICE_SECRET_FROM_ADMIN"

// PEM root CA (ISRG Root X1 / the CA actually used by the deployment).
// Keep the full BEGIN/END CERTIFICATE block including newlines.
#define GDG_ROOT_CA_PEM \
  "-----BEGIN CERTIFICATE-----\n" \
  "REPLACE_WITH_ROOT_CA\n" \
  "-----END CERTIFICATE-----\n"
