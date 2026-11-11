import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { AppHeader } from '@/components/app-header';
import { AppFooter } from '@/components/app-footer';
import { getViewer } from '@/lib/auth/viewer';
import { SITE_URL } from '@/lib/env';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: 'MemberPass',
  title: {
    default: 'MemberPass',
    template: '%s · MemberPass',
  },
  description:
    'The GDG@PSU member pass: your profile, event attendance, points and rewards in one place.',
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#161616' },
  ],
};

const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-plex',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
});

const themeScript = `(function(){try{var m=localStorage.getItem('memberpass-theme')||'system';var d=m==='dark'||(m==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer().catch(() => null);

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${plexSans.variable} ${plexMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <AppHeader
          displayName={viewer?.profile?.displayName ?? viewer?.member?.displayName ?? null}
          isMember={Boolean(viewer?.member)}
          isAdmin={viewer?.isAdmin ?? false}
          isSignedIn={Boolean(viewer?.user)}
        />
        {children}
        <AppFooter />
        <Analytics />
      </body>
    </html>
  );
}
