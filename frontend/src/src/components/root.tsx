import { useState, useEffect } from 'react';
import { ClientSessionProvider } from '@/lib/use-client-session';
import App from '@/components/app';
import { Toaster } from '@/components/ui/sonner';
import { AppErrorBoundary } from '@/components/error-boundary';

export default function Root() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#09090b]">
        <div className="animate-spin h-8 w-8 border-2 border-[#8B5CF6] border-t-transparent rounded-full" />
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
