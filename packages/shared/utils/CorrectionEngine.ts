import type { JointScore } from '../types/routine';
import { PhraseGenerator } from './CorrectionPhraseDB';
import type { JointId, Severity } from './CorrectionPhraseDB';
import { speechManager } from './SpeechManager';
import type { StyleConfig } from './StyleConfig';
import type { PersonalityProfile } from './TeacherPersonality';

export type FocusArea = 'arms' | 'legs' | 'full';

// ─── State machine ────────────────────────────────────────────────────────────
// MONITORING         — watching, no active error
// DETECTED_ERROR     — error first spotted (1 bad frame)
// CORRECTING         — correction spoken, waiting for improvement
// WATCHING_FIX       — error shrinking, keep quiet and observe
// VERIFYING_FIX      — improvement sustained, about to praise
// PRAISE             — good job spoken
// FRUSTRATION_HOLD   — repeated failures, back off completely for a cooldown
type JointState =
  | 'MONITORING'
  | 'DETECTED_ERROR'
  | 'CORRECTING'
  | 'WATCHING_FIX'
  | 'VERIFYING_FIX'
  | 'PRAISE'
  | 'FRUSTRATION_HOLD';

interface JointContext {
  state: JointState;
  failedCorrections: number;
  lastCorrectionTime: number;
  correctionCooldown: number; // ms — doubles with each repeat (spaced repetition)
  recentlyCorrected: boolean;
  // EMA error tracking
  emaError: number;
  emaPrev: number;  // previous ema, used to detect trend
  // Trend: is error getting worse or better?
  trend: 'improving' | 'stable' | 'worsening';
}

interface WeightedScore extends JointScore {
  jointId: JointId;
  weightedError: number;
  severity: Severity;
}

// ─── EMA helper ───────────────────────────────────────────────────────────────
const EMA_ALPHA = 0.30; // responsiveness vs smoothness
function ema(prev: number, next: number, alpha = EMA_ALPHA): number {
  return alpha * next + (1 - alpha) * prev;
}

export class CorrectionEngine {
  private joints     = new Map<JointId, JointContext>();
  private phraseGen  = new PhraseGenerator();

  private styleConfig?:       StyleConfig;
  private personalityProfile?: PersonalityProfile;

  // Rate limiting
  private correctionCountInWindow = 0;
  private windowStart = 0;
  private readonly WINDOW_MS    = 5000;
  private readonly MAX_PER_WIN  = 3;

  // Per-attempt cap: arms phase fires at most 1 correction total
  private attemptCorrectionsFired = 0;

  // Cognitive load & tactical silence
  private cogLoad         = 0;   // 0–5 scale
  private lastLoadDecay   = 0;
  private silenceUntil    = 0;
  private readonly LOAD_THRESHOLD   = 3.5;
  private readonly SILENCE_MS       = 18000;
  private readonly LOAD_DECAY_PS    = 0.4;  // per second

  // Freeze-frame physical adjustment
  private pendingAdjustment: { jointId: JointId; targetDiff: number } | null = null;

  // Asymmetrical error accumulation (ring buffers, last 120 frames)
  private leftErrors:  number[] = [];
  private rightErrors: number[] = [];

  private readonly CORE_JOINTS: JointId[] = [
    'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
    'left_wrist',    'right_wrist',
    'left_hip',      'right_hip',
    'left_knee',     'right_knee',
    'left_ankle',    'right_ankle',
  ];

  constructor() {
    for (const id of this.CORE_JOINTS) {
      this.joints.set(id, {
        state:              'MONITORING',
        failedCorrections:  0,
        lastCorrectionTime: 0,
        correctionCooldown: 2500,
        recentlyCorrected:  false,
        emaError:           0,
        emaPrev:            0,
        trend:              'stable',
      });
    }
  }

  setConfig(style: StyleConfig, personality: PersonalityProfile) {
    this.styleConfig       = style;
    this.personalityProfile = personality;
  }

  getState(jointId: JointId): JointState {
    return this.joints.get(jointId)?.state ?? 'MONITORING';
  }

  getPendingAdjustment() { return this.pendingAdjustment; }

  isFrustrated(): boolean {
    for (const ctx of this.joints.values()) {
      if (ctx.state === 'FRUSTRATION_HOLD') return true;
    }
    return false;
  }

  getWeakerSide(): 'left' | 'right' | null {
    if (this.leftErrors.length < 30 || this.rightErrors.length < 30) return null;
    const lAvg = this.leftErrors.reduce((a, b) => a + b, 0) / this.leftErrors.length;
    const rAvg = this.rightErrors.reduce((a, b) => a + b, 0) / this.rightErrors.length;
    const maxAvg = Math.max(lAvg, rAvg);
    if (maxAvg < 5) return null;
    const asymmetry = Math.abs(lAvg - rAvg) / maxAvg;
    if (asymmetry > 0.25) return lAvg > rAvg ? 'left' : 'right';
    return null;
  }

  // ─── Main analysis entry ─────────────────────────────────────────────────────

  analyze(currentScores: JointScore[], focusArea: FocusArea) {
    const now = Date.now();

    // Window reset
    if (now - this.windowStart > this.WINDOW_MS) {
      this.windowStart = now;
      this.correctionCountInWindow = 0;
    }

    // Cognitive load decay
    if (now - this.lastLoadDecay > 1000) {
      const elapsed = (now - this.lastLoadDecay) / 1000;
      this.cogLoad = Math.max(0, this.cogLoad - this.LOAD_DECAY_PS * elapsed);
      this.lastLoadDecay = now;
    }

    const isSilenced = now < this.silenceUntil;

    // 1. Update EMA errors + asymmetric tracking
    this.updateEMA(currentScores);
    this.trackAsymmetry(currentScores);

    // 2. Check for praise / improvement first (non-disruptive)
    const improved = this.checkForImprovement();
    if (improved) { this.triggerPraise(improved); return; }

    // 3. Check FRUSTRATION_HOLD timeouts → revert to MONITORING
    this.tickFrustrationHold(now);

    // 4. Build weighted candidate errors
    const baseThresh = this.personalityProfile?.baseErrorThreshold ?? 22;
    const candidates = this.buildCandidates(currentScores, focusArea, baseThresh);
    if (candidates.length === 0) return;

    const worst = candidates[0];
    const ctx   = this.joints.get(worst.jointId)!;

    if (ctx.state === 'FRUSTRATION_HOLD') return; // still cooling off

    // 5. Cooldown gate (spaced repetition)
    if (now - ctx.lastCorrectionTime < ctx.correctionCooldown) return;
    if (this.correctionCountInWindow >= this.MAX_PER_WIN) return;

    // Arms phase: one correction per attempt max — beginner can't process more
    if (focusArea === 'arms' && this.attemptCorrectionsFired >= 1) return;

    // Tactical silence: only let severe errors through
    if (isSilenced && worst.severity !== 'severe') return;

    this.executeCorrection(worst, now);
  }

  /** Call at the start of each new attempt to reset the per-attempt cap. */
  resetAttempt() {
    this.attemptCorrectionsFired = 0;
  }

  // ─── EMA + asymmetry tracking ─────────────────────────────────────────────

  private updateEMA(scores: JointScore[]) {
    for (const s of scores) {
      const id = s.name as JointId;
      const ctx = this.joints.get(id);
      if (!ctx) continue;
      ctx.emaPrev  = ctx.emaError;
      ctx.emaError = ema(ctx.emaError, s.diff);
      // Determine trend using a hysteresis band of ±2 degrees
      const delta = ctx.emaError - ctx.emaPrev;
      if      (delta < -2) ctx.trend = 'improving';
      else if (delta >  2) ctx.trend = 'worsening';
      else                 ctx.trend = 'stable';
    }
  }

  private trackAsymmetry(scores: JointScore[]) {
    for (const s of scores) {
      if (s.name.startsWith('left_'))  this.leftErrors.push(s.diff);
      if (s.name.startsWith('right_')) this.rightErrors.push(s.diff);
    }
    if (this.leftErrors.length  > 120) this.leftErrors  = this.leftErrors.slice(-120);
    if (this.rightErrors.length > 120) this.rightErrors = this.rightErrors.slice(-120);
  }

  // ─── Candidate building ───────────────────────────────────────────────────

  private buildCandidates(
    scores: JointScore[],
    focusArea: FocusArea,
    baseThresh: number,
  ): WeightedScore[] {
    return scores
      .filter(s => this.isCoreJoint(s.name as JointId))
      .map(s => {
        const id  = s.name as JointId;
        const ctx = this.joints.get(id)!;

        let weight = 1.0;
        if (this.isProximal(id))              weight *= 1.5;
        if (this.isInFocusArea(id, focusArea)) weight *= 2.0;
        if (this.styleConfig?.scoringWeights?.[id]) weight *= this.styleConfig.scoringWeights[id]!;
        if (ctx.recentlyCorrected)             weight *= 1.3;
        if (ctx.state === 'FRUSTRATION_HOLD')  weight  = 0;
        if (ctx.trend === 'improving')         weight *= 0.4; // already fixing it, ease off

        const diff = ctx.emaError; // use smoothed error, not raw
        const severeThresh   = baseThresh + 25;
        const moderateThresh = baseThresh;
        const severity: Severity =
          diff > severeThresh   ? 'severe'   :
          diff > moderateThresh ? 'moderate' : 'mild';

        return { ...s, jointId: id, weightedError: diff * weight, severity };
      })
      .filter(s => s.emaError > baseThresh && s.weightedError > 0)
      .sort((a, b) => b.weightedError - a.weightedError);
  }

  // ─── Correction execution ─────────────────────────────────────────────────

  private executeCorrection(worst: WeightedScore, now: number) {
    const ctx = this.joints.get(worst.jointId)!;

    const priority = worst.severity === 'severe' ? 'urgent' : 'normal';
    const phrase   = this.phraseGen.getUniquePhrase(worst.jointId, worst.severity, 'midMovement');
    if (phrase && !speechManager.isSpeaking) {
      speechManager.speak(phrase, priority);
    }

    this.correctionCountInWindow++;
    this.attemptCorrectionsFired++;
    ctx.state              = 'CORRECTING';
    ctx.lastCorrectionTime = now;
    ctx.recentlyCorrected  = true;
    ctx.failedCorrections++;

    // Spaced repetition: double cooldown after each repeat (cap at 12s)
    ctx.correctionCooldown = Math.min(12000, ctx.correctionCooldown * 1.6);

    // Cognitive load — gate into tactical silence
    this.cogLoad += 1.0;
    if (worst.severity === 'severe') this.cogLoad += 0.5;
    if (this.cogLoad >= this.LOAD_THRESHOLD) {
      this.silenceUntil = now + this.SILENCE_MS;
      this.cogLoad      = 0;
    }

    // After 2 failed corrections, trigger Freeze-Frame physical adjustment
    if (worst.severity === 'severe' && ctx.failedCorrections >= 2 && !this.pendingAdjustment) {
      this.pendingAdjustment = { jointId: worst.jointId, targetDiff: 18 };
      speechManager.speak(
        `Freeze! Guide your ${worst.jointId.replace('_', ' ')} into the highlighted zone.`,
        'urgent',
      );
    }

    // After 3 failures, enter FRUSTRATION_HOLD to give the user breathing room
    if (ctx.failedCorrections >= 3) {
      ctx.state = 'FRUSTRATION_HOLD';
      ctx.failedCorrections = 0; // reset so they get another chance after timeout
    }

    // Clear recentlyCorrected from all other joints
    for (const [id, c] of this.joints.entries()) {
      if (id !== worst.jointId) c.recentlyCorrected = false;
    }
  }

  // ─── Improvement / praise ─────────────────────────────────────────────────

  private checkForImprovement(): JointId | null {
    // If there's a freeze-frame adjustment, check if it's been satisfied
    if (this.pendingAdjustment) {
      const ctx = this.joints.get(this.pendingAdjustment.jointId);
      if (ctx && ctx.emaError <= this.pendingAdjustment.targetDiff) {
        return this.pendingAdjustment.jointId;
      }
    }

    for (const [id, ctx] of this.joints.entries()) {
      if (ctx.state !== 'CORRECTING' && ctx.state !== 'WATCHING_FIX') continue;
      // Improvement: EMA has dropped by ≥ 10° AND is now below 18°
      if (ctx.emaPrev - ctx.emaError >= 10 && ctx.emaError < 18) {
        ctx.state = 'WATCHING_FIX';
      }
      // Sustained improvement confirmed
      if (ctx.state === 'WATCHING_FIX' && ctx.emaError < 15 && ctx.trend === 'improving') {
        return id;
      }
    }
    return null;
  }

  private triggerPraise(jointId: JointId) {
    if (this.pendingAdjustment?.jointId === jointId) {
      this.pendingAdjustment = null;
    }

    const phrase = this.phraseGen.getUniquePhrase(jointId, 'mild', 'praiseWhenFixed');
    if (phrase) speechManager.speak(phrase, 'praise');

    const ctx = this.joints.get(jointId)!;
    ctx.state             = 'PRAISE';
    ctx.failedCorrections = 0;
    ctx.recentlyCorrected = false;
    ctx.correctionCooldown = 2500; // reset cooldown after successful correction

    setTimeout(() => {
      if (this.joints.get(jointId)?.state === 'PRAISE') {
        this.joints.get(jointId)!.state = 'MONITORING';
      }
    }, 2500);
  }

  // ─── FRUSTRATION_HOLD timeout ─────────────────────────────────────────────

  private tickFrustrationHold(now: number) {
    // After 12 seconds in FRUSTRATION_HOLD, gently reset to MONITORING
    for (const [, ctx] of this.joints.entries()) {
      if (ctx.state !== 'FRUSTRATION_HOLD') continue;
      if (now - ctx.lastCorrectionTime > 12000) {
        ctx.state = 'MONITORING';
        ctx.correctionCooldown = 2500;
      }
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private isCoreJoint(id: string): id is JointId {
    return this.CORE_JOINTS.includes(id as JointId);
  }

  private isProximal(id: JointId): boolean {
    return ['left_shoulder','right_shoulder','left_hip','right_hip'].includes(id);
  }

  private isInFocusArea(id: JointId, focus: FocusArea): boolean {
    if (focus === 'full') return true;
    if (focus === 'arms') return /shoulder|elbow|wrist/.test(id);
    if (focus === 'legs') return /hip|knee|ankle/.test(id);
    return false;
  }
}