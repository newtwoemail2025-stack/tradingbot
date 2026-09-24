/** @type {import('next').NextConfig} */
const nextConfig = {
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
