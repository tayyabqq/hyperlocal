// Vercel does its own serverless bundling/tracing; `output: 'standalone'` and a
// manual outputFileTracingRoot are for the self-hosted Docker image only
// (apps/web/Dockerfile) and are skipped when building on Vercel (which sets
// this env var automatically) to avoid interfering with its build.
const isVercel = !!process.env.VERCEL;

/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  transpilePackages: ['@hl/shared'],
  poweredByHeader: false,
  ...(isVercel
    ? {}
    : {
        // Emits a self-contained server bundle so the Docker image ships only
        // what it needs to run, not the whole node_modules tree.
        output: 'standalone',
        experimental: {
          // The monorepo root, so standalone tracing picks up hoisted deps
          // correctly. (Top-level in Next 15; still under `experimental` in
          // the 14.2 line here.)
          outputFileTracingRoot: require('path').join(__dirname, '../../'),
        },
      }),
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(), microphone=()' },
        ],
      },
    ];
  },
};
