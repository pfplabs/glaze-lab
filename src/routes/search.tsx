import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ATTRS, CAMPAIGNS, FORMATS, SKUS, fmt, search } from "@/lib/library";
import { AppShell, Chip, MiniTimeline, Score, Thumb } from "@/components/brand";

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

function Facet({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{title}</h3><div className="flex flex-wrap gap-1">{children}</div></div>;
}

function SearchPage() {
  const { q } = Route.useSearch();
  const [formats, setFormats] = useState<string[]>([]);
  const [attrs, setAttrs] = useState<string[]>([]);
  const [skus, setSkus] = useState<string[]>([]);
  const [campaigns, setCampaigns] = useState<string[]>([]);
  const [minConf, setMinConf] = useState(0.75);
  const [view, setView] = useState<"moments" | "videos">("moments");
  const toggle = (arr: string[], set: (v: string[]) => void, v: string) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const hits = useMemo(() => search(q, { formats, attrs, skus, campaigns, minConf }), [q, formats, attrs, skus, campaigns, minConf]);
  const grouped = useMemo(() => {
    const m = new Map<string, typeof hits>();
    hits.forEach((h) => m.set(h.video.id, [...(m.get(h.video.id) ?? []), h]));
    return [...m.values()];
  }, [hits]);

  return (
    <AppShell search={q}>
      <div className="mx-auto grid w-full max-w-7xl gap-6 px-5 py-4 md:grid-cols-[200px_1fr]">
        <aside className="space-y-4 text-[13px]">
          <Facet title="Format">{FORMATS.map((f) => <Chip key={f} on={formats.includes(f)} onClick={() => toggle(formats, setFormats, f)}>{f}</Chip>)}</Facet>
          <Facet title="Visual attributes">{ATTRS.map((f) => <Chip key={f} on={attrs.includes(f)} onClick={() => toggle(attrs, setAttrs, f)}>{f}</Chip>)}</Facet>
          <Facet title="Product SKU">{SKUS.map((f) => <Chip key={f} on={skus.includes(f)} onClick={() => toggle(skus, setSkus, f)}>{f}</Chip>)}</Facet>
          <Facet title="Campaign">{CAMPAIGNS.map((f) => <Chip key={f} on={campaigns.includes(f)} onClick={() => toggle(campaigns, setCampaigns, f)}>{f}</Chip>)}</Facet>
          <div>
            <h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Min confidence · {Math.round(minConf * 100)}%</h3>
            <input type="range" min={0.5} max={0.99} step={0.01} value={minConf} onChange={(e) => setMinConf(+e.target.value)} className="w-full accent-[var(--primary)]" />
          </div>
        </aside>
        <section>
          <div className="mb-3 flex items-center justify-between border-b border-border pb-2">
            <p className="text-[13px] text-muted-foreground"><span className="font-mono tabular-nums text-foreground">{hits.length}</span> moments in <span className="font-mono tabular-nums text-foreground">{grouped.length}</span> videos{q && <> for “{q}”</>}</p>
            <div className="flex rounded-sm border border-border p-px text-xs">
              {(["moments", "videos"] as const).map((v) => <button key={v} onClick={() => setView(v)} className={`rounded-sm px-2.5 py-0.5 capitalize ${view === v ? "bg-secondary text-foreground" : "text-muted-foreground"}`}>{v}</button>)}
            </div>
          </div>
          {hits.length === 0 && <div className="rounded-sm border border-dashed border-border p-10 text-center text-[13px] text-muted-foreground">No moments match. Try loosening filters.</div>}

          {view === "moments" ? (
            <div className="overflow-hidden rounded-sm border border-border bg-card">
              <div className="hidden grid-cols-[112px_64px_1fr_64px] gap-3 border-b border-border bg-muted/60 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground sm:grid">
                <span>Preview</span><span>Start</span><span>Moment</span><span className="text-right">Conf.</span>
              </div>
              {hits.map((h, i) => {
                const idx = h.video.moments.indexOf(h.moment);
                return (
                  <Link key={i} to="/video/$id" params={{ id: h.video.id }} search={{ m: idx, q }} className={`grid grid-cols-[112px_1fr_64px] items-center gap-3 px-3 py-2 transition hover:bg-accent/40 sm:grid-cols-[112px_64px_1fr_64px] ${i > 0 ? "border-t border-border" : ""}`}>
                    <Thumb hue={h.video.hue} t={h.moment.start} />
                    <span className="hidden font-mono text-xs tabular-nums text-muted-foreground sm:block">{fmt(h.moment.start)}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-[13px] font-medium">{h.moment.label}</p>
                        {h.moment.skus.map((s) => <span key={s} className="rounded-sm border border-border px-1 font-mono text-[10px]">{s}</span>)}
                      </div>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">{h.video.title} · {h.video.format} · {h.video.campaign}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {h.moment.attributes.map((a) => <span key={a} className={`rounded-sm px-1 py-px text-[10px] ${h.matched.some((m) => a.includes(m.replace(/s$/, ""))) ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"}`}>{a}</span>)}
                      </div>
                      <MiniTimeline video={h.video} active={idx} />
                    </div>
                    <span className="text-right"><Score v={h.moment.confidence} /></span>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {grouped.map((g) => {
                const first = g[0]!; const v = first.video;
                return (
                  <Link key={v.id} to="/video/$id" params={{ id: v.id }} search={{ m: v.moments.indexOf(first.moment), q }} className="rounded-sm border border-border bg-card p-2.5 transition hover:border-primary/50">
                    <Thumb hue={v.hue} t={first.moment.start} big />
                    <p className="mt-2 text-[13px] font-medium">{v.title}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">{v.format} · {v.campaign}</p>
                    <MiniTimeline video={v} />
                    <p className="mt-1.5 text-xs text-primary">{g.length} matching moment{g.length > 1 ? "s" : ""}</p>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
