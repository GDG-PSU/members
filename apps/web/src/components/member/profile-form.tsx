'use client';

import { useActionState, useState } from 'react';
import { Plus, Trash2, UserRound } from 'lucide-react';
import { Alert, Button, buttonVariants, Card, CardContent, Field, Input, Textarea } from '@gdg/ui';
import { updateProfileAction, type ActionState } from '@/app/(member)/member/actions';

const initial: ActionState = {};

interface ProfileFormProps {
  initialName: string;
  initialAbout: string;
  initialLinks: { label: string; url: string }[];
  photoUrl: string | null;
}

export function ProfileForm({
  initialName,
  initialAbout,
  initialLinks,
  photoUrl,
}: ProfileFormProps) {
  const [state, action, pending] = useActionState(updateProfileAction, initial);
  const [links, setLinks] = useState(initialLinks.length > 0 ? initialLinks : []);
  const [preview, setPreview] = useState<string | null>(photoUrl);

  const updateLink = (index: number, field: 'label' | 'url', value: string) => {
    setLinks((current) =>
      current.map((link, i) => (i === index ? { ...link, [field]: value } : link)),
    );
  };

  return (
    <div className="grid gap-5 md:grid-cols-[1.4fr_1fr]">
      <Card className="min-w-0">
        <CardContent className="p-5 pt-5 sm:p-6">
          <form action={action} className="space-y-5" noValidate encType="multipart/form-data">
            <div className="flex items-center gap-4">
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element -- local object URLs cannot use next/image
                <img
                  src={preview}
                  alt=""
                  aria-hidden
                  className="size-20 shrink-0 rounded-full border border-border object-cover"
                />
              ) : (
                <span
                  aria-hidden
                  className="grid size-20 shrink-0 place-items-center rounded-full border border-border bg-muted text-muted-foreground"
                >
                  <UserRound className="size-7" />
                </span>
              )}
              <div>
                <label
                  htmlFor="profile-photo"
                  className={buttonVariants({
                    variant: 'secondary',
                    size: 'sm',
                    className: 'cursor-pointer',
                  })}
                >
                  Replace photo
                </label>
                <input
                  id="profile-photo"
                  type="file"
                  name="photo"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    setPreview(file ? URL.createObjectURL(file) : photoUrl);
                  }}
                />
                <p className="mt-1.5 text-xs text-muted-foreground">Square crop · max 2 MB</p>
              </div>
            </div>

            <Field label="Display name" htmlFor="profile-name" required>
              <Input
                id="profile-name"
                name="displayName"
                defaultValue={initialName}
                required
                maxLength={60}
              />
            </Field>

            <Field
              label="Short bio"
              htmlFor="profile-about"
              hint="Up to 280 characters. Rendered as plain text."
            >
              <Textarea
                id="profile-about"
                name="about"
                defaultValue={initialAbout}
                maxLength={280}
                rows={3}
              />
            </Field>

            <div>
              <p className="text-sm font-semibold">Links</p>
              <p className="mt-0.5 text-xs text-muted-foreground">https:// only. Up to six.</p>
              <div className="mt-2.5 space-y-2">
                {links.map((link, index) => (
                  <div key={index} className="grid items-end gap-2 sm:grid-cols-[9rem_1fr_auto]">
                    <Field label="Label" htmlFor={`link-label-${index}`}>
                      <Input
                        id={`link-label-${index}`}
                        value={link.label}
                        maxLength={40}
                        onChange={(event) => updateLink(index, 'label', event.target.value)}
                      />
                    </Field>
                    <Field label="https://…" htmlFor={`link-url-${index}`}>
                      <Input
                        id={`link-url-${index}`}
                        type="url"
                        value={link.url}
                        placeholder="https://"
                        onChange={(event) => updateLink(index, 'url', event.target.value)}
                      />
                    </Field>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove link ${link.label || index + 1}`}
                      onClick={() => setLinks((current) => current.filter((_, i) => i !== index))}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                ))}
                {links.length < 6 ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setLinks((current) => [...current, { label: '', url: '' }])}
                  >
                    <Plus className="size-4" aria-hidden />
                    Add link
                  </Button>
                ) : null}
              </div>
              <input
                type="hidden"
                name="links"
                value={JSON.stringify(links.filter((link) => link.label && link.url))}
              />
            </div>

            {state.error ? <Alert variant="danger">{state.error}</Alert> : null}
            {state.ok ? <Alert variant="success">{state.message}</Alert> : null}

            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save profile'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="md:sticky md:top-24 md:self-start">
        <Card className="overflow-hidden">
          <div
            aria-hidden
            className="h-1.5 w-full bg-[linear-gradient(90deg,#4285f4_0%,#0d7a72_55%,#9a6206_100%)]"
          />
          <CardContent className="p-5">
            <p className="type-overline text-muted-foreground">Preview</p>
            <div className="mb-3 mt-2.5 flex items-center gap-3">
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element -- local object URLs cannot use next/image
                <img
                  src={preview}
                  alt=""
                  aria-hidden
                  className="size-16 shrink-0 rounded-full border border-border object-cover"
                />
              ) : (
                <span
                  aria-hidden
                  className="grid size-16 shrink-0 place-items-center rounded-full bg-primary-soft text-primary"
                >
                  <UserRound className="size-6" />
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate text-base font-bold">{initialName}</p>
                <p className="text-xs text-muted-foreground">Public profile card</p>
              </div>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Saved changes appear on your public profile immediately. Hidden fields stay hidden
              even if you fill them in here.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
