import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { ACCESS_TOKEN_COOKIE, API_BASE_URL } from "@/lib/apiProxy";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bookId: string }> }
) {
  const { bookId } = await params;
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;

  const target = new URL(
    `/api/content/books/${bookId}/verses`,
    API_BASE_URL
  );
  const incoming = new URL(request.url);
  incoming.searchParams.forEach((value, key) => {
    target.searchParams.set(key, value);
  });

  let response: Response;
  try {
    response = await fetch(target.toString(), {
      headers: {
        Accept: "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { detail: "Verse service unavailable." },
      { status: 503 }
    );
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(
      payload || { detail: "Verse fetch failed" },
      { status: response.status }
    );
  }
  return NextResponse.json(payload);
}
