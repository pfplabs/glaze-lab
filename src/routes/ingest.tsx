import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { Check, FileVideo, Upload } from "lucide-react";
import { AppShell } from "@/components/brand";

export const Route = createFileRoute("/ingest")({
  head: () => ({
    meta: [
      { title: "Ingestion — Glaze" },
      { name: "description", content: "Ingestion queue for the marketing video library. Mark files as ingested and track enrichment status." },
      { property: "og:title", content: "Ingestion — Glaze" },
      { property: "og:description", content: "Ingestion queue for the marketing video library." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: IngestPage,
});

type Status = "queued" | "processing" | "ingested" | "failed";

type IngestFile = {
  id: string;
  name: string;
  format: string;
  duration: string;
  size: string;
  campaign: string;
  status: Status;
  ingestedAt: string | null;
};

const INITIAL: IngestFile[] = [
  { id: "f1", name: "velvet-matte-fw26_hero-30s_v3.mp4", format: "Ad", duration: "0:30", size: "48.2 MB", campaign: "Velvet Matte FW26", status: "ingested", ingestedAt: "2026-10-20 18:42" },
  { id: "f2", name: "second-skin_ss26_tutorial_full.mp4", format: "Tutorial", duration: "5:12", size: "312 MB", campaign: "Second Skin SS26", status: "ingested", ingestedAt: "2026-10-20 17:15" },
  { id: "f3", name: "bond-repair_before-after_15s.mp4", format: "Before/After", duration: "0:15", size: "22.7 MB", campaign: "Bond Repair 2026", status: "processing", ingestedAt: null },
  { id: "f4", name: "hydra-glow_texture-demo_vertical.mp4", format: "Demo", duration: "1:04", size: "96.5 MB", campaign: "Hydra Glow", status: "queued", ingestedAt: null },
  { id: "f5", name: "night-out-glam_creator-cut.mp4", format: "Creator", duration: "3:48", size: "204 MB", campaign: "Velvet Matte FW26", status: "queued", ingestedAt: null },
  { id: "f6", name: "crimson-112_packshot_loop.mp4", format: "Demo", duration: "0:08", size: "11.3 MB", campaign: "Velvet Matte FW26", status: "failed", ingestedAt: null },
];

const STATUS_STYLE: Record<Status, string> = {
  queued: "border-border bg-muted text-muted-foreground",
  processing: "border-primary/40 bg-accent text-accent-foreground",
  ingested: "border-chart-2/40 bg-chart-2/10 text-chart-2",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
};

function nowStamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function IngestPage() {
  const [files, setFiles] = useState<IngestFile[]>(INITIAL);
  const [filter, setFilter] = useState<Status | "all">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const nextId = useRef(7);
  const fileInput = useRef<HTMLInputElement>(null);

  const counts = useMemo(() => {
    const c: Record<Status, number> = { queued: 0, processing: 0, ingested: 0, failed: 0 };
    files.forEach((f) => c[f.status]++);
    return c;
  }, [files]);

  const visible = filter === "all" ? files : files.filter((f) => f.status === filter);

  const markIngested = (ids: string[]) => {
    const stamp = nowStamp();
    setFiles((fs) => fs.map((f) => (ids.includes(f.id) && f.status !== "ingested" ? { ...f, status: "ingested", ingestedAt: stamp } : f)));
    setSelected(new Set());
  };

  const toggleSel = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const added: IngestFile[] = [...list].map((f) => ({
      id: `f${nextId.current++}`,
      name: f.name,
      format: "—",
      duration: "—",
      size: `${(f.size / 1e6).toFixed(1)} MB`,
      campaign: "Unassigned",
      status: "queued" as Status,
      ingestedAt: null,
    }));
    setFiles((fs) => [...added, ...fs]);
  };

  const selectedActionable = files.filter((f) => selected.has(f.id) && f.status !== "ingested");

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold tracking-tight">Ingestion queue</h1>
            <p className="mt-0.5 text-[13px] text-muted-foreground">Incoming video files awaiting enrichment. Mark files ingested once they're indexed and searchable.</p>
          </div>
          <div className="flex items-center gap-2">
            {selectedActionable.length > 0 && (
              <button onClick={() => markIngested(selectedActionable.map((f) => f.id))} className="gloss-btn flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-white">
                <Check className="h-3.5 w-3.5" />Mark {selectedActionable.length} ingested
              </button>
            )}
            <button onClick={() => fileInput.current?.click()} className="flex items-center gap-1.5 rounded-sm border border-border bg-card px-3 py-1.5 text-xs font-medium hover:border-primary/50">
              <Upload className="h-3.5 w-3.5" />Add files
            </button>
            <input ref={fileInput} type="file" multiple accept="video/*" className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-1">
          {(["all", "queued", "processing", "ingested", "failed"] as const).map((s) => (
            <button key={s} onClick={() => setFilter(s)} className={`rounded-sm border px-2 py-0.5 font-mono text-[11px] capitalize ${filter === s ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}>
              {s}{s !== "all" && <span className="ml-1 tabular-nums">{counts[s]}</span>}
            </button>
          ))}
        </div>

        <div className="mt-3 overflow-hidden rounded-sm border border-border bg-card">
          <div className="grid grid-cols-[28px_1fr_90px_70px_90px_140px_110px_120px] items-center gap-3 border-b border-border bg-muted/60 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground max-lg:hidden">
            <span /><span>File</span><span>Format</span><span>Length</span><span>Size</span><span>Campaign</span><span>Status</span><span className="text-right">Ingested at</span>
          </div>
          {visible.length === 0 && <p className="p-8 text-center text-[13px] text-muted-foreground">No files with this status.</p>}
          {visible.map((f, i) => (
            <div key={f.id} className={`grid grid-cols-[28px_1fr_110px_120px] items-center gap-3 px-3 py-2 lg:grid-cols-[28px_1fr_90px_70px_90px_140px_110px_120px] ${i > 0 ? "border-t border-border" : ""} ${selected.has(f.id) ? "bg-accent/30" : ""}`}>
              <input type="checkbox" checked={selected.has(f.id)} onChange={() => toggleSel(f.id)} disabled={f.status === "ingested"} className="h-3.5 w-3.5 accent-[var(--primary)] disabled:opacity-30" />
              <div className="flex min-w-0 items-center gap-2">
                <FileVideo className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate font-mono text-xs">{f.name}</span>
              </div>
              <span className="text-xs text-muted-foreground max-lg:hidden">{f.format}</span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground max-lg:hidden">{f.duration}</span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground max-lg:hidden">{f.size}</span>
              <span className="truncate text-xs text-muted-foreground max-lg:hidden">{f.campaign}</span>
              <span className={`w-fit rounded-sm border px-1.5 py-px font-mono text-[10px] uppercase ${STATUS_STYLE[f.status]}`}>{f.status}</span>
              <span className="text-right">
                {f.status === "ingested" ? (
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{f.ingestedAt}</span>
                ) : (
                  <button onClick={() => markIngested([f.id])} className="rounded-sm border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary/50 hover:text-foreground">Mark ingested</button>
                )}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 font-mono text-[10px] text-muted-foreground">Timestamps UTC · marking a file ingested makes it searchable once enrichment completes · sample data</p>
      </main>
    </AppShell>
  );
}
