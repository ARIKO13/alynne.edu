/**
 * LabTeks.tsx  -  Lab Teks: 3 alat berbasis AI
 *
 * 1. Penerjemah Tongkrongan: jurnal/slide dosen yang kaku -> penjelasan
 *    santai sehari-hari (3 tingkat ke-santai-an) tanpa mengubah fakta.
 * 2. Korektor Esai: draf esai dinilai sesuai rubrik (skor per komponen,
 *    kekuatan, revisi prioritas).
 * 3. Audit Catatan: catatan tulis tangan dibandingkan dengan materi/slide
 *    dosen -> bagian salah konsep & yang terlewat.
 *
 * Semua panggilan pakai /api/ai/chat (pola repo, dual-shape read). Prompt
 * dikunci strict grounding: koreksi/audit HANYA dari teks & rubrik yang
 * diberikan user, bukan pengetahuan umum model.
 */

import { useCallback, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Languages, ScrollText, ScanSearch, Send } from 'lucide-react';

type ToolId = 'tongkrongan' | 'esai' | 'audit';

interface EsaiResult {
  nilai_total: number;
  komponen: { nama: string; skor: number; catatan: string }[];
  kekuatan: string[];
  perbaikan: { prioritas: string; masalah: string; saran: string }[];
}
interface AuditResult {
  salah_konsep: { kutipan_catatan: string; fakta_benar: string; penjelasan: string }[];
  terlewat: string[];
  cocok: string[];
}

const TOOLS: { id: ToolId; label: string; desc: string; icon: typeof Languages }[] = [
  { id: 'tongkrongan', label: 'Penerjemah tongkrongan', desc: 'Jurnal/slide kaku jadi penjelasan santai yang cepat dipahami', icon: Languages },
  { id: 'esai', label: 'Korektor esai', desc: 'Draf esai dinilai sesuai rubrik: skor, kekuatan, revisi', icon: ScrollText },
  { id: 'audit', label: 'Audit catatan', desc: 'Catatanmu dibandingkan dengan materi dosen: salah konsep & terlewat', icon: ScanSearch },
];

const TINGKAT: Record<string, string> = {
  'santai-banget': 'santai banget, seperti ngobrol di warung kopi (boleh "kayak", "gitu")',
  'seimbang': 'santai tapi rapi, seperti teman sekelas menjelaskan',
  'presentasi': 'tetap sopan, seperti presentasi ke teman satu angkatan',
};

const RUBRIK: Record<string, string> = {
  'umum': 'Esai akademik umum (argumen, struktur, kebahasaan)',
  'pkm': 'Proposal PKM (latar belakang, metode GAWAI/5W+1H, RAB, jadwal, output)',
  'skripsi': 'Draf bab skripsi (landasan teori, metodologi, sitasi)',
  'beasiswa': 'Esai beasiswa (motivasi, kontribusi, rencana studi)',
};

function parseJsonLoose<T>(text: string): T | null {
  const cleaned = text.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

export function LabTeks({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tool, setTool] = useState<ToolId>('tongkrongan');

  // tongkrongan
  const [sumber, setSumber] = useState('');
  const [tingkat, setTingkat] = useState('seimbang');
  const [hasilTongkrongan, setHasilTongkrongan] = useState('');

  // esai
  const [esai, setEsai] = useState('');
  const [rubrik, setRubrik] = useState('umum');
  const [hasilEsai, setHasilEsai] = useState<EsaiResult | null>(null);

  // audit
  const [catatan, setCatatan] = useState('');
  const [materiDosen, setMateriDosen] = useState('');
  const [hasilAudit, setHasilAudit] = useState<AuditResult | null>(null);

  const [loading, setLoading] = useState(false);

  const callChat = useCallback(async (system: string, userContent: string, maxTokens: number, task: string) => {
    const res = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
        max_tokens: maxTokens,
        task,
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) throw new Error(`server ${res.status}`);
    const data = await res.json();
    return (data.choices?.[0]?.message?.content || data.content || '') as string;
  }, []);

  const run = useCallback(async () => {
    if (tool === 'tongkrongan') {
      if (sumber.trim().length < 30) { toast.error('Teks sumber masih kosong/terlalu pendek.'); return; }
      setHasilTongkrongan('');
      setLoading(true);
      try {
        const reply = await callChat(
          [
            'Kamu penerjemah bahasa akademis Indonesia ke bahasa santai sehari-hari.',
            `Tingkat ke-santai-an: ${TINGKAT[tingkat]}.`,
            'ATURAN: pertahankan SEMUA fakta, angka, dan istilah teknis (istilah teknis boleh dipertahankan berbahasa asing tapi wajib diberi penjelasan kasar dalam kurung).',
            'Struktur paragraf asli boleh dipecah agar enak dibaca. DILARANG menambah fakta baru atau memberi opini. DILARANG emoji.',
            'Awali dengan 1 kalimat "inti singkatnya:" yang merangkum teks.',
          ].join('\n'),
          sumber,
          1400,
          'conversation'
        );
        setHasilTongkrongan(reply);
      } catch (e) {
        console.error('[lab-teks] tongkrongan gagal:', e);
        toast.error('Gagal menerjemahkan. Server AI sedang sibuk, coba lagi.');
      } finally {
        setLoading(false);
      }
    }

    if (tool === 'esai') {
      if (esai.trim().length < 100) { toast.error('Draf esai terlalu pendek untuk dinilai (minimal ±100 karakter).'); return; }
      setHasilEsai(null);
      setLoading(true);
      try {
        const reply = await callChat(
          [
            'Kamu dosen/penilai esai Indonesia. Nilai draf esai user SESUAI RUBRIK yang ditentukan.',
            `Rubrik: ${RUBRIK[rubrik]}.`,
            'ATURAN ANTI-HALUSINASI: nilai dan catatan HANYA berdasarkan teks esai yang diberikan. Kutip kalimat asli esai saat menunjukkan masalah. DILARANG mengarang bagian esai yang tidak ada.',
            'Balas HANYA JSON valid: {"nilai_total": 0-100, "komponen": [{"nama": "...", "skor": 0-100, "catatan": "..."}] (4-5 komponen), "kekuatan": ["..."], "perbaikan": [{"prioritas": "tinggi|sedang|rendah", "masalah": "...", "saran": "..."}] (3-6 item)}',
          ].join('\n'),
          esai,
          1800,
          'structured-json'
        );
        const parsed = parseJsonLoose<EsaiResult>(reply);
        if (parsed) setHasilEsai(parsed);
        else toast.error('Hasil penilaian tidak terbaca; coba lagi.');
      } catch (e) {
        console.error('[lab-teks] esai gagal:', e);
        toast.error('Gagal menilai esai. Server AI sedang sibuk, coba lagi.');
      } finally {
        setLoading(false);
      }
    }

    if (tool === 'audit') {
      if (catatan.trim().length < 30 || materiDosen.trim().length < 30) {
        toast.error('Isi dua-duanya: catatanmu dan materi/slide dosen.');
        return;
      }
      setHasilAudit(null);
      setLoading(true);
      try {
        const reply = await callChat(
          [
            'Kamu auditor catatan belajar. Bandingkan CATATAN SISWA dengan MATERI DOSEN.',
            'ATURAN ANTI-HALUSINASI: hanya gunakan dua teks itu. "salah_konsep" hanya untuk pernyataan catatan yang BERTENTANGAN dengan materi dosen (kutip pernyataan aslinya). "terlewat" = poin penting materi yang tidak muncul di catatan (maksimal 6, urut dari paling penting). "cocok" = poin yang sudah benar tertangkap (maksimal 5).',
            'Balas HANYA JSON valid: {"salah_konsep": [{"kutipan_catatan": "...", "fakta_benar": "...", "penjelasan": "..."}], "terlewat": ["..."], "cocok": ["..."]}',
          ].join('\n'),
          `CATATAN SISWA:\n${catatan}\n\nMATERI DOSEN:\n${materiDosen}`,
          1800,
          'structured-json'
        );
        const parsed = parseJsonLoose<AuditResult>(reply);
        if (parsed) setHasilAudit(parsed);
        else toast.error('Hasil audit tidak terbaca; coba lagi.');
      } catch (e) {
        console.error('[lab-teks] audit gagal:', e);
        toast.error('Gagal mengaudit catatan. Server AI sedang sibuk, coba lagi.');
      } finally {
        setLoading(false);
      }
    }
  }, [tool, sumber, tingkat, esai, rubrik, catatan, materiDosen, callChat]);

  const chip = (active: boolean) =>
    'rounded-md border px-3 py-1.5 text-sm transition-colors ' +
    (active
      ? 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text)]'
      : 'border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surface-2)]');

  const inputCls =
    'w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]';

  const busy = tool === 'tongkrongan' ? 'Menerjemahkan...' : tool === 'esai' ? 'Menilai esai...' : 'Mengaudit catatan...';

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl w-[calc(100vw-2rem)] max-h-[94vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg">Lab teks</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Pilih alat teks">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tool === t.id}
              onClick={() => setTool(t.id)}
              className={chip(tool === t.id) + ' flex items-center gap-1.5'}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-[var(--text-2)]">{TOOLS.find((t) => t.id === tool)?.desc}</p>

        {/* ── tongkrongan ── */}
        {tool === 'tongkrongan' && (
          <div className="space-y-3 mt-1">
            <textarea
              rows={6}
              value={sumber}
              onChange={(e) => setSumber(e.target.value)}
              placeholder="Tempel paragraf jurnal, abstrak, atau slide dosen yang kaku..."
              className={inputCls + ' resize-none'}
              aria-label="Teks akademis sumber"
            />
            <div className="flex flex-wrap gap-2">
              {Object.keys(TINGKAT).map((k) => (
                <button key={k} aria-pressed={tingkat === k} onClick={() => setTingkat(k)} className={chip(tingkat === k)}>
                  {k === 'santai-banget' ? 'Santai banget' : k === 'seimbang' ? 'Seimbang' : 'Untuk presentasi'}
                </button>
              ))}
            </div>
            <Button onClick={run} disabled={loading} className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)]">
              <Send className="h-3.5 w-3.5 mr-2" />
              {loading ? busy : 'Terjemahkan ke bahasa tongkrongan'}
            </Button>
            {hasilTongkrongan && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text-2)] whitespace-pre-wrap">
                {hasilTongkrongan}
              </div>
            )}
          </div>
        )}

        {/* ── korektor esai ── */}
        {tool === 'esai' && (
          <div className="space-y-3 mt-1">
            <textarea
              rows={8}
              value={esai}
              onChange={(e) => setEsai(e.target.value)}
              placeholder="Tempel draf esai yang mau dinilai..."
              className={inputCls + ' resize-none'}
              aria-label="Draf esai"
            />
            <div className="flex flex-wrap gap-2">
              {Object.keys(RUBRIK).map((k) => (
                <button key={k} aria-pressed={rubrik === k} onClick={() => setRubrik(k)} className={chip(rubrik === k)}>
                  {k === 'umum' ? 'Esai umum' : k === 'pkm' ? 'Proposal PKM' : k === 'skripsi' ? 'Bab skripsi' : 'Esai beasiswa'}
                </button>
              ))}
            </div>
            <Button onClick={run} disabled={loading} className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)]">
              <Send className="h-3.5 w-3.5 mr-2" />
              {loading ? busy : 'Nilai draf ini'}
            </Button>
            {hasilEsai && (
              <div className="space-y-4">
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 flex items-center gap-4">
                  <p className={'text-4xl font-bold ' + (hasilEsai.nilai_total >= 80 ? 'text-green-400' : hasilEsai.nilai_total >= 60 ? 'text-[var(--accent-soft)]' : 'text-[var(--err)]')}>
                    {hasilEsai.nilai_total}
                  </p>
                  <div>
                    <p className="text-sm font-medium">Nilai total</p>
                    <p className="text-xs text-[var(--text-3)]">skala 0-100 sesuai rubrik terpilih</p>
                  </div>
                </div>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <p className="text-sm font-medium mb-3">Per komponen rubrik</p>
                  <div className="space-y-3">
                    {hasilEsai.komponen.map((k, i) => (
                      <div key={i}>
                        <div className="flex justify-between text-sm">
                          <span className="text-[var(--text-2)]">{k.nama}</span>
                          <span className="text-[var(--text)]">{k.skor}</span>
                        </div>
                        {k.catatan && <p className="text-xs text-[var(--text-3)] mt-0.5">{k.catatan}</p>}
                      </div>
                    ))}
                  </div>
                </div>
                {hasilEsai.kekuatan.length > 0 && (
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <p className="text-sm font-medium mb-2">Kekuatan</p>
                    <ul className="space-y-1.5 text-sm text-[var(--text-2)]">
                      {hasilEsai.kekuatan.map((k, i) => (
                        <li key={i}>+ {k}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {hasilEsai.perbaikan.length > 0 && (
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <p className="text-sm font-medium mb-3">Yang harus direvisi (urut prioritas)</p>
                    <div className="space-y-3">
                      {hasilEsai.perbaikan.map((p, i) => (
                        <div key={i}>
                          <p className="text-sm text-[var(--text)]">
                            <span className={'mr-2 rounded-md px-2 py-0.5 text-[10px] ' + (p.prioritas === 'tinggi' ? 'bg-stone-700 text-stone-100' : 'bg-[var(--surface-2)] text-[var(--text-2)]')}>
                              {p.prioritas}
                            </span>
                            {p.masalah}
                          </p>
                          <p className="text-xs text-[var(--text-3)] mt-0.5">Saran: {p.saran}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── audit catatan ── */}
        {tool === 'audit' && (
          <div className="space-y-3 mt-1">
            <div>
              <label htmlFor="audit-catatan" className="block text-sm mb-1.5">Catatan kamu (ketik ulang atau hasil OCR)</label>
              <textarea
                id="audit-catatan"
                rows={5}
                value={catatan}
                onChange={(e) => setCatatan(e.target.value)}
                placeholder="Contoh: Fotosintesis terjadi di mitokondria, menghasilkan glukosa dan nitrogen..."
                className={inputCls + ' resize-none'}
              />
            </div>
            <div>
              <label htmlFor="audit-materi" className="block text-sm mb-1.5">Materi/slide dosen (tempel isinya)</label>
              <textarea
                id="audit-materi"
                rows={5}
                value={materiDosen}
                onChange={(e) => setMateriDosen(e.target.value)}
                placeholder="Tempel isi slide atau materi bab dari dosen..."
                className={inputCls + ' resize-none'}
              />
            </div>
            <Button onClick={run} disabled={loading} className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)]">
              <Send className="h-3.5 w-3.5 mr-2" />
              {loading ? busy : 'Audit catatan vs materi dosen'}
            </Button>
            {hasilAudit && (
              <div className="space-y-4">
                {hasilAudit.salah_konsep.length > 0 && (
                  <div className="rounded-xl border border-red-500/30 bg-[var(--surface)] p-4">
                    <p className="text-sm font-medium mb-3 text-red-400">Salah konsep ({hasilAudit.salah_konsep.length})</p>
                    <div className="space-y-3">
                      {hasilAudit.salah_konsep.map((s, i) => (
                        <div key={i} className="text-sm">
                          <p className="text-[var(--text-2)]">" {s.kutipan_catatan} "</p>
                          <p className="text-[var(--text)] mt-1">Fakta dari materi: {s.fakta_benar}</p>
                          {s.penjelasan && <p className="text-xs text-[var(--text-3)] mt-0.5">{s.penjelasan}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {hasilAudit.terlewat.length > 0 && (
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <p className="text-sm font-medium mb-2">Terlewat dari catatanmu ({hasilAudit.terlewat.length})</p>
                    <ol className="list-decimal list-inside space-y-1.5 text-sm text-[var(--text-2)]">
                      {hasilAudit.terlewat.map((t, i) => <li key={i}>{t}</li>)}
                    </ol>
                  </div>
                )}
                {hasilAudit.cocok.length > 0 && (
                  <div className="rounded-xl border border-green-500/30 bg-[var(--surface)] p-4">
                    <p className="text-sm font-medium mb-2 text-green-400">Sudah tertangkap dengan benar</p>
                    <ul className="space-y-1.5 text-sm text-[var(--text-2)]">
                      {hasilAudit.cocok.map((c, i) => <li key={i}>+ {c}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <p className="text-xs text-[var(--text-3)]">
          Hasil dikunci pada teks yang kamu berikan. Koreksi berdasarkan pengetahuan di luar teks tidak diizinkan.
        </p>
      </DialogContent>
    </Dialog>
  );
}
