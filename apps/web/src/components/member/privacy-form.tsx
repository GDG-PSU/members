'use client';

import { useRef, useState } from 'react';
import { Alert, Card, CardContent, Switch, VisibilityControl } from '@gdg/ui';
import type { Visibility } from '@gdg/contracts';
import { updatePrivacyAction } from '@/app/(member)/member/actions';

const fields: { key: keyof Visibility; label: string; description: string }[] = [
  { key: 'showDisplayName', label: 'Display name', description: 'Needed for the leaderboard.' },
  {
    key: 'showPhoto',
    label: 'Profile photo',
    description: 'Organizers always see it at check-in.',
  },
  { key: 'showAbout', label: 'Short bio', description: 'Your introduction.' },
  { key: 'showLinks', label: 'Links', description: 'The links on your profile.' },
  { key: 'showMemberNumber', label: 'Member number', description: 'Your GDG number.' },
  { key: 'showMemberSince', label: 'Member since', description: 'The date you joined.' },
  { key: 'showPoints', label: 'Points', description: 'What you can spend on rewards.' },
  { key: 'showStars', label: 'Stars', description: 'Everything you have earned so far.' },
  {
    key: 'showEvents',
    label: 'Events attended',
    description: 'How many events earned you points.',
  },
  { key: 'showOnLeaderboard', label: 'Leaderboard', description: 'Appear in the public ranking.' },
  { key: 'showEmail', label: 'Email address', description: 'Shown unless you switch it off.' },
];

const ORGANIZER_FIELDS: (keyof Visibility)[] = [
  'showDisplayName',
  'showPhoto',
  'showAbout',
  'showLinks',
  'showEmail',
];

type SaveState = { kind: 'idle' | 'saving' | 'saved' } | { kind: 'error'; text: string };

/** Each switch saves as it is flipped, so there is no Save button to forget. */
export function PrivacyForm({
  initial,
  organizer = false,
}: {
  initial: Visibility;
  /** Organizers have no number, points or leaderboard place to show. */
  organizer?: boolean;
}) {
  const [settings, setSettings] = useState<Visibility>(initial);
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  // What the server last accepted, to go back to when a save fails.
  const savedRef = useRef<Visibility>(initial);
  const latestRef = useRef(0);

  function change(key: keyof Visibility, value: boolean) {
    const next = { ...settings, [key]: value };
    const ticket = latestRef.current + 1;
    latestRef.current = ticket;
    setSettings(next);
    setSave({ kind: 'saving' });

    const form = new FormData();
    for (const [name, on] of Object.entries(next)) form.set(name, on ? 'on' : 'off');
    updatePrivacyAction({}, form)
      .then((result) => {
        if (result.error) throw new Error(result.error);
        savedRef.current = next;
        // A newer flip is still on its way; it reports for both.
        if (ticket === latestRef.current) setSave({ kind: 'saved' });
      })
      .catch((error: unknown) => {
        if (ticket !== latestRef.current) return;
        setSettings(savedRef.current);
        setSave({
          kind: 'error',
          text:
            error instanceof Error && error.message
              ? error.message
              : 'That change was not saved. Try again.',
        });
      });
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5 pt-5 sm:p-6">
        <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-subtle p-4">
          <div className="min-w-0">
            <p className="text-base font-bold">Public profile</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {settings.publicProfile
                ? 'Anyone with your link can see what is switched on below.'
                : 'Your link shows only that the profile is private.'}
            </p>
          </div>
          <Switch
            checked={settings.publicProfile}
            aria-label="Public profile"
            onCheckedChange={(value) => change('publicProfile', value)}
          />
        </div>

        <div className="divide-y divide-border">
          {(organizer
            ? fields.filter((field) => ORGANIZER_FIELDS.includes(field.key))
            : fields
          ).map((field) => (
            <div key={field.key} className="py-0.5">
              <VisibilityControl
                label={field.label}
                description={organizer ? '' : field.description}
                checked={settings[field.key]}
                disabled={!settings.publicProfile}
                onChange={(value) => change(field.key, value)}
              />
            </div>
          ))}
        </div>

        {!settings.publicProfile ? (
          <Alert variant="info">
            Your profile is private. The switches above are kept for when you make it public again.
          </Alert>
        ) : null}
        {save.kind === 'error' ? (
          <Alert variant="danger" role="alert">
            {save.text}
          </Alert>
        ) : (
          <p className="text-xs text-muted-foreground" role="status">
            {save.kind === 'saving'
              ? 'Saving…'
              : save.kind === 'saved'
                ? 'Saved.'
                : 'Changes save as soon as you flip a switch.'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
