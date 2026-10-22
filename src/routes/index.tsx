import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, Clock, Search } from "lucide-react";
import { EXAMPLES } from "@/lib/library";
import { AppShell } from "@/components/brand";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Glaze — Internal Video Search Console" },
      { name: "description", content: "Moment-level search across the marketing video library. Internal tool for Brand Studio." },
      { property: "og:title", content: "Glaze — Internal Video Search Console" },
      { property: "og:description", content: "Moment-level search across the marketing video library." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

const STATS: [string, string][] = [
  ["10,003", "SKUs in catalog"],
  ["18,420", "videos indexed"],
  ["1.2M", "enriched moments"],
  ["3", "channels · e-com, social, retail"],
];

function Index() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const run = (s: string) => {
    const v = s.trim();
    if (v) setRecent([v, ...recent.filter((x) => x !== v)].slice(0, 5));
    navigate({ to: "/search", search: { q: v } });
  };

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-5xl px-5 py-6">
        <div className="flex items-baseline justify-between">
          <h1 className="text-base font-semibold tracking-tight">Moment search</h1>
          <p className="font-mono text-[11px] text-muted-foreground">visual · speech · on-screen text</p>
        </div>
        <p className="mt-1 text-[13px] text-muted-foreground">Describe what happens on screen — products, actions, lighting, skin tones. Results are moments, not filenames or manual tags.</p>

        <form onSubmit={(e) => { e.preventDefault(); run(q); }} className="search-shell mt-4 flex items-center gap-2.5 rounded-full px-4 py-2">
          <Search className="h-4 w-4 shrink-0 text-primary" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. close-ups of foundation application in natural light" className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
          <button className="gloss-btn flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-medium text-white"><Search className="h-3.5 w-3.5" />Search</button>
        </form>


        <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_280px]">
          <section>
            <h2 className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Example queries</h2>
            <div className="glass overflow-hidden rounded-lg">
              {EXAMPLES.map((e, i) => (
                <button key={e} onClick={() => run(e)} className={`group flex w-full items-center gap-3 px-3 py-2 text-left text-[13px] hover:bg-accent/50 ${i > 0 ? "border-t border-border" : ""}`}>
                  <span className="font-mono text-[11px] text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                  <span className="flex-1">“{e}”</span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
                </button>
              ))}
            </div>
          </section>
          <section className="space-y-4">
            <div>
              <h2 className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Recent searches</h2>
              <div className="glass rounded-lg p-3">
                {recent.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No searches yet this session.</p>
                ) : (
                  <ul className="space-y-1">
                    {recent.map((r) => (
                      <li key={r}>
                        <button onClick={() => run(r)} className="flex w-full items-center gap-2 rounded-sm px-1 py-0.5 text-left text-xs hover:bg-accent/50"><Clock className="h-3 w-3 shrink-0 text-muted-foreground" /><span className="truncate">{r}</span></button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div>
              <h2 className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Browse by category</h2>
              <div className="glass divide-y divide-border rounded-lg">
                {([["Makeup", "4,812 SKUs", "red lipstick"], ["Skincare", "3,140 SKUs", "serum"], ["Haircare", "2,051 SKUs", "hair mask"]] as const).map(([t, d, s]) => (
                  <button key={t} onClick={() => run(s)} className="flex w-full items-center justify-between px-3 py-2 text-[13px] hover:bg-accent/50">
                    <span>{t}</span><span className="font-mono text-[11px] text-muted-foreground">{d}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>

        <section className="mt-6 border-t border-border pt-4">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {STATS.map(([n, l]) => (
              <div key={l}><p className="font-mono text-lg font-medium tabular-nums">{n}</p><p className="text-[11px] text-muted-foreground">{l}</p></div>
            ))}
          </div>
        </section>
      </main>
    </AppShell>
  );
}
