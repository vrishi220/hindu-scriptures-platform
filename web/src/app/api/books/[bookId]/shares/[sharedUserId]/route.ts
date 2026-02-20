import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8000";
const ACCESS_TOKEN_COOKIE = process.env.ACCESS_TOKEN_COOKIE || "access_token";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ bookId: string; sharedUserId: string }> }
) {
  const { bookId, sharedUserId } = await params;
  const store = await cookies();
  const target = new URL(
    `/api/content/books/${bookId}/shares/${sharedUserId}`,
    API_BASE_URL
  );

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
      payload || { detail: "Book share update failed" },
      { status: response.status }
    );
  }

  return NextResponse.json(payload);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ bookId: string; sharedUserId: string }> }
) {
  const { bookId, sharedUserId } = await params;
  const store = await cookies();
  const target = new URL(
    `/api/content/books/${bookId}/shares/${sharedUserId}`,
    API_BASE_URL
  );

  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const headers: HeadersInit = {
    Accept: "application/json",
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await fetch(target.toString(), {
    method: "DELETE",
    headers,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(
      payload || { detail: "Book share deletion failed" },
      { status: response.status }
    );
  }

  return NextResponse.json(payload);
}
