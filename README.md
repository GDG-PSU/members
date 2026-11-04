# MemberPass

MemberPass is the member platform for the Google Developer Group at Penn State (GDG@PSU). Members
get a profile, an NFC membership card, and points for showing up to events. Organizers get the tools
to run all of it.

**Live app:** <https://mempass.vercel.app>

Membership is by invitation, so there is no public sign-up page.

## What it does

**For members**

- A profile with a photo, a short bio, and links, with privacy controls for each field
- An NFC card, plus a digital ID with a QR code for when the card isn't handy
- Points and stars for attending events: points can be spent on rewards, and stars are a lifetime
  total
- A spot on the public leaderboard, which they can opt out of

**For organizers**

- Invite members and see who has joined
- Write NFC cards using a USB reader
- Check people in and out at events
- Create events, manage rewards, and approve redemptions

Superadmins can also manage staff accounts, adjust individual member records, and read the full
audit log.

**For everyone**

Public pages show upcoming events, the leaderboard, and any member profile that's set to public.

## How check-in works

1. A member taps their card on a USB reader plugged into an organizer's laptop.
2. The kiosk page shows the member's name and photo.
3. The organizer checks it's the right person and confirms.
4. The member taps again on the way out. If they stayed long enough, they earn the event's points.

A card only holds a link to the member's profile, and NFC tags can be copied. That's why a person
always confirms attendance, and why tapping a card never logs anyone in or awards points on its own.

## Built with

- Next.js 16, React 19, and TypeScript
- Tailwind CSS v4 and a shared component library
- Supabase for the Postgres database, sign-in, and file storage
- An ESP32 and a PN532 NFC reader, connected through the browser's Web Serial API
- pnpm workspaces and Turborepo

## Getting started

You'll need Node 20.9 or newer, pnpm 11, and Docker for the local database.

**1. Install dependencies and create your env files.** The web app reads `apps/web/.env.local`, and
the scripts read `.env.local` in the repository root.

```bash
pnpm install
cp .env.example apps/web/.env.local
cp .env.example .env.local
```

**2. Start a local database.** This runs Supabase in Docker and applies the migrations. It prints
the URLs and keys to copy into both env files, and `.env.example` explains each value.

```bash
pnpm dlx supabase@2.122.0 start
```

**3. Start the app.** It runs at <http://localhost:3000>.

```bash
pnpm dev
```

**4. Create your first admin.** There's no sign-up page, so this script grants the role and writes a
one-time password link to a file.

```bash
pnpm db:bootstrap-admin --email you@psu.edu --role superadmin --out .local/admin-link.txt
```

Open that link to set a password, then set up an authenticator app, which admin pages require.
Delete the file when you're done.

### Using the card reader

Writing cards and running the kiosk also need the reader hardware and Chrome or Edge, the browsers
with Web Serial. See [hardware bring-up](docs/hardware-bringup.md) for wiring and the
[firmware README](firmware/kiosk-reader/README.md) for flashing.

## Useful commands

| Command             | What it does                                        |
| ------------------- | --------------------------------------------------- |
| `pnpm dev`          | Run the app locally                                 |
| `pnpm build`        | Make a production build                             |
| `pnpm test`         | Run the unit tests                                  |
| `pnpm lint`         | Check the code with ESLint                          |
| `pnpm typecheck`    | Check types                                         |
| `pnpm format:check` | Check formatting with Prettier                      |
| `pnpm e2e`          | Run the browser tests against a running app         |
| `pnpm db:verify`    | Check database rules, on a disposable database only |

## Project layout

| Folder                  | What's in it                              |
| ----------------------- | ----------------------------------------- |
| `apps/web`              | The Next.js app                           |
| `packages/ui`           | Shared design tokens and components       |
| `packages/contracts`    | Shared validation schemas and types       |
| `supabase/migrations`   | The database schema, rules, and functions |
| `firmware/kiosk-reader` | Firmware for the USB card reader          |
| `scripts`               | Database checks and admin setup           |
| `tests/e2e`             | Browser tests                             |
| `docs`                  | Detailed documentation                    |

## Documentation

- [Architecture](docs/architecture.md)
- [Data model](docs/data-model.md)
- [API and server actions](docs/api.md)
- [Threat model](docs/threat-model.md)
- [Deployment](docs/deployment.md)
- [Operations runbook](docs/operations-runbook.md)
- [Test plan](docs/test-plan.md)
- [USB protocol](docs/usb-api.md)

[AGENTS.md](AGENTS.md) has the working rules for AI coding agents, along with the project's current
status and open items.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a security problem, follow
[SECURITY.md](SECURITY.md) rather than opening a public issue. [PRIVACY.md](PRIVACY.md) explains what
data the app keeps about members.

## License

[MIT](LICENSE) © Google Developer Group at Penn State.
