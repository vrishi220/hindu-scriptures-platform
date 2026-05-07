import { cookies } from "next/headers";

const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8000";
const ACCESS_TOKEN_COOKIE = process.env.ACCESS_TOKEN_COOKIE || "access_token";

export async function POST(request: Request) {
  const store = await cookies();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;

  if (!body?.question || typeof body.question !== "string" || !body.question.trim()) {
    return Response.json({ detail: "Question required" }, { status: 400 });
  }

  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const authHeader: Record<string, string> = accessToken
    ? { Authorization: `Bearer ${accessToken}` }
    : {};

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...authHeader,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return Response.json({ detail: "Scripture service unavailable" }, { status: 503 });
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    return Response.json(payload || { detail: "Ask failed" }, { status: response.status });
  }

  return new Response(response.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
