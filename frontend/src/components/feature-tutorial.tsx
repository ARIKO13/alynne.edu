import { useState, useEffect } from 'react';
import { X, Lightbulb, ChevronLeft, ChevronRight } from 'lucide-react';

interface TutorialStep {
  title: string;
  desc: string;
}

interface FeatureTutorialProps {
  title: string;
  steps: TutorialStep[];
  storageKey: string;
  accentColor?: string;
}

export function FeatureTutorial({ title, steps, storageKey, accentColor = '#B794F6' }: FeatureTutorialProps) {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem(`tutorial-dismissed-${storageKey}`) === 'true';
  });
  const [currentStep, setCurrentStep] = useState(0);

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem(`tutorial-dismissed-${storageKey}`, 'true');
  };

  const handleReset = () => {
    setDismissed(false);
    setCurrentStep(0);
    localStorage.removeItem(`tutorial-dismissed-${storageKey}`);
  };

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleDismiss();
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) setCurrentStep(currentStep - 1);
  };

  useEffect(() => {
    if (dismissed) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleDismiss();
      if (e.key === 'ArrowRight' || e.key === 'Enter') handleNext();
      if (e.key === 'ArrowLeft') handlePrev();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [dismissed, currentStep]);

  if (dismissed) {
    return (
      <button
        onClick={handleReset}
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full px-4 py-2.5 text-xs font-medium shadow-2xl shadow-black/40 backdrop-blur-xl border transition-all hover:scale-105 active:scale-95"
        style={{
          backgroundColor: `${accentColor}18`,
          borderColor: `${accentColor}30`,
          color: accentColor,
        }}
      >
        <Lightbulb className="h-4 w-4" />
        <span>Panduan {title}</span>
      </button>
    );
  }

  const step = steps[currentStep];
  const progress = ((currentStep + 1) / steps.length) * 100;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleDismiss}
      />

      <div
        className="relative w-full max-w-sm rounded-2xl border shadow-2xl shadow-black/50 overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        style={{
          backgroundColor: '#161616',
          borderColor: `${accentColor}25`,
        }}
      >
        <div
          className="h-1 w-full"
          style={{ backgroundColor: accentColor }}
        />

        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-xl"
              style={{ backgroundColor: `${accentColor}15` }}
            >
              <Lightbulb className="h-4 w-4" style={{ color: accentColor }} />
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-100">{title}</p>
              <p className="text-[10px] text-zinc-500">
                Langkah {currentStep + 1} dari {steps.length}
              </p>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="p-1.5 rounded-lg hover:bg-white/[0.06] text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5">
          <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${progress}%`, backgroundColor: accentColor }}
            />
          </div>
        </div>

        <div className="px-5 py-5">
          <div className="flex items-start gap-3.5">
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold mt-0.5"
              style={{
                backgroundColor: `${accentColor}20`,
                color: accentColor,
              }}
            >
              {currentStep + 1}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white mb-1.5">{step.title}</p>
              <p className="text-xs text-zinc-400 leading-relaxed">{step.desc}</p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between px-5 pb-4">
          <button
            onClick={handlePrev}
            disabled={currentStep === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/[0.06] text-zinc-400 hover:text-zinc-200"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Sebelumnya
          </button>

          <div className="flex items-center gap-1.5">
            {steps.map((_, i) => (
              <div
                key={i}
                className="h-1.5 rounded-full transition-all duration-300"
                style={{
                  width: i === currentStep ? 16 : 6,
                  backgroundColor: i === currentStep ? accentColor : `${accentColor}30`,
                }}
              />
            ))}
          </div>

          <button
            onClick={handleNext}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white transition-all hover:opacity-90 active:scale-95"
            style={{ backgroundColor: accentColor }}
          >
            {currentStep === steps.length - 1 ? (
              <>
                Mulai
                <span className="ml-0.5">✓</span>
              </>
            ) : (
              <>
                Lanjut
                <ChevronRight className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        </div>

        <div className="px-5 pb-3">
          <button
            onClick={handleDismiss}
            className="w-full text-center text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors py-1"
          >
            Lewati tutorial
          </button>
        </div>
      </div>
    </div>
  );
}
