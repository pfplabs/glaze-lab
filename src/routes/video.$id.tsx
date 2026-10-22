import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { ArrowLeft, Eye, Mic, Pause, Play, Type } from "lucide-react";
import { VIDEOS, fmt, type Video } from "@/lib/library";
import { AppShell, Score } from "@/components/brand";

export const Route = createFileRoute("/video/$id")({
  validateSearch: (s: Record<string, unknown>) => ({
    m: Number(s["m"]) || 0,
    q: typeof s["q"] === "string" ? s["q"] : "",
    start: Number(s["start"]) || 0,
  }),
  loader: ({ params }) => ({
    fixture: VIDEOS.find((v) => v.id === params.id) ?? null,
    id: params.id,
  }),
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.fixture?.title ?? "Video"} — Glaze` },
      { name: "description", content: `Enriched metadata and moments for ${loaderData?.fixture?.title ?? "this video"}.` },
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
  const { fixture, id } = Route.useLoaderData();
  if (!fixture) return <LiveVideo id={id} />;
  return <FixtureVideo video={fixture} />;
}

function FixtureVideo({ video }: { video: Video }) {
  const v = video;
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

type LiveProvenance = {
  modelName: string | null;
  textSource: string | null;
  schema?: string | null;
};

type LiveObservation = {
  startTime: number;
  endTime: number;
  shot: string;
  action: string;
  lighting: string;
  setting: string;
  skinTone: string;
  onScreenText: string;
  spokenMention: string;
  productName: string;
  productLine: string;
  product: { status: string; sku: string | null; line: string | null; reason?: string };
  modelConfidence?: number | null;
  provenance?: LiveProvenance | null;
};

type LiveVideoRecord = {
  filename: string;
  campaign: string | null;
  format: string | null;
  duration: number;
  enrichmentStatus: string;
  confidence: number | null;
  observations: LiveObservation[];
};

function modelLabel(name: string | null | undefined) {
  if (!name) return null;
  if (name === "pegasus1.6") return "Pegasus 1.6";
  return name;
}

function evidenceLine(provenance: LiveProvenance | null | undefined, score: number | null | undefined) {
  const model = modelLabel(provenance?.modelName);
  const source = provenance?.textSource === "model" ? "model-derived" : provenance?.textSource;
  const shown = typeof score === "number" ? `model confidence ${score.toFixed(2)}` : null;
  return [model, source, shown].filter(Boolean).join(" · ");
}

function confidenceLabel(status: string | null | undefined, reason: string | null | undefined) {
  if (!status) return null;
  const name = status === "line_only" ? "line only" : status;
  return reason ? `${name} · ${reason}` : name;
}

function LiveVideo({ id }: { id: string }) {
  const { q, start } = Route.useSearch();
  const mediaRef = useRef<HTMLVideoElement>(null);
  const [video, setVideo] = useState<LiveVideoRecord | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [sel, setSel] = useState(0);
  const [t, setT] = useState(start);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/videos/${encodeURIComponent(id)}`)
      .then(async (res) => {
        if (res.status === 404) {
          if (!cancelled) setMissing(true);
          return null;
        }
        return res.json();
      })
      .then((body) => {
        if (cancelled || !body) return;
        setVideo(body);
        const index = (body.observations as LiveObservation[]).findIndex((item) => start >= item.startTime && start <= item.endTime);
        if (index >= 0) setSel(index);
      })
      .catch(() => { if (!cancelled) setMissing(true); });
    fetch(`/api/videos/${encodeURIComponent(id)}/stream`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.message || "The TwelveLabs stream is unavailable.");
        if (!cancelled) setStreamUrl(body.videoUrl);
      })
      .catch((error: Error) => { if (!cancelled) setStreamError(error.message || "The TwelveLabs stream is unavailable."); });
    return () => { cancelled = true; };
  }, [id, start]);

  useEffect(() => {
    const el = mediaRef.current;
    if (!el || !streamUrl) return;
    let hls: Hls | null = null;
    const seek = () => { if (start > 0) el.currentTime = start; };
    const onTime = () => setT(el.currentTime);
    const onMeta = () => { setDuration(el.duration || 0); seek(); };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    if (el.canPlayType("application/vnd.apple.mpegurl")) {
      el.src = streamUrl;
    } else if (Hls.isSupported()) {
      hls = new Hls();
      hls.loadSource(streamUrl);
      hls.attachMedia(el);
      hls.on(Hls.Events.MANIFEST_PARSED, seek);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) setStreamError("The TwelveLabs stream could not be played.");
      });
    } else {
      setStreamError("This browser cannot play the TwelveLabs stream.");
    }
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      hls?.destroy();
    };
  }, [streamUrl, start]);

  const seekTo = (seconds: number, index: number) => {
    setSel(index);
    setT(seconds);
    const el = mediaRef.current;
    if (!el) return;
    el.currentTime = seconds;
    el.play().catch(() => {});
  };

  if (missing) {
    return (
      <AppShell search={q}>
        <div className="mx-auto w-full max-w-3xl px-6 py-6">
          <Link to="/search" search={{ q }} className="mb-4 inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" />Back to results</Link>
          <h1 className="text-xl font-semibold">No saved video</h1>
          <p className="mt-2 text-sm text-muted-foreground">This moment is on an index this app did not index. There is no TwelveLabs stream to play.</p>
        </div>
      </AppShell>
    );
  }

  const moments = video?.observations ?? [];
  const live = moments.find((item) => t >= item.startTime && t <= item.endTime) ?? null;
  const length = duration || video?.duration || 0;
  const pct = (seconds: number) => `${length ? (seconds / length) * 100 : 0}%`;

  return (
    <AppShell search={q}>
      <div className="mx-auto w-full max-w-7xl px-6 py-6">
        <Link to="/search" search={{ q }} className="mb-4 inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" />Back to results</Link>
        <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
          <div>
            <div className="overflow-hidden rounded-sm border border-border bg-card">
              <video ref={mediaRef} className="aspect-video w-full bg-black" controls playsInline preload="metadata" />
              {streamError && <p className="px-4 py-2 text-xs text-destructive">{streamError}</p>}
              {!streamUrl && !streamError && <p className="px-4 py-2 font-mono text-[11px] text-muted-foreground">Loading the TwelveLabs stream…</p>}
              <div className="flex items-center gap-3 px-4 py-3">
                <span className="font-mono text-xs text-muted-foreground">{fmt(t)} / {fmt(length)}</span>
                <div className="relative h-2 flex-1 cursor-pointer rounded-full bg-muted" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); seekTo(((event.clientX - rect.left) / rect.width) * length, sel); }}>
                  {moments.map((item, index) => <div key={index} className={`absolute h-full rounded-full ${index === sel ? "bg-primary" : "bg-primary/30"}`} style={{ left: pct(item.startTime), width: pct(Math.max(item.endTime - item.startTime, 0)) }} />)}
                  <div className="absolute -top-1 h-4 w-1 rounded bg-foreground" style={{ left: pct(t) }} />
                </div>
              </div>
            </div>
            {live && (
              <div className="mt-4 rounded-sm border border-border bg-card p-4 text-sm">
                <p className="font-medium">{live.productName || live.product.line || live.product.sku || "No catalog match"}</p>
                <p className="mt-1 text-muted-foreground">{[live.product.sku, live.product.line].filter(Boolean).join(" · ") || "No SKU or product line"}</p>
                {confidenceLabel(live.product.status, live.product.reason) && <p className="mt-1 text-muted-foreground">Confidence · {confidenceLabel(live.product.status, live.product.reason)}</p>}
                <p className="mt-2">{[live.shot, live.action === "applied" ? "application" : live.action, live.lighting && live.lighting !== "unknown" ? `${live.lighting} light` : null].filter(Boolean).join(" · ")}</p>
                {live.setting && <p className="mt-1 text-muted-foreground">Setting · {live.setting}</p>}
                {live.productLine && live.productLine !== live.product.line && live.productLine !== live.productName && <p className="mt-1 text-muted-foreground">Line · {live.productLine}</p>}
                {live.onScreenText && <p className="mt-2 font-mono text-xs">On screen · {live.onScreenText}</p>}
                {live.spokenMention && <p className="mt-1 text-xs italic text-muted-foreground">Spoken · {live.spokenMention}</p>}
                <p className="mt-2 text-[11px] text-muted-foreground">{evidenceLine(live.provenance, live.modelConfidence)}</p>
              </div>
            )}
          </div>
          <aside className="flex flex-col gap-5 lg:sticky lg:top-[5.75rem] lg:max-h-[calc(100dvh-12.25rem)]">
            <div className="shrink-0">
              <h1 className="text-xl font-semibold leading-tight">{video?.filename ?? "Loading the saved record…"}</h1>
              <dl className="mt-3 grid grid-cols-2 gap-y-2 text-xs">
                {[["Format", video?.format ?? "unknown"], ["Campaign", video?.campaign ?? "none"], ["Duration", fmt(video?.duration ?? length)], ["Enrichment", video?.enrichmentStatus ?? "…"], ["Observations", String(moments.length)]].map(([label, value]) => (
                  <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="font-medium">{value}</dd></div>
                ))}
              </dl>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              <h2 className="mb-2 shrink-0 text-xs uppercase tracking-wider text-muted-foreground">Observations</h2>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-1">
                {moments.length === 0 && <p className="text-xs text-muted-foreground">Enrichment has no observation for this video.</p>}
                {moments.map((item, index) => (
                  <button key={index} onClick={() => seekTo(item.startTime, index)} className={`w-full rounded-sm border p-3 text-left ${index === sel ? "border-primary bg-accent/40" : "border-border"}`}>
                    <p className="font-mono text-xs text-primary">{fmt(item.startTime)} – {fmt(item.endTime)}</p>
                    <p className="text-sm font-medium">{item.productName || item.product.line || item.product.sku || "No catalog match"}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">{[
                      item.product.sku,
                      item.product.line,
                      item.productLine && item.productLine !== item.product.line ? `line ${item.productLine}` : null,
                      item.action === "applied" ? "application" : item.action,
                      item.shot,
                      item.lighting && item.lighting !== "unknown" ? `${item.lighting} light` : null,
                      item.setting ? `setting ${item.setting}` : null,
                      item.skinTone ? `${item.skinTone} skin` : null,
                    ].filter(Boolean).join(" · ") || "No SKU or product line"}</p>
                    {confidenceLabel(item.product.status, item.product.reason) && <p className="mt-1 text-[11px] text-muted-foreground">Confidence · {confidenceLabel(item.product.status, item.product.reason)}</p>}
                    {item.onScreenText && <p className="mt-1 font-mono text-[11px] text-muted-foreground">On screen · {item.onScreenText}</p>}
                    {item.spokenMention && <p className="mt-1 text-[11px] italic text-muted-foreground">Spoken · {item.spokenMention}</p>}
                    <p className="mt-1 text-[10px] text-muted-foreground">{evidenceLine(item.provenance, item.modelConfidence)}</p>
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
