'use client';

import { useActionState, useState } from 'react';
import { Alert, Button, Field, Input, Textarea, buttonVariants } from '@gdg/ui';
import { completeStaffSetupAction, type StaffSetupState } from '@/app/admin-setup/actions';
import { keepValuesOnError } from '@/components/keep-values-on-error';
import { MAX_PROFILE_PHOTO_BYTES, PROFILE_PHOTO_TOO_LARGE } from '@/lib/profile/limits';

const initial: StaffSetupState = {};

export function StaffSetupForm({ suggestedName }: { suggestedName: string }) {
  const [state, action, pending] = useActionState(completeStaffSetupAction, initial);
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  return (
    <form action={action} onReset={keepValuesOnError(state)} className="space-y-4" noValidate>
      <Field label="Your name" htmlFor="staff-name" required hint="Shown on your profile page.">
        <Input
          id="staff-name"
          name="displayName"
          defaultValue={suggestedName}
          required
          minLength={2}
          maxLength={60}
          autoComplete="name"
        />
      </Field>

      <div>
        <p className="text-sm font-medium">
          Photo <span className="text-danger">*</span>
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <label
            htmlFor="staff-photo"
            className={buttonVariants({
              variant: 'secondary',
              size: 'sm',
              className: 'cursor-pointer',
            })}
          >
            Choose photo
          </label>
          <input
            id="staff-photo"
            type="file"
            name="photo"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // A body over the Server Action limit fails before the action runs,
              // so an oversized file has to be caught here.
              if (file && file.size > MAX_PROFILE_PHOTO_BYTES) {
                event.target.value = '';
                setPhotoError(PROFILE_PHOTO_TOO_LARGE);
                setPhotoName(null);
                return;
              }
              setPhotoError(null);
              setPhotoName(file?.name ?? null);
            }}
          />
          <span className="text-xs text-muted-foreground">
            {photoName ?? 'JPEG, PNG or WebP · max 2 MB · cropped to a square'}
          </span>
        </div>
        {photoError ? (
          <p className="mt-2 text-xs font-medium text-danger" role="alert">
            {photoError}
          </p>
        ) : null}
      </div>

      <Field label="Short bio" htmlFor="staff-about" hint="Optional, up to 280 characters.">
        <Textarea id="staff-about" name="about" rows={3} maxLength={280} />
      </Field>

      <label className="flex cursor-pointer items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          name="showEmail"
          className="mt-0.5 size-4 shrink-0 rounded border-input accent-primary"
        />
        Show my email address on my profile
      </label>

      {state.error ? <Alert variant="danger">{state.error}</Alert> : null}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Saving…' : 'Save and continue'}
      </Button>
    </form>
  );
}
