import { NextRequest, NextResponse } from "next/server";
import { buildAuthHeader, metadataApiUrl } from "../../../utils";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ catId: string }> }
) {
  const authHeader = await buildAuthHeader();
  const { catId } = await params;

  const response = await fetch(metadataApiUrl(`/categories/${catId}/effective-properties`), {
    headers: {
      Accept: "application/json",
      ...authHeader,
    },
    cache: "no-store",
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(payload || { detail: "Failed to load category effective properties" }, {
      status: response.status,
    });
  }

  return NextResponse.json(payload);
}
