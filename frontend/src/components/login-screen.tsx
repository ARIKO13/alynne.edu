import { useState, useEffect } from 'react';
import { Loader2, ArrowLeft } from 'lucide-react';
import { useClientSession } from '@/lib/use-client-session';
import { toast } from 'sonner';

const ALYNNE_DOMAINS = ['alynne.my.id', 'www.alynne.my.id'];
function isAlynneDomain(): boolean {
  if (typeof window === 'undefined') return false;
  return ALYNNE_DOMAINS.includes(window.location.hostname);
}

const GOOGLE_OAUTH_ENABLED = true;
const handleGoogleLogin = () => { window.location.href = '/api/auth/google'; };

export function LoginScreen() {
  const { status } = useClientSession();
  const isAlynne = isAlynneDomain();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const handleBack = () => {
    sessionStorage.removeItem('alynne-entered');
    window.location.reload();
  };

  const handleDemoLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) { toast.error('Nama dan email wajib diisi'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast.error('Format email tidak valid'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/demo-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Gagal login'); return; }
      window.location.reload();
    } catch { toast.error('Gagal login.'); }
    finally { setLoading(false); }
  };

  if (status === 'loading') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0D0C0A' }}>
        <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--accent-soft)' }} />
      </div>
    );
  }

  const inputBase = {
    width: '100%',
    background: 'transparent',
    border: 'none',
    borderBottom: '1px solid #2B2723',
    borderRadius: 0,
    padding: '8px 0',
    fontSize: '14px',
    color: '#F5F2ED',
    outline: 'none',
    transition: 'border-color 0.15s ease',
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: '#0D0C0A' }}>
      {/* Left, solid color, no grid, no glow, no gradient */}
      <div
        className="hidden lg:flex"
        style={{
          flex: 1,
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '48px',
          background: '#0D0C0A',
          borderRight: '1px solid #25221E',
        }}
      >
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '28px', height: '28px', background: 'var(--accent)', borderRadius: '6px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ color: '#FFF', fontWeight: 700, fontSize: '14px' }}>A</span>
          </div>
          <span style={{ color: '#F5F2ED', fontSize: '15px', fontWeight: 600, letterSpacing: '-0.02em' }}>
            Alynne
          </span>
        </div>

        {/* One headline. No fluff. */}
        <div style={{ opacity: mounted ? 1 : 0, transition: 'opacity 0.3s ease' }}>
          <h1 style={{
            color: '#F5F2ED', fontSize: '28px', fontWeight: 600,
            letterSpacing: '-0.04em', lineHeight: 1.15, margin: 0,
          }}>
            Video jadi materi.<br />
            {/* avoid-ai-design-ignore: SD5 — satu aksen pada baris kedua adalah
                signature login screen yang jadi referensi DESIGN.md §1. */}
            <span style={{ color: 'var(--accent-soft)' }}>Satu klik.</span>
          </h1>
        </div>

        {/* Minimal footer */}
        <p style={{ color: '#44403C', fontSize: '12px', margin: 0 }}>alynne.my.id</p>
      </div>

      {/* Right, form */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', padding: '32px', position: 'relative',
      }}>
        {isAlynne && (
          <button
            onClick={handleBack}
            style={{
              position: 'absolute', top: '24px', left: '24px',
              display: 'flex', alignItems: 'center', gap: '6px',
              color: '#57534E', fontSize: '13px', background: 'none',
              border: 'none', cursor: 'pointer', transition: 'color 0.15s ease',
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = '#ABA49A'}
            onMouseLeave={(e) => e.currentTarget.style.color = '#57534E'}
          >
            <ArrowLeft style={{ width: '14px', height: '14px' }} />
            Kembali
          </button>
        )}

        <div style={{ width: '100%', maxWidth: '280px' }}>
          {/* Mobile logo */}
          <div className="lg:hidden" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '40px' }}>
            <div style={{
              width: '28px', height: '28px', background: 'var(--accent)', borderRadius: '6px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ color: '#FFF', fontWeight: 700, fontSize: '14px' }}>A</span>
            </div>
            <span style={{ color: '#F5F2ED', fontSize: '15px', fontWeight: 600 }}>Alynne</span>
          </div>

          <h2 style={{
            color: '#F5F2ED', fontSize: '18px', fontWeight: 600,
            letterSpacing: '-0.03em', margin: '0 0 24px 0',
            opacity: mounted ? 1 : 0, transition: 'opacity 0.3s ease 0.1s',
          }}>
            Masuk
          </h2>

          <form onSubmit={handleDemoLogin} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#78716C', marginBottom: '6px' }}>
                Nama
              </label>
              <input
                type="text" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Nama" disabled={loading} autoComplete="name"
                style={inputBase}
                onFocus={(e) => e.currentTarget.style.borderBottomColor = '#7FC4B8'}
                onBlur={(e) => e.currentTarget.style.borderBottomColor = '#2B2723'}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#78716C', marginBottom: '6px' }}>
                Email
              </label>
              <input
                type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="email@kamu.com" disabled={loading} autoComplete="email"
                style={inputBase}
                onFocus={(e) => e.currentTarget.style.borderBottomColor = '#7FC4B8'}
                onBlur={(e) => e.currentTarget.style.borderBottomColor = '#2B2723'}
              />
            </div>
            <button
              type="submit" disabled={loading || !name.trim() || !email.trim()}
              style={{
                width: '100%', padding: '10px 0', fontSize: '13px', fontWeight: 500,
                background: 'var(--accent)', color: '#FFF', border: 'none', borderRadius: '6px',
                cursor: 'pointer',
                opacity: (loading || !name.trim() || !email.trim()) ? 0.4 : 1,
                transition: 'background 0.15s ease, opacity 0.15s ease',
              }}
              onMouseEnter={(e) => !loading && (e.currentTarget.style.background = '#115E59')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '#7FC4B8')}
            >
              {loading ? <Loader2 className="animate-spin" style={{ width: '16px', height: '16px', margin: '0 auto' }} /> : 'Masuk'}
            </button>
          </form>

          {GOOGLE_OAUTH_ENABLED && (
            <button
              onClick={handleGoogleLogin}
              style={{
                width: '100%', padding: '10px 0', fontSize: '13px', fontWeight: 500,
                background: 'transparent', color: '#ABA49A', border: '1px solid #2B2723',
                borderRadius: '6px', cursor: 'pointer', marginTop: '12px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                transition: 'border-color 0.15s ease, color 0.15s ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#44403C'; e.currentTarget.style.color = '#F5F2ED'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#2B2723'; e.currentTarget.style.color = '#ABA49A'; }}
            >
              <svg style={{ width: '16px', height: '16px' }} viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              Google
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
