/**
 * POST /api/auth/signup - Proxy signup to Elysia backend
 * Creates a new user account with a plan and auto-provisions an organization.
 */

import { type NextRequest, NextResponse } from "next/server";

const ELYSIA_API_URL =
  process.env.NEXT_PUBLIC_ELYSIA_API_URL ||
  process.env.ELYSIA_API_URL ||
  "http://localhost:3333";

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
    const { email, password, first_name, last_name, plan } = body;

    if (!email || !password) {
      return NextResponse.json(
        { message: "Email and password are required" },
        { status: 400 },
      );
    }

    const response = await fetch(`${ELYSIA_API_URL}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, first_name, last_name, plan }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return NextResponse.json(
        data || { message: "Signup failed" },
        { status: response.status },
      );
    }

    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    console.error("Signup error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    if (
      errorMessage.includes("ECONNREFUSED") ||
      errorMessage.includes("Failed to fetch")
    ) {
      return NextResponse.json(
        { message: "Service unavailable. Please try again later." },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { message: `Internal server error: ${errorMessage}` },
      { status: 500 },
    );
  }
}
