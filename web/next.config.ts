import type { NextConfig } from "next";

const packageVersion = require("./package.json").version as string;

const resolvedBuildNumber =
	process.env.NEXT_PUBLIC_BUILD_NUMBER ||
	process.env.GITHUB_RUN_NUMBER ||
	"0";

if (process.env.NODE_ENV === "production") {
	if (!resolvedBuildNumber || !/^\d+$/.test(resolvedBuildNumber)) {
		throw new Error(
			"NEXT_PUBLIC_BUILD_NUMBER (or GITHUB_RUN_NUMBER) must be a numeric value for production builds.",
		);
	}
}

const nextConfig: NextConfig = {
	env: {
		NEXT_PUBLIC_BUILD_NUMBER: resolvedBuildNumber,
		NEXT_PUBLIC_GIT_SHA:
			process.env.NEXT_PUBLIC_GIT_SHA ||
			process.env.VERCEL_GIT_COMMIT_SHA ||
			process.env.GITHUB_SHA ||
			"local",
		NEXT_PUBLIC_APP_VERSION:
			process.env.NEXT_PUBLIC_APP_VERSION ||
			packageVersion ||
			"0.1.0",
	},
};

export default nextConfig;
