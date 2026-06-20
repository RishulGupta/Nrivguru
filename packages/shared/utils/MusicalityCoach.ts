import type { PoseFrame } from '../types/pose';

/**
 * The MusicalityCoach measures rhythm and timing independent of spatial correctness.
 * It extracts a 1D "velocity profile" from the pose data (kinetic energy over time)
 * and cross-correlates the user's velocity profile with the teacher's profile.
 * 
 * - Peak positive lag -> User is dragging (behind the beat)
 * - Peak negative lag -> User is rushing (ahead of the beat)
 * - Peak near 0 -> Perfectly on beat
 */
export class MusicalityCoach {
  
  /**
   * Computes the 1D velocity profile of a sequence of frames.
   * V(t) = sum of Euclidean distance of all joints from t-1 to t
   */
  public extractVelocityProfile(frames: PoseFrame[]): number[] {
    if (frames.length < 2) return [];
    
    const velocities: number[] = [];
    velocities.push(0); // v(0) = 0
    
    for (let i = 1; i < frames.length; i++) {
      const prev = frames[i - 1].landmarks;
      const curr = frames[i].landmarks;
      
      let totalV = 0;
      for (let j = 0; j < 33; j++) {
        // Skip facial landmarks or low visibility
        if (curr[j].visibility < 0.5 || prev[j].visibility < 0.5) continue;
        
        const dx = curr[j].x - prev[j].x;
        const dy = curr[j].y - prev[j].y;
        totalV += Math.sqrt(dx * dx + dy * dy);
      }
      velocities.push(totalV);
    }
    
    return velocities;
  }

  /**
   * Cross-correlates two velocity profiles to find the timing lag.
   * @param refVel Reference velocity profile
   * @param userVel User velocity profile
   * @param maxLag Maximum frame lag to check (e.g. 30 frames = 1 second at 30fps)
   * @returns Frame lag. Positive means user is lagging behind reference. Negative means user is rushing.
   */
  public crossCorrelate(refVel: number[], userVel: number[], maxLag = 30): number | null {
    if (refVel.length === 0 || userVel.length === 0) return null;
    
    // Variance check: if user stood still, don't grade musicality
    const userAvg = userVel.reduce((a, b) => a + b, 0) / userVel.length;
    let userVariance = 0;
    for (const v of userVel) {
      userVariance += Math.pow(v - userAvg, 2);
    }
    if (userVariance < 0.001) return null; // Stood perfectly still

    let bestLag = 0;
    let maxDot = -Infinity;

    // Check lags from -maxLag to +maxLag
    // If lag > 0, we shift userVel forward (meaning user was late)
    for (let lag = -maxLag; lag <= maxLag; lag++) {
      let dot = 0;
      let count = 0;

      for (let i = 0; i < refVel.length; i++) {
        const userIdx = i - lag;
        if (userIdx >= 0 && userIdx < userVel.length) {
          dot += refVel[i] * userVel[userIdx];
          count++;
        }
      }

      if (count > 0) {
        const normalizedDot = dot / count;
        if (normalizedDot > maxDot) {
          maxDot = normalizedDot;
          bestLag = lag;
        }
      }
    }

    return bestLag;
  }

  /**
   * Translates the frame lag into coaching feedback.
   * @param frameLag The lag calculated by crossCorrelate
   * @param fps The assumed framerate (typically 30)
   */
  public getTimingFeedback(frameLag: number, fps = 30): string | null {
    const lagSeconds = frameLag / fps;
    
    if (Math.abs(lagSeconds) < 0.15) {
      return null; // Within 150ms is considered on-beat
    }
    
    if (lagSeconds > 0.15) {
      return `You're dragging behind the beat. Try to speed up slightly.`;
    } else {
      return `You're rushing ahead. Wait for the count!`;
    }
  }
}

export const musicalityCoach = new MusicalityCoach();
