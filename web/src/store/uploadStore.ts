import { create } from 'zustand';

export type UploadState = 'IDLE' | 'UPLOADING' | 'CHUNKING' | 'ANALYZING_POSE' | 'SAVING' | 'DONE' | 'ERROR';

interface UploadStore {
  pipelineState: UploadState;
  videoFile: File | null;
  videoUrl: string | null;
  progress: number;
  error: string | null;
  
  setPipelineState: (state: UploadState) => void;
  setVideoFile: (file: File | null) => void;
  setProgress: (progress: number) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useUploadStore = create<UploadStore>((set) => ({
  pipelineState: 'IDLE',
  videoFile: null,
  videoUrl: null,
  progress: 0,
  error: null,
  
  setPipelineState: (state) => set({ pipelineState: state }),
  setVideoFile: (file) => set({ 
    videoFile: file, 
    videoUrl: file ? URL.createObjectURL(file) : null 
  }),
  setProgress: (progress) => set({ progress }),
  setError: (error) => set({ error, pipelineState: error ? 'ERROR' : 'IDLE' }),
  reset: () => set({ pipelineState: 'IDLE', videoFile: null, videoUrl: null, progress: 0, error: null }),
}));
