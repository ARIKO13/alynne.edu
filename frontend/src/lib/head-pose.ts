/**
 * head-pose.ts v3 — Face aspect ratio + iris-based gaze detection.
 *
 * v2 fix: OLD pitch formula was wrong — never produced values < -15°,
 * so lookingDown was ALWAYS false. Now uses face aspect ratio
 * (height/width) which is normalized by face width = invariant to
 * camera distance.
 *
 * Head straight: face is TALL → ratio > 1.0 → attentive
 * Head down (nunduk): face appears SHORT → ratio < 1.0 → lookingDown
 *
 * v23 fix: ADDED gazeDown via iris landmarks (468-477, only present
 * when face-mesh.ts has refineLandmarks=true). Detects "head upright
 * but eyes looking down at phone in lap" — closes the loophole where
 * user kept body straight but eyes down to play with phone. The OLD
 * lookingDown (face aspect ratio) only catches head BOWED forward, not
 * eye-only gaze direction.
 *
 * Iris position relative to eye opening:
 *   - Looking straight: iris centered in eye (eyeMidY ~ iris.y)
 *   - Looking down (gaze): iris moves below eyeMidY by margin > 25% of
 *     eye height (iris enters lower portion of eye opening)
 *   - Looking up (rare for studying): iris moves above eyeMidY
 */

import type { FaceLandmark, FaceMeshResult } from './face-mesh';

export interface HeadPose {
  pitch: number;
  eyeOpenness: { left: number; right: number };
  eyesClosed: boolean;
  lookingDown: boolean;       // head bowed (aspect ratio based) — v2
  gazeDown: boolean;          // v23: eyes look down (iris position based)
  attentive: boolean;
}

export function computeHeadPose(result: FaceMeshResult): HeadPose | null {
  if (!result.detected || !result.landmarks || result.landmarks.length < 468) {
    return null;
  }
  const lm = result.landmarks;

  // v23: Iris landmarks 468-477 are only present when refineLandmarks=true
  // was set in face-mesh.ts. If model didn't include iris refinement,
  // we gracefully skip gaze detection (gazeDown stays false).
  const hasIris = lm.length >= 478;

  const forehead = lm[10];
  const chin = lm[152];
  const leftCheek = lm[234];
  const rightCheek = lm[454];

  // Face aspect ratio (height / width) — KEY signal for nunduk (head bowed)
  const faceHeight = Math.abs(chin.y - forehead.y);
  const faceWidth = Math.abs(rightCheek.x - leftCheek.x);
  const aspectRatio = faceHeight / (faceWidth + 0.001);

  // ratio > 1.0 = face taller than wide = head up (attentive head pose)
  // ratio < 1.0 = face shorter than wide = head down (nunduk — head bowed)
  const lookingDown = aspectRatio < 1.0;
  const pitch = Math.round((aspectRatio - 1.5) * 50);

  // Eye Aspect Ratio (for eyes-closed / ngantuk detection)
  const computeEAR = (points: FaceLandmark[]): number => {
    const v1 = Math.sqrt((points[1].x - points[5].x) ** 2 + (points[1].y - points[5].y) ** 2);
    const v2 = Math.sqrt((points[2].x - points[4].x) ** 2 + (points[2].y - points[4].y) ** 2);
    const h = Math.sqrt((points[0].x - points[3].x) ** 2 + (points[0].y - points[3].y) ** 2);
    return (v1 + v2) / (2 * h + 0.001);
  };

  // Left eye outline: [outer corner, top outer, top inner, inner corner, bottom inner, bottom outer]
  // = [33, 160, 158, 133, 153, 144]
  // Right eye outline: [263, 387, 385, 362, 380, 373]
  const leftEye = [lm[33], lm[160], lm[158], lm[133], lm[153], lm[144]];
  const rightEye = [lm[263], lm[387], lm[385], lm[362], lm[380], lm[373]];
  const leftEAR = computeEAR(leftEye);
  const rightEAR = computeEAR(rightEye);
  const eyesClosed = leftEAR < 0.15 && rightEAR < 0.15;

  // ── v23: Gaze down detection via iris position ──
  // Iris landmark indices (only available with refineLandmarks=true):
  //   468 = left iris center, 473 = right iris center
  // Eye top/bottom landmarks:
  //   160 (left top outer), 158 (left top inner), 144 (left bottom outer), 153 (left bottom inner)
  //   387 (right top outer), 385 (right top inner), 373 (right bottom outer), 380 (right bottom inner)
  let gazeDown = false;
  if (hasIris && lm[468] && lm[473]) {
    const leftIrisY = lm[468].y;
    const rightIrisY = lm[473].y;

    // Eye vertical midpoint (average of top outer & bottom outer)
    const leftEyeTopY = lm[160].y;
    const leftEyeBotY = lm[144].y;
    const rightEyeTopY = lm[387].y;
    const rightEyeBotY = lm[373].y;
    const leftEyeMidY = (leftEyeTopY + leftEyeBotY) / 2;
    const rightEyeMidY = (rightEyeTopY + rightEyeBotY) / 2;
    const leftEyeHeight = Math.abs(leftEyeBotY - leftEyeTopY);
    const rightEyeHeight = Math.abs(rightEyeBotY - rightEyeTopY);

    // Threshold: iris must be > 25% of eye height below midpoint
    // to qualify as "looking down". This avoids false-positives from
    // natural eye movement / slight glances. Require BOTH eyes for
    // robustness (one eye might be off due to landmark noise).
    const GAZE_DOWN_THRESHOLD = 0.25;
    const leftGazeDown = (leftIrisY - leftEyeMidY) > (leftEyeHeight * GAZE_DOWN_THRESHOLD);
    const rightGazeDown = (rightIrisY - rightEyeMidY) > (rightEyeHeight * GAZE_DOWN_THRESHOLD);
    gazeDown = leftGazeDown && rightGazeDown;
  }

  // v23: attentive now requires NO head bowed AND NO eyes-closed AND NO gaze-down
  // (previously only checked head bowed + eyes-closed, missing the gaze-down loophole)
  const attentive = !eyesClosed && !lookingDown && !gazeDown;

  return {
    pitch,
    eyeOpenness: { left: leftEAR, right: rightEAR },
    eyesClosed,
    lookingDown,
    gazeDown,
    attentive,
  };
}
