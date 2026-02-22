export type MeResponse = {
  id?: number;
  email?: string;
  role?: string;
  permissions?: {
    can_admin?: boolean;
    can_contribute?: boolean;
    can_edit?: boolean;
  } | null;
};

const AUTH_CACHE_TTL_MS = 10_000;
const UNAUTH_CACHE_TTL_MS = 1_000;
const DEBUG_AUTH = process.env.NEXT_PUBLIC_AUTH_DEBUG === "1";

let cachedMe: MeResponse | null | undefined;
let cachedAt = 0;
let inFlight: Promise<MeResponse | null> | null = null;

const debugLog = (...parts: unknown[]) => {
  if (!DEBUG_AUTH) return;
  console.debug("[authClient]", ...parts);
};

export const invalidateMeCache = () => {
  cachedMe = undefined;
  cachedAt = 0;
  debugLog("cache invalidated");
};

export const getMe = async (options?: { force?: boolean }): Promise<MeResponse | null> => {
  const force = Boolean(options?.force);
  const cacheTtlMs = cachedMe === null ? UNAUTH_CACHE_TTL_MS : AUTH_CACHE_TTL_MS;

  if (!force && cachedMe !== undefined && Date.now() - cachedAt < cacheTtlMs) {
    debugLog("cache hit", { ageMs: Date.now() - cachedAt });
    return cachedMe;
  }

  if (inFlight) {
    debugLog("reusing in-flight request");
    return inFlight;
  }

  debugLog(force ? "force network fetch" : "cache miss, network fetch");

  inFlight = (async () => {
    try {
      const response = await fetch("/api/me", { credentials: "include" });
      if (!response.ok) {
        debugLog("network response not ok", { status: response.status });
        return null;
      }
      debugLog("network response ok");
      return (await response.json()) as MeResponse;
    } catch {
      debugLog("network error");
      return null;
    }
  })();

  const result = await inFlight;
  inFlight = null;
  cachedMe = result;
  cachedAt = Date.now();
  return result;
};
