import { describe, it, expect, beforeEach } from 'vitest';
import { TeacherPersonality } from './TeacherPersonality';

describe('TeacherPersonality', () => {
  let personality: TeacherPersonality;

  beforeEach(() => {
    personality = new TeacherPersonality();
  });

  it('should default to beginner mode', () => {
    expect(personality.getMode()).toBe('beginner');
    const profile = personality.getProfile();
    expect(profile.baseErrorThreshold).toBe(30);
    expect(profile.phraseStyle).toBe('expressive');
  });

  it('should switch to advanced mode and update profile', () => {
    personality.setMode('advanced');
    expect(personality.getMode()).toBe('advanced');
    
    const profile = personality.getProfile();
    expect(profile.baseErrorThreshold).toBe(15);
    expect(profile.phraseStyle).toBe('technical');
    expect(profile.correctionFrequency).toBe('strict');
  });

  it('should calculate severity thresholds correctly', () => {
    // Beginner mode (base 30)
    let thresholds = personality.getSeverityThresholds();
    expect(thresholds.mild).toBe(30);
    expect(thresholds.moderate).toBe(40);
    expect(thresholds.severe).toBe(50);

    // Advanced mode (base 15)
    personality.setMode('advanced');
    thresholds = personality.getSeverityThresholds();
    expect(thresholds.mild).toBe(15);
    expect(thresholds.moderate).toBe(25);
    expect(thresholds.severe).toBe(35);
  });
});
