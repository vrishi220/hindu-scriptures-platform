import { describe, expect, it } from "vitest";

import {
  getYouTubeEmbedUrl,
  inferDisplayNameFromUrl,
  inferMediaTypeFromUrl,
} from "./externalMedia";

describe("externalMedia", () => {
  it("infers media type from common file extensions", () => {
    expect(inferMediaTypeFromUrl("https://cdn.example.com/image.avif")).toBe("image");
    expect(inferMediaTypeFromUrl("https://cdn.example.com/audio.m4a")).toBe("audio");
    expect(inferMediaTypeFromUrl("https://cdn.example.com/video.webm")).toBe("video");
  });

  it("infers video type from known video hosts", () => {
    expect(inferMediaTypeFromUrl("https://youtu.be/abc123XYZ")).toBe("video");
    expect(inferMediaTypeFromUrl("https://www.youtube.com/watch?v=abc123XYZ")).toBe("video");
    expect(inferMediaTypeFromUrl("https://vimeo.com/123456")).toBe("video");
    expect(inferMediaTypeFromUrl("https://example.com/article")).toBe("link");
  });

  it("builds embed URLs for supported YouTube patterns", () => {
    expect(getYouTubeEmbedUrl("https://youtu.be/abc123XYZ")).toBe(
      "https://www.youtube.com/embed/abc123XYZ"
    );
    expect(getYouTubeEmbedUrl("https://www.youtube.com/watch?v=abc123XYZ")).toBe(
      "https://www.youtube.com/embed/abc123XYZ"
    );
    expect(getYouTubeEmbedUrl("https://www.youtube.com/shorts/abc123XYZ")).toBe(
      "https://www.youtube.com/embed/abc123XYZ"
    );
    expect(getYouTubeEmbedUrl("https://example.com/video")).toBeNull();
  });

  it("infers display names from host/path with platform fallbacks", () => {
    expect(inferDisplayNameFromUrl("https://www.youtube.com/watch?v=abc123XYZ")).toBe(
      "YouTube Video"
    );
    expect(inferDisplayNameFromUrl("https://vimeo.com/123456")).toBe("Vimeo Video");
    expect(inferDisplayNameFromUrl("https://cdn.example.com/folder/lesson%201.mp4")).toBe(
      "lesson 1.mp4"
    );
    expect(inferDisplayNameFromUrl("https://example.com/")).toBe("example.com");
    expect(inferDisplayNameFromUrl("not-a-url")).toBe("");
  });
});
