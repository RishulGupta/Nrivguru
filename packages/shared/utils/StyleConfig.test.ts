import { describe, it, expect } from 'vitest';
import { getStyleConfig } from './StyleConfig';

describe('StyleConfig', () => {
  it('should return general config when no tag is provided', () => {
    const config = getStyleConfig();
    expect(config.styleName).toBe('General Dance');
    expect(config.scoringWeights).toEqual({});
  });

  it('should return correct config for bollywood', () => {
    const config = getStyleConfig('bollywood');
    expect(config.styleName).toBe('Bollywood');
    expect(config.scoringWeights['left_wrist']).toBe(3.0);
    expect(config.scoringWeights['right_wrist']).toBe(3.0);
    
    // Check that focus landmarks include wrist points (17-22)
    expect(config.focusLandmarks).toContain(17);
    expect(config.focusLandmarks).toContain(22);
  });

  it('should return correct config for ballet', () => {
    const config = getStyleConfig('ballet');
    expect(config.styleName).toBe('Ballet');
    expect(config.scoringWeights['left_knee']).toBe(2.0);
    
    // Ballet focuses on lower body
    expect(config.focusLandmarks).toContain(25); // knee
    expect(config.focusLandmarks).not.toContain(15); // wrist
  });

  it('should fall back to general if tag is unknown', () => {
    const config = getStyleConfig('unknown_style_123');
    expect(config.styleName).toBe('General Dance');
  });
  
  it('should be case insensitive', () => {
    const config = getStyleConfig('HipHop');
    expect(config.styleName).toBe('Hip Hop');
  });
});
