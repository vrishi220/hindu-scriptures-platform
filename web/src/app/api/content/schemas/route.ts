import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_BASE_URL, ACCESS_TOKEN_COOKIE, buildAuthHeader } from "@/lib/apiProxy";


export async function GET() {
  const store = await cookies();
  const target = new URL("/api/content/schemas", API_BASE_URL);

  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const authHeader: Record<string, string> = accessToken
    ? { Authorization: `Bearer ${accessToken}` }
    : {};

  const response = await fetch(target.toString(), {
    headers: {
      Accept: "application/json",
      ...authHeader,
    },
    cache: "no-store",
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(
      payload || { detail: "Schemas fetch failed" },
      { status: response.status }
    );
  }

  return NextResponse.json(payload);
}

export async function POST(request: Request) {
  const store = await cookies();
  const target = new URL("/api/content/schemas", API_BASE_URL);

  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const authHeader: Record<string, string> = accessToken
    ? { Authorization: `Bearer ${accessToken}` }
    : {};
  const body = await request.json().catch(() => null);

  const response = await fetch(target.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...authHeader,
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(
      payload || { detail: "Schema creation failed" },
      { status: response.status }
    );
  }

  return NextResponse.json(payload, { status: 201 });
}
