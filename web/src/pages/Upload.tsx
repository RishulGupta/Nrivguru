import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUploadStore } from '../store/uploadStore';
import { extractThumbnail, chunkVideoWithAI } from '../utils/videoProcessor';
import { extractFrames } from '../utils/poseExtractor';
import {
  Upload as UploadIcon, CheckCircle, AlertCircle,
  Play, Loader2, Film, ChevronLeft, RefreshCw,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/useStore';
import { setOriginalVideo, getOriginalVideoUrl } from '../utils/videoStore';

// ─── Constants ────────────────────────────────────────────────────────────────

const STYLE_OPTIONS = [
  'Bollywood', 'Hip-Hop', 'K-Pop', 'Classical Indian',
  'Salsa/Latin', 'Wedding/Sangeet', 'Contemporary', 'Other',
];

const MAX_FILE_SIZE_BYTES    = 500 * 1024 * 1024;   // 500 MB
const MAX_DURATION_SECONDS   = 300;                  // 5 min max
const PIPELINE_TIMEOUT_MS    = 360_000;              // 6 min hard ceiling
const LAST_STYLE_STORAGE_KEY = 'taal-last-style';

// ─── Stage definitions ────────────────────────────────────────────────────────

interface PipelineStage {
  key:        string;
  label:      string;
  emoji:      string;
  startPct:   number;
  endPct:     number;
}

const STAGES: PipelineStage[] = [
  { key: 'UPLOADING',      label: 'Reading video',       emoji: '🎬', startPct: 0,  endPct: 15  },
  { key: 'CHUNKING',       label: 'Splitting into moves',emoji: '✂️', startPct: 15, endPct: 38  },
  { key: 'ANALYZING_POSE', label: 'Analysing poses',     emoji: '🦴', startPct: 38, endPct: 80  },
  { key: 'SAVING',         label: 'Saving routine',      emoji: '💾', startPct: 80, endPct: 100 },
];

function getStageForProgress(pct: number): PipelineStage {
  return (
    STAGES.slice().reverse().find(s => pct >= s.startPct) ?? STAGES[0]
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

interface EtaDisplayProps {
  progress:  number;
  startedAt: number | null;
}

function EtaDisplay({ progress, startedAt }: EtaDisplayProps) {
  const [eta, setEta] = useState<string | null>(null);

  useEffect(() => {
    if (!startedAt || progress <= 2 || progress >= 98) { setEta(null); return; }
    const elapsed = (Date.now() - startedAt) / 1000;
    const total   = elapsed / (progress / 100);
    const rem     = Math.max(0, total - elapsed);
    setEta(rem < 10 ? 'almost done' : `~${Math.ceil(rem / 10) * 10}s remaining`);
  }, [progress, startedAt]);

  if (!eta) return null;
  return <p className="text-xs text-white/40 mt-1">{eta}</p>;
}

// ─── Drop Zone ────────────────────────────────────────────────────────────────

interface DropZoneProps {
  isDragOver: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onClick: () => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

function DropZone({
  isDragOver, onDragOver, onDragLeave, onDrop, onClick, fileInputRef, onFileSelect,
}: DropZoneProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Select a dance video to upload"
      className={[
        'border-2 border-dashed rounded-2xl p-12 flex flex-col items-center',
        'justify-center text-center cursor-pointer transition-all duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        isDragOver
          ? 'border-primary bg-primary/10 scale-[1.01]'
          : 'border-white/20 hover:border-primary/50 hover:bg-white/5',
      ].join(' ')}
      onClick={onClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onKeyDown={e => e.key === 'Enter' && onClick()}
    >
      <div className={[
        'w-16 h-16 rounded-full flex items-center justify-center mb-4 transition-colors',
        isDragOver ? 'bg-primary/30' : 'bg-white/5',
      ].join(' ')}>
        {isDragOver
          ? <Film className="w-8 h-8 text-primary" />
          : <UploadIcon className="w-8 h-8 text-white/40" />}
      </div>

      <h3 className="text-xl font-bold text-white mb-2">
        {isDragOver ? 'Drop to analyse' : 'Select a dance video'}
      </h3>
      <p className="text-sm text-white/50 max-w-xs mb-6">
        Upload a video and AI will split it into individual moves you can practise step-by-step.
        Your video stays on your device.
      </p>
      <p className="text-xs text-white/30 mb-5">MP4, MOV, WebM · Max 500 MB · Max 5 minutes</p>
      <button
        type="button"
        className="bg-white/10 hover:bg-white/20 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-all"
      >
        Browse files
      </button>

      <input
        ref={fileInputRef}
        type="file"
        onChange={onFileSelect}
        accept="video/mp4,video/quicktime,video/x-msvideo,video/webm"
        className="hidden"
        aria-hidden="true"
      />
    </div>
  );
}

// ─── Processing overlay ───────────────────────────────────────────────────────

interface ProcessingOverlayProps {
  pipelineState: string;
  progress:      number;
  startedAt:     number | null;
  onGoHome:      () => void;
}

function ProcessingOverlay({ pipelineState, progress, startedAt, onGoHome }: ProcessingOverlayProps) {
  if (pipelineState === 'IDLE' || pipelineState === 'ERROR') return null;

  const isDone = pipelineState === 'DONE';

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={isDone ? 'Processing complete' : 'Processing video'}
      className="absolute inset-0 bg-black/85 backdrop-blur-sm z-50 flex flex-col
                 items-center justify-center p-8 text-center rounded-3xl"
    >
      {isDone ? (
        <>
          <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mb-5 animate-[scale-in_0.4s_ease-out]">
            <CheckCircle className="w-10 h-10 text-green-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Ready to practise!</h2>
          <p className="text-white/50 text-sm mb-7">Your routine has been split into moves.</p>
          <button
            onClick={onGoHome}
            className="bg-primary hover:bg-primary/90 text-white font-semibold px-8 py-3 rounded-xl
                       transition-all shadow-[0_0_20px_rgba(147,51,234,0.4)] focus-visible:ring-2
                       focus-visible:ring-white focus-visible:outline-none"
          >
            Open Library
          </button>
        </>
      ) : (
        <>
          {/* Animated spinner ring */}
          <div className="relative w-16 h-16 mb-6">
            <Loader2 className="w-16 h-16 text-primary animate-spin" />
            <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-white/70">
              {progress}%
            </span>
          </div>

          {/* Current stage label */}
          {(() => {
            const stage = getStageForProgress(progress);
            return (
              <h2 className="text-lg font-bold text-white mb-1">
                {stage.emoji} {stage.label}…
              </h2>
            );
          })()}

          <EtaDisplay progress={progress} startedAt={startedAt} />

          {/* Stage checklist */}
          <ul className="mt-6 space-y-2 w-full max-w-xs text-left" aria-label="Pipeline stages">
            {STAGES.map(stage => {
              const isDone  = progress >= stage.endPct;
              const isActive = !isDone && progress >= stage.startPct;
              return (
                <li key={stage.key} className="flex items-center gap-3 text-sm">
                  {isDone ? (
                    <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
                  ) : isActive ? (
                    <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border border-white/20 shrink-0" />
                  )}
                  <span className={isDone ? 'text-green-400' : isActive ? 'text-white' : 'text-white/30'}>
                    {stage.emoji} {stage.label}
                  </span>
                </li>
              );
            })}
          </ul>

          {/* Progress bar */}
          <div
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            className="w-full max-w-md h-2 bg-white/10 rounded-full mt-6 overflow-hidden"
          >
            <div
              className="h-full bg-primary transition-all duration-500 ease-out rounded-full
                         shadow-[0_0_12px_rgba(147,51,234,0.7)]"
              style={{ width: `${progress}%` }}
            />
          </div>
        </>
      )}
    </div>
  );
}

// ─── Error banner ─────────────────────────────────────────────────────────────

interface ErrorBannerProps {
  error:    string;
  onDismiss: () => void;
  onRetry?:  () => void;
}

function ErrorBanner({ error, onDismiss, onRetry }: ErrorBannerProps) {
  return (
    <div
      role="alert"
      className="bg-destructive/15 border border-destructive/50 text-destructive px-4 py-3
                 rounded-xl mb-6 flex items-start gap-3"
    >
      <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm">Processing failed</p>
        <p className="text-xs opacity-80 mt-0.5 break-words">{error}</p>
      </div>
      <div className="flex gap-2 shrink-0">
        {onRetry && (
          <button
            onClick={onRetry}
            className="flex items-center gap-1 text-xs font-semibold px-2 py-1
                       hover:bg-destructive/10 rounded transition-colors"
            aria-label="Retry processing"
          >
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        )}
        <button
          onClick={onDismiss}
          className="text-xs font-semibold px-2 py-1 hover:bg-destructive/10 rounded transition-colors"
          aria-label="Dismiss error"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Upload() {
  const navigate  = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    pipelineState, videoFile, videoUrl, progress, error,
    setPipelineState, setVideoFile, setProgress, setError, reset,
  } = useUploadStore();

  // Remember style preference across sessions
  const [styleTag, setStyleTag] = useState(
    () => localStorage.getItem(LAST_STYLE_STORAGE_KEY) ?? 'Other'
  );
  const [routineTitle, setRoutineTitle]   = useState('');
  const [videoDuration, setVideoDuration] = useState(0);
  const [isDragOver, setIsDragOver]       = useState(false);
  const [cleanupPaths, setCleanupPaths]   = useState<string[]>([]);
  const [pipelineStartedAt, setPipelineStartedAt] = useState<number | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  // ── File validation ────────────────────────────────────────────────────────

  const validateAndLoadFile = useCallback((file: File): boolean => {
    if (!file.type.startsWith('video/')) {
      setError('Please select a video file (MP4, MOV, or WebM).');
      return false;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError(`This file is ${formatSize(file.size)} — the limit is 500 MB.`);
      return false;
    }
    return true;
  }, [setError]);

  const loadFileMeta = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    const v   = document.createElement('video');
    v.preload = 'metadata';
    v.src     = url;
    v.onloadedmetadata = () => {
      if (v.duration > MAX_DURATION_SECONDS) {
        setError(`Video is ${formatDuration(v.duration)} — max is 5 minutes.`);
        URL.revokeObjectURL(url);
        return;
      }
      setVideoDuration(v.duration);
      URL.revokeObjectURL(url);
    };
  }, [setError]);

  // ── Event handlers ─────────────────────────────────────────────────────────

  const handleDragOver  = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); };
  const handleDragLeave = () => setIsDragOver(false);

  const applyFile = useCallback((file: File) => {
    if (!validateAndLoadFile(file)) return;
    setVideoFile(file);
    setOriginalVideo(URL.createObjectURL(file));
    setRoutineTitle(file.name.replace(/\.[^/.]+$/, ''));
    setError(null);
    loadFileMeta(file);
  }, [validateAndLoadFile, setVideoFile, setError, loadFileMeta]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) applyFile(file);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) applyFile(file);
    // Reset input so the same file can be re-selected after an error
    e.target.value = '';
  };

  const handleStyleChange = (s: string) => {
    setStyleTag(s);
    try { localStorage.setItem(LAST_STYLE_STORAGE_KEY, s); } catch { /* ignore */ }
  };

  // ── Cancel ─────────────────────────────────────────────────────────────────

  const handleCancel = useCallback(() => {
    abortControllerRef.current?.abort();
    setPipelineState('IDLE');
    setProgress(0);
    // Best-effort removal of any partial uploads
    (async () => {
      for (const path of cleanupPaths) {
        const [bucket, ...parts] = path.split('/');
        await supabase.storage.from(bucket).remove([parts.join('/')]).catch(() => {});
      }
    })();
    reset();
  }, [cleanupPaths, reset, setPipelineState, setProgress]);

  // ── Pipeline ───────────────────────────────────────────────────────────────

  const startPipeline = async () => {
    if (!videoFile) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const { signal } = controller;

    const pipelineTimer = setTimeout(() => {
      controller.abort();
      setError('Processing timed out after 6 minutes. Try a shorter video (under 2 minutes works best).');
      setPipelineState('IDLE');
    }, PIPELINE_TIMEOUT_MS);

    const trackPath = (path: string) => setCleanupPaths(p => [...p, path]);

    try {
      const { session, isGuest } = useAuthStore.getState();
      if (!session && !isGuest) throw new Error('Not authenticated');

      setPipelineStartedAt(Date.now());

      // ── 1. Credit check ──────────────────────────────────────────────────
      if (session?.user?.id) {
        try {
          const { data: balance } = await supabase.rpc('rpc_get_credit_balance', {
            p_user_id: session.user.id,
          });
          if (balance !== null && balance <= 0) {
            throw new Error('Not enough credits. Purchase credits to process another routine.');
          }
        } catch (e: any) {
          if (e.message.includes('credits')) throw e; // propagate
          // Otherwise Supabase is unavailable — continue
        }
      }

      // ── 2. Thumbnail ─────────────────────────────────────────────────────
      setPipelineState('UPLOADING');
      setProgress(3);
      const thumbnailDataUrl = await extractThumbnail(videoFile);
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');

      let thumbnailUrl = '';
      if (session?.user?.id) {
        try {
          const blob     = await (await fetch(thumbnailDataUrl)).blob();
          const thumbPath = `${session.user.id}/${Date.now()}-thumb.jpg`;
          const { error: e } = await supabase.storage
            .from('taal-thumbnails')
            .upload(thumbPath, blob, { contentType: 'image/jpeg' });
          if (!e) {
            thumbnailUrl = supabase.storage.from('taal-thumbnails').getPublicUrl(thumbPath).data.publicUrl;
            trackPath(`taal-thumbnails/${thumbPath}`);
          }
        } catch { /* storage unavailable */ }
      }
      setProgress(15);

      // ── 3. AI chunking ───────────────────────────────────────────────────
      setPipelineState('CHUNKING');
      setProgress(18);
      const dur = videoDuration || await new Promise<number>((res) => {
        const v = document.createElement('video');
        v.src = URL.createObjectURL(videoFile);
        v.onloadedmetadata = () => { res(v.duration); URL.revokeObjectURL(v.src); };
      });
      const chunksData = await chunkVideoWithAI(videoFile, dur, styleTag);
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      setProgress(38);

      // ── 4. Pose extraction ───────────────────────────────────────────────
      setPipelineState('ANALYZING_POSE');
      const frames = await extractFrames(
        videoFile,
        (p) => setProgress(38 + p * 0.42),  // maps 0–100% → 38–80%
        { signal },
      );
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');

      let poseJsonUrl = '';
      if (session?.user?.id) {
        try {
          const blob     = new Blob([JSON.stringify(frames)], { type: 'application/json' });
          const posePath = `${session.user.id}/${Date.now()}-pose.json`;
          const { error: e } = await supabase.storage
            .from('taal-pose-json')
            .upload(posePath, blob, { contentType: 'application/json' });
          if (!e) {
            poseJsonUrl = supabase.storage.from('taal-pose-json').getPublicUrl(posePath).data.publicUrl;
            trackPath(`taal-pose-json/${posePath}`);
          }
        } catch { /* storage unavailable */ }
      }
      setProgress(80);

      // ── 5. Spend credit ──────────────────────────────────────────────────
      setPipelineState('SAVING');
      if (session?.user?.id) {
        try {
          const { data: spend } = await supabase.rpc('rpc_spend_credit', { p_user_id: session.user.id });
          if (spend?.balance !== undefined) {
            useAuthStore.getState().setCredits(spend.balance);
          }
        } catch { /* Supabase unavailable */ }
      }
      setProgress(83);

      // ── 6. Build chunk records ───────────────────────────────────────────
      const finalChunks = chunksData.map((c: any) => ({
        chunk_index:   c.chunk_index,
        start_time_ms: c.start_time_ms,
        end_time_ms:   c.end_time_ms,
        description:   c.description,
        clip_url:      '',
        pose_slice_json: frames.filter(
          (f: any) => f.timestamp_ms >= c.start_time_ms && f.timestamp_ms <= c.end_time_ms
        ),
      }));
      setProgress(88);

      // ── 7. Persist to Supabase ───────────────────────────────────────────
      if (session?.user?.id) {
        try {
          const { data: routineData } = await supabase.rpc('rpc_create_routine', {
            p_user_id:        session.user.id,
            p_title:          routineTitle || videoFile.name.replace(/\.[^/.]+$/, ''),
            p_style_tag:      styleTag,
            p_thumbnail_url:  thumbnailUrl,
            p_pose_json_url:  poseJsonUrl,
            p_duration_seconds: Math.round(dur),
          });
          if (routineData?.id) {
            await supabase.rpc('rpc_save_chunks', {
              p_routine_id: routineData.id,
              p_chunks:     finalChunks,
            });
          }
        } catch { /* Supabase unavailable */ }
      }

      // ── 8. LocalStorage (guest / offline) ───────────────────────────────
      try {
        const stored     = JSON.parse(localStorage.getItem('taal-local-routines') ?? '[]');
        const routineId  = `local-${Date.now()}`;
        const newRoutine = {
          id:                 routineId,
          title:              routineTitle || videoFile.name.replace(/\.[^/.]+$/, ''),
          style_tag:          styleTag,
          thumbnail_url:      thumbnailUrl || '',
          chunk_count:        finalChunks.length,
          duration_seconds:   Math.round(dur),
          last_score:         null,
          last_practiced_at:  new Date().toISOString(),
          created_at:         new Date().toISOString(),
        };
        stored.unshift(newRoutine);
        localStorage.setItem('taal-local-routines', JSON.stringify(stored.slice(0, 20)));
        localStorage.setItem(`taal-local-routine-${routineId}`, JSON.stringify({
          ...newRoutine,
          chunks: finalChunks.map((c: any, i: number) => ({
            id: `ch-${i}`, ...c,
          })),
          instructor:     'You',
          difficulty:     styleTag,
          video_blob_url: getOriginalVideoUrl(),
        }));
      } catch { /* localStorage unavailable */ }

      clearTimeout(pipelineTimer);
      setProgress(100);
      setPipelineState('DONE');

    } catch (err: any) {
      clearTimeout(pipelineTimer);

      if (err.name === 'AbortError' || err.message === 'Cancelled') {
        // User-initiated cancel — clean up and reset silently
        for (const path of cleanupPaths) {
          const [bucket, ...parts] = path.split('/');
          await supabase.storage.from(bucket).remove([parts.join('/')]).catch(() => {});
        }
        reset();
        return;
      }

      const message = err.message || 'Something went wrong during processing.';
      setError(message);
      setPipelineState('ERROR');
    }
  };

  const isProcessing = !['IDLE', 'DONE', 'ERROR'].includes(pipelineState);

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-2xl">

        {/* Header */}
        <div className="flex items-center justify-between mb-7">
          <h1 className="text-2xl sm:text-3xl font-outfit font-bold text-white neon-text">
            Upload
          </h1>
          <button
            onClick={isProcessing ? handleCancel : () => navigate('/home')}
            className="flex items-center gap-1.5 text-sm text-white/50 hover:text-white transition-colors
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
            aria-label={isProcessing ? 'Cancel processing' : 'Back to home'}
          >
            {isProcessing ? (
              '✕ Cancel'
            ) : (
              <><ChevronLeft className="w-4 h-4" /> Back</>
            )}
          </button>
        </div>

        {/* Main card */}
        <div className="glass p-6 sm:p-8 rounded-3xl border border-white/10 relative overflow-hidden">

          {/* Processing overlay */}
          <ProcessingOverlay
            pipelineState={pipelineState}
            progress={progress}
            startedAt={pipelineStartedAt}
            onGoHome={() => navigate('/home')}
          />

          {/* Error banner */}
          {error && (
            <ErrorBanner
              error={error}
              onDismiss={reset}
              onRetry={videoFile ? () => { setError(null); startPipeline(); } : undefined}
            />
          )}

          {/* Body: drop zone OR video preview + form */}
          {!videoFile ? (
            <DropZone
              isDragOver={isDragOver}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              fileInputRef={fileInputRef}
              onFileSelect={handleFileSelect}
            />
          ) : (
            <div className="space-y-5">
              {/* Video preview */}
              <div className="aspect-video bg-black rounded-xl overflow-hidden border border-white/10">
                {videoUrl && (
                  <video
                    src={videoUrl}
                    className="w-full h-full object-contain"
                    controls
                    playsInline
                    muted
                  />
                )}
              </div>

              {/* File info */}
              <div className="flex items-center gap-3 px-1">
                <Film className="w-4 h-4 text-white/40 shrink-0" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{videoFile.name}</p>
                  <p className="text-xs text-white/40">
                    {formatSize(videoFile.size)}
                    {videoDuration > 0 && ` · ${formatDuration(videoDuration)}`}
                  </p>
                </div>
              </div>

              {/* Routine name */}
              <div>
                <label htmlFor="routine-title" className="block text-xs font-semibold text-white/70 mb-1.5">
                  Routine name
                </label>
                <input
                  id="routine-title"
                  type="text"
                  value={routineTitle}
                  onChange={e => setRoutineTitle(e.target.value)}
                  placeholder="e.g. Wedding opener"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white
                             placeholder:text-white/25 focus:outline-none focus:ring-2 focus:ring-primary transition-all"
                />
              </div>

              {/* Style selector */}
              <div>
                <label htmlFor="style-tag" className="block text-xs font-semibold text-white/70 mb-1.5">
                  Dance style
                </label>
                <select
                  id="style-tag"
                  value={styleTag}
                  onChange={e => handleStyleChange(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white
                             focus:outline-none focus:ring-2 focus:ring-primary transition-all appearance-none"
                >
                  {STYLE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={reset}
                  className="text-sm text-white/40 hover:text-white transition-colors
                             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                >
                  Change video
                </button>
                <button
                  type="button"
                  onClick={startPipeline}
                  className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-white
                             text-sm font-semibold px-6 py-2.5 rounded-xl transition-all
                             shadow-[0_0_18px_rgba(147,51,234,0.35)]
                             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  <Play className="w-4 h-4 fill-current" aria-hidden="true" />
                  Process routine
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}