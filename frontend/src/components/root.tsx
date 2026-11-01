import { useState, useEffect } from 'react';
import { ClientSessionProvider } from '@/lib/use-client-session';
import App from '@/components/app';
import { Toaster } from '@/components/ui/sonner';
import { AppErrorBoundary } from '@/components/error-boundary';

// v17-auto: Auto version check. Tiap deploy baru, version string berubah.
// Browser bandingkan version di localStorage dengan version di code.
// Kalau beda → auto-clear old cache entries + reload. User gak perlu manual clear.
const APP_VERSION = 'v18-nvidia-2026-10-28';

export default function Root() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Auto version check  -  runs BEFORE React renders App
    try {
      const storedVersion = localStorage.getItem('alynne:app-version');
      if (storedVersion && storedVersion !== APP_VERSION) {
        // New version detected! Clear ALL alynne cache entries (chunked-*, modul:*)
        const keysToDelete = Object.keys(localStorage).filter(k =>
          k.startsWith('alynne:chunked-') || k.startsWith('alynne:modul:')
        );
        keysToDelete.forEach(k => localStorage.removeItem(k));
        localStorage.setItem('alynne:app-version', APP_VERSION);
        console.log(`[auto-update] Version ${storedVersion} → ${APP_VERSION}. Cleared ${keysToDelete.length} cache entries. Reloading...`);
        location.reload();
        return; // Don't render  -  page will reload
      } else if (!storedVersion) {
        // First visit  -  just store version
        localStorage.setItem('alynne:app-version', APP_VERSION);
      }
    } catch (e) {
      console.warn('[auto-update] Version check failed:', e);
    }

    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0D0C0A]">
        <div className="animate-spin h-8 w-8 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <>
      <ClientSessionProvider>
        <AppErrorBoundary>
          <App />
          <Toaster />
        </AppErrorBoundary>
      </ClientSessionProvider>
    </>
  );
}
