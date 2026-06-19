export class CanvasRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private canvas: HTMLCanvasElement;
  private frameRate: number;

  constructor(canvas: HTMLCanvasElement, frameRate: number = 30) {
    this.canvas = canvas;
    this.frameRate = frameRate;
  }

  start() {
    this.recordedChunks = [];
    const stream = this.canvas.captureStream(this.frameRate);
    
    // Choose a supported mimeType
    const mimeTypes = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm'
    ];
    
    let options: MediaRecorderOptions = {};
    for (const type of mimeTypes) {
      if (MediaRecorder.isTypeSupported(type)) {
        options = { mimeType: type, videoBitsPerSecond: 2500000 };
        break;
      }
    }

    try {
      this.mediaRecorder = new MediaRecorder(stream, options);
    } catch (e) {
      console.error('Exception while creating MediaRecorder:', e);
      return;
    }

    this.mediaRecorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) {
        this.recordedChunks.push(e.data);
      }
    };

    this.mediaRecorder.start(100); // collect 100ms chunks
  }

  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      if (!this.mediaRecorder) {
        resolve(new Blob());
        return;
      }

      this.mediaRecorder.onstop = () => {
        const superBuffer = new Blob(this.recordedChunks, { type: 'video/webm' });
        resolve(superBuffer);
      };

      this.mediaRecorder.stop();
    });
  }
}
