import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MediaBankClientError,
  createMediaBankLinkAsset,
  listMediaBankAssets,
} from "./mediaBankClient";

describe("mediaBankClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes listed media assets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            {
              id: 7,
              media_type: "image",
              url: "https://cdn.example.com/a.jpg",
              metadata_json: { display_name: "Sample" },
            },
          ]),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );

    const assets = await listMediaBankAssets();

    expect(assets).toEqual([
      {
        id: 7,
        media_type: "image",
        url: "https://cdn.example.com/a.jpg",
        metadata_json: { display_name: "Sample" },
      },
    ]);
  });

  it("surfaces nested API detail errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            detail: [{ msg: "URL is required" }, { msg: "Invalid host" }],
          }),
          {
            status: 422,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );

    await expect(createMediaBankLinkAsset({ url: "" })).rejects.toMatchObject({
      name: "MediaBankClientError",
      status: 422,
      message: "URL is required; Invalid host",
    } satisfies Partial<MediaBankClientError>);
  });

  it("returns fallback error when response payload is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("Service unavailable", {
          status: 503,
          headers: { "content-type": "text/plain" },
        })
      )
    );

    await expect(listMediaBankAssets()).rejects.toMatchObject({
      name: "MediaBankClientError",
      status: 503,
      message: "Failed to load media repo",
    } satisfies Partial<MediaBankClientError>);
  });
});
