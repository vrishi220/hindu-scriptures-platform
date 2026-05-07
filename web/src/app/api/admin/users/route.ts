import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_BASE_URL, ACCESS_TOKEN_COOKIE } from "@/lib/apiProxy";


const buildAuthHeader = async (): Promise<Record<string, string>> => {
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
};

export async function GET() {
  const authHeader = await buildAuthHeader();
  const response = await fetch(`${API_BASE_URL}/api/users`, {
    headers: {
      Accept: "application/json",
      ...authHeader,
    },
    cache: "no-store",
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(
      payload || { detail: "Failed to load users" },
      { status: response.status }
    );
  }

  return NextResponse.json(payload);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const authHeader = await buildAuthHeader();

  const response = await fetch(`${API_BASE_URL}/api/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeader,
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(
      payload || { detail: "Failed to create user" },
      { status: response.status }
    );
  }

  return NextResponse.json(payload);
}
