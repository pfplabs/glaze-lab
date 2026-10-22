import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
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
  thumbnailUrl: string | null;
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
  campaigns: string[];
  productStatuses: string[];
};

type CatalogProduct = {
  id: string;
  brand: string | null;
  name: string;
  line: string | null;
  shade: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  candidate: "candidate",
  line_only: "line only",
  unresolved: "unresolved",
};

function Facet({ title, children, stack }: { title: string; children: React.ReactNode; stack?: boolean }) {
  return <div><h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{title}</h3><div className={stack ? "block" : "flex flex-wrap gap-1"}>{children}</div></div>;
}

function productLabel(product: CatalogProduct) {
  return [product.brand, product.name, product.shade].filter(Boolean).join(" · ");
}

function SkuFinder({ selected, onChange }: { selected: string[]; onChange: (next: string[]) => void }) {
  const [needle, setNeedle] = useState("");
  const [matches, setMatches] = useState<CatalogProduct[]>([]);
  const [lookup, setLookup] = useState<"idle" | "pending" | "done">("idle");

  useEffect(() => {
    const query = needle.trim();
    if (query.length < 2) {
      setMatches([]);
      setLookup("idle");
      return;
    }
    const controller = new AbortController();
    setLookup("pending");
    const timer = setTimeout(() => {
      fetch(`/api/catalog?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((res) => res.json())
        .then((body) => {
          setMatches((body.products ?? []).filter((item: CatalogProduct) => !selected.includes(item.id)));
          setLookup("done");
        })
        .catch((error: Error) => { if (error.name !== "AbortError") { setMatches([]); setLookup("done"); } });
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [needle, selected]);

  const choose = (id: string) => {
    onChange([...selected, id]);
    setNeedle("");
    setMatches([]);
  };

  return (
    <div>
      {selected.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {selected.map((id) => <Chip key={id} on onClick={() => onChange(selected.filter((item) => item !== id))}>{id}</Chip>)}
        </div>
      )}
      <input
        value={needle}
        onChange={(event) => setNeedle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && matches[0]) {
            event.preventDefault();
            choose(matches[0].id);
          }
        }}
        placeholder="Name, shade, or SKU"
        aria-label="Find a product"
        className="w-full rounded-sm border border-border bg-background px-2 py-1 text-xs outline-none placeholder:text-muted-foreground focus:border-foreground/40"
      />
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">Matches the catalog, then keeps moments that name the product.</p>
      {lookup === "done" && needle.trim().length >= 2 && matches.length === 0 && <p className="mt-1 text-[11px] text-muted-foreground">No catalog product matches.</p>}
      {matches.length > 0 && (
        <div className="mt-1 overflow-hidden rounded-sm border border-border bg-background">
          {matches.map((product) => (
            <button key={product.id} type="button" onClick={() => choose(product.id)} className="block w-full border-t border-border px-2 py-1.5 text-left first:border-t-0 hover:bg-accent/40">
              <span className="block font-mono text-[10px] text-primary">{product.id}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{productLabel(product)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function hueOf(id: string) {
  let n = 0;
  for (const ch of id) n = (n + ch.charCodeAt(0) * 17) % 360;
  return n;
}

const streamUrls = new Map<string, Promise<string | null>>();

function streamUrl(videoId: string) {
  const cached = streamUrls.get(videoId);
  if (cached) return cached;
  const pending = fetch(`/api/videos/${encodeURIComponent(videoId)}/stream`)
    .then(async (res) => {
      const body = await res.json().catch(() => null);
      return res.ok && body && typeof body.videoUrl === "string" ? body.videoUrl : null;
    })
    .catch(() => null);
  streamUrls.set(videoId, pending);
  return pending;
}

function clipBounds(start: number | null, end: number | null) {
  const from = Math.max(0, start ?? 0);
  const until = end != null && end > from + 0.4 ? end : from + 3;
  return { from, until };
}

function MomentThumb({ hit, big }: { hit: Hit; big?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<Hls | null>(null);
  const sessionRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const id = hit.videoId ?? "unknown";

  const release = () => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    playerRef.current?.destroy();
    playerRef.current = null;
    const el = videoRef.current;
    if (!el) return;
    el.onloadedmetadata = null;
    el.ontimeupdate = null;
    el.pause();
    el.removeAttribute("src");
    el.load();
  };

  const releaseRef = useRef(release);
  releaseRef.current = release;

  useEffect(() => () => {
    sessionRef.current += 1;
    releaseRef.current();
  }, []);

  const stop = () => {
    sessionRef.current += 1;
    release();
    setPreviewing(false);
    setPlayhead(null);
  };

  const play = async (session: number) => {
    if (!hit.videoId) return;
    const url = await streamUrl(hit.videoId);
    const el = videoRef.current;
    if (session !== sessionRef.current || !url || !el) return;
    const { from, until } = clipBounds(hit.start, hit.end);
    el.muted = true;
    const inClip = () => Number.isFinite(el.currentTime) && el.currentTime + 0.25 >= from && el.currentTime < until;
    el.ontimeupdate = () => {
      if (session !== sessionRef.current) return;
      if (!inClip()) {
        if (Number.isFinite(el.currentTime)) el.currentTime = from;
        return;
      }
      if (el.currentTime >= until - 0.05) {
        el.currentTime = from;
        return;
      }
      setPreviewing(true);
      setPlayhead(el.currentTime);
    };
    const begin = () => {
      if (session !== sessionRef.current) return;
      if (Number.isFinite(el.currentTime) && Math.abs(el.currentTime - from) > 0.35) el.currentTime = from;
      el.play().catch(() => {});
    };
    if (Hls.isSupported()) {
      const hls = new Hls({ startPosition: from, capLevelToPlayerSize: true, maxBufferLength: 8 });
      playerRef.current = hls;
      hls.loadSource(url);
      hls.attachMedia(el);
      hls.on(Hls.Events.MANIFEST_PARSED, begin);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal && session === sessionRef.current) window.setTimeout(() => { if (session === sessionRef.current) stop(); }, 0);
      });
      return;
    }
    if (!el.canPlayType("application/vnd.apple.mpegurl")) return;
    el.preload = "auto";
    el.onloadedmetadata = begin;
    el.src = url;
    void el.play().catch(() => {});
  };

  return (
    <Thumb
      hue={hueOf(id)}
      t={playhead ?? hit.start ?? 0}
      src={hit.thumbnailUrl}
      big={big}
      previewing={previewing}
      onMouseEnter={() => {
        if (!hit.videoId) return;
        const session = sessionRef.current;
        timerRef.current = window.setTimeout(() => { void play(session); }, 160);
      }}
      onMouseLeave={stop}
    >
      <video ref={videoRef} muted playsInline preload="none" className={`pointer-events-none absolute inset-0 h-full w-full object-cover ${previewing ? "opacity-100" : "opacity-0"}`} />
    </Thumb>
  );
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
    if (!q.trim() && skus.length === 0) {
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
      <div className="mx-auto grid w-full max-w-7xl gap-6 px-5 py-4 md:grid-cols-[240px_1fr]">
        <aside className="space-y-4 text-[13px]">
          <Facet title="Format">
            {(facets?.formats ?? ["Tutorial", "Demo", "Ad", "Before/After"]).map((item) => <Chip key={item} on={formats.includes(item)} onClick={() => toggle(formats, setFormats, item)}>{item}</Chip>)}
            {(facets?.disabledFormats ?? ["Creator"]).map((item) => <Chip key={item} on={false} disabled>{item}</Chip>)}
          </Facet>
          <Facet title="Visual attributes">
            {(facets?.attributes ?? ["application", "close-up", "packshot", "natural lighting", "studio lighting"]).map((item) => <Chip key={item} on={attrs.includes(item)} onClick={() => toggle(attrs, setAttrs, item)}>{item}</Chip>)}
          </Facet>
          <Facet title="Product" stack>
            <SkuFinder selected={skus} onChange={(next) => { setSkus(next); setPageToken(null); }} />
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
          {!q.trim() && skus.length === 0 && <div className="rounded-sm border border-dashed border-border p-10 text-center text-[13px] text-muted-foreground">Describe a moment, or find a product to list the videos that name it.</div>}
          {!error && (q.trim() || skus.length > 0) && !loading && hits.length === 0 && (
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
                    <MomentThumb hit={hit} />
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
                    <MomentThumb hit={first} big />
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
