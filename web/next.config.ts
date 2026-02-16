import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	async rewrites() {
		return [
			{
				source: "/api/users/me",
				destination: "/api/me",
			},
		];
	},
};

export default nextConfig;
