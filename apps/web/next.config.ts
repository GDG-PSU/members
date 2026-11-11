import type { NextConfig } from 'next';

// React's development tooling needs eval and a websocket; a production build
// needs neither. Photos are served from this origin and the browser never talks
// to Supabase directly, so no Supabase origin is allowed here.
const isDevelopment = process.env.NODE_ENV === 'development';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@gdg/ui', '@gdg/contracts'],
  experimental: {
    optimizePackageImports: ['lucide-react'],
    serverActions: {
      // Profile photos may be 2 MB, plus multipart overhead and the other fields.
      bodySizeLimit: '3mb',
    },
  },
  async headers() {
    const securityHeaders = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
      {
        // The kiosk scans a member's QR code with the camera. It is allowed
        // site-wide because the policy is fixed when a page first loads, and the
        // kiosk is usually reached by an in-app navigation from another page.
        key: 'Permissions-Policy',
        value: 'camera=(self), microphone=(), geolocation=(), usb=(), serial=(self)',
      },
      {
        key: 'Content-Security-Policy',
        value: [
          "default-src 'self'",
          "img-src 'self' data: blob:",
          `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ''}`,
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' data: https://fonts.gstatic.com",
          `connect-src 'self'${isDevelopment ? ' ws:' : ''} https://vitals.vercel-insights.com`,
          "object-src 'none'",
          "frame-ancestors 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join('; '),
      },
    ];
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

export default nextConfig;
