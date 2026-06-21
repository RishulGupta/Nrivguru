export class DifficultyScaler {
  private baseRate = 1.0;
  private currentRate = 1.0;
  private currentThreshold = 25; // Error threshold in degrees
  
  private consecutiveFails = 0;
  private consecutivePasses = 0;
  
  private minRate: number;
  private maxRate: number;

  constructor(minRate = 0.5, maxRate = 1.0) {
    this.minRate = minRate;
    this.maxRate = maxRate;
  }

  /**
   * Called at the end of each scored phase or attempt.
   * @param score 0-100 score of the attempt
   */
  public evaluateAttempt(score: number) {
    if (score < 40) {
      this.consecutiveFails++;
      this.consecutivePasses = 0;
    } else if (score > 85) {
      this.consecutivePasses++;
      this.consecutiveFails = 0;
    } else {
      // 40-85 is the "learning zone", we hold steady.
      this.consecutiveFails = 0;
      this.consecutivePasses = 0;
    }

    this.adaptDifficulty();
  }

  private adaptDifficulty() {
    if (this.consecutiveFails >= 2) {
      // User is struggling. Drop speed, increase leniency.
      this.currentRate = Math.max(this.minRate, this.currentRate - 0.25);
      this.currentThreshold = Math.min(35, this.currentThreshold + 5);
      this.consecutiveFails = 0; // reset to avoid plummeting instantly
    } else if (this.consecutivePasses >= 2) {
      // User is doing well. Increase speed, tighten leniency.
      this.currentRate = Math.min(this.maxRate, this.currentRate + 0.25);
      this.currentThreshold = Math.max(15, this.currentThreshold - 5);
      this.consecutivePasses = 0;
    }
  }

  public getPlaybackRate() {
    return this.currentRate;
  }

  public getErrorThreshold() {
    return this.currentThreshold;
  }

  public forcePlaybackRate(rate: number) {
    this.currentRate = Math.min(this.maxRate, Math.max(this.minRate, rate));
  }

  public forceSlowDown() {
    this.currentRate = Math.max(this.minRate, this.currentRate - 0.25);
  }

  public reset() {
    this.currentRate = this.baseRate;
    this.currentThreshold = 25;
    this.consecutiveFails = 0;
    this.consecutivePasses = 0;
  }
}
