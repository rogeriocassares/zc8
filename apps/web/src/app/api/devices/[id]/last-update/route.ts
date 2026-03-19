/**
 * GET /api/devices/[id]/last-update - Get last Redis update for a device
 * Returns: { deviceId, lastHash, lastValue, timestamp, updatedAt }
 */

import { type NextRequest, NextResponse } from "next/server";

const ELYSIA_API =
  process.env.NEXT_PUBLIC_ELYSIA_API_URL ||
  process.env.ELYSIA_API_URL ||
  "http://localhost:3333";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authHeader = request.headers.get("Authorization");
    const { id } = await params;

    if (!authHeader) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    if (!id) {
      return NextResponse.json(
        { message: "Device ID is required" },
        { status: 400 },
      );
    }

    const response = await fetch(`${ELYSIA_API}/devices/${id}/last-update`, {
      headers: {
        Authorization: authHeader,
      },
    });

    if (!response.ok) {
      // Return null/empty if device not found or no updates yet
      if (response.status === 404) {
        return NextResponse.json({
          deviceId: id,
          lastHash: "",
          lastValue: null,
          timestamp: Date.now(),
          updatedAt: new Date().toISOString(),
        });
      }

      return NextResponse.json(
        { message: "Failed to fetch device update" },
        { status: response.status },
      );
    }

    const data = await response.json();

    return NextResponse.json({
      deviceId: id,
      lastHash: data.hash || "",
      lastValue: data.value,
      timestamp: data.timestamp || Date.now(),
      updatedAt: data.updatedAt || new Date().toISOString(),
    });
  } catch (error) {
    console.error("Get device last update error:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 },
    );
  }
}
