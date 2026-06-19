import React, { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUploadStore } from '../store/uploadStore';
import { extractThumbnail, chunkVideoWithAI } from '../utils/videoProcessor';
import { extractFrames } from '../utils/poseExtractor';
import { Upload as UploadIcon, CheckCircle, AlertCircle, Play, Loader2 } from 'lucide-react';

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
      await extractThumbnail(videoFile);
      setProgress(20);

      // 2. Chunking with AI
      setPipelineState('CHUNKING');
      // Assume video is around 60 seconds for mock duration
      await chunkVideoWithAI(videoFile, 60);
      setProgress(40);

      // 3. Extracting Poses
      setPipelineState('ANALYZING_POSE');
      await extractFrames(videoFile, (p) => {
        // Map 0-100 to 40-90 progress range
        setProgress(40 + (p * 0.5));
      });
      setProgress(90);

      // 4. Save to Database
      setPipelineState('SAVING');
      // Mock API delay for saving to Supabase
      await new Promise(resolve => setTimeout(resolve, 1500));
      
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
