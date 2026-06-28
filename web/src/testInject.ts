// This file exists as a reference for the mock routine data structure
export const TEST_ROUTINE_ID = 'test-routine-id';
export const TEST_ROUTINE = {
  id: TEST_ROUTINE_ID,
  title: 'Bom Diggy Diggy Test',
  style_tag: 'Bollywood',
  duration_seconds: 12,
  thumbnail_url: '',
  video_blob_url: '/videos/test.mp4',
  chunks: [
    { id: 'ch-0', chunk_index: 0, start_time_ms: 0, end_time_ms: 4100, description: 'Intro', pose_slice_json: '[]' },
    { id: 'ch-1', chunk_index: 1, start_time_ms: 4100, end_time_ms: 8200, description: 'Verse', pose_slice_json: '[]' },
    { id: 'ch-2', chunk_index: 2, start_time_ms: 8200, end_time_ms: 12300, description: 'Chorus', pose_slice_json: '[]' },
  ],
  beat_grid_json: {
    bpm: 140,
    beats: [0.5, 1.28, 2.14, 2.87, 3.64, 4.5, 5.28, 6.14, 6.87, 7.71, 8.5, 9.28, 10.14, 10.87, 11.64],
    counts: [
      { count: 1, time: 0.5 }, { count: 2, time: 1.28 }, { count: 3, time: 2.14 },
      { count: 4, time: 2.87 }, { count: 5, time: 3.64 }, { count: 6, time: 4.5 },
      { count: 7, time: 5.28 }, { count: 8, time: 6.14 }, { count: 1, time: 6.87 },
      { count: 2, time: 7.71 }, { count: 3, time: 8.5 }, { count: 4, time: 9.28 },
      { count: 5, time: 10.14 }, { count: 6, time: 10.87 }, { count: 7, time: 11.64 },
    ],
    chunks: [
      { chunkId: 0, startCount: 1, endCount: 5, startCount: 1, endCount: 5, startTime: 0, endTime: 4.1 },
      { chunkId: 1, startCount: 6, endCount: 10, startCount: 6, endCount: 10, startTime: 4.1, endTime: 8.2 },
      { chunkId: 2, startCount: 11, endCount: 15, startCount: 11, endCount: 15, startTime: 8.2, endTime: 12.3 },
    ]
  },
};
