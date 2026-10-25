/**
 * VisualisasiPanel.tsx — Render visualisasi JSON dari mega-generate
 *
 * GLM hanya menghasilkan JSON data (~150-200 token per item).
 * Frontend yang render pakai:
 *   - Recharts → grafik_batang, grafik_garis, grafik_pie, grafik_fungsi, grafik_gerak
 *   - Mermaid (dynamic) → diagram_alur, diagram_konsep, mermaid_flowchart, mermaid_mindmap
 *   - HTML table → tabel_data, html_table
 *   - KaTeX (dynamic) → rumus_latex (matematika, fisika, kimia)
 *   - SmilesDrawer (dynamic) → struktur_molekul (kimia)
 *   - Custom SVG → diagram_gaya (vektor gaya fisika)
 *   - Custom SVG → diagram_sel (organel biologi)
 *   - Custom SVG → rangkaian_listrik (resistor/kapasitor/induktor/baterai)
 *   - JSON fallback → tipe lain yang belum ada renderer-nya
 *
 * Beban visual ada di browser (Plotly/Mermaid/Recharts/KaTeX/SmilesDrawer/SVG), 0 request API.
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
    if (tipe === 'grafik_batang') return <BarChartRenderer data={data} />;
    if (tipe === 'grafik_garis') return <LineChartRenderer data={data} />;
    if (tipe === 'grafik_pie') return <PieChartRenderer data={data} />;
    // ── grafik_fungsi & grafik_gerak ──
    if (tipe === 'grafik_fungsi' || tipe === 'grafik_gerak') return <FunctionGraphRenderer tipe={tipe} data={data} />;
    // ── tabel_data / html_table ──
    if (tipe === 'tabel_data' || hint === 'html_table') return <TableRenderer data={data} />;
    // ── rumus_latex → KaTeX ──
    if (tipe === 'rumus_latex' || hint === 'katex') return <LatexRenderer data={data} />;
    // ── struktur_molekul → SmilesDrawer ──
    if (tipe === 'struktur_molekul' || hint === 'smiles') return <MoleculeRenderer data={data} />;
    // ── diagram_gaya → custom SVG vektor ──
    if (tipe === 'diagram_gaya') return <GayaVectorRenderer data={data} />;
    // ── diagram_sel → custom SVG organel ──
    if (tipe === 'diagram_sel') return <CellRenderer data={data} />;
    // ── rangkaian_listrik → custom SVG circuit ──
    if (tipe === 'rangkaian_listrik') return <CircuitRenderer data={data} />;
    // ── Fallback ──
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

// ═══════════════════════════════════════════════════════════════════════
// Renderer 1: Mermaid (diagram_alur, diagram_konsep, mindmap)
// ═══════════════════════════════════════════════════════════════════════
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
        if (!cancelled) { setSvg(svg); setError(''); }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'mermaid render failed');
      }
    })();
    return () => { cancelled = true; };
  }, [tipe, hint, data]);

  if (error) return <div className="text-xs text-red-600 p-2 bg-red-50 rounded">Mermaid error: {error}</div>;
  if (!svg) return <div className="text-xs text-slate-400 p-2">Loading diagram…</div>;
  return <div className="bg-white rounded p-2 overflow-x-auto" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function buildMermaidCode(tipe: string, hint: string, data: any): string {
  if ((tipe === 'diagram_alur' || hint === 'mermaid_flowchart') && data?.node && data?.edge) {
    const nodes = data.node as string[];
    const edges = data.edge as string[][];
    const safe = (s: string) => String(s).replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
    const nodesCode = nodes.map((n) => `${safe(n)}["${n}"]`).join('\n');
    const edgesCode = edges.map((e) => {
      if (Array.isArray(e) && e.length >= 2) return `${safe(e[0])} --> ${safe(e[1])}`;
      return '';
    }).filter(Boolean).join('\n');
    return `flowchart TD\n${nodesCode}\n${edgesCode}`;
  }
  if (hint === 'mermaid_mindmap' && data?.cabang) {
    const root = data.root || 'Root';
    const branches = (data.cabang as any[]).map(c => {
      const sub = (c.sub || []).map((s: string) => `  ${s}`).join('\n');
      return `${c.nama}\n${sub}`;
    }).join('\n');
    return `mindmap\n  root((${root}))\n${branches.split('\n').map(l => '  ' + l).join('\n')}`;
  }
  return `graph TD\nA["Data tidak terstruktur untuk mermaid"]`;
}

// ═══════════════════════════════════════════════════════════════════════
// Renderer 2-5: Recharts (Bar, Line, Pie, FunctionGraph)
// ═══════════════════════════════════════════════════════════════════════
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

function FunctionGraphRenderer({ tipe, data }: { tipe: string; data: any }) {
  const { persamaan, domain } = data;
  if (!persamaan || !Array.isArray(domain) || domain.length !== 2) {
    return <InvalidDataRenderer data={data} expected="persamaan: 'y = ...', domain: [min, max]" />;
  }
  try {
    const fn = buildFunctionFromPersamaan(persamaan);
    const [xmin, xmax] = domain;
    const step = (xmax - xmin) / 50;
    const points: { name: string; value: number }[] = [];
    for (let x = xmin; x <= xmax; x += step) {
      try {
        const y = fn(x);
        if (typeof y === 'number' && isFinite(y)) points.push({ name: x.toFixed(2), value: y });
      } catch {}
    }
    if (points.length === 0) return <InvalidDataRenderer data={data} expected="function that returns finite numbers" />;
    return (
      <div>
        <div className="text-xs font-mono bg-slate-100 px-2 py-1 rounded inline-block mb-2">{persamaan}</div>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={points}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
        {tipe === 'grafik_gerak' && <p className="text-[10px] text-slate-500 mt-1">Grafik gerak: y = posisi/kecepatan/percepatan vs waktu</p>}
      </div>
    );
  } catch (e: any) {
    return <InvalidDataRenderer data={data} expected="valid math expression" error={e?.message} />;
  }
}

function buildFunctionFromPersamaan(persamaan: string): (x: number) => number {
  let eq = persamaan.replace(/^\s*[yYfF]\s*\(?\s*[xX]\s*\)?\s*=\s*/, '').trim();
  eq = eq.replace(/\^/g, '**');
  eq = eq.replace(/(\d)([a-zA-Z(])/g, '$1*$2');
  // eslint-disable-next-line no-new-func
  const fn = new Function('x', 'Math', `
    const { sin, cos, tan, sqrt, abs, log, exp, pow, PI, E } = Math;
    return ${eq};
  `);
  return (x: number) => fn(x, Math);
}

// ═══════════════════════════════════════════════════════════════════════
// Renderer 6: Table (HTML native)
// ═══════════════════════════════════════════════════════════════════════
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
              <th key={i} className="border border-slate-300 bg-slate-100 px-2 py-1 text-left font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row: any[], i: number) => (
            <tr key={i}>
              {(Array.isArray(row) ? row : [row]).map((cell, j) => (
                <td key={j} className="border border-slate-200 px-2 py-1">{String(cell ?? '')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Renderer 7: KaTeX (rumus_latex) — dynamic import supaya bundle kecil
// ═══════════════════════════════════════════════════════════════════════
function LatexRenderer({ data }: { data: any }) {
  const [html, setHtml] = useState<string>('');
  const [error, setError] = useState<string>('');
  const persamaan = data?.persamaan || data?.formula || '';
  const deskripsi = data?.deskripsi || '';

  useEffect(() => {
    let cancelled = false;
    if (!persamaan) { setError('persamaan kosong'); return; }
    (async () => {
      try {
        const katex = (await import('katex')).default;
        // Render ke HTML string dengan opsi displayMode (centered, larger)
        const rendered = katex.renderToString(persamaan, {
          displayMode: true,
          throwOnError: false,
          output: 'html',
        });
        if (!cancelled) { setHtml(rendered); setError(''); }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'katex load failed');
      }
    })();
    return () => { cancelled = true; };
  }, [persamaan]);

  if (error) {
    return (
      <div className="bg-white border border-amber-300 rounded p-3">
        <div className="text-center text-base font-mono text-slate-800">{persamaan}</div>
        {deskripsi && <p className="text-xs text-slate-500 mt-2 text-center">{deskripsi}</p>}
        <p className="text-[10px] text-amber-600 mt-1 text-center">KaTeX error: {error}</p>
      </div>
    );
  }
  if (!html) return <div className="text-xs text-slate-400 p-2">Memuat rumus…</div>;
  return (
    <div className="bg-white border border-slate-200 rounded p-3">
      <div className="text-center overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />
      {deskripsi && <p className="text-xs text-slate-500 mt-2 text-center">{deskripsi}</p>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Renderer 8: SmilesDrawer (struktur_molekul) — dynamic import
// ═══════════════════════════════════════════════════════════════════════
function MoleculeRenderer({ data }: { data: any }) {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const smiles = data?.smiles || data?.formula || '';
  const nama = data?.nama || '';

  useEffect(() => {
    let cancelled = false;
    if (!smiles) { setError('SMILES kosong'); return; }
    (async () => {
      try {
        const SmiDrawer = (await import('smiles-drawer')).default;
        const drawer = new SmiDrawer({
          width: 300,
          height: 200,
          themes: { dark: '#000', light: '#fff' },
        });
        if (!cancelled && canvasRef.current) {
          // SmilesDrawer v2 API: draw to canvas element
          await drawer.draw(smiles, canvasRef.current, 'light');
          setError('');
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'smiles-drawer load failed');
      }
    })();
    return () => { cancelled = true; };
  }, [smiles]);

  if (error) {
    return (
      <div className="bg-white border border-amber-300 rounded p-3">
        <div className="text-center font-mono text-sm text-slate-800">SMILES: {smiles}</div>
        {nama && <p className="text-xs text-slate-500 mt-1 text-center">{nama}</p>}
        <p className="text-[10px] text-amber-600 mt-1 text-center">SmilesDrawer error: {error}</p>
      </div>
    );
  }
  return (
    <div className="bg-white border border-slate-200 rounded p-3 flex flex-col items-center">
      <canvas ref={canvasRef} width={300} height={200} className="max-w-full" />
      {nama && <p className="text-xs text-slate-700 mt-2 text-center font-medium">{nama}</p>}
      <p className="text-[10px] text-slate-400 mt-1 font-mono">SMILES: {smiles}</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Renderer 9: GayaVectorRenderer (diagram_gaya) — custom SVG
// Render vektor gaya sebagai panah dari titik origin.
// Data: { vektor: [{label, magnitude, angle, color}], origin: [x,y], resultan: {...} }
// ═══════════════════════════════════════════════════════════════════════
function GayaVectorRenderer({ data }: { data: any }) {
  const vektor = Array.isArray(data?.vektor) ? data.vektor : [];
  const resultan = data?.resultan;
  if (vektor.length === 0) {
    return <InvalidDataRenderer data={data} expected="vektor: [{label, magnitude, angle, color}]" />;
  }

  // SVG coordinate system: 0-200 wide, 0-200 tall. Origin at center (100, 100).
  // Angle dalam derajat, 0 = timur (kanan), positif = berlawanan arah jarum jam (standar matematika).
  // Y-axis terbalik di SVG (bawah = positif), jadi kita negate sin untuk dapat arah atas.
  const ORIGIN_X = 100, ORIGIN_Y = 100;
  const SCALE = 10;  // 1 unit magnitude = 10 pixel

  const buildArrow = (v: any, isResultan = false) => {
    const mag = Number(v.magnitude) || 0;
    const ang = Number(v.angle) || 0;
    const angRad = (ang * Math.PI) / 180;
    // dx = mag * cos(angle), dy = -mag * sin(angle) (Y-axis inverted in SVG)
    const dx = mag * Math.cos(angRad) * SCALE;
    const dy = -mag * Math.sin(angRad) * SCALE;
    const endX = ORIGIN_X + dx;
    const endY = ORIGIN_Y + dy;
    const color = v.color || (isResultan ? '#000' : '#3b82f6');
    // Arrow head size
    const headLen = 8;
    const headAng = Math.atan2(dy, dx);
    const x1 = endX - headLen * Math.cos(headAng - Math.PI / 6);
    const y1 = endY - headLen * Math.sin(headAng - Math.PI / 6);
    const x2 = endX - headLen * Math.cos(headAng + Math.PI / 6);
    const y2 = endY - headLen * Math.sin(headAng + Math.PI / 6);
    // Label position (offset from arrow tip)
    const labelX = endX + 8 * Math.cos(headAng);
    const labelY = endY + 8 * Math.sin(headAng) - 4;
    return (
      <g key={v.label || Math.random()}>
        <line x1={ORIGIN_X} y1={ORIGIN_Y} x2={endX} y2={endY}
              stroke={color} strokeWidth={isResultan ? 2.5 : 1.8} markerEnd="url(#arrowhead)" />
        <polygon points={`${endX},${endY} ${x1},${y1} ${x2},${y2}`} fill={color} />
        {v.label && (
          <text x={labelX} y={labelY} fontSize="9" fontWeight="bold" fill={color}>
            {v.label}{mag ? ` (${mag})` : ''}
          </text>
        )}
      </g>
    );
  };

  return (
    <div className="bg-white border border-slate-200 rounded p-3">
      <svg viewBox="0 0 200 200" className="w-full max-w-[300px] mx-auto" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <polygon points="0 0, 6 3, 0 6" fill="currentColor" />
          </marker>
        </defs>
        {/* Axes (faint) */}
        <line x1={0} y1={ORIGIN_Y} x2={200} y2={ORIGIN_Y} stroke="#e2e8f0" strokeWidth="0.5" strokeDasharray="2,2" />
        <line x1={ORIGIN_X} y1={0} x2={ORIGIN_X} y2={200} stroke="#e2e8f0" strokeWidth="0.5" strokeDasharray="2,2" />
        {/* Origin dot */}
        <circle cx={ORIGIN_X} cy={ORIGIN_Y} r="3" fill="#1e293b" />
        {/* Vectors */}
        {vektor.map((v: any) => buildArrow(v, false))}
        {/* Resultant (if provided) */}
        {resultan && buildArrow({ ...resultan, label: resultan.label || 'R', color: '#000' }, true)}
      </svg>
      <p className="text-[10px] text-slate-500 mt-1 text-center">
        Skala: 1 unit = {SCALE}px · Sudut: 0°=timur, positif=CCW
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Renderer 10: CellRenderer (diagram_sel) — custom SVG
// Render organel sel sebagai shapes (lingkaran, oval, rect, titik).
// Data: { organel: [{nama, tipe, warna, posisi: [x,y,r] atau [x,y,w,h]}] }
// ═══════════════════════════════════════════════════════════════════════
function CellRenderer({ data }: { data: any }) {
  const organel = Array.isArray(data?.organel) ? data.organel : [];
  if (organel.length === 0) {
    return <InvalidDataRenderer data={data} expected="organel: [{nama, tipe, warna, posisi}]" />;
  }

  return (
    <div className="bg-white border border-slate-200 rounded p-3">
      <svg viewBox="0 0 200 200" className="w-full max-w-[300px] mx-auto" xmlns="http://www.w3.org/2000/svg">
        {organel.map((o: any, i: number) => {
          const nama = o.nama || `Organel ${i + 1}`;
          const tipe = o.tipe || 'lingkaran';
          const warna = o.warna || '#3b82f6';
          const posisi = Array.isArray(o.posisi) ? o.posisi : [50, 50, 10];
          const cx = Number(posisi[0]) || 50;
          const cy = Number(posisi[1]) || 50;
          let shape: any = null;
          if (tipe === 'lingkaran') {
            const r = Number(posisi[2]) || 10;
            shape = <circle cx={cx} cy={cy} r={r} fill={warna} fillOpacity={0.4} stroke={warna} strokeWidth={1.5} />;
          } else if (tipe === 'oval') {
            const rx = Number(posisi[2]) || 10;
            const ry = Number(posisi[3]) || rx * 0.6;
            shape = <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={warna} fillOpacity={0.4} stroke={warna} strokeWidth={1.5} />;
          } else if (tipe === 'rect') {
            const w = Number(posisi[2]) || 20;
            const h = Number(posisi[3]) || 20;
            shape = <rect x={cx} y={cy} width={w} height={h} fill={warna} fillOpacity={0.15} stroke={warna} strokeWidth={1.5} strokeDasharray="3,2" />;
          } else if (tipe === 'titik') {
            const r = Number(posisi[2]) || 2;
            shape = <circle cx={cx} cy={cy} r={r} fill={warna} />;
          } else {
            // fallback: lingkaran kecil
            shape = <circle cx={cx} cy={cy} r={5} fill={warna} fillOpacity={0.4} />;
          }
          return (
            <g key={i}>
              {shape}
              <text x={cx} y={cy + (Number(posisi[2]) || 10) + 8} fontSize="7" textAnchor="middle" fill="#475569">{nama}</text>
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-1 mt-2 justify-center">
        {organel.map((o: any, i: number) => (
          <span key={i} className="text-[9px] px-1.5 py-0.5 rounded" style={{ backgroundColor: (o.warna || '#3b82f6') + '20', color: o.warna || '#3b82f6' }}>
            ● {o.nama || `Organel ${i + 1}`}
          </span>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Renderer 11: CircuitRenderer (rangkaian_listrik) — custom SVG
// Render komponen listrik (resistor, kapasitor, induktor, baterai) + koneksi wire.
// Data: {
//   komponen: [{tipe, label, value, pos: [x,y]}],
//   koneksi: [[i,j], ...]  // indeks ke komponen
// }
// ═══════════════════════════════════════════════════════════════════════
function CircuitRenderer({ data }: { data: any }) {
  const komponen = Array.isArray(data?.komponen) ? data.komponen : [];
  const koneksi = Array.isArray(data?.koneksi) ? data.koneksi : [];
  if (komponen.length === 0) {
    return <InvalidDataRenderer data={data} expected="komponen: [{tipe, label, value, pos}], koneksi: [[i,j]]" />;
  }

  // SVG coord: viewBox 0-200 wide, 0-100 tall. Each komponen rendered at its pos.
  // Komponen symbol size: 24x12 centered at pos.
  const SYMBOL_W = 24, SYMBOL_H = 12;
  const GRID = 50;  // pos values are in 0-100 grid units, mapped to 0-200 viewBox

  const renderComponent = (k: any, i: number) => {
    const tipe = k.tipe || 'resistor';
    const label = k.label || `K${i + 1}`;
    const value = k.value || '';
    const pos = Array.isArray(k.pos) ? k.pos : [25, 50];
    const px = (Number(pos[0]) || 25) * 2;  // scale 0-100 → 0-200
    const py = (Number(pos[1]) || 50) * 2;
    const x = px - SYMBOL_W / 2;
    const y = py - SYMBOL_H / 2;
    let symbol: any = null;
    if (tipe === 'resistor') {
      // Zigzag pattern (4 teeth)
      const teeth = 4;
      const path = `M ${x},${py} L ${x + 3},${py - 4} ${x + 6},${py + 4} ${x + 9},${py - 4} ${x + 12},${py + 4} ${x + 15},${py - 4} ${x + 18},${py + 4} ${x + SYMBOL_W},${py}`;
      symbol = <path d={path} stroke="#1e293b" strokeWidth={1.5} fill="none" />;
    } else if (tipe === 'kapasitor') {
      // Two parallel vertical lines with horizontal leads
      symbol = (
        <g stroke="#1e293b" strokeWidth={1.5} fill="none">
          <line x1={x} y1={py} x2={px - 2} y2={py} />
          <line x1={px - 2} y1={y} x2={px - 2} y2={y + SYMBOL_H} />
          <line x1={px + 2} y1={y} x2={px + 2} y2={y + SYMBOL_H} />
          <line x1={px + 2} y1={py} x2={x + SYMBOL_W} y2={py} />
        </g>
      );
    } else if (tipe === 'induktor') {
      // Three small arcs (coil)
      const arcs = [];
      for (let a = 0; a < 3; a++) {
        const cx = x + 4 + a * 8;
        arcs.push(<path key={a} d={`M ${cx - 4},${py} A 4 4 0 0 1 ${cx + 4},${py}`} stroke="#1e293b" strokeWidth={1.5} fill="none" />);
      }
      symbol = (
        <g>
          <line x1={x} y1={py} x2={x + 4} y2={py} stroke="#1e293b" strokeWidth={1.5} />
          {arcs}
          <line x1={x + SYMBOL_W - 4} y1={py} x2={x + SYMBOL_W} y2={py} stroke="#1e293b" strokeWidth={1.5} />
        </g>
      );
    } else if (tipe === 'battery') {
      // Long line + short line (cell), repeat for battery
      symbol = (
        <g stroke="#1e293b" strokeWidth={1.5} fill="none">
          <line x1={x} y1={py} x2={px - 4} y2={py} />
          <line x1={px - 4} y1={y - 4} x2={px - 4} y2={y + SYMBOL_H + 4} />  {/* long */}
          <line x1={px - 2} y1={y} x2={px - 2} y2={y + SYMBOL_H} />  {/* short */}
          <line x1={px + 2} y1={y - 4} x2={px + 2} y2={y + SYMBOL_H + 4} />  {/* long */}
          <line x1={px + 4} y1={y} x2={px + 4} y2={y + SYMBOL_H} />  {/* short */}
          <line x1={px + 4} y1={py} x2={x + SYMBOL_W} y2={py} />
        </g>
      );
    } else {
      // Fallback: box
      symbol = <rect x={x} y={y} width={SYMBOL_W} height={SYMBOL_H} stroke="#1e293b" strokeWidth={1} fill="none" />;
    }
    return (
      <g key={i}>
        {symbol}
        <text x={px} y={y - 4} fontSize="8" textAnchor="middle" fontWeight="bold" fill="#1e293b">{label}</text>
        {value && <text x={px} y={y + SYMBOL_H + 8} fontSize="7" textAnchor="middle" fill="#64748b">{value}</text>}
      </g>
    );
  };

  // Wire connections between components (just straight lines for simplicity)
  const renderWire = (conn: any, i: number) => {
    if (!Array.isArray(conn) || conn.length < 2) return null;
    const a = komponen[conn[0]];
    const b = komponen[conn[1]];
    if (!a || !b) return null;
    const ax = (Number(a.pos?.[0]) || 25) * 2;
    const ay = (Number(a.pos?.[1]) || 50) * 2;
    const bx = (Number(b.pos?.[0]) || 25) * 2;
    const by = (Number(b.pos?.[1]) || 50) * 2;
    // L-shaped wire: horizontal then vertical (or vice versa)
    const midX = ax;
    return (
      <g key={`wire-${i}`}>
        <polyline points={`${ax},${ay} ${midX},${by} ${bx},${by}`} stroke="#94a3b8" strokeWidth={1} fill="none" strokeDasharray="2,2" />
      </g>
    );
  };

  return (
    <div className="bg-white border border-slate-200 rounded p-3">
      <svg viewBox="0 0 200 100" className="w-full max-w-[400px] mx-auto" xmlns="http://www.w3.org/2000/svg">
        {koneksi.map((c: any, i: number) => renderWire(c, i))}
        {komponen.map((k: any, i: number) => renderComponent(k, i))}
      </svg>
      <p className="text-[10px] text-slate-500 mt-1 text-center">
        Komponen: {komponen.length} · Koneksi: {koneksi.length}
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
