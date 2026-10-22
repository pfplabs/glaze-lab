import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { createContext, useContext, useEffect, useState } from "react";
import { Database, FolderOpen, Play, Search as SearchIcon, Settings, Shapes } from "lucide-react";
import { fmt, type Video } from "@/lib/library";
import twelvelabsLogo from "@/assets/twelvelabs-logo.png";
import glazeLogo from "@/assets/glaze-logo-white.png";

export function Chip({ on, children, onClick, disabled }: { on: boolean; children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={`rounded-sm border px-1.5 py-0.5 text-xs transition ${disabled ? "cursor-not-allowed border-border text-muted-foreground/40" : on ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"}`}>
      {children}
    </button>
  );
}

export function Thumb({ hue, t, big, src, previewing, onMouseEnter, onMouseLeave, children }: { hue: number; t: number; big?: boolean; src?: string | null; previewing?: boolean; onMouseEnter?: () => void; onMouseLeave?: () => void; children?: React.ReactNode }) {
  return (
    <div onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} className={`thumb relative shrink-0 overflow-hidden rounded-sm ${big ? "aspect-video w-full" : "h-16 w-28"}`} style={{ "--h": hue } as React.CSSProperties}>
      {src && <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" />}
      {children}
      <Play className={`pointer-events-none absolute left-1/2 top-1/2 z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 text-primary-foreground/90 transition-opacity ${previewing ? "opacity-0" : ""}`} />
      <span className="pointer-events-none absolute bottom-1 right-1 z-10 rounded-sm bg-foreground/70 px-1 font-mono text-[10px] text-background">{fmt(t)}</span>
    </div>
  );
}

export function Score({ v }: { v: number }) {
  return <span className="shrink-0 rounded-sm border border-border bg-muted px-1 py-px font-mono text-[11px] tabular-nums text-secondary-foreground">{Math.round(v * 100)}%</span>;
}

export function MiniTimeline({ video, active }: { video: Video; active?: number }) {
  return (
    <div className="relative mt-2 h-1 rounded-full bg-muted">
      {video.moments.map((m, i) => (
        <div key={i} className={`absolute top-0 h-full rounded-full ${i === active ? "bg-primary" : "bg-foreground/20"}`} style={{ left: `${(m.start / video.duration) * 100}%`, width: `${Math.max(((m.end - m.start) / video.duration) * 100, 1)}%` }} />
      ))}
    </div>
  );
}

type NavItem = { label: string; icon: typeof SearchIcon; to?: string; soon?: boolean };

const NAV: NavItem[] = [
  { label: "Search", icon: SearchIcon, to: "/" },
  { label: "Collections", icon: FolderOpen, soon: true },
  { label: "Ingestion", icon: Database, to: "/ingest" },
  { label: "Taxonomy", icon: Shapes, soon: true },
];

const CRUMBS: Record<string, string> = { "/": "Search", "/search": "Search · Results", "/ingest": "Ingestion" };

type ListedIndex = { id: string; name: string };
type SelectedIndex = { id: string; name: string; acceptsVideos: boolean };

export type LibraryCategory = { name: string; skuCount: number };

export type LibrarySummary = {
  skuCount: number;
  videoCount: number;
  momentCount: number;
  channels: string[];
  categories: LibraryCategory[];
  syncedAt: string | null;
};

type IndexSelectionValue = {
  ready: boolean;
  indexes: ListedIndex[];
  selected: SelectedIndex | null;
  summary: LibrarySummary | null;
  note: string;
  busy: boolean;
  name: string;
  setName: (value: string) => void;
  choose: (id: string) => Promise<void>;
  create: (event: React.FormEvent) => Promise<void>;
};

const IndexSelectionContext = createContext<IndexSelectionValue | null>(null);

export function useSelectedIndex() {
  return useContext(IndexSelectionContext);
}

function noteFor(selected: { name?: string | null; acceptsVideos?: boolean }) {
  return selected.acceptsVideos ? selected.name ?? "" : "uploads are off for this index";
}

function IndexSelection({ children }: { children: React.ReactNode }) {
  const [indexes, setIndexes] = useState<ListedIndex[]>([]);
  const [selected, setSelected] = useState<SelectedIndex | null>(null);
  const [summary, setSummary] = useState<LibrarySummary | null>(null);
  const [ready, setReady] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const loadLibrary = async () => {
    const response = await fetch("/api/library");
    if (!response.ok) {
      setSummary(null);
      return;
    }
    const body = (await response.json()) as { summary: LibrarySummary };
    setSummary(body.summary);
  };

  const load = async () => {
    const response = await fetch("/api/indexes");
    if (!response.ok) throw new Error("index request failed");
    const body = (await response.json()) as { indexes: ListedIndex[]; selected: { id: string | null; name: string | null; acceptsVideos: boolean } };
    setIndexes(body.indexes);
    setSelected(body.selected.id ? { id: body.selected.id, name: body.selected.name ?? body.selected.id, acceptsVideos: body.selected.acceptsVideos } : null);
    setNote(noteFor(body.selected));
    await loadLibrary();
  };

  useEffect(() => {
    let cancelled = false;
    load()
      .catch(() => {
        if (!cancelled) setNote("API not running");
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const choose = async (id: string) => {
    if (!id) return;
    setBusy(true);
    try {
      const response = await fetch("/api/index", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const body = (await response.json()) as { id?: string; name?: string; acceptsVideos?: boolean; message?: string };
      if (!response.ok) {
        setNote(body.message ?? "That index cannot be selected.");
        return;
      }
      const next = { id: body.id ?? id, name: body.name ?? id, acceptsVideos: Boolean(body.acceptsVideos) };
      setSelected(next);
      setNote(noteFor(next));
      await loadLibrary();
    } finally {
      setBusy(false);
    }
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const response = await fetch("/api/indexes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const body = (await response.json()) as { message?: string };
      if (!response.ok) {
        setNote(body.message ?? "Could not create the index.");
        return;
      }
      setName("");
      await load();
    } catch {
      setNote("API not running");
    } finally {
      setBusy(false);
    }
  };

  const value = { ready, indexes, selected, summary, note, busy, name, setName, choose, create };
  return <IndexSelectionContext.Provider value={value}>{children}</IndexSelectionContext.Provider>;
}

function IndexBanner() {
  const selection = useSelectedIndex();
  if (!selection) return null;
  const { indexes, selected, note, busy, name, setName, choose, create } = selection;

  return (
    <div className="sticky top-0 z-30 flex h-10 items-center gap-3 border-b border-white/10 bg-primary px-4 font-mono text-[11px] text-primary-foreground md:px-5">
      <span className="uppercase tracking-widest text-primary-foreground/75">Selected index</span>
      <select
        aria-label="Selected index"
        value={selected?.id ?? ""}
        disabled={busy || indexes.length === 0}
        onChange={(event) => choose(event.target.value)}
        className="max-w-[240px] rounded-sm border border-white/20 bg-white/15 px-1.5 py-0.5 text-[11px] text-primary-foreground outline-none disabled:opacity-80"
      >
        {indexes.length === 0 && <option value="">No indexes</option>}
        {indexes.map((index) => (
          <option key={index.id} value={index.id} className="text-foreground">
            {index.name}
          </option>
        ))}
      </select>
      <form onSubmit={create} className="flex items-center gap-1.5">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name a new index"
          aria-label="New index name"
          className="w-36 rounded-sm border border-white/20 bg-white/15 px-1.5 py-0.5 text-[11px] outline-none placeholder:text-primary-foreground/55"
        />
        <button type="submit" disabled={busy || !name.trim()} className="rounded-sm bg-white/20 px-1.5 py-0.5 uppercase tracking-wide disabled:opacity-50">
          Create
        </button>
      </form>
      <span className="ml-auto truncate text-primary-foreground/80">{note}</span>
    </div>
  );
}

function counted(count: number, singular: string, plural: string) {
  return `${count.toLocaleString("en-US")} ${count === 1 ? singular : plural}`;
}

function formatSync(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${hours}:${minutes} UTC`;
}

function ShellFooter() {
  const summary = useSelectedIndex()?.summary ?? null;
  const sync = summary?.syncedAt ? formatSync(summary.syncedAt) : null;
  return (
    <footer className="flex items-center gap-4 border-t bg-muted/50 px-4 py-1.5 font-mono text-[10px] text-muted-foreground md:px-5">
      <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-chart-2" />Index healthy</span>
      <span>
        {summary
          ? `${counted(summary.videoCount, "asset", "assets")} · ${counted(summary.momentCount, "moment", "moments")}`
          : "— assets · — moments"}
      </span>
      {sync && <span className="hidden sm:inline">Last sync {sync}</span>}
      <span className="ml-auto">pilot · sample data</span>
    </footer>
  );
}

export function AppShell({ search: initialSearch, children }: { search?: string; children: React.ReactNode }) {
  const navigate = useNavigate();
  const pathname = useLocation().pathname;
  const [q, setQ] = useState(initialSearch ?? "");
  const submit = (e: React.FormEvent) => { e.preventDefault(); navigate({ to: "/search", search: { q } }); };
  const crumb = pathname.startsWith("/video/") ? "Search · Results · Asset" : (CRUMBS[pathname] ?? "Search");

  return (
    <IndexSelection>
    <div className="flex min-h-screen flex-col">
      <IndexBanner />
      <div className="flex min-h-0 flex-1">
      <aside className="sidebar-gloss sticky top-10 hidden h-[calc(100vh-2.5rem)] w-52 shrink-0 flex-col rounded-br-3xl rounded-tr-3xl border-r border-sidebar-border text-sidebar-foreground md:flex">
        <div className="border-b border-sidebar-border px-4 py-3">
          <img src={glazeLogo} alt="Glaze" loading="lazy" width={1514} height={629} className="block h-7 w-auto drop-shadow-[0_0_16px_rgba(236,72,153,0.45)]" />
          <p className="mt-1 text-[10px] italic leading-snug text-sidebar-foreground/60">The foundation of every frame.</p>
        </div>

        <nav className="flex-1 space-y-px p-1.5">
          {NAV.map((n) =>
            n.to ? (
              <Link key={n.label} to={n.to} className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] transition ${n.to === pathname ? "bg-white/12 font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]" : "text-sidebar-foreground/75 hover:bg-white/8 hover:text-sidebar-foreground"}`}>
                <n.icon className="h-3.5 w-3.5" />{n.label}
              </Link>
            ) : (
              <span key={n.label} className="flex cursor-not-allowed items-center gap-2 rounded-full px-3 py-1.5 text-[13px] text-sidebar-foreground/40">
                <n.icon className="h-3.5 w-3.5" />{n.label}
                <span className="ml-auto rounded-sm border border-sidebar-border px-1 font-mono text-[9px] uppercase text-sidebar-foreground/50">soon</span>
              </span>
            ),
          )}
        </nav>
        <div className="space-y-2 border-t border-sidebar-border p-3">
          <div className="flex w-fit max-w-full items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] py-1 pl-2.5 pr-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]">
            <span className="shrink-0 text-[9px] font-medium uppercase tracking-[0.14em] text-sidebar-foreground/50">Powered by</span>
            <span className="flex items-center rounded-full bg-white px-1.5 py-0.5">
              <img src={twelvelabsLogo} alt="TwelveLabs" width={1024} height={206} className="h-3.5 w-auto" />
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-sm bg-sidebar-accent font-mono text-[10px] text-sidebar-foreground">JD</div>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-xs font-medium text-sidebar-foreground">John Doe</p>
              <p className="truncate text-[10px] text-sidebar-foreground/60">Brand Studio · Global</p>
            </div>
            <Settings className="ml-auto h-3.5 w-3.5 text-sidebar-foreground/50" />
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-10 z-10 flex items-center gap-3 border-b border-border/70 bg-background/70 px-4 py-2 backdrop-blur-xl backdrop-saturate-150 md:px-5">
          <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Glaze <span className="text-border">/</span> <span className="text-foreground">{crumb}</span></span>
          {initialSearch !== undefined && (
            <form onSubmit={submit} className="search-shell flex max-w-xl flex-1 items-center gap-2 rounded-full px-3 py-1">
              <SearchIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search moments in natural language…" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground" />
              <kbd className="hidden rounded-sm border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground sm:block">⏎</kbd>
            </form>
          )}
          <span className="ml-auto hidden rounded-sm border border-border px-1.5 py-px font-mono text-[10px] uppercase tracking-wide text-muted-foreground sm:block">Internal demo</span>
        </header>
        <div className="flex-1">{children}</div>
        <ShellFooter />
      </div>
      </div>
    </div>
    </IndexSelection>
  );
}
