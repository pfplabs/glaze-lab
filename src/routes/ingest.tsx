import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { FileVideo, Upload } from "lucide-react";
import { AppShell, useSelectedIndex } from "@/components/brand";
import { fmt } from "@/lib/library";

export const Route = createFileRoute("/ingest")({
  head: () => ({
    meta: [
      { title: "Ingestion — Glaze" },
      { name: "description", content: "Upload videos into an index created by this app." },
      { property: "og:title", content: "Ingestion — Glaze" },
      { property: "og:description", content: "Upload videos into an index created by this app." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: IngestPage,
});

type Job = {
  id: string;
  stage: string;
  sourceFileName: string;
  bytes: number;
  durationSeconds: number | null;
  campaign: string | null;
  indexId: string | null;
  updatedAt: string;
  error: { message: string } | null;
  enrichmentStatus: string;
  enrichmentFormat: string | null;
  observationCount: number;
  enrichmentError: string | null;
};

const STAGE_STYLE: Record<string, string> = {
  indexed: "border-chart-2/40 bg-chart-2/10 text-chart-2",
  ready: "border-chart-2/40 bg-chart-2/10 text-chart-2",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
};

function enrichmentLabel(job: Job) {
  if (job.enrichmentStatus === "ready" && job.enrichmentFormat) {
    return `ready · ${job.enrichmentFormat.replaceAll("_", "/")}`;
  }
  return job.enrichmentStatus.replaceAll("_", " ");
}

function stamp(value: string) {
  return value.replace("T", " ").slice(0, 16);
}

function IngestPage() {
  return (
    <AppShell>
      <IngestBody />
    </AppShell>
  );
}

function IngestBody() {
  const selection = useSelectedIndex();
  const selected = selection?.selected ?? null;
  const [jobs, setJobs] = useState<Job[]>([]);
  const [filter, setFilter] = useState<"all" | "working" | "indexed" | "failed">("all");
  const [campaign, setCampaign] = useState("");
  const [message, setMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const acceptsVideos = Boolean(selected?.acceptsVideos);

  const load = async () => {
    const jobsResponse = await fetch("/api/ingestions");
    if (!jobsResponse.ok) throw new Error("API not running");
    const body = (await jobsResponse.json()) as { jobs: Job[] };
    setJobs(body.jobs);
  };

  useEffect(() => {
    let cancelled = false;
    const tick = () => load().catch(() => { if (!cancelled) setMessage("API not running"); });
    tick();
    const timer = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const onIndex = useMemo(
    () => (selected ? jobs.filter((job) => job.indexId === selected.id) : []),
    [jobs, selected],
  );

  const counts = useMemo(() => {
    const working = onIndex.filter((job) => job.stage !== "indexed" && job.stage !== "failed").length;
    return {
      working,
      indexed: onIndex.filter((job) => job.stage === "indexed").length,
      failed: onIndex.filter((job) => job.stage === "failed").length,
    };
  }, [onIndex]);

  const visible = onIndex.filter((job) => {
    if (filter === "indexed" || filter === "failed") return job.stage === filter;
    if (filter === "working") return job.stage !== "indexed" && job.stage !== "failed";
    return true;
  });

  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    if (!acceptsVideos) {
      setMessage("Create an index in the bar above before adding a video. Indexes from elsewhere are not accepted.");
      return;
    }
    setMessage("");
    for (const file of [...list]) {
      const params = new URLSearchParams({ name: file.name });
      if (campaign.trim()) params.set("campaign", campaign.trim());
      const response = await fetch(`/api/ingestions?${params}`, { method: "POST", body: file });
      const body = (await response.json()) as { message?: string };
      if (!response.ok) setMessage(body.message ?? "Upload failed.");
    }
    await load().catch(() => setMessage("API not running"));
  };

  const retry = async (id: string) => {
    const response = await fetch(`/api/ingestions/${id}/retry`, { method: "POST" });
    const body = (await response.json()) as { message?: string };
    if (!response.ok) setMessage(body.message ?? "Retry failed.");
    await load().catch(() => setMessage("API not running"));
  };

  return (
      <main className="mx-auto w-full max-w-6xl px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 max-w-xl">
            <h1 className="text-base font-semibold tracking-tight">Ingestion queue</h1>
            <p className="mt-0.5 text-[13px] text-muted-foreground">{selected ? `Queue for ${selected.name}.` : "Loading the selected index."} Only an index created in this app can receive a video. Enrichment starts after indexing finishes.</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={campaign}
              onChange={(event) => setCampaign(event.target.value)}
              placeholder="Campaign"
              aria-label="Campaign"
              className="w-36 rounded-sm border border-border bg-card px-2 py-1.5 text-xs outline-none"
            />
            <button
              type="button"
              disabled={!acceptsVideos}
              title={acceptsVideos ? "Add videos to the selected index" : "Uploads are off for the selected index"}
              onClick={() => fileInput.current?.click()}
              className={`flex items-center gap-1.5 rounded-sm border border-border bg-card px-3 py-1.5 text-xs font-medium ${acceptsVideos ? "hover:border-primary/50" : "cursor-not-allowed opacity-40"}`}
            >
              <Upload className="h-3.5 w-3.5" />Add files
            </button>
            <input ref={fileInput} type="file" multiple accept="video/*" className="hidden" onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }} />
          </div>
        </div>
        {message && <p className="mt-3 rounded-sm border border-destructive/40 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">{message}</p>}

        <div className="mt-4 flex flex-wrap items-center gap-1">
          {([
            ["all", "all"],
            ["working", `working ${counts.working}`],
            ["indexed", `indexed ${counts.indexed}`],
            ["failed", `failed ${counts.failed}`],
          ] as const).map(([id, label]) => (
            <button key={id} onClick={() => setFilter(id)} className={`rounded-sm border px-2 py-0.5 font-mono text-[11px] ${filter === id ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="mt-3 overflow-hidden rounded-sm border border-border bg-card">
          <div className="grid grid-cols-[1fr_70px_72px_110px_100px_90px_120px_130px] items-center gap-3 border-b border-border bg-muted/60 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground max-lg:hidden">
            <span>File</span><span>Length</span><span>Size</span><span>Campaign</span><span>Index</span><span>Stage</span><span>Enrichment</span><span className="text-right">Updated</span>
          </div>
          {visible.length === 0 && <p className="p-8 text-center text-[13px] text-muted-foreground">{selected ? `No videos on ${selected.name}.` : "Loading the queue."}</p>}
          {visible.map((job, i) => (
            <div key={job.id} className={`grid grid-cols-[1fr_110px_140px] items-center gap-3 px-3 py-2 lg:grid-cols-[1fr_70px_72px_110px_100px_90px_120px_130px] ${i > 0 ? "border-t border-border" : ""}`}>
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <FileVideo className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate font-mono text-xs">{job.sourceFileName}</span>
                </div>
                {job.error && <p className="mt-1 truncate text-[11px] text-destructive">{job.error.message}</p>}
                {job.enrichmentError && <p className="mt-1 truncate text-[11px] text-destructive">{job.enrichmentError}</p>}
              </div>
              <span className="font-mono text-xs tabular-nums text-muted-foreground max-lg:hidden">{job.durationSeconds == null ? "—" : fmt(job.durationSeconds)}</span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground max-lg:hidden">{(job.bytes / 1e6).toFixed(1)} MB</span>
              <span className="truncate text-xs text-muted-foreground max-lg:hidden">{job.campaign || "—"}</span>
              <span className="truncate text-[11px] text-muted-foreground max-lg:hidden">{selected?.name ?? "—"}</span>
              <span className={`w-fit rounded-sm border px-1.5 py-px font-mono text-[10px] uppercase ${STAGE_STYLE[job.stage] ?? "border-primary/40 bg-accent text-accent-foreground"}`}>{job.stage}</span>
              <span className="max-lg:hidden">
                {job.stage === "indexed" && (job.enrichmentStatus === "not_started" || job.enrichmentStatus === "failed") ? (
                  <button onClick={() => retry(job.id)} className="rounded-sm border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary/50 hover:text-foreground">Enrich</button>
                ) : (
                  <span title={job.observationCount ? `${job.observationCount} observations` : undefined} className={`inline-block max-w-full truncate rounded-sm border px-1.5 py-px font-mono text-[10px] uppercase ${STAGE_STYLE[job.enrichmentStatus] ?? "border-primary/40 bg-accent text-accent-foreground"}`}>{enrichmentLabel(job)}</span>
                )}
              </span>
              <span className="text-right">
                {job.stage === "failed" ? (
                  <button onClick={() => retry(job.id)} className="rounded-sm border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary/50 hover:text-foreground">Retry</button>
                ) : (
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{stamp(job.updatedAt)} UTC</span>
                )}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 font-mono text-[10px] text-muted-foreground">A repeated file is not uploaded again. Retry continues a failed upload. Enrich continues a saved segmentation task.</p>
      </main>
  );
}
