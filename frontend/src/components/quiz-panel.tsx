import { useState, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  BarChart3, Upload, FileText, CheckCircle, XCircle, RotateCcw,
  ChevronRight, ChevronLeft, Sparkles, Loader2, Trophy, Target,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface QuizQuestion {
  id: number;
  type: 'multiple-choice' | 'true-false' | 'fill-blank';
  question: string;
  options?: string[];
  correctAnswer: string;
  explanation: string;
  context: string;
}

interface QuizState {
  questions: QuizQuestion[];
  currentIndex: number;
  answers: Record<number, string>;
  showResults: boolean;
  score: number;
  fillBlanks: Record<number, string>;
}

function extractSentences(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 30 && s.split(/\s+/).length >= 5);
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function generateQuizzes(text: string, count: number = 10): QuizQuestion[] {
  const sentences = extractSentences(text);
  if (sentences.length < 3) return [];

  const questions: QuizQuestion[] = [];
  const usedContexts = new Set<string>();
  const shuffled = shuffleArray(sentences);

  for (const sentence of shuffled) {
    if (questions.length >= count) break;
    if (usedContexts.has(sentence)) continue;

    const words = sentence.split(/\s+/).filter(w => w.length > 3);
    if (words.length < 4) continue;

    const context = capitalize(sentence) + '.';
    usedContexts.add(sentence);

    // Decide question type
    const rand = Math.random();
    if (rand < 0.4 && words.length >= 6) {
      // Fill in the blank
      const targetIdx = Math.floor(Math.random() * (words.length - 2)) + 1;
      const targetWord = words[targetIdx];
      const blankedWords = [...words];
      blankedWords[targetIdx] = '________';
      const question = blankedWords.join(' ');
      questions.push({
        id: questions.length,
        type: 'fill-blank',
        question: `Lengkapi kalimat berikut:\n"${question}"`,
        correctAnswer: targetWord.toLowerCase(),
        explanation: `Jawaban yang benar adalah "${targetWord}". Konteks: ${context}`,
        context,
      });
    } else if (rand < 0.7) {
      // Multiple choice
      const targetIdx = Math.floor(Math.random() * Math.min(words.length, 8));
      const targetWord = words[targetIdx];
      const question = `Apa kata yang tepat untuk menggantikan kata "________" dalam kalimat: "${sentence.replace(targetWord, '________')}"?`;
      const wrongOptions = shuffleArray(words.filter((_, i) => i !== targetIdx)).slice(0, 3);
      if (wrongOptions.length < 3) continue;
      const options = shuffleArray([targetWord, ...wrongOptions]);
      questions.push({
        id: questions.length,
        type: 'multiple-choice',
        question,
        options,
        correctAnswer: targetWord.toLowerCase(),
        explanation: `Jawaban yang benar adalah "${targetWord}". ${context}`,
        context,
      });
    } else {
      // True/False
      const isTrue = Math.random() > 0.5;
      const modifiedSentence = isTrue
        ? sentence
        : sentence.replace(words[words.length > 3 ? 2 : 1], words[0]);
      questions.push({
        id: questions.length,
        type: 'true-false',
        question: `Benar atau salah: "${capitalize(modifiedSentence)}."`,
        options: ['Benar', 'Salah'],
        correctAnswer: isTrue ? 'benar' : 'salah',
        explanation: isTrue
          ? `Benar. ${context}`
          : `Salah. Kalimat aslinya: ${context}`,
        context,
      });
    }
  }

  return shuffleArray(questions);
}

export function QuizPanel() {
  const [rawText, setRawText] = useState('');
  const [fileText, setFileText] = useState('');
  const [fileName, setFileName] = useState('');
  const [generating, setGenerating] = useState(false);
  const [quizState, setQuizState] = useState<QuizState | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<string>('');
  const [showAnswer, setShowAnswer] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const extractTextFromFile = useCallback(async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'txt' && ext !== 'md' && ext !== 'csv') {
      alert('Format file didukung: .txt, .md, .csv');
      return;
    }
    const text = await file.text();
    setFileText(text);
    setFileName(file.name);
  }, []);

  const handleGenerate = useCallback(() => {
    const text = fileText || rawText;
    if (!text.trim() || text.trim().split(/\s+/).length < 50) {
      alert('Teks terlalu pendek. Minimal 50 kata untuk generate quiz.');
      return;
    }
    setGenerating(true);
    setTimeout(() => {
      const questions = generateQuizzes(text, 10);
      if (questions.length === 0) {
        alert('Gagal generate quiz. Pastikan teks memiliki kalimat yang cukup panjang (minimal 5 kata per kalimat).');
        setGenerating(false);
        return;
      }
      setQuizState({
        questions,
        currentIndex: 0,
        answers: {},
        showResults: false,
        score: 0,
        fillBlanks: {},
      });
      setGenerating(false);
      setSelectedAnswer('');
      setShowAnswer(false);
    }, 800);
  }, [fileText, rawText]);

  const handleAnswer = useCallback((answer: string) => {
    if (!quizState || showAnswer) return;
    setSelectedAnswer(answer);
  }, [quizState, showAnswer]);

  const handleCheck = useCallback(() => {
    if (!quizState || !selectedAnswer) return;
    const currentQ = quizState.questions[quizState.currentIndex];
    const isCorrect = selectedAnswer.toLowerCase().trim() === currentQ.correctAnswer.toLowerCase();
    setShowAnswer(true);
    setQuizState(prev => prev ? {
      ...prev,
      score: prev.score + (isCorrect ? 1 : 0),
      answers: { ...prev.answers, [currentQ.id]: selectedAnswer },
    } : null);
  }, [quizState, selectedAnswer]);

  const handleFillBlank = useCallback((value: string) => {
    setSelectedAnswer(value);
    setQuizState(prev => prev ? {
      ...prev,
      fillBlanks: { ...prev.fillBlanks, [prev.currentIndex]: value },
    } : null);
  }, []);

  const handleNext = useCallback(() => {
    if (!quizState) return;
    if (quizState.currentIndex >= quizState.questions.length - 1) {
      setQuizState(prev => prev ? { ...prev, showResults: true } : null);
    } else {
      setQuizState(prev => prev ? { ...prev, currentIndex: prev.currentIndex + 1 } : null);
    }
    setSelectedAnswer(quizState.fillBlanks[quizState.currentIndex + 1] || '');
    setShowAnswer(false);
  }, [quizState]);

  const handlePrev = useCallback(() => {
    if (!quizState || quizState.currentIndex <= 0) return;
    setQuizState(prev => prev ? { ...prev, currentIndex: prev.currentIndex - 1 } : null);
    const prevIdx = quizState.currentIndex - 1;
    setSelectedAnswer(quizState.fillBlanks[prevIdx] || quizState.answers[prevIdx] || '');
    setShowAnswer(!!quizState.answers[prevIdx]);
  }, [quizState]);

  const handleRetry = useCallback(() => {
    const text = fileText || rawText;
    if (!text) return;
    const questions = generateQuizzes(text, 10);
    setQuizState({
      questions,
      currentIndex: 0,
      answers: {},
      showResults: false,
      score: 0,
      fillBlanks: {},
    });
    setSelectedAnswer('');
    setShowAnswer(false);
  }, [fileText, rawText]);

  const handleBack = useCallback(() => {
    setQuizState(null);
    setSelectedAnswer('');
    setShowAnswer(false);
  }, []);

  // Results screen
  if (quizState?.showResults) {
    const pct = Math.round((quizState.score / quizState.questions.length) * 100);
    const msg = pct >= 80 ? 'Luar biasa!' : pct >= 60 ? 'Bagus!' : pct >= 40 ? 'Terus belajar!' : 'Jangan menyerah!';
    return (
      <div className="space-y-6">
        <div className="glass-card p-8 text-center space-y-4">
            <h2 className="text-2xl font-bold text-white">{msg}</h2>
          <div className="flex items-center justify-center gap-8">
            <div className="text-center">
              <div className="text-3xl font-bold ">{quizState.score}/{quizState.questions.length}</div>
              <div className="text-xs text-zinc-500 mt-1">Jawaban Benar</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-white">{pct}%</div>
              <div className="text-xs text-zinc-500 mt-1">Akurasi</div>
            </div>
          </div>
          <div className="w-full h-2 rounded-full bg-white/[0.06] mt-4">
            <div className="h-full rounded-full bg-gradient-to-r from-[#38BDF8] to-[#F687B3] transition-colors" style={{ width: pct + '%' }} />
          </div>
        </div>
        <div className="glass-card p-6 space-y-3 max-h-96 overflow-y-auto">
          <h3 className="text-sm font-semibold text-zinc-300">Ringkasan Jawaban</h3>
          {quizState.questions.map((q, i) => {
            const userAns = quizState.answers[q.id] || '-';
            const isCorrect = userAns.toLowerCase() === q.correctAnswer.toLowerCase();
            return (
              <div key={q.id} className={cn('flex items-start gap-3 p-3 rounded-lg text-sm',
                isCorrect ? 'bg-green-500/5 border border-green-500/10' : 'bg-red-500/5 border border-red-500/10')}>
                {isCorrect ? <CheckCircle className="h-4 w-4 text-green-400 mt-0.5 shrink-0" /> : <XCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-zinc-300 line-clamp-1">{q.question.split('\n').pop()}</p>
                  <p className="text-[11px] text-zinc-600 mt-1">Jawabanmu: <span className={isCorrect ? 'text-green-400' : 'text-red-400'}>{userAns}</span>{!isCorrect && <span className="text-green-400"> → {q.correctAnswer}</span>}</p>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex gap-3">
          <Button onClick={handleRetry} className="flex-1 h-10 rounded-lg bg-gradient-to-r from-[#38BDF8] to-[#a57ce8] text-white font-medium gap-2 hover:shadow-[0_0_20px_rgba(183,148,246,0.3)]">
            <RotateCcw className="h-4 w-4" /> Coba Lagi (Quiz Baru)
          </Button>
          <Button onClick={handleBack} variant="outline" className="h-10 rounded-lg border-white/[0.08] text-zinc-400 hover:text-white hover:bg-white/[0.04]">
            Upload Materi Baru
          </Button>
        </div>
      </div>
    );
  }

  // Quiz playing screen
  if (quizState && !quizState.showResults) {
    const q = quizState.questions[quizState.currentIndex];
    const isAnswered = !!quizState.answers[q.id];
    const isCorrect = selectedAnswer.toLowerCase() === q.correctAnswer.toLowerCase();
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={handleBack} className="text-xs text-zinc-500 hover:text-white transition-colors">Kembali</button>
          <span className="text-xs text-zinc-500">{quizState.currentIndex + 1} / {quizState.questions.length}</span>
        </div>
        <div className="w-full h-1.5 rounded-full bg-white/[0.06]">
          <div className="h-full rounded-full bg-gradient-to-r from-[#38BDF8] to-[#F687B3] transition-colors" style={{ width: ((quizState.currentIndex + 1) / quizState.questions.length) * 100 + '%' }} />
        </div>
        <div className="glass-card p-6 space-y-5">
          <div className="flex items-center gap-2">
            <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full',
              q.type === 'multiple-choice' ? 'bg-zinc-400/10 text-zinc-300 border border-zinc-400/20' :
              q.type === 'true-false' ? 'bg-sky-400/10 text-sky-300 border border-sky-400/20' :
              'bg-[#F687B3]/10 text-[#F687B3] border border-[#F687B3]/20')}>
              {q.type === 'multiple-choice' ? 'Pilihan Ganda' : q.type === 'true-false' ? 'Benar/Salah' : 'Isi Titik-titik'}
            </span>
          </div>
          <p className="text-sm text-white leading-relaxed whitespace-pre-line">{q.question}</p>
          {q.type === 'fill-blank' && !showAnswer && (
            <input
              type="text"
              value={selectedAnswer}
              onChange={e => handleFillBlank(e.target.value)}
              placeholder="Ketik jawaban..."
              className="w-full h-10 rounded-lg bg-white/[0.04] border border-white/[0.08] px-4 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-[#38BDF8]/50 transition-colors"
            />
          )}
          {q.options && (
            <div className="space-y-2">
              {q.options.map((opt, i) => {
                const letter = String.fromCharCode(65 + i);
                const isSelected = selectedAnswer.toLowerCase() === opt.toLowerCase();
                let borderColor = 'border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.04]';
                let textColor = 'text-zinc-300';
                let bgColor = '';
                if (showAnswer) {
                  if (opt.toLowerCase() === q.correctAnswer.toLowerCase()) {
                    borderColor = 'border-green-500/30'; bgColor = 'bg-green-500/10'; textColor = 'text-green-400';
                  } else if (isSelected && !isCorrect) {
                    borderColor = 'border-red-500/30'; bgColor = 'bg-red-500/10'; textColor = 'text-red-400';
                  }
                } else if (isSelected) {
                  borderColor = 'border-[#38BDF8]/40'; bgColor = 'bg-[#38BDF8]/10'; textColor = 'text-[#38BDF8]';
                }
                return (
                  <button key={i} onClick={() => handleAnswer(opt)} disabled={showAnswer}
                    className={cn('w-full flex items-center gap-3 p-3 rounded-lg border text-left text-sm transition-colors', borderColor, textColor, bgColor)}>
                    <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-medium',
                      isSelected ? 'bg-[#38BDF8]/20 text-[#38BDF8]' : 'bg-white/[0.04] text-zinc-500')}>{letter}</span>
                    {opt}
                  </button>
                );
              })}
            </div>
          )}
          {showAnswer && (
            <div className={cn('p-3 rounded-lg text-sm', isCorrect ? 'bg-green-500/5 border border-green-500/10' : 'bg-red-500/5 border border-red-500/10')}>
              <div className="flex items-center gap-2 mb-1">
                {isCorrect ? <CheckCircle className="h-4 w-4 text-green-400" /> : <XCircle className="h-4 w-4 text-red-400" />}
                <span className={isCorrect ? 'text-green-400 font-medium' : 'text-red-400 font-medium'}>{isCorrect ? 'Benar!' : 'Salah!'}</span>
              </div>
              <p className="text-zinc-400 text-xs leading-relaxed">{q.explanation}</p>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between">
          <button onClick={handlePrev} disabled={quizState.currentIndex <= 0}
            className={cn('flex items-center gap-1.5 text-xs text-zinc-500 hover:text-white transition-colors', quizState.currentIndex <= 0 && 'opacity-30 pointer-events-none')}>
            <ChevronLeft className="h-4 w-4" /> Sebelumnya
          </button>
          <div className="flex gap-2">
            {!showAnswer && selectedAnswer && (
              <Button onClick={handleCheck} className="h-9 rounded-lg bg-gradient-to-r from-[#38BDF8] to-[#a57ce8] text-white text-xs font-medium gap-1.5 hover:shadow-[0_0_20px_rgba(183,148,246,0.3)]">
                <CheckCircle className="h-3.5 w-3.5" /> Cek Jawaban
              </Button>
            )}
            {showAnswer && (
              <Button onClick={handleNext} className="h-9 rounded-lg bg-gradient-to-r from-[#38BDF8] to-[#a57ce8] text-white text-xs font-medium gap-1.5 hover:shadow-[0_0_20px_rgba(183,148,246,0.3)]">
                {quizState.currentIndex >= quizState.questions.length - 1 ? 'Lihat Hasil' : 'Selanjutnya'}
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Upload/generate screen
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Target className="h-5 w-5 text-[#38BDF8]" />
          <h2 className="text-lg font-bold text-white">Quiz Generator</h2>
        </div>
        <p className="text-sm text-zinc-500">Upload materi teks, lalu generate quiz otomatis untuk menguji pemahamanmu.</p>
      </div>

      <div className="glass-card p-6 space-y-4">
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <FileText className="h-4 w-4 text-[#38BDF8]" />
          <span>Upload file teks (.txt, .md, .csv)</span>
        </div>
        <input ref={fileRef} type="file" accept=".txt,.md,.csv" className="hidden" onChange={e => e.target.files?.[0] && extractTextFromFile(e.target.files[0])} />
        <Button onClick={() => fileRef.current?.click()} variant="outline" className="w-full h-10 rounded-lg border-dashed border-white/[0.08] text-zinc-400 hover:text-white hover:border-[#38BDF8]/30 hover:bg-[#38BDF8]/5 gap-2">
          <Upload className="h-4 w-4" />
          {fileName || 'Pilih file...'}
        </Button>
        {fileName && <p className="text-[11px] text-zinc-600">✓ {fileName} loaded ({fileText.split(/\s+/).length} kata)</p>}

        <div className="relative">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/[0.04]" /></div>
          <div className="relative flex justify-center text-xs"><span className="bg-[#161616] px-2 text-zinc-600">atau paste teks langsung</span></div>
        </div>

        <textarea
          value={rawText}
          onChange={e => setRawText(e.target.value)}
          placeholder="Paste materi belajar di sini... (minimal 50 kata)"
          rows={6}
          className="w-full rounded-lg bg-white/[0.03] border border-white/[0.06] px-4 py-3 text-sm text-white placeholder:text-zinc-700 focus:outline-none focus:border-[#38BDF8]/30 transition-colors resize-none"
        />

        <Button onClick={handleGenerate} disabled={generating} className="w-full h-10 rounded-lg bg-gradient-to-r from-[#38BDF8] to-[#F687B3] text-white font-medium gap-2 hover:shadow-[0_0_20px_rgba(183,148,246,0.3)]">
          {generating ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating...</> : <><Sparkles className="h-4 w-4" /> Generate 10 Soal Quiz</>}
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Pilihan Ganda', desc: 'Soal multi-choice otomatis' },
          { label: 'Benar/Salah', desc: 'Tebak benar atau salah' },
          { label: 'Isi Titik-titik', desc: 'Lengkapi kalimat' },
        ].map(f => (
          <div key={f.label} className="glass-card-sm p-3 text-center space-y-1">
            <div className="text-xs font-medium text-zinc-300">{f.label}</div>
            <div className="text-[10px] text-zinc-600">{f.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
