/**
 * ai-memory.ts — Long-term AI memory for personalized experience
 *
 * Stores user preferences, learning style, and interaction history
 * in browser localStorage. AI uses this to greet user personally
 * and adapt to their style.
 *
 * Storage: localStorage['alynne-ai-memory']
 */

export interface AIMemory {
  // User profile
  username?: string;
  preferredName?: string;

  // Learning style preferences
  learningStyle: 'casual' | 'formal' | 'concise' | 'detailed';
  preferredLanguage: 'id' | 'en';

  // Greeting history
  lastVisit: string | null; // ISO date
  totalSessions: number;
  totalStudyMinutes: number;

  // Recent activity (last 10)
  recentActivity: ActivityEntry[];

  // Pending tasks (AI suggests these on next visit)
  pendingTasks: PendingTask[];

  // Study preferences
  preferredPomodoroMinutes: number;
  preferredBreakMinutes: number;
  focusSensitivity: 'low' | 'medium' | 'high';

  // Ambient preferences
  preferredAmbient: 'none' | 'lofi' | 'whitenoise' | 'rain' | 'forest';

  // Referral
  referralCode?: string;
  referralCount: number;
  referralRewards: number; // months of free premium

  // Quiz stats
  totalQuizzesTaken: number;
  totalCorrectAnswers: number;
  totalQuestionsAttempted: number;

  // Streak
  currentStreak: number;
  longestStreak: number;
  lastStudyDate: string | null;
}

export interface ActivityEntry {
  type: 'stt' | 'pdf' | 'mindmap' | 'quiz' | 'study-session' | 'chat';
  title: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

export interface PendingTask {
  id: string;
  type: 'continue-study' | 'review-quiz' | 'finish-pdf';
  title: string;
  description: string;
  createdAt: string;
  data?: Record<string, any>;
}

const STORAGE_KEY = 'alynne-ai-memory';

const DEFAULT_MEMORY: AIMemory = {
  learningStyle: 'casual',
  preferredLanguage: 'id',
  lastVisit: null,
  totalSessions: 0,
  totalStudyMinutes: 0,
  recentActivity: [],
  pendingTasks: [],
  preferredPomodoroMinutes: 25,
  preferredBreakMinutes: 5,
  focusSensitivity: 'medium',
  preferredAmbient: 'none',
  referralCount: 0,
  referralRewards: 0,
  totalQuizzesTaken: 0,
  totalCorrectAnswers: 0,
  totalQuestionsAttempted: 0,
  currentStreak: 0,
  longestStreak: 0,
  lastStudyDate: null,
};

/**
 * Load AI memory from localStorage.
 */
export function loadMemory(): AIMemory {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_MEMORY };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_MEMORY };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_MEMORY, ...parsed };
  } catch {
    return { ...DEFAULT_MEMORY };
  }
}

/**
 * Save AI memory to localStorage.
 */
export function saveMemory(memory: AIMemory): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
  } catch (e) {
    console.warn('[AI-Memory] Save failed:', e);
  }
}

/**
 * Update memory with partial data (merges with existing).
 */
export function updateMemory(updates: Partial<AIMemory>): AIMemory {
  const current = loadMemory();
  const updated = { ...current, ...updates };
  saveMemory(updated);
  return updated;
}

/**
 * Record a new activity entry.
 */
export function recordActivity(entry: Omit<ActivityEntry, 'timestamp'>): void {
  const memory = loadMemory();
  const fullEntry: ActivityEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  };
  memory.recentActivity = [fullEntry, ...memory.recentActivity].slice(0, 10);
  saveMemory(memory);
}

/**
 * Add a pending task (AI will suggest on next visit).
 */
export function addPendingTask(task: Omit<PendingTask, 'id' | 'createdAt'>): void {
  const memory = loadMemory();
  const fullTask: PendingTask = {
    ...task,
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    createdAt: new Date().toISOString(),
  };
  // Avoid duplicates by type
  memory.pendingTasks = memory.pendingTasks.filter((t) => t.type !== task.type);
  memory.pendingTasks = [fullTask, ...memory.pendingTasks].slice(0, 5);
  saveMemory(memory);
}

/**
 * Remove a pending task (when user completes or dismisses it).
 */
export function completePendingTask(taskId: string): void {
  const memory = loadMemory();
  memory.pendingTasks = memory.pendingTasks.filter((t) => t.id !== taskId);
  saveMemory(memory);
}

/**
 * Update streak based on today's date.
 * Called when user starts a study session.
 */
export function updateStreak(): void {
  const memory = loadMemory();
  const today = new Date().toISOString().split('T')[0];

  if (memory.lastStudyDate === today) {
    // Already studied today, no change
    return;
  }

  if (memory.lastStudyDate) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    if (memory.lastStudyDate === yesterday) {
      // Continued streak
      memory.currentStreak += 1;
    } else {
      // Streak broken
      memory.currentStreak = 1;
    }
  } else {
    // First ever study
    memory.currentStreak = 1;
  }

  memory.lastStudyDate = today;
  if (memory.currentStreak > memory.longestStreak) {
    memory.longestStreak = memory.currentStreak;
  }
  saveMemory(memory);
}

/**
 * Record quiz results.
 */
export function recordQuizResult(correct: number, total: number): void {
  const memory = loadMemory();
  memory.totalQuizzesTaken += 1;
  memory.totalCorrectAnswers += correct;
  memory.totalQuestionsAttempted += total;
  saveMemory(memory);
}

/**
 * Generate personalized greeting based on time of day + memory.
 */
export function generateGreeting(): string {
  const memory = loadMemory();
  const hour = new Date().getHours();
  const name = memory.preferredName || memory.username || '';

  let timeGreeting = 'Halo';
  if (hour < 11) timeGreeting = 'Selamat pagi';
  else if (hour < 15) timeGreeting = 'Selamat siang';
  else if (hour < 19) timeGreeting = 'Selamat sore';
  else timeGreeting = 'Selamat malam';

  let greeting = `${timeGreeting}${name ? ', ' + name : ''}!`;

  // Add streak message
  if (memory.currentStreak > 1) {
    greeting += ` 🔥 Streak ${memory.currentStreak} hari!`;
  }

  // Add pending task suggestion
  if (memory.pendingTasks.length > 0) {
    const task = memory.pendingTasks[0];
    greeting += ` ${task.title}`;
  } else if (memory.totalStudyMinutes > 0) {
    // Welcome back message
    greeting += ` Total belajar: ${Math.floor(memory.totalStudyMinutes / 60)}j ${memory.totalStudyMinutes % 60}m.`;
  }

  return greeting;
}

/**
 * Generate or get referral code for user.
 */
export function getReferralCode(): string {
  const memory = loadMemory();
  if (memory.referralCode) return memory.referralCode;

  // Generate new code: ALYNNE-XXXXXX
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = 'ALYNNE-';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }

  memory.referralCode = code;
  saveMemory(memory);
  return code;
}

/**
 * Get referral link.
 */
export function getReferralLink(): string {
  const code = getReferralCode();
  if (typeof window === 'undefined') return `https://alynne.my.id/?ref=${code}`;
  return `${window.location.origin}/?ref=${code}`;
}

/**
 * Check if current visit is via referral link.
 */
export function checkReferralEntry(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const ref = params.get('ref');
  if (ref) {
    // Store in localStorage so we don't lose it on navigation
    localStorage.setItem('alynne-referral-entered', ref);
    return ref;
  }
  return localStorage.getItem('alynne-referral-entered');
}

/**
 * Get study analytics for the past week.
 */
export function getWeeklyAnalytics(): {
  totalMinutes: number;
  totalSessions: number;
  avgFocusScore: number;
  dailyBreakdown: { date: string; minutes: number; sessions: number }[];
  bestDay: { date: string; minutes: number } | null;
} {
  const memory = loadMemory();
  const today = new Date();
  const dailyBreakdown: { date: string; minutes: number; sessions: number }[] = [];

  for (let i = 6; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];

    // Get from focus days (stored by study-mode.tsx)
    let minutes = 0;
    let sessions = 0;
    try {
      const focusDays = JSON.parse(localStorage.getItem('lina-focus-days') || '[]');
      const day = focusDays.find((d: any) => d.date === dateStr);
      if (day) {
        minutes = day.totalMinutes || 0;
        sessions = day.sessions || 0;
      }
    } catch {}

    dailyBreakdown.push({ date: dateStr, minutes, sessions });
  }

  const totalMinutes = dailyBreakdown.reduce((s, d) => s + d.minutes, 0);
  const totalSessions = dailyBreakdown.reduce((s, d) => s + d.sessions, 0);
  const bestDay = dailyBreakdown.reduce(
    (best, d) => (d.minutes > (best?.minutes || 0) ? d : best),
    null as { date: string; minutes: number } | null
  );

  return {
    totalMinutes,
    totalSessions,
    avgFocusScore: 0, // TODO: track from study sessions
    dailyBreakdown,
    bestDay,
  };
}
