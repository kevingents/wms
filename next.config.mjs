/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    // `tsc --noEmit` bewaakt de correctheid; lint blokkeert de build niet.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
