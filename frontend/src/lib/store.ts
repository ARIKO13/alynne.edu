import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
  activeTab: 'stt' | 'modul' | 'mindmap' | 'sharpen' | 'admin';
  setActiveTab: (tab: AppState['activeTab']) => void;
  studyModeEnabled: boolean;
  setStudyModeEnabled: (v: boolean) => void;
  studyModeOpen: boolean;
  setStudyModeOpen: (v: boolean) => void;

  // Study Mode Config (persisted)
  studyDefaultMinutes: number;
  setStudyDefaultMinutes: (v: number) => void;
  studyFocusTracker: boolean;
  setStudyFocusTracker: (v: boolean) => void;
  studyFocusSensitivity: number;
  setStudyFocusSensitivity: (v: number) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // Auth
      user: null,
      setUser: (user) => set({ user }),

      // API Keys
      apiKeys: { groq: '', gemini: '', cloudflare: '', cloudflareAccountId: '' },
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
      appendTranscript: (text) => set((s) => {
        if (!text || !text.trim()) return s;
        const time = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const entry = { time, text };
        const newEntries = [...s.transcriptEntries, entry];
        const newTranscript = newEntries.map(e => e.text).join(' ');
        return { transcript: newTranscript, transcriptEntries: newEntries };
      }),
      // NEW: Batch append — accept array of strings, atomic update (no race condition)
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
      activeTab: 'stt' as const,
      setActiveTab: (activeTab) => set({ activeTab }),
      studyModeEnabled: true,
      setStudyModeEnabled: (v) => set({ studyModeEnabled: v }),
      studyModeOpen: false,
      setStudyModeOpen: (v) => set({ studyModeOpen: v }),

      // Study Mode Config
      studyDefaultMinutes: 25,
      setStudyDefaultMinutes: (v) => set({ studyDefaultMinutes: v }),
      studyFocusTracker: false,
      setStudyFocusTracker: (v) => set({ studyFocusTracker: v }),
      studyFocusSensitivity: 35,
      setStudyFocusSensitivity: (v) => set({ studyFocusSensitivity: v }),
    }),
    {
      name: 'lina-learning-v2',
      version: 1,
      partialize: (state) => ({
        apiKeys: state.apiKeys,
        selectedModel: state.selectedModel,
        transcript: state.transcript,
        transcriptEntries: state.transcriptEntries,
        uploadedMaterials: state.uploadedMaterials,
        user: state.user ? {
          id: String(state.user.id || ''),
          email: String(state.user.email || ''),
          name: String(state.user.name || 'Player'),
          image: typeof state.user.image === 'string' ? state.user.image : null,
        } : null,
        studyDefaultMinutes: state.studyDefaultMinutes,
        studyFocusTracker: state.studyFocusTracker,
        studyFocusSensitivity: state.studyFocusSensitivity,
        studyModeEnabled: state.studyModeEnabled,
      }),
    }
  )
);