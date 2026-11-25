/**
 * StudyMusicPlayer.tsx  -  Pemutar musik fokus inline untuk Mode Belajar
 *
 * Siswa bisa dengar musik sambil belajar TANPA pindah tab: player floating
 * di kanan-bawah overlay Mode Belajar, tetap hidup saat pindah antar tab
 * (materi/kuis/mindmap/buddy/voice/session) karena dipasang di root
 * StudyPipeline, bukan di dalam konten per-tab.
 *
 * Sumber audio: stream radio publik SomaFM (lofi/ambient/focus, tanpa iklan,
 * tanpa akun). Primary ice1 + fallback ice2 per stasiun.
 */

import { useEffect, useRef, useState } from 'react';
import { Music, Pause, Play, Radio, Volume2, X, AlertTriangle } from 'lucide-react';

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

export function StudyMusicPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const retriedRef = useRef(false);

  const [open, setOpen] = useState(false);
  const [station, setStation] = useState<Station | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [volume, setVolume] = useState(() => {
    const v = parseFloat(localStorage.getItem(VOL_KEY) || '0.7');
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.7;
  });
  const [lastStationId, setLastStationId] = useState(() => localStorage.getItem(STATION_KEY) || '');

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
      .catch(() => {
        // autoplay/policy atau jaringan — kalau user memang klik, tampilkan error
        setStatus('error');
      });
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
      // fallback ke ice2 sekali, kalau sudah pernah -> error sungguhan
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

  const isActive = (id: string) => station?.id === id || (!station && lastStationId === id);
  const busy = status === 'connecting';
  const playing = status === 'playing';

  return (
    <div className="fixed bottom-4 right-4 z-40 print:hidden">
      {/* equalizer keyframes (scoped via wrapper id) */}
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
          className={`relative h-12 w-12 rounded-full border border-white/10 bg-stone-900/90 backdrop-blur flex items-center justify-center shadow-lg transition-transform hover:scale-105 active:scale-95 ${playing ? 'text-[var(--accent)]' : 'text-stone-300'}`}
        >
          <Music className="h-5 w-5" />
          {playing && (
            <>
              <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-[var(--accent)] animate-pulse" />
              <span className="absolute inset-0 rounded-full ring-1 ring-[var(--accent)]/40 animate-ping [animation-duration:2s]" />
            </>
          )}
        </button>
      )}

      {open && (
        <div className="w-[300px] max-w-[calc(100vw-2rem)] rounded-2xl border border-white/10 bg-stone-900/95 backdrop-blur shadow-2xl overflow-hidden">
          {/* header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
            <div className="flex items-center gap-2">
              <Radio className={`h-4 w-4 ${playing ? 'text-[var(--accent)]' : 'text-stone-500'}`} />
              <span className="text-sm font-semibold text-white">Musik Belajar</span>
              {playing && (
                <span className="ml-1 flex items-end gap-[2px] h-3">
                  <span className="mp-bar w-[3px] h-full bg-[var(--accent)] rounded-sm" style={{ animationDelay: '0ms' }} />
                  <span className="mp-bar w-[3px] h-full bg-[var(--accent)] rounded-sm" style={{ animationDelay: '150ms' }} />
                  <span className="mp-bar w-[3px] h-full bg-[var(--accent)] rounded-sm" style={{ animationDelay: '300ms' }} />
                </span>
              )}
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Tutup musik"
              className="text-stone-500 hover:text-stone-300 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* daftar stasiun */}
          <div className="max-h-52 overflow-y-auto px-2 py-2 space-y-1">
            {STATIONS.map((s) => {
              const active = isActive(s.id);
              const thisPlaying = active && playing;
              return (
                <button
                  key={s.id}
                  onClick={() => selectStation(s)}
                  className={`w-full text-left px-3 py-2 rounded-xl transition-colors flex items-center gap-2 ${
                    active
                      ? 'bg-white/[0.07] ring-1 ring-[var(--accent)]/50'
                      : 'hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className={`text-xs font-semibold ${active ? 'text-white' : 'text-stone-200'}`}>
                      {s.name}
                      {thisPlaying && <span className="ml-2 text-[10px] uppercase tracking-wider text-[var(--accent)]">langsung</span>}
                    </div>
                    <div className="text-[11px] text-stone-500 truncate">{s.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* kontrol */}
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
        </div>
      )}
    </div>
  );
}
