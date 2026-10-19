/**
 * head-pose.ts — Compute head pose from MediaPipe Face Mesh landmarks.
 *
 * MediaPipe Face Mesh returns 468 face landmarks. We compute:
 *  - Pitch (head tilt up/down) — KEY signal for "nunduk" detection
 *  - Eye openness (EAR — Eye Aspect Ratio) — for "ngantuk" detection
 *
 * Landmark index reference (MediaPipe Face Mesh canonical):
 *   1   = nose tip
 *   10  = forehead center (top of face)
 *   152 = chin bottom
 *   234 = left cheek (subject's left)
 *   454 = right cheek
 *
 * Eye landmarks (6 points around each eye):
 *   Left eye: 33 (outer), 160 (top-outer), 158 (top-inner), 133 (inner),
 *             153 (bottom-inner), 144 (bottom-outer)
 *   Right eye: 263 (outer), 387 (top-outer), 385 (top-inner), 362 (inner),
 *              380 (bottom-inner), 373 (bottom-outer)
 *
 * EAR (Eye Aspect Ratio) formula:
 *   EAR = (|p2-p6| + |p3-p5|) / (2 * |p1-p4|)
 *   where p1-p6 are the 6 eye landmarks in order.
 *   EAR > 0.20 = eye open
 *   EAR < 0.15 = eye closed (blink or sleeping)
 */

import type { FaceLandmark, FaceMeshResult } from './face-mesh';

export interface HeadPose {
  pitch: number;  // degrees, >0 = head up, <0 = head down (nunduk)
  eyeOpenness: { left: number; right: number };  // 0-0.4 typical range
  eyesClosed: boolean;
  lookingDown: boolean;  // pitch < -15°
  attentive: boolean;   // eyes open AND not looking down
}

/**
 * Compute head pose from Face Mesh result.
 * Returns null if face not detected or insufficient landmarks.
 */
export function computeHeadPose(result: FaceMeshResult): HeadPose | null {
  if (!result.detected || !result.landmarks || result.landmarks.length < 468) {
    return null;
  }
  const lm = result.landmarks;

  // ── 1. Pitch angle (head tilt forward/back) ──
  // Use the ratio of forehead-to-chin distance vs nose-to-chin distance.
  // When head is straight: forehead is far from chin (tall face)
  // When head is down (nunduk): forehead moves toward chin (face appears shorter)
  const nose = lm[1];
  const forehead = lm[10];
  const chin = lm[152];

  const noseChinDist = Math.sqrt(
    (chin.x - nose.x) ** 2 + (chin.y - nose.y) ** 2
  );
  const foreheadChinDist = Math.sqrt(
    (chin.x - forehead.x) ** 2 + (chin.y - forehead.y) ** 2
  );

  // Ratio: forehead-to-chin / nose-to-chin
  // Empirically: ~2.0-2.5 when head straight, ~1.3-1.6 when nunduk
  const pitchRatio = foreheadChinDist / (noseChinDist + 0.001);

  // Convert ratio to approximate degrees:
  //   pitchRatio 2.3 → 0° (straight)
  //   pitchRatio 1.5 → -30° (nunduk)
  // Linear map: degrees = (ratio - 2.3) * 37.5
  //   At 2.3 → 0°, at 1.5 → -30°, at 2.0 → -11°
  const pitch = Math.round((pitchRatio - 2.3) * 37.5);

  // ── 2. Eye Aspect Ratio (EAR) for both eyes ──
  // 6 points around each eye, EAR formula
  const computeEAR = (points: FaceLandmark[]): number => {
    // p1=outer, p2=top-outer, p3=top-inner, p4=inner, p5=bottom-inner, p6=bottom-outer
    const v1 = Math.sqrt(
      (points[1].x - points[5].x) ** 2 + (points[1].y - points[5].y) ** 2
    );
    const v2 = Math.sqrt(
      (points[2].x - points[4].x) ** 2 + (points[2].y - points[4].y) ** 2
    );
    const h = Math.sqrt(
      (points[0].x - points[3].x) ** 2 + (points[0].y - points[3].y) ** 2
    );
    return (v1 + v2) / (2 * h + 0.001);
  };

  const leftEye = [lm[33], lm[160], lm[158], lm[133], lm[153], lm[144]];
  const rightEye = [lm[263], lm[387], lm[385], lm[362], lm[380], lm[373]];

  const leftEAR = computeEAR(leftEye);
  const rightEAR = computeEAR(rightEye);

  // EAR > 0.20 = open, < 0.15 = closed (blink/sleeping)
  const eyesClosed = leftEAR < 0.15 && rightEAR < 0.15;

  // ── 3. Posture classification ──
  const lookingDown = pitch < -15;  // head down > 15° = nunduk
  const attentive = !eyesClosed && !lookingDown;

  return {
    pitch,
    eyeOpenness: { left: leftEAR, right: rightEAR },
    eyesClosed,
    lookingDown,
    attentive,
  };
}
