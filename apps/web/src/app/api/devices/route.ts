/**
 * GET /api/devices - List all devices for the organization
 */

import { type NextRequest, NextResponse } from "next/server";

const ELYSIA_API = process.env.NEXT_PUBLIC_ELYSIA_API_URL || process.env.ELYSIA_API_URL || "http://localhost:3333";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization");

    if (!authHeader) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const limit = searchParams.get("limit") || "100";
    const offset = searchParams.get("offset") || "0";

    const response = await fetch(
      `${ELYSIA_API}/devices?limit=${limit}&offset=${offset}`,
      {
        headers: {
          Authorization: authHeader,
        },
      },
    );

    if (!response.ok) {
      return NextResponse.json(
        { message: "Failed to fetch devices" },
        { status: response.status },
      );
    }

    const data = await response.json();

    return NextResponse.json(data);
  } catch (error) {
    console.error("Get devices error:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 },
    );
  }
}
