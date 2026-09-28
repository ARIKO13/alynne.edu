/**
 * keyboard-shortcuts.ts — Global keyboard shortcuts for ALYNNE
 *
 * Shortcuts:
 *   Ctrl+R  → Start/Stop recording
 *   Ctrl+S  → Save transcript to Knowledge Hub
 *   Ctrl+M  → Open Mode Belajar
 *   Ctrl+F  → Open Flashcard
 *   Ctrl+N  → Open Scratchpad
 *   Ctrl+H  → Open Knowledge Hub
 *   Ctrl+?  → Show shortcuts help
 *   Esc     → Close dialogs
 */

export interface ShortcutConfig {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  label: string;
  description: string;
  action: () => void;
}

const STORAGE_KEY = 'alynne-shortcuts-enabled';

export function isShortcutsEnabled(): boolean {
  if (typeof localStorage === 'undefined') return true;
  return localStorage.getItem(STORAGE_KEY) !== 'false';
}

export function setShortcutsEnabled(enabled: boolean): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
}

export const SHORTCUTS_LIST = [
  { key: 'R', ctrl: true, label: 'Ctrl+R', description: 'Start/Stop recording' },
  { key: 'S', ctrl: true, label: 'Ctrl+S', description: 'Save to Knowledge Hub' },
  { key: 'M', ctrl: true, label: 'Ctrl+M', description: 'Mode Belajar' },
  { key: 'F', ctrl: true, label: 'Ctrl+F', description: 'Flashcard' },
  { key: 'N', ctrl: true, label: 'Ctrl+N', description: 'Scratchpad (Notes)' },
  { key: 'H', ctrl: true, label: 'Ctrl+H', description: 'Knowledge Hub' },
  { key: '/', ctrl: true, label: 'Ctrl+/', description: 'Show shortcuts help' },
  { key: 'Escape', label: 'Esc', description: 'Close dialogs' },
];

/**
 * Register global keyboard shortcuts.
 * Returns cleanup function.
 */
export function registerShortcuts(actions: {
  onToggleRecord?: () => void;
  onSave?: () => void;
  onModeBelajar?: () => void;
  onFlashcard?: () => void;
  onScratchpad?: () => void;
  onHub?: () => void;
  onHelp?: () => void;
}): () => void {
  const handler = (e: KeyboardEvent) => {
    if (!isShortcutsEnabled()) return;

    // Don't trigger when typing in input/textarea
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      if (e.key !== 'Escape') return;
    }

    const ctrl = e.ctrlKey || e.metaKey;

    // Ctrl+R → toggle record
    if (ctrl && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      actions.onToggleRecord?.();
      return;
    }

    // Ctrl+S → save
    if (ctrl && e.key.toLowerCase() === 's') {
      e.preventDefault();
      actions.onSave?.();
      return;
    }

    // Ctrl+M → mode belajar
    if (ctrl && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      actions.onModeBelajar?.();
      return;
    }

    // Ctrl+F → flashcard
    if (ctrl && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      actions.onFlashcard?.();
      return;
    }

    // Ctrl+N → scratchpad
    if (ctrl && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      actions.onScratchpad?.();
      return;
    }

    // Ctrl+H → knowledge hub
    if (ctrl && e.key.toLowerCase() === 'h') {
      e.preventDefault();
      actions.onHub?.();
      return;
    }

    // Ctrl+/ → help
    if (ctrl && e.key === '/') {
      e.preventDefault();
      actions.onHelp?.();
      return;
    }

    // Esc → close (let Dialog handle this)
  };

  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}
