import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET() {
  const store = await cookies();
  const names = store.getAll().map((cookie) => cookie.name);
  return NextResponse.json({ cookies: names });
}
