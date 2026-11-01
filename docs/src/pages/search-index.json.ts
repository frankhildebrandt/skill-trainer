import type { APIRoute } from "astro";
import { docUrl, orderedDocs } from "../lib/docs";

export const GET: APIRoute = async () => {
  const pages = await orderedDocs();
  return new Response(JSON.stringify(pages.map((page) => ({
    title: page.data.title,
    description: page.data.description,
    href: docUrl(page.id),
    body: page.body,
  }))), { headers: { "Content-Type": "application/json; charset=utf-8" } });
};
