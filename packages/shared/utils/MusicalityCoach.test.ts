import { describe, it, expect, beforeEach } from 'vitest';
import { MusicalityCoach } from './MusicalityCoach';
import type { PoseFrame } from '../types/pose';
import type { Landmark } from '@mediapipe/tasks-vision';

describe('MusicalityCoach', () => {
  let coach: MusicalityCoach;

  beforeEach(() => {
    coach = new MusicalityCoach();
  });

  // Helper to create a dummy frame where only joint 0 moves along x axis
  const createFrame = (xOffset: number): PoseFrame => {
    const landmarks = Array(33).fill({ x: 0, y: 0, z: 0, visibility: 1 }) as Landmark[];
    landmarks[0] = { x: xOffset, y: 0, z: 0, visibility: 1 };
    return {
      timestamp: 0,
      landmarks
    };
  };

  it('should extract a 1D velocity profile from pose frames', () => {
    const frames = [
      createFrame(0),
      createFrame(10), // moved 10 units
      createFrame(20), // moved 10 units
      createFrame(25), // moved 5 units
      createFrame(25)  // moved 0 units
    ];

    const vel = coach.extractVelocityProfile(frames);
    
    expect(vel.length).toBe(5);
    expect(vel[0]).toBe(0); // always 0 for first frame
    expect(vel[1]).toBe(10);
    expect(vel[2]).toBe(10);
    expect(vel[3]).toBe(5);
    expect(vel[4]).toBe(0);
  });

  it('should return null lag if inputs are empty', () => {
    expect(coach.crossCorrelate([], [])).toBeNull();
  });

  it('should return null if user stood perfectly still (no variance)', () => {
    const ref = [0, 5, 10, 5, 0];
    const user = [0, 0, 0, 0, 0]; // Still
    expect(coach.crossCorrelate(ref, user)).toBeNull();
  });

  it('should return 0 lag if profiles are identical', () => {
    // Both hit the beat exactly at frame index 3
    const ref = [0, 0, 0, 10, 0, 0];
    const user = [0, 0, 0, 10, 0, 0];
    expect(coach.crossCorrelate(ref, user)).toBe(0);
  });

  it('should return positive lag if user is lagging behind', () => {
    const ref = [0, 0, 10, 0, 0, 0]; // beat hits at index 2
    const user = [0, 0, 0, 0, 10, 0]; // user hits at index 4 (late by 2 frames)
    
    // User is 2 frames late. Lag should be +2.
    const lag = coach.crossCorrelate(ref, user, 10);
    expect(lag).toBe(2);
  });

  it('should return negative lag if user is rushing', () => {
    const ref = [0, 0, 0, 10, 0, 0]; // beat hits at index 3
    const user = [0, 10, 0, 0, 0, 0]; // user hits at index 1 (early by 2 frames)
    
    // User is 2 frames early. Lag should be -2.
    const lag = coach.crossCorrelate(ref, user, 10);
    expect(lag).toBe(-2);
  });

  it('should provide correct verbal feedback based on lag', () => {
    // 30fps -> 1 frame = 33ms
    
    // Within 150ms (e.g. 3 frames)
    expect(coach.getTimingFeedback(2, 30)).toBeNull();
    expect(coach.getTimingFeedback(-4, 30)).toBeNull(); 
    // Wait, 4 frames at 30fps is 133ms. So it should still be null.
    
    // Dragging (positive lag > 150ms) -> e.g. 6 frames = 200ms
    expect(coach.getTimingFeedback(6, 30)).toMatch(/dragging behind/i);

    // Rushing (negative lag < -150ms) -> e.g. -6 frames = -200ms
    expect(coach.getTimingFeedback(-6, 30)).toMatch(/rushing ahead/i);
  });
});
