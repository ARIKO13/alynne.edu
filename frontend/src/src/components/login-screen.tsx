import { Button } from '@/components/ui/button';
import { Loader2, ArrowLeft } from 'lucide-react';
import { useClientSession } from '@/lib/use-client-session';
import { toast } from 'sonner';

const ALYNNE_DOMAINS = ['alynne.my.id', 'www.alynne.my.id'];
function isAlynneDomain(): boolean {
  if (typeof window === 'undefined') return false;
  return ALYNNE_DOMAINS.includes(window.location.hostname);
}

const handleGoogleLogin = () => { window.location.href = '/api/auth/google'; };

export function LoginScreen() {
  const { status } = useClientSession();
  const isAlynne = isAlynneDomain();

  const handleBack = () => {
    sessionStorage.removeItem('alynne-entered');
    window.location.reload();
  };

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#09090b]">
        <Loader2 className="h-8 w-8 animate-spin text-[#8B5CF6]" />
        <p className="mt-3 text-sm text-zinc-500">Mengecek session...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#09090b] p-4 relative">
      {/* Back to landing */}
      {isAlynne && (
        <button
          onClick={handleBack}
          className="absolute top-6 left-6 flex items-center gap-2 text-zinc-500 hover:text-zinc-300 transition-colors text-sm"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back</span>
        </button>
      )}

      <div className="w-full max-w-sm space-y-8">
        {/* Logo & Branding */}
        <div className="text-center space-y-4">
          <div className="flex justify-center">
            <img src="/logo.png" alt="ALYNNE" className="h-16 w-16 rounded-2xl ring-2 ring-white/10" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-2xl font-bold tracking-tight text-white">
              ALYNNE AI
            </h1>
            <p className="text-sm text-zinc-500">Belajar Sambil Main, Raih Sertifikat!</p>
          </div>
        </div>

        {/* Google OAuth Button */}
        <div className="space-y-3">
          <Button
            onClick={handleGoogleLogin}
            className="w-full h-11 rounded-lg bg-white text-zinc-900 font-medium text-sm gap-3 hover:bg-zinc-200 transition-colors"
            size="lg"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            Masuk dengan Google
          </Button>
          <p className="text-[11px] text-center text-zinc-600">
            Login via Google OAuth. Data kamu aman & tersimpan.
          </p>
        </div>
      </div>
    </div>
  );
}
