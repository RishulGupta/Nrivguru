export class CountingSystem {
  private audioContext: AudioContext | null = null;
  private isPlaying = false;
  private nextNoteTime = 0;
  private currentBeat = 0; // 0 to 7 (representing 1 to 8)
  private lookahead = 25.0; // milliseconds
  private scheduleAheadTime = 0.1; // seconds
  private timerID: ReturnType<typeof setInterval> | null = null;
  private secondsPerBeat = 0.5;

  private onBeatCallbacks: Set<(beatIndex: number) => void> = new Set();

  // In a real app, these would be decoded AudioBuffers from fetched audio files.
  // For the prompt constraints, we'll synthesize a tick using oscillators if buffers aren't provided,
  // but architect it to support actual audio buffers.
  private normalBeepBuffer: AudioBuffer | null = null;
  private accentedBeepBuffer: AudioBuffer | null = null;

  constructor() {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        this.audioContext = new AudioContextClass();
      }
    } catch (e) {
      console.warn("Web Audio API not supported in this browser");
    }
  }

  // Allow injecting pre-recorded vocal sample buffers
  public setAudioBuffers(normal: AudioBuffer, accented: AudioBuffer) {
    this.normalBeepBuffer = normal;
    this.accentedBeepBuffer = accented;
  }

  public onBeat(callback: (beatIndex: number) => void) {
    this.onBeatCallbacks.add(callback);
  }

  public offBeat(callback: (beatIndex: number) => void) {
    this.onBeatCallbacks.delete(callback);
  }

  private nextNote() {
    this.nextNoteTime += this.secondsPerBeat;
    this.currentBeat++;
    if (this.currentBeat === 8) {
      this.currentBeat = 0;
    }
  }

  private scheduleNote(beatNumber: number, time: number) {
    // Notify visual components (using a slight timeout to align with actual audio play time if needed, 
    // though requestAnimationFrame polling AudioContext.currentTime is more precise for UI. 
    // We fire the callback now for simple UI updates).
    // A more precise approach: queue the UI events and have rAF process them based on audioContext.currentTime.
    // For now, we dispatch immediately since the scheduleAheadTime is small (100ms).
    
    // Using setTimeout to loosely align the visual callback with the audio time
    if (this.audioContext) {
        const timeUntilPlay = (time - this.audioContext.currentTime) * 1000;
        setTimeout(() => {
            this.onBeatCallbacks.forEach(cb => cb(beatNumber));
        }, Math.max(0, timeUntilPlay));
    }

    if (!this.audioContext) return;

    // Is it count 1 or 5?
    const isAccented = (beatNumber === 0 || beatNumber === 4);

    if (this.normalBeepBuffer && this.accentedBeepBuffer) {
      // Play sample
      const source = this.audioContext.createBufferSource();
      source.buffer = isAccented ? this.accentedBeepBuffer : this.normalBeepBuffer;
      source.connect(this.audioContext.destination);
      source.start(time);
    } else {
      // Fallback: Synthesize beep
      const osc = this.audioContext.createOscillator();
      const envelope = this.audioContext.createGain();

      osc.frequency.value = isAccented ? 880.0 : 440.0;
      envelope.gain.value = 1;
      envelope.gain.exponentialRampToValueAtTime(1, time + 0.03);
      envelope.gain.exponentialRampToValueAtTime(0.001, time + 0.1);

      osc.connect(envelope);
      envelope.connect(this.audioContext.destination);

      osc.start(time);
      osc.stop(time + 0.1);
    }
  }

  private scheduler() {
    if (!this.audioContext) return;
    
    while (this.nextNoteTime < this.audioContext.currentTime + this.scheduleAheadTime) {
      this.scheduleNote(this.currentBeat, this.nextNoteTime);
      this.nextNote();
    }
  }

  public start(chunkDurationMs: number, playbackRate: number) {
    if (this.isPlaying) return;
    
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    // Divide chunk duration into 8 counts, adjust for playback rate
    this.secondsPerBeat = (chunkDurationMs / 1000 / 8) / playbackRate;
    
    this.isPlaying = true;
    this.currentBeat = 0;
    
    if (this.audioContext) {
        this.nextNoteTime = this.audioContext.currentTime + 0.05;
    }
    
    this.timerID = setInterval(() => this.scheduler(), this.lookahead);
  }

  public stop() {
    this.isPlaying = false;
    if (this.timerID !== null) {
      clearInterval(this.timerID);
      this.timerID = null;
    }
  }
}

export const countingSystem = new CountingSystem();
