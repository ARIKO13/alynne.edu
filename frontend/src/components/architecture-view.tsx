'use client';

import { useEffect, useRef, useState } from 'react';
import { Network, Database, GitBranch } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ArchitectureViewProps {
  schemaInfo: any;
}

export function ArchitectureView({ schemaInfo }: ArchitectureViewProps) {
  const [activeDiagram, setActiveDiagram] = useState<'erd' | 'dataflow' | 'components'>('dataflow');
  const mermaidRef = useRef<HTMLDivElement>(null);
  const [mermaidLoaded, setMermaidLoaded] = useState(false);

  // Dynamic import mermaid (only loads when this component renders)
  useEffect(() => {
    let mounted = true;
    import('mermaid').then((mod) => {
      const mermaid = mod.default;
      mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        themeVariables: {
          primaryColor: '#7C3AED',
          primaryTextColor: '#fafafa',
          primaryBorderColor: '#7c3aed',
          lineColor: '#52525b',
          secondaryColor: '#1f1f23',
          tertiaryColor: '#161618',
          fontFamily: 'monospace',
          fontSize: '12px',
        },
        flowchart: {
          curve: 'basis',
          htmlLabels: true,
        },
        er: {
          useMaxWidth: true,
        },
      });
      if (mounted) setMermaidLoaded(true);
    }).catch((e) => {
      console.warn('[ArchitectureView] Mermaid load failed:', e);
    });
    return () => { mounted = false; };
  }, []);

  // Render diagram when mermaid loaded or active diagram changes
  useEffect(() => {
    if (!mermaidLoaded || !mermaidRef.current) return;

    const diagram = getDiagram(activeDiagram, schemaInfo);
    const id = `mermaid-${activeDiagram}-${Date.now()}`;

    import('mermaid').then((mod) => {
      const mermaid = mod.default;
      try {
        mermaid.render(id, diagram).then(({ svg }: { svg: string }) => {
          if (mermaidRef.current) {
            mermaidRef.current.innerHTML = svg;
          }
        }).catch((e: any) => {
          console.warn('[ArchitectureView] Mermaid render failed:', e);
          if (mermaidRef.current) {
            mermaidRef.current.innerHTML = `<pre class="text-xs text-red-400 p-2 overflow-x-auto">Mermaid error: ${e.message || e}\n\n--- Diagram source ---\n${diagram}</pre>`;
          }
        });
      } catch (e: any) {
        console.warn('[ArchitectureView] Mermaid render failed:', e);
      }
    });
  }, [mermaidLoaded, activeDiagram, schemaInfo]);

  return (
    <div className="space-y-3">
      {/* Header + diagram switcher */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-[11px] text-zinc-400 flex items-center gap-1.5">
          <Network className="h-3 w-3" /> System Architecture (Mermaid)
        </p>
        <div className="flex gap-1">
          <DiagramPill active={activeDiagram === 'dataflow'} onClick={() => setActiveDiagram('dataflow')} label="Data Flow" />
          <DiagramPill active={activeDiagram === 'erd'} onClick={() => setActiveDiagram('erd')} label="ERD" />
          <DiagramPill active={activeDiagram === 'components'} onClick={() => setActiveDiagram('components')} label="Components" />
        </div>
      </div>

      {/* Mermaid diagram container */}
      <div className="rounded-lg border border-white/[0.06] bg-[#111113] p-4 overflow-x-auto">
        {!mermaidLoaded ? (
          <p className="text-center text-xs text-zinc-500 py-8">Loading Mermaid...</p>
        ) : (
          <div ref={mermaidRef} className="mermaid-container flex justify-center" />
        )}
      </div>

      {/* Diagram explanation */}
      <div className="rounded-lg border border-white/[0.06] bg-[#111113] p-3">
        {activeDiagram === 'dataflow' && (
          <div className="text-[11px] text-zinc-400 space-y-1">
            <p className="font-medium text-zinc-300">STT Data Flow</p>
            <p>• User speaks → Web Speech API / Whisper → raw text</p>
            <p>• Raw text → fuzzy-correct API → 3-layer pipeline (localCorrect → contextAwareCorrect → log)</p>
            <p>• Unknown words with high confidence → auto-learned to SQLite (dataset_origin='user-learned')</p>
            <p>• User feedback corrections → user_corrections table → correction_summary aggregation</p>
            <p>• Cron backup every 30min → GitHub dataset-backup branch</p>
            <p>• Cron prune daily → clean noise (count=1 + &gt;7 days)</p>
          </div>
        )}
        {activeDiagram === 'erd' && (
          <div className="text-[11px] text-zinc-400 space-y-1">
            <p className="font-medium text-zinc-300">Entity Relationship Diagram</p>
            <p>• <strong>learned_words</strong>: KBBI + slang + auto-learned words (299K entries)</p>
            <p>• <strong>word_cooccurrence</strong>: context tracking (word + context_word + position)</p>
            <p>• <strong>user_corrections</strong>: individual vote records (original → corrected)</p>
            <p>• <strong>correction_summary</strong>: aggregated vote counts per pair</p>
            <p className="text-zinc-500 italic mt-1">Note: Relasi di-handle di application layer, bukan FK constraints.</p>
          </div>
        )}
        {activeDiagram === 'components' && (
          <div className="text-[11px] text-zinc-400 space-y-1">
            <p className="font-medium text-zinc-300">System Components</p>
            <p>• <strong>Browser (Client)</strong>: React + Web Speech API + localStorage candidates</p>
            <p>• <strong>Astro Server (Node)</strong>: API routes + stt-dictionary.ts + context-aware corrector</p>
            <p>• <strong>SQLite (SSD)</strong>: learned_words + cooccurrence + corrections (source of truth)</p>
            <p>• <strong>D1 (Cloudflare)</strong>: User accounts + STTFailure logs</p>
            <p>• <strong>phonetic-map.json</strong>: Phonetic variations (auto-merged from learned words)</p>
            <p>• <strong>GitHub (dataset-backup branch)</strong>: Off-site backup (cron every 30min)</p>
          </div>
        )}
      </div>
    </div>
  );
}

function DiagramPill({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-2.5 py-0.5 rounded-full border text-[11px] font-medium transition-all',
        active
          ? 'border-[#7C3AED]/40 bg-[#7C3AED]/15 text-[#7C3AED]'
          : 'border-white/[0.08] bg-white/[0.02] text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.04]'
      )}
    >
      {label}
    </button>
  );
}

function getDiagram(type: string, schemaInfo: any): string {
  if (type === 'dataflow') {
    return `flowchart TD
    User["👤 User Speaks"]
    WebSpeech["Web Speech API<br/>(Chrome browser)"]
    Whisper["Whisper Backend<br/>(faster-whisper Python)"]

    Client["Browser Client<br/>use-speech-recognition.ts"]
    Candidates[("localStorage<br/>Candidates (count < 3)")]
    LearnAPI["POST /api/stt/learn-word<br/>(confidence + context)"]

    FuzzyAPI["POST /api/stt/fuzzy-correct<br/>3-layer pipeline"]
    Layer1["Layer 1: localCorrect<br/>phrase + slang + fuzzy + phonetic"]
    Layer2["Layer 2: contextAwareCorrect<br/>4-factor scoring"]
    Layer3["Layer 3: log failure<br/>→ D1 STTFailure"]

    SQLite[("SQLite (SSD)<br/>learned_words<br/>word_cooccurrence<br/>user_corrections")]
    PhoneticMap["phonetic-map.json<br/>(auto-merged)"]
    D1[("D1 (Cloudflare)<br/>User accounts<br/>STTFailure")]

    BackupCron["⏰ Cron 30min<br/>backup-sqlite-to-github.sh"]
    PruneCron["⏰ Cron daily 4am<br/>prune-dataset.py"]
    GitHub["GitHub<br/>dataset-backup branch"]

    User --> WebSpeech
    User --> Whisper
    WebSpeech --> Client
    Whisper --> Client

    Client -->|"confidence > 0.85"| Candidates
    Candidates -->|"count >= 3"| LearnAPI
    Client -->|"raw text"| FuzzyAPI

    FuzzyAPI --> Layer1
    Layer1 --> Layer2
    Layer2 --> Layer3
    Layer3 --> D1

    LearnAPI -->|"INSERT + expand phonetic"| SQLite
    SQLite -->|"merge confirmed"| PhoneticMap
    SQLite -->|"resetDictionaryCache()"| Layer1

    SQLite --> BackupCron
    BackupCron --> GitHub
    SQLite --> PruneCron

    style SQLite fill:#7C3AED,stroke:#7c3aed,color:#fff
    style GitHub fill:#1f1f23,stroke:#52525b,color:#fafafa
    style User fill:#059669,stroke:#047857,color:#fff
    style FuzzyAPI fill:#0891b2,stroke:#0e7490,color:#fff
    style LearnAPI fill:#d97706,stroke:#b45309,color:#fff
    `;
  }

  if (type === 'erd') {
    // Build ERD from schemaInfo if available, otherwise use static
    const tables = schemaInfo?.tables || [];
    if (tables.length > 0) {
      const erdLines: string[] = ['erDiagram'];
      // Define entities
      for (const t of tables) {
        erdLines.push(`  ${t.name} {`);
        for (const col of t.columns) {
          const type = (col.type || 'TEXT').toUpperCase().replace(/\s+/g, '_');
          const pk = col.pk ? ' PK' : '';
          const nn = col.notNull ? ' NN' : '';
          erdLines.push(`    ${type} ${col.name}${pk}${nn}`);
        }
        erdLines.push('  }');
      }
      // Define relationships (application-level, not FK)
      erdLines.push('  learned_words ||--o{ word_cooccurrence : "has context"');
      erdLines.push('  user_corrections ||--|| correction_summary : "aggregates to"');
      return erdLines.join('\n');
    }
    // Static fallback
    return `erDiagram
  learned_words {
    INTEGER id PK
    TEXT word "UNIQUE"
    TEXT phonetic_variations
    TEXT source "kbbi|slang|webspeech"
    TEXT dataset_origin "seeded|user-learned"
    REAL confidence
    INTEGER count
    INTEGER vote_count
    TEXT status "candidate|confirmed|rejected"
    TEXT created_at
    TEXT last_used_at
  }
  word_cooccurrence {
    INTEGER id PK
    TEXT word
    TEXT context_word
    TEXT position "before|after"
    INTEGER distance "1-3"
    INTEGER count
    TEXT updated_at
  }
  user_corrections {
    INTEGER id PK
    TEXT original_word
    TEXT corrected_word
    TEXT context_before
    TEXT context_after
    TEXT user_id
    REAL user_weight
    INTEGER accepted
    TEXT created_at
  }
  correction_summary {
    INTEGER id PK
    TEXT original_word
    TEXT corrected_word
    INTEGER total_votes
    REAL weighted_votes
    TEXT last_voted_at
  }
  _schema_migrations {
    INTEGER id PK
    TEXT name
    TEXT applied_at
  }
  learned_words ||--o{ word_cooccurrence : "has context"
  user_corrections ||--|| correction_summary : "aggregates to"`;
  }

  // components diagram
  return `flowchart TB
    subgraph Client["🌐 Browser (Client-side)"]
      React["React App<br/>Astro + zustand"]
      WebSpeech["Web Speech API<br/>(Chrome native)"]
      LS[("localStorage<br/>candidates tracking")]
      React --> WebSpeech
      React --> LS
    end

    subgraph Server["🖥️ Astro Node Server (PM2)"]
      API["API Routes<br/>/api/stt/*"]
      SttDict["stt-dictionary.ts<br/>loadDict() → RAM cache"]
      Corrector["stt-context-corrector.ts<br/>4-factor scoring"]
      LearnedWord["learned-word.ts<br/>validation + phonetic expand"]
      SttDb["stt-db.ts<br/>better-sqlite3 singleton"]
      API --> SttDict
      API --> Corrector
      API --> LearnedWord
      LearnedWord --> SttDb
      Corrector --> SttDb
      SttDict -.->|"load from"| SttDb
    end

    subgraph Storage["💾 SSD VPS"]
      SQLite[("SQLite<br/>stt.db (50MB)<br/>WAL mode")]
      JsonFile["stt-dictionary.json<br/>(4.66MB fallback)"]
      PhMap["phonetic-map.json<br/>(auto-merged)"]
      SttDb --> SQLite
      SttDict -.->|"fallback"| JsonFile
      LearnedWord -->|"merge confirmed"| PhMap
    end

    subgraph Cloud["☁️ Cloud Services"]
      D1[("D1 Cloudflare<br/>User accounts")]
      Backup[("GitHub<br/>dataset-backup branch")]
    end

    subgraph Cron["⏰ Cron Jobs"]
      Checkpoint["WAL checkpoint<br/>every 10min"]
      BackupCron["GitHub backup<br/>every 30min"]
      PruneCron["Prune dataset<br/>daily 4am"]
      LocalBackup["Local backup<br/>daily 3am"]
    end

    Client -->|"HTTPS"| Server
    SQLite --> BackupCron
    BackupCron --> Backup
    SQLite --> PruneCron
    SQLite --> Checkpoint
    SQLite --> LocalBackup
    API -->|"user data"| D1

    style SQLite fill:#7C3AED,stroke:#7c3aed,color:#fff
    style Server fill:#0891b2,stroke:#0e7490,color:#fff
    style Client fill:#059669,stroke:#047857,color:#fff
    style Cloud fill:#6366f1,stroke:#4f46e5,color:#fff
    style Cron fill:#d97706,stroke:#b45309,color:#fff
  `;
}
