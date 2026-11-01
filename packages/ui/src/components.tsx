import type { ReactNode } from 'react';
import { cn } from './lib/cn';

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-baseline font-semibold leading-none tracking-[-0.01em]',
        compact ? 'text-sm' : 'text-base',
      )}
    >
      MemberPass
    </span>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
  headingLevel = 2,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  headingLevel?: 1 | 2;
}) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  return (
    <div className="mb-6 flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        {eyebrow ? <p className="type-overline mb-2 text-muted-foreground">{eyebrow}</p> : null}
        <Heading className={headingLevel === 1 ? 'type-h1' : 'type-h2'}>{title}</Heading>
        {description ? (
          <p className="mt-2 max-w-xl text-sm leading-5 text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
