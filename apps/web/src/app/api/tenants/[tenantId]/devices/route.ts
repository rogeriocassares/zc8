/**
 * GET /api/tenants/[tenantId]/devices - Proxy to Elysia device endpoint
 */

import { type NextRequest, NextResponse } from "next/server";

const ELYSIA_API = process.env.NEXT_PUBLIC_ELYSIA_API_URL || "http://localhost:3333";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    const authHeader = request.headers.get("Authorization");

    if (!authHeader) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    // Forward query parameters
    const queryString = request.nextUrl.search;

    const response = await fetch(
      `${ELYSIA_API}/api/tenants/${tenantId}/devices${queryString}`,
      {
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      return NextResponse.json(
        { message: "Failed to fetch devices" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Get devices error:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}
