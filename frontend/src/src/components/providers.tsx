import { ClientSessionProvider } from '@/lib/use-client-session';

export function Providers({ children }: { children: React.ReactNode }) {
  return <ClientSessionProvider>{children}</ClientSessionProvider>;
}
