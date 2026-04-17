import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8000";
const ACCESS_TOKEN_COOKIE = process.env.ACCESS_TOKEN_COOKIE || "access_token";
const REFRESH_TOKEN_COOKIE = process.env.REFRESH_TOKEN_COOKIE || "refresh_token";
const ENABLE_BROWSER_RENDERED_PDF = false;
const BACKEND_UNAVAILABLE = "Auth/content service unavailable. Please try again shortly.";
const SNAPSHOT_PDF_CACHE = new Map<string, Uint8Array>();

const buildAuthHeader = (token?: string): Record<string, string> =>
  token ? { Authorization: `Bearer ${token}` } : {};

const refreshAccessToken = async (refreshToken: string) => {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  return (await response.json().catch(() => null)) as
    | { access_token: string; refresh_token: string }
    | null;
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

type SnapshotRenderBlock = {
  order: number;
  title: string;
  template_key: string;
  source_node_id: number | null;
  content: Record<string, unknown>;
};

type SnapshotRenderArtifact = {
  draft_book_id: number;
  sections: {
    front: SnapshotRenderBlock[];
    body: SnapshotRenderBlock[];
    back: SnapshotRenderBlock[];
  };
  render_settings: {
    show_sanskrit: boolean;
    show_transliteration: boolean;
    show_english: boolean;
    show_metadata: boolean;
    text_order: Array<"sanskrit" | "transliteration" | "english" | "text">;
  };
  template_metadata?: {
    template_family: string;
    template_version: string;
    block_template_pattern: string;
    renderer: string;
    output_profile: string;
  };
};

type EditionSnapshot = {
  id: number;
  version: number;
  created_at: string;
};

const labelForKey = (key: string): string => {
  if (key === "sanskrit") return "Sanskrit";
  if (key === "transliteration") return "Transliteration";
  if (key === "english") return "English";
  return "Text";
};

const buildHtml = (
  snapshot: EditionSnapshot,
  artifact: SnapshotRenderArtifact,
  draftTitle: string
) => {
  const renderSettings = artifact.render_settings || {
    show_sanskrit: true,
    show_transliteration: true,
    show_english: true,
    show_metadata: true,
    text_order: ["sanskrit", "transliteration", "english", "text"],
  };
  const templateMetadata = artifact.template_metadata;

  const shouldShow = (key: string): boolean => {
    if (key === "sanskrit") return renderSettings.show_sanskrit;
    if (key === "transliteration") return renderSettings.show_transliteration;
    if (key === "english") return renderSettings.show_english;
    return true;
  };

  const sectionOrder: Array<"front" | "body" | "back"> = ["front", "body", "back"];
  const sectionHtml = sectionOrder
    .map((section) => {
      const blocks = artifact.sections?.[section] || [];
      const sectionLabel = section[0].toUpperCase() + section.slice(1);

      const blockHtml =
        blocks.length === 0
          ? `<p class=\"muted\">No items in this section.</p>`
          : blocks
              .map((block) => {
                const content = (block.content || {}) as Record<string, unknown>;
                const lines = (renderSettings.text_order || ["sanskrit", "transliteration", "english", "text"])
                  .filter((key) => shouldShow(key))
                  .map((key) => {
                    const raw = content[key];
                    const value = typeof raw === "string" ? raw.trim() : "";
                    if (!value) return "";
                    const lineClass = key === "sanskrit" ? "line sanskrit" : "line";
                    return `<div class=\"${lineClass}\"><strong>${labelForKey(key)}:</strong> ${escapeHtml(value)}</div>`;
                  })
                  .filter(Boolean)
                  .join("");

                const metadata = renderSettings.show_metadata
                  ? `<div class=\"meta\">template=${escapeHtml(block.template_key)}${
                      typeof block.source_node_id === "number" ? ` • source_node=${block.source_node_id}` : ""
                    }</div>`
                  : "";

                return `
                  <div class=\"block\">
                    <h3>${block.order}. ${escapeHtml(block.title)}</h3>
                    ${lines}
                    ${metadata}
                  </div>
                `;
              })
              .join("");

      return `
        <section>
          <h2>${sectionLabel} (${blocks.length})</h2>
          ${blockHtml}
        </section>
      `;
    })
    .join("");

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset=\"utf-8\" />
        <style>
          @page { size: A4; margin: 22mm 16mm; }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans Devanagari", "Devanagari Sangam MN", sans-serif; color: #111; }
          h1 { font-size: 24px; margin: 0 0 6px 0; }
          h2 { font-size: 20px; margin: 22px 0 10px; }
          h3 { font-size: 16px; margin: 0 0 8px; }
          .meta-top { margin-bottom: 16px; color: #333; }
          .block { border: 1px solid #ddd; border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; break-inside: avoid; }
          .line { font-size: 14px; line-height: 1.55; margin-top: 4px; white-space: pre-wrap; }
          .line.sanskrit { font-family: "Noto Sans Devanagari", "Devanagari Sangam MN", "Devanagari MT", sans-serif; font-size: 18px; line-height: 1.75; }
          .meta { margin-top: 8px; color: #555; font-size: 12px; }
          .muted { color: #666; }
        </style>
      </head>
      <body>
        <h1>Edition Snapshot Export — ${escapeHtml(draftTitle)}</h1>
        <div class="meta-top">Version: v${snapshot.version}<br/>Snapshot ID: ${snapshot.id}<br/>Created At: ${escapeHtml(snapshot.created_at)}${
          templateMetadata
            ? `<br/>Template: ${escapeHtml(templateMetadata.template_family)}.${escapeHtml(templateMetadata.template_version)} (${escapeHtml(templateMetadata.output_profile)})`
            : ""
        }</div>
        ${sectionHtml}
      </body>
    </html>
  `;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = store.get(REFRESH_TOKEN_COOKIE)?.value;

  const doGetPdf = (token?: string) =>
    fetch(`${API_BASE_URL}/api/edition-snapshots/${id}/export/pdf`, {
      headers: {
        Accept: "application/pdf",
        ...buildAuthHeader(token),
      },
      cache: "no-store",
    });

  const doGetJson = (path: string, token?: string) =>
    fetch(`${API_BASE_URL}${path}`, {
      headers: {
        Accept: "application/json",
        ...buildAuthHeader(token),
      },
      cache: "no-store",
    });

  let response: Response;
  try {
    response = await doGetPdf(accessToken);
  } catch {
    return NextResponse.json({ detail: BACKEND_UNAVAILABLE }, { status: 503 });
  }

  if (response.status === 401 && refreshToken) {
    const newTokens = await refreshAccessToken(refreshToken);
    if (newTokens) {
      const { access_token, refresh_token } = newTokens;
      store.set(ACCESS_TOKEN_COOKIE, access_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
      });
      store.set(REFRESH_TOKEN_COOKIE, refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
      });

      try {
        response = await doGetPdf(access_token);
      } catch {
        return NextResponse.json({ detail: BACKEND_UNAVAILABLE }, { status: 503 });
      }
    }
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    return NextResponse.json(payload || { detail: "Failed to export snapshot PDF" }, { status: response.status });
  }

  const cachedPdf = SNAPSHOT_PDF_CACHE.get(id);
  if (cachedPdf) {
    return new NextResponse(new Uint8Array(cachedPdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="edition-${id}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // Browser-rendered PDF can produce inconsistent mobile output on some viewers.
  // Prefer backend-generated PDF bytes by default.
  if (ENABLE_BROWSER_RENDERED_PDF) {
    try {
    const tokenForJson = store.get(ACCESS_TOKEN_COOKIE)?.value || accessToken;
    const [snapshotResp, artifactResp] = await Promise.all([
      doGetJson(`/api/edition-snapshots/${id}`, tokenForJson),
      doGetJson(`/api/edition-snapshots/${id}/render-artifact`, tokenForJson),
    ]);

    if (snapshotResp.ok && artifactResp.ok) {
      const snapshot = (await snapshotResp.json()) as EditionSnapshot;
      const artifact = (await artifactResp.json()) as SnapshotRenderArtifact;
      const html = buildHtml(snapshot, artifact, `Draft ${artifact.draft_book_id}`);

      const pw = await import("@playwright/test");
      const browser = await pw.chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "networkidle" });
        const pdfBuffer = await page.pdf({ format: "A4", printBackground: true });
        const pdfBytes = new Uint8Array(pdfBuffer);
        SNAPSHOT_PDF_CACHE.set(id, pdfBytes);

        return new NextResponse(new Uint8Array(pdfBytes), {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `inline; filename="edition-${id}.pdf"`,
            "Cache-Control": "no-store",
          },
        });
      } finally {
        await browser.close();
      }
    }
    } catch {
      // Fall through to backend-generated PDF.
    }
  }

  const arrayBuffer = await response.arrayBuffer();
  const pdfBytes = new Uint8Array(arrayBuffer);
  SNAPSHOT_PDF_CACHE.set(id, pdfBytes);
  const contentDisposition = response.headers.get("content-disposition") || `inline; filename="edition-${id}.pdf"`;

  return new NextResponse(new Uint8Array(pdfBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition,
      "Cache-Control": "no-store",
    },
  });
}
