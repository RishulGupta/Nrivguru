import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock window for SpeechManager
global.SpeechSynthesisUtterance = class {
  text = '';
  voice = null;
  constructor(text: string) { this.text = text; }
} as any;

global.window = { 
  speechSynthesis: { 
    getVoices: () => [], 
    speak: vi.fn(), 
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    pending: false,
    speaking: false,
    paused: false
  } 
} as any;

// Mock PhraseGenerator
vi.mock('./CorrectionPhraseDB', () => {
  return {
    PhraseGenerator: class {
      getUniquePhrase() { return 'Mocked correction phrase'; }
    }
  };
});

import { CorrectionEngine } from './CorrectionEngine';

describe('CorrectionEngine', () => {
  let engine: CorrectionEngine;

  beforeEach(() => {
    engine = new CorrectionEngine();
  });

  it('should ignore mild deviations below threshold', () => {
    engine.analyze([
      { name: 'left_wrist', score: 95, diff: 10 }
    ], 'arms');
    
    expect(engine.getState('left_wrist')).toBe('MONITORING');
  });

  it('should return a correction for a severe deviation', () => {
    engine.analyze([
      { name: 'left_wrist', score: 40, diff: 45 }
    ], 'arms');
    
    expect(engine.getState('left_wrist')).toBe('CORRECTING');
  });

  it('should prioritize focus area joints over others', () => {

    engine.analyze([
      { name: 'left_knee', score: 40, diff: 45 }, // Legs (Not in focus)
      { name: 'left_wrist', score: 60, diff: 30 } // Arms (In focus)
    ], 'arms');
    
    expect(engine.getState('left_wrist')).toBe('CORRECTING');
    expect(engine.getState('left_knee')).toBe('MONITORING');
  });

  it('should trigger frustration avoidance after 3 failed corrections', () => {
    // 1st
    engine.analyze([{ name: 'left_wrist', score: 40, diff: 45 }], 'arms');
    // Fast-forward time for cooldown?
    // Wait, let's just cheat the cooldown in test if needed, but since cooldown is Date.now(), 
    // it's easier to mock Date.now.
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    
    engine.analyze([{ name: 'left_wrist', score: 40, diff: 45 }], 'arms');
    
    vi.spyOn(Date, 'now').mockReturnValue(now + 3000);
    engine.analyze([{ name: 'left_wrist', score: 40, diff: 45 }], 'arms');
    
    vi.spyOn(Date, 'now').mockReturnValue(now + 6000);
    engine.analyze([{ name: 'left_wrist', score: 40, diff: 45 }], 'arms');
    
    vi.spyOn(Date, 'now').mockReturnValue(now + 9000);
    engine.analyze([{ name: 'left_wrist', score: 40, diff: 45 }], 'arms');
    
    expect(engine.getState('left_wrist')).toBe('FRUSTRATION_AVOIDANCE');
    vi.restoreAllMocks();
  });

  it('should engage Tactical Silence when cognitive load exceeds threshold', () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    // Give 3 rapid corrections for different joints
    engine.analyze([{ name: 'right_wrist', score: 40, diff: 30 }], 'arms');
    
    vi.spyOn(Date, 'now').mockReturnValue(now + 100);
    engine.analyze([{ name: 'left_elbow', score: 40, diff: 30 }], 'arms');
    
    vi.spyOn(Date, 'now').mockReturnValue(now + 200);
    engine.analyze([{ name: 'right_elbow', score: 40, diff: 30 }], 'arms');

    // After 3 cues, cognitive load is 3.0. Silence should be engaged for 15s.
    // Try to correct another minor error immediately
    vi.spyOn(Date, 'now').mockReturnValue(now + 300);
    engine.analyze([{ name: 'right_shoulder', score: 40, diff: 25 }], 'arms');
    
    // It should NOT be correcting right_shoulder because it's silenced (and severity is moderate: diff=25)
    expect(engine.getState('right_shoulder')).toBe('MONITORING');

    vi.restoreAllMocks();
  });

  it('should trigger Freeze-Frame Physical Adjustment for severe repeated errors', () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    engine.analyze([{ name: 'left_hip', score: 40, diff: 50 }], 'legs');
    expect(engine.getPendingAdjustment()).toBeNull(); // 1st time, no freeze yet
    
    vi.spyOn(Date, 'now').mockReturnValue(now + 2100);
    engine.analyze([{ name: 'left_hip', score: 40, diff: 50 }], 'legs');
    
    // 2nd time with a severe error -> Freeze Frame triggered
    expect(engine.getPendingAdjustment()).toEqual({ jointId: 'left_hip', targetDiff: 20 });
    
    vi.restoreAllMocks();
  });
});
