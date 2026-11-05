import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type TabId =
  | 'stt' | 'modul' | 'mindmap' | 'sharpen' | 'admin'
  | 'voice-cmd' | 'belajar' | 'hub' | 'notes' | 'stats' | 'refer' | 'flash';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model?: string;
  timestamp: number;
}

export type STTSource = 'webspeech' | 'groq' | 'screen-capture';
export type STTStatus = 'idle' | 'recording' | 'processing' | 'error';
export type STTAudioMode = 'mic' | 'screen';
export type AIModel = string;

export type { ModelInfo } from './models';
export { MODEL_LIST, MODEL_GROUPS } from './models';

export interface UploadedMaterial {
  id: string;
  name: string;
  type: 'pdf' | 'docx' | 'pptx' | 'txt' | 'other';
  size: number;
  text: string;
  uploadedAt: number;
}

export interface ApiKeys {
  groq: string;
  deepgram: string;
  gemini: string;
  cloudflare: string;
  cloudflareAccountId: string;
}

export interface UserStats {
  id: string;
  xp: number;
  level: number;
  streak: number;
  currentSeason: number;
  playedToday: boolean;
  monthlyDays: number;
  name?: string;
  image?: string | null;
}

export interface SavedMindMap {
  id: string;
  userId: string;
  title: string;
  nodesJson: string;
  sourceText: string;
  createdAt: string;
  updatedAt: string;
}

interface AppState {
  // Auth
  user: { id: string; email: string; name: string; image?: string | null } | null;
  setUser: (user: AppState['user']) => void;

  // API Keys
  apiKeys: ApiKeys;
  setApiKeys: (keys: Partial<ApiKeys>) => void;

  // STT
  sttStatus: STTStatus;
  setSttStatus: (s: STTStatus) => void;
  sttSource: STTSource;
  setSttSource: (s: STTSource) => void;
  sttAudioMode: STTAudioMode;
  setSttAudioMode: (m: STTAudioMode) => void;
  transcript: string;
  setTranscript: (t: string) => void;
  setTranscriptBatch: (texts: string[]) => void;
  transcriptEntries: { time: string; text: string }[];
  appendTranscript: (t: string) => void;
  appendTranscriptBatch: (texts: string[]) => void;
  interimTranscript: string;
  setInterimTranscript: (t: string) => void;
  sttError: string;
  setSttError: (e: string) => void;
  isReconnecting: boolean;
  setIsReconnecting: (v: boolean) => void;
  replaceEntriesFrom: (fromIdx: number, newEntries: { time: string; text: string }[]) => void;

  // AI Chat
  aiMessages: ChatMessage[];
  addAiMessage: (msg: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  clearAiMessages: () => void;
  selectedModel: AIModel;
  setSelectedModel: (m: AIModel) => void;
  isAiLoading: boolean;
  setIsAiLoading: (v: boolean) => void;
  scrapeMode: boolean;
  setScrapeMode: (v: boolean) => void;

  // Stats
  userStats: UserStats | null;
  setUserStats: (s: UserStats | null) => void;
  showCertificate: boolean;
  setShowCertificate: (v: boolean) => void;

  // Materials
  uploadedMaterials: UploadedMaterial[];
  addMaterial: (m: UploadedMaterial) => void;
  removeMaterial: (id: string) => void;
  clearMaterials: () => void;

  // UI
  settingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
  studyModeEnabled: boolean;
  setStudyModeEnabled: (v: boolean) => void;
  studyModeOpen: boolean;
  setStudyModeOpen: (v: boolean) => void;

  // Mode Selector (legacy - kept for back-compat with any older UI)
  selectedMode: string | null;
  setSelectedMode: (m: string | null) => void;
  generatedContent: string;
  setGeneratedContent: (s: string) => void;
  isGenerating: boolean;
  setIsGenerating: (v: boolean) => void;

  // Voice Command
  voiceCmdActive: boolean;
  setVoiceCmdActive: (v: boolean) => void;

  // Theme (persisted)
  theme: 'dark' | 'light';
  setTheme: (t: 'dark' | 'light') => void;

  // Study Mode Config (persisted)
  studyDefaultMinutes: number;
  setStudyDefaultMinutes: (v: number) => void;
  studyFocusTracker: boolean;
  setStudyFocusTracker: (v: boolean) => void;
  studyFocusSensitivity: number;
  setStudyFocusSensitivity: (v: number) => void;
  // v25: Vision mode picker — user picks BEFORE session starts.
  //   'ringan'  = pixel path only, no ML download (default — safe for low-end devices)
  //   'stabil'  = FaceMesh WITHOUT iris refinement (~30MB RAM, no gaze-down detection)
  //   'akurat'  = FaceMesh + iris refinement (~50MB RAM, detects eye gaze to phone)
  studyFocusVisionMode: 'ringan' | 'stabil' | 'akurat';
  setStudyFocusVisionMode: (v: 'ringan' | 'stabil' | 'akurat') => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // Auth
      user: null,
      setUser: (user) => set({ user }),

      // API Keys
      apiKeys: { groq: '', deepgram: '', gemini: '', cloudflare: '', cloudflareAccountId: '' },
      setApiKeys: (keys) => set((s) => ({ apiKeys: { ...s.apiKeys, ...keys } })),

      // STT
      sttStatus: 'idle',
      setSttStatus: (sttStatus) => set({ sttStatus }),
      sttSource: 'webspeech',
      setSttSource: (sttSource) => set({ sttSource }),
      sttAudioMode: 'mic' as STTAudioMode,
      setSttAudioMode: (sttAudioMode) => set({ sttAudioMode }),
      transcript: '',
      transcriptEntries: [] as { time: string; text: string }[],
      setTranscript: (transcript) => set({ transcript, transcriptEntries: [] }),
      // v18.3 (2026-10-29): setTranscriptBatch — REPLACE both transcript + transcriptEntries.
      // Same as appendTranscriptBatch but RESETS first (clears existing entries before adding new).
      // Used by YouTube/DocumentUpload callbacks so new content fully replaces old
      // (was the root cause of "tetap warga CPL" bug — old entries persisted across uploads).
      setTranscriptBatch: (texts: string[]) => set(() => {
        const time = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const newEntries = texts
          .filter(t => t && t.trim())
          .map(text => ({ time, text: text.trim() }));
        const newTranscript = newEntries.map(e => e.text).join(' ');
        return { transcript: newTranscript, transcriptEntries: newEntries };
      }),
      appendTranscript: (text) => set((s) => {
        if (!text || !text.trim()) return s;
        const time = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const entry = { time, text };
        const newEntries = [...s.transcriptEntries, entry];
        const newTranscript = newEntries.map(e => e.text).join(' ');
        return { transcript: newTranscript, transcriptEntries: newEntries };
      }),
      // NEW: Batch append - accept array of strings, atomic update (no race condition)
      appendTranscriptBatch: (texts: string[]) => set((s) => {
        const time = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const newEntries = texts
          .filter(t => t && t.trim())
          .map(text => ({ time, text: text.trim() }));
        if (newEntries.length === 0) return s;
        const allEntries = [...s.transcriptEntries, ...newEntries];
        const newTranscript = allEntries.map(e => e.text).join(' ');
        return { transcript: newTranscript, transcriptEntries: allEntries };
      }),
      interimTranscript: '',
      setInterimTranscript: (interimTranscript) => set({ interimTranscript }),
      sttError: '',
      setSttError: (sttError) => set({ sttError }),
      isReconnecting: false,
      setIsReconnecting: (isReconnecting) => set({ isReconnecting }),
      replaceEntriesFrom: (fromIdx, newEntries) => set((s) => {
        const before = s.transcriptEntries.slice(0, fromIdx);
        const merged = [...before, ...newEntries];
        const newTranscript = merged.map(e => e.text).join(' ');
        return { transcript: newTranscript, transcriptEntries: merged };
      }),

      // AI Chat
      aiMessages: [],
      addAiMessage: (msg) => set((s) => ({
        aiMessages: [...s.aiMessages, { ...msg, id: crypto.randomUUID(), timestamp: Date.now() }],
      })),
      clearAiMessages: () => set({ aiMessages: [] }),
      selectedModel: 'vy/gemini-3.6-flash',
      setSelectedModel: (selectedModel) => set({ selectedModel }),
      isAiLoading: false,
      setIsAiLoading: (isAiLoading) => set({ isAiLoading }),
      scrapeMode: false,
      setScrapeMode: (scrapeMode) => set({ scrapeMode }),

      // Stats
      userStats: null,
      setUserStats: (userStats) => set({ userStats }),
      showCertificate: false,
      setShowCertificate: (showCertificate) => set({ showCertificate }),

      // Materials
      uploadedMaterials: [],
      addMaterial: (m) => set((s) => ({ uploadedMaterials: [...s.uploadedMaterials, m] })),
      removeMaterial: (id) => set((s) => ({ uploadedMaterials: s.uploadedMaterials.filter(m => m.id !== id) })),
      clearMaterials: () => set({ uploadedMaterials: [] }),

      // UI
      settingsOpen: false,
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
      activeTab: 'stt' as TabId,
      setActiveTab: (activeTab) => set({ activeTab }),
      studyModeEnabled: true,
      setStudyModeEnabled: (v) => set({ studyModeEnabled: v }),
      studyModeOpen: false,
      setStudyModeOpen: (v) => set({ studyModeOpen: v }),

      // Mode Selector (legacy defaults)
      selectedMode: null,
      setSelectedMode: (selectedMode) => set({ selectedMode }),
      generatedContent: '',
      setGeneratedContent: (generatedContent) => set({ generatedContent }),
      isGenerating: false,
      setIsGenerating: (isGenerating) => set({ isGenerating }),

      // Voice Command
      voiceCmdActive: false,
      setVoiceCmdActive: (voiceCmdActive) => set({ voiceCmdActive }),

      // Theme (persisted) - default dark to match existing dark-first design
      theme: 'dark' as 'dark' | 'light',
      setTheme: (theme) => set({ theme }),

      // Study Mode Config (persisted)
      studyDefaultMinutes: 25,
      setStudyDefaultMinutes: (studyDefaultMinutes) => set({ studyDefaultMinutes }),
      studyFocusTracker: true,
      setStudyFocusTracker: (studyFocusTracker) => set({ studyFocusTracker }),
      studyFocusSensitivity: 0.5,
      setStudyFocusSensitivity: (studyFocusSensitivity) => set({ studyFocusSensitivity }),
      // v25: default 'ringan' — pixel path is lightest, no model download.
      // User picks 'stabil' or 'akurat' explicitly when device can handle ML.
      studyFocusVisionMode: 'ringan' as 'ringan' | 'stabil' | 'akurat',
      setStudyFocusVisionMode: (studyFocusVisionMode) => set({ studyFocusVisionMode }),
    }),
    {
      name: 'lina-learning-v2',
      // v2 (2026-10-29): bump to invalidate persisted state containing stale
      // "Halo warga CPL" transcript that survived reloads because of the
      // appendTranscriptBatch bug in YouTubeTranscript handler.
      version: 2,
      partialize: (state) => ({
        apiKeys: state.apiKeys,
        selectedModel: state.selectedModel,
        // v18.1: do NOT persist transcript/transcriptEntries. They leak across
        // sessions and stale content (e.g. old YouTube transcript) keeps showing
        // up even after user uploads new material. Each session starts clean.
        uploadedMaterials: state.uploadedMaterials,
        theme: state.theme,
        user: state.user ? {
          id: String(state.user.id || ''),
          email: String(state.user.email || ''),
          name: String(state.user.name || 'Player'),
          image: typeof state.user.image === 'string' ? state.user.image : null,
        } : null,
        // v24/v25: persist study config so user's toggle choice survives reloads
        studyDefaultMinutes: state.studyDefaultMinutes,
        studyFocusTracker: state.studyFocusTracker,
        studyFocusSensitivity: state.studyFocusSensitivity,
        studyFocusVisionMode: state.studyFocusVisionMode,
      }),
    }
  )
);