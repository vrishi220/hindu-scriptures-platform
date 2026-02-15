import { NextResponse } from "next/server";

const ACCESS_TOKEN_COOKIE = process.env.ACCESS_TOKEN_COOKIE || "access_token";
const REFRESH_TOKEN_COOKIE = process.env.REFRESH_TOKEN_COOKIE || "refresh_token";

export async function POST() {
  const res = NextResponse.json({ message: "Logged out" });
  res.cookies.set(ACCESS_TOKEN_COOKIE, "", { path: "/", maxAge: 0 });
  res.cookies.set(REFRESH_TOKEN_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
