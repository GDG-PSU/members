import type { Metadata, Viewport } from 'next';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter';
import InitColorSchemeScript from '@mui/material/InitColorSchemeScript';
import { Providers } from '@/components/providers';
import { AppHeader } from '@/components/app-header';
import { AppFooter } from '@/components/app-footer';
import { getViewer } from '@/lib/auth/viewer';
import { SITE_URL } from '@/lib/env';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'GDG@PSU Members',
    template: '%s · GDG@PSU',
  },
  description:
    'Member identity, event attendance and rewards for the Google Developer Group at Penn State.',
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f7fb' },
    { media: '(prefers-color-scheme: dark)', color: '#070c15' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer().catch(() => null);

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <InitColorSchemeScript attribute="class" defaultMode="system" />
        <AppRouterCacheProvider options={{ enableCssLayer: true }}>
          <Providers>
            <AppHeader
              displayName={viewer?.member?.displayName ?? null}
              isAdmin={viewer?.isAdmin ?? false}
              isSignedIn={Boolean(viewer?.user)}
            />
            {children}
            <AppFooter />
          </Providers>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
