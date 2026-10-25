/**
 * VisualisasiPanel.tsx — Render visualisasi JSON dari mega-generate
 *
 * GLM hanya menghasilkan JSON data (~150-200 token per item).
 * Frontend yang render pakai:
 *   - Recharts (sudah install) → grafik_batang, grafik_garis, grafik_pie, grafik_fungsi, grafik_gerak
 *   - Mermaid (sudah install) → diagram_alur, diagram_konsep, mermaid_flowchart, mermaid_mindmap
 *   - HTML table → tabel_data, html_table
 *   - Code block → rumus_latex (KaTeX install belakangan, sekarang text display)
 *   - JSON fallback → svg_diagram, smiles, dll yang belum ada renderer-nya
 *
 * Beban visual ada di browser (Plotly/Mermaid/Recharts), 0 request API tambahan.
 */

import { useState, useEffect, useRef } from 'react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

export interface VisualisasiItem {
  id?: string;
  bab_id?: number;
  subjek?: string;
  judul?: string;
  tipe?: string;
  deskripsi?: string;
  data?: any;
  render_hint?: string;
}

const COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

export function VisualisasiPanel({ items }: { items: VisualisasiItem[] | undefined | null }) {
  if (!items || !Array.isArray(items) || items.length === 0) {
    return null;
  }
  return (
    <div className="space-y-3 mt-4">
      <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
        <span className="text-base">📊</span> Visualisasi ({items.length})
      </h3>
      <div className="grid gap-3">
        {items.map((item, i) => (
          <VisualisasiCard key={item.id || `vis-${i}`} item={item} />
        ))}
      </div>
    </div>
  );
}

function VisualisasiCard({ item }: { item: VisualisasiItem }) {
  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/50">
      {item.judul && (
        <h4 className="font-medium text-sm text-slate-800 mb-1">{item.judul}</h4>
      )}
      {item.deskripsi && (
        <p className="text-xs text-slate-500 mb-2">{item.deskripsi}</p>
      )}
      <VisualisasiRenderer item={item} />
      {item.subjek && (
        <p className="text-[10px] text-slate-400 mt-2 uppercase tracking-wide">{item.subjek} · {item.tipe}</p>
      )}
    </div>
  );
}

function VisualisasiRenderer({ item }: { item: VisualisasiItem }) {
  const tipe = item.tipe || '';
  const hint = item.render_hint || '';
  const data = item.data || {};

  try {
    // ── Mermaid (diagram_alur, diagram_konsep, mermaid_flowchart, mermaid_mindmap) ──
    if (hint.startsWith('mermaid') || tipe === 'diagram_alur' || tipe === 'diagram_konsep') {
      return <MermaidRenderer tipe={tipe} hint={hint} data={data} />;
    }

    // ── Recharts (grafik_batang, grafik_garis, grafik_pie) ──
    if (tipe === 'grafik_batang') {
      return <BarChartRenderer data={data} />;
    }
    if (tipe === 'grafik_garis') {
      return <LineChartRenderer data={data} />;
    }
    if (tipe === 'grafik_pie') {
      return <PieChartRenderer data={data} />;
    }

    // ── grafik_fungsi & grafik_gerak → use Recharts LineChart with computed points ──
    if (tipe === 'grafik_fungsi' || tipe === 'grafik_gerak') {
      return <FunctionGraphRenderer tipe={tipe} data={data} />;
    }

    // ── tabel_data / html_table ──
    if (tipe === 'tabel_data' || hint === 'html_table') {
      return <TableRenderer data={data} />;
    }

    // ── rumus_latex → text display (KaTeX install belakangan) ──
    if (tipe === 'rumus_latex' || hint === 'katex') {
      return <LatexTextRenderer data={data} />;
    }

    // ── Fallback: show JSON ──
    return (
      <pre className="text-[10px] bg-slate-100 p-2 rounded overflow-x-auto max-h-40">
        {JSON.stringify(data, null, 2)}
      </pre>
    );
  } catch (e: any) {
    return (
      <div className="text-xs text-red-600 p-2 bg-red-50 rounded">
        Render error: {e?.message || 'unknown'}
        <pre className="text-[10px] mt-1 bg-white p-1 rounded">{JSON.stringify(data, null, 2).slice(0, 500)}</pre>
      </div>
    );
  }
}

// ── Mermaid renderer (dynamic import supaya gak berat bundle) ──
function MermaidRenderer({ tipe, hint, data }: { tipe: string; hint: string; data: any }) {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const idRef = useRef(`mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({ startOnLoad: false, theme: 'default' });
        const code = buildMermaidCode(tipe, hint, data);
        const { svg } = await mermaid.render(idRef.current, code);
        if (!cancelled) {
          setSvg(svg);
          setError('');
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'mermaid render failed');
      }
    })();
    return () => { cancelled = true; };
  }, [tipe, hint, data]);

  if (error) {
    return (
      <div className="text-xs text-red-600 p-2 bg-red-50 rounded">
        Mermaid error: {error}
      </div>
    );
  }
  if (!svg) {
    return <div className="text-xs text-slate-400 p-2">Loading diagram…</div>;
  }
  return <div className="bg-white rounded p-2 overflow-x-auto" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function buildMermaidCode(tipe: string, hint: string, data: any): string {
  // diagram_alur with nodes + edges
  if ((tipe === 'diagram_alur' || hint === 'mermaid_flowchart') && data?.node && data?.edge) {
    const nodes = data.node as string[];
    const edges = data.edge as string[][];
    // Sanitize node names (mermaid doesn't like special chars)
    const safe = (s: string) => String(s).replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
    const nodesCode = nodes.map((n) => `${safe(n)}["${n}"]`).join('\n');
    const edgesCode = edges.map((e) => {
      if (Array.isArray(e) && e.length >= 2) {
        return `${safe(e[0])} --> ${safe(e[1])}`;
      }
      return '';
    }).filter(Boolean).join('\n');
    return `flowchart TD\n${nodesCode}\n${edgesCode}`;
  }
  // mermaid_mindmap
  if (hint === 'mermaid_mindmap' && data?.cabang) {
    const root = data.root || 'Root';
    const branches = (data.cabang as any[]).map(c => {
      const sub = (c.sub || []).map((s: string) => `  ${s}`).join('\n');
      return `${c.nama}\n${sub}`;
    }).join('\n');
    return `mindmap\n  root((${root}))\n${branches.split('\n').map(l => '  ' + l).join('\n')}`;
  }
  // Fallback: simple graph with single node
  return `graph TD\nA["Data tidak terstruktur untuk mermaid"]`;
}

// ── Recharts renderers ──
function BarChartRenderer({ data }: { data: any }) {
  const { categories, values } = data;
  if (!Array.isArray(categories) || !Array.isArray(values) || categories.length !== values.length) {
    return <InvalidDataRenderer data={data} expected="categories[], values[]" />;
  }
  const chartData = categories.map((c: string, i: number) => ({ name: c, value: Number(values[i]) || 0 }));
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        <Bar dataKey="value" fill="#3b82f6" />
      </BarChart>
    </ResponsiveContainer>
  );
}

function LineChartRenderer({ data }: { data: any }) {
  const { categories, values } = data;
  if (!Array.isArray(categories) || !Array.isArray(values) || categories.length !== values.length) {
    return <InvalidDataRenderer data={data} expected="categories[], values[]" />;
  }
  const chartData = categories.map((c: string, i: number) => ({ name: c, value: Number(values[i]) || 0 }));
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function PieChartRenderer({ data }: { data: any }) {
  const { categories, values } = data;
  if (!Array.isArray(categories) || !Array.isArray(values) || categories.length !== values.length) {
    return <InvalidDataRenderer data={data} expected="categories[], values[]" />;
  }
  const chartData = categories.map((c: string, i: number) => ({ name: c, value: Number(values[i]) || 0 }));
  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label>
          {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
        <Tooltip />
      </PieChart>
    </ResponsiveContainer>
  );
}

// ── Function graph: compute points from persamaan (y = f(x)) ──
function FunctionGraphRenderer({ tipe, data }: { tipe: string; data: any }) {
  const { persamaan, domain } = data;
  if (!persamaan || !Array.isArray(domain) || domain.length !== 2) {
    return <InvalidDataRenderer data={data} expected="persamaan: 'y = ...', domain: [min, max]" />;
  }
  // Build safe function from persamaan
  try {
    const fn = buildFunctionFromPersamaan(persamaan);
    const [xmin, xmax] = domain;
    const step = (xmax - xmin) / 50;
    const points: { name: string; value: number }[] = [];
    for (let x = xmin; x <= xmax; x += step) {
      try {
        const y = fn(x);
        if (typeof y === 'number' && isFinite(y)) {
          points.push({ name: x.toFixed(2), value: y });
        }
      } catch { /* skip points where function throws */ }
    }
    if (points.length === 0) {
      return <InvalidDataRenderer data={data} expected="function that returns finite numbers" />;
    }
    return (
      <div>
        <div className="text-xs font-mono bg-slate-100 px-2 py-1 rounded inline-block mb-2">
          {persamaan}
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={points}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
        {tipe === 'grafik_gerak' && (
          <p className="text-[10px] text-slate-500 mt-1">Grafik gerak: y = posisi/kecepatan/percepatan vs waktu</p>
        )}
      </div>
    );
  } catch (e: any) {
    return <InvalidDataRenderer data={data} expected="valid math expression" error={e?.message} />;
  }
}

/**
 * Build a JS function from a LaTeX-style persamaan.
 * Supports: y = x^2 - 4x + 3, E = mc^2, y = sin(x), y = 2x + 1, etc.
 */
function buildFunctionFromPersamaan(persamaan: string): (x: number) => number {
  // Strip "y = " or "f(x) = " prefix
  let eq = persamaan.replace(/^\s*[yYfF]\s*\(?\s*[xX]\s*\)?\s*=\s*/, '').trim();
  // Convert ^ to ** (exponent)
  eq = eq.replace(/\^/g, '**');
  // Convert "Nx" → "N*x" (implicit multiplication): 4x → 4*x, 2xy → 2*x*y
  eq = eq.replace(/(\d)([a-zA-Z(])/g, '$1*$2');
  // Replace variable x with the parameter
  // Wrap in new Function. Note: this is potentially unsafe if persamaan contains
  // malicious code, but GLM output is constrained to math expressions.
  // eslint-disable-next-line no-new-func
  const fn = new Function('x', 'Math', `
    const { sin, cos, tan, sqrt, abs, log, exp, pow, PI, E } = Math;
    return ${eq};
  `);
  return (x: number) => fn(x, Math);
}

// ── Table renderer ──
function TableRenderer({ data }: { data: any }) {
  const { headers, rows } = data;
  if (!Array.isArray(headers) || !Array.isArray(rows)) {
    return <InvalidDataRenderer data={data} expected="headers: string[], rows: string[][]" />;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr>
            {headers.map((h: string, i: number) => (
              <th key={i} className="border border-slate-300 bg-slate-100 px-2 py-1 text-left font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row: any[], i: number) => (
            <tr key={i}>
              {(Array.isArray(row) ? row : [row]).map((cell, j) => (
                <td key={j} className="border border-slate-200 px-2 py-1">
                  {String(cell ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── LaTeX text renderer (KaTeX install belakangan, sekarang text display) ──
function LatexTextRenderer({ data }: { data: any }) {
  const { persamaan, deskripsi } = data;
  return (
    <div className="bg-white border border-slate-200 rounded p-3">
      <div className="text-center text-lg font-mono text-slate-800">
        {persamaan || 'rumus tidak dispesifikasi'}
      </div>
      {deskripsi && (
        <p className="text-xs text-slate-500 mt-2 text-center">{deskripsi}</p>
      )}
      <p className="text-[10px] text-slate-400 mt-1 text-center">
        (LaTeX — KaTeX rendering akan ditambahkan belakangan)
      </p>
    </div>
  );
}

function InvalidDataRenderer({ data, expected, error }: { data: any; expected: string; error?: string }) {
  return (
    <div className="text-xs text-amber-700 p-2 bg-amber-50 rounded">
      <p className="font-medium">⚠️ Struktur data tidak sesuai</p>
      <p className="text-[11px] mt-1">Expected: <code className="text-[10px]">{expected}</code></p>
      {error && <p className="text-[11px] mt-1 text-red-600">Error: {error}</p>}
      <pre className="text-[10px] mt-2 bg-white p-1 rounded overflow-x-auto">
        {JSON.stringify(data, null, 2).slice(0, 300)}
      </pre>
    </div>
  );
}
