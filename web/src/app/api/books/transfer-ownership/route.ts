import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_BASE_URL, ACCESS_TOKEN_COOKIE, buildAuthHeader } from "@/lib/apiProxy";


export async function POST(request: Request) {
  const store = await cookies();
  const target = new URL("/api/content/books/ownership/transfer", API_BASE_URL);

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
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(
      payload || { detail: "Book ownership transfer failed" },
      { status: response.status }
    );
  }

  return NextResponse.json(payload);
}
