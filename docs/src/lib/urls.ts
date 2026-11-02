import { withBasePath } from "./base-path.mjs";

export function withBase(path: string): string {
  return withBasePath(path, import.meta.env.BASE_URL);
}
