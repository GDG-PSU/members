'use client';

import { useColorScheme } from '@mui/material/styles';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import DarkModeIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeIcon from '@mui/icons-material/LightModeOutlined';
import BrightnessAutoIcon from '@mui/icons-material/BrightnessAutoOutlined';
import Box from '@mui/material/Box';
import type { ReactNode } from 'react';

const options = [
  { value: 'system', label: 'System theme', icon: <BrightnessAutoIcon fontSize="small" /> },
  { value: 'light', label: 'Light theme', icon: <LightModeIcon fontSize="small" /> },
  { value: 'dark', label: 'Dark theme', icon: <DarkModeIcon fontSize="small" /> },
] as const;

export function ThemeModeToggle() {
  const { mode, setMode } = useColorScheme();

  return (
    <ToggleButtonGroup
      value={mode ?? 'system'}
      exclusive
      size="small"
      aria-label="Color theme"
      onChange={(_, next: 'system' | 'light' | 'dark' | null) => {
        if (next) setMode(next);
      }}
      sx={{
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 999,
        p: 0.25,
        '& .MuiToggleButton-root': { border: 0, px: 1.25, minWidth: 38, minHeight: 34 },
      }}
    >
      {options.map((option) => (
        <ToggleButton key={option.value} value={option.value} aria-label={option.label}>
          <Tooltip title={option.label}>{option.icon}</Tooltip>
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 0.25,
        fontWeight: 800,
        letterSpacing: '-0.03em',
      }}
      aria-label="GDG at Penn State"
    >
      <Box component="span" sx={{ fontSize: compact ? '1.05rem' : '1.15rem' }}>
        GDG
      </Box>
      <Box
        component="span"
        sx={{ color: 'primary.main', fontWeight: 500, fontSize: compact ? '0.95rem' : '1.02rem' }}
      >
        @PSU
      </Box>
    </Box>
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
  return (
    <Box
      sx={{
        display: 'flex',
        gap: 2,
        justifyContent: 'space-between',
        alignItems: { xs: 'flex-start', sm: 'flex-end' },
        flexDirection: { xs: 'column', sm: 'row' },
        mb: 3,
      }}
    >
      <Box sx={{ maxWidth: 640 }}>
        {eyebrow ? (
          <Box component="p" sx={{ m: 0, mb: 0.5, typography: 'overline', color: 'primary.main' }}>
            {eyebrow}
          </Box>
        ) : null}
        <Box component={headingLevel === 1 ? 'h1' : 'h2'} sx={{ m: 0, typography: 'h2' }}>
          {title}
        </Box>
        {description ? (
          <Box component="p" sx={{ m: 0, mt: 1, color: 'text.secondary', maxWidth: 560 }}>
            {description}
          </Box>
        ) : null}
      </Box>
      {action}
    </Box>
  );
}
