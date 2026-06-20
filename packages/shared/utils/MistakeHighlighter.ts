import type { PoseLandmark } from '../types/pose';

export interface CorrectionArrow {
  jointIndex: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  angle: number;
  errorMagnitude: number;
}

/**
 * Calculates directional arrows pointing from the user's incorrect joint 
 * towards the reference's correct joint position.
 */
export function generateCorrectionArrows(
  userPose: PoseLandmark[],
  refPose: PoseLandmark[],
  errorThreshold: number = 0.04 // Normalized distance threshold (~4% of frame)
): CorrectionArrow[] {
  const arrows: CorrectionArrow[] = [];
  
  // Only highlight key joints that users can consciously control
  const keyJoints = [13, 14, 15, 16, 25, 26, 27, 28]; // Elbows, wrists, knees, ankles
  
  // Need root joints to align the skeletons
  const uHipL = userPose[23], uHipR = userPose[24];
  const rHipL = refPose[23], rHipR = refPose[24];
  
  if (!uHipL || !uHipR || !rHipL || !rHipR) return arrows;

  const uMidHipX = (uHipL.x + uHipR.x) / 2;
  const uMidHipY = (uHipL.y + uHipR.y) / 2;
  
  const rMidHipX = (rHipL.x + rHipR.x) / 2;
  const rMidHipY = (rHipL.y + rHipR.y) / 2;
  
  for (const idx of keyJoints) {
    const u = userPose[idx];
    const r = refPose[idx];
    
    if (!u || !r || (u.visibility || 1) < 0.5 || (r.visibility || 1) < 0.5) continue;
    
    // Translate reference joint to user's coordinate space (aligning by root hip)
    const rAlignedX = r.x - rMidHipX + uMidHipX;
    const rAlignedY = r.y - rMidHipY + uMidHipY;
    
    const dx = rAlignedX - u.x;
    const dy = rAlignedY - u.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist > errorThreshold) {
      arrows.push({
        jointIndex: idx,
        startX: u.x,
        startY: u.y,
        endX: rAlignedX,
        endY: rAlignedY,
        angle: Math.atan2(dy, dx),
        errorMagnitude: dist
      });
    }
  }
  
  // Sort arrows by magnitude to draw the most critical ones last (on top)
  arrows.sort((a, b) => a.errorMagnitude - b.errorMagnitude);
  
  // Return top 2 biggest mistakes to avoid visual clutter
  return arrows.slice(-2);
}
