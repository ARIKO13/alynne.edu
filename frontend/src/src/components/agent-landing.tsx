import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Bot,
  BookOpen,
  Mic,
  BarChart3,
  ArrowRight,
  Sparkles,
  Zap,
  GraduationCap,
  ChevronDown,
  FileText,
  MonitorUp,
} from 'lucide-react';

interface Agent {
  id: string;
  name: string;
  tagline: string;
  description: string;
  icon: typeof Bot;
  color: string;
  features: { icon: typeof Mic; label: string }[];
  status: 'available' | 'coming-soon';
}

const AGENTS: Agent[] = [
  {
    id: 'learning',
    name: 'ALYNNE.LEARNING',
    tagline: 'Belajar Cerdas, Raih Sertifikat!',
    description:
      'Platform belajar AI-powered dengan Speech-to-Text, auto-generate modul PDF, dan tracking progress. Upload materi pendukung, rekam suara, dan biar AI yang menyusun modul belajarmu.',
    icon: GraduationCap,
    color: '#8B5CF6',
    features: [
      { icon: Mic, label: 'Speech to Text' },
      { icon: MonitorUp, label: 'Screen Capture' },
      { icon: FileText, label: 'Auto Modul PDF' },
      { icon: BarChart3, label: 'Progress Tracking' },
    ],
    status: 'available',
  },
  {
    id: 'assistant',
    name: 'ALYNNE.ASSISTANT',
    tagline: 'AI Chatbot Cerdas untuk Semua Kebutuhan',
    description:
      'Assistant AI yang bisa membantu menjawab pertanyaan, menganalisis data, dan memberikan rekomendasi. Dilengkapi web scraping untuk informasi real-time.',
    icon: Bot,
    color: '#8B5CF6',
    features: [
      { icon: Sparkles, label: 'Multi-Model LLM' },
      { icon: Zap, label: 'Real-time Web' },
      { icon: BookOpen, label: 'Context Aware' },
    ],
    status: 'coming-soon',
  },
];

function getCardClass(agent: Agent, isHovered: boolean): string {
  const base = 'relative rounded-2xl border transition-all duration-300 overflow-hidden';
  if (agent.status === 'coming-soon') return `${base} border-white/[0.04] bg-white/[0.01] opacity-70`;
  if (isHovered) return `${base} border-white/[0.15] bg-white/[0.05] shadow-lg shadow-black/20`;
  return `${base} border-white/[0.08] bg-white/[0.03]`;
}

function getIconContainerStyle(agent: Agent, isHovered: boolean): React.CSSProperties {
  const available = agent.status === 'available';
  return {
    backgroundColor: available ? `${agent.color}15` : 'rgba(255,255,255,0.03)',
    transform: available && isHovered ? 'scale(1.1)' : 'none',
    transition: 'transform 0.3s',
  };
}

export function AgentLanding({ onEnter }: { onEnter: (agentId: string) => void }) {
  const [hoveredAgent, setHoveredAgent] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-[#09090b] flex flex-col">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-[#09090b]/80 backdrop-blur-md border-b border-white/[0.06]">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#8B5CF6] to-orange-600">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <span className="text-base font-semibold tracking-tight text-white">
              ALYNNE<span className="text-zinc-500">.AI</span>
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-[11px] text-zinc-600 hidden sm:block">Platform AI Agent</span>
            <button
              onClick={() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })}
              className="text-xs text-zinc-400 hover:text-white transition-colors"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 pt-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="text-center max-w-2xl mb-12"
        >
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight text-white mb-4">
            Meet Your{' '}
            <span className="bg-gradient-to-r from-[#8B5CF6] to-orange-400 bg-clip-text text-transparent">
              AI Agents
            </span>
          </h1>

          <p className="text-base sm:text-lg text-zinc-500 max-w-lg mx-auto leading-relaxed">
            Pilih agent yang kamu butuhkan. Setiap agent dirancang khusus
            untuk tugas yang berbeda.
          </p>
        </motion.div>

        {/* Agent Cards */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="w-full max-w-3xl space-y-4"
        >
          {AGENTS.map((agent, idx) => {
            const Icon = agent.icon;
            const isHovered = hoveredAgent === agent.id;
            const isAvailable = agent.status === 'available';

            return (
              <motion.div
                key={agent.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.4 + idx * 0.15 }}
                onMouseEnter={() => setHoveredAgent(agent.id)}
                onMouseLeave={() => setHoveredAgent(null)}
                className={getCardClass(agent, isHovered)}
              >
                {/* Gradient accent line */}
                {isAvailable && (
                  <div
                    className="absolute top-0 left-0 right-0 h-px opacity-50"
                    style={{
                      background: `linear-gradient(90deg, transparent, ${agent.color}, transparent)`,
                    }}
                  />
                )}

                <div className="p-6 sm:p-8">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4 flex-1 min-w-0">
                      <div
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
                        style={getIconContainerStyle(agent, isHovered)}
                      >
                        <Icon
                          className="h-6 w-6"
                          style={{ color: isAvailable ? agent.color : '#52525b' }}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-1">
                          <h3 className="text-base font-semibold text-white">{agent.name}</h3>
                          {isAvailable ? (
                            <span className="text-[9px] font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                              Available
                            </span>
                          ) : (
                            <span className="text-[9px] font-medium text-zinc-500 bg-white/[0.04] border border-white/[0.06] px-2 py-0.5 rounded-full">
                              Coming Soon
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-zinc-400 mb-3">{agent.tagline}</p>
                        <p className="text-[12px] text-zinc-600 leading-relaxed line-clamp-2">
                          {agent.description}
                        </p>

                        {/* Feature pills */}
                        <div className="flex flex-wrap gap-2 mt-4">
                          {agent.features.map((f) => {
                            const FIcon = f.icon;
                            return (
                              <span
                                key={f.label}
                                className="inline-flex items-center gap-1.5 text-[10px] text-zinc-500 bg-white/[0.03] border border-white/[0.06] px-2.5 py-1 rounded-lg"
                              >
                                <FIcon className="h-3 w-3" />
                                {f.label}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {/* Action button */}
                    {isAvailable && (
                      <motion.button
                        onClick={() => onEnter(agent.id)}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        className="shrink-0 flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-medium transition-colors text-white"
                        style={{ backgroundColor: isHovered ? agent.color : `${agent.color}30` }}
                      >
                        Get Started
                        <ArrowRight className="h-4 w-4" />
                      </motion.button>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/[0.04] py-6 px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <span className="text-[11px] text-zinc-700">Povycon Technology</span>
          <span className="text-[11px] text-zinc-700">{new Date().getFullYear()}</span>
        </div>
      </footer>
    </div>
  );
}
