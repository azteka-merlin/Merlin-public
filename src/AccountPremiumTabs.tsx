import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Heart, LoaderCircle, LogOut, Trash2 } from "lucide-react";
import { Button, cx } from "./ui";
import { wishlistCopy, type WishlistCopy } from "./wishlist-copy";
import { getPremiumWishes, removePremiumWish, WishlistRequestError, type PremiumWish } from "./wishlist-session";
import type { Locale } from "./i18n";

type AccountTab = "access" | "wishlist";

export function AccountPremiumTabs({ children, locale, csrfToken, onSignOut, loggingOut }: {
  children: ReactNode;
  locale: Locale;
  csrfToken: string;
  onSignOut: () => void;
  loggingOut: boolean;
}) {
  const [tab, setTab] = useState<AccountTab>(() => window.location.hash === "#lista-de-desejos" ? "wishlist" : "access");
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const copy = wishlistCopy[locale];
  const order: AccountTab[] = ["access", "wishlist"];
  function chooseTab(value: AccountTab) {
    setTab(value);
    window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}${value === "wishlist" ? "#lista-de-desejos" : ""}`);
  }
  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === "ArrowRight" ? (index + 1) % order.length
      : event.key === "ArrowLeft" ? (index - 1 + order.length) % order.length
      : event.key === "Home" ? 0 : event.key === "End" ? 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    chooseTab(order[next]);
    tabs.current[next]?.focus();
  }
  return <>
    <h1 className="mb-5 text-2xl font-semibold">{copy.account}</h1>
    <div role="tablist" aria-label={copy.account} className="mb-8 flex gap-1 border-b border-border">
      {order.map((value, index) => <button key={value} ref={(node) => { tabs.current[index] = node; }}
        id={`${id}-${value}-tab`} type="button" role="tab" aria-selected={tab === value}
        aria-controls={`${id}-${value}-panel`} tabIndex={tab === value ? 0 : -1}
        onClick={() => chooseTab(value)} onKeyDown={(event) => moveTab(event, index)}
        className={cx("-mb-px border-b-2 px-4 py-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary", tab === value ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
      >{copy[value]}</button>)}
    </div>
    <section id={`${id}-access-panel`} role="tabpanel" aria-labelledby={`${id}-access-tab`} hidden={tab !== "access"} tabIndex={0}>
      {children}
    </section>
    <section id={`${id}-wishlist-panel`} role="tabpanel" aria-labelledby={`${id}-wishlist-tab`} hidden={tab !== "wishlist"} tabIndex={0}>
      {tab === "wishlist" && <>
        <div className="mb-5 flex justify-end">
          <button type="button" disabled={loggingOut} onClick={onSignOut}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50">
            <LogOut aria-hidden="true" className="h-4 w-4" />{loggingOut ? copy.exiting : copy.exit}
          </button>
        </div>
        <PremiumWishlist csrfToken={csrfToken} copy={copy} />
      </>}
    </section>
  </>;
}

export function PremiumWishlist({ csrfToken, copy }: { csrfToken: string; copy: WishlistCopy }) {
  const [wishes, setWishes] = useState<PremiumWish[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [reload, setReload] = useState(0);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const mounted = useRef(true);
  const removeBusy = useRef(false);
  const removeButtons = useRef(new Map<string, HTMLButtonElement>());
  const heading = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(false);
    setSessionExpired(false);
    void getPremiumWishes(controller.signal).then((items) => {
      if (!controller.signal.aborted) setWishes(items);
    }).catch((error) => {
      if (controller.signal.aborted) return;
      setLoadError(true);
      setSessionExpired(error instanceof WishlistRequestError && (error.status === 401 || error.status === 403));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [reload]);

  async function remove(wish: PremiumWish) {
    if (removeBusy.current) return;
    removeBusy.current = true;
    setRemoving(wish.appId);
    setRemoveError(null);
    setNotice("");
    try {
      await removePremiumWish(wish.appId, csrfToken);
      if (!mounted.current) return;
      const next = wishes.filter((item) => item.appId !== wish.appId);
      const index = wishes.findIndex((item) => item.appId === wish.appId);
      setWishes(next);
      setNotice(copy.removed.replace("{name}", wish.name));
      // Keep keyboard focus near the action after removing its button.
      requestAnimationFrame(() => {
        if (!mounted.current) return;
        const target = next[Math.min(index, next.length - 1)];
        if (target) removeButtons.current.get(target.appId)?.focus();
        else heading.current?.focus();
      });
    } catch (error) {
      if (!mounted.current) return;
      setRemoveError(wish.appId);
      if (error instanceof WishlistRequestError && (error.status === 401 || error.status === 403)) setSessionExpired(true);
    } finally {
      removeBusy.current = false;
      if (mounted.current) setRemoving(null);
    }
  }

  return <div className="rounded-2xl border border-border bg-card p-5 sm:p-8" aria-busy={loading}>
    <h2 ref={heading} tabIndex={-1} className="text-xl font-semibold">{copy.wishlist}</h2>
    <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">{copy.description}</p>
    <p role="status" aria-live="polite" className="mt-3 text-sm text-emerald-300">{notice}</p>
    {loading && <p role="status" className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />{copy.loading}</p>}
    {sessionExpired ? <div role="alert" className="mt-5 rounded-xl border border-destructive/30 p-4 text-sm">
      <p>{copy.sessionExpired}</p><a href="/download?access=me" className="mt-3 inline-flex min-h-10 items-center text-primary underline">{copy.login}</a>
    </div> : loadError && <div role="alert" className="mt-5 rounded-xl border border-destructive/30 p-4 text-sm">
      <p>{copy.loadError}</p><Button variant="outline" className="mt-3" onClick={() => setReload((value) => value + 1)}>{copy.retry}</Button>
    </div>}
    {!loading && !loadError && !sessionExpired && wishes.length === 0 && <div className="py-12 text-center">
      <Heart aria-hidden="true" className="mx-auto mb-4 h-8 w-8 text-primary" />
      <p className="font-medium">{copy.emptyTitle}</p><p className="mt-2 text-sm text-muted-foreground">{copy.emptyBody}</p>
    </div>}
    {!loading && !loadError && !sessionExpired && wishes.length > 0 && <>
      <ul className="mt-4 divide-y divide-border">
        {wishes.map((wish) => <li key={wish.appId} className="flex flex-wrap items-center gap-4 py-5 sm:flex-nowrap">
          <div aria-hidden="true" className="relative flex h-16 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-secondary">
            <Heart className="h-5 w-5 text-muted-foreground" />
            {wish.coverUrl && <img src={wish.coverUrl} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" onError={(event) => { event.currentTarget.style.display = "none"; }} />}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="break-words text-sm font-semibold">{wish.name}</h3>
            <span className={cx("mt-2 inline-flex rounded-full border px-2 py-0.5 text-xs", wish.comingSoon ? "border-border text-muted-foreground" : "border-emerald-400/25 text-emerald-300")}>{wish.comingSoon ? copy.comingSoon : copy.available}</span>
            {wish.email && <p className="mt-2 break-all text-xs text-muted-foreground"><span className="sr-only">{copy.email}: </span>{wish.email}</p>}
            {removeError === wish.appId && <p role="alert" className="mt-2 text-sm text-destructive">{copy.removeError}</p>}
          </div>
          <button type="button" ref={(node) => { if (node) removeButtons.current.set(wish.appId, node); else removeButtons.current.delete(wish.appId); }}
            onClick={() => void remove(wish)} disabled={removing !== null || !csrfToken}
            aria-label={copy.removeNamed.replace("{name}", wish.name)}
            className="ml-auto inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border border-border px-3 text-sm text-muted-foreground hover:border-destructive/40 hover:text-destructive focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50">
            {removing === wish.appId ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Trash2 aria-hidden="true" className="h-4 w-4" />}
            {removing === wish.appId ? copy.removing : copy.remove}
          </button>
        </li>)}
      </ul>
      {wishes.some((wish) => !wish.comingSoon) && <p className="mt-5 border-t border-border pt-5 text-xs leading-relaxed text-muted-foreground">{copy.availableHint}</p>}
    </>}
  </div>;
}
