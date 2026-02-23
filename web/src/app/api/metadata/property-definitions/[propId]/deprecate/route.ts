import { NextRequest, NextResponse } from "next/server";
import { buildAuthHeader, metadataApiUrl } from "../../../utils";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ propId: string }> }
) {
  const authHeader = await buildAuthHeader();
  const { propId } = await params;

  const response = await fetch(
    metadataApiUrl(`/property-definitions/${propId}/deprecate`),
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        ...authHeader,
      },
    }
  );

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(
      payload || { detail: "Failed to deprecate property definition" },
      { status: response.status }
    );
  }

  return NextResponse.json(payload);
}
