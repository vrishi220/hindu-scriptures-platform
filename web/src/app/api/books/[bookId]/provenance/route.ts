import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_BASE_URL, ACCESS_TOKEN_COOKIE, buildAuthHeader } from "@/lib/apiProxy";


export async function GET(
  _request: Request,
  { params }: { params: Promise<{ bookId: string }> }
) {
  const { bookId } = await params;
  const store = await cookies();
  const target = new URL(`/api/content/books/${bookId}/provenance`, API_BASE_URL);

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
      { detail: "Content service unavailable. Please start the API server and try again." },
      { status: 503 }
    );
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(
      payload || { detail: "Provenance fetch failed" },
      { status: response.status }
    );
  }

  return NextResponse.json(payload ?? []);
}
