import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Circle, Square, Play, RotateCcw, Download } from 'lucide-react';

// ── PerformanceTake ───────────────────────────────────────────────────────────
// Step 10 (optional) of the 11-step class model:
// User records a "performance take" of the full piece for personal review.
// Separate from drill takes — no pose scoring, no correction badge.
//
// Flow:
//   idle      → split-screen preview (ref video left muted, webcam right)
//   countdown → 3-2-1 overlay before recording starts
//   recording → ref video plays full-speed+music; webcam captured via
//               MediaRecorder on the camera stream; red progress bar
//   reviewing → blob played back in a full-screen video element
//
// The recorded blob lives only in memory (URL.createObjectURL).
// No upload, no Supabase write.

export interface PerformanceTakeProps {
  videoSrc:    string;
  startTimeMs: number;
  endTimeMs:   number;
  title?:      string;
  onClose:     () => void;
}

type TakePhase = 'idle' | 'countdown' | 'recording' | 'reviewing';

function fmtSec(s: number) {
  const r = Math.round(s);
  return r < 60 ? `${r}s` : `${Math.floor(r / 60)}m ${r % 60}s`;
}

function getBestMimeType(): string {
  const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  return types.find(t => MediaRecorder.isTypeSupported(t)) ?? 'video/webm';
}

export function PerformanceTake({ videoSrc, startTimeMs, endTimeMs, title, onClose }: PerformanceTakeProps) {
  const refVideoRef    = useRef<HTMLVideoElement>(null);
  const webcamVideoRef = useRef<HTMLVideoElement>(null);
  const playbackRef    = useRef<HTMLVideoElement>(null);
  const streamRef      = useRef<MediaStream | null>(null);
  const recorderRef    = useRef<MediaRecorder | null>(null);
  const chunksRef      = useRef<Blob[]>([]);
  const loadedSrcRef   = useRef('');

  const [phase, setPhase]         = useState<TakePhase>('idle');
  const [countdown, setCountdown] = useState(3);
  const [progress, setProgress]   = useState(0);
  const [elapsed, setElapsed]     = useState(0);
  const [camError, setCamError]   = useState('');
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);

  const durationMs  = Math.max(0, endTimeMs - startTimeMs);
  const durationSec = durationMs / 1000;

  // ── Camera init ─────────────────────────────────────────────────────────────

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
          audio: false,
        });
        if (!active) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const v = webcamVideoRef.current;
        if (v) { v.srcObject = stream; v.play().catch(() => {}); }
      } catch {
        if (active) setCamError('Camera access denied — allow camera to record your take');
      }
    })();
    return () => {
      active = false;
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
  }, []);

  // ── Load reference video src ─────────────────────────────────────────────────

  useEffect(() => {
    const v = refVideoRef.current;
    if (!v || !videoSrc) return;
    if (loadedSrcRef.current !== videoSrc) {
      loadedSrcRef.current = videoSrc;
      v.src   = videoSrc;
      v.muted = true;
      v.load();
    }
  }, [videoSrc]);

  // ── Countdown tick ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (phase !== 'countdown') return;
    if (countdown <= 0) { startRecording(); return; }
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, countdown]);

  // ── Recording: progress + end-of-range ──────────────────────────────────────

  useEffect(() => {
    if (phase !== 'recording') return;
    const v = refVideoRef.current;
    if (!v) return;
    const onTU = () => {
      const nowMs = v.currentTime * 1000;
      if (durationMs > 0)
        setProgress(Math.min(1, Math.max(0, (nowMs - startTimeMs) / durationMs)));
      setElapsed(Math.max(0, (nowMs - startTimeMs) / 1000));
      if (endTimeMs > 0 && nowMs >= endTimeMs) { v.pause(); stopRecording(); }
    };
    v.addEventListener('timeupdate', onTU);
    return () => v.removeEventListener('timeupdate', onTU);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── Start recording ──────────────────────────────────────────────────────────

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    const v      = refVideoRef.current;
    if (!stream || !v) return;

    chunksRef.current = [];
    const mimeType = getBestMimeType();
    try {
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
      recorder.ondataavailable = e => { if (e.data?.size > 0) chunksRef.current.push(e.data); };
      recorder.start(100);
      recorderRef.current = recorder;
    } catch (e) {
      console.error('MediaRecorder failed', e);
      return;
    }

    // Seek reference video to start then play with music
    v.muted        = false;
    v.playbackRate = 1;
    const startSec = startTimeMs / 1000;
    const doPlay   = () => { if (recorderRef.current) v.play().catch(() => {}); };
    if (Math.abs(v.currentTime - startSec) < 0.05) {
      doPlay();
    } else {
      v.addEventListener('seeked', doPlay, { once: true });
      v.currentTime = startSec;
    }
    setPhase('recording');
  }, [startTimeMs]);

  // ── Stop recording ────────────────────────────────────────────────────────────

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'video/webm' });
      const url  = URL.createObjectURL(blob);
      setRecordingUrl(prev => { if (prev) URL.revokeObjectURL(prev); return url; });
      setPhase('reviewing');
    };
    recorder.stop();
    recorderRef.current = null;
  }, []);

  // ── Reviewing: load blob into playback element ───────────────────────────────

  useEffect(() => {
    if (phase !== 'reviewing' || !recordingUrl) return;
    const v = playbackRef.current;
    if (!v) return;
    v.src = recordingUrl;
    v.load();
    v.play().catch(() => {});
  }, [phase, recordingUrl]);

  // ── Re-record ─────────────────────────────────────────────────────────────────

  const handleReRecord = () => {
    const v = refVideoRef.current;
    if (v) { v.pause(); v.muted = true; }
    setProgress(0);
    setElapsed(0);
    setCountdown(3);
    setPhase('countdown');
  };

  // ── Download ──────────────────────────────────────────────────────────────────

  const handleDownload = () => {
    if (!recordingUrl) return;
    const a = document.createElement('a');
    a.href     = recordingUrl;
    a.download = `performance-take-${Date.now()}.webm`;
    a.click();
  };

  // ── Cleanup ───────────────────────────────────────────────────────────────────

  useEffect(() => () => {
    recorderRef.current?.stop();
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ────────────────────────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────────────────────────

  // ── REVIEWING ────────────────────────────────────────────────────────────────
  if (phase === 'reviewing') {
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col overflow-hidden">
        <video
          ref={playbackRef}
          className="absolute inset-0 w-full h-full object-contain"
          playsInline
          controls
          style={{ transform: 'scaleX(-1)' }}
        />

        {/* Top bar */}
        <div className="relative z-20 flex items-center justify-between px-4 pt-10 pb-2">
          <button onClick={onClose} className="w-10 h-10 bg-black/50 backdrop-blur-md rounded-full flex items-center justify-center text-white border border-white/10">
            <X className="w-5 h-5" />
          </button>
          <div className="bg-black/50 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 flex items-center gap-2">
            <span>🎬</span>
            <span className="text-white/70 text-xs font-semibold">YOUR TAKE · {fmtSec(durationSec)}</span>
          </div>
          <button
            onClick={handleDownload}
            className="w-10 h-10 bg-black/50 backdrop-blur-md rounded-full flex items-center justify-center text-white border border-white/10"
            title="Download take"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>

        {/* Bottom controls */}
        <div className="relative z-20 mt-auto pb-10 px-4 flex gap-3">
          <button
            onClick={handleReRecord}
            className="flex-1 py-4 bg-white/10 hover:bg-white/20 text-white font-bold rounded-2xl transition-all flex items-center justify-center gap-2"
          >
            <RotateCcw className="w-4 h-4" />
            Re-record
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-4 bg-violet-600 hover:bg-violet-500 text-white font-bold rounded-2xl transition-all shadow-[0_0_16px_rgba(139,92,246,0.35)] flex items-center justify-center gap-2"
          >
            <Play className="w-4 h-4 fill-current" />
            Done
          </button>
        </div>
      </div>
    );
  }

  // ── IDLE / COUNTDOWN / RECORDING ─────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col overflow-hidden">

      {/* Split screen */}
      <div className="absolute inset-0 flex">
        {/* Reference video — left half */}
        <div className="flex-1 relative bg-black overflow-hidden border-r border-white/5">
          <video
            ref={refVideoRef}
            className="absolute inset-0 w-full h-full object-contain"
            playsInline
            muted={phase !== 'recording'}
          />
          <span className="absolute top-2 left-2 text-[10px] text-white/25 bg-black/40 px-2 py-0.5 rounded">Reference</span>
        </div>

        {/* Webcam — right half */}
        <div className="flex-1 relative bg-black overflow-hidden">
          <video
            ref={webcamVideoRef}
            className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
            playsInline
            muted
          />
          {camError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 z-10 px-4">
              <span className="text-3xl">📷</span>
              <p className="text-white/50 text-xs text-center">{camError}</p>
            </div>
          )}
          <span className="absolute top-2 left-2 text-[10px] text-white/25 bg-black/40 px-2 py-0.5 rounded">You</span>
          {phase === 'recording' && (
            <div className="absolute top-2 right-2 flex items-center gap-1.5 bg-red-500/85 backdrop-blur-md px-2.5 py-1 rounded-full animate-pulse">
              <div className="w-2 h-2 rounded-full bg-white" />
              <span className="text-white text-[10px] font-bold">REC {fmtSec(elapsed)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Countdown overlay */}
      {phase === 'countdown' && (
        <div className="absolute inset-0 bg-black/65 flex flex-col items-center justify-center z-20 gap-4 pointer-events-none">
          <p className="text-white/40 text-sm uppercase tracking-widest">Get into position</p>
          <div className="text-9xl font-black text-white tabular-nums animate-in zoom-in duration-200">
            {countdown > 0 ? countdown : '▶'}
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className="relative z-20 flex items-center justify-between px-4 pt-10 pb-2">
        <button onClick={onClose} className="w-10 h-10 bg-black/50 backdrop-blur-md rounded-full flex items-center justify-center text-white border border-white/10">
          <X className="w-5 h-5" />
        </button>
        <div className="bg-black/50 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 flex items-center gap-2">
          <span>🎬</span>
          <span className="text-white/70 text-xs font-semibold">PERFORMANCE TAKE</span>
          {title && <span className="text-white/30 text-xs">· {title}</span>}
        </div>
        <div className="w-10 h-10" />
      </div>

      {/* Progress bar (recording only) */}
      {phase === 'recording' && (
        <div className="relative z-20 px-4 mt-1">
          <div className="h-0.5 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-red-400 rounded-full transition-[width] duration-300"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-white/20 text-[9px]">{fmtSec(elapsed)}</span>
            <span className="text-white/20 text-[9px]">{fmtSec(durationSec)}</span>
          </div>
        </div>
      )}

      {/* Bottom controls */}
      <div className="relative z-20 mt-auto pb-10 px-4 flex flex-col items-center gap-3">
        {phase === 'idle' && (
          <>
            <p className="text-white/25 text-xs tracking-widest uppercase">
              {camError ? 'Camera required to record' : `Reference plays · you are recorded · ${fmtSec(durationSec)}`}
            </p>
            <button
              onClick={() => { if (!camError) { setCountdown(3); setPhase('countdown'); } }}
              disabled={!!camError}
              className="w-20 h-20 rounded-full bg-red-500/80 hover:bg-red-500 border-4 border-red-400/50 flex items-center justify-center transition-all active:scale-95 disabled:opacity-30 shadow-[0_0_24px_rgba(239,68,68,0.4)]"
            >
              <Circle className="w-8 h-8 text-white fill-current" />
            </button>
            <p className="text-white/20 text-[10px]">Tap to start recording</p>
          </>
        )}
        {phase === 'recording' && (
          <>
            <p className="text-white/25 text-xs tracking-widest uppercase">Recording in progress</p>
            <button
              onClick={stopRecording}
              className="w-20 h-20 rounded-full bg-red-600/80 hover:bg-red-600 border-4 border-red-400/50 flex items-center justify-center transition-all active:scale-95 shadow-[0_0_24px_rgba(239,68,68,0.5)]"
            >
              <Square className="w-8 h-8 text-white fill-current" />
            </button>
            <p className="text-white/20 text-[10px]">Tap to stop early</p>
          </>
        )}
      </div>
    </div>
  );
}
