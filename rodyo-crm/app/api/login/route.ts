import { NextResponse } from "next/server";

const COOKIE_NAME = "rodyo_auth";

type LoginPayload = {
  password?: string;
};

export async function POST(request: Request) {
  let payload: LoginPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const expectedPassword = process.env.SITE_PASSWORD;
  const accessToken = process.env.SITE_ACCESS_TOKEN;
  if (!expectedPassword || !accessToken) {
    return NextResponse.json({ error: "Password gate isn't configured." }, { status: 500 });
  }

  const password = String(payload.password ?? "");
  if (password !== expectedPassword) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  // The cookie holds a separate access token, not the password itself, so a
  // leaked cookie can't be used to recover the password.
  response.cookies.set(COOKIE_NAME, accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 180
  });
  return response;
}
