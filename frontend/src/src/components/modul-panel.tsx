import { useAppStore } from '@/lib/store';
import { structureContent, generatePdf, type PdfModuleData } from '@/lib/pdf-generator';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  FileText,
  Download,
  Loader2,
  BookOpen,
  File,
  Layers,
  Sparkles,
  Mic,
  Target,
  Upload,
} from 'lucide-react';
import { MaterialUpload } from '@/components/material-upload';
import { cn } from '@/lib/utils';
import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';

export function ModulPanel() {
  const { transcript, uploadedMaterials, setActiveTab } = useAppStore();
  const [generating, setGenerating] = useState(false);
  const [structuring, setStructuring] = useState(false);
  const [moduleData, setModuleData] = useState<PdfModuleData | null>(null);

  const hasTranscript = transcript.trim().length > 20;
  const materialTexts = uploadedMaterials
    .map((m) => m.text)
    .filter((t) => t.length > 20);
  const hasContent = hasTranscript || materialTexts.length > 0;

  const doStructure = useCallback(async () => {
    if (!hasContent) return null;
    setStructuring(true);
    try {
      const data = await structureContent(transcript, materialTexts);
      setModuleData(data);
      return data;
    } catch (e) {
      console.error('Structure error:', e);
      return null;
    } finally {
      setStructuring(false);
    }
  }, [hasContent, transcript, materialTexts]);

  // Auto-structure when content becomes available
  useEffect(() => {
    if (hasContent && !moduleData) {
      doStructure();
    }
  }, [hasContent]);

  const handleGeneratePdf = async () => {
    setGenerating(true);
    try {
      const data = moduleData || (await doStructure());
      if (!data) {
        toast.error('Gagal menyusun struktur modul');
        return;
      }
      // ── LOG: Verify data source and content before PDF render ──
      console.log('═══════════════════════════════════════════════════');
      console.log('[PDF PRE-RENDER] Data source:', data._source || 'unknown');
      console.log('[PDF PRE-RENDER] Kegiatan count:', data.kegiatanPembelajaran.length);
      console.log('[PDF PRE-RENDER] Kegiatan detail:', JSON.stringify(data.kegiatanPembelajaran.map((k, i) => ({
        idx: i,
        title: k.title,
        materiCount: k.materi?.length,
        materiPreview: k.materi?.[0]?.slice(0, 120),
        hasSteps: !!(k.steps?.length),
        hasReview: !!(k.reviewNotes?.length),
      })), null, 2));
      console.log('═══════════════════════════════════════════════════');
      await generatePdf(data);
      toast.success('Modul PDF berhasil diunduh!');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal generate PDF');
    } finally {
      setGenerating(false);
    }
  };

  // No content state
  if (!hasContent) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] overflow-hidden">
        <div className="px-5 py-3.5 border-b border-white/[0.06] flex items-center gap-2">
          <FileText className="h-4 w-4 text-[#8B5CF6]" />
          <span className="text-sm font-medium text-zinc-200">Modul PDF</span>
        </div>
        <div className="flex flex-col items-center justify-center py-10 text-center px-6">
          <div className="rounded-full bg-white/[0.04] p-4 mb-4">
            <FileText className="h-10 w-10 text-zinc-700" />
          </div>
          <h3 className="text-sm font-medium text-zinc-400 mb-2">Belum ada konten</h3>
          <p className="text-xs text-zinc-600 max-w-xs mb-4">
            Rekam audio di tab STT atau upload materi pendukung untuk membuat modul PDF.
          </p>
          <div className="flex gap-3 mb-6">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setActiveTab('stt')}
              className="gap-2 border-white/[0.08] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06]"
            >
              <Mic className="h-3.5 w-3.5" />
              Buka STT
            </Button>
          </div>
          <div className="w-full max-w-sm">
            <MaterialUpload />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header Card */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] overflow-hidden">
        <div className="px-5 py-3.5 border-b border-white/[0.06] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-[#8B5CF6]" />
            <span className="text-sm font-medium text-zinc-200">Modul PDF</span>
          </div>
          <div className="flex items-center gap-2">
            {structuring && (
              <Badge variant="outline" className="text-[10px] border-violet-500/20 text-violet-400 bg-violet-500/10">
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                AI Structuring
              </Badge>
            )}
            {!structuring && moduleData && (
              <Badge variant="outline" className="text-[10px] border-emerald-500/20 text-emerald-400 bg-emerald-500/10">
                <Sparkles className="h-3 w-3 mr-1" />
                Siap
              </Badge>
            )}
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* Content Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <InfoCard icon={Mic} label="Transkrip" value={`${transcript.length} kar`} color="text-[#8B5CF6]" />
            <InfoCard icon={File} label="Materi" value={`${materialTexts.length} file`} color="text-sky-400" />
            {moduleData && (
              <InfoCard icon={Layers} label="Kegiatan" value={`${moduleData.kegiatanPembelajaran.length}`} color="text-violet-400" />
            )}
          </div>

          {/* Generate Button */}
          <Button
            onClick={handleGeneratePdf}
            disabled={generating || !moduleData || structuring}
            className="w-full h-12 gap-2 bg-[#8B5CF6] hover:bg-[#d14e1c] text-white font-medium rounded-lg text-sm"
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Membuat PDF...
              </>
            ) : structuring ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Menyusun struktur...
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                Download Modul PDF
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Module Structure Preview */}
      {moduleData && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-white/[0.06] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-[#8B5CF6]" />
              <span className="text-sm font-medium text-zinc-200">Struktur Modul</span>
            </div>
            <span className="text-[11px] text-zinc-600">Preview</span>
          </div>
          <ScrollArea className="max-h-[500px]">
            <div className="p-5 space-y-4">
              {/* Title Preview */}
              <div className="rounded-lg bg-[#0c0c0e] border border-white/[0.06] p-4">
                <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1">Judul Modul</p>
                <p className="text-sm font-semibold text-zinc-200">{moduleData.title}</p>
                <p className="text-xs text-zinc-500 mt-1">
                  {moduleData.identitas.mataPelajaran} {moduleData.identitas.kelas !== '-' ? `— ${moduleData.identitas.kelas}` : ''} — {moduleData.date}
                </p>
              </div>

              {/* Pendahuluan Preview */}
              {moduleData.pendahuluan && (
                <div className="rounded-lg bg-[#0c0c0e] border border-white/[0.06] p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <BookOpen className="h-3.5 w-3.5 text-[#8B5CF6]" />
                    <h3 className="text-xs font-semibold text-zinc-200">Pendahuluan</h3>
                  </div>
                  <p className="text-[11px] text-zinc-500 leading-relaxed line-clamp-3">
                    {moduleData.pendahuluan.slice(0, 300)}
                    {moduleData.pendahuluan.length > 300 ? '...' : ''}
                  </p>
                </div>
              )}

              {/* Tujuan Preview */}
              {moduleData.tujuanPembelajaran.length > 0 && (
                <div className="rounded-lg bg-[#0c0c0e] border border-white/[0.06] p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Target className="h-3.5 w-3.5 text-emerald-400" />
                    <h3 className="text-xs font-semibold text-zinc-200">Tujuan Pembelajaran ({moduleData.tujuanPembelajaran.length})</h3>
                  </div>
                  <div className="space-y-1 ml-6">
                    {moduleData.tujuanPembelajaran.map((t, i) => (
                      <p key={i} className="text-[11px] text-zinc-400 leading-relaxed">
                        {i + 1}. {t.slice(0, 120)}{t.length > 120 ? '...' : ''}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {/* Kegiatan Preview */}
              {moduleData.kegiatanPembelajaran.map((kg, i) => (
                <div key={i} className="rounded-lg bg-[#0c0c0e] border border-white/[0.06] p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="flex items-center justify-center h-5 w-5 rounded bg-[#8B5CF6]/10 text-[#8B5CF6] text-[10px] font-bold">{i + 1}</span>
                    <h3 className="text-xs font-semibold text-zinc-200">Kegiatan {i + 1}: {kg.title}</h3>
                  </div>
                  <div className="space-y-1 ml-7">
                    {kg.materi.slice(0, 2).map((para, j) => (
                      <p key={j} className="text-[11px] text-zinc-500 leading-relaxed line-clamp-2">
                        {para.slice(0, 150)}{para.length > 150 ? '...' : ''}
                      </p>
                    ))}
                    <div className="flex gap-2 mt-1">
                      {kg.steps && kg.steps.length > 0 && (
                        <span className="text-[9px] text-blue-400 bg-blue-400/10 px-1.5 py-0.5 rounded">SOP</span>
                      )}
                      {kg.materi.length > 2 && (
                        <span className="text-[9px] text-zinc-600">+{kg.materi.length - 2} paragraf</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

    </div>
  );
}

function InfoCard({ icon: Icon, label, value, color }: { icon: typeof Mic; label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-3">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={cn('h-3.5 w-3.5', color)} />
        <span className="text-[10px] text-zinc-500">{label}</span>
      </div>
      <p className="text-sm font-semibold text-zinc-200">{value}</p>
    </div>
  );
}
