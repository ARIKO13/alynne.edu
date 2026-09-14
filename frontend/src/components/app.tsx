import { useAppStore } from '@/lib/store';
import { STTPanel } from '@/components/stt-panel';
import { AIAssistant } from '@/components/ai-assistant';
import { ModulPanel } from '@/components/modul-panel';
import { MindMapPanel } from '@/components/mindmap-panel';
import { ImageSharpener } from '@/components/image-sharpener';
import { SettingsDialog } from '@/components/settings-dialog';
import { LoginScreen } from '@/components/login-screen';
import { CertificateView } from '@/components/certificate-view';
import { AdminPanel } from '@/components/admin-panel';
import { Badge } from '@/components/ui/badge';
import {
  Mic, Bot, Settings, Wifi, Radio, LogOut,
  Menu, X, Shield, FileText, Monitor, ArrowLeft, Network, Wand2,
} from 'lucide-react';
import { isAdmin } from '@/lib/admin';
import { cn } from '@/lib/utils';
import { useClientSession } from '@/lib/use-client-session';
import { useEffect, useState, useRef, useMemo } from 'react';

const ALYNNE_DOMAINS = ['alynne.my.id', 'www.alynne.my.id'];
function isAlynneDomain(): boolean {
  if (typeof window === 'undefined') return false;
  return ALYNNE_DOMAINS.includes(window.location.hostname);
}

type TabId = 'stt' | 'mindmap' | 'assistant' | 'modul' | 'sharpen' | 'admin';

const TABS: { id: TabId; label: string; icon: typeof Mic; adminOnly?: boolean }[] = [
  { id: 'stt', label: 'Speech to Text', icon: Mic },
  { id: 'mindmap', label: 'Mind Map', icon: Network },
  { id: 'modul', label: 'Modul PDF', icon: FileText },
  { id: 'assistant', label: 'AI Assistant', icon: Bot },
  { id: 'sharpen', label: 'Penajam Gambar', icon: Wand2 },
  { id: 'admin', label: 'Admin Panel', icon: Shield, adminOnly: true },
];

const TAB_TITLES: Record<TabId, string> = {
  stt: 'Speech to Text',
  mindmap: 'Mind Map Generator',
  modul: 'Modul PDF',
  assistant: 'AI Assistant',
  sharpen: 'Penajam Gambar (CV)',
  admin: 'Admin Panel',
};

interface AppProps {
  onBackToLanding?: () => void;
}

export default function App({ onBackToLanding }: AppProps) {
  const { user, setUser, activeTab, setActiveTab, setSettingsOpen, sttSource, sttStatus } = useAppStore();
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

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#09090b]">
        <div className="animate-spin h-8 w-8 border-2 border-[#8B5CF6] border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!user) return <LoginScreen />;

  const handleLogout = () => {
    setUser(null);
    window.location.href = '/api/auth/logout';
  };

  const handleTabClick = (id: TabId) => {
    setActiveTab(id);
    setSidebarOpen(false);
  };

  return (
    <div className="min-h-screen flex bg-[#09090b]">
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-[260px] bg-[#0c0c0e] border-r border-white/[0.06] flex flex-col transition-transform duration-200 ease-in-out lg:relative lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex items-center gap-3 px-5 h-14 border-b border-white/[0.06]">
          <img src="/alynne-ai-logo.png" alt="ALYNNE" className="h-7 w-7 rounded-lg" />
          <span className="text-sm font-semibold tracking-tight text-white">ALYNNE AI</span>
          <button
            onClick={() => setSidebarOpen(false)}
            className="ml-auto lg:hidden p-1 rounded-md hover:bg-white/[0.06] transition-colors"
          >
            <X className="h-4 w-4 text-zinc-400" />
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
                  'w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-all',
                  isActive
                    ? 'bg-white/[0.08] text-white'
                    : 'text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300'
                )}
              >
                <Icon className={cn('h-4 w-4', isActive ? 'text-[#8B5CF6]' : 'text-zinc-600')} />
                {tab.label}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-white/[0.06] p-3 space-y-0.5">
          <button
            onClick={() => { setSettingsOpen(true); setSidebarOpen(false); }}
            className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300 transition-colors"
          >
            <Settings className="h-4 w-4" />
            Settings
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-zinc-500 hover:bg-red-500/10 hover:text-red-400 transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Logout
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 h-14 bg-[#09090b]/80 backdrop-blur-md border-b border-white/[0.06] flex items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-lg hover:bg-white/[0.06] transition-colors"
            >
              <Menu className="h-4 w-4 text-zinc-400" />
            </button>
            <button
              onClick={() => window.location.href = '/about'}
              className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-[12px] font-medium text-zinc-400 hover:text-white hover:bg-white/[0.06] border border-white/[0.06] hover:border-white/[0.12] transition-all"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back</span>
            </button>
            <h1 className="text-sm font-medium text-zinc-200">{TAB_TITLES[activeTab]}</h1>
            {sttStatus === 'recording' && activeTab === 'stt' && (
              <Badge variant="outline" className={cn('gap-1.5 text-[11px] animate-pulse hidden sm:flex',
                sttSource === 'webspeech' ? 'border-red-500/30 text-red-400 bg-red-500/10'
                  : sttSource === 'screen-capture' ? 'border-sky-500/30 text-sky-400 bg-sky-500/10'
                  : 'border-amber-500/30 text-amber-400 bg-amber-500/10'
              )}>
                {sttSource === 'webspeech' ? <Wifi className="h-3 w-3" /> : sttSource === 'screen-capture' ? <Monitor className="h-3 w-3" /> : <Radio className="h-3 w-3" />}
                {sttSource === 'webspeech' ? 'LIVE' : sttSource === 'screen-capture' ? 'SCREEN' : 'GROQ'}
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setSettingsOpen(true)}
              className="hidden md:flex p-2 rounded-lg hover:bg-white/[0.06] transition-colors"
            >
              <Settings className="h-4 w-4 text-zinc-500" />
            </button>
            <div className="flex items-center gap-2.5">
              <div className="relative h-7 w-7">
                <div className="flex h-full w-full items-center justify-center rounded-full bg-[#8B5CF6] text-white text-xs font-bold">
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
                <span className="text-sm text-zinc-300">{String(user?.name || 'Player')}</span>
                {userIsAdmin && (
                  <Badge className="bg-[#8B5CF6]/20 text-[#8B5CF6] border-[#8B5CF6]/30 text-[9px] px-1.5 py-0">
                    Admin
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6">
          <div className="max-w-4xl mx-auto">
            {activeTab === 'stt' && <STTPanel />}
            {activeTab === 'mindmap' && <MindMapPanel />}
            {activeTab === 'modul' && <ModulPanel />}
            {activeTab === 'sharpen' && <ImageSharpener />}

            {activeTab === 'assistant' && (
              <div className="h-[calc(100vh-8rem)]"><AIAssistant /></div>
            )}
            {activeTab === 'admin' && userIsAdmin && <AdminPanel />}
          </div>
        </main>
      </div>

      <SettingsDialog />
      <CertificateView />
    </div>
  );
}
