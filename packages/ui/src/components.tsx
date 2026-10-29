import type { ReactNode } from 'react';
import { cn } from './lib/cn';

export function Wordmark({ compact = false }: { compact?: boolean }) {
  const dot = compact ? 'size-1.5' : 'size-[7px]';
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className={cn('grid grid-cols-2', compact ? 'gap-[2px]' : 'gap-[3px]')}>
        <span className={cn('rounded-[2px] bg-brand-blue', dot)} />
        <span className={cn('rounded-[2px] bg-brand-red', dot)} />
        <span className={cn('rounded-[2px] bg-brand-yellow', dot)} />
        <span className={cn('rounded-[2px] bg-brand-green', dot)} />
      </span>
      <span
        className={cn(
          'font-extrabold leading-none tracking-[-0.045em]',
          compact ? 'text-[1.02rem]' : 'text-[1.12rem]',
        )}
      >
        Member<span className="text-primary">Pass</span>
      </span>
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
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        {eyebrow ? <p className="type-overline mb-2 text-primary">{eyebrow}</p> : null}
        <Heading className={headingLevel === 1 ? 'type-h1' : 'type-h2'}>{title}</Heading>
        {description ? (
          <p className="mt-2.5 max-w-xl text-[0.95rem] leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
