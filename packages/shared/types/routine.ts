export interface Routine {
  id: string;
  user_id: string;
  title: string;
  style_tag?: string;
  thumbnail_url?: string;
  pose_json_url?: string;
  total_chunks: number;
  duration_seconds: number;
  best_overall_score?: number;
  last_practiced_at?: string;
  created_at: string;
  is_deleted: boolean;
}

export interface Chunk {
  id: string;
  routine_id: string;
  chunk_index: number;
  start_time_ms: number;
  end_time_ms: number;
  clip_url?: string;
  description?: string;
  pose_slice_json?: string | any[];
  breathing_cues?: { timestamp_ms: number; type: 'inhale' | 'exhale' }[];
  created_at: string;
}

export interface FinalScore {
  armScore: number;
  legScore: number;
  timingScore: number;
  overallScore: number;
}

export interface JointScore {
  name: string;
  type: string;
  diff: number;
  color: 'green' | 'yellow' | 'red';
  score: number;
}

export interface AttemptHistory {
  id: string;
  user_id: string;
  routine_id: string;
  chunk_id?: string;
  is_full_routine: boolean;
  arm_score?: number;
  leg_score?: number;
  timing_score?: number;
  overall_score?: number;
  missing_joints_flagged: boolean;
  duration_ms?: number;
  created_at: string;
}
