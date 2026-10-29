'use client';

import { Switch } from './ui/field';

export function VisibilityControl({
  label,
  description,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        {description ? (
          <p className="mt-0.5 text-[0.78rem] leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}
