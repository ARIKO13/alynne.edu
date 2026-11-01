import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import {
  Brain, Sparkles, RotateCcw, Download, ZoomIn, ZoomOut, Maximize2,
  Mic, FileText, Loader2, Edit3, Network,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { FeatureTutorial } from '@/components/feature-tutorial';

// --- Types ---

type InputMode = 'auto' | 'manual';

interface Branch {
  label: string;
  subtopics: string[];
}
interface MindMapResult {
  title: string;
  branches: Branch[];
  source: string;
}

// --- Color Palette (Neural Drift) ---

const COLORS = [
  { fill: '#7FC4B8', bg: 'rgba(183,148,246,0.18)', border: '#7FC4B8', text: '#fff' },
  { fill: '#F687B3', bg: 'rgba(246,135,179,0.18)', border: '#F687B3', text: '#fff' },
  { fill: '#60A5FA', bg: 'rgba(96,165,250,0.18)', border: '#60A5FA', text: '#fff' },
  { fill: '#34D399', bg: 'rgba(52,211,153,0.18)', border: '#34D399', text: '#fff' },
  { fill: '#FBBF24', bg: 'rgba(251,191,36,0.18)', border: '#FBBF24', text: '#1a1a1a' },
  { fill: '#FB7185', bg: 'rgba(251,113,133,0.18)', border: '#FB7185', text: '#fff' },
];

// --- Text Utilities ---

function measureText(text: string, size: number): number {
  let w = 0;
  for (const ch of text) w += ch.charCodeAt(0) > 0x2000 ? size * 1.05 : size * 0.58;
  return w;
}

function wrapText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    const t = cur ? cur + ' ' + word : word;
    if (t.length > maxChars && cur) { lines.push(cur); cur = word; }
    else cur = t;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [text];
}

// --- Radial Layout Engine ---

interface LayoutNode {
  id: string; label: string;
  x: number; y: number; w: number; h: number;
  cx: number; cy: number;
  color: typeof COLORS[0]; level: 0 | 1 | 2;
}
interface LayoutEdge {
  from: string; to: string; color: string;
}
interface RadialLayout {
  nodes: LayoutNode[]; edges: LayoutEdge[];
  width: number; height: number;
}

function layoutRadial(title: string, branches: Branch[]): RadialLayout {
  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];

  const rootLines = wrapText(title, 22);
  const rootFont = 16;
  const rootW = Math.max(160, ...rootLines.map(l => measureText(l, rootFont))) + 64;
  const rootH = rootLines.length * (rootFont + 5) + 36;

  const BRANCH_R = 210;
  const SUB_R = 165;

  const n = branches.length;
  if (n === 0) return { nodes: [], edges: [], width: 400, height: 300 };

  const angleStep = (2 * Math.PI) / n;
  const startAngle = -Math.PI / 2;

  const tempNodes: LayoutNode[] = [];

  tempNodes.push({
    id: 'root', label: title,
    x: -rootW / 2, y: -rootH / 2, w: rootW, h: rootH,
    cx: 0, cy: 0, color: COLORS[0], level: 0,
  });

  branches.forEach((branch, i) => {
    const color = COLORS[i % COLORS.length];
    const angle = startAngle + i * angleStep;

    const bLines = wrapText(branch.label, 18);
    const bFont = 13;
    const bW = Math.max(110, ...bLines.map(l => measureText(l, bFont))) + 44;
    const bH = bLines.length * (bFont + 4) + 24;

    const bx = Math.cos(angle) * BRANCH_R;
    const by = Math.sin(angle) * BRANCH_R;
    const bId = `b${i}`;

    tempNodes.push({
      id: bId, label: branch.label,
      x: bx - bW / 2, y: by - bH / 2, w: bW, h: bH,
      cx: bx, cy: by, color, level: 1,
    });
    edges.push({ from: 'root', to: bId, color: color.fill });

    const subs = (branch.subtopics || []).slice(0, 3);
    const subCount = subs.length;
    if (subCount === 0) return;

    const maxSpread = Math.min(Math.PI / 2.8, angleStep * 0.75);
    const subAngleStep = subCount === 1 ? 0 : maxSpread / (subCount - 1);
    const subStartAngle = angle - maxSpread / 2;

    subs.forEach((sub, j) => {
      const subAngle = subCount === 1 ? angle : subStartAngle + j * subAngleStep;

      const sLines = wrapText(sub, 16);
      const sFont = 11.5;
      const sW = Math.max(90, ...sLines.map(l => measureText(l, sFont))) + 32;
      const sH = sLines.length * (sFont + 3) + 16;

      const sx = bx + Math.cos(subAngle) * SUB_R;
      const sy = by + Math.sin(subAngle) * SUB_R;
      const sId = `s${i}_${j}`;

      tempNodes.push({
        id: sId, label: sub,
        x: sx - sW / 2, y: sy - sH / 2, w: sW, h: sH,
        cx: sx, cy: sy, color, level: 2,
      });
      edges.push({ from: bId, to: sId, color: color.fill });
    });
  });

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of tempNodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w);
    maxY = Math.max(maxY, n.y + n.h);
  }

  const PAD = 80;
  const offsetX = -minX + PAD;
  const offsetY = -minY + PAD;

  for (const n of tempNodes) {
    n.x += offsetX; n.y += offsetY;
    n.cx += offsetX; n.cy += offsetY;
  }

  return {
    nodes: tempNodes,
    edges,
    width: maxX - minX + PAD * 2,
    height: maxY - minY + PAD * 2,
  };
}

// --- Edge Path (smooth bezier, edge-to-edge) ---

function rectEdgePoint(node: LayoutNode, tx: number, ty: number): { x: number; y: number } {
  const dx = tx - node.cx;
  const dy = ty - node.cy;
  if (dx === 0 && dy === 0) return { x: node.cx, y: node.cy };
  const hw = node.w / 2 + 2;
  const hh = node.h / 2 + 2;
  const scale = Math.abs(dx) / hw > Math.abs(dy) / hh ? hw / Math.abs(dx) : hh / Math.abs(dy);
  return { x: node.cx + dx * scale, y: node.cy + dy * scale };
}

function edgePath(from: LayoutNode, to: LayoutNode): string {
  const fp = rectEdgePoint(from, to.cx, to.cy);
  const tp = rectEdgePoint(to, from.cx, from.cy);
  const dx = tp.x - fp.x, dy = tp.y - fp.y;
  const dist = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const cpOff = dist * 0.35;
  return `M ${fp.x} ${fp.y} C ${fp.x + Math.cos(angle) * cpOff} ${fp.y + Math.sin(angle) * cpOff}, ${tp.x - Math.cos(angle) * cpOff} ${tp.y - Math.sin(angle) * cpOff}, ${tp.x} ${tp.y}`;
}

// --- Radial Mind Map SVG Component ---

function RadialMindMap({ data, onNodeClick, selectedNode }: {
  data: RadialLayout;
  onNodeClick?: (id: string) => void;
  selectedNode: string | null;
}) {
  const nodeMap = useMemo(() => new Map(data.nodes.map(n => [n.id, n])), [data.nodes]);

  return (
    <g>
      {/* Edges */}
      {data.edges.map((e, i) => {
        const f = nodeMap.get(e.from), t = nodeMap.get(e.to);
        if (!f || !t) return null;
        return (
          <path key={`e${i}`} d={edgePath(f, t)}
            fill="none" stroke={e.color} strokeWidth={1.5} opacity={0.45}
            strokeLinecap="round" />
        );
      })}

      {/* Nodes - TEXT ONLY */}
      {data.nodes.map(node => {
        const isRoot = node.level === 0;
        const isBranch = node.level === 1;

        const font = isRoot ? 16 : isBranch ? 13 : 11.5;
        const maxChars = isRoot ? 22 : isBranch ? 18 : 16;
        const lines = wrapText(node.label, maxChars);
        const lineH = font + (isRoot ? 5 : isBranch ? 4 : 3);
        const textStartY = node.cy - ((lines.length - 1) * lineH) / 2 + font * 0.35;
        const textColor = node.color.border;
        const fontWeight = isRoot ? 700 : isBranch ? 600 : 500;

        return (
          <g key={node.id} onClick={() => onNodeClick?.(node.id)} className="cursor-pointer">
            <rect x={node.x} y={node.y} width={node.w} height={node.h}
              rx={14} fill="transparent" stroke="none" />
            {lines.map((line, li) => (
              <text key={li}
                x={node.cx} y={textStartY + li * lineH}
                textAnchor="middle" dominantBaseline="central"
                fill={textColor} fontSize={font} fontWeight={fontWeight}
                style={{ pointerEvents: 'none', fontFamily: 'Inter, system-ui, -apple-system, sans-serif' }}>
                {line}
              </text>
            ))}
          </g>
        );
      })}
    </g>
  );
}

// --- Mind Map Container (with zoom/pan) ---

function MindMapCanvas({ layout, onNodeSelect, selectedNode }: {
  layout: RadialLayout;
  onNodeSelect?: (id: string | null) => void;
  selectedNode: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isPanning = useRef(false);
  const lastPan = useRef({ x: 0, y: 0 });
  const raf = useRef<number>(0);

  const fitToView = useCallback(() => {
    if (!containerRef.current) return;
    const cw = containerRef.current.clientWidth;
    const ch = containerRef.current.clientHeight;
    const s = Math.min(cw / layout.width, ch / layout.height) * 0.88;
    setZoom(Math.max(0.15, Math.min(2, s)));
    setPan({
      x: (cw - layout.width * s) / 2,
      y: (ch - layout.height * s) / 2,
    });
  }, [layout.width, layout.height]);

  useEffect(() => { setTimeout(fitToView, 100); }, [fitToView]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(z => Math.max(0.1, Math.min(3, z - e.deltaY * 0.001)));
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    isPanning.current = true;
    lastPan.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  }, [pan]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning.current) return;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() =>
      setPan({ x: e.clientX - lastPan.current.x, y: e.clientY - lastPan.current.y })
    );
  }, []);

  const onMouseUp = useCallback(() => { isPanning.current = false; }, []);

  return (
    <div className="relative group/mm">
      <div ref={containerRef}
        className="w-full overflow-hidden select-none"
        style={{
          height: 560,
          background: '#0a0a0a',
          cursor: isPanning.current ? 'grabbing' : 'grab',
        }}
        onWheel={onWheel}
        onMouseDown={e => { onMouseDown(e); if ((e.target as Element).tagName === 'svg' || (e.target as Element).tagName === 'rect') onNodeSelect?.(null); }}
        onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}>

        <svg id="mindmap-svg" width={layout.width} height={layout.height}
          style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`, transformOrigin: '0 0', transition: isPanning.current ? 'none' : 'transform 0.15s ease-out' }}>

          <RadialMindMap data={layout} onNodeClick={onNodeSelect} selectedNode={selectedNode} />
        </svg>
      </div>

      {/* Zoom controls */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-black/60  border border-white/[0.06] rounded-full px-2 py-1 opacity-0 group-hover/mm:opacity-100 transition-opacity">
        <button onClick={() => setZoom(z => Math.min(3, z + 0.2))} className="p-1 text-stone-400 hover:text-white transition-colors"><ZoomIn className="h-3.5 w-3.5"/></button>
        <span className="text-[10px] text-stone-500 w-9 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(z => Math.max(0.1, z - 0.2))} className="p-1 text-stone-400 hover:text-white transition-colors"><ZoomOut className="h-3.5 w-3.5"/></button>
        <div className="w-px h-3.5 bg-white/[0.08] mx-0.5"/>
        <button onClick={fitToView} className="p-1 text-stone-400 hover:text-white transition-colors" title="Fit"><Maximize2 className="h-3.5 w-3.5"/></button>
      </div>
    </div>
  );
}

const MINDMAP_TUTORIAL = [
  { title: 'Pilih sumber teks', desc: 'Pilih "Auto" untuk pakai transkrip STT atau file upload, atau "Materi Pendukung" untuk paste teks manual.' },
  { title: 'Generate mind map', desc: 'Klik tombol "Generate Mind Map (AI)". AI akan menganalisis teks dan membangun peta konsep radial secara otomatis.' },
  { title: 'Navigasi mind map', desc: 'Scroll mouse = zoom in/out. Klik dan drag = geser peta. Klik node = lihat detail topik di bawah.' },
  { title: 'Export PNG', desc: 'Klik "PNG" untuk download mind map sebagai gambar. Bisa juga di-regenerate ulang dengan tombol rotate.' },
];

// --- Main Panel Component ---

export function MindMapPanel() {
  const { transcript, uploadedMaterials } = useAppStore();
  const [result, setResult] = useState<MindMapResult | null>(null);
  const [layout, setLayout] = useState<RadialLayout | null>(null);
  const [sourceText, setSourceText] = useState('');
  const [generating, setGenerating] = useState(false);
  const [mapTitle, setMapTitle] = useState('');
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<InputMode>('auto');
  const [manualText, setManualText] = useState('');

  const materialTexts = uploadedMaterials.map(m => m.text).filter(Boolean).join('\n\n');
  const hasTranscript = (transcript || '').trim().length >= 30;
  const hasMaterials = materialTexts.length >= 30;
  const hasManual = manualText.trim().length >= 30;

  function getAvailableText(): string {
    if (inputMode === 'manual' && hasManual) return manualText.trim();
    if (hasTranscript) return transcript || '';
    if (hasMaterials) return materialTexts;
    return '';
  }
  const availableText = getAvailableText();

  const generateMap = useCallback(async (text?: string) => {
    const t = text || availableText;
    if (!t || t.trim().length < 30) { toast.error('Teks terlalu pendek. Minimal 30 karakter.'); return; }
    setGenerating(true); setSelectedNode(null);
    try {
      const res = await fetch('/api/mindmaps/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: t }),
      });
      const data = await res.json();
      if (data.error) { toast.error(data.error); setGenerating(false); return; }
      setSourceText(t);
      if (data.title && data.branches) {
        const r: MindMapResult = { title: data.title, branches: data.branches, source: data.source };
        setResult(r); setMapTitle(data.title);
        setLayout(layoutRadial(data.title, data.branches));
        toast.success(`Mind map dibuat (${data.source === 'gateway' ? 'Gateway AI' : 'Groq'})!`);
      }
    } catch { toast.error('Gagal menghubungi server'); }
    finally { setGenerating(false); }
  }, [availableText, manualText, inputMode]);

  const exportPNG = () => {
    if (!layout) return;
    const svgEl = document.querySelector('#mindmap-svg');
    if (!svgEl) return;
    const svgData = new XMLSerializer().serializeToString(svgEl);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const s = 2, w = layout.width, h = layout.height;
    canvas.width = w * s; canvas.height = h * s; ctx.scale(s, s);
    ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, w, h);
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, w, h);
      const a = document.createElement('a'); a.download = `mindmap-${Date.now()}.png`;
      a.href = canvas.toDataURL('image/png'); a.click();
    };
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  };

  const sourceLabel = inputMode === 'manual'
    ? (hasManual ? 'Materi Manual' : 'Belum ada teks')
    : hasTranscript ? `STT (${transcript.length} chars)`
    : hasMaterials ? `Upload (${uploadedMaterials.length} file)`
    : 'Belum ada sumber';

  const selectedNodeData = selectedNode ? layout?.nodes.find(n => n.id === selectedNode) : null;

  return (
    <div className="space-y-4">
      <FeatureTutorial title="Mind Map" steps={MINDMAP_TUTORIAL} storageKey="mindmap" accentColor="#34D399" />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Mind Map Generator</h2>
          <p className="text-xs text-stone-500 mt-0.5">Generate mind map dari transcript, materi upload, atau teks manual</p>
        </div>
        <div className="flex gap-2">
          {layout && (
            <Button onClick={exportPNG} variant="outline" size="sm" className="border-white/[0.08] text-stone-400 hover:text-white hover:bg-white/[0.04] gap-1.5"><Download className="h-3.5 w-3.5" /> PNG</Button>
          )}
        </div>
      </div>

      {/* Empty state */}
      {!layout && !generating && (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-8 text-center">
          <Brain className="h-14 w-14 text-stone-700 mx-auto mb-4" />
          <h3 className="text-base font-medium text-stone-300 mb-2">Buat Mind Map dengan AI</h3>
          <p className="text-xs text-stone-500 max-w-md mx-auto mb-5 leading-relaxed">
            AI akan menganalisa teks dan membangun peta konsep visual. Pilih sumber input:
          </p>
          <div className="flex items-center justify-center gap-2 mb-5">
            <button onClick={() => setInputMode('auto')}
              className={cn('px-4 py-2 rounded-lg text-xs font-medium transition-colors flex items-center gap-2',
                inputMode === 'auto' ? 'bg-[#7FC4B8]/15 text-[#7FC4B8] border border-[#7FC4B8]/30' : 'bg-white/[0.03] text-stone-500 border border-white/[0.06] hover:bg-white/[0.05]')}>
              <Mic className="h-3.5 w-3.5" /> Auto (STT / Upload)
            </button>
            <button onClick={() => setInputMode('manual')}
              className={cn('px-4 py-2 rounded-lg text-xs font-medium transition-colors flex items-center gap-2',
                inputMode === 'manual' ? 'bg-[#F687B3]/15 text-[#F687B3] border border-[#F687B3]/30' : 'bg-white/[0.03] text-stone-500 border border-white/[0.06] hover:bg-white/[0.05]')}>
              <Edit3 className="h-3.5 w-3.5" /> Materi Pendukung
            </button>
          </div>
          {inputMode === 'auto' ? (
            <div className="flex items-center justify-center gap-5 mb-6">
              <div className="flex items-center gap-2 text-[11px] text-stone-500">
                <Mic className="h-3.5 w-3.5 text-[#7FC4B8]" />
                <span>STT: {hasTranscript ? `${transcript.length} chars` : 'kosong'}</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-stone-500">
                <FileText className="h-3.5 w-3.5 text-[#F687B3]" />
                <span>Upload: {uploadedMaterials.length} file</span>
              </div>
            </div>
          ) : (
            <div className="mb-6 max-w-lg mx-auto">
              <textarea value={manualText} onChange={e => setManualText(e.target.value)}
                placeholder={"Paste materi pendukung di sini...\n\nContoh:\n- Catatan kuliah\n- Ringkasan bab dari textbook\n- Point-point slide perkuliahan"}
                className="w-full h-40 bg-white/[0.03] border border-white/[0.08] rounded-lg p-4 text-sm text-stone-300 placeholder:text-stone-600 resize-none focus:outline-none focus:border-[#7FC4B8]/40 focus:ring-1 focus:ring-[#7FC4B8]/20 transition-colors" />
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-[10px] text-stone-600">{manualText.trim().length < 30 ? 'Minimal 30 karakter' : `${manualText.length} chars - siap`}</span>
                {manualText && <button onClick={() => setManualText('')} className="text-[10px] text-stone-600 hover:text-red-400">Hapus</button>}
              </div>
            </div>
          )}
          <Button onClick={() => generateMap()} disabled={inputMode === 'auto' ? (!hasTranscript && !hasMaterials) : !hasManual} size="lg"
            className="bg-gradient-to-r from-[#7FC4B8] to-[#F687B3] text-white hover:opacity-90 gap-2 disabled:opacity-40">
            <Sparkles className="h-4 w-4" /> Generate Mind Map (AI)
          </Button>
        </div>
      )}

      {/* Generating */}
      {generating && (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-12 text-center">
          <Loader2 className="h-10 w-10 text-[#7FC4B8] animate-spin mx-auto mb-4" />
          <p className="text-sm text-stone-400">AI sedang menganalisa dan membangun mind map...</p>
          <p className="text-[10px] text-stone-600 mt-2">Sumber: {sourceLabel}</p>
        </div>
      )}

      {/* Mind Map Display */}
      {layout && !generating && (<>
        {/* Toolbar */}
        <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.03] p-2">
          <div className="flex items-center gap-2">
            <span className={cn('text-[9px] px-1.5 py-0.5 rounded-full',
              result?.source === 'gateway' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400')}>
              {result?.source === 'gateway' ? 'Gateway AI' : 'Groq'}
            </span>
            <span className="text-[9px] text-stone-600">{result?.branches.length} cabang</span>
          </div>
          <div className="flex items-center gap-2">
            <input value={mapTitle} onChange={e => setMapTitle(e.target.value)}
              className="bg-transparent text-xs text-stone-400 border-b border-transparent hover:border-white/[0.1] focus:border-[#7FC4B8]/40 focus:outline-none px-1 py-0.5 w-40" />
            <Button onClick={() => generateMap(sourceText)} variant="ghost" size="sm" className="text-stone-400 hover:text-white h-8 w-8 p-0" title="Regenerate">
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Canvas */}
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] overflow-hidden" style={{ borderRadius: '16px' }}>
          <MindMapCanvas layout={layout} onNodeSelect={setSelectedNode} selectedNode={selectedNode} />
        </div>

        {/* Selected node detail */}
        {selectedNodeData && (
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3 flex items-center gap-3">
            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: selectedNodeData.color.fill }} />
            <div>
              <p className="text-sm font-medium text-white">{selectedNodeData.label}</p>
              <p className="text-[10px] text-stone-500">
                {selectedNodeData.level === 0 ? 'Topik utama' : selectedNodeData.level === 1 ? 'Cabang utama' : 'Sub-topik'}
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-center gap-4 text-[10px] text-stone-600">
          <span>Scroll = Zoom</span><span>Drag = Pan</span><span>Klik node = Detail</span>
        </div>
      </>)}
    </div>
  );
}
