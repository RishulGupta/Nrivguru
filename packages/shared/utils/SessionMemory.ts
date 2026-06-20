import type { JointId } from './CorrectionPhraseDB';

export interface SessionSummary {
  date: string; // ISO String
  routineId: string;
  worstJoints: { jointId: JointId; avgError: number }[];
  bestJoints: { jointId: JointId; avgError: number }[];
  overallScore: number;
}

const STORAGE_KEY = 'taal_session_memory';

export class SessionMemory {
  
  public async saveSession(summary: SessionSummary): Promise<void> {
    if (typeof window === 'undefined') return;
    try {
      const existing = await this.getAllSessions();
      existing.push(summary);
      
      // Keep only last 10 sessions to prevent bloat
      if (existing.length > 10) existing.shift();
      
      localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
    } catch (e) {
      console.warn('Failed to save session memory:', e);
    }
  }

  public async getAllSessions(): Promise<SessionSummary[]> {
    if (typeof window === 'undefined') return [];
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (!data) return [];
      return JSON.parse(data) as SessionSummary[];
    } catch (e) {
      console.warn('Failed to read session memory:', e);
      return [];
    }
  }

  public async getLastSessionForRoutine(routineId: string): Promise<SessionSummary | null> {
    const all = await this.getAllSessions();
    // Search backwards
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i].routineId === routineId) {
        return all[i];
      }
    }
    return null;
  }

  public async getOverallImprovement(routineId: string, currentScore: number): Promise<number | null> {
    const lastSession = await this.getLastSessionForRoutine(routineId);
    if (!lastSession) return null;
    return currentScore - lastSession.overallScore; // Positive means improvement
  }
}

export const sessionMemory = new SessionMemory();
