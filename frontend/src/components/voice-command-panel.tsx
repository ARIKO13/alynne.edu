import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import {
  Mic, MicOff, Command, CheckCircle2, XCircle,
  Compass, Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface CommandLog {
  id: string;
  text: string;
  action: string;
  success: boolean;
  timestamp: number;
}

interface VoiceCommand {
  keywords: string[];
  action: () => void;
  label: string;
  description: string;
}

export function VoiceCommandPanel() {
  const { setActiveTab, setSettingsOpen, user, voiceCmdActive, setVoiceCmdActive } = useAppStore();
  const [logs, setLogs] = useState<CommandLog[]>([]);
  const [lastRecognized, setLastRecognized] = useState('');
  const [interimText, setInterimText] = useState('');
  const [supported, setSupported] = useState(true);
  const recognitionRef = useRef<any>(null);

  const executeAction = useCallback((label: string, success: boolean, fn: () => void) => {
    fn();
    setLogs(prev => [{
      id: crypto.randomUUID(), text: lastRecognized || label,
      action: label, success, timestamp: Date.now(),
    }, ...prev].slice(0, 50));
  }, [lastRecognized]);

  const getCommands = useCallback((): VoiceCommand[] => {
    const userIsAdmin = ['ardilanpro@gmail.com', 'arshikocode@gmail.com', 'moonahoshinova@gmail.com'].includes(user?.email || '');
    const cmds: VoiceCommand[] = [
      { keywords: ['stt', 'speech to text', 'speech', 'transkrip', 'rekam suara', 'rekam'],
        action: () => setActiveTab('stt'), label: 'Buka Speech to Text', description: 'Navigasi ke fitur STT' },
      { keywords: ['modul', 'pdf', 'materi', 'bahan'],
        action: () => setActiveTab('modul'), label: 'Buka Modul PDF', description: 'Navigasi ke fitur Modul' },
      { keywords: ['mind map', 'mindmap', 'peta konsep', 'peta'],
        action: () => setActiveTab('mindmap'), label: 'Buka Mind Map', description: 'Navigasi ke fitur Mind Map' },
      { keywords: ['setting', 'pengaturan', 'setelan', 'konfigurasi'],
        action: () => setSettingsOpen(true), label: 'Buka Settings', description: 'Buka dialog pengaturan' },
    ];
    if (userIsAdmin) {
      cmds.push({ keywords: ['admin', 'administrator', 'panel admin'],
        action: () => setActiveTab('admin'), label: 'Buka Admin Panel', description: 'Navigasi ke Admin Panel' });
    }
    return cmds;
  }, [setActiveTab, setSettingsOpen, user?.email]);

  const matchCommand = useCallback((text: string): VoiceCommand | null => {
    const lower = text.toLowerCase().trim();
    const commands = getCommands();
    for (const cmd of commands) {
      for (const kw of cmd.keywords) {
        if (lower.includes(kw)) {
          const navPrefixes = ['buka ', 'buka ke ', 'pergi ke ', 'pindah ke ', 'pergi ', 'pindah ', 'tampilan ', 'masuk ', 'go to ', 'open ', 'navigate '];
          const hasNavPrefix = navPrefixes.some(p => lower.startsWith(p));
          if (lower === kw || lower.startsWith(kw + ' ') || hasNavPrefix) return cmd;
        }
      }
    }
    if (lower.split(' ').length <= 4) {
      for (const cmd of commands) {
        for (const kw of cmd.keywords) {
          if (lower.includes(kw)) return cmd;
        }
      }
    }
    return null;
  }, [getCommands]);

  const startListening = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { setSupported(false); toast.error('Browser tidak mendukung Speech Recognition'); return; }

    const recognition = new SpeechRecognition();
    recognition.lang = 'id-ID';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event: any) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) final += transcript + ' ';
        else interim += transcript;
      }
      if (interim) setInterimText(interim);
      if (final.trim()) {
        setLastRecognized(final.trim());
        setInterimText('');
        const cmd = matchCommand(final);
        if (cmd) {
          executeAction(cmd.label, true, cmd.action);
          toast.success(cmd.label, { description: `"${final.trim()}"` });
        } else {
          executeAction('Tidak dikenali', false, () => {});
          toast.error('Perintah tidak dikenali', { description: final.trim() });
        }
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        console.error('Speech recognition error:', event.error);
        if (event.error === 'not-allowed') { toast.error('Akses mikrofon ditolak'); setVoiceCmdActive(false); }
      }
    };

    recognition.onend = () => {
      if (useAppStore.getState().voiceCmdActive) {
        try { recognition.start(); } catch {}
      }
    };

    recognitionRef.current = recognition;
    try { recognition.start(); } catch (e) { toast.error('Gagal memulai speech recognition'); }
  }, [matchCommand, executeAction, setVoiceCmdActive]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) { recognitionRef.current.stop(); recognitionRef.current = null; }
    setInterimText('');
  }, []);

  // Sync with store's voiceCmdActive
  useEffect(() => {
    if (voiceCmdActive) startListening();
    else stopListening();
  }, [voiceCmdActive, startListening, stopListening]);

  // Cleanup
  useEffect(() => { return () => stopListening(); }, [stopListening]);

  const commands = getCommands();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-white">Voice Command</h2>
        <p className="text-xs text-zinc-500 mt-0.5">Navigasi platform menggunakan perintah suara</p>
      </div>

      {/* Mic Button */}
      <div className="glass-card p-8 text-center">
        {!supported ? (
          <>
            <XCircle className="h-12 w-12 text-red-400/50 mx-auto mb-3" />
            <p className="text-sm text-zinc-400">Browser tidak mendukung Speech Recognition</p>
            <p className="text-xs text-zinc-600 mt-1">Gunakan Chrome atau Edge</p>
          </>
        ) : (
          <>
            <button
              onClick={() => setVoiceCmdActive(!voiceCmdActive)}
              className={cn(
                'relative mx-auto w-24 h-24 rounded-full flex items-center justify-center transition-colors duration-300',
                voiceCmdActive
                  ? 'bg-red-500/20 border-2 border-red-500/40 animate-pulse'
                  : 'bg-[#38BDF8]/10 border-2 border-[#38BDF8]/30 hover:bg-[#38BDF8]/20 hover:border-[#38BDF8]/50'
              )}
            >
              {voiceCmdActive && <span className="absolute inset-0 rounded-full animate-ping bg-red-500/10" />}
              {voiceCmdActive ? <MicOff className="h-8 w-8 text-red-400" /> : <Mic className="h-8 w-8 text-[#38BDF8]" />}
            </button>
            <p className="text-sm text-zinc-400 mt-4">{voiceCmdActive ? 'Mendengarkan perintah...' : 'Tekan untuk mulai'}</p>
            {interimText && (
              <div className="mt-3 px-4 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04] inline-block">
                <p className="text-sm text-zinc-500 italic">"{interimText}"</p>
              </div>
            )}
            {lastRecognized && !voiceCmdActive && (
              <div className="mt-3 flex items-center justify-center gap-2 text-xs text-zinc-500">
                <span>Terakhir:</span><span className="text-zinc-300">"{lastRecognized}"</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Available Commands */}
      <div className="glass-card-sm p-4">
        <h3 className="text-xs font-medium text-zinc-400 mb-3 flex items-center gap-2">
          <Command className="h-3.5 w-3.5" /> Perintah yang Tersedia
        </h3>
        <div className="space-y-1.5">
          {commands.map((cmd) => (
            <div key={cmd.label} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/[0.02] transition-colors">
              <Compass className="h-3.5 w-3.5 text-[#38BDF8] shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-zinc-300">{cmd.label}</p>
                <p className="text-[10px] text-zinc-600">{cmd.description}</p>
              </div>
              <div className="flex gap-1">
                {cmd.keywords.slice(0, 3).map(kw => (
                  <span key={kw} className="text-[9px] text-zinc-600 bg-white/[0.03] px-1.5 py-0.5 rounded">"{kw}"</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Command Log */}
      {logs.length > 0 && (
        <div className="glass-card-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-medium text-zinc-400 flex items-center gap-2">
              <Zap className="h-3.5 w-3.5" /> Riwayat Perintah
            </h3>
            <button onClick={() => setLogs([])} className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors">Hapus</button>
          </div>
          <div className="space-y-1.5 max-h-60 overflow-y-auto">
            {logs.map(log => (
              <div key={log.id} className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg">
                {log.success ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400/70 shrink-0" /> : <XCircle className="h-3.5 w-3.5 text-red-400/70 shrink-0" />}
                <div className="flex-1 min-w-0"><p className="text-[11px] text-zinc-400 truncate">"{log.text}"</p></div>
                <span className="text-[10px] text-zinc-600 shrink-0">{log.action}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
