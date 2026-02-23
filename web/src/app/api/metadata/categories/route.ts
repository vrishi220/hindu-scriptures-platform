import { NextResponse } from "next/server";
import { buildAuthHeader, metadataApiUrl } from "../utils";

export async function GET() {
  const authHeader = await buildAuthHeader();
  const response = await fetch(metadataApiUrl("/categories"), {
    headers: {
      Accept: "application/json",
      ...authHeader,
    },
    cache: "no-store",
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(payload || { detail: "Failed to load categories" }, {
      status: response.status,
    });
  }

  return NextResponse.json(payload);
}

export async function POST(request: Request) {
  const authHeader = await buildAuthHeader();
  const body = await request.json().catch(() => null);

  const response = await fetch(metadataApiUrl("/categories"), {
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
    return NextResponse.json(payload || { detail: "Failed to create category" }, {
      status: response.status,
    });
  }

  return NextResponse.json(payload, { status: 201 });
}
