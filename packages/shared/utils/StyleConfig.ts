import type { JointId } from './CorrectionPhraseDB';

export type StyleTag = 'bollywood' | 'ballet' | 'hiphop' | 'general';

export interface StyleConfig {
  scoringWeights: Partial<Record<JointId, number>>;
  focusLandmarks: number[];
  styleName: string;
}

const COMMON_UPPER: number[] = [11, 12, 13, 14, 15, 16]; // shoulders, elbows, wrists
const COMMON_LOWER: number[] = [23, 24, 25, 26, 27, 28]; // hips, knees, ankles

export const STYLE_CONFIGS: Record<StyleTag, StyleConfig> = {
  bollywood: {
    scoringWeights: {
      left_wrist: 3.0,
      right_wrist: 3.0,
      left_hip: 2.0,
      right_hip: 2.0
    }, // Emphasize mudras + hip thrusts
    focusLandmarks: [...COMMON_UPPER, 17, 18, 19, 20, 21, 22], // Wrists + hands heavily weighted
    styleName: 'Bollywood'
  },
  ballet: {
    scoringWeights: {
      left_hip: 2.5,
      right_hip: 2.5,
      left_knee: 2.0,
      right_knee: 2.0,
      left_ankle: 2.0,
      right_ankle: 2.0
    }, // Turnout + posture
    focusLandmarks: [...COMMON_LOWER],
    styleName: 'Ballet'
  },
  hiphop: {
    scoringWeights: {
      left_shoulder: 1.5,
      right_shoulder: 1.5,
      left_hip: 2.0,
      right_hip: 2.0
    }, // Groove + bounce
    focusLandmarks: [...COMMON_UPPER, ...COMMON_LOWER],
    styleName: 'Hip Hop'
  },
  general: {
    scoringWeights: {}, // Default 1.0 weights
    focusLandmarks: [...COMMON_UPPER, ...COMMON_LOWER],
    styleName: 'General Dance'
  }
};

export function getStyleConfig(tag?: string): StyleConfig {
  if (!tag) return STYLE_CONFIGS['general'];
  
  const normalized = tag.toLowerCase() as StyleTag;
  if (STYLE_CONFIGS[normalized]) {
    return STYLE_CONFIGS[normalized];
  }
  
  return STYLE_CONFIGS['general'];
}
