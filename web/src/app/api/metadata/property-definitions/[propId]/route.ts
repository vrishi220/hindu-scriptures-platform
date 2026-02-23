import { NextRequest, NextResponse } from "next/server";
import { buildAuthHeader, metadataApiUrl } from "../../utils";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ propId: string }> }
) {
  const authHeader = await buildAuthHeader();
  const body = await request.json().catch(() => null);
  const { propId } = await params;

  const response = await fetch(metadataApiUrl(`/property-definitions/${propId}`), {
    method: "PATCH",
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
      payload || { detail: "Failed to update property definition" },
      { status: response.status }
    );
  }

  return NextResponse.json(payload);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ propId: string }> }
) {
  const authHeader = await buildAuthHeader();
  const { propId } = await params;

  const response = await fetch(metadataApiUrl(`/property-definitions/${propId}`), {
    method: "DELETE",
    headers: {
      Accept: "application/json",
      ...authHeader,
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(
      payload || { detail: "Failed to delete property definition" },
      { status: response.status }
    );
  }

  return NextResponse.json(payload || { message: "Deleted" });
}
