/** Prefix site-local URLs while preserving external and already prefixed URLs. */
export function withBasePath(path, base) {
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  const prefix = `/${base.split("/").filter(Boolean).join("/")}`;
  if (prefix === "/" || path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}#`) || path.startsWith(`${prefix}?`)) return path;
  return `${prefix}${path}`;
}
