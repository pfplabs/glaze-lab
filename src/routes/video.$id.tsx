import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Eye, Mic, Pause, Play, Type } from "lucide-react";
import { VIDEOS, fmt } from "@/lib/library";
import { AppShell, Score } from "@/components/brand";

export const Route = createFileRoute("/video/$id")({
  validateSearch: (s: Record<string, unknown>) => ({ m: Number(s["m"]) || 0, q: typeof s["q"] === "string" ? s["q"] : "" }),
  loader: ({ params }) => {
    const video = VIDEOS.find((v) => v.id === params.id);
    if (!video) throw notFound();
    return video;
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.title ?? "Video"} — Glaze` },
      { name: "description", content: `Enriched metadata and moments for ${loaderData?.title ?? "this video"}.` },
      { property: "og:title", content: `${loaderData?.title ?? "Video"} — Glaze` },
      { property: "og:description", content: "Moment-level metadata, products, transcript and on-screen text." },
      { property: "og:type", content: "video.other" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  notFoundComponent: () => <div className="p-12 text-center">Video not found. <Link to="/" className="text-primary">Go home</Link></div>,
  errorComponent: () => <div className="p-12 text-center">Couldn't load this video.</div>,
  component: VideoPage,
});

const PROV = { visual: Eye, speech: Mic, ocr: Type } as const;
const PROV_LABEL = { visual: "Visual", speech: "Speech", ocr: "On-screen text" } as const;

function VideoPage() {
  const v = Route.useLoaderData();
  const { m, q } = Route.useSearch();
  const [sel, setSel] = useState(Math.min(m, v.moments.length - 1));
  const [t, setT] = useState(v.moments[sel]?.start ?? 0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setT((x) => (x + 0.25 >= v.duration ? (setPlaying(false), v.duration) : x + 0.25)), 250);
    return () => clearInterval(id);
  }, [playing, v.duration]);

  const seek = (i: number) => { setSel(i); setT(v.moments[i]!.start); setPlaying(true); };
  const current = v.moments.findIndex((x) => t >= x.start && t <= x.end);
  const live = current >= 0 ? v.moments[current] : null;
  const pct = (s: number) => `${(s / v.duration) * 100}%`;
  const allSkus = [...new Set(v.moments.flatMap((x) => x.skus))];
  const allAttrs = [...new Set(v.moments.flatMap((x) => x.attributes))];

  return (
    <AppShell search={q}>
      <div className="mx-auto w-full max-w-7xl px-6 py-6">
        <Link to="/search" search={{ q }} className="mb-4 inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" />Back to results</Link>
        <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
          <div>
            {/* Player */}
            <div className="overflow-hidden rounded-sm border border-border bg-card">
              <div className="thumb relative aspect-video" style={{ "--h": v.hue } as React.CSSProperties}>
                {live && (
                  <div className="absolute left-4 top-4 max-w-sm rounded-sm bg-background/85 px-3 py-2 text-xs backdrop-blur">
                    <p className="font-medium text-foreground">{live.label}</p>
                    <p className="mt-0.5 text-muted-foreground">{live.skus.join(" · ") || "No SKU detected"}</p>
                  </div>
                )}
                {live?.ocr && <div className="absolute bottom-16 left-1/2 -translate-x-1/2 rounded border-2 border-dashed border-primary-foreground/80 px-3 py-1 font-mono text-xs text-primary-foreground">{live.ocr}</div>}
                <button onClick={() => setPlaying(!playing)} className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-background/80 text-foreground backdrop-blur" aria-label={playing ? "Pause" : "Play"}>
                  {playing ? <Pause className="h-6 w-6" /> : <Play className="ml-1 h-6 w-6" />}
                </button>
                {live?.transcript && <p className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded bg-foreground/75 px-3 py-1 text-sm text-background">{live.transcript}</p>}
              </div>
              <div className="flex items-center gap-3 px-4 py-3">
                <button onClick={() => setPlaying(!playing)} aria-label="Toggle playback">{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</button>
                <span className="font-mono text-xs text-muted-foreground">{fmt(t)} / {fmt(v.duration)}</span>
                <div className="relative h-2 flex-1 cursor-pointer rounded-full bg-muted" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setT(((e.clientX - r.left) / r.width) * v.duration); }}>
                  {v.moments.map((x, i) => <div key={i} className={`absolute h-full rounded-full ${i === sel ? "bg-primary" : "bg-primary/30"}`} style={{ left: pct(x.start), width: pct(x.end - x.start) }} />)}
                  <div className="absolute -top-1 h-4 w-1 rounded bg-foreground" style={{ left: pct(t) }} />
                </div>
              </div>
            </div>

            {/* Signal lanes */}
            <div className="mt-6 rounded-sm border border-border bg-card p-5">
              <h2 className="mb-4 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Where things are</h2>
              <div className="space-y-3">
                {[["Products", allSkus, (x: typeof v.moments[0], k: string) => x.skus.includes(k)], ["Attributes", allAttrs, (x: typeof v.moments[0], k: string) => x.attributes.includes(k)]].flatMap(([group, keys, has]) =>
                  (keys as string[]).map((k) => (
                    <div key={`${group}-${k}`} className="grid grid-cols-[140px_1fr] items-center gap-3">
                      <span className={`truncate text-xs ${group === "Products" ? "font-mono" : ""}`}>{k}</span>
                      <div className="relative h-4 rounded bg-muted">
                        {v.moments.map((x, i) => (has as (a: typeof x, b: string) => boolean)(x, k) && (
                          <button key={i} onClick={() => seek(i)} title={`${fmt(x.start)}–${fmt(x.end)}`} className={`absolute h-full rounded ${i === sel ? "bg-primary" : "bg-primary/40 hover:bg-primary/70"}`} style={{ left: pct(x.start), width: `max(${pct(x.end - x.start)}, 6px)` }} />
                        ))}
                        <div className="pointer-events-none absolute top-0 h-full w-px bg-foreground" style={{ left: pct(t) }} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Metadata */}
          <aside className="space-y-5">
            <div>
              <h1 className="text-xl font-semibold leading-tight">{v.title}</h1>
              <dl className="mt-3 grid grid-cols-2 gap-y-2 text-xs">
                {[["Format", v.format], ["Campaign", v.campaign], ["Channel", v.channel], ["Duration", fmt(v.duration)], ["Moments", String(v.moments.length)], ["Products", String(allSkus.length)]].map(([a, b]) => (
                  <div key={a}><dt className="text-muted-foreground">{a}</dt><dd className="font-medium">{b}</dd></div>
                ))}
              </dl>
            </div>
            <div>
              <h2 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Moments</h2>
              <div className="space-y-2">
                {v.moments.map((x, i) => (
                  <button key={i} onClick={() => seek(i)} className={`w-full rounded-sm border p-3 text-left transition ${i === sel ? "border-primary bg-accent/40" : "border-border hover:border-primary/40"} ${i === current ? "ring-2 ring-primary/30" : ""}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div><p className="font-mono text-xs text-primary">{fmt(x.start)} – {fmt(x.end)}</p><p className="text-sm font-medium">{x.label}</p></div>
                      <Score v={x.confidence} />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">{x.attributes.map((a) => <span key={a} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{a}</span>)}</div>
                    <div className="mt-2 flex gap-3 text-[11px] text-muted-foreground">
                      {x.provenance.map((p) => { const I = PROV[p]; return <span key={p} className="flex items-center gap-1"><I className="h-3 w-3" />{PROV_LABEL[p]}</span>; })}
                    </div>
                    {x.transcript && <p className="mt-2 text-xs italic text-muted-foreground">“{x.transcript}”</p>}
                    {x.ocr && <p className="mt-1 font-mono text-[11px] text-muted-foreground">OCR · {x.ocr}</p>}
                  </button>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
