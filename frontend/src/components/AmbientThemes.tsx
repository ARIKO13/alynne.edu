/**
 * AmbientThemes.tsx  -  Lo-Fi / White Noise player for study sessions
 *
 * Generates ambient audio using Web Audio API (no external files needed).
 * Options: Lo-Fi (synthesized), White Noise, Rain, Forest, None
 *
 * 100% client-side, no audio files to download.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Volume2, VolumeX, Music, Wind, CloudRain, Trees } from 'lucide-react';
import { cn } from '@/lib/utils';

type AmbientType = 'none' | 'lofi' | 'whitenoise' | 'rain' | 'forest';

const AMBIENT_OPTIONS: Array<{
  type: AmbientType;
  label: string;
  icon: typeof Music;
  color: string;
}> = [
  { type: 'none', label: 'Off', icon: VolumeX, color: 'text-stone-500' },
  { type: 'lofi', label: 'Lo-Fi', icon: Music, color: 'text-[var(--accent-soft)]' },
  { type: 'whitenoise', label: 'White Noise', icon: Wind, color: 'text-[var(--accent-soft)]' },
  { type: 'rain', label: 'Hujan', icon: CloudRain, color: 'text-blue-400' },
  { type: 'forest', label: 'Hutan', icon: Trees, color: 'text-green-400' },
];

export function AmbientThemes() {
  const [active, setActive] = useState<AmbientType>('none');
  const [volume, setVolume] = useState(0.3);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nodesRef = useRef<any[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopAll = useCallback(() => {
    nodesRef.current.forEach((node) => {
      try {
        if (node.stop) node.stop();
        if (node.disconnect) node.disconnect();
      } catch {}
    });
    nodesRef.current = [];
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startAmbient = useCallback(
    (type: AmbientType) => {
      stopAll();

      if (type === 'none') return;

      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
      }
      const ctx = audioCtxRef.current;
      const masterGain = ctx.createGain();
      masterGain.gain.value = volume;
      masterGain.connect(ctx.destination);
      nodesRef.current.push(masterGain);

      if (type === 'whitenoise') {
        // White noise via buffer
        const bufferSize = 2 * ctx.sampleRate;
        const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          output[i] = Math.random() * 2 - 1;
        }
        const whiteNoise = ctx.createBufferSource();
        whiteNoise.buffer = noiseBuffer;
        whiteNoise.loop = true;
        whiteNoise.connect(masterGain);
        whiteNoise.start();
        nodesRef.current.push(whiteNoise);
      } else if (type === 'rain' || type === 'forest') {
        // Filtered noise for rain/forest
        const bufferSize = 2 * ctx.sampleRate;
        const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          output[i] = Math.random() * 2 - 1;
        }
        const noise = ctx.createBufferSource();
        noise.buffer = noiseBuffer;
        noise.loop = true;

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = type === 'rain' ? 2400 : 800;
        filter.Q.value = 0.5;

        noise.connect(filter);
        filter.connect(masterGain);
        noise.start();
        nodesRef.current.push(noise, filter);

        // For forest: add occasional bird-like chirps
        if (type === 'forest') {
          intervalRef.current = setInterval(() => {
            if (Math.random() > 0.7) {
              const osc = ctx.createOscillator();
              const gain = ctx.createGain();
              osc.type = 'sine';
              osc.frequency.value = 2000 + Math.random() * 2000;
              gain.gain.setValueAtTime(0, ctx.currentTime);
              gain.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 0.05);
              gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.15);
              osc.connect(gain);
              gain.connect(masterGain);
              osc.start();
              osc.stop(ctx.currentTime + 0.2);
            }
          }, 2000);
        }
      } else if (type === 'lofi') {
        // Simple lofi: slow chord progression with low-pass filter
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 800;
        filter.connect(masterGain);
        nodesRef.current.push(filter);

        // Chord progression: Am - F - C - G (every 4 seconds)
        const chords = [
          [220, 261.63, 329.63], // Am
          [174.61, 220, 261.63], // F
          [261.63, 329.63, 392], // C
          [196, 246.94, 293.66], // G
        ];
        let chordIdx = 0;

        const playChord = () => {
          const chord = chords[chordIdx % chords.length];
          chord.forEach((freq) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 0.5);
            gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 3.5);
            osc.connect(gain);
            gain.connect(filter);
            osc.start();
            osc.stop(ctx.currentTime + 4);
          });
          chordIdx++;
        };

        playChord();
        intervalRef.current = setInterval(playChord, 4000);

        // Add soft vinyl crackle
        const crackleBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
        const crackleData = crackleBuffer.getChannelData(0);
        for (let i = 0; i < crackleData.length; i++) {
          crackleData[i] = Math.random() > 0.99 ? (Math.random() * 2 - 1) * 0.3 : 0;
        }
        const crackle = ctx.createBufferSource();
        crackle.buffer = crackleBuffer;
        crackle.loop = true;
        const crackleGain = ctx.createGain();
        crackleGain.gain.value = 0.5;
        crackle.connect(crackleGain);
        crackleGain.connect(masterGain);
        crackle.start();
        nodesRef.current.push(crackle, crackleGain);
      }
    },
    [volume, stopAll]
  );

  // Update volume in real-time
  useEffect(() => {
    if (nodesRef.current.length > 0) {
      const masterGain = nodesRef.current[0];
      if (masterGain && masterGain.gain) {
        masterGain.gain.value = volume;
      }
    }
  }, [volume]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAll();
      if (audioCtxRef.current) {
        try {
          audioCtxRef.current.close();
        } catch {}
      }
    };
  }, [stopAll]);

  const handleSelect = (type: AmbientType) => {
    setActive(type);
    startAmbient(type);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-stone-500">
        <Music className="h-3 w-3" />
        <span>Ambient Sound (biar betah belajarnya)</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {AMBIENT_OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const isActive = active === opt.type;
          return (
            <button
              key={opt.type}
              onClick={() => handleSelect(opt.type)}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-colors border',
                isActive
                  ? 'border-white/20 bg-white/[0.08] text-white'
                  : 'border-white/[0.06] text-stone-500 hover:bg-white/[0.04] hover:text-stone-300'
              )}
            >
              <Icon className={cn('h-3 w-3', isActive ? opt.color : '')} />
              {opt.label}
            </button>
          );
        })}
      </div>
      {active !== 'none' && (
        <div className="flex items-center gap-2">
          <Volume2 className="h-3 w-3 text-stone-500" />
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            className="flex-1 h-1 accent-[var(--accent)]"
          />
          <span className="text-[10px] text-stone-500 w-8 text-right">
            {Math.round(volume * 100)}%
          </span>
        </div>
      )}
    </div>
  );
}
