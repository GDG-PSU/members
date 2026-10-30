'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { Alert, Button, buttonVariants, Card, Field, Input, Textarea } from '@gdg/ui';
import { completeSetupAction, type SetupState } from '@/app/(auth)/invite/accept/actions';

const initial: SetupState = {};

export function SetupForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(completeSetupAction, initial);
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  return (
    <form action={action} className="space-y-5" noValidate encType="multipart/form-data">
      <Alert variant="info">
        {email} is invited. Add your name and a face photo.{' '}
        <a
          href="#privacy-settings"
          className="font-semibold text-primary underline underline-offset-2"
        >
          Review privacy settings
        </a>
        .
      </Alert>

      <Field
        label="Display name"
        htmlFor="setup-display-name"
        hint="Shown on your profile and at the check-in kiosk."
        required
      >
        <Input
          id="setup-display-name"
          name="displayName"
          required
          autoComplete="name"
          maxLength={60}
        />
      </Field>

      <Field label="Short bio" htmlFor="setup-about" hint="Optional — a sentence is plenty.">
        <Textarea id="setup-about" name="about" maxLength={280} rows={2} />
      </Field>

      <div>
        <p className="text-sm font-semibold text-foreground">Face photo (required)</p>
        <p className="mt-1 text-[0.82rem] leading-relaxed text-muted-foreground">
          A clear, front-facing photo of your face. Organizers match it at the door.
        </p>
        <div className="mt-2 flex items-center gap-4">
          <span
            aria-hidden
            className="size-[72px] shrink-0 rounded-full border border-border bg-muted bg-cover bg-center"
            style={{ backgroundImage: preview ? `url(${preview})` : undefined }}
          />
          <div className="min-w-0">
            <label
              className={buttonVariants({
                variant: 'secondary',
                size: 'sm',
                className: 'cursor-pointer',
              })}
            >
              Choose photo
              <input
                type="file"
                name="photo"
                accept="image/jpeg,image/png,image/webp"
                required
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) {
                    setPhotoName(null);
                    setPreview(null);
                    return;
                  }
                  setPhotoName(file.name);
                  setPreview(URL.createObjectURL(file));
                }}
              />
            </label>
            <p className="mt-1.5 text-[0.78rem] leading-relaxed text-muted-foreground">
              {photoName ?? 'JPEG, PNG or WebP · max 2 MB · cropped to a square'}
            </p>
          </div>
        </div>
        <label className="mt-3 flex items-start gap-2.5 text-[0.82rem] leading-relaxed text-muted-foreground">
          <input
            type="checkbox"
            name="photoAttestation"
            required
            className="mt-0.5 size-4 shrink-0 rounded border-input accent-primary"
          />
          <span>
            I confirm this is a clear, current photo of my face, without filters, masks or other
            people.
          </span>
        </label>
      </div>

      <Field
        label="Password"
        htmlFor="setup-password"
        hint="At least 12 characters with a number."
        required
      >
        <Input
          id="setup-password"
          name="password"
          type="password"
          required
          autoComplete="new-password"
        />
      </Field>

      <Field label="Confirm password" htmlFor="setup-confirm-password" required>
        <Input
          id="setup-confirm-password"
          name="confirmPassword"
          type="password"
          required
          autoComplete="new-password"
        />
      </Field>

      <div id="privacy-settings" className="rounded-2xl border border-border bg-subtle/70 p-4">
        <h2 className="text-base font-bold">Privacy before you join</h2>
        <p className="mt-1 text-[0.82rem] leading-relaxed text-muted-foreground">
          Profile and email are public by default. Change this anytime; a private profile hides
          every field.
        </p>
        <div className="mt-3 space-y-2.5">
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              name="publicProfile"
              defaultChecked
              className="mt-0.5 size-4 shrink-0 rounded border-input accent-primary"
            />
            Make my profile public
          </label>
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              name="showEmail"
              defaultChecked
              className="mt-0.5 size-4 shrink-0 rounded border-input accent-primary"
            />
            Show my email on my public profile
          </label>
        </div>
      </div>

      <label className="flex items-start gap-2.5 text-[0.82rem] leading-relaxed text-muted-foreground">
        <input
          type="checkbox"
          name="acceptTerms"
          required
          className="mt-0.5 size-4 shrink-0 rounded border-input accent-primary"
        />
        <span>
          I understand my privacy choices above, and that a photo change within 48 hours requires a
          PSU ID check at my next event. See the{' '}
          <Link
            href="/privacy"
            target="_blank"
            className="font-semibold text-primary underline underline-offset-2"
          >
            privacy note
          </Link>
          .
        </span>
      </label>

      {state.error ? <Alert variant="danger">{state.error}</Alert> : null}

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Creating your profile…' : 'Create my profile'}
      </Button>

      <Card className="border-dashed bg-subtle/50 px-4 py-3 text-[0.78rem] leading-relaxed text-muted-foreground">
        Single-use invitation. Contact organizers if anything looks wrong.
      </Card>
    </form>
  );
}
