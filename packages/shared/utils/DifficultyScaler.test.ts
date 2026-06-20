import { describe, it, expect, beforeEach } from 'vitest';
import { DifficultyScaler } from './DifficultyScaler';

describe('DifficultyScaler', () => {
  let scaler: DifficultyScaler;

  beforeEach(() => {
    scaler = new DifficultyScaler(0.5, 1.0);
  });

  it('should initialize with default base values', () => {
    expect(scaler.getPlaybackRate()).toBe(1.0);
    expect(scaler.getErrorThreshold()).toBe(25);
  });

  it('should decrease playback rate and increase threshold after 2 failures', () => {
    // Failure 1
    scaler.evaluateAttempt(30);
    expect(scaler.getPlaybackRate()).toBe(1.0);
    expect(scaler.getErrorThreshold()).toBe(25);

    // Failure 2
    scaler.evaluateAttempt(30);
    expect(scaler.getPlaybackRate()).toBe(0.75); // Dropped by 0.25
    expect(scaler.getErrorThreshold()).toBe(30); // Increased leniency by 5
  });

  it('should increase playback rate and tighten threshold after 2 passes', () => {
    // Force a lower rate first
    scaler.evaluateAttempt(30);
    scaler.evaluateAttempt(30);
    expect(scaler.getPlaybackRate()).toBe(0.75);
    
    // Pass 1
    scaler.evaluateAttempt(90);
    expect(scaler.getPlaybackRate()).toBe(0.75);
    
    // Pass 2
    scaler.evaluateAttempt(90);
    expect(scaler.getPlaybackRate()).toBe(1.0);
    expect(scaler.getErrorThreshold()).toBe(25);
  });

  it('should respect min and max bounds', () => {
    // Fails -> min bound is 0.5
    scaler.evaluateAttempt(30);
    scaler.evaluateAttempt(30); // 0.75
    scaler.evaluateAttempt(30);
    scaler.evaluateAttempt(30); // 0.5
    scaler.evaluateAttempt(30);
    scaler.evaluateAttempt(30); // still 0.5
    expect(scaler.getPlaybackRate()).toBe(0.5);

    // Passes -> max bound is 1.0
    scaler.evaluateAttempt(90);
    scaler.evaluateAttempt(90); // 0.75
    scaler.evaluateAttempt(90);
    scaler.evaluateAttempt(90); // 1.0
    scaler.evaluateAttempt(90);
    scaler.evaluateAttempt(90); // still 1.0
    expect(scaler.getPlaybackRate()).toBe(1.0);
  });

  it('should reset correctly', () => {
    scaler.evaluateAttempt(30);
    scaler.evaluateAttempt(30);
    expect(scaler.getPlaybackRate()).toBe(0.75);
    
    scaler.reset();
    expect(scaler.getPlaybackRate()).toBe(1.0);
    expect(scaler.getErrorThreshold()).toBe(25);
  });
});
