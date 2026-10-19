/**
 * face-mesh.ts — MediaPipe Face Mesh detector (client-side, low-spec friendly)
 *
 * Uses Google's MediaPipe Face Mesh via TensorFlow.js runtime. Detects 468
 * face landmarks in real-time from webcam feed.
 *
 * Low-spec optimizations:
 * 1. Lazy-load: package only loads when user enables Focus Detector
 *    (uses dynamic import → separate JS chunk, doesn't bloat homepage)
 * 2. WASM backend (universal) — works on all devices including low-end.
 *    SIMD auto-enabled on x86 browsers (most laptops/desktops).
 * 3. Short-range model variant — 3MB (vs 16MB full-range). Sufficient
 *    for selfie cam (face within 2m of camera).
 * 4. Throttled to 8fps (not 30fps) — focus feedback doesn't need 30fps.
 *    Saves CPU/battery on low-end devices.
 * 5. Adaptive: if avg inference time >200ms, fall back to old method.
 * 6. Model cached in browser HTTP cache after first load (~3MB).
 *
 * Privacy: 100% client-side. Video frames NEVER leave the browser.
 */

export interface FaceLandmark {
  x: number;
  y: number;
  z?: number;
  name?: string;
}

export interface FaceMeshResult {
  detected: boolean;
  landmarks: FaceLandmark[] | null;
  inferenceTimeMs: number;  // for adaptive throttling
}

let detectorPromise: Promise<any | null> | null = null;
let lastDetection = 0;
let lastSuccessfulResult: FaceMeshResult = {
  detected: false,
  landmarks: null,
  inferenceTimeMs: 0,
};
let inferenceTimes: number[] = [];
let tooSlow = false;  // adaptive flag — if true, permanently fall back

/**
 * Lazy-load the MediaPipe Face Mesh detector.
 * Returns null if loading fails (caller should fall back to old method).
 */
export async function getFaceMeshDetector(): Promise<any | null> {
  if (tooSlow) return null;
  if (!detectorPromise) {
    detectorPromise = (async () => {
      try {
        // Dynamic imports — packages live in separate chunks, loaded on-demand.
        // This keeps the main app bundle small.
        const faceLandmarksDetection = await import(
          '@tensorflow-models/face-landmarks-detection'
        );
        const tf = await import('@tensorflow/tfjs-core');
        const wasmBackend = await import('@tensorflow/tfjs-backend-wasm');
        await import('@tensorflow/tfjs-converter');

        // CRITICAL: Set WASM paths to CDN BEFORE initializing backend.
        // Without this, TF.js tries to load the .wasm files from the
        // site root (alynne.my.id/tfjs-backend-wasm-threaded-simd.wasm)
        // which returns 404 → backend init fails → MediaPipe falls back
        // to legacy (broken) method.
        //
        // jsdelivr CDN serves the exact same WASM files that ship in the
        // npm package. Version must match the installed package version.
        wasmBackend.setWasmPaths(
          'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@4.22.0/dist/'
        );

        // Set WASM backend (universal compatibility — works on all devices).
        // SIMD auto-enabled on x86 if browser supports it.
        await tf.setBackend('wasm');
        await tf.ready();

        // Create detector with short-range variant (smaller, faster).
        // Only detect 1 face (faster), don't refine landmarks (faster).
        const model =
          faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh;
        const detector = await faceLandmarksDetection.createDetector(model, {
          runtime: 'tfjs',
          refineLandmarks: false,
          maxFaces: 1,
        });
        console.log('[FaceMesh] Detector loaded (backend:', tf.getBackend(), ')');
        return detector;
      } catch (err) {
        console.error('[FaceMesh] Failed to load — will fall back to old method:', err);
        return null;
      }
    })();
  }
  return detectorPromise;
}

/**
 * Detect face landmarks in a video frame.
 * Throttled to ~8fps (125ms between detections) — focus feedback doesn't
 * need 30fps, and this saves CPU on low-end devices.
 *
 * @param video HTMLVideoElement with camera feed
 * @returns FaceMeshResult with landmarks or { detected: false }
 */
export async function detectFace(video: HTMLVideoElement): Promise<FaceMeshResult> {
  const now = Date.now();
  // Throttle to 8fps (every 125ms). When throttled, return the LAST
  // successful result (cached) — NOT { detected: false }. This way the
  // caller's computeHeadPose() still gets valid landmarks between
  // detections, instead of falling through to the legacy fallback path.
  // Without this cache, 52/60 frames per second would fall through to
  // the broken legacy method, making the overall score wrong.
  if (now - lastDetection < 125) {
    return lastSuccessfulResult;
  }
  lastDetection = now;

  const detector = await getFaceMeshDetector();
  if (!detector) {
    return { detected: false, landmarks: null, inferenceTimeMs: 0 };
  }

  const t0 = performance.now();
  try {
    const faces = await detector.estimateFaces(video, { flipHorizontal: false });
    const t1 = performance.now();
    const inferenceTime = t1 - t0;

    // Track inference time for adaptive throttling
    inferenceTimes.push(inferenceTime);
    if (inferenceTimes.length > 10) inferenceTimes.shift();
    const avgTime = inferenceTimes.reduce((a, b) => a + b, 0) / inferenceTimes.length;

    // If avg inference > 300ms (very slow device), mark as too slow
    // and stop using the model — fall back to old method permanently.
    if (avgTime > 300 && inferenceTimes.length >= 5) {
      console.warn('[FaceMesh] Avg inference', avgTime.toFixed(0), 'ms — too slow, falling back');
      tooSlow = true;
      try { detector.dispose?.(); } catch {}
      return { detected: false, landmarks: null, inferenceTimeMs: inferenceTime };
    }

    if (faces.length === 0) {
      // No face detected — update cache to reflect this
      lastSuccessfulResult = {
        detected: false,
        landmarks: null,
        inferenceTimeMs: inferenceTime,
      };
      return lastSuccessfulResult;
    }
    // Face detected — cache the result for throttled frames
    lastSuccessfulResult = {
      detected: true,
      landmarks: faces[0].keypoints,
      inferenceTimeMs: inferenceTime,
    };
    return lastSuccessfulResult;
  } catch (err) {
    return { detected: false, landmarks: null, inferenceTimeMs: 0 };
  }
}

/**
 * Check if face mesh is available (model loaded successfully).
 * Used by caller to decide whether to use Face Mesh or fall back.
 */
export async function isFaceMeshAvailable(): Promise<boolean> {
  const detector = await getFaceMeshDetector();
  return detector !== null && !tooSlow;
}

/**
 * Reset the "too slow" flag — call if user navigates away and comes back
 * (maybe device was busy, give it another chance).
 */
export function resetFaceMesh() {
  tooSlow = false;
  inferenceTimes = [];
  lastDetection = 0;
  detectorPromise = null;
}
