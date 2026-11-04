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
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=(), usb=(), serial=(self)',
      },
      {
        key: 'Content-Security-Policy',
        value: [
          "default-src 'self'",
          "img-src 'self' data: blob:",
          `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ''}`,
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' data: https://fonts.gstatic.com",
          `connect-src 'self'${isDevelopment ? ' ws:' : ''}`,
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
