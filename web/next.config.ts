import type { NextConfig } from "next";

const deriveNumericBuildFromSha = (sha?: string) => {
	if (!sha || sha.length < 8) return undefined;
	const parsed = Number.parseInt(sha.slice(0, 8), 16);
	if (Number.isNaN(parsed)) return undefined;
	return String(parsed);
};

const resolvedBuildNumber =
	process.env.NEXT_PUBLIC_BUILD_NUMBER ||
	process.env.GITHUB_RUN_NUMBER ||
	deriveNumericBuildFromSha(process.env.VERCEL_GIT_COMMIT_SHA);

if (process.env.NODE_ENV === "production") {
	if (!resolvedBuildNumber || !/^\d+$/.test(resolvedBuildNumber)) {
		throw new Error(
			"NEXT_PUBLIC_BUILD_NUMBER (or GITHUB_RUN_NUMBER) must be a numeric value for production builds.",
		);
	}
}

const nextConfig: NextConfig = {
	env: {
		NEXT_PUBLIC_BUILD_NUMBER:
			resolvedBuildNumber ||
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
