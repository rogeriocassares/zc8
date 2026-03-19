/**
 * POST /api/auth/login - Proxy authentication to Elysia backend with better-auth
 * Forwards credentials to Elysia API running on port 3333
 */

import { type NextRequest, NextResponse } from "next/server";

const ELYSIA_API_URL = process.env.NEXT_PUBLIC_ELYSIA_API_URL || process.env.ELYSIA_API_URL || "http://localhost:3333";

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type");
    if (!contentType?.includes("application/json")) {
      return NextResponse.json(
        { message: "Content-Type must be application/json" },
        { status: 400 },
      );
    }

    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { message: "Email and password are required" },
        { status: 400 },
      );
    }

    // Forward authentication request to Elysia backend
    const response = await fetch(`${ELYSIA_API_URL}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        errorData || { message: "Authentication failed" },
        { status: response.status },
      );
    }

    const sessionData = await response.json();
    return NextResponse.json(sessionData, { status: 200 });
  } catch (error) {
    console.error("Login error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    // If it's a connection error to Elysia, inform the user
    if (
      errorMessage.includes("ECONNREFUSED") ||
      errorMessage.includes("Failed to fetch")
    ) {
      return NextResponse.json(
        { message: "Authentication service unavailable. Please try again later." },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { message: `Internal server error: ${errorMessage}` },
      { status: 500 },
    );
  }
}
