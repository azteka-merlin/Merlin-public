import type { ImgHTMLAttributes } from "react";

type GameImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "onLoad" | "onError"> & {
  appId: string;
  sharedCoverUrl?: string;
  coverUrl: string | null;
  fallbackCoverUrls?: string[];
};

const reportedImages = new Map<string, number>();

function reportImage(appId: string, sharedCoverUrl: string, image: HTMLImageElement) {
  if ((reportedImages.get(appId) || 0) > Date.now()) return;
  const source = new URL(image.currentSrc || image.src);
  if (sharedCoverUrl !== "/api/public/game-images/" + appId) return;
  const shared = new URL(sharedCoverUrl, window.location.origin);
  if (source.origin === shared.origin && source.pathname === shared.pathname) return;
  const sourceUrl = source.origin === window.location.origin ? undefined : source.origin + source.pathname;
  reportedImages.delete(appId);
  reportedImages.set(appId, Date.now() + 10 * 60 * 1000);
  if (reportedImages.size > 2000) {
    const oldest = reportedImages.keys().next().value;
    if (oldest) reportedImages.delete(oldest);
  }
  function retryLater() {
    if (reportedImages.has(appId)) reportedImages.set(appId, Date.now() + 60 * 1000);
  }
  void fetch(sharedCoverUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceUrl: sourceUrl && sourceUrl.length <= 600 ? sourceUrl : undefined }),
    keepalive: true,
  }).then((response) => { if (!response.ok) retryLater(); }).catch(retryLater);
}

export function GameImage({ appId, sharedCoverUrl, coverUrl, fallbackCoverUrls = [], ...props }: GameImageProps) {
  const primary = sharedCoverUrl || coverUrl;
  if (!primary) return null;
  const fallbacks = [...new Set([coverUrl, ...fallbackCoverUrls])]
    .filter((url): url is string => Boolean(url) && url !== primary);
  return <img key={primary} {...props} src={primary} loading="lazy"
    onLoad={event => { if (sharedCoverUrl) reportImage(appId, sharedCoverUrl, event.currentTarget); }}
    onError={event => {
      const image = event.currentTarget;
      const index = Number(image.dataset.fallbackIndex || "0");
      const next = fallbacks[index];
      if (!next) { image.style.visibility = "hidden"; return; }
      image.dataset.fallbackIndex = String(index + 1);
      image.src = next;
    }} />;
}
