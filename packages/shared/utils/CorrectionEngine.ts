import type { JointScore } from '../types/routine';
import { PhraseGenerator } from './CorrectionPhraseDB';
import type { JointId, Severity } from './CorrectionPhraseDB';
import { speechManager } from './SpeechManager';

export type FocusArea = 'arms' | 'legs' | 'full';

type JointState = 
  | 'MONITORING' 
  | 'DETECTED_ERROR' 
  | 'CORRECTING' 
  | 'VERIFYING_FIX' 
  | 'PRAISE' 
  | 'FRUSTRATION_AVOIDANCE';

interface StateMachineContext {
  state: JointState;
  recentlyCorrected: boolean;
  failedCorrections: number;
  lastCorrectionTime: number;
}

interface WeightedScore extends JointScore {
  jointId: JointId;
  weightedError: number;
  severity: Severity;
}

export class CorrectionEngine {
  private stateMachine = new Map<JointId, StateMachineContext>();
  private smaHistory = new Map<JointId, number[]>();
  private phraseGen = new PhraseGenerator();
  
  private correctionCountInWindow = 0;
  private windowStartTime = 0;
  private readonly WINDOW_DURATION_MS = 5000;
  private readonly MAX_CORRECTIONS_PER_WINDOW = 3;
  private readonly COOLDOWN_MS = 2000;

  constructor() {
    const joints: JointId[] = [
      'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
      'left_hip', 'right_hip', 'left_knee', 'right_knee'
    ];
    joints.forEach(j => {
      this.stateMachine.set(j, {
        state: 'MONITORING',
        recentlyCorrected: false,
        failedCorrections: 0,
        lastCorrectionTime: 0
      });
      this.smaHistory.set(j, []);
    });
  }

  public analyze(currentScores: JointScore[], focusArea: FocusArea) {
    if (speechManager.isSpeaking) return;

    const now = Date.now();
    if (now - this.windowStartTime > this.WINDOW_DURATION_MS) {
      this.windowStartTime = now;
      this.correctionCountInWindow = 0;
    }

    this.updateSMA(currentScores);

    // 1. Filter and weight scores
    const weightedScores: WeightedScore[] = currentScores
      .filter(s => this.isCoreJoint(s.name as JointId))
      .map(score => {
        const jointId = score.name as JointId;
        const diff = score.diff;
        let weight = 1.0;

        if (this.isProximal(jointId)) weight *= 1.5;
        if (this.isInFocusArea(jointId, focusArea)) weight *= 2.0;
        
        const ctx = this.stateMachine.get(jointId)!;
        if (ctx.recentlyCorrected) weight *= 1.2;
        
        // Suppress if in frustration avoidance
        if (ctx.state === 'FRUSTRATION_AVOIDANCE') weight = 0;

        let severity: Severity = 'mild';
        if (diff > 40) severity = 'severe';
        else if (diff > 25) severity = 'moderate';

        return {
          ...score,
          jointId,
          weightedError: diff * weight,
          severity
        };
      });

    // 2. Check for praise conditions first
    const improvedJoint = this.checkImprovement();
    if (improvedJoint) {
      this.triggerPraise(improvedJoint);
      return;
    }

    // 3. Check for errors
    // Filter to those exceeding 20 deg error
    const candidates = weightedScores.filter(s => s.diff > 20 && s.weightedError > 0);
    
    // Sort worst first
    candidates.sort((a, b) => b.weightedError - a.weightedError);

    if (candidates.length > 0) {
      const worst = candidates[0];
      const ctx = this.stateMachine.get(worst.jointId)!;

      // Ensure cooldown
      if (now - ctx.lastCorrectionTime > this.COOLDOWN_MS) {
        if (this.correctionCountInWindow < this.MAX_CORRECTIONS_PER_WINDOW) {
          this.executeCorrection(worst);
        }
      }
    }
  }

  private executeCorrection(worst: WeightedScore) {
    const ctx = this.stateMachine.get(worst.jointId)!;
    
    // State machine logic
    if (ctx.state === 'MONITORING' || ctx.state === 'VERIFYING_FIX') {
      ctx.state = 'DETECTED_ERROR';
    }

    const priority = worst.severity === 'severe' ? 'urgent' : 'normal';
    const phrase = this.phraseGen.getUniquePhrase(worst.jointId, worst.severity, 'midMovement');
    
    if (phrase) {
      speechManager.speak(phrase, priority);
      this.correctionCountInWindow++;
      
      ctx.state = 'CORRECTING';
      ctx.lastCorrectionTime = Date.now();
      ctx.recentlyCorrected = true;
      ctx.failedCorrections++;

      if (ctx.failedCorrections >= 3) {
        ctx.state = 'FRUSTRATION_AVOIDANCE';
      }
      
      // Clear recentlyCorrected flag from others
      for (const [id, state] of this.stateMachine.entries()) {
        if (id !== worst.jointId) state.recentlyCorrected = false;
      }
    }
  }

  private triggerPraise(jointId: JointId) {
    const phrase = this.phraseGen.getUniquePhrase(jointId, 'mild', 'praiseWhenFixed');
    if (phrase) {
      speechManager.speak(phrase, 'praise');
    }
    const ctx = this.stateMachine.get(jointId)!;
    ctx.state = 'PRAISE';
    ctx.failedCorrections = 0;
    ctx.recentlyCorrected = false;
    
    // reset to monitoring after praise
    setTimeout(() => {
      if (this.stateMachine.get(jointId)?.state === 'PRAISE') {
        this.stateMachine.get(jointId)!.state = 'MONITORING';
      }
    }, 2000);
  }

  private updateSMA(scores: JointScore[]) {
    for (const score of scores) {
      const id = score.name as JointId;
      if (!this.isCoreJoint(id)) continue;

      const history = this.smaHistory.get(id)!;
      history.push(score.diff);
      if (history.length > 10) {
        history.shift(); // keep 10 frames
      }
    }
  }

  private checkImprovement(): JointId | null {
    // Current SMA < (Previous SMA - 5) for 3 consecutive windows.
    // For simplicity in this implementation, we check if the current average of the last 3 frames 
    // is 5 degrees better than the average of the older 7 frames, 
    // AND the joint is currently VERIFYING_FIX or CORRECTING.
    for (const [id, history] of this.smaHistory.entries()) {
      const ctx = this.stateMachine.get(id)!;
      if ((ctx.state === 'CORRECTING' || ctx.state === 'VERIFYING_FIX') && history.length === 10) {
        const olderAvg = history.slice(0, 7).reduce((a, b) => a + b, 0) / 7;
        const recentAvg = history.slice(7).reduce((a, b) => a + b, 0) / 3;
        
        if (recentAvg < olderAvg - 5 && recentAvg < 20) {
          return id;
        } else if (Date.now() - ctx.lastCorrectionTime > this.COOLDOWN_MS) {
          ctx.state = 'VERIFYING_FIX';
        }
      }
    }
    return null;
  }

  private isCoreJoint(id: string): id is JointId {
    return [
      'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
      'left_hip', 'right_hip', 'left_knee', 'right_knee'
    ].includes(id);
  }

  private isProximal(id: JointId): boolean {
    return ['left_shoulder', 'right_shoulder', 'left_hip', 'right_hip'].includes(id);
  }

  private isInFocusArea(id: JointId, focus: FocusArea): boolean {
    if (focus === 'full') return true;
    if (focus === 'arms') return id.includes('shoulder') || id.includes('elbow');
    if (focus === 'legs') return id.includes('hip') || id.includes('knee');
    return false;
  }
}
