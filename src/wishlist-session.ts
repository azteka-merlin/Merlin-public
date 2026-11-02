export type PremiumWish = {
  appId: string;
  name: string;
  coverUrl: string;
  comingSoon: boolean;
  email: string;
  phone: string | null;
  createdAt: string;
};

export class WishlistRequestError extends Error {
  status: number;
  constructor(status: number) {
    super("Wishlist request failed");
    this.name = "WishlistRequestError";
    this.status = status;
  }
}

const endpoint = "/api/public/access/session/premium/wishlist";

export function parsePremiumWishes(value: unknown): PremiumWish[] {
  if (!Array.isArray(value)) throw new WishlistRequestError(502);
  const seen = new Set<string>();
  return value.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const appId = String(row.appId || "");
    if (!/^\d+$/.test(appId) || seen.has(appId)) return [];
    seen.add(appId);
    return [{
      appId,
      name: typeof row.name === "string" && row.name.trim() ? row.name : appId,
      coverUrl: typeof row.coverUrl === "string" && /^https?:\/\//i.test(row.coverUrl) ? row.coverUrl : "",
      comingSoon: row.comingSoon === 1 || row.comingSoon === true,
      email: typeof row.email === "string" ? row.email : "",
      phone: typeof row.phone === "string" && row.phone ? row.phone : null,
      createdAt: typeof row.createdAt === "string" ? row.createdAt : "",
    }];
  });
}

export async function getPremiumWishes(signal?: AbortSignal, request: typeof fetch = fetch): Promise<PremiumWish[]> {
  const response = await request(endpoint, { credentials: "same-origin", cache: "no-store", signal });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) throw new WishlistRequestError(response.status);
  return parsePremiumWishes(payload.wishes);
}

export async function removePremiumWish(appId: string, csrfToken: string, request: typeof fetch = fetch): Promise<void> {
  if (!/^\d+$/.test(appId) || !csrfToken) throw new WishlistRequestError(403);
  const response = await request(`${endpoint}/${encodeURIComponent(appId)}`, {
    method: "DELETE",
    credentials: "same-origin",
    headers: { "x-merlin-access-csrf": csrfToken },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) throw new WishlistRequestError(response.status);
}
