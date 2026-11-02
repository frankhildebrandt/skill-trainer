import { getCollection, type CollectionEntry } from "astro:content";
import { withBase } from "./urls";

export const sections = ["Start", "Anwendung", "Referenz"] as const;

export function docUrl(id: string): string {
  return withBase(id === "index" ? "/docs/" : `/docs/${id}/`);
}

export async function orderedDocs(): Promise<CollectionEntry<"docs">[]> {
  return (await getCollection("docs")).sort((a, b) => a.data.order - b.data.order);
}
