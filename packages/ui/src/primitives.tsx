'use client';

import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <Box
      component="main"
      sx={{
        mx: 'auto',
        width: '100%',
        maxWidth: 1200,
        px: { xs: 2, sm: 3, lg: 4 },
        py: { xs: 4, md: 6 },
      }}
    >
      {children}
    </Box>
  );
}

export function MetricCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <Card sx={{ height: '100%', bgcolor: 'background.paper' }}>
      <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', color: 'text.secondary' }}>
          {icon}
          <Typography variant="overline" sx={{ color: 'inherit' }}>
            {label}
          </Typography>
        </Stack>
        <Typography variant="h2" sx={{ mt: 1, fontSize: { xs: '2rem', md: '2.4rem' } }}>
          {value}
        </Typography>
        {hint ? (
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
            {hint}
          </Typography>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function MemberAvatar({
  name,
  photoUrl,
  size = 48,
}: {
  name: string | null;
  photoUrl: string | null;
  size?: number;
}) {
  const initials = (name ?? '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
  return (
    <Avatar
      src={photoUrl ?? undefined}
      alt={name ? `${name}'s profile photo` : 'Member profile photo'}
      sx={{
        width: size,
        height: size,
        bgcolor: 'primary.main',
        fontWeight: 700,
        fontSize: size / 2.6,
      }}
    >
      {initials}
    </Avatar>
  );
}

const statusColor = {
  active: 'success',
  completed: 'success',
  confirmed: 'success',
  written: 'success',
  fulfilled: 'success',
  approved: 'info',
  requested: 'warning',
  pending: 'warning',
  queued: 'warning',
  claimed: 'info',
  checked_in: 'info',
  draft: 'default',
  published: 'primary',
  cancelled: 'default',
  rejected: 'error',
  revoked: 'error',
  lost: 'error',
  disabled: 'error',
  expired: 'default',
  failed: 'error',
  replaced: 'default',
  qualified: 'success',
  suspended: 'warning',
  archived: 'default',
} as const;

export function StatusChip({ status, label }: { status: string; label?: string }) {
  const key = status as keyof typeof statusColor;
  const color = statusColor[key] ?? 'default';
  const text = label ?? status.replaceAll('_', ' ');
  return (
    <Chip
      size="small"
      color={color === 'default' ? 'default' : color}
      variant={color === 'default' ? 'outlined' : 'filled'}
      label={text}
      sx={{ textTransform: 'capitalize' }}
    />
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <Stack
      spacing={1.5}
      sx={{
        alignItems: 'center',
        textAlign: 'center',
        py: 6,
        px: 3,
        border: '1px dashed',
        borderColor: 'divider',
        borderRadius: 3,
        color: 'text.secondary',
      }}
    >
      {icon}
      <Typography variant="h5" color="text.primary">
        {title}
      </Typography>
      {description ? (
        <Typography variant="body2" sx={{ maxWidth: 420 }}>
          {description}
        </Typography>
      ) : null}
      {action}
    </Stack>
  );
}

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', py: 4 }} role="status">
      <CircularProgress size={20} />
      <Typography variant="body2" color="text.secondary">
        {label}…
      </Typography>
    </Stack>
  );
}

export function PageSkeleton() {
  return (
    <Stack spacing={2} sx={{ py: 2 }} aria-hidden>
      <Skeleton variant="rounded" height={48} width="45%" />
      <Skeleton variant="rounded" height={200} />
      <Skeleton variant="rounded" height={120} />
    </Stack>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  description,
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <Box
      role="alert"
      sx={{
        p: 3,
        border: '1px solid',
        borderColor: 'error.main',
        borderLeftWidth: 6,
        borderRadius: 2,
        bgcolor: 'background.paper',
      }}
    >
      <Typography variant="h6" gutterBottom>
        {title}
      </Typography>
      {description ? (
        <Typography variant="body2" color="text.secondary">
          {description}
        </Typography>
      ) : null}
      {action ? <Box sx={{ mt: 2 }}>{action}</Box> : null}
    </Box>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} aria-labelledby="confirm-dialog-title">
      <DialogTitle id="confirm-dialog-title">{title}</DialogTitle>
      <DialogContent>
        <DialogContentText component="div">{description}</DialogContentText>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy} color="inherit">
          {cancelLabel}
        </Button>
        <Button
          onClick={onConfirm}
          variant="contained"
          color={destructive ? 'error' : 'primary'}
          disabled={busy}
        >
          {busy ? 'Working…' : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

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
    <Stack
      direction="row"
      sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 2, py: 1.25 }}
    >
      <Box>
        <Typography variant="subtitle2">{label}</Typography>
        {description ? (
          <Typography variant="caption" color="text.secondary">
            {description}
          </Typography>
        ) : null}
      </Box>
      <Switch
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        slotProps={{ input: { 'aria-label': label } }}
      />
    </Stack>
  );
}
