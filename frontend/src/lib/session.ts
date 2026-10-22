export const SESSION_COOKIE = "archive_session";

export async function sessionToken(password: string): Promise<string> {
  const secret = process.env.SESSION_SECRET || "archive";
  const data = new TextEncoder().encode(`${secret}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
