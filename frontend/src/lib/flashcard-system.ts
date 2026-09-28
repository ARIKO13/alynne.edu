/**
 * flashcard-system.ts — Spaced repetition flashcard system
 *
 * Generates flashcards from STT chapters.
 * Uses SM-2 algorithm (same as Anki) for review scheduling.
 *
 * All data stored in localStorage. No server needed.
 */

export interface Flashcard {
  id: string;
  deckId: string;
  front: string;
  back: string;
  // SM-2 algorithm fields
  ease: number;       // ease factor (starts at 2.5)
  interval: number;   // days until next review
  repetitions: number; // number of times reviewed
  nextReview: number;  // timestamp (ms) for next review
  lastReview: number | null;
  createdAt: number;
}

export interface Deck {
  id: string;
  name: string;
  cardCount: number;
  createdAt: number;
}

const STORAGE_KEY = 'alynne-flashcards';
const DECKS_KEY = 'alynne-flashcard-decks';

// ── Storage ──

function loadCards(): Flashcard[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveCards(cards: Flashcard[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
  } catch {}
}

function loadDecks(): Deck[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(DECKS_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveDecks(decks: Deck[]): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(DECKS_KEY, JSON.stringify(decks));
}

// ── Deck Management ──

export function getDecks(): Deck[] {
  return loadDecks();
}

export function createDeck(name: string): Deck {
  const decks = loadDecks();
  const deck: Deck = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    cardCount: 0,
    createdAt: Date.now(),
  };
  decks.push(deck);
  saveDecks(decks);
  return deck;
}

export function deleteDeck(deckId: string): void {
  const decks = loadDecks().filter(d => d.id !== deckId);
  saveDecks(decks);
  const cards = loadCards().filter(c => c.deckId !== deckId);
  saveCards(cards);
}

// ── Card Management ──

export function getCards(deckId?: string): Flashcard[] {
  const cards = loadCards();
  return deckId ? cards.filter(c => c.deckId === deckId) : cards;
}

export function getDueCards(deckId?: string): Flashcard[] {
  const now = Date.now();
  const cards = getCards(deckId);
  return cards.filter(c => c.nextReview <= now);
}

export function addCard(deckId: string, front: string, back: string): Flashcard {
  const cards = loadCards();
  const card: Flashcard = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    deckId,
    front,
    back,
    ease: 2.5,
    interval: 0,
    repetitions: 0,
    nextReview: Date.now(),
    lastReview: null,
    createdAt: Date.now(),
  };
  cards.push(card);

  // Update deck card count
  const decks = loadDecks();
  const deck = decks.find(d => d.id === deckId);
  if (deck) {
    deck.cardCount = cards.filter(c => c.deckId === deckId).length;
    saveDecks(decks);
  }

  saveCards(cards);
  return card;
}

export function deleteCard(cardId: string): void {
  const cards = loadCards().filter(c => c.id !== cardId);
  saveCards(cards);
}

// ── SM-2 Algorithm (Spaced Repetition) ──

export type ReviewQuality = 0 | 1 | 2 | 3 | 4 | 5;
// 0-2: forgot (reset)
// 3: hard (short interval)
// 4: good (normal interval)
// 5: easy (long interval)

export function reviewCard(cardId: string, quality: ReviewQuality): Flashcard | null {
  const cards = loadCards();
  const card = cards.find(c => c.id === cardId);
  if (!card) return null;

  const now = Date.now();

  // SM-2 algorithm
  if (quality < 3) {
    // Forgot — reset
    card.repetitions = 0;
    card.interval = 1;
    card.ease = Math.max(1.3, card.ease - 0.2);
  } else {
    // Remembered
    if (card.repetitions === 0) {
      card.interval = 1;
    } else if (card.repetitions === 1) {
      card.interval = 6;
    } else {
      card.interval = Math.round(card.interval * card.ease);
    }

    card.repetitions += 1;

    // Adjust ease factor
    if (quality === 3) {
      card.ease = Math.max(1.3, card.ease - 0.15);
    } else if (quality === 5) {
      card.ease = card.ease + 0.15;
    }
  }

  card.lastReview = now;
  card.nextReview = now + card.interval * 24 * 60 * 60 * 1000;

  saveCards(cards);
  return card;
}

// ── Auto-generate flashcards from chapters ──

import type { Chapter } from './stt-chapter-splitter';

export function generateFlashcardsFromChapter(chapter: Chapter, deckId: string): Flashcard[] {
  const sentences = chapter.content
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.split(/\s+/).length >= 6);

  const created: Flashcard[] = [];
  const used = new Set<number>();

  // Generate Q&A pairs: take a sentence, remove a key word
  for (let i = 0; i < Math.min(10, sentences.length); i++) {
    let idx = Math.floor(Math.random() * sentences.length);
    while (used.has(idx) && used.size < sentences.length) {
      idx = Math.floor(Math.random() * sentences.length);
    }
    used.add(idx);

    const sentence = sentences[idx];
    const words = sentence.split(/\s+/);

    // Find a key word (5+ chars, not stopword)
    const stopWords = new Set([
      'yang', 'dan', 'atau', 'tidak', 'untuk', 'dengan', 'dari', 'ke', 'di',
      'ini', 'itu', 'ada', 'sudah', 'akan', 'bisa', 'harus', 'lebih',
      'saya', 'kamu', 'dia', 'kami', 'kita', 'mereka', 'pada', 'dalam',
    ]);

    const keyWordIdx = words.findIndex(
      (w, i) => w.length >= 5 && !stopWords.has(w.toLowerCase()) && i > 0 && i < words.length - 1
    );

    if (keyWordIdx === -1) continue;

    const answer = words[keyWordIdx].replace(/[.,!?;:]/g, '');
    if (!answer || answer.length < 4) continue;

    // Front: sentence with blank
    words[keyWordIdx] = '_____';
    const front = `Bab ${chapter.id}: ${words.join(' ')}`;
    const back = answer;

    created.push(addCard(deckId, front, back));
  }

  return created;
}

// ── Stats ──

export function getFlashcardStats(): {
  totalDecks: number;
  totalCards: number;
  dueCards: number;
  learnedCards: number;
  masteryRate: number;
} {
  const cards = loadCards();
  const decks = loadDecks();
  const now = Date.now();
  const due = cards.filter(c => c.nextReview <= now);
  const learned = cards.filter(c => c.repetitions >= 3);

  return {
    totalDecks: decks.length,
    totalCards: cards.length,
    dueCards: due.length,
    learnedCards: learned.length,
    masteryRate: cards.length > 0 ? Math.round((learned.length / cards.length) * 100) : 0,
  };
}
