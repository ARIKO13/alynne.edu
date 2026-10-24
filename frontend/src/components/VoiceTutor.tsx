/**
 * VoiceTutor.tsx — AI Voice Tutor: conversation with AI via voice
 *
 * User speaks → STT → AI responds → TTS reads response
 * Like having a real tutor conversation, hands-free
 *
 * Uses:
 * - Web Speech API (SpeechRecognition) for STT
 * - Web Speech API (SpeechSynthesis) for TTS
 * - Groq API for AI responses
 * - All context from current chapter
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Loader2,
  Bot,
  User,
  Phone,
  PhoneOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { speak, stop as ttsStop } from '@/lib/text-to-speech';
import type { Chapter } from '@/lib/stt-chapter-splitter';

interface VoiceTutorProps {
  chapter: Chapter;
  transcript: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export function VoiceTutor({ chapter, transcript }: VoiceTutorProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: `Halo! Aku tutor AI kamu. Kita akan bahas Bab ${chapter.id}: ${chapter.title}. Kamu bisa tanya apa aja, atau minta aku jelasin. Klik tombol mic untuk mulai ngomong!`,
      timestamp: Date.now(),
    },
  ]);
  const [isListening, setIsListening] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [inCall, setInCall] = useState(false);

  const recognitionRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<Message[]>(messages);
  messagesRef.current = messages;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Initialize SpeechRecognition
  const getRecognition = useCallback(() => {
    if (typeof window === 'undefined') return null;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return null;
    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'id-ID';
    return recognition;
  }, []);

  const startListening = useCallback(() => {
    const recognition = getRecognition();
    if (!recognition) {
      toast.error('Browser ga support voice recognition. Coba Chrome.');
      return;
    }

    // Stop TTS if speaking
    if (isSpeaking) {
      ttsStop();
      setIsSpeaking(false);
    }

    recognition.onresult = async (event: any) => {
      const transcript_text = event.results[0][0].transcript;
      setIsListening(false);
      await handleUserMessage(transcript_text);
    };

    recognition.onerror = (event: any) => {
      console.error('[VoiceTutor] Recognition error:', event.error);
      setIsListening(false);
      if (event.error !== 'no-speech') {
        toast.error('Error: ' + event.error);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.start();
    setIsListening(true);
  }, [getRecognition, isSpeaking]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setIsListening(false);
  }, []);

  const handleUserMessage = useCallback(async (text: string) => {
    if (!text.trim()) return;

    const userMsg: Message = { role: 'user', content: text, timestamp: Date.now() };
    const newMessages = [...messagesRef.current, userMsg];
    setMessages(newMessages);
    setIsThinking(true);

    try {
      const systemPrompt = `Kamu adalah tutor AI yang asik dan sabar. User sedang belajar Bab ${chapter.id}: ${chapter.title}. Jawab pertanyaan dengan singkat (2-4 kalimat), bahasa santai, pake analogi yang relate ke kehidupan sehari-hari. Jangan bertele-tele. Kalau user salah, koreksi dengan cara yang ga bikin minder.

MATERI BAB ${chapter.id}:
${chapter.content}

TRANSCRIPT: ${transcript.substring(0, 1000)}`;

      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: systemPrompt },
            ...newMessages.map(m => ({ role: m.role, content: m.content })),
          ],
          model: 'qwen/qwen3.8-27b',
          max_tokens: 300,
        }),
      });

      const data = await res.json();
      let reply = '';
      if (data.choices?.[0]?.message?.content) {
        reply = data.choices[0].message.content;
      } else if (data.content) {
        reply = data.content;
      } else {
        reply = 'Maaf, aku ga bisa jawab sekarang. Coba lagi ya!';
      }

      const aiMsg: Message = { role: 'assistant', content: reply, timestamp: Date.now() };
      setMessages(prev => [...prev, aiMsg]);
      setIsThinking(false);

      // Speak the response
      if (voiceEnabled) {
        setIsSpeaking(true);
        speak(reply, {
          onEnd: () => {
            setIsSpeaking(false);
            // Auto-listen again if in call mode
            if (inCall) {
              setTimeout(() => startListening(), 500);
            }
          },
        });
      }
    } catch (err) {
      setIsThinking(false);
      toast.error('Gagal connect ke AI');
    }
  }, [chapter, transcript, voiceEnabled, inCall, startListening]);

  const toggleCall = useCallback(() => {
    if (inCall) {
      // End call
      setInCall(false);
      setIsListening(false);
      ttsStop();
      setIsSpeaking(false);
    } else {
      // Start call
      setInCall(true);
      setTimeout(() => startListening(), 300);
    }
  }, [inCall, startListening]);

  const toggleVoice = useCallback(() => {
    if (voiceEnabled) {
      ttsStop();
      setIsSpeaking(false);
    }
    setVoiceEnabled(!voiceEnabled);
  }, [voiceEnabled]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-[#8B5CF6]/10 flex items-center justify-center">
            <Bot className="h-4 w-4 text-[#8B5CF6]" />
          </div>
          <div>
            <p className="text-sm font-medium text-white">Voice Tutor</p>
            <p className="text-[10px] text-zinc-500">
              {inCall ? '📞 In call' : 'Klik mic untuk ngomong'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={toggleVoice}
            size="sm"
            variant="ghost"
            className="h-7 text-zinc-400"
          >
            {voiceEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
          </Button>
          <Button
            onClick={toggleCall}
            size="sm"
            className={cn(
              'h-7 text-xs',
              inCall ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'
            )}
          >
            {inCall ? <PhoneOff className="h-3 w-3 mr-1" /> : <Phone className="h-3 w-3 mr-1" />}
            {inCall ? 'End' : 'Call'}
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[200px]"
      >
        {messages.map((msg, i) => (
          <div
            key={i}
            className={cn('flex gap-2', msg.role === 'user' ? 'justify-end' : 'justify-start')}
          >
            {msg.role === 'assistant' && (
              <div className="w-6 h-6 rounded-full bg-[#8B5CF6]/10 flex items-center justify-center shrink-0">
                <Bot className="h-3 w-3 text-[#8B5CF6]" />
              </div>
            )}
            <div
              className={cn(
                'rounded-lg px-3 py-2 max-w-[75%] text-sm',
                msg.role === 'user'
                  ? 'bg-[#8B5CF6] text-white'
                  : 'bg-white/[0.04] text-zinc-200'
              )}
            >
              <p className="whitespace-pre-wrap">{msg.content}</p>
              {msg.role === 'assistant' && isSpeaking && i === messages.length - 1 && (
                <div className="flex items-center gap-1 mt-1">
                  <span className="text-[9px] text-green-400 flex items-center gap-0.5">
                    <Volume2 className="h-2.5 w-2.5" />
                    Speaking...
                  </span>
                </div>
              )}
            </div>
            {msg.role === 'user' && (
              <div className="w-6 h-6 rounded-full bg-white/[0.04] flex items-center justify-center shrink-0">
                <User className="h-3 w-3 text-zinc-400" />
              </div>
            )}
          </div>
        ))}
        {isThinking && (
          <div className="flex gap-2">
            <div className="w-6 h-6 rounded-full bg-[#8B5CF6]/10 flex items-center justify-center shrink-0">
              <Bot className="h-3 w-3 text-[#8B5CF6]" />
            </div>
            <div className="rounded-lg px-3 py-2 bg-white/[0.04] text-zinc-400 text-sm">
              <Loader2 className="h-3 w-3 animate-spin inline mr-1" />
              Thinking...
            </div>
          </div>
        )}
      </div>

      {/* Mic Button */}
      <div className="p-4 border-t border-white/[0.06] flex items-center justify-center gap-3">
        <button
          onClick={isListening ? stopListening : startListening}
          disabled={isThinking}
          className={cn(
            'w-14 h-14 rounded-full flex items-center justify-center transition-all',
            isListening
              ? 'bg-red-500 animate-pulse'
              : 'bg-[#8B5CF6] hover:bg-[#7C3AED]',
            isThinking && 'opacity-50 cursor-not-allowed'
          )}
        >
          {isListening ? (
            <MicOff className="h-6 w-6 text-white" />
          ) : (
            <Mic className="h-6 w-6 text-white" />
          )}
        </button>
      </div>

      {/* Status */}
      <div className="text-center pb-2">
        <p className="text-[10px] text-zinc-600">
          {isListening ? '🔴 Mendengarkan...' : isThinking ? '🤔 AI berpikir...' : isSpeaking ? '🔊 AI bicara...' : 'Klik mic untuk tanya'}
        </p>
      </div>
    </div>
  );
}
