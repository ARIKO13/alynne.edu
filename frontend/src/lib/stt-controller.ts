/**
 * STT Controller — module-level singleton.
 *
 * Why: The `useSpeechRecognition` hook lives inside <STTPanel/>. We want to
 * keep STTPanel mounted across tab switches (so recording survives), but we
 * also want a global "Stop Recording" button in the app header that can stop
 * recording from any tab without navigating back to STT.
 *
 * Pattern: STTPanel's hook registers its `stopRecording` function here on mount.
 * The header imports `stopSttRecording()` and calls it directly. No prop drilling,
 * no second hook instance, no store changes.
 *
 * The functions are no-ops if STTPanel hasn't mounted yet (e.g., before login).
 */

type StopFn = () => void | Promise<void>;

let stopFn: StopFn | null = null;

export function registerSttStop(fn: StopFn): void {
  stopFn = fn;
}

export function unregisterSttStop(): void {
  stopFn = null;
}

/**
 * Stop the active STT recording, if any.
 * Safe to call from anywhere — returns early if no recording is active.
 */
export function stopSttRecording(): void {
  if (stopFn) {
    try {
      stopFn();
    } catch (e) {
      console.warn('[stt-controller] stop failed:', e);
    }
  }
}

/**
 * Check whether a stop handler is registered (i.e., STTPanel is mounted).
 * Useful for the header to know whether the Stop button should be enabled.
 */
export function isSttRegistered(): boolean {
  return stopFn !== null;
}
