/**
 * StudyMusicPlayer.tsx  -  Pemutar musik fokus inline untuk Mode Belajar
 *
 * Siswa bisa dengar musik sambil belajar TANPA pindah tab: player floating
 * di kanan-bawah overlay Mode Belajar, tetap hidup saat pindah antar tab
 * (materi/kuis/mindmap/buddy/voice/session) karena dipasang di root
 * StudyPipeline, bukan di dalam konten per-tab.
 *
 * Dua sumber:
 *   1. Radio — stream publik SomaFM (lofi/ambient/focus, tanpa iklan, tanpa
 *      akun). Primary ice1 + fallback ice2 per stasiun.
 *   2. YouTube — pencarian via YouTube Data API v3 memakai akun user sendiri
 *      (OAuth youtube.readonly, kuota per-user), playback lewat official
 *      IFrame embed player yang TERLIHAT — sesuai YouTube API Services ToS.
 *      Tidak ada ekstraksi audio stream (itu melanggar ToS + hak cipta).
 */

import { useEffect, useRef, useState } from 'react';
import {
  Music, Pause, Play, Radio, Volume2, X, AlertTriangle,
  Youtube, Link2, LogOut, Loader2, RefreshCw,
} from 'lucide-react';

interface Station {
  id: string;
  name: string;
  desc: string;
  url: string;
  fallback: string;
}

const STATIONS: Station[] = [
  {
    id: 'groovesalad',
    name: 'Groove Salad',
    desc: 'Ambient chill lembut — favorit belajar',
    url: 'https://ice1.somafm.com/groovesalad-128-mp3',
    fallback: 'https://ice2.somafm.com/groovesalad-128-mp3',
  },
  {
    id: 'dronezone',
    name: 'Drone Zone',
    desc: 'Ambient spasius, tanpa vokal',
    url: 'https://ice1.somafm.com/dronezone-128-mp3',
    fallback: 'https://ice2.somafm.com/dronezone-128-mp3',
  },
  {
    id: 'beatblender',
    name: 'Beat Blender',
    desc: 'Deep beats pelan untuk fokus',
    url: 'https://ice1.somafm.com/beatblender-128-mp3',
    fallback: 'https://ice2.somafm.com/beatblender-128-mp3',
  },
  {
    id: 'deepspaceone',
    name: 'Deep Space One',
    desc: 'Ambient kosmik tenang',
    url: 'https://ice1.somafm.com/deepspaceone-128-mp3',
    fallback: 'https://ice2.somafm.com/deepspaceone-128-mp3',
  },
  {
    id: 'fluid',
    name: 'Fluid',
    desc: 'Elektronik instrumental halus',
    url: 'https://ice1.somafm.com/fluid-128-mp3',
    fallback: 'https://ice2.somafm.com/fluid-128-mp3',
  },
  {
    id: 'lush',
    name: 'Lush',
    desc: 'Vokal lembut + elektronik',
    url: 'https://ice1.somafm.com/lush-128-mp3',
    fallback: 'https://ice2.somafm.com/lush-128-mp3',
  },
];

const VOL_KEY = 'alynne-music-volume';
const STATION_KEY = 'alynne-music-station';

type Status = 'idle' | 'connecting' | 'playing' | 'error';
type Mode = 'radio' | 'youtube';
type YtItem = { id: string; title: string; channel: string; thumb: string };

/** Ambil 11-char video ID dari berbagai format URL YouTube */
function extractVideoId(input: string): string | null {
  const s = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  const m =
    s.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/|youtube\.com\/live\/)([a-zA-Z0-9_-]{11})/) ||
    s.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

export function StudyMusicPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const retriedRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('radio');
  const [station, setStation] = useState<Station | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [volume, setVolume] = useState(() => {
    const v = parseFloat(localStorage.getItem(VOL_KEY) || '0.7');
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.7;
  });
  const [lastStationId, setLastStationId] = useState(() => localStorage.getItem(STATION_KEY) || '');

  // ── YouTube ──
  const [ytChecking, setYtChecking] = useState(false);
  const [ytConnected, setYtConnected] = useState(false);
  const [ytSearchOpen, setYtSearchOpen] = useState(false);
  const [ytAuthUrl, setYtAuthUrl] = useState('');
  const [ytQuery, setYtQuery] = useState('');
  const [ytItems, setYtItems] = useState<YtItem[] | null>(null);
  const [ytBusy, setYtBusy] = useState(false);
  const [ytErr, setYtErr] = useState('');
  const [ytVideo, setYtVideo] = useState<YtItem | null>(null);
  const [pasteUrl, setPasteUrl] = useState('');

  // volume -> element + persist
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
    localStorage.setItem(VOL_KEY, String(volume));
  }, [volume]);

  // bersih-bersih saat mode belajar ditutup (unmount)
  useEffect(() => {
    const el = audioRef.current;
    return () => {
      if (el) {
        el.pause();
        el.src = '';
      }
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // ── Radio ──
  const loadAndPlay = (s: Station, urlOverride?: string) => {
    const el = audioRef.current;
    if (!el) return;
    retriedRef.current = false;
    setStatus('connecting');
    el.src = urlOverride || s.url;
    el.volume = volume;
    el.play()
      .then(() => {
        setStation(s);
        setLastStationId(s.id);
        localStorage.setItem(STATION_KEY, s.id);
      })
      .catch(() => setStatus('error'));
  };

  const selectStation = (s: Station) => {
    if (station?.id === s.id && (status === 'playing' || status === 'connecting')) {
      audioRef.current?.pause();
      setStatus('idle');
      return;
    }
    loadAndPlay(s);
  };

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (status === 'playing') {
      el.pause();
      setStatus('idle');
      return;
    }
    // kebijakan YouTube: maksimal SATU player auto-play — hentikan video YT
    setYtVideo(null);
    const target = station || STATIONS.find((s) => s.id === lastStationId) || STATIONS[0];
    loadAndPlay(target, status === 'error' && station ? undefined : target?.url);
  };

  const handleAudioEvent = (e: Event) => {
    const el = e.currentTarget as HTMLAudioElement;
    const type = e.type;
    if (type === 'playing') {
      setStatus('playing');
      return;
    }
    if (type === 'waiting' || type === 'stalled') {
      if (status !== 'error') setStatus('connecting');
      return;
    }
    if (type === 'error') {
      const cur = station || STATIONS.find((s) => s.id === lastStationId) || STATIONS[0];
      if (cur && !retriedRef.current && el.src.includes('ice1')) {
        retriedRef.current = true;
        setStatus('connecting');
        el.src = cur.fallback;
        el.play().catch(() => setStatus('error'));
        return;
      }
      setStatus('error');
    }
  };

  // ── YouTube ──
  const checkYt = async (quiet = false) => {
    if (!quiet) setYtChecking(true);
    try {
      const res = await fetch('/api/youtube/status');
      const data = await res.json();
      setYtConnected(!!data.connected);
      setYtSearchOpen(!!data.searchOpen);
      setYtAuthUrl(data.authUrl || '');
    } catch {
      if (!quiet) setYtErr('Gagal cek status koneksi');
    }
    if (!quiet) setYtChecking(false);
  };

  // cek status saat pertama buka tab YouTube
  useEffect(() => {
    if (mode === 'youtube' && !ytChecking && !ytAuthUrl) {
      checkYt();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const connectYt = () => {
    if (!ytAuthUrl) return;
    window.open(ytAuthUrl, 'alynne-yt-oauth', 'width=480,height=660,noopener');
    // polling status sampai user selesai consent di popup (maks ~2 menit)
    if (pollRef.current) clearInterval(pollRef.current);
    let tries = 0;
    pollRef.current = setInterval(async () => {
      tries++;
      try {
        const res = await fetch('/api/youtube/status');
        const data = await res.json();
        if (data.connected) {
          if (pollRef.current) clearInterval(pollRef.current);
          setYtConnected(true);
        }
      } catch {}
      if (tries > 48 && pollRef.current) clearInterval(pollRef.current);
    }, 2500);
  };

  const disconnectYt = async () => {
    try {
      await fetch('/api/youtube/disconnect', { method: 'POST' });
      setYtConnected(false);
      setYtItems(null);
    } catch {}
  };

  const searchYt = async () => {
    if (!ytQuery.trim()) return;
    setYtBusy(true);
    setYtErr('');
    try {
      const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(ytQuery.trim())}`);
      const data = await res.json();
      if (!res.ok) {
        setYtErr(data.error || 'Pencarian gagal');
        if (data.reauth) setYtConnected(false);
      } else {
        setYtItems(data.items || []);
      }
    } catch {
      setYtErr('Pencarian gagal — coba lagi');
    }
    setYtBusy(false);
  };

  const playYtVideo = (v: YtItem) => {
    // kebijakan YouTube: maksimal SATU player auto-play — hentikan radio
    if (status === 'playing') {
      audioRef.current?.pause();
      setStatus('idle');
    }
    setYtVideo(v);
  };

  const playPasted = () => {
    const id = extractVideoId(pasteUrl);
    if (!id) {
      setYtErr('URL YouTube tidak valid');
      return;
    }
    setYtErr('');
    playYtVideo({ id, title: 'Video YouTube', channel: '', thumb: '' });
    setPasteUrl('');
  };

  const isActive = (id: string) => station?.id === id || (!station && lastStationId === id);
  const busy = status === 'connecting';
  const playing = status === 'playing';

  return (
    <div className="fixed bottom-4 right-4 z-40 print:hidden">
      {/* equalizer keyframes (scoped) */}
      <style>{`
        @keyframes mp-eq { 0%,100% { transform: scaleY(0.35); } 50% { transform: scaleY(1); } }
        .mp-bar { transform-origin: bottom; animation: mp-eq 0.9s ease-in-out infinite; }
      `}</style>

      <audio
        ref={audioRef}
        preload="none"
        onPlaying={handleAudioEvent}
        onWaiting={handleAudioEvent}
        onStalled={handleAudioEvent}
        onError={handleAudioEvent}
        onPause={() => { if (status === 'playing') setStatus('idle'); }}
      />

      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Buka musik belajar"
          className={`relative h-12 w-12 rounded-full border border-white/10 bg-stone-900/90 backdrop-blur flex items-center justify-center shadow-lg transition-transform hover:scale-105 active:scale-95 ${(playing || ytVideo) ? 'text-[var(--accent)]' : 'text-stone-300'}`}
        >
          <Music className="h-5 w-5" />
          {(playing || ytVideo) && (
            <>
              <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-[var(--accent)] animate-pulse" />
              <span className="absolute inset-0 rounded-full ring-1 ring-[var(--accent)]/40 animate-ping [animation-duration:2s]" />
            </>
          )}
        </button>
      )}

      {open && (
        <div className="w-[320px] max-w-[calc(100vw-2rem)] rounded-2xl border border-white/10 bg-stone-900/95 backdrop-blur shadow-2xl overflow-hidden">
          {/* header + pemilih sumber */}
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/[0.06]">
            <div className="flex items-center gap-1 bg-white/[0.04] rounded-full p-0.5">
              <button
                onClick={() => setMode('radio')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${mode === 'radio' ? 'bg-[var(--accent)] text-white' : 'text-stone-400 hover:text-stone-200'}`}
              >
                <Radio className="h-3 w-3" /> Radio
              </button>
              <button
                onClick={() => setMode('youtube')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${mode === 'youtube' ? 'bg-[var(--accent)] text-white' : 'text-stone-400 hover:text-stone-200'}`}
              >
                <Youtube className="h-3 w-3" /> YouTube
              </button>
            </div>
            <div className="flex items-center gap-2">
              {mode === 'radio' && playing && (
                <span className="flex items-end gap-[2px] h-3">
                  <span className="mp-bar w-[3px] h-full bg-[var(--accent)] rounded-sm" style={{ animationDelay: '0ms' }} />
                  <span className="mp-bar w-[3px] h-full bg-[var(--accent)] rounded-sm" style={{ animationDelay: '150ms' }} />
                  <span className="mp-bar w-[3px] h-full bg-[var(--accent)] rounded-sm" style={{ animationDelay: '300ms' }} />
                </span>
              )}
              <button
                onClick={() => setOpen(false)}
                aria-label="Tutup musik"
                className="text-stone-500 hover:text-stone-300 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* ── MODE RADIO ── */}
          {mode === 'radio' && (
            <>
              <div className="max-h-52 overflow-y-auto px-2 py-2 space-y-1">
                {STATIONS.map((s) => {
                  const active = isActive(s.id);
                  const thisPlaying = active && playing;
                  return (
                    <button
                      key={s.id}
                      onClick={() => selectStation(s)}
                      className={`w-full text-left px-3 py-2 rounded-xl transition-colors ${
                        active
                          ? 'bg-white/[0.07] ring-1 ring-[var(--accent)]/50'
                          : 'hover:bg-white/[0.04]'
                      }`}
                    >
                      <div className={`text-xs font-semibold ${active ? 'text-white' : 'text-stone-200'}`}>
                        {s.name}
                        {thisPlaying && <span className="ml-2 text-[10px] uppercase tracking-wider text-[var(--accent)]">langsung</span>}
                      </div>
                      <div className="text-[11px] text-stone-500 truncate">{s.desc}</div>
                    </button>
                  );
                })}
              </div>

              <div className="px-4 py-3 border-t border-white/[0.06] space-y-2">
                <div className="flex items-center gap-3">
                  <button
                    onClick={togglePlay}
                    disabled={busy}
                    aria-label={playing ? 'Jeda musik' : 'Putar musik'}
                    className={`h-9 w-9 rounded-full flex items-center justify-center transition-transform active:scale-95 disabled:opacity-60 ${
                      playing ? 'bg-white/10 text-white' : 'bg-[var(--accent)] text-white'
                    }`}
                  >
                    {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
                  </button>
                  <div className="flex items-center gap-2 flex-1">
                    <Volume2 className="h-4 w-4 text-stone-500 shrink-0" />
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={volume}
                      onChange={(e) => setVolume(parseFloat(e.target.value))}
                      aria-label="Volume"
                      className="w-full h-1 accent-[var(--accent)] cursor-pointer"
                    />
                  </div>
                </div>
                <div className="text-[11px] min-h-[16px]">
                  {busy && <span className="text-stone-400">Menghubungkan stream…</span>}
                  {status === 'error' && (
                    <span className="text-amber-400 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> Stream gagal — coba stasiun lain
                    </span>
                  )}
                  {playing && station && <span className="text-stone-500">Sedang asik: {station.name}</span>}
                  {status === 'idle' && !busy && <span className="text-stone-600">Pilih stasiun, musik jalan sambil belajar</span>}
                </div>
              </div>

              <div className="px-4 py-2 bg-white/[0.02] text-[10px] text-stone-600">
                Radio live gratis via SomaFM — tanpa iklan, tanpa akun.
              </div>
            </>
          )}

          {/* ── MODE YOUTUBE ── */}
          {mode === 'youtube' && (
            <>
              {/* player embed resmi (terlihat — wajib menurut ToS YouTube) */}
              {ytVideo && (
                <div className="px-3 pt-3">
                  <div className="rounded-xl overflow-hidden border border-white/10 bg-black">
                    <div className="aspect-video">
                      <iframe
                        key={ytVideo.id}
                        width="100%"
                        height="100%"
                        src={`https://www.youtube.com/embed/${ytVideo.id}?autoplay=1&rel=0&playsinline=1`}
                        title={ytVideo.title}
                        allow="autoplay; encrypted-media; picture-in-picture"
                        allowFullScreen
                        className="w-full h-full"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-1.5 px-0.5">
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold text-white truncate">{ytVideo.title}</div>
                      {ytVideo.channel && <div className="text-[10px] text-stone-500 truncate">{ytVideo.channel}</div>}
                    </div>
                    <button
                      onClick={() => setYtVideo(null)}
                      className="shrink-0 text-[10px] text-stone-400 hover:text-stone-200 underline underline-offset-2"
                    >
                      stop
                    </button>
                  </div>
                </div>
              )}

              <div className="px-3 py-3 space-y-2">
                {/* pencarian (akun terhubung, atau kuota server via API key) */}
                {(ytConnected || ytSearchOpen) && (
                  <div className="flex items-center gap-1.5">
                    <input
                      value={ytQuery}
                      onChange={(e) => setYtQuery(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') searchYt(); }}
                      placeholder="Cari lagu belajar…"
                      className="flex-1 min-w-0 bg-white/[0.05] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/60"
                    />
                    <button
                      onClick={searchYt}
                      disabled={ytBusy || !ytQuery.trim()}
                      className="h-7 px-2.5 rounded-lg bg-[var(--accent)] text-white text-[11px] font-semibold disabled:opacity-50 flex items-center gap-1"
                    >
                      {ytBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Cari'}
                    </button>
                  </div>
                )}

                {/* belum terhubung: ajakan hubungkan + tempel URL.
                    Bila search sudah terbuka via API key, cukup tombol ringkas */}
                {!ytConnected && ytSearchOpen && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-stone-600">Pencarian via kuota server</span>
                    <button
                      onClick={connectYt}
                      disabled={ytChecking || !ytAuthUrl}
                      className="shrink-0 text-[10px] font-semibold text-[var(--accent)] underline underline-offset-2 disabled:opacity-50"
                    >
                      Hubungkan akun (kuota pribadi)
                    </button>
                  </div>
                )}
                {!ytConnected && !ytSearchOpen && (
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Youtube className="h-4 w-4 text-[var(--accent)] shrink-0" />
                      <p className="text-[11px] text-stone-300 leading-snug">
                        Hubungkan akun YouTube-mu untuk cari musik langsung dari sini. Pencarian memakai kuota akunmu sendiri — aman & patuh ToS.
                      </p>
                    </div>
                    <button
                      onClick={connectYt}
                      disabled={ytChecking || !ytAuthUrl}
                      className="w-full h-8 rounded-lg bg-[var(--accent)] text-white text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      {ytChecking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Youtube className="h-3.5 w-3.5" />}
                      Hubungkan YouTube
                    </button>
                    <p className="text-[10px] text-stone-600">Popup Google terbuka — izinkan, lalu panel ini otomatis terhubung.</p>
                  </div>
                )}
                {!ytConnected && (
                  <div className="flex items-center gap-1.5">
                    <Link2 className="h-3 w-3 text-stone-600 shrink-0" />
                    <input
                      value={pasteUrl}
                      onChange={(e) => setPasteUrl(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') playPasted(); }}
                      placeholder="atau tempel URL YouTube…"
                      className="flex-1 min-w-0 bg-white/[0.05] border border-white/10 rounded-lg px-2 py-1 text-[11px] text-stone-300 placeholder:text-stone-600 focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/60"
                    />
                    <button
                      onClick={playPasted}
                      disabled={!pasteUrl.trim()}
                      className="h-6 px-2 rounded-md bg-white/10 text-stone-200 text-[10px] font-semibold disabled:opacity-40"
                    >
                      Putar
                    </button>
                  </div>
                )}

                {/* hasil pencarian */}
                {(ytConnected || ytSearchOpen) && ytItems && ytItems.length > 0 && (
                  <div className="max-h-44 overflow-y-auto space-y-1">
                    {ytItems.map((v) => (
                      <button
                        key={v.id}
                        onClick={() => playYtVideo(v)}
                        className={`w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-lg transition-colors ${ytVideo?.id === v.id ? 'bg-white/[0.07] ring-1 ring-[var(--accent)]/50' : 'hover:bg-white/[0.04]'}`}
                      >
                        {v.thumb ? (
                          <img src={v.thumb} alt="" className="h-8 w-14 rounded object-cover shrink-0 bg-white/5" loading="lazy" />
                        ) : (
                          <div className="h-8 w-14 rounded bg-white/5 shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] font-medium text-stone-200 truncate leading-tight">{v.title}</div>
                          <div className="text-[10px] text-stone-500 truncate">{v.channel}</div>
                        </div>
                        <Play className="h-3 w-3 text-stone-500 shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
                {(ytConnected || ytSearchOpen) && ytItems && ytItems.length === 0 && !ytBusy && (
                  <p className="text-[11px] text-stone-500 text-center py-1">Tidak ada hasil. Coba kata kunci lain.</p>
                )}

                {/* error */}
                {ytErr && (
                  <p className="text-[11px] text-amber-400 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 shrink-0" /> {ytErr}
                  </p>
                )}

                {/* status koneksi */}
                <div className="flex items-center justify-between pt-1">
                  <span className="text-[10px] text-stone-600">
                    {ytConnected ? '● Akun YouTube terhubung' : ytSearchOpen ? '○ Kuota server aktif' : '○ Akun belum terhubung'}
                  </span>
                  <div className="flex items-center gap-2">
                    {ytConnected && (
                      <button
                        onClick={disconnectYt}
                        className="flex items-center gap-1 text-[10px] text-stone-500 hover:text-stone-300"
                      >
                        <LogOut className="h-3 w-3" /> lepas
                      </button>
                    )}
                    <button
                      onClick={() => checkYt()}
                      className="flex items-center gap-1 text-[10px] text-stone-500 hover:text-stone-300"
                      aria-label="Cek ulang koneksi"
                    >
                      <RefreshCw className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>

              <div className="px-4 py-2 bg-white/[0.02] text-[10px] text-stone-600">
                Diputar via player resmi YouTube — sesuai YouTube API Services ToS.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
