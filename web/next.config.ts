import type { NextConfig } from "next";
import packageJson from "./package.json";

const packageVersion = packageJson.version as string;

const sanitizeSha = (value?: string) => (value || "").trim().replace(/['"]/g, "");

const deriveBuildNumberFromSha = (shaValue?: string) => {
	const normalized = sanitizeSha(shaValue);
	if (!/^[0-9a-fA-F]{7,}$/.test(normalized)) {
		return "";
	}
	return parseInt(normalized.slice(0, 8), 16).toString();
};

const resolvedGitSha =
	sanitizeSha(process.env.NEXT_PUBLIC_GIT_SHA) ||
	sanitizeSha(process.env.VERCEL_GIT_COMMIT_SHA) ||
	sanitizeSha(process.env.GITHUB_SHA) ||
	"local";

const resolvedBuildNumber =
	process.env.NEXT_PUBLIC_BUILD_NUMBER ||
	process.env.GITHUB_RUN_NUMBER ||
	deriveBuildNumberFromSha(resolvedGitSha) ||
	"1";

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
		NEXT_PUBLIC_GIT_SHA: resolvedGitSha,
		NEXT_PUBLIC_APP_VERSION:
			process.env.NEXT_PUBLIC_APP_VERSION ||
			packageVersion ||
			"0.1.0",
	},
};

export default nextConfig;
