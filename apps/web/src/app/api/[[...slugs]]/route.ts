import { type NextRequest, NextResponse } from "next/server";

const ELYSIA_BASE = process.env.ELYSIA_API_URL ?? process.env.NEXT_PUBLIC_ELYSIA_API_URL ?? "http://localhost:3333";

async function proxyRequest(req: NextRequest): Promise<NextResponse> {
  const { pathname, search } = req.nextUrl;
  const targetUrl = `${ELYSIA_BASE}${pathname}${search}`;

  const headers = new Headers();
  const auth = req.headers.get("authorization");
  if (auth) headers.set("authorization", auth);
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  let body: BodyInit | undefined;
  if (!["GET", "HEAD"].includes(req.method)) {
    body = await req.arrayBuffer();
  }

  const upstream = await fetch(targetUrl, {
    method: req.method,
    headers,
    body,
  });

  const responseHeaders = new Headers();
  const upContentType = upstream.headers.get("content-type");
  if (upContentType) responseHeaders.set("content-type", upContentType);

  const data = await upstream.arrayBuffer();
  return new NextResponse(data, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const PATCH = proxyRequest;
export const DELETE = proxyRequest;
