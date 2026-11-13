# Test plan and results

What the tests cover, what was run and when, and what has never been checked.
This is the one place results are recorded; date every entry. How to run each
suite is in `AGENTS.md`, section 7.

## Latest run: 2026-11-13

A production build on `http://localhost:3100` against a local Supabase stack
with every migration through 0021, and both physical readers on firmware 2.2.0.
Nothing here ran against production. It was deployed afterwards; see Production.

| Check                     | Command                       | Result                                                 |
| ------------------------- | ----------------------------- | ------------------------------------------------------ |
| Formatting                | `pnpm format:check`           | Pass                                                   |
| Lint and types            | `pnpm lint`, `pnpm typecheck` | Pass                                                   |
| Unit tests                | `pnpm test`                   | 118 of 118                                             |
| Production build          | `pnpm build`                  | Pass                                                   |
| Database                  | `pnpm db:verify`              | 126 of 126 on the local stack                          |
| Browser tests             | `pnpm e2e`                    | 57 pass, 39 skipped; 47 of 47 on desktop Chromium      |
| Firmware build            | `pio run`                     | Pass; 2.2.1, 656 KB of a 1,310 KB slot                 |
| Readers from outside      | `reader_check.py --bluetooth` | 77 of 77 on both readers; see below for one failed run |
| Readers through the pages | `reader-hardware.spec.ts`     | Pass on one reader; see below for one timed-out run    |

The 39 skips are the signed-in specs on the mobile project, which run on desktop
only, and the hardware spec when `READER_PORT` is not set. On mobile the 10
public specs pass.

## What each suite covers

### Unit tests (`apps/web/src/**/*.test.ts`)

Pure logic: attendance rules, audit sentences, link rules, tokens, date helpers,
and the reader code. For readers: the handshake against values made separately
in Python, a key sealed by `provision_reader.py` opening on the website, the
sealed channel against Node's own AES-GCM including a replayed and an altered
line, and `ReaderManager` against a simulated reader that does the real
handshake on both links. That last suite covers a session on the cable, a reader
with no key being given one, a reader whose key the site does not hold being
refused, a restart mid-command, a key change on each link, a key change cut
short in both directions, and every switch between the cable and Bluetooth.

### Database checks (`scripts/db-verify.mjs`)

Run inside a transaction against a disposable database: which API role can call
or read what, RLS isolation between members, ledger and attendance invariants,
permanent delete and the audit log that nothing can change, one-time links, and
reader keys (versions, a key change keeping the key stored first, retiring old
versions, and API roles being refused).

### Browser tests (`tests/e2e`)

`workflows.spec.ts` drives every workflow through the real pages with accounts
it creates and removes:

- **Access:** sign-up refused, API keys refused on privileged functions,
  organizer sign-in with an authenticator, HttpOnly cookies, cross-site session
  posts refused, what a normal admin cannot open, the sign-in rate limit.
- **Navigation:** the five admin tabs and four member tabs, and old addresses
  leading to their new homes.
- **Invitations and links:** 72 and 48 hour lifetimes, lapsed and replaced
  links, the Not accepted status, links surviving chat previews until Continue
  is pressed, setup validation, recovery, suspension, and user type changes.
- **Members:** profile, photo, links, privacy switches that save as they are
  flipped, the activity page, forms keeping their values after an error.
- **Organizers:** setting up a profile, the public page with its badge, and
  organizers being refused points and check-in.
- **Events:** the short form, the derived check-in and check-out times,
  publishing, cancelling, bonus sessions.
- **Kiosk:** reading with no button, a card not read twice until lifted, the
  48-hour PSU ID rule, duplicate scans, and check-in by name or QR code.
- **Cards:** one button preparing, writing, reading back and switching a card
  on; a spoiled write leaving the old card working; replacing and switching off.
- **Readers:** the site giving a reader with no key one, once; nothing but the
  handshake crossing the cable or the air in the clear; a reader that restarts
  being given a new session unnoticed; Rotate key changing the key at both ends
  and retiring the old one; the manual writer; every switch between the cable
  and Bluetooth; and a reader with the wrong key refused on both links.
- **Rewards:** request, cancel, approve, hand over and reject, with the balance
  checked after each.
- **Corrections and permanent delete:** every attendance correction, each kind
  of delete, and the audit log refusing a change even from the service key.
- **Audit and browser:** entries as sentences, phone-width layout, the CSP, and
  uncaught page errors.

The reader specs use a stand-in (`tests/e2e/support/fake-reader.ts`) with a fake
cable and a fake radio that follows the firmware's rules. `admin-invitation.spec.ts`
uses an older, protocol 2 stand-in, which the pages still talk to in the clear.

### Reader tools (`firmware/kiosk-reader/tools`)

`reader_check.py` speaks the protocol to a real reader from outside: a reader
with no key doing nothing but taking one; the cable refusing everything but
`info`, `ping`, `usb.release` and the handshake; the wrong key, one proof per
attempt, a replayed line and a command in the clear each refused; a key change
in a session on each link; a restart; the same over real radio, with a silent
caller dropped after 8 seconds; the cable taking over; the organizer's override;
and Bluetooth switched off. `reader-hardware.spec.ts` runs the real Cards page
against a real reader and real radio.

## Hardware results

### Firmware 2.2.1, 2026-11-13: NTAG216

Both readers were flashed from 2.2.0 to 2.2.1 with their NFC modules attached,
and each kept its key: a session opened afterwards with the key the live site
stores.

- On 2.2.0, one reader refused an NTAG216 card with `tag_capacity_unexpected`.
- On 2.2.1, straight to that reader over the cable, in a session: the same card
  was read (it held a link of 83 characters), a test link was written and read
  back by the reader, reading it again gave the test link, and the card's own
  link was then written back and confirmed.
- The other reader, on 2.2.1, read the card too. Nothing was written from it.
- Not covered: an NTAG216 through the Cards page or the kiosk, over Bluetooth,
  or an NTAG213 or NTAG215 on 2.2.1.

### Firmware 2.2.0, 2026-11-13

Both readers, `esp32-a4156cc92df4` ("GDG Reader A415") and `esp32-3c1c6cc92df4`
("GDG Reader 3C1C"), on COM3 of a Windows 11 laptop with an Intel Bluetooth
adapter.

- **`reader_check.py --bluetooth`:** 77 of 77 in six of seven full runs across
  the two readers. In the seventh, opening a cable session failed once just
  after the reader came back on the air, the tool then crashed on a Bluetooth
  connection error, and the reader was left holding its throwaway key and had
  to be erased. Repeating that step 20 times and three more full runs did not
  reproduce it. The tool now takes its key off whatever happens.
- **`provision_reader.py`:** gave a reader its key against the local stack four
  times and cleared it four times, and refused a hosted project without
  `--confirm`.
- **`reader-hardware.spec.ts`**, Playwright's Chromium with a window, real Web
  Bluetooth, the real server actions on the local stack, the reader's key put in
  by `provision_reader.py`. Two clean passes. One run timed out waiting 45
  seconds for the reader in the Bluetooth chooser at **Switch to Bluetooth**;
  the page stayed connected by cable and showed no error. One earlier run failed
  only on an expectation in the spec, since corrected.

  | Step                                       | Time    |
  | ------------------------------------------ | ------- |
  | Connect by cable, including the session    | 1.4 s   |
  | Rotate key over the cable                  | 0.3 s   |
  | Connect by Bluetooth                       | 4.0 s   |
  | Rotate key over Bluetooth                  | 0.4 s   |
  | Move to the cable when plugged in          | 1.4 s   |
  | Switch to Bluetooth with the cable in      | 3.4 s   |
  | Switch back to the cable                   | instant |
  | Fall back to Bluetooth when the cable went | 7.0 s   |

- **No card was written or read in these runs.** The NFC modules were unplugged for
  most of these runs. Through the page, over Bluetooth, the reader did answer
  "no card" for four seconds, and "unsupported card" for something that was on
  it.
- Only the serial port picker was stood in for, and "pulling the cable" closed
  the port while the reader kept its power.

### Firmware 2.1.0, 2026-11-12

One reader, with a card. The one-button writer prepared, wrote, read back and
switched on a card over the cable (1.7 s), that card was read over Bluetooth
(0.8 s), and a second was written over Bluetooth (1.7 s). Straight to the
reader over Bluetooth, a card was read, written and read back. A command over
Bluetooth took about 31 ms. The card sat slightly off the antenna and was found
on 30 to 35 of every 40 reads, which is why the pages retry.

### Firmware 2.0.2, 2026-11-04

One reader, with a card, over the cable: the whole journey from invitation to
points, through the real app. Malformed JSON, unknown commands, links too long
for the card and an overlong line were each refused cleanly, and with the PN532
powered off a read failed in about 1.5 s without hanging.

## Production

Read-only checks after each deploy, signed out. Nothing signed-in has ever been
run on production by an agent.

- **2026-11-13, `1e9143b` after `1e1f602`:** migration 0021 is applied. The
  public key is refused on `reader_keys` and on both of its functions. Public
  pages load, and `/admin/cards` and `/admin/kiosk` send a signed-out visitor to
  `/login`.
- **2026-11-13, both readers:** `provision_reader.py` gave
  `esp32-a4156cc92df4` and `esp32-3c1c6cc92df4` their keys against production.
  For each, `reader_keys` holds one row, the audit log one `reader.provisioned`
  entry with no person, and a session opened on the cable with the key read back
  from the live database. Outside that session each reader refused a card read. Beforehand, this laptop's
  `CARD_WRITE_ENCRYPTION_KEY` opened five values the live site had sealed, so
  the tool and the site seal with the same key. No organizer has connected a
  reader through the live pages.
- **2026-11-12, `4e963dc`:** public pages load, admin pages send a signed-out
  visitor to `/login`, and the two Vercel addresses redirect to the domain.
- **2026-11-12, `7655a02`:** the `Permissions-Policy` allows serial and
  Bluetooth to the site itself.
- **2026-11-05:** migrations through 0020 are applied; `anon` can execute no
  public function and `authenticated` only the three RLS helpers; a made-up
  one-time link redirects to `/login?notice=invalid-link`.

## Not verified

**Readers**

- Stored reader keys, the locked cable, Rotate key and the manual writer through
  the live pages, signed in. Both readers hold keys the live site stores, and no
  organizer has connected one there yet.
- A card written or read through the pages on firmware 2.2, and the kiosk page
  with a real reader on 2.2. A card was read and written on 2.2.1 only straight
  to the reader.
- The site giving a real reader with no key one. On hardware the key always came
  from `provision_reader.py`; the site's own path ran against the stand-in.
- The kiosk over Bluetooth on any firmware.
- A reader powered from a charger with no cable to the computer.
- Chrome or Edge themselves, their serial port picker, and Chrome on Android.
  Every run used Playwright's Chromium.
- Two readers in use at once.
- A reader reconnecting by itself on a later visit, which needs a real browser's
  saved port permission.
- A locked or too-small card, a card removed mid-write, and a purchased batch.

**The deployed app, signed in**

- Everything behind sign-in since `7472690`: the kiosk, the event form,
  organizer profiles, the People and manage pages, the audit log, one-time
  links made on production, and permanent delete, which an agent must not run
  there.
- A real camera reading a QR code from a real phone. It was proved once with
  Chromium's simulated camera.
- A production card written for a live member.

## Known gaps

- No accessibility audit with axe or a screen reader.
- No load test, and no rehearsed backup restore.
- `pnpm verify` ends at a release-coverage gate that is deliberately blocked.
- CI runs format, lint, typecheck, unit tests and the build. Everything else
  above is run by hand.
- In one of six full browser runs on 2026-11-05 the retired device API's
  signature spec got a 500 once, then passed alone and on the next full run.
