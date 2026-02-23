import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8000";
const ACCESS_TOKEN_COOKIE = process.env.ACCESS_TOKEN_COOKIE || "access_token";

const buildAuthHeader = (token?: string): Record<string, string> =>
  token ? { Authorization: `Bearer ${token}` } : {};

const forward = async (
  bookId: string,
  nodeId: string,
  method: "GET" | "POST" | "PATCH",
  body?: unknown
) => {
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;

  const response = await fetch(`${API_BASE_URL}/api/metadata/books/${bookId}/nodes/${nodeId}/metadata-binding`, {
    method,
    headers: {
      Accept: "application/json",
      ...(method !== "GET" ? { "Content-Type": "application/json" } : {}),
      ...buildAuthHeader(accessToken),
    },
    ...(method !== "GET" ? { body: JSON.stringify(body || {}) } : {}),
    cache: "no-store",
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(
      payload || { detail: `Failed to ${method.toLowerCase()} node metadata binding` },
      { status: response.status }
    );
  }

  return NextResponse.json(payload);
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ bookId: string; nodeId: string }> }
) {
  const { bookId, nodeId } = await params;
  return forward(bookId, nodeId, "GET");
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ bookId: string; nodeId: string }> }
) {
  const { bookId, nodeId } = await params;
  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ detail: "Invalid request body" }, { status: 400 });
  }
  return forward(bookId, nodeId, "POST", body);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ bookId: string; nodeId: string }> }
) {
  const { bookId, nodeId } = await params;
  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ detail: "Invalid request body" }, { status: 400 });
  }
  return forward(bookId, nodeId, "PATCH", body);
}
