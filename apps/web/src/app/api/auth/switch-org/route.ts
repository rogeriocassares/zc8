/**
 * POST /api/auth/switch-org - Switch to a different organization
 */

import { type NextRequest, NextResponse } from "next/server";

const ELYSIA_API = process.env.NEXT_PUBLIC_ELYSIA_API_URL || process.env.ELYSIA_API_URL || "http://localhost:3333";

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization");
    const { organizationId } = await request.json();

    if (!authHeader) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    if (!organizationId) {
      return NextResponse.json(
        { message: "Organization ID is required" },
        { status: 400 },
      );
    }

    const response = await fetch(`${ELYSIA_API}/api/auth/switch-org`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ organizationId }),
    });

    if (!response.ok) {
      return NextResponse.json(
        { message: "Failed to switch organization" },
        { status: response.status },
      );
    }

    const session = await response.json();

    return NextResponse.json({
      userId: session.userId,
      email: session.email,
      organizationId: session.organizationId,
      organizationName: session.organizationName,
      memberRole: session.role,
      token: session.token,
      tokenExpires: session.tokenExpires,
    });
  } catch (error) {
    console.error("Switch org error:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 },
    );
  }
}
