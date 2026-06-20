import { describe, it, expect } from 'vitest';
import { generateCorrectionArrows } from './MistakeHighlighter';
import type { PoseLandmark } from '../types/pose';

const createMockPose = (): PoseLandmark[] => {
  const pose = Array(33).fill(null).map(() => ({ x: 0, y: 0, z: 0, visibility: 1.0 }));
  // Set hips so root alignment works
  pose[23] = { x: 0.5, y: 0.5, z: 0, visibility: 1.0 }; // Left Hip
  pose[24] = { x: 0.6, y: 0.5, z: 0, visibility: 1.0 }; // Right Hip
  return pose;
};

describe('MistakeHighlighter', () => {
  it('should not generate arrows if poses exactly match', () => {
    const userPose = createMockPose();
    const refPose = createMockPose();
    
    // Left wrist
    userPose[15] = { x: 0.2, y: 0.2, visibility: 1.0 };
    refPose[15] = { x: 0.2, y: 0.2, visibility: 1.0 };
    
    const arrows = generateCorrectionArrows(userPose, refPose, 0.05);
    expect(arrows.length).toBe(0);
  });

  it('should generate an arrow if a key joint is significantly off', () => {
    const userPose = createMockPose();
    const refPose = createMockPose();
    
    // Left wrist
    userPose[15] = { x: 0.2, y: 0.2, visibility: 1.0 };
    refPose[15] = { x: 0.4, y: 0.4, visibility: 1.0 };
    
    const arrows = generateCorrectionArrows(userPose, refPose, 0.05);
    expect(arrows.length).toBe(1);
    expect(arrows[0].jointIndex).toBe(15);
    expect(arrows[0].errorMagnitude).toBeGreaterThan(0.2);
  });

  it('should align the reference to the user root before calculating', () => {
    const userPose = createMockPose();
    const refPose = createMockPose();
    
    // Shift the reference's entire body by +0.3 in X
    for (let i = 0; i < 33; i++) {
      refPose[i].x += 0.3;
    }
    
    // Check wrist specifically (already handled by loop)
    // Absolute distance is 0.3 for everything, relative is 0.
    
    // Even though absolute distance is 0.3, the relative distance is 0, so no arrows
    const arrows = generateCorrectionArrows(userPose, refPose, 0.05);
    expect(arrows.length).toBe(0);
  });
  
  it('should ignore joints with low visibility', () => {
    const userPose = createMockPose();
    const refPose = createMockPose();
    
    userPose[15] = { x: 0.2, y: 0.2, visibility: 0.1 }; // Occluded
    refPose[15] = { x: 0.4, y: 0.4, visibility: 1.0 };
    
    const arrows = generateCorrectionArrows(userPose, refPose, 0.05);
    expect(arrows.length).toBe(0);
  });
});
