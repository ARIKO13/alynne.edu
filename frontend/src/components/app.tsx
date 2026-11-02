import { useAppStore, type TabId } from '@/lib/store';
import { STTPanel } from '@/components/stt-panel';
import { AIAssistant } from '@/components/ai-assistant';
import { StudyPipeline } from '@/components/StudyPipeline';
import { KnowledgeHub } from '@/components/KnowledgeHub';
import { Scratchpad } from '@/components/Scratchpad';
import { WeeklyAnalytics } from '@/components/WeeklyAnalytics';
import { ReferralPanel } from '@/components/ReferralPanel';
import { FlashcardPanel } from '@/components/FlashcardPanel';
import { SettingsDialog } from '@/components/settings-dialog';
import { LoginScreen } from '@/components/login-screen';
import { AdminPanel } from '@/components/admin-panel';
import { Badge } from '@/components/ui/badge';
import { stopSttRecording } from '@/lib/stt-controller';
import {
  Mic, Bot, Settings, Wifi, Radio, LogOut, MicOff,
  Menu, X, Shield, Sparkles, FolderOpen, StickyNote, TrendingUp, Gift, FileText, Monitor, ArrowLeft, Network, Wand2, Layers,
  Sun, Moon,
} from 'lucide-react';
import { isAdmin } from '@/lib/admin';
import { cn } from '@/lib/utils';
import { useClientSession } from '@/lib/use-client-session';
import { registerShortcuts } from '@/lib/keyboard-shortcuts';
import { useEffect, useState, useRef, useMemo } from 'react';

const ALYNNE_DOMAINS = ['alynne.my.id', 'www.alynne.my.id'];
function isAlynneDomain(): boolean {
  if (typeof window === 'undefined') return false;
  return ALYNNE_DOMAINS.includes(window.location.hostname);
}

const TABS: { id: TabId; label: string; icon: typeof Mic; adminOnly?: boolean }[] = [
  { id: 'stt', label: 'Speech to Text', icon: Mic },
  { id: 'belajar', label: 'Mode Belajar', icon: Sparkles },
  { id: 'hub', label: 'Knowledge Hub', icon: FolderOpen },
  { id: 'notes', label: 'Scratchpad', icon: StickyNote },
  { id: 'stats', label: 'Analitik', icon: TrendingUp },
  { id: 'refer', label: 'Referral', icon: Gift },
  { id: 'flash', label: 'Flashcard', icon: Layers },
  { id: 'admin', label: 'Admin Panel', icon: Shield, adminOnly: true },
];

const TAB_TITLES: Record<TabId, string> = {
  stt: 'Speech to Text',
  modul: 'Modul PDF',
  mindmap: 'Mind Map',
  sharpen: 'Image Sharpener',
  'voice-cmd': 'Voice Command',
  belajar: 'Mode Belajar',
  hub: 'Knowledge Hub',
  notes: 'Scratchpad',
  stats: 'Analitik Belajar',
  refer: 'Referral',
  flash: 'Flashcard',
  admin: 'Admin Panel',
};

interface AppProps {
  onBackToLanding?: () => void;
}

export default function App({ onBackToLanding }: AppProps) {
  const { user, setUser, activeTab, setActiveTab, setSettingsOpen, sttSource, sttStatus, transcript, theme, setTheme } = useAppStore();
  const { data: session, status } = useClientSession();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isAlynne = isAlynneDomain();
  const userIsAdmin = useMemo(() => isAdmin(user?.email), [user?.email]);
  const visibleTabs = useMemo(() => TABS.filter(t => !t.adminOnly || userIsAdmin), [userIsAdmin]);

  const profileFetchedRef = useRef<string | null>(null);

  useEffect(() => {
    if (status !== 'authenticated' || !session?.user?.id) return;
    const sid = session.user.id;
    const semail = session.user.email || '';
    const sname = session.user.name || 'Player';
    const simage = session.user.image || null;

    if (profileFetchedRef.current === sid) return;
    profileFetchedRef.current = sid;

    fetch('/api/user/profile')
      .then(r => r.json())
      .then(data => {
        if (data.name && !data.error) {
          setUser({
            id: String(sid || ''),
            email: String(data.email || semail || ''),
            name: String(data.name || ''),
            image: typeof data.image === 'string' ? data.image : (typeof simage === 'string' ? simage : null),
          });
        }
      })
      .catch(() => {
        const existingUser = useAppStore.getState().user;
        if (!existingUser || existingUser.id !== sid) {
          setUser({
            id: String(sid || ''),
            email: String(semail || ''),
            name: String(sname || 'Player'),
            image: typeof simage === 'string' ? simage : null,
          });
        }
      });
  }, [status, setUser]);

  useEffect(() => {
    if (user && activeTab === 'admin' && !userIsAdmin) {
      setActiveTab('stt');
    }
  }, [activeTab, userIsAdmin, setActiveTab, user]);

  // v14-routing: Hash-based URL routing supaya tab state persist di URL.
  // URL jadi /edu#/stt, /edu#/belajar, /edu#/notes, dll.
  // Refresh halaman tetap di tab yang sama. Bookmark bisa langsung ke tab tujuan.
  // 1. On mount: read hash → set activeTab
  // 2. On activeTab change: update hash
  // 3. On hashchange event: update activeTab (untuk back/forward browser nav)
  const VALID_TAB_IDS = ['stt', 'modul', 'mindmap', 'sharpen', 'admin', 'voice-cmd', 'belajar', 'hub', 'notes', 'stats', 'refer', 'flash'];

  // Initial sync on mount  -  baca hash, set activeTab kalau valid
  useEffect(() => {
    const hash = window.location.hash.slice(1); // remove '#'
    if (hash && VALID_TAB_IDS.includes(hash)) {
      // Only set if different from current activeTab (avoid loop)
      if (hash !== useAppStore.getState().activeTab) {
        setActiveTab(hash as TabId);
      }
    }
  }, []); // run once on mount

  // Sync activeTab → URL hash (saat user klik tab, update URL)
  useEffect(() => {
    const expectedHash = `#${activeTab}`;
    if (window.location.hash !== expectedHash) {
      // Use replaceState untuk avoid polluted history (back button tetap ke page sebelumnya)
      window.history.replaceState(null, '', `/edu${expectedHash}`);
    }
  }, [activeTab]);

  // Listen hashchange (untuk back/forward navigation atau manual URL change)
  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash.slice(1);
      if (hash && VALID_TAB_IDS.includes(hash) && hash !== useAppStore.getState().activeTab) {
        setActiveTab(hash as TabId);
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [setActiveTab]);


  // Apply theme class to <html>  -  runs on mount + whenever theme changes.
  // Layout.astro has an inline script that pre-applies the class from
  // localStorage BEFORE React hydrates, so there's no flash of dark mode.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.classList.toggle('light', theme === 'light');
  }, [theme]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0D0C0A]">
        <div className="animate-spin h-8 w-8 border-2 border-stone-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!user) return <LoginScreen />;

  const handleLogout = () => {
    setUser(null);
    window.location.href = '/api/auth/logout';
  };

  const handleTabClick = (id: TabId) => {
    // Mode Belajar: redirect to STT if no transcript yet
    if (id === 'belajar') {
      const hasTranscript = useAppStore.getState().transcript?.trim()?.length > 20;
      if (!hasTranscript) {
        setActiveTab('stt');
        return;
      }
    }
    setActiveTab(id);
    setSidebarOpen(false);
  };

  return (
    <div className="min-h-screen flex bg-[#0D0C0A]">
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60  z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-[260px] bg-[#161412] border-r border-white/[0.06] flex flex-col transition-transform duration-200 ease-in-out lg:relative lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex items-center gap-3 px-5 h-14 border-b border-white/[0.06]">
          <span className="text-sm font-semibold tracking-tight text-white">ALYNNE AI</span>
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="ml-auto p-1.5 rounded-md hover:bg-white/[0.06] transition-colors text-stone-400 hover:text-stone-200"
            title={theme === 'dark' ? 'Ganti ke Mode Terang' : 'Ganti ke Mode Gelap'}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-1 rounded-md hover:bg-white/[0.06] transition-colors"
          >
            <X className="h-4 w-4 text-stone-400" />
          </button>
        </div>

        <nav className="flex-1 py-3 px-3 space-y-0.5">
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => handleTabClick(tab.id)}
                className={cn(
                  'w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors',
                  isActive
                    ? 'bg-white/[0.08] text-white'
                    : 'text-stone-500 hover:bg-white/[0.04] hover:text-stone-300'
                )}
              >
                <Icon className={cn('h-4 w-4', isActive ? 'text-[var(--accent-soft)]' : 'text-stone-600')} />
                {tab.label}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-white/[0.06] p-3 space-y-0.5">
          <button
            onClick={() => { setSettingsOpen(true); setSidebarOpen(false); }}
            className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-stone-500 hover:bg-white/[0.04] hover:text-stone-300 transition-colors"
          >
            <Settings className="h-4 w-4" />
            Pengaturan
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-stone-500 hover:bg-red-500/10 hover:text-red-400 transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Keluar
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 h-14 bg-[#0D0C0A]/80  border-b border-white/[0.06] flex items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-lg hover:bg-white/[0.06] transition-colors"
            >
              <Menu className="h-4 w-4 text-stone-400" />
            </button>
            <button
              onClick={() => window.location.href = '/about'}
              className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-[12px] font-medium text-stone-400 hover:text-white hover:bg-white/[0.06] border border-white/[0.06] hover:border-white/[0.12] transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Kembali</span>
            </button>
            <h1 className="text-sm font-medium text-stone-200">{TAB_TITLES[activeTab]}</h1>
            {sttStatus === 'recording' && (
              <Badge
                variant="outline"
                className={cn('gap-1.5 text-[11px] animate-pulse hidden sm:flex cursor-pointer',
                  sttSource === 'webspeech' ? 'border-red-500/30 text-red-400 bg-red-500/10'
                    : sttSource === 'screen-capture' ? 'border-stone-500/30 text-[var(--accent-soft)] bg-stone-500/10'
                    : 'border-amber-500/30 text-amber-400 bg-amber-500/10'
                )}
                onClick={() => { setActiveTab('stt'); setSidebarOpen(false); }}
                title="Klik untuk kembali ke tab STT"
              >
                {sttSource === 'webspeech' ? <Wifi className="h-3 w-3" /> : sttSource === 'screen-capture' ? <Monitor className="h-3 w-3" /> : <Radio className="h-3 w-3" />}
                {sttSource === 'webspeech' ? 'LIVE' : sttSource === 'screen-capture' ? 'SCREEN' : 'GROQ'}
              </Badge>
            )}
            {sttStatus === 'recording' && (
              <button
                onClick={() => stopSttRecording()}
                className="hidden sm:flex items-center gap-1.5 rounded-md bg-red-600 hover:bg-red-700 px-2 py-1 text-[11px] font-medium text-white transition-colors"
                title="Stop recording dari tab manapun"
              >
                <MicOff className="h-3 w-3" />
                Stop
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setSettingsOpen(true)}
              className="hidden md:flex p-2 rounded-lg hover:bg-white/[0.06] transition-colors"
            >
              <Settings className="h-4 w-4 text-stone-500" />
            </button>
            <div className="flex items-center gap-2.5">
              <div className="relative h-7 w-7">
                <div className="flex h-full w-full items-center justify-center rounded-full bg-[var(--accent)] text-white text-xs font-bold">
                  {String(user?.name || '?')[0]}
                </div>
                {user?.image && (
                  <img
                    src={user.image}
                    className="absolute inset-0 h-full w-full rounded-full ring-2 ring-white/10 object-cover"
                    alt={user.name || ''}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                )}
              </div>
              <div className="flex items-center gap-2 hidden sm:flex">
                <span className="text-sm text-stone-300">{String(user?.name || 'Player')}</span>
                {userIsAdmin && (
                  <Badge className="bg-stone-400/20 text-[var(--accent-soft)] border-stone-400/30 text-[9px] px-1.5 py-0">
                    Admin
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6">
          <div className="max-w-4xl mx-auto">
            {/*
              STTPanel stays MOUNTED across all tabs so that recording continues
              when the user switches to MindMap / Modul / Assistant / etc. The
              useSpeechRecognition hook's refs (recognition, mediaRecorder, etc.)
              only live as long as STTPanel is mounted. Hiding via CSS `hidden`
              keeps the hook alive while visually swapping to other panels.

              The only ways to stop recording:
                1. Click "Stop Recording" inside STTPanel
                2. Click the global "Stop" button in the header (any tab)
            */}
            <div className={cn(activeTab !== 'stt' && 'hidden')}>
              <STTPanel />
            </div>

            {activeTab === 'belajar' && transcript && (
              <StudyPipeline open={true} onClose={() => setActiveTab('stt')} transcript={transcript} />
            )}
            {activeTab === 'belajar' && !transcript && (
              <div className="flex items-center justify-center h-[calc(100vh-8rem)] text-stone-500 text-sm">
                Rekam audio dulu di Speech to Text, lalu buka Mode Belajar.
              </div>
            )}
            {activeTab === 'hub' && <KnowledgeHub open={true} onClose={() => setActiveTab('stt')} />}
            {activeTab === 'notes' && <Scratchpad open={true} onClose={() => setActiveTab('stt')} />}
            {activeTab === 'stats' && <WeeklyAnalytics open={true} onClose={() => setActiveTab('stt')} />}
            {activeTab === 'refer' && <ReferralPanel open={true} onClose={() => setActiveTab('stt')} />}
            {activeTab === 'flash' && <FlashcardPanel open={true} onClose={() => setActiveTab('stt')} chapters={[]} />}
            {activeTab === 'admin' && userIsAdmin && <AdminPanel />}
          </div>
        </main>
      </div>

      <SettingsDialog />
      
    </div>
  );
}
