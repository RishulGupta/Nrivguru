export const POSE_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],
  [9,10],[11,12],[11,13],[13,15],[15,17],[15,19],[15,21],
  [12,14],[14,16],[16,18],[16,20],[16,22],[11,23],[12,24],
  [23,24],[23,25],[25,27],[27,29],[29,31],[27,31],
  [24,26],[26,28],[28,30],[30,32],[28,32]
];

export const KEY_JOINT_INDICES = [11,12,13,14,15,16,23,24,25,26,27,28];

export const JOINT_DEFINITIONS = [
  { name: 'left_elbow',    pts: [11,13,15], type: 'arm' },
  { name: 'right_elbow',   pts: [12,14,16], type: 'arm' },
  { name: 'left_shoulder', pts: [13,11,23], type: 'arm' },
  { name: 'right_shoulder',pts: [14,12,24], type: 'arm' },
  // wrist extension/flexion — uses index finger (19/20) as third point
  { name: 'left_wrist',    pts: [13,15,19], type: 'arm' },
  { name: 'right_wrist',   pts: [14,16,20], type: 'arm' },
  { name: 'left_knee',     pts: [23,25,27], type: 'leg' },
  { name: 'right_knee',    pts: [24,26,28], type: 'leg' },
  { name: 'left_hip',      pts: [11,23,25], type: 'leg' },
  { name: 'right_hip',     pts: [12,24,26], type: 'leg' },
];

// Beginner arm weights: shoulder >> elbow > wrist
// ponytail: only applied in arms phase via scoreFrame caller
export const ARM_JOINT_WEIGHTS: Record<string, number> = {
  left_shoulder:  1.5,
  right_shoulder: 1.5,
  left_elbow:     1.0,
  right_elbow:    1.0,
  left_wrist:     0.3,
  right_wrist:    0.3,
};
