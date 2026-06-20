
export type PersonalityMode = 'beginner' | 'advanced';
export type PhraseStyle = 'expressive' | 'technical';
export type CorrectionFrequency = 'gentle' | 'strict';

export interface PersonalityProfile {
  mode: PersonalityMode;
  baseErrorThreshold: number; // 30 for beginner, 15 for advanced
  phraseStyle: PhraseStyle;
  correctionFrequency: CorrectionFrequency;
}

export class TeacherPersonality {
  private mode: PersonalityMode = 'beginner';

  public getProfile(): PersonalityProfile {
    if (this.mode === 'beginner') {
      return {
        mode: 'beginner',
        baseErrorThreshold: 30,
        phraseStyle: 'expressive',
        correctionFrequency: 'gentle',
      };
    } else {
      return {
        mode: 'advanced',
        baseErrorThreshold: 15,
        phraseStyle: 'technical',
        correctionFrequency: 'strict',
      };
    }
  }

  public setMode(mode: PersonalityMode) {
    this.mode = mode;
  }

  public getMode() {
    return this.mode;
  }

  /**
   * Adjusts severity thresholds based on personality mode.
   * A beginner might only get a "severe" warning at 45 degrees,
   * while an advanced user gets a "severe" warning at 25 degrees.
   */
  public getSeverityThresholds() {
    const profile = this.getProfile();
    return {
      mild: profile.baseErrorThreshold,
      moderate: profile.baseErrorThreshold + 10,
      severe: profile.baseErrorThreshold + 20,
    };
  }
}
