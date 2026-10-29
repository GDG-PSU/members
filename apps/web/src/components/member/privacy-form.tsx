'use client';

import { useActionState, useState } from 'react';
import { Alert, Button, Card, CardContent, Switch, VisibilityControl } from '@gdg/ui';
import type { Visibility } from '@gdg/contracts';
import { updatePrivacyAction, type ActionState } from '@/app/(member)/member/actions';

const initial: ActionState = {};

const fields: { key: keyof Visibility; label: string; description: string }[] = [
  { key: 'showDisplayName', label: 'Display name', description: 'Required for the leaderboard.' },
  { key: 'showPhoto', label: 'Profile photo', description: 'Shown on your profile and kiosk.' },
  { key: 'showAbout', label: 'Short bio', description: 'Your 280-character introduction.' },
  { key: 'showLinks', label: 'Links', description: 'https:// links only.' },
  { key: 'showMemberNumber', label: 'Member number', description: 'Your GDG-XXXXXX number.' },
  { key: 'showMemberSince', label: 'Member since', description: 'Your recorded join date.' },
  {
    key: 'showPoints',
    label: 'Points',
    description: 'Spendable balance; required for the leaderboard.',
  },
  { key: 'showStars', label: 'Stars', description: 'Lifetime participation tally.' },
  { key: 'showEvents', label: 'Events attended', description: 'Count of qualified events.' },
  { key: 'showOnLeaderboard', label: 'Leaderboard', description: 'Appear in the public ranking.' },
  {
    key: 'showEmail',
    label: 'Email address',
    description: 'Public by default. Turn off to hide your email.',
  },
];

export function PrivacyForm({ initial: initialSettings }: { initial: Visibility }) {
  const [state, action, pending] = useActionState(updatePrivacyAction, initial);
  const [settings, setSettings] = useState<Visibility>(initialSettings);

  const set = (key: keyof Visibility, value: boolean) =>
    setSettings((current) => ({ ...current, [key]: value }));

  return (
    <Card>
      <CardContent className="p-5 pt-5 sm:p-6">
        <form action={action} className="space-y-4">
          <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-subtle p-4">
            <div className="min-w-0">
              <p className="text-base font-bold">Public profile</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {settings.publicProfile
                  ? 'Anyone with your link can see the fields you enabled below.'
                  : 'Your profile link shows a neutral private state.'}
              </p>
            </div>
            <Switch
              checked={settings.publicProfile}
              aria-label="Public profile"
              onCheckedChange={(value) => set('publicProfile', value)}
            />
          </div>

          <div className="divide-y divide-border">
            {fields.map((field) => (
              <div key={field.key} className="py-0.5">
                <VisibilityControl
                  label={field.label}
                  description={field.description}
                  checked={settings[field.key]}
                  disabled={!settings.publicProfile}
                  onChange={(value) => set(field.key, value)}
                />
              </div>
            ))}
          </div>

          {Object.entries(settings).map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value ? 'on' : 'off'} />
          ))}

          {!settings.publicProfile ? (
            <Alert variant="info">
              Your profile is private. Visible fields are saved but not shown until you switch it
              back on.
            </Alert>
          ) : null}
          {state.error ? <Alert variant="danger">{state.error}</Alert> : null}
          {state.ok ? <Alert variant="success">{state.message}</Alert> : null}

          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save privacy settings'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
