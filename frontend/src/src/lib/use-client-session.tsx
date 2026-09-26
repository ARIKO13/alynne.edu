import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';

export interface SessionUser {
  id?: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

export interface ClientSession {
  user: SessionUser;
  expires: string;
}

interface SessionContextType {
  data: ClientSession | null;
  status: 'loading' | 'authenticated' | 'unauthenticated';
  update: () => Promise<ClientSession | null>;
}

const SessionContext = createContext<SessionContextType>({
  data: null,
  status: 'loading',
  update: async () => null,
});

export function ClientSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<ClientSession | null>(null);
  const [status, setStatus] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading');

  const fetchSession = useCallback(async (): Promise<ClientSession | null> => {
    try {
      const res = await fetch('/api/auth/session');
      if (res.ok) {
        const raw = await res.json();
        if (raw && typeof raw === 'object' && raw.user && Object.keys(raw.user).length > 0) {
          const safe: ClientSession = {
            user: {
              id: typeof raw.user.id === 'string' ? raw.user.id : undefined,
              name: typeof raw.user.name === 'string' ? raw.user.name : null,
              email: typeof raw.user.email === 'string' ? raw.user.email : null,
              image: typeof raw.user.image === 'string' ? raw.user.image : null,
            },
            expires: typeof raw.expires === 'string' ? raw.expires : '',
          };
          setSession(safe);
          setStatus('authenticated');
          return safe;
        }
      }
      setSession(null);
      setStatus('unauthenticated');
      return null;
    } catch {
      setSession(null);
      setStatus('unauthenticated');
      return null;
    }
  }, []);

  useEffect(() => {
    fetchSession();
    const interval = setInterval(fetchSession, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchSession]);

  return (
    <SessionContext.Provider value={{ data: session, status, update: fetchSession }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useClientSession() {
  return useContext(SessionContext);
}
