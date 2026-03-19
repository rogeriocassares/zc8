/**
 * GET /api/auth/me - Get current user info and organizations
 */

import { type NextRequest, NextResponse } from "next/server";

const ELYSIA_API = process.env.NEXT_PUBLIC_ELYSIA_API_URL || process.env.ELYSIA_API_URL || "http://localhost:3333";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization");

    if (!authHeader) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const response = await fetch(`${ELYSIA_API}/api/auth/me`, {
      headers: {
        Authorization: authHeader,
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { message: "Failed to fetch user" },
        { status: response.status },
      );
    }

    const user = await response.json();

    return NextResponse.json({
      id: user.id,
      email: user.email,
      name: user.name,
      organizations: user.organizations || [],
    });
  } catch (error) {
    console.error("Get user error:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 },
    );
  }
}
