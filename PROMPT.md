# Build Prompt — GDG@PSU Points, Member Portal, NFC Kiosk

You are the senior product engineer, security engineer, UI designer, firmware engineer, test engineer, and repo maintainer responsible for implementing this system. Work in the current repository/workspace. Read `PLAN.md` completely before coding; it is the authoritative specification. Do not merely produce another plan: build the working monorepo, test it, document it, and make honest commits.

## Mission

Implement the GDG@PSU member points platform described in `PLAN.md`: Next.js + Supabase Auth/Postgres/Storage web app, Vercel-ready deployment, Tailwind CSS + shadcn/ui design system, public/member/admin/kiosk experiences, immutable points-and-stars ledger, invitation-first activation, privacy-aware permanent member profiles, revocable NFC card URLs, staff-validated attendance, rewards, device API, and PlatformIO ESP32 + PN532 firmware for two independently authenticated lanes.

The design should be exceptionally polished, visual-first, uncluttered, responsive, accessible, and practical at a busy in-person event. This is a working product, not a mockup. Do not ship buttons that are inert, fake “success” notifications, unfinished placeholders in core flows, or fake security.

## Non-negotiable workflow

1. **Inspect before modifying.** Check the current working directory, existing files, Git status/branch/remotes, installed runtimes, available toolchains, and whether there is an existing repo/worktree. Preserve user work. Never reset, clean, force-push, or rewrite pre-existing history.
2. Read all of `PLAN.md`. Make a short internal implementation checklist and execute it in dependency order. Avoid asking the user questions already answered by the plan.
3. Verify current stable compatibility for frameworks/libraries/hardware APIs from official documentation. Use stable releases and a real lockfile; do not guess at retired APIs or use a canary release merely for novelty.
4. Build the smallest complete vertical slice first: schema/security → invitation and activation → profile privacy → card routing and device API → event attendance/ledger → admin/member UI → firmware integration → tests/docs. Continue through the whole scope rather than stopping after a scaffold.
5. After each meaningful phase, run the checks that apply and fix failures. Do not disable tests, lower thresholds, hide errors, add broad lint suppressions, or claim a command passed when it did not run.
6. Use local Supabase/test fixtures/mocks for development whenever production credentials or physical hardware are unavailable. Clearly distinguish simulated, locally verified, and physically verified behaviors.
7. Keep the user informed of blockers, but do not interrupt to ask about things you can safely decide using `PLAN.md`. If a real external dependency is necessary and unavailable, finish all nonblocked work and ask only for the specific missing item.
8. Before finalizing, run the full available verification suite, inspect the UI at desktop and mobile breakpoints, review security-sensitive diff sections, check for secrets, and produce the completion report required below.

## Fixed product and security rules

- The stable profile is `/m/<opaque-random-public-id>`; it is created only after successful invite acceptance/setup.
- The physical card stores only an HTTPS NDEF URI at `/c/<random-card-locator>`. `/c/` redirects to `/m/` only while that card locator is active. Never put member data, an Auth ID, a password, points, email, Wi-Fi credentials, a device secret, or a session token on the tag.
- A card URL is readable/copyable and is not an authentication credential. No scan grants points. Authenticated staff must review the photo/member details and explicitly confirm attendance or activity.
- The profile photo must clearly show the member's face. If the photo changed within 48 hours, the kiosk must require a PSU ID check and the server must refuse attendance confirmation until the organizer records it.
- Supabase Auth is the only password/hash/session implementation. No open sign-up. Supabase secret/admin credentials remain server-only.
- Use RLS and minimal grants for every exposed table. Verify authorization on every server operation. No client-side role checks as a security boundary.
- Points are spendable; stars equal lifetime positive point earnings and never get spent. Awards, attendance, redemptions, refunds, and balance updates must be atomic, idempotent, and auditable.
- Event attendance requires staff-confirmed check-in AND check-out. No checkout = no automatic points. Use server timestamps; duplicate/replayed requests must not duplicate a transaction.
- Email follows its member-controlled per-field visibility flag and defaults public as the product brief requests; disclose this clearly during activation. Whole-profile privacy overrides every field. Auth identifiers, internal IDs, QR/card locators, and device secrets are never public. Enforce visibility on the server, not just in the UI.
- ESP32s call only the central versioned HTTPS API; they do not contact Supabase. Use a unique per-device secret and signed requests, replay protection, revocation, TLS certificate verification, bounded retry/queue behavior, and no personal PSU credential embedded in public source.
- The two devices must be independently registered and revocable. The API and UI must never trust a device-reported points value, role, member ID, or arbitrary URL.
- Tailwind CSS v4 with the shared shadcn/ui-style component system is the single UI design system. Reuse shared tokens/components. Don't blend unrelated design systems.

## External blockers and intervention rule

Do not silently replace a needed external capability with an inferior/unsafe alternative. Do not claim production/hardware success without real evidence. Ask the user only when you reach a genuine boundary the agent cannot cross itself, such as:

- Supabase/Vercel credentials, DNS access, production SMTP/mail configuration, production deployment approval, or a first-admin email;
- actual ESP32/PN532/tag board models or unknown physical wiring that must be verified before a safe flashing/wiring instruction;
- Penn State IT approval and the correct eduroam EAP/CA settings;
- real club policy decisions that cannot reasonably be made configurable or are not defined in `PLAN.md`;
- a destructive action or spend on a paid service.

Do not ask for secrets pasted into chat. Ask the user to add them to a secure local environment or the intended dashboard. Continue all independent local tasks with `.env.example`, test fixtures, mocks, and explicit runbook steps.

If the code harness cannot access real email delivery, domain/DNS, hardware, or PSU Wi-Fi, still write and run relevant unit, integration, mock-contract, firmware-build, and documentation checks. Mark the unavailable physical/production validation clearly in the final report.

## Git requirements

Create or maintain the repository the way a careful human engineer would: coherent structure, appropriate `.gitignore` and `.editorconfig`, lockfile, meaningful README/docs, focused commits, and no leaked secrets or binaries. Check status/diff before every commit. Do not set a fake author identity and do not add AI co-author or AI-generated attribution trailers/text to commit messages. Preserve configured author identity and existing history. Do not push or create a remote/public repo unless explicitly authorized.

The user requested signing be turned off temporarily for project setup and then restored. Handle this at **local repository scope only**:

1. Inspect effective local/global `commit.gpgsign` and any relevant tag-signing config before changing anything.
2. Save the exact prior local setting (including the fact that it was unset).
3. Temporarily override signing off only for the required local setup commits. Do not change global configuration.
4. Restore the previous local setting, or remove the local override if none existed, so the previous effective user/global behavior resumes.
5. Verify and report the final effective state. If policy in the environment prohibits this, do not try to bypass that external enforcement; explain the blocker.

Never commit `.env`, real emails/member data/photos, Supabase service secrets, mail keys, device secrets, PSU credentials, raw recovery links, or firmware builds containing secrets. Use placeholders in examples only.

## Quality gates

Implement and actually run `pnpm verify` (or a documented equivalent) so that it checks all locally runnable validation gates and exits nonzero on failure. Include:

- formatting, lint, strict TypeScript checks, production build;
- unit and domain invariant tests;
- Supabase migrations, pgTAP/RLS/grant tests, and local integration tests when prerequisites exist;
- API security/authorization/idempotency tests;
- Playwright E2E for invitation activation, privacy, leaderboard, event scan confirmation, check-in/out, ledger, redemption, card revoke/redirect, digital ID access, and admin-only recovery links;
- responsive screenshots/accessibility checks for important pages at 320, 375, 768, 1024, and 1440 CSS px;
- PlatformIO firmware compile and supported host tests; server/firmware HMAC test vectors must match;
- secret/dependency checks.

If a test requires a missing prerequisite, report that gate as blocked with exact reason/instructions and do not label it passed. Fix flakiness and real failures. Don't make the verification command green by skipping required checks.

## Required deliverable state

At the end, the repository should contain the implementation specified in `PLAN.md`, not only docs. At a minimum provide:

- complete app and server routes for visitor, member, admin, kiosk, and device workflows;
- migrations, RLS/grants, database functions, seed/test fixtures;
- responsive shared Tailwind/shadcn design system;
- ESP32/PN532 firmware project and non-secret example configuration;
- tests and CI workflows;
- complete operational/security/deployment/hardware/network runbooks;
- `.env.example`, clean `.gitignore`, lockfile, meaningful Git history;
- no secrets in Git and no dead controls/core-flow TODOs.

Use safe configurable sample values only for event points, event durations, and rewards; do not invent actual GDG@PSU policy. Label demo seed data unmistakably. Ensure all server failures have useful safe UI feedback and correlation IDs without sensitive values.

## Final report format

When finished, report:

1. What was implemented and the main architecture choices.
2. The key security/privacy guarantees, and the known limitation that static NFC tags can be cloned.
3. The exact commands run and their actual pass/fail results.
4. What was verified only with mocks/local environments versus physical hardware/real email/production deployment.
5. A short list of precise user actions still required (secrets, DNS, email, first admin, hardware details, PSU network approval, policy inputs), only if actually needed.
6. Git commit summary and confirmation that signing configuration was restored.
7. Known limitations; do not overstate readiness.

Start by inspecting the workspace and reading `PLAN.md`, then implement the project end-to-end.
