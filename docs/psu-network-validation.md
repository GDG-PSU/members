# Penn State network validation — ESP32 lanes

> **Status: BLOCKED.** No Penn State network policy, device registration or
> approval was available to this implementation. Nothing was bypassed, guessed or
> worked around. The firmware defaults to a standard WPA2-PSK station connection
> to an **approved** SSID; do not interpret that as PSU authorization for eduroam
> or any enterprise network.

The Seneca tutorial referenced in `PLAN.md` is a general ESP32/eduroam example, not
Penn State policy. Penn State's wireless requirements, EAP methods, device
registration and allowed device classes can change; only PSU IT can confirm them.

## Why this matters

ESP32 + PN532 kiosks need a reliable HTTPS path from the event venue. Common
campus networks use WPA2/WPA3-Enterprise (802.1X), captive portals, device
certificates or per-device registration. Firmware cannot "just connect" to
eduroam without an approved identity and EAP method, and it must never embed a
student's personal credentials or reuse a member password.

## Exact questions/actions for PSU IT

Send these to the appropriate PSU IT contact (wireless/network onboarding) before
purchasing or configuring the event hardware:

1. **Allowed device class:** Are ESP32-based, headless IoT devices permitted on
   the campus wireless network for a registered student organization event? If
   yes, on which SSID/VLAN?
2. **Authentication method:** Which 802.1X EAP method must the device use (for
   example EAP-TLS, PEAP-MSCHAPv2, EAP-TTLS), and is a device certificate
   required? Arduino-ESP32 core 2.x/3.x support for enterprise modes differs; we
   need the exact supported method for the pinned core.
3. **Identity and onboarding:** What sanctioned device/service identity should
   the kiosks use? Is there a device registration portal, MAC allowlist, sponsor
   approval or IT-provisioned credential? We will not use a student's NetID
   password.
4. **Dedicated network:** Is there a dedicated IoT/event SSID, guest network with
   client isolation disabled, or a temporary event network we should request? If
   client isolation is enabled, can the kiosks still reach the public HTTPS API?
5. **Egress and TLS inspection:** Is outbound HTTPS/443 to our Vercel origin
   allowed? Is TLS interception performed? If so, which root CA must be pinned
   in firmware (we will not disable certificate validation)?
6. **Captive portal:** If a portal is required, what is the approved onboarding
   method for headless devices? We will not script a bypass.
7. **Time synchronization:** Is NTP/UDP 123 reachable, or should the device get
   time another approved way? TLS validation depends on a correct clock.
8. **Event-day support:** Who do we contact if the network changes or the devices
   lose connectivity during the event?

## What the implementation does today

- `WifiLink` uses `WiFi.mode(WIFI_STA)` and a WPA2-PSK SSID/password from the
  untracked `include/secrets.h`.
- Connection attempts are bounded (15 s boot deadline, exponential backoff with
  jitter, one attempt per ~5 s) and the lane reports `OFFLINE` without awarding or
  buffering attendance.
- HTTPS uses `WiFiClientSecure::setCACert()` with a configurable PEM root CA.
  Certificate validation is never disabled. No `setInsecure()` call exists.
- No captive-portal bypass, DNS override, proxy or credential reuse is implemented.
- The device secret is independent of Wi-Fi credentials and only authorizes the
  device middleware API.

## If PSU IT requires EAP-TLS (or another enterprise method)

This is a **deliberate blocker**, not something to fake. Before changing firmware:

1. Obtain the approved SSID, EAP method, identity source and CA/certificate
   material.
2. Confirm the pinned Arduino-ESP32 core exposes the required API. Enterprise
   symbols have changed across cores (`esp_wifi_sta_wpa2_ent_*` and the newer
   `WiFi.begin(..., WPA2_ENTERPRISE, ...)` paths are not interchangeable).
3. Add a separate, reviewed network module and credential storage path. Do not
   commit certificates/keys; provision them per unit.
4. Re-run the full hardware checklist in
   [hardware-bringup.md](hardware-bringup.md), plus a certificate-renewal test.
5. Record the result in the test report. Never mark enterprise connectivity as
   passing based on a home WPA2 network.

## Alternative approved options to ask about

- A PSU-sanctioned event/IoT SSID with pre-shared key.
- A departmental network approved for the devices.
- A dedicated mobile hotspot owned by the organization (still subject to PSU
  policy and event rules) used only for the kiosks, with the same TLS checks.

Any of these is acceptable only if PSU IT or the event venue authorizes it. Do not
substitute a consumer VPN, MAC spoofing, a rogue AP or a disabled TLS check.

## Checklist before an event

- [ ] Written confirmation from PSU IT (or venue network owner) of the approved
      SSID and onboarding method.
- [ ] Both lanes connect at the actual venue, not just at home.
- [ ] DNS + HTTPS to the deployed API succeeds with certificate validation on.
- [ ] Clock is correct; TLS does not fail after a cold boot.
- [ ] Offline behavior verified (unplug AP or disable SSID) and no attendance is
      buffered/replayed.
- [ ] Support contact and fallback plan (manual, audited corrections) agreed with
      organizers.
