export interface PoseLandmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

export interface PoseFrame {
  timestamp_ms: number;
  landmarks: PoseLandmark[];
}

export type PoseSequence = PoseFrame[];

export interface ChunkData {
  chunk_index: number;
  start_time_ms: number;
  end_time_ms: number;
  description: string;
  clip_url?: string;
  pose_slice_json?: any;
}
