import { beforeEach, describe, expect, it, vi } from "vitest";

let mockCookieStore: {
  get: (name: string) => { name: string; value: string } | undefined;
  set: ReturnType<typeof vi.fn>;
};

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => mockCookieStore),
}));

import { GET } from "./route";

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const createCookieStore = (initial: Record<string, string>) => {
  const jar = new Map<string, string>(Object.entries(initial));

  return {
    get(name: string) {
      const value = jar.get(name);
      return value ? { name, value } : undefined;
    },
    set: vi.fn((name: string, value: string) => {
      jar.set(name, value);
    }),
  };
};

describe("daily-verse route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn() as unknown as typeof fetch;
  });

  it("refreshes token on 401 and retries successfully", async () => {
    mockCookieStore = createCookieStore({
      access_token: "expired-access",
      refresh_token: "valid-refresh",
    });

    const dailyVersePayload = {
      id: 101,
      title: "1.1.1",
      content: "Test verse",
      book_name: "Test Book",
      book_id: 1,
    };

    (global.fetch as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(jsonResponse({ detail: "Invalid token" }, 401))
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "new-access",
          refresh_token: "new-refresh",
        })
      )
      .mockResolvedValueOnce(jsonResponse(dailyVersePayload, 200));

    const response = await GET(new Request("http://localhost/api/daily-verse?mode=daily"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual(dailyVersePayload);
    expect(global.fetch).toHaveBeenCalledTimes(3);

    const firstCall = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(firstCall[0]).toContain("/api/content/daily-verse?mode=daily");
    expect(firstCall[1]?.headers?.Authorization).toBe("Bearer expired-access");

    const secondCall = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(secondCall[0]).toContain("/api/auth/refresh");

    const thirdCall = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[2];
    expect(thirdCall[0]).toContain("/api/content/daily-verse?mode=daily");
    expect(thirdCall[1]?.headers?.Authorization).toBe("Bearer new-access");

    const setCookieHeader = response.headers.get("set-cookie") || "";
    expect(setCookieHeader).toContain("access_token=new-access");
    expect(setCookieHeader).toContain("refresh_token=new-refresh");
  });

  it("falls back to anonymous fetch when refresh fails", async () => {
    mockCookieStore = createCookieStore({
      access_token: "expired-access",
      refresh_token: "expired-refresh",
    });

    const anonymousPayload = {
      id: 202,
      title: "2.2.2",
      content: "Anonymous verse",
      book_name: "Fallback Book",
      book_id: 2,
    };

    (global.fetch as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(jsonResponse({ detail: "Invalid token" }, 401))
      .mockResolvedValueOnce(jsonResponse({ detail: "Invalid refresh" }, 401))
      .mockResolvedValueOnce(jsonResponse(anonymousPayload, 200));

    const response = await GET(new Request("http://localhost/api/daily-verse?mode=random"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual(anonymousPayload);
    expect(global.fetch).toHaveBeenCalledTimes(3);

    const thirdCall = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[2];
    expect(thirdCall[0]).toContain("/api/content/daily-verse?mode=random");
    expect(thirdCall[1]?.headers?.Authorization).toBeUndefined();

    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
