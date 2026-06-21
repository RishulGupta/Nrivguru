import type { JointScore } from '../types/routine';
import { PhraseGenerator } from './CorrectionPhraseDB';
import type { JointId, Severity } from './CorrectionPhraseDB';
import { speechManager } from './SpeechManager';
import type { StyleConfig } from './StyleConfig';
import type { PersonalityProfile } from './TeacherPersonality';

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
  
  private styleConfig?: StyleConfig;
  private personalityProfile?: PersonalityProfile;
  
  private correctionCountInWindow = 0;
  private windowStartTime = 0;
  private readonly WINDOW_DURATION_MS = 5000;
  private readonly MAX_CORRECTIONS_PER_WINDOW = 3;
  private readonly COOLDOWN_MS = 2000;

  // Tactical Silence
  private cognitiveLoad = 0;
  private lastLoadDecayTime = 0;
  private silenceEndTime = 0;
  private readonly COGNITIVE_LOAD_THRESHOLD = 3.0;
  private readonly SILENCE_DURATION_MS = 15000;

  // Freeze-Frame Physical Adjustment
  private pendingAdjustment: { jointId: JointId, targetDiff: number } | null = null;

  // Asymmetrical Feedback Adaptation
  private leftSideErrors: number[] = [];
  private rightSideErrors: number[] = [];

  constructor() {
    const joints: JointId[] = [
      'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
      'left_wrist', 'right_wrist',
      'left_hip', 'right_hip', 'left_knee', 'right_knee',
      'left_ankle', 'right_ankle'
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

  public setConfig(style: StyleConfig, personality: PersonalityProfile) {
    this.styleConfig = style;
    this.personalityProfile = personality;
  }

  public getState(jointId: JointId): JointState {
    return this.stateMachine.get(jointId)?.state || 'MONITORING';
  }

  public analyze(currentScores: JointScore[], focusArea: FocusArea) {
    if (speechManager.isSpeaking) return;

    const now = Date.now();
    if (now - this.windowStartTime > this.WINDOW_DURATION_MS) {
      this.windowStartTime = now;
      this.correctionCountInWindow = 0;
    }

    this.updateSMA(currentScores);

    // Asymmetrical error tracking
    for (const score of currentScores) {
      if (score.name.startsWith('left_')) this.leftSideErrors.push(score.diff);
      else if (score.name.startsWith('right_')) this.rightSideErrors.push(score.diff);
    }
    if (this.leftSideErrors.length > 100) this.leftSideErrors = this.leftSideErrors.slice(-100);
    if (this.rightSideErrors.length > 100) this.rightSideErrors = this.rightSideErrors.slice(-100);
    
    // Decay cognitive load
    if (now - this.lastLoadDecayTime > 1000) {
      // Decay 0.5 per second
      this.cognitiveLoad = Math.max(0, this.cognitiveLoad - 0.5);
      this.lastLoadDecayTime = now;
    }

    // Check if we are in tactical silence
    const isSilenced = now < this.silenceEndTime;

    // 1. Filter and weight scores
    const weightedScores: WeightedScore[] = currentScores
      .filter(s => this.isCoreJoint(s.name as JointId))
      .map(score => {
        const jointId = score.name as JointId;
        const diff = score.diff;
        let weight = 1.0;

        if (this.isProximal(jointId)) weight *= 1.5;
        if (this.isInFocusArea(jointId, focusArea)) weight *= 2.0;
        
        // Apply genre-specific weights if available
        if (this.styleConfig?.scoringWeights[jointId]) {
          weight *= this.styleConfig.scoringWeights[jointId]!;
        }

        const ctx = this.stateMachine.get(jointId)!;
        if (ctx.recentlyCorrected) weight *= 1.2;
        
        // Suppress if in frustration avoidance
        if (ctx.state === 'FRUSTRATION_AVOIDANCE') weight = 0;

        // Use personality thresholds if available, otherwise default
        const baseThresh = this.personalityProfile?.baseErrorThreshold || 25;
        let severity: Severity = 'mild';
        if (diff > baseThresh + 20) severity = 'severe';
        else if (diff > baseThresh) severity = 'moderate';

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
    const baseThresh = this.personalityProfile?.baseErrorThreshold || 20;
    // Filter to those exceeding baseline error
    const candidates = weightedScores.filter(s => s.diff > baseThresh && s.weightedError > 0);
    
    // Sort worst first
    candidates.sort((a, b) => b.weightedError - a.weightedError);

    if (candidates.length > 0) {
      const worst = candidates[0];
      const ctx = this.stateMachine.get(worst.jointId)!;

      // Ensure cooldown
      if (now - ctx.lastCorrectionTime > this.COOLDOWN_MS) {
        if (this.correctionCountInWindow < this.MAX_CORRECTIONS_PER_WINDOW) {
          // If silenced, only allow severe (urgent) corrections
          if (!isSilenced || worst.severity === 'severe') {
            this.executeCorrection(worst);
          }
        }
      }
    }
  }

  public getPendingAdjustment() {
    return this.pendingAdjustment;
  }

  public getWeakerSide(): 'left' | 'right' | null {
    if (this.leftSideErrors.length < 20 || this.rightSideErrors.length < 20) return null;
    const leftAvg = this.leftSideErrors.reduce((a, b) => a + b, 0) / this.leftSideErrors.length;
    const rightAvg = this.rightSideErrors.reduce((a, b) => a + b, 0) / this.rightSideErrors.length;
    const variance = Math.abs(leftAvg - rightAvg) / Math.max(leftAvg, rightAvg);
    if (variance > 0.3) {
      return leftAvg > rightAvg ? 'left' : 'right';
    }
    return null;
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
      
      // Tactical silence logic
      this.cognitiveLoad += 1.0;
      if (this.cognitiveLoad >= this.COGNITIVE_LOAD_THRESHOLD) {
        this.silenceEndTime = Date.now() + this.SILENCE_DURATION_MS;
        this.cognitiveLoad = 0; // reset
        console.log("Tactical Silence Engaged! Muting for 15s");
      }
      
      ctx.state = 'CORRECTING';
      ctx.lastCorrectionTime = Date.now();
      ctx.recentlyCorrected = true;
      ctx.failedCorrections++;

      // Trigger Physical Adjustment if severe and we failed a few times (or immediately if very bad)
      if (worst.severity === 'severe' && ctx.failedCorrections >= 2) {
        this.pendingAdjustment = { jointId: worst.jointId, targetDiff: 20 }; // Must get error under 20
        speechManager.speak("Freeze! Move your " + worst.jointId.replace('_', ' ') + " into the green zone to continue.", 'urgent');
      }

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
    if (this.pendingAdjustment?.jointId === jointId) {
       this.pendingAdjustment = null;
    }
    
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
    // If we are waiting for an adjustment, check if it's fixed directly (live)
    if (this.pendingAdjustment) {
      const history = this.smaHistory.get(this.pendingAdjustment.jointId)!;
      if (history.length > 0) {
         const current = history[history.length - 1];
         if (current <= this.pendingAdjustment.targetDiff) {
            return this.pendingAdjustment.jointId;
         }
      }
    }

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
      'left_wrist', 'right_wrist',
      'left_hip', 'right_hip', 'left_knee', 'right_knee',
      'left_ankle', 'right_ankle'
    ].includes(id);
  }

  private isProximal(id: JointId): boolean {
    return ['left_shoulder', 'right_shoulder', 'left_hip', 'right_hip'].includes(id);
  }

  private isInFocusArea(id: JointId, focus: FocusArea): boolean {
    if (focus === 'full') return true;
    if (focus === 'arms') return id.includes('shoulder') || id.includes('elbow') || id.includes('wrist');
    if (focus === 'legs') return id.includes('hip') || id.includes('knee') || id.includes('ankle');
    return false;
  }
}
