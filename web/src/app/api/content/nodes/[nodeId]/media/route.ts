import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { API_BASE_URL, ACCESS_TOKEN_COOKIE, buildAuthHeader } from "@/lib/apiProxy";


export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ nodeId: string }> }
) {
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const resolvedParams = await params;

  const response = await fetch(
    `${API_BASE_URL}/api/content/nodes/${resolvedParams.nodeId}/media${request.nextUrl.search}`,
    {
      headers: {
        Accept: "application/json",
        ...buildAuthHeader(accessToken),
      },
      cache: "no-store",
    }
  );

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(
      payload || { detail: "Failed to load media" },
      { status: response.status }
    );
  }

  return NextResponse.json(payload || []);
}
