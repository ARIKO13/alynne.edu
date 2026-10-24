/**
 * face-mesh.ts — MediaPipe Face Mesh detector (v2 — non-blocking)
 *
 * v2 fix: getDetectorSync() returns loaded detector or null WITHOUT
 * awaiting. detectFace() uses sync check instead of await getFaceMeshDetector().
 * This prevents the check loop from blocking for 3s during model loading.
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
  inferenceTimeMs: number;
}

let detectorPromise: Promise<any | null> | null = null;
let loadedDetector: any | null = null;
let lastDetection = 0;
let lastSuccessfulResult: FaceMeshResult = {
  detected: false,
  landmarks: null,
  inferenceTimeMs: 0,
};
let inferenceTimes: number[] = [];
let tooSlow = false;
// v25: configurable iris refinement. 'akurat' mode (default) enables iris
// landmarks (468-477) for gaze-down detection. 'stabil' mode disables
// refinement — model is smaller (~3-5MB vs ~5-8MB), inference is faster,
// but computeHeadPose.gazeDown will always return false (graceful skip).
// Must be set BEFORE getFaceMeshDetector() is called for the first time.
let refineLandmarksEnabled = true;

/** v25: Set iris refinement preference. Must be called before first
 *  getFaceMeshDetector() call to take effect. If called after model is
 *  already loaded, the change will only apply on next reload/reload-model
 *  cycle (e.g., when resetFaceMesh() is called and model re-loads). */
export function setRefineLandmarks(enabled: boolean): void {
  refineLandmarksEnabled = enabled;
}

export async function getFaceMeshDetector(): Promise<any | null> {
  if (tooSlow) return null;
  if (!detectorPromise) {
    detectorPromise = (async () => {
      try {
        const faceLandmarksDetection = await import(
          '@tensorflow-models/face-landmarks-detection'
        );
        const tf = await import('@tensorflow/tfjs-core');
        const wasmBackend = await import('@tensorflow/tfjs-backend-wasm');
        await import('@tensorflow/tfjs-converter');

        wasmBackend.setWasmPaths(
          'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@4.22.0/dist/'
        );

        await tf.setBackend('wasm');
        await tf.ready();

        const model = faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh;
        const detector = await faceLandmarksDetection.createDetector(model, {
          runtime: 'tfjs',
          // v23: enable iris refinement. Adds 10 landmarks (468-477) for
          // iris/pupil position. Needed for gaze-down detection in head-pose.ts
          // to catch the "head upright but eyes looking down at phone" loophole.
          // v25: now configurable via setRefineLandmarks(). 'stabil' mode
          // disables this to halve model size + speed up inference (at the
          // cost of gaze detection — computeHeadPose gracefully skips iris
          // logic when refineLandmarks is off).
          refineLandmarks: refineLandmarksEnabled,
          maxFaces: 1,
        });
        loadedDetector = detector;
        console.log('[FaceMesh] Detector loaded (backend:', tf.getBackend(), ')');
        return detector;
      } catch (err) {
        console.error('[FaceMesh] Failed to load:', err);
        return null;
      }
    })();
  }
  return detectorPromise;
}

/** SYNC check — returns loaded detector or null WITHOUT awaiting. */
export function getDetectorSync(): any | null {
  if (tooSlow) return null;
  return loadedDetector;
}

let detectCanvas: HTMLCanvasElement | null = null;
let detectCtx: CanvasRenderingContext2D | null = null;
let debugLogCounter = 0;

export async function detectFace(video: HTMLVideoElement): Promise<FaceMeshResult> {
  const now = Date.now();
  if (now - lastDetection < 125) {
    return lastSuccessfulResult;
  }
  lastDetection = now;

  // v2: sync check — don't await model loading.
  const detector = getDetectorSync();
  if (!detector) {
    return { detected: false, landmarks: null, inferenceTimeMs: 0 };
  }

  // v4: Draw video to canvas and pass CANVAS to estimateFaces.
  // Passing video element directly can fail when readyState = 2 but
  // the internal video frame buffer hasn't fully synced with the
  // element. Canvas approach guarantees valid pixel data.
  if (!detectCanvas) {
    detectCanvas = document.createElement('canvas');
    detectCanvas.width = 320;
    detectCanvas.height = 240;
    detectCtx = detectCanvas.getContext('2d', { willReadFrequently: true });
  }
  if (!detectCtx || !video.videoWidth) {
    return { detected: false, landmarks: null, inferenceTimeMs: 0 };
  }
  detectCtx.drawImage(video, 0, 0, 320, 240);

  const t0 = performance.now();
  try {
    const faces = await detector.estimateFaces(detectCanvas, { flipHorizontal: false });
    const t1 = performance.now();
    const inferenceTime = t1 - t0;

    // Debug: log every 4th detection (~every 500ms at 8fps)
    debugLogCounter++;
    if (debugLogCounter % 4 === 0) {
      console.log('[FaceMesh] faces:', faces.length,
        'inference:', inferenceTime.toFixed(0) + 'ms',
        'videoW:', video.videoWidth,
        'readyState:', video.readyState);
    }

    inferenceTimes.push(inferenceTime);
    if (inferenceTimes.length > 10) inferenceTimes.shift();
    const avgTime = inferenceTimes.reduce((a, b) => a + b, 0) / inferenceTimes.length;

    if (avgTime > 300 && inferenceTimes.length >= 5) {
      console.warn('[FaceMesh] Too slow, falling back');
      tooSlow = true;
      loadedDetector = null;
      try { detector.dispose?.(); } catch {}
      return { detected: false, landmarks: null, inferenceTimeMs: inferenceTime };
    }

    if (faces.length === 0) {
      lastSuccessfulResult = { detected: false, landmarks: null, inferenceTimeMs: inferenceTime };
      return lastSuccessfulResult;
    }

    // v4: Log landmark count to verify format
    const kps = faces[0].keypoints || faces[0].landmarks || [];
    if (debugLogCounter % 4 === 0) {
      console.log('[FaceMesh] keypoints:', kps.length, 'first:', kps[0]);
    }

    lastSuccessfulResult = { detected: true, landmarks: kps, inferenceTimeMs: inferenceTime };
    return lastSuccessfulResult;
  } catch (err) {
    console.warn('[FaceMesh] Detection error:', err instanceof Error ? err.message : String(err));
    return { detected: false, landmarks: null, inferenceTimeMs: 0 };
  }
}

export async function isFaceMeshAvailable(): Promise<boolean> {
  getFaceMeshDetector();
  return loadedDetector !== null && !tooSlow;
}

export function resetFaceMesh() {
  tooSlow = false;
  loadedDetector = null;
  inferenceTimes = [];
  lastDetection = 0;
  lastSuccessfulResult = { detected: false, landmarks: null, inferenceTimeMs: 0 };
  detectorPromise = null;
}
