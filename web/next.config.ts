import type { NextConfig } from "next";

const utcTimestampBuildNumber = () => {
	const now = new Date();
	const year = now.getUTCFullYear();
	const month = String(now.getUTCMonth() + 1).padStart(2, "0");
	const day = String(now.getUTCDate()).padStart(2, "0");
	const hours = String(now.getUTCHours()).padStart(2, "0");
	const minutes = String(now.getUTCMinutes()).padStart(2, "0");
	const seconds = String(now.getUTCSeconds()).padStart(2, "0");
	return `${year}${month}${day}${hours}${minutes}${seconds}`;
};

const resolvedBuildNumber =
	process.env.NEXT_PUBLIC_BUILD_NUMBER ||
	process.env.GITHUB_RUN_NUMBER ||
	utcTimestampBuildNumber();

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
			process.env.APP_VERSION ||
			"0.1.0",
	},
};

export default nextConfig;
