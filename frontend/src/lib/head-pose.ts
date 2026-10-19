/**
 * head-pose.ts v2 — Face aspect ratio for nunduk detection.
 *
 * v2 fix: OLD pitch formula was wrong — never produced values < -15°,
 * so lookingDown was ALWAYS false. Now uses face aspect ratio
 * (height/width) which is normalized by face width = invariant to
 * camera distance.
 *
 * Head straight: face is TALL → ratio > 1.0 → attentive
 * Head down (nunduk): face appears SHORT → ratio < 1.0 → lookingDown
 */

import type { FaceLandmark, FaceMeshResult } from './face-mesh';

export interface HeadPose {
  pitch: number;
  eyeOpenness: { left: number; right: number };
  eyesClosed: boolean;
  lookingDown: boolean;
  attentive: boolean;
}

export function computeHeadPose(result: FaceMeshResult): HeadPose | null {
  if (!result.detected || !result.landmarks || result.landmarks.length < 468) {
    return null;
  }
  const lm = result.landmarks;

  const forehead = lm[10];
  const chin = lm[152];
  const leftCheek = lm[234];
  const rightCheek = lm[454];

  // Face aspect ratio (height / width) — KEY signal for nunduk
  const faceHeight = Math.abs(chin.y - forehead.y);
  const faceWidth = Math.abs(rightCheek.x - leftCheek.x);
  const aspectRatio = faceHeight / (faceWidth + 0.001);

  // ratio > 1.0 = face taller than wide = head up (attentive)
  // ratio < 1.0 = face shorter than wide = head down (nunduk)
  const lookingDown = aspectRatio < 1.0;
  const pitch = Math.round((aspectRatio - 1.5) * 50);

  // Eye Aspect Ratio
  const computeEAR = (points: FaceLandmark[]): number => {
    const v1 = Math.sqrt((points[1].x - points[5].x) ** 2 + (points[1].y - points[5].y) ** 2);
    const v2 = Math.sqrt((points[2].x - points[4].x) ** 2 + (points[2].y - points[4].y) ** 2);
    const h = Math.sqrt((points[0].x - points[3].x) ** 2 + (points[0].y - points[3].y) ** 2);
    return (v1 + v2) / (2 * h + 0.001);
  };

  const leftEye = [lm[33], lm[160], lm[158], lm[133], lm[153], lm[144]];
  const rightEye = [lm[263], lm[387], lm[385], lm[362], lm[380], lm[373]];
  const leftEAR = computeEAR(leftEye);
  const rightEAR = computeEAR(rightEye);
  const eyesClosed = leftEAR < 0.15 && rightEAR < 0.15;
  const attentive = !eyesClosed && !lookingDown;

  return { pitch, eyeOpenness: { left: leftEAR, right: rightEAR }, eyesClosed, lookingDown, attentive };
}
