import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	env: {
		NEXT_PUBLIC_BUILD_NUMBER:
			process.env.NEXT_PUBLIC_BUILD_NUMBER ||
			process.env.GITHUB_RUN_NUMBER ||
			"0",
		NEXT_PUBLIC_GIT_SHA:
			process.env.NEXT_PUBLIC_GIT_SHA ||
			process.env.VERCEL_GIT_COMMIT_SHA ||
			process.env.GITHUB_SHA ||
			"local",
		NEXT_PUBLIC_APP_VERSION:
			process.env.NEXT_PUBLIC_APP_VERSION ||
			process.env.APP_VERSION ||
			"0.1.0",
	},
};

export default nextConfig;
