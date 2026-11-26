/**
 * StudyMusicPlayer.tsx  -  Pemutar musik fokus inline untuk Mode Belajar
 *
 * Siswa bisa dengar musik sambil belajar TANPA pindah tab: player floating
 * di kanan-bawah overlay Mode Belajar, tetap hidup saat pindah antar tab
 * (materi/kuis/mindmap/buddy/voice/session) karena dipasang di root
 * StudyPipeline, bukan di dalam konten per-tab.
 *
 * Tiga sumber:
 *   1. Radio — stream publik SomaFM (lofi/ambient/focus, tanpa iklan, tanpa
 *      akun). Primary ice1 + fallback ice2 per stasiun.
 *   2. Audius — jaringan musik terbuka (web3, legal, kreator dapat royalti).
 *      Pencarian + stream via discovery API publik tanpa OAuth/kunci; route
 *      /api/music/audius melakukan pencarian & redirect stream resmi.
 *   3. Playlist — tempel link YouTube (playlist/video) atau Spotify
 *      (playlist/album/track) dan diputar langsung via player EMBED RESMI
 *      masing-masing platform — sesuai ToS YouTube & Spotify, tanpa scraping.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Music, Pause, Play, Radio, Volume2, X, AlertTriangle,
  Youtube, Link2, Loader2, Disc3, ListMusic,
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
type Mode = 'radio' | 'audius' | 'playlist';
type AudiusTrack = { id: string; title: string; artist: string; duration: number; artwork: string };
type Embed = { kind: 'youtube' | 'spotify'; src: string; title: string; height: number };

/** Ambil 11-char video ID dari berbagai format URL YouTube */
function extractVideoId(input: string): string | null {
  const s = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  const m =
    s.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/|youtube\.com\/live\/)([a-zA-Z0-9_-]{11})/) ||
    s.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function fmtDur(d: number): string {
  if (!d || d <= 0) return '';
  const m = Math.floor(d / 60);
  const s = d % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function StudyMusicPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const retriedRef = useRef(false);

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('radio');
  const [station, setStation] = useState<Station | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [volume, setVolume] = useState(() => {
    const v = parseFloat(localStorage.getItem(VOL_KEY) || '0.7');
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.7;
  });
  const [lastStationId, setLastStationId] = useState(() => localStorage.getItem(STATION_KEY) || '');

  // ── Audius ──
  const [auQuery, setAuQuery] = useState('');
  const [auItems, setAuItems] = useState<AudiusTrack[] | null>(null);
  const [auBusy, setAuBusy] = useState(false);
  const [auErr, setAuErr] = useState('');
  const [auTrack, setAuTrack] = useState<AudiusTrack | null>(null);

  // ── Playlist (link YT/Spotify) ──
  const [plInput, setPlInput] = useState('');
  const [plErr, setPlErr] = useState('');
  const [plEmbed, setPlEmbed] = useState<Embed | null>(null);

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
    setAuTrack(null);
    loadAndPlay(s);
  };

  const pauseAudio = () => {
    audioRef.current?.pause();
    setStatus('idle');
  };

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (status === 'playing') {
      el.pause();
      setStatus('idle');
      return;
    }
    // lagu Audius yang lagi terpilih → lanjut dari posisi terakhir
    if (!station && auTrack && el.src.includes('/api/music/audius?stream=')) {
      el.play().catch(() => setStatus('error'));
      return;
    }
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
      // fallback ice2 hanya untuk radio; lagu Audius langsung error
      const cur = station || STATIONS.find((s) => s.id === lastStationId) || STATIONS[0];
      if (station && cur && !retriedRef.current && el.src.includes('ice1')) {
        retriedRef.current = true;
        setStatus('connecting');
        el.src = cur.fallback;
        el.play().catch(() => setStatus('error'));
        return;
      }
      setStatus('error');
    }
  };

  // ── Audius ──
  const searchAudius = async () => {
    if (!auQuery.trim() || auBusy) return;
    setAuBusy(true);
    setAuErr('');
    try {
      const res = await fetch(`/api/music/audius?q=${encodeURIComponent(auQuery.trim())}`);
      const data = await res.json();
      if (!res.ok) {
        setAuErr(data.error || 'Pencarian gagal');
        setAuItems(null);
      } else {
        setAuItems(data.items || []);
        if (!(data.items || []).length) setAuErr('');
      }
    } catch {
      setAuErr('Pencarian gagal — coba lagi');
    }
    setAuBusy(false);
  };

  const playAudius = (t: AudiusTrack) => {
    const el = audioRef.current;
    if (!el) return;
    // satu player: matikan embed kalau terbuka
    if (plEmbed) setPlEmbed(null);
    if (auTrack?.id === t.id && (status === 'playing' || status === 'connecting')) {
      el.pause();
      setStatus('idle');
      return;
    }
    retriedRef.current = false;
    setStatus('connecting');
    el.src = `/api/music/audius?stream=${encodeURIComponent(t.id)}`;
    el.volume = volume;
    el.play()
      .then(() => setAuTrack(t))
      .catch(() => setStatus('error'));
  };

  // ── Playlist: deteksi link YT/Spotify → embed resmi ──
  const openPlaylist = () => {
    const s = plInput.trim();
    if (!s) return;

    const isYt = s.includes('youtube.com') || s.includes('youtu.be');
    const list = s.match(/[?&]list=([a-zA-Z0-9_-]+)/);
    if (isYt && list) {
      if (plEmbed) setPlEmbed(null);
      pauseAudio();
      setAuTrack(null);
      setPlEmbed({
        kind: 'youtube',
        src: `https://www.youtube.com/embed/videoseries?list=${list[1]}&autoplay=1&rel=0`,
        title: 'Playlist YouTube',
        height: 0,
      });
      setPlErr('');
      setPlInput('');
      return;
    }
    const vid = extractVideoId(s);
    if (isYt && vid) {
      if (plEmbed) setPlEmbed(null);
      pauseAudio();
      setAuTrack(null);
      setPlEmbed({
        kind: 'youtube',
        src: `https://www.youtube.com/embed/${vid}?autoplay=1&rel=0&playsinline=1`,
        title: 'Video YouTube',
        height: 0,
      });
      setPlErr('');
      setPlInput('');
      return;
    }
    const sp = s.match(/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(playlist|album|track|episode|show)\/([A-Za-z0-9]+)/);
    if (sp) {
      const tall = sp[1] === 'playlist' || sp[1] === 'album' || sp[1] === 'show';
      if (plEmbed) setPlEmbed(null);
      pauseAudio();
      setAuTrack(null);
      setPlEmbed({
        kind: 'spotify',
        src: `https://open.spotify.com/embed/${sp[1]}/${sp[2]}`,
        title: `Spotify ${sp[1]}`,
        height: tall ? 352 : 152,
      });
      setPlErr('');
      setPlInput('');
      return;
    }
    setPlErr('Link tidak dikenali — tempel link YouTube (playlist/video) atau Spotify (playlist/album/track).');
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
          className={`relative h-12 w-12 rounded-full border border-white/10 bg-stone-900/90 backdrop-blur flex items-center justify-center shadow-lg transition-transform hover:scale-105 active:scale-95 ${(playing || plEmbed) ? 'text-[var(--accent)]' : 'text-stone-300'}`}
        >
          <Music className="h-5 w-5" />
          {(playing || plEmbed) && (
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
                onClick={() => setMode('audius')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${mode === 'audius' ? 'bg-[var(--accent)] text-white' : 'text-stone-400 hover:text-stone-200'}`}
              >
                <Disc3 className="h-3 w-3" /> Audius
              </button>
              <button
                onClick={() => setMode('playlist')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${mode === 'playlist' ? 'bg-[var(--accent)] text-white' : 'text-stone-400 hover:text-stone-200'}`}
              >
                <ListMusic className="h-3 w-3" /> Playlist
              </button>
            </div>
            <div className="flex items-center gap-2">
              {mode !== 'playlist' && playing && (
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

          {/* ── MODE AUDIUS ── */}
          {mode === 'audius' && (
            <>
              <div className="px-3 py-3 space-y-2">
                <div className="flex items-center gap-1.5">
                  <input
                    value={auQuery}
                    onChange={(e) => setAuQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') searchAudius(); }}
                    placeholder="Cari lagu belajar di Audius…"
                    className="flex-1 min-w-0 bg-white/[0.05] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/60"
                  />
                  <button
                    onClick={searchAudius}
                    disabled={auBusy || !auQuery.trim()}
                    className="h-7 px-2.5 rounded-lg bg-[var(--accent)] text-white text-[11px] font-semibold disabled:opacity-50 flex items-center gap-1"
                  >
                    {auBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Cari'}
                  </button>
                </div>

                {auItems && auItems.length > 0 && (
                  <div className="max-h-52 overflow-y-auto space-y-1">
                    {auItems.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => playAudius(t)}
                        className={`w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-lg transition-colors ${auTrack?.id === t.id ? 'bg-white/[0.07] ring-1 ring-[var(--accent)]/50' : 'hover:bg-white/[0.04]'}`}
                      >
                        {t.artwork ? (
                          <img src={t.artwork} alt="" className="h-8 w-8 rounded object-cover shrink-0 bg-white/5" loading="lazy" />
                        ) : (
                          <div className="h-8 w-8 rounded bg-white/5 shrink-0 flex items-center justify-center">
                            <Disc3 className="h-4 w-4 text-stone-600" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] font-medium text-stone-200 truncate leading-tight">{t.title}</div>
                          <div className="text-[10px] text-stone-500 truncate">{t.artist}</div>
                        </div>
                        {t.duration > 0 && <span className="text-[10px] text-stone-600 shrink-0">{fmtDur(t.duration)}</span>}
                        <Play className="h-3 w-3 text-stone-500 shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
                {auItems && auItems.length === 0 && !auBusy && (
                  <p className="text-[11px] text-stone-500 text-center py-1">Tidak ada hasil. Coba kata kunci lain.</p>
                )}
                {!auItems && !auBusy && !auErr && (
                  <p className="text-[11px] text-stone-600 py-1">
                    Jutaan lagu indie & lofi legal — pencarian gratis tanpa akun tambahan.
                  </p>
                )}

                {auErr && (
                  <p className="text-[11px] text-amber-400 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 shrink-0" /> {auErr}
                  </p>
                )}
              </div>

              <div className="px-4 py-3 border-t border-white/[0.06] space-y-2">
                <div className="flex items-center gap-3">
                  <button
                    onClick={togglePlay}
                    disabled={busy || (!auTrack && !station)}
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
                  {busy && <span className="text-stone-400">Menyiapkan lagu…</span>}
                  {status === 'error' && (
                    <span className="text-amber-400 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> Lagu gagal diputar — pilih yang lain
                    </span>
                  )}
                  {playing && auTrack && <span className="text-stone-500 truncate block">Sedang asik: {auTrack.title}</span>}
                  {playing && !auTrack && station && <span className="text-stone-500">Sedang asik: {station.name}</span>}
                  {status === 'idle' && !busy && <span className="text-stone-600">Cari lagu lalu klik untuk memutar</span>}
                </div>
              </div>

              <div className="px-4 py-2 bg-white/[0.02] text-[10px] text-stone-600">
                Musik dari <span className="text-stone-400">Audius</span> — jaringan musik terbuka & legal, kreator dapat royalti.
              </div>
            </>
          )}

          {/* ── MODE PLAYLIST (link YT/Spotify) ── */}
          {mode === 'playlist' && (
            <>
              <div className="px-3 py-3 space-y-2">
                <div className="flex items-center gap-1.5">
                  <Link2 className="h-3.5 w-3.5 text-stone-600 shrink-0" />
                  <input
                    value={plInput}
                    onChange={(e) => setPlInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') openPlaylist(); }}
                    placeholder="Tempel link playlist YouTube / Spotify…"
                    className="flex-1 min-w-0 bg-white/[0.05] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/60"
                  />
                  <button
                    onClick={openPlaylist}
                    disabled={!plInput.trim()}
                    className="h-7 px-2.5 rounded-lg bg-[var(--accent)] text-white text-[11px] font-semibold disabled:opacity-50"
                  >
                    Buka
                  </button>
                </div>

                {plEmbed && (
                  <div>
                    <div className="rounded-xl overflow-hidden border border-white/10 bg-black">
                      {plEmbed.kind === 'youtube' ? (
                        <div className="aspect-video">
                          <iframe
                            key={plEmbed.src}
                            width="100%"
                            height="100%"
                            src={plEmbed.src}
                            title={plEmbed.title}
                            allow="autoplay; encrypted-media; picture-in-picture"
                            allowFullScreen
                            className="w-full h-full"
                          />
                        </div>
                      ) : (
                        <iframe
                          key={plEmbed.src}
                          title={plEmbed.title}
                          src={plEmbed.src}
                          width="100%"
                          height={plEmbed.height || 352}
                          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                          loading="lazy"
                          className="w-full block"
                        />
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-1.5 px-0.5">
                      <span className="text-[10px] text-stone-500 truncate">{plEmbed.title}</span>
                      <button
                        onClick={() => setPlEmbed(null)}
                        className="shrink-0 text-[10px] text-stone-400 hover:text-stone-200 underline underline-offset-2"
                      >
                        stop
                      </button>
                    </div>
                  </div>
                )}

                {plErr && (
                  <p className="text-[11px] text-amber-400 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 shrink-0" /> {plErr}
                  </p>
                )}

                {!plEmbed && !plErr && (
                  <p className="text-[11px] text-stone-600 py-1">
                    Contoh: youtube.com/playlist?list=… atau open.spotify.com/playlist/… — langsung diputar di sini.
                  </p>
                )}
              </div>

              <div className="px-4 py-2 bg-white/[0.02] text-[10px] text-stone-600 leading-relaxed">
                Diputar via player resmi YouTube / Spotify — patuh ToS. Spotify: preview 30 dtk; login di dalam player untuk lagu penuh (Premium).
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
