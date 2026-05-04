import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8000";
const ACCESS_TOKEN_COOKIE = process.env.ACCESS_TOKEN_COOKIE || "access_token";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ bookId: string }> }
) {
  const { bookId } = await params;
  const store = await cookies();
  const target = new URL(`/api/content/books/${bookId}`, API_BASE_URL);

  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const headers: HeadersInit = {
    Accept: "application/json",
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  let response: Response;
  try {
    response = await fetch(target.toString(), {
      headers,
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { detail: "Book service unavailable. Please start the API server and try again." },
      { status: 503 }
    );
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(
      payload || { detail: "Book fetch failed" },
      { status: response.status }
    );
  }

  return NextResponse.json(payload);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ bookId: string }> }
) {
  const { bookId } = await params;
  const store = await cookies();
  const startTarget = new URL(
    `/api/content/books/${encodeURIComponent(bookId)}/delete-jobs`,
    API_BASE_URL
  );

  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const headers: HeadersInit = {
    Accept: "application/json",
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  let startResponse: Response;
  try {
    startResponse = await fetch(startTarget.toString(), {
      method: "POST",
      headers,
    });
  } catch {
    return NextResponse.json(
      {
        detail: "Book deletion request could not reach backend.",
      },
      { status: 502 }
    );
  }

  const startPayload = (await startResponse.json().catch(() => null)) as
    | { detail?: string; error?: string; job_id?: string }
    | null;
  if (!startResponse.ok) {
    return NextResponse.json(
      startPayload || { detail: "Book deletion failed" },
      { status: startResponse.status }
    );
  }

  const jobId = typeof startPayload?.job_id === "string" ? startPayload.job_id : "";
  if (!jobId) {
    return NextResponse.json(
      { detail: "Delete job start response missing job_id" },
      { status: 502 }
    );
  }

  // Short-poll to preserve old behavior for small books while avoiding long request timeouts.
  const maxAttempts = 6;
  const pollIntervalMs = 2000;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    const statusTarget = new URL(
      `/api/content/books/delete-jobs/${encodeURIComponent(jobId)}`,
      API_BASE_URL
    );

    let statusResponse: Response;
    try {
      statusResponse = await fetch(statusTarget.toString(), {
        method: "GET",
        headers,
        cache: "no-store",
      });
    } catch {
      return NextResponse.json(
        {
          detail: "Delete job status request could not reach backend",
          job_id: jobId,
        },
        { status: 502 }
      );
    }

    const statusPayload = (await statusResponse.json().catch(() => null)) as
      | {
          detail?: string;
          error?: string;
          status?: string;
          progress_message?: string;
          result?: { message?: string };
        }
      | null;

    if (!statusResponse.ok) {
      return NextResponse.json(
        statusPayload || { detail: "Delete job status failed", job_id: jobId },
        { status: statusResponse.status }
      );
    }

    const statusValue = (statusPayload?.status || "running").toLowerCase();
    if (statusValue === "failed") {
      return NextResponse.json(
        {
          detail: statusPayload?.error || statusPayload?.detail || "Book deletion failed",
          job_id: jobId,
        },
        { status: 500 }
      );
    }
    if (statusValue === "succeeded") {
      return NextResponse.json({
        message: statusPayload?.result?.message || "Deleted",
        job_id: jobId,
      });
    }
  }

  return NextResponse.json(
    {
      message: "Book deletion queued. Check again shortly.",
      job_id: jobId,
      status: "running",
    },
    { status: 202 }
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ bookId: string }> }
) {
  const { bookId } = await params;
  const store = await cookies();
  const target = new URL(`/api/content/books/${bookId}`, API_BASE_URL);

  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const headers: HeadersInit = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ detail: "Invalid request body" }, { status: 400 });
  }

  const response = await fetch(target.toString(), {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(
      payload || { detail: "Book update failed" },
      { status: response.status }
    );
  }

  return NextResponse.json(payload);
}
