import { useState, useEffect, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import { Play, Pause, RotateCcw, Eye, Activity, Flame, AlertTriangle } from 'lucide-react';

// ── Focus Day (persisted) ──
interface FocusDay { date: string; totalMinutes: number; sessions: number; }

function getFocusDays(): FocusDay[] {
  try { return JSON.parse(localStorage.getItem('lina-focus-days') || '[]'); } catch { return []; }
}
function saveTodayFocus(minutes: number) {
  const today = new Date().toISOString().split('T')[0];
  const days = getFocusDays().filter(d => d.date !== today);
  const existing = getFocusDays().find(d => d.date === today);
  days.push({ date: today, totalMinutes: (existing?.totalMinutes || 0) + minutes, sessions: (existing?.sessions || 0) + 1 });
  localStorage.setItem('lina-focus-days', JSON.stringify(days));
}

// ── Focus Detector (mic noise + camera face) ──

interface FocusState {
  faceDetected: boolean;
  noiseLevel: number;
  focusScore: number;
  distracted: boolean;
}

function useFocusDetector(enabled: boolean, isRunning: boolean) {
  const [focusState, setFocusState] = useState<FocusState>({ faceDetected: false, noiseLevel: 0, focusScore: 0, distracted: false });
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animRef = useRef<number>(0);
  const faceCheckRef = useRef<ReturnType<typeof setInterval>>();
  const scoreHistory = useRef<number[]>([]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const prevFrameRef = useRef<Uint8ClampedArray | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 240, height: 180, facingMode: 'user' },
        audio: true
      });
      streamRef.current = stream;

      // Audio analysis
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Video for face/presence detection
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();
      videoRef.current = video;

      const hasFaceAPI = typeof (window as any).FaceDetector === 'function';

      // Face check interval
      faceCheckRef.current = setInterval(async () => {
        if (!video.videoWidth || !videoRef.current) {
          setFocusState(p => ({ ...p, faceDetected: false }));
          return;
        }

        let detected = false;

        if (hasFaceAPI) {
          try {
            const detector = new (window as any).FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
            const faces = await detector.detect(video);
            detected = faces.length > 0;
          } catch { detected = false; }
        } else {
          // Fallback: skin tone + frame difference
          const c = document.createElement('canvas');
          c.width = 80; c.height = 60;
          const ctx = c.getContext('2d');
          if (!ctx) return;
          ctx.drawImage(video, 0, 0, 80, 60);
          const frame = ctx.getImageData(0, 0, 80, 60).data;

          let diffSum = 0;
          if (prevFrameRef.current) {
            for (let i = 0; i < frame.length; i += 16) {
              diffSum += Math.abs(frame[i] - prevFrameRef.current[i]);
            }
          }
          prevFrameRef.current = new Uint8ClampedArray(frame);

          let skinPixels = 0;
          const startX = 20, endX = 60, startY = 5, endY = 50;
          for (let y = startY; y < endY; y++) {
            for (let x = startX; x < endX; x++) {
              const idx = (y * 80 + x) * 4;
              const r = frame[idx], g = frame[idx + 1], b = frame[idx + 2];
              if (r > 80 && g > 40 && b > 20 && r > g && r > b && (r - g) > 15 && r < 250) {
                skinPixels++;
              }
            }
          }
          const totalCenterPixels = (endX - startX) * (endY - startY);
          const skinRatio = skinPixels / totalCenterPixels;
          const motionThreshold = diffSum / (frame.length / 16) > 30;
          detected = skinRatio > 0.15 && !motionThreshold;
        }

        setFocusState(p => ({ ...p, faceDetected: detected }));
      }, 1500);

      // Audio noise loop
      const arr = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(arr);
        let sum = 0;
        for (let i = 0; i < arr.length; i++) sum += arr[i];
        const noise = Math.min(100, (sum / arr.length / 128) * 100);

        setFocusState(p => {
          const faceScore = p.faceDetected ? 60 : 0;
          const quietScore = Math.max(0, 40 - noise * 0.4);
          const score = Math.round(faceScore + quietScore);
          scoreHistory.current.push(score);
          if (scoreHistory.current.length > 20) scoreHistory.current.shift();
          const avg = scoreHistory.current.reduce((a, b) => a + b, 0) / scoreHistory.current.length;
          return {
            ...p,
            noiseLevel: Math.round(noise),
            focusScore: Math.round(avg),
            distracted: avg < 35,
          };
        });
        animRef.current = requestAnimationFrame(loop);
      };
      loop();
    } catch {
      setFocusState({ faceDetected: false, noiseLevel: 0, focusScore: 0, distracted: false });
    }
  }, []);

  const stop = useCallback(() => {
    cancelAnimationFrame(animRef.current);
    clearInterval(faceCheckRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    videoRef.current = null;
    analyserRef.current = null;
    prevFrameRef.current = null;
    scoreHistory.current = [];
    setFocusState({ faceDetected: false, noiseLevel: 0, focusScore: 0, distracted: false });
  }, []);

  useEffect(() => {
    if (enabled && isRunning) start(); else stop();
    return stop;
  }, [enabled, isRunning, start, stop]);

  return { focusState };
}

// ── Break Popup (timer complete) ──

function BreakPopup({ minutes, onDismiss }: { minutes: number; onDismiss: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onDismiss}>
      <div className="bg-[#161616] border border-white/[0.08] rounded-2xl p-6 max-w-sm w-full text-center shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="w-16 h-16 rounded-full bg-[#34D399]/10 flex items-center justify-center mx-auto mb-4">
          <Flame className="h-8 w-8 text-[#34D399]" />
        </div>
        <h2 className="text-lg font-semibold text-white mb-2">Nice dude, it&apos;s time to break.</h2>
        <p className="text-sm text-zinc-400 mb-5">Kamu udah fokus selama {minutes} menit. Saatnya istirahat sejenak!</p>
        <button onClick={onDismiss} className="w-full py-2.5 rounded-xl bg-[#34D399] hover:bg-[#34D399]/80 text-white font-medium text-sm transition-colors">
          Oke, lanjut nanti
        </button>
      </div>
    </div>
  );
}

// ── Distracted Popup (not focused) ──

function DistractedPopup({ focusScore, faceDetected, noiseLevel, onDismiss }: {
  focusScore: number;
  faceDetected: boolean;
  noiseLevel: number;
  onDismiss: () => void;
}) {
  const getWarningMessage = () => {
    if (!faceDetected && noiseLevel < 20) {
      return { title: 'Wajahmu tidak terdeteksi', desc: 'Pastikan kamu ada di depan kamera dan pencahayaan cukup.' };
    }
    if (!faceDetected) {
      return { title: 'Kamu terlihat tidak fokus', desc: 'Nunduk atau meninggalkan layar? Ayo balik fokus belajarnya!' };
    }
    if (noiseLevel > 50) {
      return { title: 'Suara sekitar terlalu berisik', desc: 'Coba cari tempat yang lebih tenang agar bisa fokus.' };
    }
    return { title: 'Yuk fokus lagi!', desc: 'Tetap semangat belajarnya, kamu pasti bisa!' };
  };
  const { title, desc } = getWarningMessage();

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onDismiss}>
      <div className="bg-[#161616] border border-amber-400/20 rounded-2xl p-6 max-w-sm w-full text-center shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="w-16 h-16 rounded-full bg-amber-400/10 flex items-center justify-center mx-auto mb-4 animate-pulse">
          <AlertTriangle className="h-8 w-8 text-amber-400" />
        </div>
        <h2 className="text-lg font-semibold text-white mb-2">{title}</h2>
        <p className="text-sm text-zinc-400 mb-4">{desc}</p>

        {/* Status indicators */}
        <div className="flex items-center justify-center gap-4 mb-5">
          <div className="flex items-center gap-1.5">
            <div className={cn('w-2 h-2 rounded-full', faceDetected ? 'bg-[#34D399]' : 'bg-red-400')} />
            <span className="text-[10px] text-zinc-500">Wajah {faceDetected ? 'ada' : 'tidak ada'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Activity className={cn('h-3 w-3', noiseLevel < 30 ? 'text-[#34D399]' : noiseLevel < 60 ? 'text-amber-400' : 'text-red-400')} />
            <span className="text-[10px] text-zinc-500">Suara {noiseLevel < 30 ? 'tenang' : noiseLevel < 60 ? 'sedang' : 'berisik'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Eye className={cn('h-3 w-3', focusScore > 60 ? 'text-[#34D399]' : focusScore > 30 ? 'text-amber-400' : 'text-red-400')} />
            <span className="text-[10px] text-zinc-500">Skor {focusScore}%</span>
          </div>
        </div>

        <button onClick={onDismiss} className="w-full py-2.5 rounded-xl bg-amber-400 hover:bg-amber-400/80 text-black font-medium text-sm transition-colors">
          Oke, aku fokus lagi
        </button>
      </div>
    </div>
  );
}

// ── Main Component: Simple Floating Timer Bar ──

export function StudyMode() {
  const { studyDefaultMinutes, studyFocusTracker, studyFocusSensitivity } = useAppStore();

  const [timerTotal, setTimerTotal] = useState(studyDefaultMinutes * 60);
  const [timerLeft, setTimerLeft] = useState(studyDefaultMinutes * 60);
  const [isRunning, setIsRunning] = useState(false);
  const [showBreakPopup, setShowBreakPopup] = useState(false);
  const [completedMinutes, setCompletedMinutes] = useState(0);
  const [showDistractedPopup, setShowDistractedPopup] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval>>();
  const { focusState } = useFocusDetector(studyFocusTracker, isRunning);
  const distractedTimerRef = useRef<ReturnType<typeof setInterval>>();
  const distractedStartRef = useRef<number>(0);
  const distractedCooldownRef = useRef<number>(0);

  // Sync timer when default changes
  useEffect(() => {
    if (!isRunning && timerLeft === timerTotal) {
      const s = studyDefaultMinutes * 60;
      setTimerTotal(s);
      setTimerLeft(s);
    }
  }, [studyDefaultMinutes]);

  // Timer countdown
  useEffect(() => {
    if (!isRunning) { clearInterval(timerRef.current); return; }
    timerRef.current = setInterval(() => {
      setTimerLeft(prev => {
        if (prev <= 1) {
          setIsRunning(false);
          const mins = Math.round(timerTotal / 60);
          setCompletedMinutes(mins);
          saveTodayFocus(mins);
          setShowBreakPopup(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [isRunning, timerTotal]);

  // Distracted detection: show popup after sustained low focus
  // Sensitivity maps to seconds of distraction before popup:
  // 50 (Sensitif) = ~3s, 35 (Normal) = ~6s, 20 (Longgar) = ~10s
  const distractionThresholdSec = Math.max(3, Math.round((50 - studyFocusSensitivity) / 3));

  useEffect(() => {
    if (!isRunning || !studyFocusTracker) {
      clearInterval(distractedTimerRef.current);
      distractedStartRef.current = 0;
      return;
    }

    if (focusState.distracted && distractedStartRef.current === 0) {
      // Start counting distraction
      distractedStartRef.current = Date.now();
    } else if (!focusState.distracted) {
      // No longer distracted, reset
      distractedStartRef.current = 0;
      // Reset cooldown if they recovered
      distractedCooldownRef.current = 0;
    }

    // Check if distraction duration exceeds threshold
    if (distractedStartRef.current > 0) {
      const elapsed = (Date.now() - distractedStartRef.current) / 1000;
      const cooldownLeft = (Date.now() - distractedCooldownRef.current) / 1000;
      if (elapsed >= distractionThresholdSec && cooldownLeft > 30) {
        setShowDistractedPopup(true);
        distractedStartRef.current = 0;
        distractedCooldownRef.current = Date.now();
      }
    }
  }, [focusState.distracted, isRunning, studyFocusTracker, distractionThresholdSec]);

  // Reset distraction tracking when timer stops
  useEffect(() => {
    if (!isRunning) {
      distractedStartRef.current = 0;
      distractedCooldownRef.current = 0;
      setShowDistractedPopup(false);
    }
  }, [isRunning]);

  const toggleTimer = () => {
    if (timerLeft <= 0) {
      setTimerLeft(timerTotal);
      setIsRunning(true);
    } else {
      setIsRunning(!isRunning);
    }
  };

  const resetTimer = () => {
    setIsRunning(false);
    setTimerLeft(timerTotal);
  };

  const mins = Math.floor(timerLeft / 60);
  const secs = timerLeft % 60;
  const progress = timerTotal > 0 ? 1 - timerLeft / timerTotal : 0;
  const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  return (
    <>
      {/* Break Popup (timer complete) */}
      {showBreakPopup && (
        <BreakPopup minutes={completedMinutes} onDismiss={() => setShowBreakPopup(false)} />
      )}

      {/* Distracted Popup */}
      {showDistractedPopup && (
        <DistractedPopup
          focusScore={focusState.focusScore}
          faceDetected={focusState.faceDetected}
          noiseLevel={focusState.noiseLevel}
          onDismiss={() => setShowDistractedPopup(false)}
        />
      )}

      {/* Simple Bottom Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-[55]">
        <div className="bg-[#111]/90 backdrop-blur-xl border-t border-white/[0.06]">
          <div className="max-w-2xl mx-auto flex items-center gap-2 px-3 py-2">
            {/* Timer display */}
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className={cn(
                'w-2 h-2 rounded-full shrink-0',
                isRunning ? 'bg-[#34D399] animate-pulse'
                  : timerLeft < timerTotal && timerLeft > 0 ? 'bg-amber-400'
                  : 'bg-zinc-600'
              )} />
              <span className={cn(
                'font-mono text-sm tabular-nums shrink-0',
                isRunning ? 'text-[#34D399]'
                  : timerLeft === 0 ? 'text-zinc-600'
                  : 'text-zinc-300'
              )}>
                {timeStr}
              </span>
              <div className="flex-1 h-1 bg-white/[0.04] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#34D399] rounded-full transition-all duration-1000"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
            </div>

            {/* Focus indicator */}
            {studyFocusTracker && isRunning && (
              <div className={cn(
                'flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium',
                !focusState.faceDetected ? 'bg-red-400/10 text-red-400'
                  : focusState.focusScore > 60 ? 'bg-[#34D399]/10 text-[#34D399]'
                  : 'bg-amber-400/10 text-amber-400'
              )}>
                <Eye className="h-2.5 w-2.5" />
                {focusState.focusScore}%
              </div>
            )}

            {/* Controls */}
            <button
              onClick={resetTimer}
              className="p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors text-zinc-500 hover:text-zinc-300"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={toggleTimer}
              className={cn(
                'p-1.5 rounded-lg transition-colors',
                isRunning
                  ? 'bg-amber-400/10 text-amber-400 hover:bg-amber-400/20'
                  : 'bg-[#34D399]/10 text-[#34D399] hover:bg-[#34D399]/20'
              )}
            >
              {isRunning ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
