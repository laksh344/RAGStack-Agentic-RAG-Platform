/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Hide the Next.js dev-tools indicator (the floating "N" button). It is a
  // dev-only Next.js overlay, never part of the app or shown in production.
  devIndicators: false,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
