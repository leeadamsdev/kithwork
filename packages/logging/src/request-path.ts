export function safeRequestPath(url: string): string {
  return (url.split("?", 1)[0] ?? "/").replace(
    /^\/api\/auth\/reset-password\/[^/]+/,
    "/api/auth/reset-password/[Redacted]",
  );
}
