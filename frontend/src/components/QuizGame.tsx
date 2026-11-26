/**
 * QuizGame.tsx  -  QUIZ ARENA: game kuis multiplayer real-time ala Kahoot
 *
 * Publik (tanpa login): host buat room dari /game, pemain lain join lewat
 * LINK INVITE (kode 4 huruf) cukup pakai nama + emoji avatar — tanpa akun.
 * Sinkronisasi via polling /api/game/state tiap ~900 ms; waktu fase absolut
 * dari server + offset clock, jadi timer tiap pemain selaras.
 *
 * Mode:
 *  - Duel (battle)  : tiap pemain lawan diri sendiri, skor = kecepatan +
 *    streak bonus; podium di akhir.
 *  - Co-op          : satu BOSS soal (HP = 100 x jumlah soal). Soal lolos
 *    kalau minimal 1 pemain benar; semua gagal = -1 nyawa (total 3). Menang
 *    kalau boss tumbang sebelum nyawa habis.
 *
 * Rasa "game beneran": SFX WebAudio sintetis (tanpa file), countdown 3-2-1,
 * timer bar, tombol jawaban warna-warni ala Kahoot, skor melayang, streak
 * api, boss HP bergetar saat kena, confetti, podium.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// ── tipe data dari server ──
interface PubPlayer {
  id: string; name: string; avatar: string; host: boolean;
  score: number; streak: number; best: number; corr: number;
  connected: boolean; answered: boolean; lastCorrect: boolean; lastPts: number;
}
interface PubQuestion { q: string; choices: string[]; answer: number; explain: string; }
interface MyAnswer { c: number; correct: boolean; pts: number; ms: number; }
type RoomStatus = 'lobby' | 'countdown' | 'question' | 'reveal' | 'finished';
interface PubRoom {
  code: string; mode: 'battle' | 'coop'; topic: string; status: RoomStatus;
  result: 'win' | 'lose' | ''; hostId: string; qi: number; qTotal: number; serverNow: number;
  countdownEnd: number; qEnd: number; revealEnd: number;
  hp: number; hpMax: number; lives: number; combo: number; bestCombo: number; answeredCount: number;
  players: PubPlayer[]; q: PubQuestion | null; myAnswer: MyAnswer | null;
  you: { id: string; name: string; avatar: string; host: boolean; score: number; streak: number } | null;
  rev: number;
}

const QUESTION_MS = 20_000;
const AVATARS = ['🦁', '🐼', '🦊', '🐸', '🐨', '🦄', '🐙', '🦉', '🐺', '🐯', '🐵', '🐲'];
const PRESETS = ['Matematika', 'IPA / Sains', 'Bahasa Indonesia', 'Sejarah', 'Bahasa Inggris', 'Informatika', 'Ekonomi', 'Pengetahuan Umum'];
const CHOICE_COLORS = ['#e21b3c', '#1368ce', '#d89e00', '#26890c'];
const SHAPES = ['▲', '◆', '●', '■'];

const lsGet = (k: string): string | null => (typeof window !== 'undefined' ? window.localStorage.getItem(k) : null);
const ssGet = (k: string): string | null => (typeof window !== 'undefined' ? window.sessionStorage.getItem(k) : null);

interface Session { code: string; pid: string; }
function readSess(): Session | null {
  try {
    const raw = ssGet('alynne-game-sess');
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s && s.code && s.pid ? { code: String(s.code), pid: String(s.pid) } : null;
  } catch { return null; }
}
function saveSess(s: Session) { try { window.sessionStorage.setItem('alynne-game-sess', JSON.stringify(s)); } catch { /* penuh dsb */ } }
function clearSess() { try { window.sessionStorage.removeItem('alynne-game-sess'); } catch { /* abaikan */ } }

// ── SFX sintetis — tanpa file audio, semua oscillator ──
class Sfx {
  private ctx: AudioContext | null = null;
  on = true;
  private ensure(): AudioContext | null {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    } catch { return null; }
  }
  private tone(f: number, dur: number, type: OscillatorType, vol: number, delay = 0, slideTo?: number) {
    if (!this.on) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  click() { this.tone(520, 0.06, 'triangle', 0.05); }
  join() { this.tone(440, 0.1, 'triangle', 0.07); this.tone(660, 0.12, 'triangle', 0.07, 0.09); }
  start() { [523, 659, 784].forEach((f, i) => this.tone(f, 0.16, 'square', 0.055, i * 0.13)); }
  go() { this.tone(880, 0.18, 'square', 0.08); }
  correct(streak = 0) {
    const base = 660 + Math.min(6, Math.max(0, streak)) * 45;
    this.tone(base, 0.12, 'triangle', 0.09);
    this.tone(base * 1.25, 0.16, 'triangle', 0.09, 0.1);
  }
  wrong() { this.tone(220, 0.25, 'sawtooth', 0.06, 0, 110); }
  tick() { this.tone(880, 0.05, 'square', 0.045); }
  bossHit() { this.tone(160, 0.2, 'sawtooth', 0.08, 0, 60); this.tone(740, 0.1, 'triangle', 0.07, 0.05); }
  win() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.09, i * 0.14)); }
  lose() { [392, 330, 262].forEach((f, i) => this.tone(f, 0.3, 'sawtooth', 0.055, i * 0.18)); }
}

// ── konfeti (pure CSS, tanpa library) ──
function Confetti() {
  const bits = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => ({
        left: (i * 37) % 100,
        delay: (i % 7) * 0.18,
        dur: 2.4 + ((i * 13) % 10) / 10,
        color: ['#e21b3c', '#1368ce', '#d89e00', '#26890c', '#8b5cf6', '#f59e0b'][i % 6],
        w: 6 + (i % 4) * 3,
      })),
    [],
  );
  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden" aria-hidden>
      {bits.map((b, i) => (
        <span
          key={i}
          className="absolute top-0 rounded-[2px]"
          style={{
            left: `${b.left}%`,
            width: b.w,
            height: b.w * 0.45,
            background: b.color,
            animation: `g-confetti ${b.dur}s linear ${b.delay}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

export function QuizGame() {
  // identitas
  const [name, setName] = useState(() => lsGet('alynne-game-name') || '');
  const [avatar, setAvatar] = useState('🦁');
  // home
  const [homeTab, setHomeTab] = useState<'gabung' | 'buat'>(() => {
    const c = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('code') : null;
    return c ? 'gabung' : 'buat';
  });
  const [joinCode, setJoinCode] = useState(() => {
    const c = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('code') : null;
    return (c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  });
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState(10);
  const [mode, setMode] = useState<'battle' | 'coop'>('battle');
  // runtime
  const [room, setRoom] = useState<PubRoom | null>(null);
  const [hasSession, setHasSession] = useState(() => {
    // link invite menang: kalau ada ?code= dan session lama beda room → buang session lama
    const s = readSess();
    const urlCode = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('code')?.toUpperCase() : null;
    if (s && urlCode && s.code !== urlCode) {
      clearSess();
      return false;
    }
    return !!s;
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [locked, setLocked] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sfxOn, setSfxOn] = useState(() => lsGet('alynne-game-sfx') !== 'off');
  const [nowTick, setNowTick] = useState(0);

  const sessRef = useRef<Session | null>(readSess());
  const sfxRef = useRef<Sfx | null>(null);
  if (!sfxRef.current && typeof window !== 'undefined') sfxRef.current = new Sfx();
  const offsetRef = useRef(0);
  const lastRevRef = useRef(0);
  const lastStatusRef = useRef<RoomStatus | 'home'>('home');
  const tickSecRef = useRef(-1);
  const pollingRef = useRef(false);

  const phase: RoomStatus | 'home' = room ? room.status : 'home';
  const you = room?.you || null;
  const isHost = !!you?.host;

  // SFX toggle persist
  useEffect(() => {
    if (sfxRef.current) sfxRef.current.on = sfxOn;
    try { window.localStorage.setItem('alynne-game-sfx', sfxOn ? 'on' : 'off'); } catch { /* abaikan */ }
  }, [sfxOn]);

  // ── polling ──
  const poll = useCallback(async () => {
    const s = sessRef.current;
    if (!s) return;
    try {
      const res = await fetch(`/api/game/state?code=${encodeURIComponent(s.code)}&pid=${encodeURIComponent(s.pid)}`);
      if (res.status === 404) {
        clearSess();
        sessRef.current = null;
        setRoom(null);
        setHasSession(false);
        setErr('Room sudah bubar atau tidak ada — buat room baru, atau join pakai kode lain.');
        return;
      }
      const data = (await res.json()) as PubRoom;
      // snapshot basi (poll lama yang selesai belakangan) → buang, jangan
      // sampai menimpa state yang lebih baru (mis. jawaban yang baru masuk)
      if (data.rev && lastRevRef.current && data.rev < lastRevRef.current) return;
      if (data.rev) lastRevRef.current = data.rev;
      offsetRef.current = data.serverNow - Date.now();
      setRoom(data);
    } catch { /* jaringan berkedip — iterasi berikutnya coba lagi */ }
  }, []);

  useEffect(() => {
    if (!hasSession) return;
    let stop = false;
    const loop = async () => {
      while (!stop) {
        if (!pollingRef.current) {
          pollingRef.current = true;
          await poll();
          pollingRef.current = false;
        }
        await new Promise((r) => setTimeout(r, 900));
      }
    };
    void loop();
    return () => { stop = true; };
  }, [hasSession, poll]);

  // re-render berkala untuk timer/countdown (interpolasi lokal)
  useEffect(() => {
    if (phase !== 'question' && phase !== 'countdown' && phase !== 'reveal') return;
    const iv = setInterval(() => setNowTick((t) => (t + 1) % 100000), 120);
    return () => clearInterval(iv);
  }, [phase]);

  // lock jawaban reset tiap ganti soal/fase
  useEffect(() => {
    setLocked(false);
    tickSecRef.current = -1;
  }, [room?.qi, room?.status]);

  // SFX per transisi fase
  useEffect(() => {
    if (!room) return;
    if (room.status !== lastStatusRef.current) {
      const prev = lastStatusRef.current;
      lastStatusRef.current = room.status;
      if (room.status === 'countdown') sfxRef.current?.start();
      if (room.status === 'question' && prev === 'countdown') sfxRef.current?.go();
      if (room.status === 'reveal') {
        const a = room.myAnswer;
        if (a?.correct) sfxRef.current?.correct(room.you?.streak || 0);
        else sfxRef.current?.wrong();
        if (room.mode === 'coop') {
          const cleared = room.players.some((p) => p.lastCorrect);
          if (cleared) sfxRef.current?.bossHit();
        }
      }
      if (room.status === 'finished') {
        if (room.mode === 'coop' && room.result === 'lose') sfxRef.current?.lose();
        else sfxRef.current?.win();
      }
    }
  }, [room?.status, room?.rev]); // eslint-disable-line react-hooks/exhaustive-deps

  // tick 3 detik terakhir
  useEffect(() => {
    if (!room || room.status !== 'question' || !room.qEnd) return;
    const rem = room.qEnd - (Date.now() + offsetRef.current);
    const sec = Math.ceil(rem / 1000);
    if (sec <= 3 && sec >= 1 && sec !== tickSecRef.current) {
      tickSecRef.current = sec;
      sfxRef.current?.tick();
    }
  }, [nowTick, room?.status, room?.qEnd]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── aksi ──
  const finalName = () => {
    const t = name.replace(/[<>"\\]/g, '').trim().slice(0, 16);
    return t.length >= 2 ? t : `Pemain${Math.floor(Math.random() * 90 + 10)}`;
  };

  const post = async (path: string, body: Record<string, unknown>) => {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error(String(data.error || 'Gagal — coba lagi.'));
    return data;
  };

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    const s = sessRef.current;
    if (!s) return null;
    try {
      return await post('/api/game/action', { code: s.code, pid: s.pid, action, ...extra });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Gagal';
      if (!msg.includes('fase') && !msg.includes('sudah jawab')) setErr(msg);
      void poll();
      return null;
    }
  };

  const doCreate = async () => {
    setErr('');
    const fn = finalName();
    if (topic.trim().length < 3) { setErr('Isi topik dulu — misal "Fotosintesis" atau pilih chip di bawah.'); return; }
    setBusy('buat');
    try {
      try { window.localStorage.setItem('alynne-game-name', fn); } catch { /* abaikan */ }
      const d = await post('/api/game/create', { topic: topic.trim(), count, mode, name: fn, avatar });
      sessRef.current = { code: String(d.code), pid: String(d.pid) };
      saveSess(sessRef.current);
      lastRevRef.current = 0;
      setHasSession(true);
      setRoom(null);
      sfxRef.current?.join();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Gagal buat room');
    }
    setBusy('');
  };

  const doJoin = async () => {
    setErr('');
    if (joinCode.length !== 4) { setErr('Kode room 4 huruf — lihat di layar host.'); return; }
    const fn = finalName();
    setBusy('join');
    try {
      try { window.localStorage.setItem('alynne-game-name', fn); } catch { /* abaikan */ }
      const d = await post('/api/game/join', { code: joinCode, name: fn, avatar });
      sessRef.current = { code: String(d.code), pid: String(d.pid) };
      saveSess(sessRef.current);
      lastRevRef.current = 0;
      setHasSession(true);
      setRoom(null);
      sfxRef.current?.join();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Gagal gabung');
    }
    setBusy('');
  };

  const doStart = async () => { sfxRef.current?.click(); await act('start'); void poll(); };
  const doAdvance = async () => { sfxRef.current?.click(); await act('advance'); void poll(); };
  const doRestart = async () => { sfxRef.current?.click(); await act('restart'); void poll(); };
  const doAnswer = async (c: number) => {
    if (!room || room.status !== 'question' || room.myAnswer || locked) return;
    setLocked(true);
    sfxRef.current?.click();
    await act('answer', { qi: room.qi, c });
    void poll();
  };
  const doLeave = async () => {
    sfxRef.current?.click();
    await act('leave');
    clearSess();
    sessRef.current = null;
    lastRevRef.current = 0;
    setRoom(null);
    setHasSession(false);
    setErr('');
    lastStatusRef.current = 'home';
  };
  const goHome = () => {
    clearSess();
    sessRef.current = null;
    lastRevRef.current = 0;
    setRoom(null);
    setHasSession(false);
    lastStatusRef.current = 'home';
  };

  const copyText = async (t: string) => {
    let ok = false;
    try { await navigator.clipboard.writeText(t); ok = true; } catch { /* fallback di bawah */ }
    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = t;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        ok = true;
      } catch { /* beneran gagal */ }
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  };

  // ── turunan waktu ──
  const nowAbs = Date.now() + offsetRef.current;
  const countdownLeft = room?.countdownEnd ? Math.max(0, room.countdownEnd - nowAbs) : 0;
  const cdNum = countdownLeft > 0 ? Math.ceil(countdownLeft / 1000) : 0;
  const remQ = room?.qEnd ? Math.max(0, room.qEnd - nowAbs) : 0;
  const remPct = room && room.status === 'question' ? Math.max(0, Math.min(1, remQ / QUESTION_MS)) : 0;
  const remReveal = room?.revealEnd ? Math.max(0, room.revealEnd - nowAbs) : 0;

  const inviteUrl = room ? `${window.location.origin}/game?code=${room.code}` : '';
  const myName = you?.name || '';
  const players = room?.players || [];
  const activeCount = players.filter((p) => p.connected || room?.status !== 'lobby').length;
  const top = players.slice(0, 3);
  const winner = players[0];

  // =====================================================================
  return (
    <div
      className="min-h-screen text-stone-100 relative"
      style={{
        background:
          'radial-gradient(1100px 480px at 15% -8%, rgba(139,92,246,0.20), transparent), radial-gradient(900px 420px at 108% 18%, rgba(245,158,11,0.13), transparent), radial-gradient(700px 500px at 50% 115%, rgba(16,185,129,0.10), transparent), #0b0b12',
      }}
    >
      <style>{`
        @keyframes g-pop { 0% { transform: scale(.55); opacity: 0 } 70% { transform: scale(1.07) } 100% { transform: scale(1); opacity: 1 } }
        @keyframes g-count { 0% { transform: scale(2.4); opacity: 0 } 55% { transform: scale(.94); opacity: 1 } 100% { transform: scale(1); opacity: 1 } }
        @keyframes g-float { 0% { transform: translateY(0); opacity: 1 } 100% { transform: translateY(-52px); opacity: 0 } }
        @keyframes g-shake { 0%,100% { transform: translateX(0) } 20% { transform: translateX(-7px) } 40% { transform: translateX(6px) } 60% { transform: translateX(-4px) } 80% { transform: translateX(3px) } }
        @keyframes g-confetti { 0% { transform: translateY(-6vh) rotate(0deg) } 100% { transform: translateY(108vh) rotate(680deg) } }
        @keyframes g-boss-hit { 0%,100% { transform: translateX(0) } 25% { transform: translateX(-7px) } 75% { transform: translateX(7px) } }
        @keyframes g-ping-soft { 0% { box-shadow: 0 0 0 0 rgba(139,92,246,.5) } 100% { box-shadow: 0 0 0 14px rgba(139,92,246,0) } }
        @keyframes g-dot { 0%,80%,100% { opacity: .25 } 40% { opacity: 1 } }
      `}</style>

      {copied && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-emerald-500 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-lg g-pop">
          Tersalin! ✓
        </div>
      )}

      <div className="max-w-md mx-auto px-4 pt-6 pb-14 relative z-10">
        {/* ── HEADER in-game ── */}
        {phase !== 'home' && room && (
          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={() => copyText(room.code)}
              className="font-mono font-black text-lg tracking-[0.3em] px-3 py-1.5 rounded-xl bg-white/[0.06] border border-white/10 hover:bg-white/[0.1] transition-colors"
              title="Salin kode room"
            >
              {room.code}
            </button>
            <span className="text-[11px] text-stone-400 truncate flex-1 min-w-0">
              {room.mode === 'coop' ? '🛡️ Co-op' : '⚔️ Duel'} · {room.topic}
            </span>
            <button
              onClick={() => setSfxOn((v) => !v)}
              aria-label="Suara"
              className="h-8 w-8 rounded-lg bg-white/[0.06] border border-white/10 flex items-center justify-center hover:bg-white/[0.1] transition-colors text-sm"
            >
              {sfxOn ? '🔊' : '🔇'}
            </button>
            <button
              onClick={doLeave}
              aria-label="Keluar room"
              className="h-8 w-8 rounded-lg bg-white/[0.06] border border-white/10 flex items-center justify-center hover:bg-red-500/20 hover:border-red-500/40 transition-colors text-sm"
            >
              ✕
            </button>
          </div>
        )}

        {/* ══════════════ HOME ══════════════ */}
        {phase === 'home' && (
          <div className="g-pop">
            <h1 className="text-4xl font-black text-center mb-1 bg-gradient-to-r from-violet-400 via-fuchsia-400 to-amber-300 bg-clip-text text-transparent">
              ⚡ QUIZ ARENA
            </h1>
            <p className="text-center text-stone-400 text-xs mb-6">
              kuis multiplayer beneran — duel temen atau co-op taklukkan boss. Tanpa akun.
            </p>

            <div className="flex p-1 bg-white/[0.05] rounded-full mb-5">
              {(['gabung', 'buat'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => { setHomeTab(t); setErr(''); sfxRef.current?.click(); }}
                  className={`flex-1 py-1.5 rounded-full text-xs font-bold transition-colors ${
                    homeTab === t ? 'bg-violet-500 text-white shadow' : 'text-stone-400 hover:text-stone-200'
                  }`}
                >
                  {t === 'gabung' ? '🎮 Gabung' : '✨ Buat Room'}
                </button>
              ))}
            </div>

            {/* identitas */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 mb-4">
              <div className="text-[11px] text-stone-400 font-bold mb-2">Kamu siapa?</div>
              <div className="grid grid-cols-6 gap-1.5 mb-2.5">
                {AVATARS.map((a) => (
                  <button
                    key={a}
                    onClick={() => { setAvatar(a); sfxRef.current?.click(); }}
                    className={`h-10 rounded-lg text-xl transition-all ${
                      avatar === a ? 'bg-violet-500/25 ring-2 ring-violet-400 scale-105' : 'bg-white/[0.05] hover:bg-white/[0.1]'
                    }`}
                  >
                    {a}
                  </button>
                ))}
              </div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nama panggilan (mis. Budi)"
                maxLength={16}
                className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm placeholder:text-stone-600 focus:outline-none focus:ring-1 focus:ring-violet-400/60"
              />
            </div>

            {homeTab === 'gabung' ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
                <div className="text-[11px] text-stone-400 font-bold mb-2">Kode room dari temenmu</div>
                <input
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4))}
                  onKeyDown={(e) => { if (e.key === 'Enter') doJoin(); }}
                  placeholder="ABCD"
                  inputMode="text"
                  autoCapitalize="characters"
                  className="w-full text-center font-mono font-black text-3xl tracking-[0.5em] uppercase bg-white/[0.05] border border-white/10 rounded-xl px-3 py-3 placeholder:text-stone-700 focus:outline-none focus:ring-1 focus:ring-violet-400/60"
                />
                <button
                  onClick={doJoin}
                  disabled={busy === 'join' || joinCode.length !== 4}
                  className="w-full mt-3 py-3 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white font-black text-sm shadow-lg active:scale-[0.98] transition-transform disabled:opacity-40"
                >
                  {busy === 'join' ? 'Masuk…' : 'MASUK 🎮'}
                </button>
                <p className="text-[10px] text-stone-500 mt-2 text-center">
                  Belum punya kode? Minta temenmu buka Quiz Arena → Buat Room → bagi link.
                </p>
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
                <div className="text-[11px] text-stone-400 font-bold mb-2">Topik kuis</div>
                <input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') doCreate(); }}
                  placeholder="mis. Fotosintesis, Bilangan Berpangkat…"
                  className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm placeholder:text-stone-600 focus:outline-none focus:ring-1 focus:ring-violet-400/60"
                />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {PRESETS.map((p) => (
                    <button
                      key={p}
                      onClick={() => { setTopic(p); sfxRef.current?.click(); }}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                        topic === p ? 'bg-violet-500 text-white' : 'bg-white/[0.06] text-stone-300 hover:bg-white/[0.12]'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>

                <div className="text-[11px] text-stone-400 font-bold mt-4 mb-1.5">Jumlah soal</div>
                <div className="flex gap-1.5">
                  {([5, 10, 15] as const).map((c) => (
                    <button
                      key={c}
                      onClick={() => { setCount(c); sfxRef.current?.click(); }}
                      className={`flex-1 py-2 rounded-xl text-xs font-bold transition-colors ${
                        count === c ? 'bg-violet-500 text-white' : 'bg-white/[0.06] text-stone-300 hover:bg-white/[0.12]'
                      }`}
                    >
                      {c} soal
                    </button>
                  ))}
                </div>

                <div className="text-[11px] text-stone-400 font-bold mt-4 mb-1.5">Mode main</div>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { m: 'battle', t: '⚔️ Duel', d: 'lawan temen, skor tertinggi menang' },
                    { m: 'coop', t: '🛡️ Co-op', d: 'satu tim, taklukkan boss soal' },
                  ] as const).map((o) => (
                    <button
                      key={o.m}
                      onClick={() => { setMode(o.m); sfxRef.current?.click(); }}
                      className={`text-left p-3 rounded-xl border transition-all ${
                        mode === o.m
                          ? 'bg-violet-500/20 border-violet-400/70 ring-1 ring-violet-400/50'
                          : 'bg-white/[0.04] border-white/10 hover:bg-white/[0.08]'
                      }`}
                    >
                      <div className="text-sm font-black">{o.t}</div>
                      <div className="text-[10px] text-stone-400 leading-tight mt-0.5">{o.d}</div>
                    </button>
                  ))}
                </div>

                <button
                  onClick={doCreate}
                  disabled={busy === 'buat'}
                  className="w-full mt-4 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white font-black text-sm shadow-lg active:scale-[0.98] transition-transform disabled:opacity-40"
                >
                  {busy === 'buat' ? '✍️ Menyusun soal… (5-15 dtk)' : 'BUAT ROOM →'}
                </button>
                <p className="text-[10px] text-stone-500 mt-2 text-center">
                  Soal disusun AI sesuai topik. Setelah room jadi, bagikan link ke temenmu.
                </p>
              </div>
            )}

            {err && (
              <p className="mt-4 text-[11px] text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded-lg px-3 py-2 leading-relaxed">
                ⚠️ {err}
              </p>
            )}
          </div>
        )}

        {/* ══════════════ LOBBY ══════════════ */}
        {room && room.status === 'lobby' && (
          <div className="g-pop">
            <div className="text-center mb-5">
              <div className="text-[11px] uppercase tracking-widest text-stone-500 font-bold">Room code</div>
              <div className="text-6xl font-black font-mono tracking-[0.25em] my-2 bg-gradient-to-r from-violet-300 to-amber-300 bg-clip-text text-transparent">
                {room.code}
              </div>
              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={() => copyText(inviteUrl)}
                  className="px-3 py-1.5 rounded-lg bg-white/[0.07] border border-white/10 text-[11px] font-bold hover:bg-white/[0.12] transition-colors"
                >
                  🔗 Salin Link Invite
                </button>
                {typeof navigator !== 'undefined' && 'share' in navigator && (
                  <button
                    onClick={() => {
                      void navigator.share({ title: 'Quiz Arena', text: `Gabung kuis "${room.topic}"! kode: ${room.code}`, url: inviteUrl }).catch(() => {});
                    }}
                    className="px-3 py-1.5 rounded-lg bg-white/[0.07] border border-white/10 text-[11px] font-bold hover:bg-white/[0.12] transition-colors"
                  >
                    📤 Bagikan
                  </button>
                )}
              </div>
              <p className="text-[10px] text-stone-500 mt-2">
                Temen tinggal buka link ini — nggak perlu daftar akun.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2 mb-5">
              {players.map((p) => (
                <div
                  key={p.id}
                  className={`g-pop rounded-xl border p-2.5 text-center ${
                    p.connected ? 'border-white/10 bg-white/[0.05]' : 'border-white/5 bg-white/[0.02] opacity-40'
                  }`}
                >
                  <div className="text-2xl">{p.avatar}</div>
                  <div className="text-[11px] font-bold truncate">
                    {p.name} {p.host && '👑'}
                  </div>
                </div>
              ))}
              {Array.from({ length: Math.max(0, Math.min(5, 4 - players.length)) }).map((_, i) => (
                <div key={`slot-${i}`} className="rounded-xl border border-dashed border-white/10 p-2.5 text-center">
                  <div className="text-2xl text-stone-700">?</div>
                </div>
              ))}
            </div>

            {isHost ? (
              <button
                onClick={doStart}
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-black text-base shadow-xl active:scale-[0.98] transition-transform"
                style={{ animation: 'g-ping-soft 1.6s ease-out infinite' }}
              >
                MULAI {room.mode === 'coop' ? '🛡️' : '⚔️'} ({activeCount} pemain)
              </button>
            ) : (
              <div className="text-center text-sm text-stone-400 py-3">
                nunggu host mulai
                <span className="inline-flex ml-1">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="g-dot mx-[2px]" style={{ animation: 'g-dot 1.2s infinite', animationDelay: `${i * 0.2}s` }}>
                      .
                    </span>
                  ))}
                </span>
              </div>
            )}
            {players.length === 1 && isHost && (
              <p className="text-[10px] text-stone-500 text-center mt-2">
                Bisa main solo buat latihan, tapi makin rame makin seru 🔥
              </p>
            )}
          </div>
        )}

        {/* ══════════════ COUNTDOWN ══════════════ */}
        {room && room.status === 'countdown' && (
          <div className="fixed inset-0 flex items-center justify-center z-40">
            <div key={cdNum} className="g-count text-[120px] font-black bg-gradient-to-b from-white to-violet-300 bg-clip-text text-transparent">
              {cdNum > 0 ? cdNum : 'GO!'}
            </div>
          </div>
        )}

        {/* ══════════════ QUESTION ══════════════ */}
        {room && room.status === 'question' && room.q && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold text-stone-400">
                Soal {room.qi + 1}/{room.qTotal}
              </span>
              <span className="text-[11px] font-bold text-stone-400">
                {room.answeredCount}/{activeCount} jawab
              </span>
            </div>

            {/* timer bar */}
            <div className="h-2.5 rounded-full bg-white/[0.07] overflow-hidden mb-1.5">
              <div
                className="h-full rounded-full transition-none"
                style={{
                  width: `${remPct * 100}%`,
                  background: remPct > 0.5 ? '#22c55e' : remPct > 0.22 ? '#f59e0b' : '#ef4444',
                }}
              />
            </div>
            <div className="flex items-center justify-between mb-3">
              <span className={`text-xs font-black ${remQ <= 3000 ? 'text-red-400' : 'text-stone-300'}`}>
                {Math.ceil(remQ / 1000)} dtk
              </span>
              {you && you.score > 0 && (
                <span className="text-xs font-black text-amber-300">
                  {you.score} poin {you.streak >= 2 && <span className="ml-1">🔥x{you.streak}</span>}
                </span>
              )}
            </div>

            {/* boss HUD (co-op) */}
            {room.mode === 'coop' && (
              <div className={`rounded-xl border border-red-400/30 bg-red-500/[0.07] p-3 mb-3 ${room.combo === 0 ? 'g-pop' : ''}`}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-black text-red-300">👾 BOSS "{room.topic.toUpperCase()}"</span>
                  <span className="text-[11px]">
                    {'❤️'.repeat(Math.max(0, room.lives))}
                    {'🖤'.repeat(Math.max(0, 3 - room.lives))}
                    {room.combo >= 2 && <span className="ml-2 font-black text-orange-300">🔥 combo x{room.combo}</span>}
                  </span>
                </div>
                <div className="h-3 rounded-full bg-black/40 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-red-500 to-rose-400 transition-all duration-500"
                    style={{ width: `${(room.hp / Math.max(1, room.hpMax)) * 100}%` }}
                  />
                </div>
                <div className="text-[10px] text-stone-400 mt-1">
                  HP Boss {room.hp}/{room.hpMax} — benarkan minimal 1 soal per ronde buat meremukkan boss!
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 mb-4">
              <p className="text-[15px] font-semibold leading-snug">{room.q.q}</p>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              {room.q.choices.map((c, i) => {
                const mine = room.myAnswer;
                const isMine = mine?.c === i;
                const dim = (mine || locked) && !isMine;
                return (
                  <button
                    key={i}
                    onClick={() => doAnswer(i)}
                    disabled={(!!mine && mine.c !== undefined) || locked}
                    className={`relative flex items-center gap-2 p-3 rounded-xl text-left font-bold text-sm leading-snug text-white transition-all duration-150 active:scale-95 ${
                      isMine ? 'ring-4 ring-white/70' : ''
                    } ${dim ? 'opacity-30' : 'hover:brightness-110'}`}
                    style={{ background: CHOICE_COLORS[i], boxShadow: '0 4px 0 rgba(0,0,0,.35)' }}
                  >
                    <span className="text-base shrink-0">{SHAPES[i]}</span>
                    <span className="min-w-0">{c}</span>
                    {isMine && <span className="absolute top-1.5 right-2 text-[10px]">✓ terkirim</span>}
                  </button>
                );
              })}
            </div>

            {(room.myAnswer || locked) && (
              <p className="text-center text-[11px] text-stone-500 mt-3">
                jawaban terkirim — nunggu {Math.max(0, activeCount - room.answeredCount)} pemain lain…
              </p>
            )}
          </div>
        )}

        {/* ══════════════ REVEAL ══════════════ */}
        {room && room.status === 'reveal' && room.q && (
          <div>
            {(() => {
              const a = room.myAnswer;
              if (!a) {
                return (
                  <div className="rounded-2xl border border-white/15 bg-white/[0.06] p-4 mb-3 text-center">
                    <div className="text-xl font-black text-stone-300">⌛ Waktu habis!</div>
                    <div className="text-[11px] text-stone-500 mt-0.5">nggak sempat jawab — gasal berikutnya!</div>
                  </div>
                );
              }
              if (a.correct) {
                return (
                  <div className="relative rounded-2xl border border-emerald-400/50 bg-emerald-500/15 p-4 mb-3 text-center g-pop">
                    <div className="text-xl font-black text-emerald-300">
                      BENAR! 🎉 +{a.pts}
                    </div>
                    <div className="text-[11px] text-emerald-200/70 mt-0.5">
                      {you && you.streak >= 2 ? `streak 🔥x${you.streak} — bonus jalan terus!` : 'cepat & tepat!'}
                    </div>
                    <span className="absolute left-1/2 -translate-x-1/2 -top-2 text-sm font-black text-emerald-300" style={{ animation: 'g-float 1.4s ease-out forwards' }}>
                      +{a.pts}
                    </span>
                  </div>
                );
              }
              return (
                <div className="rounded-2xl border border-red-400/50 bg-red-500/15 p-4 mb-3 text-center g-pop" style={{ animation: 'g-pop .3s, g-shake .4s' }}>
                  <div className="text-xl font-black text-red-300">BELUM TEPAT 😬</div>
                  <div className="text-[11px] text-red-200/70 mt-0.5">streak putus — balik di soal berikutnya!</div>
                </div>
              );
            })()}

            {room.mode === 'coop' && (
              <div className={`rounded-xl border border-red-400/25 bg-red-500/[0.06] p-3 mb-3 ${room.combo > 0 ? '' : ''}`} style={{ animation: 'g-boss-hit .35s' }}>
                <div className="text-[11px] font-black text-red-300 mb-1.5">
                  {room.players.some((p) => p.lastCorrect)
                    ? `💥 Boss kena! HP -100 → ${room.hp}/${room.hpMax}`
                    : `💔 Miss! Nyawa tinggal ${room.lives}`}
                </div>
                <div className="h-2.5 rounded-full bg-black/40 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-red-500 to-rose-400 transition-all duration-500"
                    style={{ width: `${(room.hp / Math.max(1, room.hpMax)) * 100}%` }}
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2.5 mb-3">
              {room.q.choices.map((c, i) => {
                const isAns = room.q?.answer === i;
                const mine = room.myAnswer?.c === i;
                return (
                  <div
                    key={i}
                    className={`flex items-center gap-2 p-3 rounded-xl text-left font-bold text-sm leading-snug text-white ${
                      isAns ? 'ring-4 ring-emerald-400' : mine ? 'ring-4 ring-red-400' : 'opacity-40'
                    }`}
                    style={{ background: CHOICE_COLORS[i], boxShadow: '0 4px 0 rgba(0,0,0,.35)' }}
                  >
                    <span className="text-base shrink-0">{SHAPES[i]}</span>
                    <span className="min-w-0">{c}</span>
                    {isAns && <span className="ml-auto shrink-0">✓</span>}
                    {mine && !isAns && <span className="ml-auto shrink-0">✗</span>}
                  </div>
                );
              })}
            </div>

            {room.q.explain && (
              <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 mb-3">
                <div className="text-[10px] uppercase tracking-wider text-stone-500 font-bold mb-1">kenapa?</div>
                <p className="text-xs text-stone-300 leading-relaxed">{room.q.explain}</p>
              </div>
            )}

            {/* leaderboard mini */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-2.5 mb-3">
              <div className="text-[10px] uppercase tracking-wider text-stone-500 font-bold mb-1.5">skor sementara</div>
              <div className="space-y-1">
                {players.slice(0, 6).map((p, rank) => (
                  <div
                    key={p.id}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs ${
                      p.id === you?.id ? 'bg-violet-500/20 ring-1 ring-violet-400/40' : 'bg-white/[0.03]'
                    }`}
                  >
                    <span className="w-4 font-black text-stone-500">{rank + 1}</span>
                    <span>{p.avatar}</span>
                    <span className="font-bold truncate flex-1 min-w-0">{p.name}</span>
                    {p.lastPts > 0 && (
                      <span className="text-emerald-300 font-black text-[11px]">+{p.lastPts}</span>
                    )}
                    <span className="font-black text-amber-300">{p.score}</span>
                  </div>
                ))}
              </div>
            </div>

            {isHost ? (
              <div>
                <button
                  onClick={doAdvance}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white font-black text-sm shadow-lg active:scale-[0.98] transition-transform"
                >
                  {room.qi >= room.qTotal - 1 ? 'LIHAT HASIL 🏁' : 'LANJUT ▶'}
                </button>
                <div className="h-1 rounded-full bg-white/[0.07] overflow-hidden mt-2">
                  <div
                    className="h-full bg-white/30"
                    style={{ width: `${100 - (remReveal / 7000) * 100}%` }}
                  />
                </div>
                <p className="text-[10px] text-stone-600 text-center mt-1">otomatis lanjut kalau nggak diklik</p>
              </div>
            ) : (
              <p className="text-center text-[11px] text-stone-500">host yang ngatur lanjut…</p>
            )}
          </div>
        )}

        {/* ══════════════ FINISHED ══════════════ */}
        {room && room.status === 'finished' && (
          <div className="g-pop">
            {(room.mode === 'battle' || room.result === 'win') && <Confetti />}

            <div className="text-center mb-5">
              {room.mode === 'coop' ? (
                room.result === 'win' ? (
                  <>
                    <div className="text-4xl font-black text-emerald-300">BOSS TUMBANG! 🎉</div>
                    <p className="text-xs text-stone-400 mt-1">
                      "{room.topic}" ditaklukkan bareng — sisa nyawa {room.lives}, combo terbaik 🔥x{room.bestCombo}
                    </p>
                  </>
                ) : (
                  <>
                    <div className="text-4xl font-black text-red-300">BOSS MENANG 😤</div>
                    <p className="text-xs text-stone-400 mt-1">
                      nyawa habis di soal {room.qi + 1}/{room.qTotal}. Gaskeun rematch — pasti bisa!
                    </p>
                  </>
                )
              ) : (
                <>
                  <div className="text-3xl font-black bg-gradient-to-r from-amber-300 to-yellow-400 bg-clip-text text-transparent">
                    🏆 {winner ? `${winner.name} MENANG!` : 'SELESAI!'}
                  </div>
                  <p className="text-xs text-stone-400 mt-1">
                    {winner && winner.score > 0 ? `${winner.score} poin` : 'latihan yang bagus!'} · topik "{room.topic}"
                  </p>
                </>
              )}
            </div>

            {/* podium */}
            <div className="flex items-end justify-center gap-2 mb-5">
              {[1, 0, 2].map((slot) => {
                const p = top[slot];
                if (!p) return <div key={slot} className="w-20" />;
                const h = slot === 0 ? 'h-28' : slot === 1 ? 'h-20' : 'h-16';
                const medal = slot === 0 ? '🥇' : slot === 1 ? '🥈' : '🥉';
                return (
                  <div key={p.id} className="flex flex-col items-center w-24">
                    <div className="text-2xl">{p.avatar}</div>
                    <div className="text-[11px] font-bold truncate max-w-full">{p.name}</div>
                    <div className="text-[10px] text-amber-300 font-black">{p.score}</div>
                    <div
                      className={`${h} w-full rounded-t-xl flex items-start justify-center pt-1 text-xl g-pop`}
                      style={{
                        background: slot === 0 ? 'linear-gradient(180deg, rgba(245,158,11,.5), rgba(245,158,11,.15))' : 'rgba(255,255,255,.06)',
                      }}
                    >
                      {medal}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-2.5 mb-5">
              <div className="space-y-1">
                {players.map((p, rank) => (
                  <div
                    key={p.id}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs ${
                      p.id === you?.id ? 'bg-violet-500/20 ring-1 ring-violet-400/40' : 'bg-white/[0.03]'
                    }`}
                  >
                    <span className="w-4 font-black text-stone-500">{rank + 1}</span>
                    <span>{p.avatar}</span>
                    <span className="font-bold truncate flex-1 min-w-0">{p.name}</span>
                    <span className="text-stone-400 text-[10px] shrink-0">{p.corr} benar · 🔥{p.best}</span>
                    <span className="font-black text-amber-300">{p.score}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              {isHost ? (
                <>
                  <button
                    onClick={doRestart}
                    className="flex-1 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-black text-sm shadow-lg active:scale-[0.98] transition-transform"
                  >
                    REMATCH ↺
                  </button>
                  <button
                    onClick={goHome}
                    className="flex-1 py-3 rounded-xl bg-white/[0.07] border border-white/10 font-black text-sm hover:bg-white/[0.12] transition-colors"
                  >
                    ROOM BARU ✨
                  </button>
                </>
              ) : (
                <button
                  onClick={goHome}
                  className="w-full py-3 rounded-xl bg-white/[0.07] border border-white/10 font-black text-sm hover:bg-white/[0.12] transition-colors"
                >
                  KELUAR
                </button>
              )}
            </div>
            {isHost && (
              <p className="text-[10px] text-stone-500 text-center mt-2">
                Rematch pakai soal yang sama (cepat) — link invite masih berlaku.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
