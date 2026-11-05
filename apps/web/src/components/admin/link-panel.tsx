'use client';

import { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
} from '@gdg/ui';

/**
 * Displays a one-time link. No email is sent by the app; the admin copies the
 * link into their own mail client.
 */
export function LinkPanel({
  link,
  email,
  title,
  hours,
}: {
  link: string;
  email?: string;
  title?: string;
  hours?: number;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setCopyError(false);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(true);
    }
  }

  return (
    <div className="mt-3 space-y-3">
      <Alert variant="success" role="status">
        {title ?? 'Link ready'}
        {email ? ` for ${email}` : ''}. Send it privately; anyone with it can set the password.
      </Alert>
      <Textarea
        value={link}
        readOnly
        rows={3}
        onFocus={(event) => event.currentTarget.select()}
        aria-label="One-time sign-in link"
        className="min-h-0 resize-none font-mono text-xs leading-relaxed"
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Button size="sm" variant="secondary" onClick={copy}>
          {copied ? 'Copied' : 'Copy link'}
        </Button>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {hours ? `The link works once, for ${hours} hours from now.` : 'The link works once.'}
        </p>
      </div>
      {copyError ? (
        <p className="text-xs font-medium text-danger">
          Copy failed — select the link and copy it manually.
        </p>
      ) : null}
    </div>
  );
}

export function LinkDialog({
  open,
  onClose,
  link,
  email,
  title = 'One-time link',
  hours,
}: {
  open: boolean;
  onClose: () => void;
  link?: string;
  email?: string;
  title?: string;
  hours?: number;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {link ? <LinkPanel link={link} email={email} title="Copy this link" hours={hours} /> : null}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
