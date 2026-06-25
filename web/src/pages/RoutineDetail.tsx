import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Zap, Music, Eye, Video } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/useStore';

// ── Types ─────────────────────────────────────────────────────────────────────

interface BeatChunkMeta {
  chunkId:    number;
  startCount: number;
  endCount:   number;
  startTime:  number;   // seconds
  endTime:    number;   // seconds
}

interface BeatGridJson {
  bpm:    number;
  beats:  number[];
  counts: { count: number; time: number }[];
  chunks: BeatChunkMeta[];
}

interface DbChunk {
  id:               string;
  chunk_index:      number;
  start_time_ms:    number;
  end_time_ms:      number;
  description:      string | null;
  beat_start_count: number | null;
  beat_end_count:   number | null;
}

interface Routine {
  id:               string;
  title:            string;
  instructor?:      string;
  style_tag?:       string;
  difficulty?:      string;
  thumbnail_url?:   string;
  thumbnail?:       string;
  duration_seconds?: number;
  duration?:        string;
  chunk_count?:     number;
  chunks:           DbChunk[];
  beat_grid_json?:  BeatGridJson | null;
}

const MOCK_ROUTINE: Routine = {
  id: '1',
  title: 'Beginner Hip Hop',
  instructor: 'Alex M.',
  duration: '2:30',
  difficulty: 'Beginner',
  thumbnail: 'https://images.unsplash.com/photo-1547153760-18fc86324498?auto=format&fit=crop&q=80&w=1200',
  chunks: [
    { id: 'c1', chunk_index: 0, start_time_ms: 0,     end_time_ms: 15000, description: 'Intro Groove', beat_start_count: 1,  beat_end_count: 8  },
    { id: 'c2', chunk_index: 1, start_time_ms: 15000, end_time_ms: 35000, description: 'The Bounce',   beat_start_count: 9,  beat_end_count: 16 },
    { id: 'c3', chunk_index: 2, start_time_ms: 35000, end_time_ms: 60000, description: 'Arm Wave',     beat_start_count: 17, beat_end_count: 24 },
  ],
  beat_grid_json: null,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

// ── CountBlock ────────────────────────────────────────────────────────────────

function CountBlock({
  block, state, onTap,
}: {
  block: BeatChunkMeta;
  state: 'idle' | 'selected' | 'anchor';
  onTap: () => void;
}) {
  const dur = Math.round((block.endTime - block.startTime) * 10) / 10;
  return (
    <button
      onClick={onTap}
      className={[
        'flex-shrink-0 w-[72px] h-[72px] rounded-2xl border-2 flex flex-col items-center justify-center gap-0.5 transition-all active:scale-95',
        state === 'anchor'
          ? 'bg-violet-500/40 border-violet-400 shadow-[0_0_14px_rgba(139,92,246,0.4)]'
          : state === 'selected'
          ? 'bg-violet-500/20 border-violet-500/60'
          : 'bg-white/5 border-white/10 hover:border-white/25',
      ].join(' ')}
    >
      <span className={`text-[11px] font-bold tabular-nums ${state !== 'idle' ? 'text-white' : 'text-white/50'}`}>
        {block.startCount}–{block.endCount}
      </span>
      <span className="text-[9px] text-white/30">{dur}s</span>
    </button>
  );
}

// ── CountMapTimeline ──────────────────────────────────────────────────────────

function CountMapTimeline({
  beatGrid, dbChunks, videoDurationMs, onNavigate,
}: {
  beatGrid:        BeatGridJson;
  dbChunks:        DbChunk[];
  videoDurationMs: number;
  onNavigate:      (state: object, chunkId: string) => void;
}) {
  const [anchorIdx, setAnchorIdx] = useState<number | null>(null);
  const [extentIdx, setExtentIdx] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const blocks = beatGrid.chunks;
  const bpm    = Math.round(beatGrid.bpm);

  const selMin = anchorIdx !== null
    ? extentIdx !== null ? Math.min(anchorIdx, extentIdx) : anchorIdx
    : null;
  const selMax = anchorIdx !== null
    ? extentIdx !== null ? Math.max(anchorIdx, extentIdx) : anchorIdx
    : null;

  const selectedBlocks = selMin !== null && selMax !== null
    ? blocks.slice(selMin, selMax + 1)
    : [];

  const handleTap = (idx: number) => {
    if (anchorIdx === null) {
      setAnchorIdx(idx); setExtentIdx(null);
    } else if (extentIdx === null && idx === anchorIdx) {
      setAnchorIdx(null); // deselect
    } else if (extentIdx === null) {
      setExtentIdx(idx); // extend to range
    } else {
      setAnchorIdx(idx); setExtentIdx(null); // restart
    }
  };

  const handleAddNextPhrase = () => {
    if (selMax === null || selMax >= blocks.length - 1) return;
    const nextIdx = selMax + 1;
    if (anchorIdx === null) { setAnchorIdx(nextIdx); }
    else { setExtentIdx(nextIdx); }
    setTimeout(() => {
      const children = scrollRef.current?.children;
      if (children) (children[nextIdx] as HTMLElement)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }, 50);
  };

  // Shared helper — builds the navigation state for both Teach and Connect
  const buildNavState = (connectMode: boolean) => {
    const first = selectedBlocks[0];
    const last  = selectedBlocks[selectedBlocks.length - 1];

    const matchingDbChunks = dbChunks.filter(
      c => c.beat_start_count !== null
        && c.beat_start_count >= first.startCount
        && (c.beat_end_count ?? 0) <= last.endCount,
    );
    const firstDbChunk = matchingDbChunks[0] ?? dbChunks[0];

    const rangeCounts = (beatGrid.counts ?? []).filter(
      c => c.time >= first.startTime - 0.05 && c.time <= last.endTime + 0.05,
    );

    // Boundary timestamps = endTime of every selected block except the last
    const boundaryTimeMs = selectedBlocks
      .slice(0, -1)
      .map(b => Math.round(b.endTime * 1000));

    return {
      state: {
        skipModeSelector: true,
        mode: 'teach',
        beatRange: {
          startCount:  first.startCount,
          endCount:    last.endCount,
          startTimeMs: Math.round(first.startTime * 1000),
          endTimeMs:   Math.min(Math.round(last.endTime * 1000), videoDurationMs),
        },
        rangeCounts,
        connectMode,
        boundaryTimeMs,
        connectedChunkIds: matchingDbChunks.map(c => c.id),
      },
      chunkId: firstDbChunk?.id ?? 'full',
    };
  };

  const handleTeach = () => {
    if (!selectedBlocks.length) return;
    const { state, chunkId } = buildNavState(false);
    onNavigate(state, chunkId);
  };

  const handleConnect = () => {
    if (selectedBlocks.length < 2) return;
    const { state, chunkId } = buildNavState(true);
    onNavigate(state, chunkId);
  };

  const blockState = (idx: number): 'idle' | 'selected' | 'anchor' => {
    if (selMin === null) return 'idle';
    if (idx < selMin || idx > (selMax ?? selMin)) return 'idle';
    return idx === anchorIdx ? 'anchor' : 'selected';
  };

  const selectionDurationMs = selectedBlocks.length
    ? Math.round((selectedBlocks[selectedBlocks.length - 1].endTime - selectedBlocks[0].startTime) * 1000)
    : 0;

  return (
    <div className="space-y-4">

      {/* BPM badge + hint */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <div className="bg-violet-500/15 border border-violet-500/25 px-2.5 py-1 rounded-full flex items-center gap-1.5">
            <Music className="w-3 h-3 text-violet-400" />
            <span className="text-violet-300 text-xs font-bold">{bpm} BPM</span>
          </div>
          <span className="text-white/30 text-xs">{blocks.length} phrases</span>
        </div>
        <span className="text-white/25 text-[11px]">tap to select</span>
      </div>

      {/* Scrollable count blocks */}
      <div
        ref={scrollRef}
        className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4"
        style={{ scrollbarWidth: 'none' }}
      >
        {blocks.map((block, idx) => (
          <CountBlock
            key={block.chunkId}
            block={block}
            state={blockState(idx)}
            onTap={() => handleTap(idx)}
          />
        ))}
      </div>

      {/* Selection CTA */}
      {selectedBlocks.length > 0 ? (
        <div className="bg-white/4 border border-white/8 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white font-bold text-sm">
                Counts {selectedBlocks[0].startCount}–{selectedBlocks[selectedBlocks.length - 1].endCount}
              </p>
              <p className="text-white/40 text-xs mt-0.5">
                {selectedBlocks.length} phrase{selectedBlocks.length !== 1 ? 's' : ''} · {formatDuration(selectionDurationMs)}
              </p>
            </div>
            <button
              onClick={() => { setAnchorIdx(null); setExtentIdx(null); }}
              className="text-white/30 text-xs hover:text-white/60 transition-colors"
            >
              Clear
            </button>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleAddNextPhrase}
              disabled={selMax !== null && selMax >= blocks.length - 1}
              className="flex-1 py-3 bg-white/8 hover:bg-white/15 text-white/70 text-sm font-semibold rounded-xl transition-all disabled:opacity-30"
            >
              + Next phrase
            </button>
            <button
              onClick={handleTeach}
              className="flex-[2] py-3 bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold rounded-xl transition-all shadow-[0_0_16px_rgba(139,92,246,0.35)] flex items-center justify-center gap-2"
            >
              <Play className="w-4 h-4 fill-current" />
              Teach {selectedBlocks[0].startCount}–{selectedBlocks[selectedBlocks.length - 1].endCount}
            </button>
          </div>

          {/* Connect button — only shown when 2+ phrases selected */}
          {selectedBlocks.length >= 2 && (
            <button
              onClick={handleConnect}
              className="w-full py-3 bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/30 text-violet-300 text-sm font-bold rounded-xl transition-all flex items-center justify-center gap-2"
            >
              🔗 Connect {selectedBlocks.length} phrases back-to-back
            </button>
          )}
          </div>
        </div>
      ) : (
        <p className="text-white/20 text-xs text-center py-1">
          Tap a phrase to select it, tap another to extend the range
        </p>
      )}
    </div>
  );
}

// ── FlatSegmentList — fallback when no beat grid ──────────────────────────────

function FlatSegmentList({
  chunks, routineId, navigate,
}: {
  chunks:    DbChunk[];
  routineId: string;
  navigate:  (to: string) => void;
}) {
  return (
    <div className="space-y-3">
      {chunks.map((chunk, index) => (
        <div
          key={chunk.id}
          className="glass p-5 rounded-2xl border border-white/5 hover:border-primary/50 transition-all flex items-center justify-between group cursor-pointer"
          onClick={() => navigate(`/segment-phases/${routineId}/${chunk.id ?? chunk.chunk_index}`)}
        >
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 bg-white/5 rounded-xl flex items-center justify-center font-bold text-lg text-white/40 group-hover:text-primary group-hover:bg-primary/10 transition-colors shrink-0">
              {index + 1}
            </div>
            <div>
              <h3 className="text-base font-bold text-white group-hover:text-primary transition-colors">
                {chunk.description || `Segment ${index + 1}`}
              </h3>
              <p className="text-xs text-white/40">
                {Math.round(chunk.start_time_ms / 1000)}s – {Math.round(chunk.end_time_ms / 1000)}s
              </p>
            </div>
          </div>
          <div className="w-9 h-9 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-primary transition-colors shrink-0">
            <Play className="w-3.5 h-3.5 text-white ml-0.5 group-hover:fill-current" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── RoutineDetail ─────────────────────────────────────────────────────────────

export default function RoutineDetail() {
  const { id }   = useParams();
  const navigate = useNavigate();
  const session  = useAuthStore(s => s.session);
  const [routine, setRoutine] = useState<Routine | null>(null);

  useEffect(() => {
    async function load() {
      if (!id) return;
      if (session?.user?.id) {
        const { data } = await supabase.rpc('rpc_get_routine_detail', {
          p_routine_id: id,
          p_user_id:    session.user.id,
        });
        if (data) { setRoutine(data); return; }
      }
      try {
        const stored = localStorage.getItem(`taal-local-routine-${id}`);
        if (stored) { setRoutine(JSON.parse(stored)); return; }
      } catch { /* ignore */ }
      setRoutine(MOCK_ROUTINE);
    }
    load();
  }, [id, session]);

  if (!routine) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const thumbnail   = routine.thumbnail_url || routine.thumbnail || '';
  const chunks      = routine.chunks || [];
  const beatGrid    = routine.beat_grid_json ?? null;
  const durationMs  = (routine.duration_seconds ?? 0) * 1000;
  const hasBeatGrid = !!(beatGrid && beatGrid.chunks?.length > 0);

  const styleLabel = routine.style_tag || routine.difficulty || 'Dance';
  const durationLabel = routine.duration_seconds
    ? `${Math.floor(routine.duration_seconds / 60)}:${String(routine.duration_seconds % 60).padStart(2, '0')}`
    : routine.duration || '';

  const handleNavigate = (state: object, chunkId: string) =>
    navigate(`/practice/${routine.id}/${chunkId}`, { state });

  return (
    <div className="min-h-screen bg-background">

      {/* Hero */}
      <div className="relative h-[38vh] min-h-[260px]">
        <div className="absolute inset-0">
          {thumbnail && (
            <img src={thumbnail} alt={routine.title} className="w-full h-full object-cover" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/75 to-transparent" />
        </div>

        <button
          onClick={() => navigate('/home')}
          className="absolute top-6 left-6 z-10 w-10 h-10 bg-black/40 backdrop-blur-md rounded-full flex items-center justify-center text-white hover:bg-black/60 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <div className="absolute bottom-0 left-0 w-full px-6 pb-6">
          <div className="flex items-center gap-2 mb-2">
            <span className="bg-primary/20 text-primary border border-primary/30 px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wider uppercase">
              {styleLabel}
            </span>
            {durationLabel && (
              <span className="text-white/40 text-xs font-medium">{durationLabel}</span>
            )}
          </div>
          <h1 className="text-3xl font-outfit font-bold text-white">{routine.title}</h1>
          {routine.instructor && (
            <p className="text-white/50 text-sm mt-1">{routine.instructor}</p>
          )}
        </div>
      </div>

      {/* Content — ordered to match the 11-step class model */}
      <main className="px-4 pt-6 pb-16 max-w-2xl mx-auto space-y-6">

        {/* Step 1 — Warm-up */}
        <div
          className="glass p-5 rounded-2xl border border-emerald-500/20 hover:border-emerald-500/40 transition-all flex items-center justify-between group cursor-pointer"
          onClick={() => navigate(`/warmup/${routine.id}/full`)}
        >
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 bg-emerald-500/10 rounded-xl flex items-center justify-center text-xl group-hover:bg-emerald-500/20 transition-colors">
              🏋️
            </div>
            <div>
              <h3 className="text-base font-bold text-white group-hover:text-emerald-400 transition-colors">Warm Up</h3>
              <p className="text-xs text-white/40">5 exercises · ~1 min</p>
            </div>
          </div>
          <Play className="w-4 h-4 text-emerald-400" />
        </div>

        {/* Step 2 — Preview: watch full choreo once before teaching */}
        <button
          onClick={() => navigate(`/practice/${routine.id}/full`, {
            state: {
              previewMode:      true,
              skipModeSelector: true,
              startTimeMs:      0,
              endTimeMs:        (routine.duration_seconds ?? 0) * 1000,
              title:            routine.title,
            },
          })}
          className="w-full bg-violet-500/12 hover:bg-violet-500/20 border border-violet-500/25 hover:border-violet-500/40 text-violet-200 font-semibold py-3.5 rounded-2xl transition-all flex items-center justify-center gap-2"
        >
          <Eye className="w-4 h-4 text-violet-400" />
          Preview · Full Speed · With Music
        </button>

        {/* Steps 3–8 — Count Map: phrase selection → Teach / Connect */}
        <div>
          <h2 className="text-lg font-bold text-white mb-1">
            {hasBeatGrid ? 'Count Map' : 'Segments'}
          </h2>
          <p className="text-white/35 text-sm">
            {hasBeatGrid
              ? 'Tap a phrase to anchor, tap another to extend the range'
              : 'Select a segment to practice'}
          </p>
        </div>

        {hasBeatGrid ? (
          <CountMapTimeline
            beatGrid={beatGrid!}
            dbChunks={chunks}
            videoDurationMs={durationMs}
            onNavigate={handleNavigate}
          />
        ) : (
          <FlatSegmentList
            chunks={chunks}
            routineId={routine.id}
            navigate={navigate}
          />
        )}

        {/* Step 9 — Full Run-Through: slow → full speed over whole routine */}
        <button
          onClick={() => navigate(`/practice/${routine.id}/full`, {
            state: {
              fullRunMode:      true,
              skipModeSelector: true,
              startTimeMs:      0,
              endTimeMs:        (routine.duration_seconds ?? 0) * 1000,
              bpm:              beatGrid?.bpm,
              rangeCounts:      beatGrid?.counts,
            },
          })}
          className="w-full bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-white/70 font-semibold py-3.5 rounded-2xl transition-all flex items-center justify-center gap-2"
        >
          <Zap className="w-4 h-4 text-violet-400" />
          Full Run-Through
        </button>

        {/* Step 10 — Performance Take (optional): record yourself for review */}
        <button
          onClick={() => navigate(`/practice/${routine.id}/full`, {
            state: {
              performanceTakeMode: true,
              skipModeSelector:    true,
              startTimeMs:         0,
              endTimeMs:           (routine.duration_seconds ?? 0) * 1000,
              title:               routine.title,
            },
          })}
          className="w-full bg-white/4 hover:bg-white/8 border border-white/8 hover:border-white/15 text-white/55 font-semibold py-3.5 rounded-2xl transition-all flex items-center justify-center gap-2"
        >
          <Video className="w-4 h-4 text-red-400" />
          Record Performance Take
        </button>
      </main>
    </div>
  );
}
