/**
 * lib/game/engine.ts  -  Engine game kuis multiplayer (in-memory, single process)
 *
 * Room disimpan di Map modul — hidup selama proses astro server jalan.
 * Transisi status dilakukan "lazy" via tickRoom() yang dipanggil setiap
 * action/state: countdown → question → reveal → (next) … → finished.
 * Tidak ada timer setTimeout global; semua waktu absolut berbasis Date.now()
 * supaya client tinggal interpolasi dengan offset clock dari server.
 *
 * Mode:
 *  - battle  : tiap pemain jawab sendiri; skor = kecepatan + streak bonus.
 *  - coop    : satu "boss" (set soal) dengan HP; soal lolos kalau minimal
 *              1 pemain benar sebelum waktu habis; semua salah = -1 nyawa.
 */

export type GameMode = 'battle' | 'coop';
export type RoomStatus = 'lobby' | 'countdown' | 'question' | 'reveal' | 'finished';

export interface GQuestion {
  q: string;
  choices: string[];
  answer: number;
  explain: string;
}

export interface PlayerAnswer {
  c: number;
  correct: boolean;
  pts: number;
  ms: number;
}

export interface GPlayer {
  id: string;
  name: string;
  avatar: string;
  host: boolean;
  score: number;
  streak: number;
  best: number;
  corr: number; // total jawaban benar (buat layar akhir)
  lastSeen: number;
  gone: boolean; // keluar manual (lobby)
  answers: Record<number, PlayerAnswer>;
}

export interface GRoom {
  code: string;
  mode: GameMode;
  topic: string;
  hostId: string;
  status: RoomStatus;
  result: 'win' | 'lose' | '';
  qs: GQuestion[];
  qi: number;
  qStart: number;
  countdownEnd: number;
  revealStart: number;
  players: Map<string, GPlayer>;
  createdAt: number;
  hp: number;
  hpMax: number;
  lives: number;
  combo: number;
  bestCombo: number;
  rev: number;
}

export const QUESTION_MS = 20_000;
export const COUNTDOWN_MS = 3_500;
export const REVEAL_MS = 7_000;
const CONNECT_TIMEOUT = 12_000;
const MAX_PLAYERS = 12;
const ROOM_TTL = 4 * 60 * 60 * 1000;
const FINISHED_TTL = 30 * 60 * 1000;

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const rooms = new Map<string, GRoom>();

function randCode(): string {
  let c = '';
  for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}

function randId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** GC malas: buang room kadaluarsa / lama kosong. Panggil di tiap request. */
export function gcRooms(): void {
  const now = Date.now();
  for (const [code, r] of rooms) {
    const finishedAt = r.status === 'finished' ? Math.max(r.revealStart, r.qStart) : 0;
    if (
      (r.status === 'finished' && now - finishedAt > FINISHED_TTL) ||
      now - r.createdAt > ROOM_TTL
    ) {
      rooms.delete(code);
    }
  }
}

export function getRoom(code: string): GRoom | undefined {
  return rooms.get(String(code || '').trim().toUpperCase());
}

export function createRoom(opts: {
  mode: GameMode;
  topic: string;
  questions: GQuestion[];
  hostName: string;
  hostAvatar: string;
}): GRoom {
  let code = randCode();
  while (rooms.has(code)) code = randCode();
  const now = Date.now();
  const host: GPlayer = {
    id: randId(),
    name: opts.hostName,
    avatar: opts.hostAvatar,
    host: true,
    score: 0,
    streak: 0,
    best: 0,
    corr: 0,
    lastSeen: now,
    gone: false,
    answers: {},
  };
  const room: GRoom = {
    code,
    mode: opts.mode,
    topic: opts.topic,
    hostId: host.id,
    status: 'lobby',
    result: '',
    qs: opts.questions,
    qi: 0,
    qStart: 0,
    countdownEnd: 0,
    revealStart: 0,
    players: new Map([[host.id, host]]),
    createdAt: now,
    hp: opts.questions.length * 100,
    hpMax: opts.questions.length * 100,
    lives: 3,
    combo: 0,
    bestCombo: 0,
    rev: 1,
  };
  rooms.set(code, room);
  return room;
}

export function joinRoom(code: string, name: string, avatar: string): GPlayer | null {
  const room = getRoom(code);
  if (!room || room.status !== 'lobby') return null;
  const active = [...room.players.values()].filter((p) => !p.gone);
  if (active.length >= MAX_PLAYERS) return null;
  // nama duplikat → sufiks
  let finalName = name;
  let n = 2;
  while (active.some((p) => p.name.toLowerCase() === finalName.toLowerCase())) {
    finalName = `${name} (${n++})`;
    if (n > 20) return null;
  }
  const player: GPlayer = {
    id: randId(),
    name: finalName,
    avatar,
    host: false,
    score: 0,
    streak: 0,
    best: 0,
    corr: 0,
    lastSeen: Date.now(),
    gone: false,
    answers: {},
  };
  room.players.set(player.id, player);
  room.rev++;
  return player;
}

function activePlayers(r: GRoom): GPlayer[] {
  return [...r.players.values()].filter((p) => !p.gone);
}

/** Soal ke-i dilihat dari kamera publik: jawaban benar cuma bocor saat reveal/finished. */
export function pubQuestion(r: GRoom, i: number): GQuestion | null {
  const q = r.qs[i];
  if (!q) return null;
  const reveal = r.status === 'reveal' || r.status === 'finished';
  if (reveal) return { q: q.q, choices: q.choices, answer: q.answer, explain: q.explain };
  return { q: q.q, choices: q.choices, answer: -1, explain: '' };
}

function finish(r: GRoom, result: 'win' | 'lose' | '') {
  r.status = 'finished';
  r.result = result;
  r.revealStart = Date.now();
  r.rev++;
}

/** Reveal: kunci soal, hitung hasil co-op (HP boss / nyawa). */
function doReveal(r: GRoom, now: number) {
  r.status = 'reveal';
  r.revealStart = now;
  r.rev++;
  if (r.mode === 'coop') {
    const cleared = activePlayers(r).some((p) => p.answers[r.qi]?.correct);
    if (cleared) {
      r.hp = Math.max(0, r.hp - 100);
      r.combo++;
      if (r.combo > r.bestCombo) r.bestCombo = r.combo;
    } else {
      r.lives--;
      r.combo = 0;
      if (r.lives <= 0) {
        finish(r, 'lose');
        return;
      }
    }
    // soal terakhir berhasil → menang
    if (cleared && r.qi >= r.qs.length - 1) finish(r, 'win');
  }
}

function doAdvance(r: GRoom, now: number) {
  if (r.qi >= r.qs.length - 1) {
    finish(r, r.mode === 'coop' ? (r.lives > 0 ? 'win' : 'lose') : '');
    return;
  }
  r.qi++;
  r.status = 'question';
  r.qStart = now;
  r.rev++;
}

/**
 * Transisi lazy. Wajib dipanggil sebelum membaca status room di setiap
 * action & state supaya semua client melihat fase yang konsisten.
 */
export function tickRoom(r: GRoom): void {
  const now = Date.now();
  let changed = false;
  if (r.status === 'countdown' && now >= r.countdownEnd) {
    r.status = 'question';
    r.qStart = now;
    changed = true;
  }
  if (r.status === 'question') {
    const active = activePlayers(r);
    const answered = active.filter((p) => p.answers[r.qi]).length;
    const timeUp = now >= r.qStart + QUESTION_MS;
    if ((active.length > 0 && answered >= active.length) || timeUp) {
      doReveal(r, now);
      changed = true;
    }
  }
  if (r.status === 'reveal' && now >= r.revealStart + REVEAL_MS) {
    doAdvance(r, now);
    changed = true;
  }
  if (changed) r.rev++;
}

export function startGame(r: GRoom, pid: string): boolean {
  if (r.hostId !== pid || r.status !== 'lobby') return false;
  const now = Date.now();
  r.status = 'countdown';
  r.countdownEnd = now + COUNTDOWN_MS;
  r.qi = 0;
  r.rev++;
  return true;
}

export function restartGame(r: GRoom, pid: string): boolean {
  if (r.hostId !== pid || r.status !== 'finished') return false;
  const now = Date.now();
  for (const p of r.players.values()) {
    p.score = 0;
    p.streak = 0;
    p.best = 0;
    p.corr = 0;
    p.answers = {};
  }
  r.qi = 0;
  r.hp = r.hpMax;
  r.lives = 3;
  r.combo = 0;
  r.bestCombo = 0;
  r.result = '';
  r.status = 'countdown';
  r.countdownEnd = now + COUNTDOWN_MS;
  r.rev++;
  return true;
}

export function forceAdvance(r: GRoom, pid: string): boolean {
  if (r.hostId !== pid || r.status !== 'reveal') return false;
  doAdvance(r, Date.now());
  return true;
}

export function leaveRoom(r: GRoom, pid: string): boolean {
  const p = r.players.get(pid);
  if (!p) return false;
  if (r.status === 'lobby') {
    r.players.delete(pid);
    r.rev++;
    return true;
  }
  // di tengah game: tandai gone (jawabannya tetap dihitung)
  p.gone = true;
  r.rev++;
  return true;
}

/**
 * Catat jawaban pemain. Return {ok, correct, pts} atau {ok:false, reason}.
 * Skor duel = 500 penuh kalau jawab instan, melandai ke 100 kalau mepet
 * waktu; streak >= 2 dapat bonus 60/soal (maks 300).
 */
export function submitAnswer(
  r: GRoom,
  pid: string,
  qi: number,
  c: number,
): { ok: boolean; reason?: string; correct?: boolean; pts?: number; streak?: number } {
  const p = r.players.get(pid);
  if (!p || p.gone) return { ok: false, reason: 'player' };
  if (r.status !== 'question' || qi !== r.qi) return { ok: false, reason: 'fase' };
  if (p.answers[qi]) return { ok: false, reason: 'sudah jawab' };
  const now = Date.now();
  const elapsed = Math.max(0, now - r.qStart);
  if (elapsed >= QUESTION_MS) return { ok: false, reason: 'waktu habis' };
  if (!Number.isInteger(c) || c < 0 || c > 3) return { ok: false, reason: 'pilihan' };

  const q = r.qs[qi];
  const correct = c === q.answer;
  let pts = 0;
  let newStreak = p.streak;
  if (correct) {
    const frac = Math.min(1, elapsed / QUESTION_MS);
    const base = Math.max(100, Math.round(500 * (1 - frac / 2)));
    newStreak = p.streak + 1;
    const bonus = newStreak >= 2 ? Math.min(300, 60 * (newStreak - 1)) : 0;
    pts = base + bonus;
    p.streak = newStreak;
    if (newStreak > p.best) p.best = newStreak;
    p.corr++;
    p.score += pts;
  } else {
    p.streak = 0;
  }
  p.answers[qi] = { c, correct, pts, ms: elapsed };
  r.rev++;
  // semua sudah menjawab → langsung reveal (tick di state berikutnya)
  const active = activePlayers(r);
  if (active.every((x) => x.answers[r.qi])) doReveal(r, now);
  return { ok: true, correct, pts, streak: newStreak };
}

/** Snapshot publik room untuk polling client. Tidak pernah bocorkan kunci soal. */
export function pubRoom(r: GRoom, pid: string) {
  const now = Date.now();
  const me = r.players.get(pid) || null;
  const players = [...r.players.values()]
    .filter((p) => r.status === 'lobby' ? !p.gone : true)
    .map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      host: p.host,
      score: p.score,
      streak: p.streak,
      best: p.best,
      corr: p.corr,
      connected: now - p.lastSeen < CONNECT_TIMEOUT,
      answered: r.status === 'question' && !!p.answers[r.qi],
      lastCorrect: r.status === 'reveal' ? !!p.answers[r.qi]?.correct : false,
      lastPts: r.status === 'reveal' ? (p.answers[r.qi]?.pts ?? 0) : 0,
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const answeredCount = players.filter((p) => p.answered).length;
  return {
    code: r.code,
    mode: r.mode,
    topic: r.topic,
    status: r.status,
    result: r.result,
    hostId: r.hostId,
    qi: r.qi,
    qTotal: r.qs.length,
    serverNow: now,
    countdownEnd: r.status === 'countdown' ? r.countdownEnd : 0,
    qEnd: r.status === 'question' ? r.qStart + QUESTION_MS : 0,
    revealEnd: r.status === 'reveal' ? r.revealStart + REVEAL_MS : 0,
    hp: r.hp,
    hpMax: r.hpMax,
    lives: r.lives,
    combo: r.combo,
    bestCombo: r.bestCombo,
    answeredCount,
    players,
    q: (r.status === 'question' || r.status === 'countdown' || r.status === 'reveal' || r.status === 'finished')
      ? pubQuestion(r, r.qi)
      : null,
    myAnswer: me ? (me.answers[r.qi] ?? null) : null,
    you: me
      ? { id: me.id, name: me.name, avatar: me.avatar, host: me.host, score: me.score, streak: me.streak }
      : null,
    rev: r.rev,
  };
}

export function touchPlayer(r: GRoom, pid: string): void {
  const p = r.players.get(pid);
  if (p) p.lastSeen = Date.now();
}

export { MAX_PLAYERS };
