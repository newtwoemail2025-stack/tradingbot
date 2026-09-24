/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  async rewrites() {
    return [
      {
        source: '/socket.io/:path*',
        destination: 'https://stream.coindcx.com/socket.io/:path*',
      },
    ];
  },
};

export default nextConfig;
