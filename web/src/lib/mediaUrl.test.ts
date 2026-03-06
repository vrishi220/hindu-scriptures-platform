import { describe, expect, it } from "vitest";

import { resolveMediaUrl } from "./mediaUrl";

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
});
