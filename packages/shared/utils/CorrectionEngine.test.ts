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
});
