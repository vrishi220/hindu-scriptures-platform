import { cookies } from "next/headers";

const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8000";
const ACCESS_TOKEN_COOKIE = process.env.ACCESS_TOKEN_COOKIE || "access_token";

export const metadataApiUrl = (path: string) =>
  `${API_BASE_URL}/api/metadata${path.startsWith("/") ? path : `/${path}`}`;

export const buildAuthHeader = async (): Promise<Record<string, string>> => {
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
};
