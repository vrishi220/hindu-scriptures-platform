import { describe, expect, it } from "vitest";

import { appendMediaVersion, resolveMediaUrl, resolveMediaUrlWithMetadataVersion } from "./mediaUrl";

describe("resolveMediaUrl", () => {
  it("rewrites /media paths to frontend proxy", () => {
    expect(resolveMediaUrl("/media/bank/image.jpeg")).toBe("/api/media/bank/image.jpeg");
  });

  it("rewrites media paths without leading slash", () => {
    expect(resolveMediaUrl("media/bank/image.jpeg")).toBe("/api/media/bank/image.jpeg");
  });

  it("keeps /api/media paths unchanged", () => {
    expect(resolveMediaUrl("/api/media/bank/image.jpeg")).toBe("/api/media/bank/image.jpeg");
  });

  it("rewrites absolute backend media URLs to frontend proxy", () => {
    expect(resolveMediaUrl("http://127.0.0.1:8000/media/bank/image.jpeg")).toBe(
      "/api/media/bank/image.jpeg"
    );
  });

  it("keeps external non-media URLs unchanged", () => {
    const url = "https://example.com/cdn/image.jpeg";
    expect(resolveMediaUrl(url)).toBe(url);
  });

  it("appends a v query parameter for cache busting", () => {
    expect(appendMediaVersion("/api/media/bank/image.jpeg", "2026-04-20T15:33:04.031233+00:00")).toBe(
      "/api/media/bank/image.jpeg?v=2026-04-20T15%3A33%3A04.031233%2B00%3A00"
    );
  });

  it("replaces existing v query parameter", () => {
    expect(appendMediaVersion("/api/media/bank/image.jpeg?v=old", "new")).toBe(
      "/api/media/bank/image.jpeg?v=new"
    );
  });

  it("resolves media URL with metadata version preference", () => {
    expect(
      resolveMediaUrlWithMetadataVersion("/media/bank/image.jpeg", {
        replaced_at: "2026-04-20T15:33:04.031233+00:00",
        size_bytes: 1234,
      })
    ).toBe("/api/media/bank/image.jpeg?v=2026-04-20T15%3A33%3A04.031233%2B00%3A00");
  });
});
