import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { fmt } from "@/lib/library";
import { AppShell, Chip, Thumb, useSelectedIndex } from "@/components/brand";

export const Route = createFileRoute("/search")({
  validateSearch: (s: Record<string, unknown>) => ({ q: typeof s["q"] === "string" ? s["q"] : "" }),
  head: () => ({
    meta: [
      { title: "Search results — Glaze" },
      { name: "description", content: "Moment-level results across the marketing video library." },
      { property: "og:title", content: "Search results — Glaze" },
      { property: "og:description", content: "Moment-level results across the marketing video library." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SearchPage,
});

type Hit = {
  videoId: string | null;
  filename: string | null;
  campaign: string | null;
  format: string | null;
  start: number | null;
  end: number | null;
  rank: number | null;
  transcription: string;
  product: { status: string | null; sku: string | null; line: string | null };
  action: string | null;
  shot: string | null;
  lighting: string | null;
  skinTone: string;
  onScreenText: string;
  spokenMention: string;
  enrichment: string;
};

type SearchBody = {
  mode: "moments" | "catalog";
  note: string | null;
  pageToken: string | null;
  hits: Hit[];
};

type Facets = {
  formats: string[];
  disabledFormats: string[];
  attributes: string[];
  skus: string[];
  campaigns: string[];
  productStatuses: string[];
};

const STATUS_LABEL: Record<string, string> = {
  candidate: "candidate",
  line_only: "line only",
  unresolved: "unresolved",
};

function Facet({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{title}</h3><div className="flex flex-wrap gap-1">{children}</div></div>;
}

function hueOf(id: string) {
  let n = 0;
  for (const ch of id) n = (n + ch.charCodeAt(0) * 17) % 360;
  return n;
}

function formatLabel(value: string | null) {
  if (!value) return "format unknown";
  if (value === "before_after") return "Before/After";
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function momentLabel(hit: Hit) {
  const action = hit.action === "applied" ? "applied" : hit.action === "shown" ? "shown" : null;
  const bits = [hit.shot, action, hit.lighting && hit.lighting !== "unknown" ? `${hit.lighting} light` : null].filter(Boolean);
  if (hit.product.sku) return `${hit.product.sku}${bits.length ? ` · ${bits.join(", ")}` : ""}`;
  if (hit.product.line) return `${hit.product.line}${bits.length ? ` · ${bits.join(", ")}` : ""}`;
  if (bits.length) return bits.join(", ");
  if (hit.transcription) return hit.transcription;
  return "Matching moment";
}

function SearchPage() {
  const { q } = Route.useSearch();
  return (
    <AppShell search={q}>
      <SearchBody q={q} />
    </AppShell>
  );
}

function SearchBody({ q }: { q: string }) {
  const selection = useSelectedIndex();
  const indexId = selection?.selected?.id ?? "";
  const indexName = selection?.selected?.name ?? "";
  const ready = selection?.ready ?? false;
  const [formats, setFormats] = useState<string[]>([]);
  const [attrs, setAttrs] = useState<string[]>([]);
  const [skus, setSkus] = useState<string[]>([]);
  const [campaigns, setCampaigns] = useState<string[]>([]);
  const [productStatus, setProductStatus] = useState<string | null>(null);
  const [pageToken, setPageToken] = useState<string | null>(null);
  const [tokenKey, setTokenKey] = useState("");
  const [boundIndex, setBoundIndex] = useState("");
  const [view, setView] = useState<"moments" | "videos">("moments");
  const [facets, setFacets] = useState<Facets | null>(null);
  const [result, setResult] = useState<SearchBody | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const toggle = (arr: string[], set: (next: string[]) => void, value: string) => set(arr.includes(value) ? arr.filter((item) => item !== value) : [...arr, value]);

  if (ready && indexId && indexId !== boundIndex) {
    setBoundIndex(indexId);
    setCampaigns([]);
    setPageToken(null);
    setTokenKey("");
    setResult(null);
    setError(null);
  }

  useEffect(() => {
    if (!ready || !indexId) return;
    let cancelled = false;
    fetch("/api/library")
      .then((res) => res.json())
      .then((body) => { if (!cancelled) setFacets(body.facets); })
      .catch(() => { if (!cancelled) setFacets(null); });
    return () => { cancelled = true; };
  }, [ready, indexId]);

  const filterKey = JSON.stringify({ q, formats, attrs, skus, campaigns, productStatus, indexId });
  const activeToken = tokenKey === filterKey ? pageToken : null;

  useEffect(() => {
    if (!ready || !indexId) return;
    if (!q.trim() && skus.length !== 1) {
      setResult(null);
      setError(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setResult(null);
    setLoading(true);
    setError(null);
    fetch("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ query: q, formats, attributes: attrs, skus, campaigns, productStatus, pageToken: activeToken }),
    })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.message || "Search failed.");
        setResult(body);
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setResult(null);
        setError(err.message || "Search failed.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [ready, indexId, q, formats, attrs, skus, campaigns, productStatus, activeToken]);

  const hits = result?.hits ?? [];
  const grouped = [...hits.reduce((map, hit) => {
    const key = hit.videoId ?? hit.filename ?? "unknown";
    map.set(key, [...(map.get(key) ?? []), hit]);
    return map;
  }, new Map<string, Hit[]>()).values()];

  return (
      <div className="mx-auto grid w-full max-w-7xl gap-6 px-5 py-4 md:grid-cols-[200px_1fr]">
        <aside className="space-y-4 text-[13px]">
          <Facet title="Format">
            {(facets?.formats ?? ["Tutorial", "Demo", "Ad", "Before/After"]).map((item) => <Chip key={item} on={formats.includes(item)} onClick={() => toggle(formats, setFormats, item)}>{item}</Chip>)}
            {(facets?.disabledFormats ?? ["Creator"]).map((item) => <Chip key={item} on={false} disabled>{item}</Chip>)}
          </Facet>
          <Facet title="Visual attributes">
            {(facets?.attributes ?? ["application", "close-up", "packshot", "natural lighting", "studio lighting"]).map((item) => <Chip key={item} on={attrs.includes(item)} onClick={() => toggle(attrs, setAttrs, item)}>{item}</Chip>)}
          </Facet>
          <Facet title="Product SKU">
            {(facets?.skus ?? []).map((item) => <Chip key={item} on={skus.includes(item)} onClick={() => toggle(skus, setSkus, item)}>{item}</Chip>)}
          </Facet>
          <Facet title="Campaign">
            {(facets?.campaigns ?? []).length === 0
              ? <p className="text-[11px] text-muted-foreground">No campaign was saved on this index.</p>
              : facets?.campaigns.map((item) => <Chip key={item} on={campaigns.includes(item)} onClick={() => toggle(campaigns, setCampaigns, item)}>{item}</Chip>)}
          </Facet>
          <Facet title="Product status">
            <Chip on={productStatus === null} onClick={() => setProductStatus(null)}>any</Chip>
            {(facets?.productStatuses ?? ["candidate", "line_only", "unresolved"]).map((status) => (
              <Chip key={status} on={productStatus === status} onClick={() => setProductStatus(status)}>{STATUS_LABEL[status] ?? status}</Chip>
            ))}
          </Facet>
        </aside>
        <section>
          <div className="mb-3 flex items-center justify-between border-b border-border pb-2">
            <p className="text-[13px] text-muted-foreground">
              <span className="font-mono tabular-nums text-foreground">{loading ? "…" : hits.length}</span> moments in <span className="font-mono tabular-nums text-foreground">{grouped.length}</span> videos{indexName && <> on {indexName}</>}{q && <> for “{q}”</>}
            </p>
            <div className="flex rounded-sm border border-border p-px text-xs">
              {(["moments", "videos"] as const).map((item) => (
                <button key={item} onClick={() => setView(item)} className={`rounded-sm px-2.5 py-0.5 capitalize ${view === item ? "bg-secondary text-foreground" : "text-muted-foreground"}`}>{item}</button>
              ))}
            </div>
          </div>
          {result?.note && <p className="mb-3 text-[12px] leading-relaxed text-muted-foreground">{result.note}</p>}
          {error && <p className="mb-3 text-[13px] text-destructive">{error}</p>}
          {!q.trim() && skus.length !== 1 && <div className="rounded-sm border border-dashed border-border p-10 text-center text-[13px] text-muted-foreground">Describe a moment, or pick one SKU to list the videos that name it.</div>}
          {!error && (q.trim() || skus.length === 1) && !loading && hits.length === 0 && (
            <div className="rounded-sm border border-dashed border-border p-10 text-center text-[13px] text-muted-foreground">
              {result?.mode === "catalog" ? "No finished enrichment on this index names that SKU." : "No moments on this page. A rank is an ordering, not a product probability."}
            </div>
          )}
          {loading && <p className="mb-3 font-mono text-[11px] text-muted-foreground">Searching…</p>}

          {view === "moments" ? (
            <div className="overflow-hidden rounded-sm border border-border bg-card">
              <div className="hidden grid-cols-[112px_88px_1fr_72px] gap-3 border-b border-border bg-muted/60 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground sm:grid">
                <span>Preview</span><span>Time</span><span>Moment</span><span className="text-right">Rank</span>
              </div>
              {hits.map((hit, index) => {
                const id = hit.videoId ?? "unknown";
                const row = (
                  <>
                    <Thumb hue={hueOf(id)} t={hit.start ?? 0} />
                    <span className="hidden font-mono text-xs tabular-nums text-muted-foreground sm:block">{hit.start == null ? "—" : fmt(hit.start)}{hit.end == null ? "" : `–${fmt(hit.end)}`}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-[13px] font-medium">{momentLabel(hit)}</p>
                        {hit.product.sku && <span className="rounded-sm border border-border px-1 font-mono text-[10px]">{hit.product.sku}</span>}
                      </div>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">{hit.filename ?? id} · {formatLabel(hit.format)} · {hit.campaign ?? "no campaign"}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {hit.product.status && <span className="rounded-sm bg-muted px-1 py-px text-[10px] text-muted-foreground">{STATUS_LABEL[hit.product.status] ?? hit.product.status}</span>}
                        {hit.skinTone && <span className="rounded-sm bg-muted px-1 py-px text-[10px] text-muted-foreground">{hit.skinTone} skin</span>}
                        {hit.onScreenText && <span className="rounded-sm bg-muted px-1 py-px font-mono text-[10px] text-muted-foreground">on screen · {hit.onScreenText}</span>}
                        {hit.spokenMention && <span className="rounded-sm bg-muted px-1 py-px text-[10px] text-muted-foreground">spoken · {hit.spokenMention}</span>}
                        {hit.enrichment === "missing" && <span className="rounded-sm bg-muted px-1 py-px text-[10px] text-muted-foreground">enrichment missing</span>}
                        {hit.enrichment === "not_ours" && <span className="rounded-sm bg-muted px-1 py-px text-[10px] text-muted-foreground">not enriched here</span>}
                      </div>
                    </div>
                    <span className="text-right font-mono text-[11px] tabular-nums text-muted-foreground">{hit.rank == null ? "—" : `rank ${hit.rank}`}</span>
                  </>
                );
                const className = `grid grid-cols-[112px_1fr_72px] items-center gap-3 px-3 py-2 transition hover:bg-accent/40 sm:grid-cols-[112px_88px_1fr_72px] ${index > 0 ? "border-t border-border" : ""}`;
                return hit.videoId ? (
                  <Link key={`${id}-${hit.start}-${index}`} to="/video/$id" params={{ id: hit.videoId }} search={{ m: 0, q, start: hit.start ?? 0 }} className={className}>{row}</Link>
                ) : (
                  <div key={`${index}`} className={className}>{row}</div>
                );
              })}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {grouped.map((group) => {
                const first = group[0]!;
                const id = first.videoId ?? first.filename ?? "unknown";
                const card = (
                  <>
                    <Thumb hue={hueOf(id)} t={first.start ?? 0} big />
                    <p className="mt-2 text-[13px] font-medium">{first.filename ?? id}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">{formatLabel(first.format)} · {first.campaign ?? "no campaign"}</p>
                    <p className="mt-1.5 text-xs text-primary">{group.length} matching moment{group.length > 1 ? "s" : ""}</p>
                  </>
                );
                const className = "rounded-sm border border-border bg-card p-2.5 transition hover:border-primary/50";
                return first.videoId ? (
                  <Link key={id} to="/video/$id" params={{ id: first.videoId }} search={{ m: 0, q, start: first.start ?? 0 }} className={className}>{card}</Link>
                ) : (
                  <div key={id} className={className}>{card}</div>
                );
              })}
            </div>
          )}
          {result?.pageToken && (
            <button onClick={() => { setTokenKey(filterKey); setPageToken(result.pageToken); }} className="mt-3 font-mono text-[11px] text-primary">Next page of this search</button>
          )}
        </section>
      </div>
  );
}
