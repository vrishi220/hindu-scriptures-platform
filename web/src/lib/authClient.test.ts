import { beforeEach, describe, expect, it, vi } from "vitest";

import { getMe, invalidateMeCache } from "./authClient";

describe("authClient", () => {
  beforeEach(() => {
    invalidateMeCache();
    vi.restoreAllMocks();
  });

  it("caches successful me responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 1, email: "a@example.com" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = await getMe();
    const second = await getMe();

    expect(first?.id).toBe(1);
    expect(second?.id).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bypasses cache with force option", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 1 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 2 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const first = await getMe();
    const second = await getMe({ force: true });

    expect(first?.id).toBe(1);
    expect(second?.id).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns null for non-ok responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getMe({ force: true })).resolves.toBeNull();
  });
});