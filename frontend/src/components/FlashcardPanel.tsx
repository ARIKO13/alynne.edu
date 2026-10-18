/**
 * FlashcardPanel.tsx — Spaced repetition flashcard UI
 *
 * Features:
 * - Create decks from STT chapters (auto-generate)
 * - Study mode: flip cards, rate difficulty (Again/Hard/Good/Easy)
 * - Stats: total cards, due cards, mastery rate
 * - All client-side, no server
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Layers,
  Plus,
  Trash2,
  RotateCcw,
  Check,
  X,
  AlertCircle,
  Zap,
  Brain,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import {
  getDecks,
  createDeck,
  deleteDeck,
  getCards,
  getDueCards,
  addCard,
  reviewCard,
  generateFlashcardsFromChapter,
  getFlashcardStats,
  type Flashcard,
  type Deck,
  type ReviewQuality,
} from '@/lib/flashcard-system';
import type { Chapter } from '@/lib/stt-chapter-splitter';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface FlashcardPanelProps {
  open: boolean;
  onClose: () => void;
  chapters?: Chapter[];
}

type View = 'decks' | 'study' | 'stats';

export function FlashcardPanel({ open, onClose, chapters = [] }: FlashcardPanelProps) {
  const [view, setView] = useState<View>('decks');
  const [decks, setDecks] = useState<Deck[]>([]);
  const [activeDeck, setActiveDeck] = useState<Deck | null>(null);
  const [dueCards, setDueCards] = useState<Flashcard[]>([]);
  const [currentCardIdx, setCurrentCardIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [stats, setStats] = useState(getFlashcardStats());

  const refresh = useCallback(() => {
    setDecks(getDecks());
    setStats(getFlashcardStats());
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const handleCreateFromChapters = useCallback(async () => {
    if (chapters.length === 0) {
      toast.error('Belum ada bab. Jalankan Mode Belajar dulu.');
      return;
    }

    setGenerating(true);
    await new Promise(r => setTimeout(r, 500));

    const deck = createDeck(`STT Flashcard ${new Date().toLocaleDateString('id-ID')}`);
    for (const ch of chapters) {
      generateFlashcardsFromChapter(ch, deck.id);
    }

    refresh();
    setGenerating(false);
    toast.success(`Deck dibuat dengan ${chapters.length} bab!`);
  }, [chapters, refresh]);

  const handleStudy = useCallback((deck: Deck) => {
    const due = getDueCards(deck.id);
    if (due.length === 0) {
      toast.info('Tidak ada kartu untuk diulang sekarang. Datang lagi nanti!');
      return;
    }
    setActiveDeck(deck);
    setDueCards(due);
    setCurrentCardIdx(0);
    setFlipped(false);
    setView('study');
  }, []);

  const handleReview = useCallback((quality: ReviewQuality) => {
    const card = dueCards[currentCardIdx];
    if (!card) return;

    reviewCard(card.id, quality);

    if (currentCardIdx + 1 >= dueCards.length) {
      // Session complete
      setView('decks');
      setActiveDeck(null);
      refresh();
      toast.success('Sesi ulangan selesai! Kartu dijadwalkan ulang.');
    } else {
      setCurrentCardIdx(i => i + 1);
      setFlipped(false);
    }
  }, [dueCards, currentCardIdx, refresh]);

  if (!open) return null;

  const currentCard = dueCards[currentCardIdx];
  const progress = dueCards.length > 0 ? ((currentCardIdx) / dueCards.length) * 100 : 0;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
        <div className="flex items-center gap-2.5">
          <Layers className="h-5 w-5 text-[#8B5CF6]" />
          <div>
            <h2 className="text-base font-semibold text-zinc-100">Flashcard</h2>
            <p className="text-[11px] text-zinc-500">Kartu hafalan otomatis dari materi STT. Algoritma SM-2 (sama kayak Anki).</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] border-[#8B5CF6]/30 text-[#8B5CF6]">Spaced Repetition</Badge>
          <Button onClick={onClose} variant="ghost" size="sm" className="text-zinc-400 hover:text-white hover:bg-white/[0.04]">
            <X className="h-4 w-4" />
            <span className="ml-1 hidden sm:inline">Tutup</span>
          </Button>
        </div>
      </div>

      <div className="p-5 space-y-5">

        {/* Stats bar */}
        <div className="grid grid-cols-4 gap-2">
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2 text-center">
            <p className="text-base font-bold text-white">{stats.totalDecks}</p>
            <p className="text-[9px] text-zinc-500 uppercase">Deck</p>
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2 text-center">
            <p className="text-base font-bold text-white">{stats.totalCards}</p>
            <p className="text-[9px] text-zinc-500 uppercase">Kartu</p>
          </div>
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.05] p-2 text-center">
            <p className="text-base font-bold text-amber-400">{stats.dueCards}</p>
            <p className="text-[9px] text-zinc-500 uppercase">Due</p>
          </div>
          <div className="rounded-lg border border-green-500/20 bg-green-500/[0.05] p-2 text-center">
            <p className="text-base font-bold text-green-400">{stats.masteryRate}%</p>
            <p className="text-[9px] text-zinc-500 uppercase">Master</p>
          </div>
        </div>

        {/* DECKS VIEW */}
        {view === 'decks' && (
          <div className="space-y-3">
            {/* Create button */}
            <Button
              onClick={handleCreateFromChapters}
              disabled={generating || chapters.length === 0}
              className="w-full bg-[#8B5CF6] hover:bg-[#7C3AED]"
            >
              {generating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating flashcards...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Buat Deck dari {chapters.length} Bab STT
                </>
              )}
            </Button>

            {chapters.length === 0 && (
              <p className="text-[11px] text-zinc-600 text-center">
                Jalankan Mode Belajar dulu untuk generate flashcard dari transcript
              </p>
            )}

            {/* Deck list */}
            <div className="space-y-2">
              {decks.map(deck => {
                const cards = getCards(deck.id);
                const due = cards.filter(c => c.nextReview <= Date.now());
                return (
                  <div
                    key={deck.id}
                    className="group rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 hover:bg-white/[0.04] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-[#8B5CF6]/10 flex items-center justify-center shrink-0">
                        <Layers className="h-4 w-4 text-[#8B5CF6]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-zinc-200 truncate">{deck.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-zinc-500">{deck.cardCount} kartu</span>
                          {due.length > 0 && (
                            <Badge variant="outline" className="text-[9px] border-amber-500/30 text-amber-400">
                              {due.length} due
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          onClick={() => handleStudy(deck)}
                          size="sm"
                          className="bg-[#8B5CF6] hover:bg-[#7C3AED] text-xs"
                          disabled={due.length === 0}
                        >
                          <Zap className="h-3 w-3 mr-1" />
                          Study
                        </Button>
                        <button
                          onClick={() => {
                            deleteDeck(deck.id);
                            refresh();
                            toast.success('Deck dihapus');
                          }}
                          className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 p-1"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {decks.length === 0 && (
                <div className="text-center py-8">
                  <Layers className="h-8 w-8 mx-auto mb-2 text-zinc-700" />
                  <p className="text-sm text-zinc-500">Belum ada deck flashcard</p>
                  <p className="text-[11px] text-zinc-600 mt-1">
                    Klik tombol di atas untuk buat dari materi STT
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* STUDY VIEW */}
        {view === 'study' && currentCard && (
          <div className="space-y-4">
            {/* Progress */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-zinc-500">
                  Kartu {currentCardIdx + 1} / {dueCards.length}
                </span>
                <button
                  onClick={() => { setView('decks'); setActiveDeck(null); }}
                  className="text-zinc-500 hover:text-zinc-300"
                >
                  Exit
                </button>
              </div>
              <Progress value={progress} className="h-1" />
            </div>

            {/* Card */}
            <div
              onClick={() => setFlipped(!flipped)}
              className="cursor-pointer rounded-xl border-2 border-[#8B5CF6]/30 bg-gradient-to-br from-[#8B5CF6]/[0.05] to-zinc-900 p-8 min-h-[200px] flex items-center justify-center text-center transition-all hover:border-[#8B5CF6]/50"
            >
              <div>
                {!flipped ? (
                  <>
                    <p className="text-[10px] text-zinc-500 uppercase mb-3">Pertanyaan</p>
                    <p className="text-base text-zinc-200 leading-relaxed">{currentCard.front}</p>
                    <p className="text-[10px] text-zinc-600 mt-4">Klik untuk balik kartu</p>
                  </>
                ) : (
                  <>
                    <p className="text-[10px] text-green-400 uppercase mb-3">Jawaban</p>
                    <p className="text-2xl font-bold text-green-400">{currentCard.back}</p>
                    <p className="text-[10px] text-zinc-600 mt-4">Pilih tingkat kesulitan di bawah</p>
                  </>
                )}
              </div>
            </div>

            {/* Review buttons (only after flip) */}
            {flipped && (
              <div className="grid grid-cols-4 gap-2">
                <button
                  onClick={() => handleReview(1)}
                  className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-center hover:bg-red-500/20 transition-colors"
                >
                  <X className="h-4 w-4 mx-auto mb-1 text-red-400" />
                  <p className="text-[10px] text-red-400 font-medium">Lupa</p>
                  <p className="text-[8px] text-zinc-600">Ulang besok</p>
                </button>
                <button
                  onClick={() => handleReview(3)}
                  className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-center hover:bg-amber-500/20 transition-colors"
                >
                  <AlertCircle className="h-4 w-4 mx-auto mb-1 text-amber-400" />
                  <p className="text-[10px] text-amber-400 font-medium">Susah</p>
                  <p className="text-[8px] text-zinc-600">1 hari</p>
                </button>
                <button
                  onClick={() => handleReview(4)}
                  className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-center hover:bg-blue-500/20 transition-colors"
                >
                  <Check className="h-4 w-4 mx-auto mb-1 text-blue-400" />
                  <p className="text-[10px] text-blue-400 font-medium">Bagus</p>
                  <p className="text-[8px] text-zinc-600">{currentCard.repetitions === 0 ? '1 hari' : '6 hari'}</p>
                </button>
                <button
                  onClick={() => handleReview(5)}
                  className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-center hover:bg-green-500/20 transition-colors"
                >
                  <Zap className="h-4 w-4 mx-auto mb-1 text-green-400" />
                  <p className="text-[10px] text-green-400 font-medium">Gampang</p>
                  <p className="text-[8px] text-zinc-600">{currentCard.repetitions === 0 ? '6 hari' : `${Math.round(6 * currentCard.ease)} hari`}</p>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
