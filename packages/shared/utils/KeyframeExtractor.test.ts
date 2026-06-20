import { describe, it, expect } from 'vitest';
import { extractKeyframes } from './KeyframeExtractor';
import type { PoseFrame } from '../types/pose';

const generateMockMotion = (): PoseFrame[] => {
  const frames: PoseFrame[] = [];
  
  // Create 100 frames
  for (let i = 0; i < 100; i++) {
    // We'll simulate a sweeping arm motion where the velocity peaks at frame 25 and 75
    // E.g. x position follows a sine wave, so velocity is a cosine wave (peaks at zero-crossings)
    const xPos = Math.sin(i / 100 * Math.PI * 2);
    
    frames.push({
      timestamp_ms: i * 33, // 30fps
      landmarks: Array(33).fill({ x: xPos, y: 0, z: 0, visibility: 1.0 })
    });
  }
  return frames;
};

describe('KeyframeExtractor', () => {
  it('should fallback to equidistant sampling if not enough peaks are found', () => {
    // Frames with zero motion
    const frames: PoseFrame[] = Array(100).fill({
      timestamp_ms: 0,
      landmarks: Array(33).fill({ x: 0, y: 0, z: 0, visibility: 1.0 })
    }).map((f, i) => ({ ...f, timestamp_ms: i * 33 }));

    const keyframes = extractKeyframes(frames, 4);
    
    // The fallback logic samples at [20, 40, 60, 80] indices for 100 frames and count 4
    expect(keyframes.length).toBe(4);
    expect(keyframes[0].timestamp_ms).toBe(20 * 33);
    expect(keyframes[3].timestamp_ms).toBe(80 * 33);
  });

  it('should extract peaks from a motion sequence', () => {
    const frames = generateMockMotion();
    const keyframes = extractKeyframes(frames, 2);
    
    expect(keyframes.length).toBeGreaterThan(0);
    // Because velocity is derivative of position, we expect peaks where motion changes rapidly.
  });
});
