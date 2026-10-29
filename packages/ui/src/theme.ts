import { createTheme, type ThemeOptions } from '@mui/material/styles';

declare module '@mui/material/styles' {
  interface Palette {
    star: Palette['primary'];
    accent: Palette['primary'];
    surfaceMuted: Palette['primary'];
  }
  interface PaletteOptions {
    star?: PaletteColorOptions;
    accent?: PaletteColorOptions;
    surfaceMuted?: PaletteColorOptions;
  }
}

type PaletteColorOptions = {
  main: string;
  contrastText?: string;
  light?: string;
  dark?: string;
};

const typography: ThemeOptions['typography'] = {
  fontFamily:
    '"Inter", "Segoe UI Variable", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif',
  h1: {
    fontSize: 'clamp(2.4rem, 6vw, 4.5rem)',
    fontWeight: 700,
    lineHeight: 1.02,
    letterSpacing: '-0.045em',
  },
  h2: {
    fontSize: 'clamp(1.9rem, 3.4vw, 2.8rem)',
    fontWeight: 700,
    lineHeight: 1.08,
    letterSpacing: '-0.035em',
  },
  h3: {
    fontSize: 'clamp(1.4rem, 2.2vw, 1.85rem)',
    fontWeight: 650,
    lineHeight: 1.15,
    letterSpacing: '-0.025em',
  },
  h4: { fontSize: '1.35rem', fontWeight: 650, letterSpacing: '-0.02em' },
  h5: { fontSize: '1.1rem', fontWeight: 650, letterSpacing: '-0.01em' },
  h6: { fontSize: '0.98rem', fontWeight: 650 },
  subtitle1: { fontSize: '1.02rem', lineHeight: 1.5 },
  subtitle2: { fontSize: '0.88rem', fontWeight: 600 },
  body1: { fontSize: '1rem', lineHeight: 1.6 },
  body2: { fontSize: '0.9rem', lineHeight: 1.6 },
  button: { fontWeight: 650, letterSpacing: '0.005em' },
  overline: { fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.16em', lineHeight: 1.6 },
  caption: { fontSize: '0.78rem', lineHeight: 1.5 },
};

const shared: ThemeOptions = {
  shape: { borderRadius: 16 },
  typography,
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        html: { WebkitFontSmoothing: 'antialiased', scrollBehavior: 'smooth' },
        '::selection': { background: 'rgba(37, 99, 235, 0.25)' },
        '*:focus-visible': {
          outline: '3px solid var(--mui-palette-primary-main)',
          outlineOffset: 2,
        },
        '@media (prefers-reduced-motion: reduce)': {
          '*': {
            animationDuration: '0.01ms !important',
            transitionDuration: '0.01ms !important',
            scrollBehavior: 'auto !important',
          },
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { textTransform: 'none', borderRadius: 999, paddingInline: 20, minHeight: 44 },
        sizeSmall: { minHeight: 36, paddingInline: 14 },
      },
    },
    MuiIconButton: { styleOverrides: { root: { borderRadius: 12 } } },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: { border: '1px solid var(--mui-palette-divider)', backgroundImage: 'none' },
      },
    },
    MuiPaper: { defaultProps: { elevation: 0 } },
    MuiChip: {
      styleOverrides: { root: { fontWeight: 600, borderRadius: 999 }, sizeSmall: { height: 24 } },
    },
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiTooltip: { defaultProps: { arrow: true } },
    MuiAppBar: { defaultProps: { elevation: 0, color: 'transparent' } },
    MuiDialog: { styleOverrides: { paper: { borderRadius: 20 } } },
    MuiTableCell: { styleOverrides: { head: { fontWeight: 700, whiteSpace: 'nowrap' } } },
    MuiAlert: { styleOverrides: { root: { borderRadius: 12 } } },
    MuiToggleButton: {
      styleOverrides: { root: { textTransform: 'none', fontWeight: 600, borderRadius: 999 } },
    },
  },
};

export const theme = createTheme({
  ...shared,
  cssVariables: { colorSchemeSelector: 'class' },
  colorSchemes: {
    light: {
      palette: {
        mode: 'light',
        primary: { main: '#1450a3', light: '#3d74d1', dark: '#0b3370', contrastText: '#ffffff' },
        secondary: { main: '#0f766e', contrastText: '#ffffff' },
        accent: { main: '#0b3370', contrastText: '#ffffff' },
        star: { main: '#a16207', light: '#d99e12', contrastText: '#ffffff' },
        surfaceMuted: { main: '#eef2f9', contrastText: '#0b1220' },
        background: { default: '#f5f7fb', paper: '#ffffff' },
        text: { primary: '#0b1220', secondary: '#4a5568' },
        divider: 'rgba(11, 18, 32, 0.10)',
        success: { main: '#147a4b' },
        warning: { main: '#9a5b00' },
        error: { main: '#b3261e' },
      },
    },
    dark: {
      palette: {
        mode: 'dark',
        primary: { main: '#9dbdff', light: '#c6d8ff', dark: '#6b94e8', contrastText: '#04122b' },
        secondary: { main: '#5eead4', contrastText: '#04211e' },
        accent: { main: '#9dbdff', contrastText: '#04122b' },
        star: { main: '#fbbf24', contrastText: '#2b1600' },
        surfaceMuted: { main: '#162032', contrastText: '#e8eefb' },
        background: { default: '#070c15', paper: '#0f1725' },
        text: { primary: '#f2f5fb', secondary: '#aab6c8' },
        divider: 'rgba(242, 245, 251, 0.12)',
        success: { main: '#6ee7b7' },
        warning: { main: '#fbbf24' },
        error: { main: '#fca5a5' },
      },
    },
  },
});

export const spacing = (factor: number) => theme.spacing(factor);
