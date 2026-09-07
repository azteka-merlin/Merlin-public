import { useEffect, useMemo, useState } from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import * as ToggleGroup from "@radix-ui/react-toggle-group";
import { QueryClient, QueryClientProvider, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, LoaderCircle, Search } from "lucide-react";
import { FaSteam } from "react-icons/fa";

type TFn = (key: string) => string;
type Category = "premium" | "standard" | "reviewing";
type CatalogGame = { appId: string; name: string; coverUrl: string | null; fallbackCoverUrls: string[]; category: Category; availableInMerlin: boolean };
type CatalogResponse = { games: CatalogGame[]; hasMore: boolean };
const client = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } });

function loadNextCover(image: HTMLImageElement, fallbackCoverUrls: string[]) {
  const nextIndex = Number(image.dataset.fallbackIndex || "0");
  const nextUrl = fallbackCoverUrls[nextIndex];
  if (nextUrl) {
    image.dataset.fallbackIndex = String(nextIndex + 1);
    image.src = nextUrl;
    return;
  }
  image.remove();
}

function CatalogContent({ t }: { t: TFn }) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<"all" | "premium" | "standard">("all");
  const [filterLoading, setFilterLoading] = useState(false);
  const [consultErrorAppId, setConsultErrorAppId] = useState<string | null>(null);
  const isWaitingForSearch = input.length >= 5 && input !== search;

  useEffect(() => {
    if (input.length > 0 && input.length < 5) { setSearch(""); return; }
    const timeout = window.setTimeout(() => setSearch(input), 800);
    return () => window.clearTimeout(timeout);
  }, [input]);

  const queryKey = useMemo(() => ["catalog", search, category] as const, [category, search]);
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ page: String(pageParam) });
      if (search) params.set("q", search);
      if (category !== "all") params.set("category", category);
      const response = await fetch(`/api/public/catalog?${params}`);
      if (!response.ok) throw new Error("catalog request failed");
      return response.json() as Promise<CatalogResponse>;
    },
    getNextPageParam: (lastPage, pages) => lastPage.hasMore ? pages.length + 1 : undefined,
  });
  const consult = useMutation({
    mutationFn: async (appId: string) => {
      const response = await fetch("/api/public/catalog/consult", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId }),
      });
      const payload = await response.json() as { success: boolean; updated: boolean };
      if (!response.ok || !payload.success || !payload.updated) throw new Error("catalog consultation could not resolve the game");
      return payload;
    },
    onMutate: () => setConsultErrorAppId(null),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["catalog"] }),
    onError: (_error, appId) => setConsultErrorAppId(appId),
  });
  const games = query.data?.pages.flatMap((page) => page.games) || [];
  const isRefreshing = filterLoading || isWaitingForSearch || (query.isFetching && !query.isFetchingNextPage);

  return <main className="min-h-screen bg-background text-foreground"><div className="container-merlin py-10 sm:py-14">
    <h1 className="font-display text-3xl font-bold sm:text-4xl">{t("catalogTitle")}</h1>
    <div className="mt-7 flex flex-col gap-3 lg:flex-row">
      <label className="relative block flex-1"><Search aria-hidden size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" /><input value={input} onChange={(event) => setInput(event.target.value)} minLength={5} placeholder={t("catalogSearch")} className="h-13 w-full rounded-lg border border-border bg-card pl-12 pr-4 text-sm outline-none transition-colors focus:border-primary" /></label>
      <ToggleGroup.Root type="single" value={category} onValueChange={(value) => { if (!value || value === category) return; setFilterLoading(true); setCategory(value as typeof category); window.setTimeout(() => setFilterLoading(false), 320); }} className="inline-flex h-13 shrink-0 rounded-lg border border-border bg-card p-1">
        <ToggleGroup.Item value="all" className="rounded-md px-4 text-sm data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">{t("catalogAll")}</ToggleGroup.Item>
        <ToggleGroup.Item value="premium" className="rounded-md px-4 text-sm data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">{t("catalogPremium")}</ToggleGroup.Item>
        <ToggleGroup.Item value="standard" className="rounded-md px-4 text-sm data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">{t("catalogStandard")}</ToggleGroup.Item>
      </ToggleGroup.Root>
    </div>
    {(isWaitingForSearch || query.isFetching) && <p className="mt-3 inline-flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle size={16} className="animate-spin" />{t("catalogSearching")}</p>}
    <Collapsible.Root className="mt-6 border-y border-border py-4 sm:py-5"><div className="grid gap-5 md:grid-cols-3"><div><h2 className="font-semibold">{t("catalogStandard")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("catalogStandardInfo")}</p></div><div><h2 className="font-semibold text-primary">{t("catalogPremium")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("catalogPremiumInfo")}</p></div><div><h2 className="font-semibold">{t("catalogReviewing")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("catalogReviewingInfo")}</p></div></div><Collapsible.Trigger className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary md:hidden">{t("catalogPlanRules")}<ChevronDown size={16} /></Collapsible.Trigger><Collapsible.Content className="mt-4 border-t border-border pt-4 text-sm text-muted-foreground md:block"><p>{t("catalogPlanRulesInfo")}</p></Collapsible.Content></Collapsible.Root>
    {isRefreshing ? (
      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 10 }).map((_, index) => <div key={index} className="h-20 animate-pulse rounded-md bg-card" />)}
      </div>
    ) : games.length ? <>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {games.map((game) => <article key={game.appId} className="min-w-0 rounded-md border border-border bg-card p-3">
          <div className="aspect-[231/87] w-full overflow-hidden rounded-md bg-secondary">
            {game.coverUrl ? <img src={game.coverUrl} alt="" className="h-full w-full object-contain" loading="lazy" onError={(event) => loadNextCover(event.currentTarget, game.fallbackCoverUrls)} /> : <div className="h-full w-full bg-secondary" />}
          </div>
          <div className="mt-3 flex items-start gap-2">
            <h2 className="min-w-0 flex-1 line-clamp-2 text-sm font-medium">{game.name}</h2>
            <a href={`https://store.steampowered.com/app/${encodeURIComponent(game.appId)}/`} target="_blank" rel="noopener noreferrer" aria-label={t("catalogOpenSteam")} title={t("catalogOpenSteam")} className="shrink-0 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><FaSteam size={16} aria-hidden="true" /></a>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {game.availableInMerlin && <span className="inline-flex rounded-md bg-emerald-500 px-2 py-1 text-xs font-medium text-black">{t("catalogAvailable")}</span>}
            <span className={`inline-flex rounded-md border px-2 py-1 text-xs ${game.category === "premium" ? "border-primary bg-primary text-primary-foreground" : game.category === "standard" ? "border-border text-muted-foreground" : "border-border bg-secondary text-muted-foreground"}`}>{t(`catalog${game.category[0].toUpperCase()}${game.category.slice(1)}`)}</span>
            {game.category === "reviewing" && <button type="button" onClick={() => consult.mutate(game.appId)} disabled={consult.isPending} className="inline-flex h-6 items-center gap-1 rounded-full border border-border px-2 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-60">{consult.isPending && consult.variables === game.appId && <LoaderCircle size={12} className="animate-spin" />}{t("catalogConsult")}</button>}
          </div>
          {consultErrorAppId === game.appId && <p className="mt-2 text-xs leading-5 text-muted-foreground">{t("catalogConsultUnavailable")}</p>}
        </article>)}
      </div>
      {query.hasNextPage && <div className="mt-10 flex justify-center"><button type="button" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-primary px-5 text-sm font-medium text-primary transition-colors hover:bg-primary hover:text-primary-foreground disabled:opacity-60">{query.isFetchingNextPage && <LoaderCircle size={16} className="animate-spin" />}{t(query.isFetchingNextPage ? "catalogLoadingMore" : "catalogLoadMore")}</button></div>}
    </> : <p className="py-16 text-center text-sm text-muted-foreground">{t("catalogEmpty")}</p>}
  </div></main>;
}

export function CatalogPage({ t }: { t: TFn }) { return <QueryClientProvider client={client}><CatalogContent t={t} /></QueryClientProvider>; }
