import React, { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUploadStore } from '../store/uploadStore';
import { extractThumbnail, chunkVideoWithAI, sliceVideo } from '../utils/videoProcessor';
import { extractFrames } from '../utils/poseExtractor';
import { Upload as UploadIcon, CheckCircle, AlertCircle, Play, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/useStore';

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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('video/')) {
        setError('Please select a valid video file.');
        return;
      }
      setVideoFile(file);
      setError(null);
    }
  };

  const startPipeline = async () => {
    if (!videoFile) return;

    try {
      setPipelineState('UPLOADING');
      setProgress(10);
      
      // 1. Extract Thumbnail
      const session = useAuthStore.getState().session;
      const thumbnailDataUrl = await extractThumbnail(videoFile);
      const thumbnailBlob = await (await fetch(thumbnailDataUrl)).blob();
      
      const thumbPath = `${session?.user?.id}/${Date.now()}-thumb.jpg`;
      const { error: thumbErr } = await supabase.storage
        .from('taal-thumbnails')
        .upload(thumbPath, thumbnailBlob, { contentType: 'image/jpeg' });
      if (thumbErr) throw thumbErr;
      const thumbnailUrl = supabase.storage.from('taal-thumbnails').getPublicUrl(thumbPath).data.publicUrl;
      setProgress(20);

      // 2. Chunking with AI
      setPipelineState('CHUNKING');
      const videoDuration = await new Promise<number>((resolve) => {
        const v = document.createElement('video');
        v.src = URL.createObjectURL(videoFile);
        v.onloadedmetadata = () => { resolve(v.duration); URL.revokeObjectURL(v.src); };
      });
      const chunksData = await chunkVideoWithAI(videoFile, videoDuration, 'other');
      setProgress(40);

      // 3. Extracting Poses
      setPipelineState('ANALYZING_POSE');
      const frames = await extractFrames(videoFile, (p) => {
        setProgress(40 + (p * 0.3));
      });
      const poseBlob = new Blob([JSON.stringify(frames)], { type: 'application/json' });
      const posePath = `${session?.user?.id}/${Date.now()}-pose.json`;
      const { error: poseErr } = await supabase.storage
        .from('taal-pose-json')
        .upload(posePath, poseBlob, { contentType: 'application/json' });
      if (poseErr) throw poseErr;
      const poseJsonUrl = supabase.storage.from('taal-pose-json').getPublicUrl(posePath).data.publicUrl;
      setProgress(70);

      // 4. Extracting and uploading Chunk Clips
      setPipelineState('SAVING');
      const finalChunks = [];
      for (let i = 0; i < chunksData.length; i++) {
        const c = chunksData[i];
        const clipBlob = await sliceVideo(videoFile, c.start_time_ms, c.end_time_ms);
        const clipPath = `${session?.user?.id}/${Date.now()}-chunk-${i}.webm`;
        const { error: clipErr } = await supabase.storage
          .from('taal-chunk-clips')
          .upload(clipPath, clipBlob, { contentType: 'video/webm' });
        if (clipErr) throw clipErr;
        
        finalChunks.push({
          chunk_index: c.chunk_index,
          start_time_ms: c.start_time_ms,
          end_time_ms: c.end_time_ms,
          description: c.description,
          clip_url: supabase.storage.from('taal-chunk-clips').getPublicUrl(clipPath).data.publicUrl
        });
        setProgress(70 + ((i + 1) / chunksData.length) * 20);
      }

      // 5. Save to Database
      if (session) {
        const { data: routineData, error: routineError } = await supabase.rpc('rpc_create_routine', {
          p_user_id: session.user.id,
          p_title: videoFile.name.replace(/\.[^/.]+$/, ""),
          p_style_tag: 'other',
          p_thumbnail_url: thumbnailUrl,
          p_pose_json_url: poseJsonUrl,
          p_duration_seconds: Math.round(videoDuration)
        });

        if (routineError) throw routineError;
        
        const { error: chunkSaveErr } = await supabase.rpc('rpc_save_chunks', {
          p_routine_id: routineData.id,
          p_chunks: finalChunks
        });
        if (chunkSaveErr) throw chunkSaveErr;
      }

      
      setProgress(100);
      setPipelineState('DONE');
      
    } catch (err: any) {
      setError(err.message || 'An error occurred during processing.');
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-3xl">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-3xl font-outfit font-bold text-white neon-text">Upload Routine</h1>
          <button 
            onClick={() => navigate('/home')}
            className="text-muted-foreground hover:text-white transition-colors"
          >
            Cancel
          </button>
        </div>

        <div className="glass p-8 rounded-3xl border border-white/10 relative overflow-hidden">
          {/* Status Overlay */}
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
                  <h2 className="text-xl font-bold text-white mb-2">
                    {pipelineState === 'UPLOADING' && 'Preparing Video...'}
                    {pipelineState === 'CHUNKING' && 'AI Segmenting Routine...'}
                    {pipelineState === 'ANALYZING_POSE' && 'Extracting Skeleton Data...'}
                    {pipelineState === 'SAVING' && 'Saving to Database...'}
                  </h2>
                  <div className="w-full max-w-md h-2 bg-white/10 rounded-full mt-4 overflow-hidden">
                    <div 
                      className="h-full bg-primary transition-all duration-300 ease-out shadow-[0_0_10px_rgba(147,51,234,0.8)]"
                      style={{ width: `${progress}%` }}
                    ></div>
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
              className="border-2 border-dashed border-white/20 rounded-2xl p-12 flex flex-col items-center justify-center text-center cursor-pointer hover:border-primary/50 hover:bg-white/5 transition-all group"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                <UploadIcon className="w-8 h-8 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Select Reference Video</h3>
              <p className="text-muted-foreground text-sm max-w-sm mb-6">
                Upload a full dance routine. Our AI will automatically slice it into learnable chunks and extract 3D joint data.
              </p>
              <button className="bg-white/10 hover:bg-white/20 text-white font-semibold px-6 py-2 rounded-lg transition-all">
                Browse Files
              </button>
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileSelect}
                accept="video/*" 
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
                  <p className="text-sm text-muted-foreground">{(videoFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                </div>
                
                <div className="flex items-center gap-3">
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
