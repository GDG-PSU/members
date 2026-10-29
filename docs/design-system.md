# Design system

MemberPass uses **Tailwind CSS v4** with a code-owned, shadcn/ui-style component layer. There is no
runtime CSS-in-JS and no third-party theme engine. Every visual decision resolves to a semantic token
in `apps/web/src/app/globals.css`, and every reusable component lives in `packages/ui`.

## Principles

1. **Tokens, not arbitrary values.** App code uses semantic utilities (`bg-card`, `text-muted-foreground`,
   `border-border`, `text-primary`, `text-star`, `text-danger`). Raw hex values are allowed only inside the
   token block or a deliberately art-directed surface (the pass gradient, brand dots).
2. **One system.** Do not add another component library or a parallel set of styles. Extend `packages/ui`.
3. **Calm density.** Busy event surfaces (kiosk, check-in queues) favor large identity, one primary action,
   and high contrast. Admin tables favor scanability over decoration.
4. **Expressive, not noisy.** Tight display typography, soft elevation, 1px borders, and restrained motion
   (`animate-rise`, `animate-fade`) carry the personality.
5. **Accessible by default.** Visible focus rings, keyboard-reachable Radix widgets, labelled controls,
   reduced-motion support, and light/dark contrast checked against WCAG AA.

## Color tokens

Defined once in `:root` and overridden under `.dark` in `globals.css`, then exposed to Tailwind through
`@theme inline`.

| Token                                  | Role                                               |
| -------------------------------------- | -------------------------------------------------- |
| `--background` / `--foreground`        | Page canvas and primary text                       |
| `--card` / `--card-foreground`         | Surfaces and their text                            |
| `--muted` / `--muted-foreground`       | Secondary fills and supporting copy                |
| `--subtle`                             | Recessed bands (footer, empty states, table heads) |
| `--border` / `--input`                 | Hairlines and control outlines                     |
| `--ring`                               | Focus ring                                         |
| `--primary` / `--primary-soft`         | Brand action, active navigation, soft highlights   |
| `--secondary`                          | Teal supporting accent                             |
| `--star`                               | Lifetime stars / rank one                          |
| `--success` / `--warning` / `--danger` | Status roles                                       |
| `--color-brand-blue                    | red                                                | yellow | green` | GDG four-dot mark and brand hairlines |

Utilities: `bg-*`, `text-*`, `border-*`, plus `/opacity` modifiers (for example `bg-success/10`).
Never hardcode a status color in a page.

## Typography

Fonts are loaded with `next/font` (Plus Jakarta Sans for UI, JetBrains Mono for codes and numbers) and
mapped to `--font-sans` / `--font-mono`.

| Utility         | Use                                             |
| --------------- | ----------------------------------------------- |
| `type-display`  | Marketing hero only                             |
| `type-h1`       | Page title                                      |
| `type-h2`       | Section title                                   |
| `type-h3`       | Card title                                      |
| `type-overline` | Eyebrows, table heads, micro labels (uppercase) |

Body copy is `text-sm` with `leading-relaxed`; captions are `text-xs`; metric numerals use `tabular-nums`.

## Shape, elevation, motion

- Radii: inputs `rounded-xl`, cards `rounded-2xl`, modals `rounded-3xl`, buttons and chips `rounded-full`.
- Elevation: `shadow-card` for resting surfaces, `shadow-lift` for hover/modals, `shadow-glow` for the
  primary CTA band. Borders do most of the separation work.
- Motion: 150–200ms color/transform transitions; `animate-rise` for entering content. All motion is
  disabled under `prefers-reduced-motion`.

## Component inventory (`@gdg/ui`)

- **Layout/brand:** `PageShell` (width `sm|md|lg|xl`), `SectionHeading`, `Wordmark`, `ThemeModeToggle`.
- **Surfaces:** `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`.
- **Actions:** `Button` + `buttonVariants` (default, secondary, soft, outline, ghost, destructive, link;
  sizes sm, default, lg, icon).
- **Data display:** `DataTable` (responsive stacking under `sm`), `StatusChip`, `Badge`, `MetricCard`,
  `MemberAvatar`.
- **Feedback:** `Alert` (info, success, warning, danger, neutral), `EmptyState`, `LoadingState`,
  `PageSkeleton`, `ErrorState`.
- **Forms:** `Field`, `Label`, `Input`, `Textarea`, `Select`, `Checkbox`, `Switch`, `VisibilityControl`,
  `SubmitButton` (admin legacy adapter).
- **Overlays:** `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`,
  `DialogFooter`, `ConfirmDialog`, `LinkDialog` (admin).

Navigation is link-based: `NavTabs` (app-level) renders the member/admin section rails with an underline
indicator and `aria-current`. The mobile header uses a Radix dialog sheet for focus trapping.

## Usage rules

- A link that looks like a button is `<Link className={buttonVariants({ variant, size })}>`. The `Button`
  component renders a real `<button>` and accepts no `href`.
- Page content is wrapped in `PageShell`; route-group layouts own the `<main id="main">` landmark.
  Auth pages rely on the centered auth layout instead.
- `CardContent` has horizontal and bottom padding only. Add `pt-5`/`pt-6` when a card has no `CardHeader`.
- Use `Dialog`/`ConfirmDialog`, never `window.confirm`, for new destructive flows. (`SubmitButton` keeps
  its historical `confirmMessage` prop for existing admin forms.)
- Icons come from `lucide-react` at `size-4` (inline) or `size-5` (feature bubbles).
- Status vocabulary lives in `StatusChip`; extend its tone map rather than styling ad hoc badges.

## Adding a component

1. Add it under `packages/ui/src/ui/` with `cn()` and CVA variants.
2. Use semantic tokens only; no hex, no arbitrary shadow.
3. Export it from `packages/ui/src/index.ts`.
4. Mark `'use client'` only when the component needs state, effects, or an event handler.
5. Verify keyboard focus, dark mode, and the mobile breakpoint before merging.

## Dark mode

`.dark` on `<html>` selects the dark token set. The class is applied by an inline script before paint
(no flash) and managed by `ThemeModeToggle`, which persists `memberpass-theme` in `localStorage` and
follows the OS when set to System.
