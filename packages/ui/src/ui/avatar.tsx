'use client';

import { useState } from 'react';
import { cn } from '../lib/cn';

export function MemberAvatar({
  name,
  photoUrl,
  size = 48,
  className,
}: {
  name: string | null;
  photoUrl: string | null;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const initials = (name ?? '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
  const showImage = Boolean(photoUrl) && !failed;

  return (
    <span
      className={cn(
        'relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-primary-soft font-bold text-primary ring-1 ring-border',
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(11, size / 2.8) }}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote Supabase storage URLs are not configured for next/image
        <img
          src={photoUrl ?? ''}
          alt={name ? `${name}'s profile photo` : 'Member profile photo'}
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden>{initials}</span>
      )}
    </span>
  );
}
