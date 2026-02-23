import { NextRequest, NextResponse } from "next/server";
import { buildAuthHeader, metadataApiUrl } from "../../../utils";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ catId: string }> }
) {
  const authHeader = await buildAuthHeader();
  const { catId } = await params;

  const response = await fetch(metadataApiUrl(`/categories/${catId}/deprecate`), {
    method: "POST",
    headers: {
      Accept: "application/json",
      ...authHeader,
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(payload || { detail: "Failed to deprecate category" }, {
      status: response.status,
    });
  }

  return NextResponse.json(payload);
}
