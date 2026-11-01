interface AudioVisualizerProps {
  audioLevels: number[];
  /** When true and no audio data, show a 'listening' pulse animation (Web Speech mode) */
  isListening?: boolean;
}

export function AudioVisualizer({ audioLevels, isListening = false }: AudioVisualizerProps) {
  const hasSound = audioLevels.some((l) => l > 15);

  // Web Speech API mode: no real audio stream, show a listening pulse
  if (isListening && !hasSound) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-[#111113] px-4 py-3">
        <div className="flex items-end gap-[2px] h-8 flex-1">
          {audioLevels.map((_, i) => {
            // Simulated gentle pulse based on index
            const delay = i * 30;
            return (
              <div
                key={i}
                className="w-full rounded-sm"
                style={{
                  height: '3px',
                  backgroundColor: '#7C3AED33',
                  animation: `pulse-bar 1.2s ease-in-out ${delay}ms infinite alternate`,
                }}
              />
            );
          })}
        </div>
        <span className="text-[10px] text-zinc-500 shrink-0">Mendengarkan...</span>

        <style>{`
          @keyframes pulse-bar {
            0% { height: 3px; background-color: rgba(232,93,37,0.2); }
            100% { height: 18px; background-color: rgba(232,93,37,0.5); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-[#111113] px-4 py-3">
      <div className="flex items-end gap-[2px] h-8 flex-1">
        {audioLevels.map((level, i) => {
          const color = level > 40 ? '#7C3AED' : level > 15 ? '#7C3AED66' : '#7C3AED33';
          return (
            <div
              key={i}
              className="w-full rounded-sm"
              style={{
                height: `${Math.max(2, level * 0.6)}px`,
                backgroundColor: color,
                transition: 'height 100ms',
              }}
            />
          );
        })}
      </div>
      <span className="text-[10px] text-zinc-600 shrink-0">
        {hasSound ? 'Suara terdeteksi' : 'Menunggu suara...'}
      </span>
    </div>
  );
}