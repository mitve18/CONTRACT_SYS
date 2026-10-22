// Same-origin proxy to the FastAPI backend. The API key stays on the server.
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BACKEND = (process.env.BACKEND_URL || "http://localhost:8000").replace(/\/$/, "");

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const url = `${BACKEND}/api/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;
  const headers = new Headers();
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  if (process.env.BACKEND_API_KEY) headers.set("x-api-key", process.env.BACKEND_API_KEY);

  const hasBody = !["GET", "HEAD"].includes(req.method);
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: req.method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
      cache: "no-store",
      signal: req.signal,
    });
  } catch {
    return Response.json({ detail: "השרת לא זמין כרגע. נסו שוב בעוד רגע." }, { status: 502 });
  }

  const out = new Headers();
  for (const key of ["content-type", "content-disposition", "cache-control"]) {
    const v = upstream.headers.get(key);
    if (v) out.set(key, v);
  }
  if (out.get("content-type")?.includes("text/event-stream")) out.set("x-accel-buffering", "no");
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as DELETE };
