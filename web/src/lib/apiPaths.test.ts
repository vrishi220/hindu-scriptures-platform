import { describe, expect, it } from "vitest";

import { apiPath, contentPath } from "./apiPaths";

describe("apiPaths", () => {
  it("prefixes relative api paths", () => {
    expect(apiPath("me")).toBe("/api/me");
    expect(contentPath("books")).toBe("/api/content/books");
  });

  it("preserves absolute-style segment formatting", () => {
    expect(apiPath("/auth/login")).toBe("/api/auth/login");
    expect(contentPath("/nodes/12")).toBe("/api/content/nodes/12");
  });
});