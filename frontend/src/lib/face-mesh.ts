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
          refineLandmarks: false,
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

export async function detectFace(video: HTMLVideoElement): Promise<FaceMeshResult> {
  const now = Date.now();
  if (now - lastDetection < 125) {
    return lastSuccessfulResult;
  }
  lastDetection = now;

  // v2: sync check — don't await model loading. If not loaded yet,
  // return immediately instead of blocking the check loop.
  const detector = getDetectorSync();
  if (!detector) {
    return { detected: false, landmarks: null, inferenceTimeMs: 0 };
  }

  const t0 = performance.now();
  try {
    const faces = await detector.estimateFaces(video, { flipHorizontal: false });
    const t1 = performance.now();
    const inferenceTime = t1 - t0;

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
    lastSuccessfulResult = { detected: true, landmarks: faces[0].keypoints, inferenceTimeMs: inferenceTime };
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
