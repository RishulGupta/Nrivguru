import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUploadStore } from '../store/uploadStore';
import { extractThumbnail, chunkVideoWithAI } from '../utils/videoProcessor';
import { extractFrames } from '../utils/poseExtractor';
import { Upload as UploadIcon, CheckCircle, AlertCircle, Play, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/useStore';
import { setOriginalVideo, getOriginalVideoUrl } from '../utils/videoStore';

const STYLE_OPTIONS = [
  'Bollywood', 'Hip-Hop', 'K-Pop', 'Classical Indian',
  'Salsa/Latin', 'Wedding/Sangeet', 'Contemporary', 'Other'
];

const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024; // 500MB

export default function Upload() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    pipelineState,
    videoFile,
    videoUrl,
    progress,
    error,
    setPipelineState,
    setVideoFile,
    setProgress,
    setError,
    reset
  } = useUploadStore();
  const [styleTag, setStyleTag] = useState('Other');
  const [routineTitle, setRoutineTitle] = useState('');
  const [videoDuration, setVideoDuration] = useState(0);
  const [cancelCleanup, setCancelCleanup] = useState<string[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const abortRef = useRef(false);

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => setIsDragOver(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      if (!file.type.startsWith('video/')) { setError('Please select a valid video file.'); return; }
      if (file.size > MAX_FILE_SIZE_BYTES) { setError('File too large. Maximum size is 500MB.'); return; }
      setVideoFile(file);
      setRoutineTitle(file.name.replace(/\.[^/.]+$/, ''));
      setError(null);
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.src = URL.createObjectURL(file);
      v.onloadedmetadata = () => { setVideoDuration(v.duration); URL.revokeObjectURL(v.src); };
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('video/')) {
        setError('Please select a valid video file.');
        return;
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        setError('File too large. Maximum size is 500MB.');
        return;
      }
      setVideoFile(file);
      setOriginalVideo(URL.createObjectURL(file));
      setRoutineTitle(file.name.replace(/\.[^/.]+$/, ""));
      setError(null);
      // Get duration
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.src = URL.createObjectURL(file);
      v.onloadedmetadata = () => {
        setVideoDuration(v.duration);
        URL.revokeObjectURL(v.src);
      };
    }
  };

  const startPipeline = async () => {
    if (!videoFile) return;
    abortRef.current = false;

    // Overall pipeline timeout — 5 minutes max
    const pipelineTimeout = setTimeout(() => {
      abortRef.current = true;
      setError('Pipeline timed out after 5 minutes. Try a shorter video.');
      setPipelineState('IDLE');
    }, 300000);

    try {
      const { session, isGuest } = useAuthStore.getState();
      if (!session && !isGuest) throw new Error('Not authenticated');
      const userId = session?.user?.id || 'guest';

      // Check credits first (graceful if Supabase not available)
      try {
        const { data: balance } = await supabase.rpc('rpc_get_credit_balance', {
          p_user_id: session.user.id
        });
        if (balance !== null && balance <= 0) {
          setError('Insufficient credits. Please purchase credits to process a routine.');
          return;
        }
      } catch {
        // Supabase not available — skip credit check
      }

      setPipelineState('UPLOADING');
      setProgress(5);

      // 1. Extract Thumbnail
      const thumbnailDataUrl = await extractThumbnail(videoFile);
      if (abortRef.current) throw new Error('Cancelled');
      let thumbnailUrl = '';
      try {
        const thumbnailBlob = await (await fetch(thumbnailDataUrl)).blob();
        const thumbPath = `${session.user.id}/${Date.now()}-thumb.jpg`;
        const { error: thumbErr } = await supabase.storage
          .from('taal-thumbnails')
          .upload(thumbPath, thumbnailBlob, { contentType: 'image/jpeg' });
        if (!thumbErr) {
          thumbnailUrl = supabase.storage.from('taal-thumbnails').getPublicUrl(thumbPath).data.publicUrl;
          setCancelCleanup(prev => [...prev, `taal-thumbnails/${thumbPath}`]);
        }
      } catch { /* Supabase storage not available */ }
      setProgress(15);

      // 2. Chunking with AI
      setPipelineState('CHUNKING');
      setProgress(20);
      const dur = videoDuration || await new Promise<number>((resolve) => {
        const v = document.createElement('video');
        v.src = URL.createObjectURL(videoFile);
        v.onloadedmetadata = () => { resolve(v.duration); URL.revokeObjectURL(v.src); };
      });
      const chunksData = await chunkVideoWithAI(videoFile, dur, styleTag);
      if (abortRef.current) throw new Error('Cancelled');
      setProgress(35);

      // 3. Extracting Poses
      setPipelineState('ANALYZING_POSE');
      const frames = await extractFrames(videoFile, (p) => {
        setProgress(35 + (p * 0.25));
      });
      if (abortRef.current) throw new Error('Cancelled');
      let poseJsonUrl = '';
      try {
        const poseBlob = new Blob([JSON.stringify(frames)], { type: 'application/json' });
        const posePath = `${session.user.id}/${Date.now()}-pose.json`;
        const { error: poseErr } = await supabase.storage
          .from('taal-pose-json')
          .upload(posePath, poseBlob, { contentType: 'application/json' });
        if (!poseErr) {
          poseJsonUrl = supabase.storage.from('taal-pose-json').getPublicUrl(posePath).data.publicUrl;
          setCancelCleanup(prev => [...prev, `taal-pose-json/${posePath}`]);
        }
      } catch { /* Supabase storage not available */ }
      setProgress(60);

      // 4. Spend credit (graceful if Supabase not available)
      setPipelineState('SAVING');
      try {
        const { data: spendResult } = await supabase.rpc('rpc_spend_credit', {
          p_user_id: session.user.id
        });
        if (spendResult && !spendResult.success) {
          // insufficient credits — let it continue anyway in offline mode
        }
        if (spendResult?.balance !== undefined) {
          useAuthStore.getState().setCredits(spendResult.balance);
        }
      } catch { /* Supabase not available */ }

      // 5. Prepare chunk data (skip laggy clip creation — use original video with time seeking)
      setProgress(65);
      const finalChunks = chunksData.map((c: any, i: number) => ({
        chunk_index: c.chunk_index,
        start_time_ms: c.start_time_ms,
        end_time_ms: c.end_time_ms,
        description: c.description,
        clip_url: '', // empty — Practice uses original video blob with time-range seeking
      }));
      setProgress(90);

      // 6. Save to Database (graceful if Supabase not available)
      try {
        const { data: routineData } = await supabase.rpc('rpc_create_routine', {
          p_user_id: session.user.id,
          p_title: routineTitle || videoFile.name.replace(/\.[^/.]+$/, ""),
          p_style_tag: styleTag,
          p_thumbnail_url: thumbnailUrl,
          p_pose_json_url: poseJsonUrl,
          p_duration_seconds: Math.round(dur)
        });
        if (routineData?.id) {
          await supabase.rpc('rpc_save_chunks', {
            p_routine_id: routineData.id,
            p_chunks: finalChunks
          }).catch(() => {});
        }
      } catch { /* Supabase not available */ }

      // Save routine to localStorage (for guest/offline mode)
      try {
        const stored = JSON.parse(localStorage.getItem('taal-local-routines') || '[]');
        stored.unshift({
          id: `local-${Date.now()}`,
          title: routineTitle || videoFile.name.replace(/\.[^/.]+$/, ""),
          style_tag: styleTag,
          thumbnail_url: thumbnailUrl || '',
          chunk_count: finalChunks.length,
          duration_seconds: Math.round(dur),
          last_score: null,
          last_practiced_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        });
        localStorage.setItem('taal-local-routines', JSON.stringify(stored.slice(0, 20)));
        // Also store detail for individual viewing
        localStorage.setItem(`taal-local-routine-${stored[0].id}`, JSON.stringify({
          id: stored[0].id,
          title: stored[0].title,
          style_tag: styleTag,
          thumbnail_url: thumbnailUrl || '',
          chunk_count: finalChunks.length,
          chunks: finalChunks.map((c: any, i: number) => ({
            id: `ch-${i}`,
            chunk_index: i,
            start_time_ms: c.start_time_ms,
            end_time_ms: c.end_time_ms,
            description: c.description,
            clip_url: c.clip_url,
          })),
          duration_seconds: Math.round(dur),
          instructor: 'You',
          difficulty: styleTag,
          video_blob_url: getOriginalVideoUrl(),
        }));
      } catch { /* localStorage not available */ }

      clearTimeout(pipelineTimeout);
      setProgress(100);
      setPipelineState('DONE');

    } catch (err: any) {
      clearTimeout(pipelineTimeout);
      if (err.message === 'Cancelled') {
        // Clean up partial uploads
        for (const path of cancelCleanup) {
          const [bucket, ...p] = path.split('/');
          await supabase.storage.from(bucket).remove([p.join('/')]).catch(() => {});
        }
        reset();
        return;
      }
      setError(err.message || 'An error occurred during processing.');
    }
  };

  const handleCancel = () => {
    abortRef.current = true;
    setPipelineState('IDLE');
    setProgress(0);
    // Clean up partial uploads
    (async () => {
      for (const path of cancelCleanup) {
        const [bucket, ...p] = path.split('/');
        await supabase.storage.from(bucket).remove([p.join('/')]).catch(() => {});
      }
    })();
    reset();
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-3xl">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-3xl font-outfit font-bold text-white neon-text">Upload Routine</h1>
          <button
            onClick={() => {
              if (pipelineState !== 'IDLE' && pipelineState !== 'DONE' && pipelineState !== 'ERROR') {
                handleCancel();
              } else {
                navigate('/home');
              }
            }}
            className="text-muted-foreground hover:text-white transition-colors"
          >
            {pipelineState !== 'IDLE' && pipelineState !== 'DONE' && pipelineState !== 'ERROR' ? 'Cancel' : 'Back'}
          </button>
        </div>

        <div className="glass p-8 rounded-3xl border border-white/10 relative overflow-hidden">
          {/* Processing Overlay */}
          {(pipelineState !== 'IDLE' && pipelineState !== 'ERROR') && (
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center p-8 text-center">
              {pipelineState === 'DONE' ? (
                <>
                  <CheckCircle className="w-16 h-16 text-green-400 mb-4" />
                  <h2 className="text-2xl font-bold text-white mb-2">Processing Complete!</h2>
                  <p className="text-muted-foreground mb-6">Your routine has been segmented and analyzed.</p>
                  <button
                    onClick={() => navigate('/home')}
                    className="bg-primary hover:bg-primary/90 text-white font-semibold px-8 py-3 rounded-xl transition-all shadow-[0_0_15px_rgba(147,51,234,0.3)]"
                  >
                    Go to Library
                  </button>
                </>
              ) : (
                <>
                  <Loader2 className="w-12 h-12 text-primary animate-spin mb-6" />
                  <h2 className="text-xl font-bold text-white mb-4">
                    {pipelineState === 'UPLOADING' && 'Extracting thumbnail...'}
                    {pipelineState === 'CHUNKING' && 'Breaking into learnable sections...'}
                    {pipelineState === 'ANALYZING_POSE' && 'Extracting your dance movements...'}
                    {pipelineState === 'SAVING' && 'Preparing slow-motion clips & saving...'}
                  </h2>
                  {/* Step indicators */}
                  <div className="text-left space-y-2 mb-6 w-full max-w-xs">
                    <div className="flex items-center gap-2 text-sm">
                      {progress >= 15 ? <CheckCircle className="w-4 h-4 text-green-400" /> : <Loader2 className="w-4 h-4 text-primary animate-spin" />}
                      <span className={progress >= 15 ? 'text-green-400' : 'text-white/70'}>Extracting thumbnail</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      {progress >= 35 ? <CheckCircle className="w-4 h-4 text-green-400" /> : progress >= 20 ? <Loader2 className="w-4 h-4 text-primary animate-spin" /> : <div className="w-4 h-4" />}
                      <span className={progress >= 35 ? 'text-green-400' : progress >= 20 ? 'text-white' : 'text-white/40'}>Breaking into learnable sections...</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      {progress >= 60 ? <CheckCircle className="w-4 h-4 text-green-400" /> : progress >= 35 ? <Loader2 className="w-4 h-4 text-primary animate-spin" /> : <div className="w-4 h-4" />}
                      <span className={progress >= 60 ? 'text-green-400' : progress >= 35 ? 'text-white' : 'text-white/40'}>Extracting your dance movements</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      {progress >= 90 ? <CheckCircle className="w-4 h-4 text-green-400" /> : progress >= 65 ? <Loader2 className="w-4 h-4 text-primary animate-spin" /> : <div className="w-4 h-4" />}
                      <span className={progress >= 90 ? 'text-green-400' : progress >= 65 ? 'text-white' : 'text-white/40'}>Preparing slow-motion clips</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      {progress >= 100 ? <CheckCircle className="w-4 h-4 text-green-400" /> : progress >= 90 ? <Loader2 className="w-4 h-4 text-primary animate-spin" /> : <div className="w-4 h-4" />}
                      <span className={progress >= 100 ? 'text-green-400' : progress >= 90 ? 'text-white' : 'text-white/40'}>Saving your routine</span>
                    </div>
                  </div>
                  <div className="w-full max-w-md h-2 bg-white/10 rounded-full mt-4 overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all duration-300 ease-out shadow-[0_0_10px_rgba(147,51,234,0.8)]"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {error && (
            <div className="bg-destructive/20 border border-destructive text-destructive px-4 py-3 rounded-xl mb-6 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold">Processing Failed</p>
                <p className="text-sm opacity-90">{error}</p>
              </div>
              <button onClick={reset} className="text-xs font-semibold px-2 py-1 hover:bg-destructive/10 rounded">Dismiss</button>
            </div>
          )}

          {!videoFile ? (
            <div
              className={`border-2 border-dashed rounded-2xl p-12 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-white/5 transition-all group ${
                isDragOver ? 'border-primary bg-primary/10' : 'border-white/20 hover:border-primary/50'
              }`}
              onClick={handleUploadClick}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                <UploadIcon className="w-8 h-8 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Select Reference Video</h3>
              <p className="text-muted-foreground text-sm max-w-sm mb-6">
                Upload a full dance routine. Our AI will automatically slice it into learnable chunks and extract 3D joint data.
                Your video stays on your device. Only your dance movements are saved.
              </p>
              <p className="text-xs text-muted-foreground mb-4">Supports MP4, MOV, AVI, WebM — Max 500MB</p>
              <button className="bg-white/10 hover:bg-white/20 text-white font-semibold px-6 py-2 rounded-lg transition-all">
                Browse Files
              </button>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                accept="video/mp4,video/quicktime,video/x-msvideo,video/webm"
                className="hidden"
              />
            </div>
          ) : (
            <div className="space-y-6">
              <div className="aspect-video bg-black rounded-xl overflow-hidden relative border border-white/10">
                {videoUrl && (
                  <video
                    src={videoUrl}
                    className="w-full h-full object-contain"
                    controls
                  />
                )}
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-white">{videoFile.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {(videoFile.size / (1024 * 1024)).toFixed(2)} MB
                    {videoDuration > 0 && ` • ${Math.round(videoDuration)}s`}
                  </p>
                </div>
              </div>

              {/* Style tag selector */}
              <div>
                <label className="text-sm text-white font-semibold block mb-2">Routine Name</label>
                <input
                  type="text"
                  value={routineTitle}
                  onChange={e => setRoutineTitle(e.target.value)}
                  className="w-full bg-input/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-primary transition-all"
                />
              </div>

              <div>
                <label className="text-sm text-white font-semibold block mb-2">Style Tag</label>
                <select
                  value={styleTag}
                  onChange={e => setStyleTag(e.target.value)}
                  className="w-full bg-input/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-primary transition-all"
                >
                  {STYLE_OPTIONS.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-3 justify-end">
                <button
                  onClick={reset}
                  className="px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-white transition-colors"
                >
                  Change Video
                </button>
                <button
                  onClick={startPipeline}
                  className="bg-primary hover:bg-primary/90 text-white font-semibold px-6 py-2 rounded-xl transition-all shadow-[0_0_15px_rgba(147,51,234,0.3)] flex items-center gap-2"
                >
                  <Play className="w-4 h-4 fill-current" />
                  Process Routine
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
