/**
 * POST /api/auth/logout - Invalidate session
 */

import { type NextRequest, NextResponse } from "next/server";

const ELYSIA_API = process.env.NEXT_PUBLIC_ELYSIA_API_URL || process.env.ELYSIA_API_URL || "http://localhost:3333";

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization");

    // Notify backend of logout
    if (authHeader) {
      await fetch(`${ELYSIA_API}/api/auth/logout`, {
        method: "POST",
        headers: {
          Authorization: authHeader,
        },
      }).catch(() => { }); // Ignore errors, session is already cleared client-side
    }

    return NextResponse.json({ message: "Logged out successfully" });
  } catch (error) {
    console.error("Logout error:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 },
    );
  }
}
