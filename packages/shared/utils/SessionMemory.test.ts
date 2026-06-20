import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SessionMemory } from './SessionMemory';
import type { SessionSummary } from './SessionMemory';

describe('SessionMemory', () => {
  let memory: SessionMemory;
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    // Mock window and localStorage for node environment
    vi.stubGlobal('window', {});
    
    mockStorage = {};
    const mockLocalStorage = {
      getItem: vi.fn((key: string) => mockStorage[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        mockStorage[key] = value;
      })
    };
    vi.stubGlobal('localStorage', mockLocalStorage);

    memory = new SessionMemory();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const createDummySession = (routineId: string, overallScore: number): SessionSummary => ({
    date: new Date().toISOString(),
    routineId,
    worstJoints: [],
    bestJoints: [],
    overallScore
  });

  it('should save and retrieve sessions', async () => {
    const s1 = createDummySession('r1', 80);
    await memory.saveSession(s1);

    const all = await memory.getAllSessions();
    expect(all).toHaveLength(1);
    expect(all[0].routineId).toBe('r1');
    expect(all[0].overallScore).toBe(80);
  });

  it('should retrieve the last session for a specific routine', async () => {
    await memory.saveSession(createDummySession('r1', 80));
    await memory.saveSession(createDummySession('r2', 90)); // different routine
    await memory.saveSession(createDummySession('r1', 85)); // same routine, later in time

    const last = await memory.getLastSessionForRoutine('r1');
    expect(last).not.toBeNull();
    expect(last?.overallScore).toBe(85); // Should get the most recent one
  });

  it('should calculate overall improvement compared to last session', async () => {
    await memory.saveSession(createDummySession('r1', 70)); // First time: 70
    
    // Now we play again and score 85. Improvement should be +15.
    const improvement = await memory.getOverallImprovement('r1', 85);
    expect(improvement).toBe(15);

    // Play again and score 60. Improvement should be -10 from the 70.
    // Wait, the last session stored is STILL 70 because we didn't save the 85 yet.
    const improvement2 = await memory.getOverallImprovement('r1', 60);
    expect(improvement2).toBe(-10);
  });

  it('should limit storage to the last 10 sessions', async () => {
    for (let i = 0; i < 15; i++) {
      await memory.saveSession(createDummySession(`r${i}`, 80));
    }

    const all = await memory.getAllSessions();
    expect(all).toHaveLength(10);
    // The first 5 should be shifted off. The last one added was r14.
    expect(all[9].routineId).toBe('r14');
  });
});
