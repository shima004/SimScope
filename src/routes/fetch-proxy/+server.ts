import type { RequestHandler } from "@sveltejs/kit";

export const GET: RequestHandler = async ({ url }) => {
  const target = url.searchParams.get("url");
  if (!target) {
    return new Response("Missing url parameter", { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return new Response("Invalid url", { status: 400 });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return new Response("Only http/https URLs are allowed", { status: 400 });
  }

  try {
    const upstream = await fetch(target);
    if (!upstream.ok) {
      return new Response(null, { status: upstream.status });
    }
    const contentType =
      upstream.headers.get("content-type") ?? "application/octet-stream";
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": contentType },
    });
  } catch (e) {
    return new Response(String(e), { status: 502 });
  }
};
