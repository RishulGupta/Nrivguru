export type SpeechPriority = 'normal' | 'urgent' | 'praise';

export class SpeechManager {
  private synthesis: SpeechSynthesis;
  private voice: SpeechSynthesisVoice | null = null;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.synthesis = window.speechSynthesis;
    // Load voices. Browsers load them async.
    if (this.synthesis.onvoiceschanged !== undefined) {
      this.synthesis.onvoiceschanged = this.initVoice.bind(this);
    }
    this.initVoice();
  }

  private initVoice() {
    const voices = this.synthesis.getVoices();
    // Prefer a clear, natural English voice, like Google US English or similar if available
    this.voice = voices.find(v => v.lang.startsWith('en') && v.name.includes('Google')) || voices[0] || null;
  }

  public speak(text: string, priority: SpeechPriority = 'normal') {
    if (!this.synthesis) return;

    if (this.synthesis.speaking || this.synthesis.pending) {
      if (priority === 'urgent') {
        // Cancel current speech to immediately inject the urgent cue
        this.synthesis.cancel();
      } else {
        // Drop the request to prevent queue buildup
        return;
      }
    }

    const utterance = new SpeechSynthesisUtterance(text);
    if (this.voice) {
      utterance.voice = this.voice;
    }

    // Voice dynamics based on priority
    if (priority === 'urgent') {
      utterance.pitch = 1.2;
      utterance.rate = 1.2;
    } else if (priority === 'praise') {
      utterance.pitch = 1.1;
      utterance.rate = 0.9;
    } else {
      // normal
      utterance.pitch = 1.0;
      utterance.rate = 1.0;
    }

    // Workaround for Chrome bug where speech gets stuck
    utterance.onstart = () => {
      this.clearWatchdog();
      this.watchdogTimer = setTimeout(() => {
        if (this.synthesis.speaking) {
          console.warn('SpeechSynthesis stuck, forcing cancel.');
          this.synthesis.cancel();
        }
      }, 5000);
    };

    utterance.onend = () => {
      this.clearWatchdog();
    };

    utterance.onerror = () => {
      this.clearWatchdog();
    };

    this.synthesis.speak(utterance);
  }

  private clearWatchdog() {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  public get isSpeaking(): boolean {
    return this.synthesis?.speaking || this.synthesis?.pending;
  }

  public cancel() {
    if (this.synthesis) {
      this.synthesis.cancel();
      this.clearWatchdog();
    }
  }
}

export const speechManager = new SpeechManager();
