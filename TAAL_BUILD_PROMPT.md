# TAAL — Full Product Build Prompt
## For Claude Code / Antigravity

---

## WHAT YOU ARE BUILDING

You are building **Taal** — a full-stack AI dance practice application. The name means "rhythm" in Hindi/Sanskrit.

This is NOT an MVP. This is NOT a prototype. This is the FULL product with REAL features, REAL data, REAL payments, and REAL user accounts. No placeholder data. No "coming soon" screens. No dummy components. Every screen must be fully functional.

The core idea: A user uploads any dance video they want to learn. The app uses AI to chunk it into learnable segments, overlays their pose on the reference, scores their accuracy in real time, and lets them share a stylized skeleton clip. No subscription — users buy credit packs, one-time.

---

## MONOREPO STRUCTURE

Set up the following folder structure. Do not deviate from this.

```
taal/
├── references/              ← Already cloned reference repos (read-only, learn from them)
│   ├── DanceCV/             ← PRIMARY reference — React+Vite+TypeScript+MediaPipe+Gemini
│   ├── DanceMaker/          ← Python landmark extraction + pandas dataframe structure + scoring
│   ├── DanceVision/         ← Joint angle thresholding, green/yellow/red classifier logic
│   ├── 2D-Dance-Pose-Estimation-with-YOLOv7/  ← Landmark JSON structure per frame
│   ├── DanceRevolution/     ← FastDTW temporal alignment implementation ONLY
│   ├── AI-Dance-based-on-Human-Pose-Estimation/ ← Skeleton rendering, LSTM pose shape
│   ├── dance_pose_estimation/  ← Joint angle calculation functions, mAP logic
│   ├── PoseEstimationExamples/ ← Pose sequence structure for classification
│   ├── RealTimePoseEsitmationDancingGame/ ← Two-stream simultaneous comparison logic
│   ├── dance-with/          ← FPS monitoring, graceful degradation on low-spec hardware
│   └── Dance_project/       ← Dance style classification on pose sequences
│
├── packages/
│   ├── shared/              ← Shared TypeScript types, constants, utilities used by both web and mobile
│   │   ├── types/
│   │   │   ├── pose.ts      ← PoseLandmark, PoseFrame, PoseSequence, ChunkData types
│   │   │   ├── routine.ts   ← Routine, Chunk, Score, AttemptHistory types
│   │   │   └── user.ts      ← User, Credits, InstructorProfile types
│   │   └── utils/
│   │       ├── scoring.ts   ← FastDTW, joint angle calculation, normalization (shared logic)
│   │       └── constants.ts ← Joint indices, angle thresholds, chunk config
│
├── web/                     ← React + Vite + TypeScript web app
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── lib/
│   │   └── main.tsx
│   └── package.json
│
├── mobile/                  ← React Native (Android first) app
│   ├── src/
│   │   ├── components/
│   │   ├── screens/
│   │   ├── hooks/
│   │   └── lib/
│   └── package.json
│
└── supabase/
    ├── migrations/          ← All SQL migrations
    └── functions/           ← Supabase Edge Functions if needed
```

---

## TECH STACK — EVERY DECISION IS FINAL

### Web (React)
- **Framework**: React 18 + Vite + TypeScript (strict mode)
- **Styling**: Tailwind CSS + shadcn/ui components
- **Pose Estimation**: `@mediapipe/tasks-vision` — WASM, runs entirely in browser, no server
- **Video slicing**: Web APIs only — `HTMLVideoElement`, `Canvas API`, `MediaRecorder`
- **Local video storage**: `idb` library wrapping IndexedDB — videos persist across reloads
- **Voice control**: Web Speech API (`SpeechRecognition`)
- **State management**: Zustand
- **Routing**: React Router v6

### Mobile (React Native)
- **Framework**: React Native 0.73+ (Android first, iOS scaffolded but not built)
- **Pose Estimation**: `react-native-vision-camera` v4 with TFLite frame processors
- **ML Model**: BlazePose TFLite (`.tflite` model file bundled in app assets)
- **Voice control**: `@react-native-voice/voice`
- **Navigation**: React Navigation v6 (Stack + Bottom Tab)
- **Video**: `react-native-video` for playback

### Backend / Database
- **All backend**: Supabase exclusively
- **Auth**: Supabase Auth (email + Google OAuth)
- **Database**: Supabase Postgres
- **Storage**: Supabase Storage (chunk clips + thumbnails ONLY — never original video)
- **ALL database operations**: Supabase RPC (Postgres functions) — NO direct table queries from client. Every single read/write goes through a named RPC function. This is non-negotiable.

### AI
- **Chunking**: Google Gemini Flash API (`gemini-1.5-flash`) — cheapest tier
- **Model**: Called from client directly with API key (web: env var, mobile: secure storage)

### Payments
- **India**: Razorpay — one-time order, no subscription mandate, supports UPI + cards + netbanking
- **Global**: Stripe — one-time payment intent, no recurring
- **Currency detection**: Use `navigator.language` and IP geolocation to show INR vs USD

---

## SUPABASE — FULL SCHEMA + ALL RPC FUNCTIONS

This is the complete database. Build ALL of this. Every RPC function must be created in a migration file.

### Tables

```sql
-- Users (extends Supabase auth.users)
create table public.profiles (
  id uuid references auth.users(id) primary key,
  display_name text,
  avatar_url text,
  is_instructor boolean default false,
  created_at timestamptz default now()
);

-- Credit wallet
create table public.credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) not null,
  balance integer default 0 not null,
  updated_at timestamptz default now()
);

-- Credit transactions (audit log)
create table public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) not null,
  delta integer not null,  -- positive = credit added, negative = spent
  reason text not null,    -- 'purchase_starter', 'spend_routine', 'free_signup', etc.
  payment_id text,         -- Razorpay/Stripe payment ID
  created_at timestamptz default now()
);

-- Routines
create table public.routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) not null,
  title text not null,
  style_tag text,          -- 'bollywood', 'hiphop', 'kpop', 'classical', 'wedding', 'other'
  thumbnail_url text,      -- Supabase Storage URL (30KB JPEG)
  pose_json_url text,      -- Supabase Storage URL (pose data JSON ~200KB)
  total_chunks integer default 0,
  duration_seconds integer,
  best_overall_score numeric(5,2),
  last_practiced_at timestamptz,
  created_at timestamptz default now(),
  is_deleted boolean default false
);

-- Chunks (2-second segments extracted per routine)
create table public.chunks (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid references public.routines(id) not null,
  chunk_index integer not null,       -- 0-based order
  start_time_ms integer not null,
  end_time_ms integer not null,
  clip_url text not null,             -- Supabase Storage URL (compressed 480p ~400KB)
  pose_slice_json jsonb,              -- Pose data for just this chunk (extracted from full pose_json)
  description text,                   -- Gemini's description of this move e.g. "arm sweep left"
  created_at timestamptz default now()
);

-- Practice attempts (every time user practices a chunk or full routine)
create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) not null,
  routine_id uuid references public.routines(id) not null,
  chunk_id uuid references public.chunks(id),  -- null = full routine attempt
  is_full_routine boolean default false,
  arm_score numeric(5,2),
  leg_score numeric(5,2),
  timing_score numeric(5,2),
  overall_score numeric(5,2),
  missing_joints_flagged boolean default false,
  duration_ms integer,
  created_at timestamptz default now()
);

-- Instructor assignments (B2B feature)
create table public.instructor_assignments (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid references public.profiles(id) not null,
  student_id uuid references public.profiles(id),
  routine_id uuid references public.routines(id) not null,
  invite_code text unique,
  notes text,                          -- instructor notes visible to student
  assigned_at timestamptz default now(),
  accepted_at timestamptz
);

-- Instructor subscriptions
create table public.instructor_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) not null,
  status text default 'active',        -- 'active', 'cancelled', 'expired'
  payment_provider text,               -- 'razorpay' or 'stripe'
  payment_id text,
  current_period_end timestamptz,
  created_at timestamptz default now()
);
```

### ALL RPC Functions (build every single one)

```sql
-- ============================================================
-- PROFILE RPCs
-- ============================================================

create or replace function rpc_get_profile(p_user_id uuid)
returns json language plpgsql security definer as $$
begin
  return (
    select row_to_json(r) from (
      select p.*, c.balance as credit_balance
      from public.profiles p
      left join public.credits c on c.user_id = p.id
      where p.id = p_user_id
    ) r
  );
end;
$$;

create or replace function rpc_upsert_profile(
  p_user_id uuid,
  p_display_name text,
  p_avatar_url text default null
) returns json language plpgsql security definer as $$
begin
  insert into public.profiles(id, display_name, avatar_url)
  values (p_user_id, p_display_name, p_avatar_url)
  on conflict (id) do update
    set display_name = excluded.display_name,
        avatar_url = coalesce(excluded.avatar_url, profiles.avatar_url);

  -- Ensure credit row exists
  insert into public.credits(user_id, balance)
  values (p_user_id, 0)
  on conflict do nothing;

  return rpc_get_profile(p_user_id);
end;
$$;

-- ============================================================
-- CREDITS RPCs
-- ============================================================

create or replace function rpc_get_credit_balance(p_user_id uuid)
returns integer language plpgsql security definer as $$
begin
  return (select balance from public.credits where user_id = p_user_id);
end;
$$;

create or replace function rpc_add_credits(
  p_user_id uuid,
  p_amount integer,
  p_reason text,
  p_payment_id text default null
) returns integer language plpgsql security definer as $$
declare
  new_balance integer;
begin
  update public.credits
  set balance = balance + p_amount, updated_at = now()
  where user_id = p_user_id
  returning balance into new_balance;

  insert into public.credit_transactions(user_id, delta, reason, payment_id)
  values (p_user_id, p_amount, p_reason, p_payment_id);

  return new_balance;
end;
$$;

create or replace function rpc_spend_credit(p_user_id uuid)
returns json language plpgsql security definer as $$
declare
  current_balance integer;
begin
  select balance into current_balance
  from public.credits where user_id = p_user_id;

  if current_balance <= 0 then
    return json_build_object('success', false, 'error', 'insufficient_credits', 'balance', 0);
  end if;

  update public.credits
  set balance = balance - 1, updated_at = now()
  where user_id = p_user_id
  returning balance into current_balance;

  insert into public.credit_transactions(user_id, delta, reason)
  values (p_user_id, -1, 'spend_routine');

  return json_build_object('success', true, 'balance', current_balance);
end;
$$;

create or replace function rpc_get_credit_history(p_user_id uuid)
returns json language plpgsql security definer as $$
begin
  return (
    select json_agg(row_to_json(t) order by t.created_at desc)
    from public.credit_transactions t
    where t.user_id = p_user_id
  );
end;
$$;

-- ============================================================
-- ROUTINE RPCs
-- ============================================================

create or replace function rpc_create_routine(
  p_user_id uuid,
  p_title text,
  p_style_tag text,
  p_thumbnail_url text,
  p_pose_json_url text,
  p_duration_seconds integer
) returns json language plpgsql security definer as $$
declare
  new_routine_id uuid;
begin
  insert into public.routines(
    user_id, title, style_tag, thumbnail_url,
    pose_json_url, duration_seconds
  )
  values (
    p_user_id, p_title, p_style_tag, p_thumbnail_url,
    p_pose_json_url, p_duration_seconds
  )
  returning id into new_routine_id;

  return json_build_object('id', new_routine_id, 'success', true);
end;
$$;

create or replace function rpc_get_my_routines(p_user_id uuid)
returns json language plpgsql security definer as $$
begin
  return (
    select json_agg(row_to_json(r) order by r.last_practiced_at desc nulls last)
    from (
      select
        ro.*,
        (select count(*) from public.chunks c where c.routine_id = ro.id) as chunk_count,
        (select overall_score from public.attempts a
         where a.routine_id = ro.id and a.is_full_routine = true and a.user_id = p_user_id
         order by a.created_at desc limit 1) as last_score
      from public.routines ro
      where ro.user_id = p_user_id and ro.is_deleted = false
    ) r
  );
end;
$$;

create or replace function rpc_get_routine_detail(
  p_routine_id uuid,
  p_user_id uuid
) returns json language plpgsql security definer as $$
begin
  return (
    select row_to_json(r) from (
      select
        ro.*,
        (
          select json_agg(row_to_json(ch) order by ch.chunk_index)
          from (
            select c.*,
              (select overall_score from public.attempts a
               where a.chunk_id = c.id and a.user_id = p_user_id
               order by a.created_at desc limit 1) as last_chunk_score
            from public.chunks c
            where c.routine_id = ro.id
          ) ch
        ) as chunks,
        (
          select json_agg(row_to_json(at) order by at.created_at desc)
          from public.attempts at
          where at.routine_id = ro.id and at.user_id = p_user_id
            and at.is_full_routine = true
          limit 10
        ) as recent_attempts
      from public.routines ro
      where ro.id = p_routine_id
        and (ro.user_id = p_user_id or exists(
          select 1 from public.instructor_assignments ia
          where ia.routine_id = p_routine_id and ia.student_id = p_user_id
        ))
    ) r
  );
end;
$$;

create or replace function rpc_update_routine_best_score(
  p_routine_id uuid,
  p_score numeric
) returns void language plpgsql security definer as $$
begin
  update public.routines
  set
    best_overall_score = greatest(coalesce(best_overall_score, 0), p_score),
    last_practiced_at = now()
  where id = p_routine_id;
end;
$$;

create or replace function rpc_soft_delete_routine(
  p_routine_id uuid,
  p_user_id uuid
) returns void language plpgsql security definer as $$
begin
  update public.routines
  set is_deleted = true
  where id = p_routine_id and user_id = p_user_id;
end;
$$;

-- ============================================================
-- CHUNK RPCs
-- ============================================================

create or replace function rpc_save_chunks(
  p_routine_id uuid,
  p_chunks jsonb  -- array of chunk objects
) returns void language plpgsql security definer as $$
declare
  chunk jsonb;
begin
  for chunk in select * from jsonb_array_elements(p_chunks)
  loop
    insert into public.chunks(
      routine_id, chunk_index, start_time_ms, end_time_ms,
      clip_url, pose_slice_json, description
    ) values (
      p_routine_id,
      (chunk->>'chunk_index')::integer,
      (chunk->>'start_time_ms')::integer,
      (chunk->>'end_time_ms')::integer,
      chunk->>'clip_url',
      chunk->'pose_slice_json',
      chunk->>'description'
    );
  end loop;

  update public.routines
  set total_chunks = (select count(*) from public.chunks where routine_id = p_routine_id)
  where id = p_routine_id;
end;
$$;

create or replace function rpc_get_chunks_for_routine(p_routine_id uuid)
returns json language plpgsql security definer as $$
begin
  return (
    select json_agg(row_to_json(c) order by c.chunk_index)
    from public.chunks c
    where c.routine_id = p_routine_id
  );
end;
$$;

-- ============================================================
-- ATTEMPT RPCs
-- ============================================================

create or replace function rpc_save_attempt(
  p_user_id uuid,
  p_routine_id uuid,
  p_chunk_id uuid,
  p_is_full_routine boolean,
  p_arm_score numeric,
  p_leg_score numeric,
  p_timing_score numeric,
  p_overall_score numeric,
  p_missing_joints_flagged boolean,
  p_duration_ms integer
) returns uuid language plpgsql security definer as $$
declare
  new_attempt_id uuid;
begin
  insert into public.attempts(
    user_id, routine_id, chunk_id, is_full_routine,
    arm_score, leg_score, timing_score, overall_score,
    missing_joints_flagged, duration_ms
  ) values (
    p_user_id, p_routine_id, p_chunk_id, p_is_full_routine,
    p_arm_score, p_leg_score, p_timing_score, p_overall_score,
    p_missing_joints_flagged, p_duration_ms
  ) returning id into new_attempt_id;

  if p_is_full_routine then
    perform rpc_update_routine_best_score(p_routine_id, p_overall_score);
  end if;

  return new_attempt_id;
end;
$$;

create or replace function rpc_get_attempt_history(
  p_user_id uuid,
  p_routine_id uuid
) returns json language plpgsql security definer as $$
begin
  return (
    select json_agg(row_to_json(a) order by a.created_at desc)
    from public.attempts a
    where a.user_id = p_user_id and a.routine_id = p_routine_id
  );
end;
$$;

create or replace function rpc_get_progress_over_time(
  p_user_id uuid,
  p_routine_id uuid
) returns json language plpgsql security definer as $$
begin
  return (
    select json_agg(row_to_json(r) order by r.created_at)
    from (
      select overall_score, arm_score, leg_score, timing_score, created_at
      from public.attempts
      where user_id = p_user_id
        and routine_id = p_routine_id
        and is_full_routine = true
      order by created_at
    ) r
  );
end;
$$;

-- ============================================================
-- INSTRUCTOR RPCs
-- ============================================================

create or replace function rpc_create_assignment(
  p_instructor_id uuid,
  p_routine_id uuid,
  p_notes text default null
) returns json language plpgsql security definer as $$
declare
  new_code text;
  new_id uuid;
begin
  new_code := upper(substring(md5(random()::text), 1, 8));

  insert into public.instructor_assignments(instructor_id, routine_id, invite_code, notes)
  values (p_instructor_id, p_routine_id, new_code, p_notes)
  returning id into new_id;

  return json_build_object('id', new_id, 'invite_code', new_code);
end;
$$;

create or replace function rpc_accept_assignment(
  p_student_id uuid,
  p_invite_code text
) returns json language plpgsql security definer as $$
declare
  assignment_row public.instructor_assignments;
begin
  select * into assignment_row
  from public.instructor_assignments
  where invite_code = upper(p_invite_code) and student_id is null;

  if not found then
    return json_build_object('success', false, 'error', 'invalid_or_used_code');
  end if;

  update public.instructor_assignments
  set student_id = p_student_id, accepted_at = now()
  where id = assignment_row.id;

  return json_build_object(
    'success', true,
    'routine_id', assignment_row.routine_id,
    'notes', assignment_row.notes
  );
end;
$$;

create or replace function rpc_get_instructor_dashboard(p_instructor_id uuid)
returns json language plpgsql security definer as $$
begin
  return (
    select json_agg(row_to_json(r))
    from (
      select
        ia.id as assignment_id,
        ia.invite_code,
        ia.notes,
        ia.assigned_at,
        ro.title as routine_title,
        ro.thumbnail_url,
        p.display_name as student_name,
        (
          select json_agg(row_to_json(sc) order by sc.chunk_index)
          from (
            select
              c.chunk_index,
              c.description,
              max(a.overall_score) as best_score,
              count(a.id) as attempt_count
            from public.chunks c
            left join public.attempts a
              on a.chunk_id = c.id and a.user_id = ia.student_id
            where c.routine_id = ia.routine_id
            group by c.chunk_index, c.description
          ) sc
        ) as chunk_scores
      from public.instructor_assignments ia
      join public.routines ro on ro.id = ia.routine_id
      left join public.profiles p on p.id = ia.student_id
      where ia.instructor_id = p_instructor_id
      order by ia.assigned_at desc
    ) r
  );
end;
$$;

-- ============================================================
-- ONBOARDING + GRANT FREE CREDIT ON SIGNUP
-- ============================================================

create or replace function rpc_complete_onboarding(p_user_id uuid)
returns json language plpgsql security definer as $$
begin
  -- Grant 1 free routine on signup
  perform rpc_add_credits(p_user_id, 1, 'free_signup');
  return json_build_object('success', true, 'credits_granted', 1);
end;
$$;
```

### Row Level Security

Enable RLS on ALL tables. Every table should have policies so users can only read/write their own data. Instructors can read student attempt data for their assignments only.

```sql
alter table public.profiles enable row level security;
alter table public.credits enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.routines enable row level security;
alter table public.chunks enable row level security;
alter table public.attempts enable row level security;
alter table public.instructor_assignments enable row level security;
alter table public.instructor_subscriptions enable row level security;

-- All RPC functions use SECURITY DEFINER so they bypass RLS safely
-- Direct table access from client is blocked for all tables
```

### Supabase Storage Buckets

```
taal-thumbnails     → public read, authenticated write, max 500KB per file
taal-chunk-clips    → public read, authenticated write, max 5MB per file
taal-pose-json      → private (authenticated read own files only), max 1MB
```

---

## REFERENCE REPOS — EXACTLY WHAT TO TAKE FROM EACH

Read every repo in `/references`. Here is exactly what to extract and translate to TypeScript:

### FROM: `references/DanceCV/` ← PRIMARY REFERENCE — READ THIS FIRST

This is the closest existing implementation. It uses React + Vite + TypeScript + MediaPipe + Gemini. Study it completely.

**Take directly (translate to your architecture):**
- The `useRef`-based webcam loop instead of `useState` to avoid re-render lag. This is critical — Dance CV's team specifically fixed 1fps lag by switching to useRef. Do the same.
- The MediaPipe `PoseLandmarker` initialization and WASM loading pattern
- The Gemini API call structure for chunking — how they send video metadata and parse timestamp JSON back
- The joint angle scoring algorithm — how they compare angles between reference and user frames
- The anti-cheat logic — how they detect and penalize missing/out-of-frame joints (they found users could score high by hiding from camera, and fixed it)
- The voice control implementation via Gemini Voice (or adapt to Web Speech API)
- Arm score vs leg score separation logic
- The "closest matching frame" alignment — they find the nearest frame in the reference that matches the user's current pose before scoring, not a strict timestamp match
- The overall UI structure: upload → chunking → practice → score

**Do NOT take:**
- Their specific UI components (you're building your own design)
- Any backend assumptions (they have no backend — you have Supabase)
- Their deployment config

---

### FROM: `references/DanceMaker/` (Just Dance Dance Revolution)

This is Python/MediaPipe/pandas. Translate the logic to TypeScript.

**Take:**
- The pandas DataFrame structure for storing pose data per frame — translate this to a typed TypeScript array: `PoseFrame[]` where each frame has timestamp + 33 landmark objects
- The landmark coordinate normalization approach — how they scale coordinates to be camera-distance-invariant
- The linear regression scoring model concept — understand how they convert raw angle error into a 0-100 score
- The overlay scaling math — how they project reference skeleton coordinates onto a different-sized user video canvas

**Do NOT take:**
- Anything pytube/YouTube-download related
- The tkinter UI
- Python-specific data structures

---

### FROM: `references/DanceVision/`

**Take:**
- The per-pose accuracy classifier thresholding: `< 15°` = green, `15–30°` = yellow, `> 30°` = red. These exact thresholds are validated — use them.
- The 8-model comparison analysis — read their findings to understand which scoring approach produced the most accurate human-perceived feedback, then use that approach
- The color-coded checkpoint system: instead of showing a continuous score, they mark specific checkpoint poses as green/yellow/red. Implement this as the visual feedback during chunk practice.

---

### FROM: `references/2D-Dance-Pose-Estimation-with-YOLOv7/`

**Take:**
- The exact JSON structure for storing pose data. Each frame should be:
```typescript
interface PoseFrame {
  timestamp_ms: number;
  landmarks: Array<{
    x: number;       // normalized 0-1
    y: number;       // normalized 0-1
    z: number;       // depth, normalized
    visibility: number; // 0-1, how confident MediaPipe is
  }>;               // always 33 landmarks in MediaPipe order
}
```
- How they handle visibility scores — if visibility < 0.5 for a key joint, flag it as missing. Use this for anti-cheat.

---

### FROM: `references/DanceRevolution/`

**ONLY take the FastDTW implementation. Nothing else.**

Translate `fastdtw` from Python to TypeScript. The algorithm:
1. Takes two sequences of pose vectors (reference and user)
2. Returns the minimum-cost alignment path between them
3. Reduces O(m×n) complexity to O(m+n) via the Sakoe-Chiba band constraint

This is what makes scoring forgiving of timing drift. A user who starts the dance 0.5 seconds late should not be penalized — FastDTW aligns the sequences before scoring.

The TypeScript implementation signature:
```typescript
function fastDTW(
  sequence1: number[][],  // reference pose vectors
  sequence2: number[][],  // user pose vectors
  radius: number          // Sakoe-Chiba band, use 10
): { distance: number; path: [number, number][] }
```

---

### FROM: `references/AI-Dance-based-on-Human-Pose-Estimation/`

**Take:**
- The skeleton rendering code — how they draw bone connections between landmark points on a canvas. Translate to Canvas 2D API TypeScript.
- The LSTM pose sequence shape — even though you're not using LSTM, understand how they structure a sequence of frames as a mathematical input. This tells you the right shape for FastDTW input vectors.

Bone connections to draw (MediaPipe Pose connections):
```typescript
const POSE_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],
  [9,10],[11,12],[11,13],[13,15],[15,17],[15,19],[15,21],
  [12,14],[14,16],[16,18],[16,20],[16,22],[11,23],[12,24],
  [23,24],[23,25],[25,27],[27,29],[29,31],[27,31],
  [24,26],[26,28],[28,30],[30,32],[28,32]
];
```

---

### FROM: `references/dance_pose_estimation/`

**Take:**
- Joint angle calculation functions. For each joint, angle = `atan2` of the vectors formed by the joint and its two neighbors. Translate these:
  - Left elbow angle: landmarks 11→13→15
  - Right elbow angle: landmarks 12→14→16
  - Left shoulder angle: landmarks 13→11→23
  - Right shoulder angle: landmarks 14→12→24
  - Left knee angle: landmarks 23→25→27
  - Right knee angle: landmarks 24→26→28
  - Left hip angle: landmarks 11→23→25
  - Right hip angle: landmarks 12→24→26

```typescript
function calculateAngle(
  a: {x: number, y: number},
  b: {x: number, y: number},  // vertex
  c: {x: number, y: number}
): number {
  const radians = Math.atan2(c.y - b.y, c.x - b.x)
                - Math.atan2(a.y - b.y, a.x - b.x);
  let angle = Math.abs(radians * 180.0 / Math.PI);
  if (angle > 180.0) angle = 360 - angle;
  return angle;
}
```

---

### FROM: `references/RealTimePoseEsitmationDancingGame/`

**Take:**
- The two-stream simultaneous comparison logic — how they process two live camera feeds at the same time and compare them frame by frame
- The FPS counter implementation — display current inference FPS in a small debug overlay during development
- The real-time score update loop structure

**Do NOT take:**
- Any facial recognition code — strip this entirely. Privacy requirement.
- The player-memory system

---

### FROM: `references/dance-with/`

**Take:**
- The FPS monitoring and graceful degradation approach — if FPS drops below 15, reduce MediaPipe model complexity from FULL to LITE automatically
- The thermal warning concept — monitor performance and show "device is getting warm, take a break" after 20 min of continuous use
- Their guidance on pose detection in poor lighting conditions — copy their user-facing tips

---

### FROM: `references/Dance_project/`

**Take:**
- The dance style classification approach — use this to auto-tag uploaded routines (Bollywood, hip-hop, classical, etc.) based on pose sequence patterns
- How they structure the "Let's Dance" dataset features — understand what makes styles distinguishable at the pose level

---

## COMPLETE FEATURE BUILD LIST

Build ALL of the following. Every feature. Every screen. Nothing marked "TODO" or "coming soon."

---

### FEATURE 1: Age Gate Screen

**First screen on EVERY app launch, both web and mobile.**

- Full-screen, no way to skip
- Simple: "How old are you?" with a date picker or age selector
- If under 13: show "This app requires parental consent for users under 13. Please ask a parent or guardian to set up your account." Block camera access entirely. Show no further content.
- If 13 or older: proceed to consent screen
- Store age confirmation in Supabase profile. Check on every session start.
- On mobile: persist in secure storage so returning users don't see it again

---

### FEATURE 2: Biometric Consent Screen

**Shown once per device, after age gate.**

Display in plain language (not legal language):

> "Taal uses your phone's camera to track your movement while you dance.
>
> Here's exactly what happens:
> - Your camera feed is processed entirely on your device
> - We extract mathematical coordinates of your joints (33 points)
> - Your video is NEVER uploaded to our servers
> - Your movement data is saved locally and to your account to track your progress
> - We do not store recordings of you dancing
>
> This consent covers requirements under Illinois BIPA, California CCPA, and GDPR Article 9 for biometric data processing."

Two buttons: "I understand and agree" → proceeds. "I don't agree" → app closes with explanation that camera access is required.

Store consent timestamp in Supabase via `rpc_upsert_profile`.

---

### FEATURE 3: Auth (Sign Up / Sign In)

- Email + password signup
- Google OAuth
- On first signup: call `rpc_complete_onboarding` to grant 1 free credit
- Forgot password flow
- Session persistence (Supabase handles this)
- Show credit balance immediately after login in nav bar

---

### FEATURE 4: Home / Library Screen

**Main screen after login.**

**My Routines grid:**
- Card per routine showing: thumbnail, title, style tag badge, best score (if any), chunk count, last practiced date
- Empty state: not "No routines yet" but "Upload your first dance — it's free." with upload button
- Tap card → Routine Detail screen
- Long-press card (mobile) / right-click (web) → Delete option (calls `rpc_soft_delete_routine`)
- Sort by: last practiced (default), best score, newest

**Credit balance widget:**
- Always visible in top right
- Shows: "7 routines remaining"
- Tap → opens Credits/Payment screen

**Upload FAB (Floating Action Button):**
- Bottom right, always visible
- Tap → Upload screen

**Instructor tab** (only visible if `is_instructor = true`):
- Shows instructor dashboard
- "Switch to instructor view" toggle

---

### FEATURE 5: Upload + Processing Screen

**This is the most technically complex screen. Build it perfectly.**

**Step 1 — Upload**
- Large drag-drop zone on web, file picker on mobile
- Accepts: MP4, MOV, AVI, WebM
- Max size: 500MB
- Show file name and duration after selection
- Display: "Your video stays on your device. Only your dance movements are saved."

**Step 2 — Title + Style**
- Input: Routine name (pre-filled with filename, editable)
- Dropdown: Style tag (Bollywood, Hip-Hop, K-Pop, Classical Indian, Salsa/Latin, Wedding/Sangeet, Contemporary, Other)

**Step 3 — Processing (all client-side)**

Show a progress indicator with honest step labels. Each step must complete before the next starts.

**Step 3a — Thumbnail extraction**
- Seek video to 10% of duration
- Draw frame to canvas, export as JPEG at 50% quality
- Upload to `taal-thumbnails` Supabase bucket
- Max 200KB

**Step 3b — Gemini chunking**
- DO NOT send the video file to Gemini. Instead, extract metadata:
  - Duration in seconds
  - Style tag the user selected
  - Sample of landmark data from first 30 seconds (if already extracted) for context
- Send this prompt to Gemini Flash:
```
This is a dance video of style: [style_tag].
Duration: [duration] seconds.
Identify 8-12 distinct movement segments that a learner should practice separately.
Each segment should be 2-5 seconds long and represent one clear, learnable movement or combination.
Return ONLY valid JSON in this exact format, no other text:
{
  "chunks": [
    {
      "chunk_index": 0,
      "start_time_ms": 0,
      "end_time_ms": 2500,
      "description": "opening arm sweep to the right"
    }
  ]
}
```
- Parse response. If JSON parsing fails, retry once. If fails again, fall back to auto-splitting video into equal 3-second segments.

**Step 3c — Extract chunk clips (client-side video slicing)**
For each chunk timestamp pair:
- Create an offscreen `HTMLVideoElement` (web) or use `react-native-video` frame extraction (mobile)
- Seek to `start_time_ms`, capture frames until `end_time_ms`
- Re-encode at 480p, 0.5x playback speed (slow motion) using `MediaRecorder` API
- Compress to target ~400KB per clip
- Upload to `taal-chunk-clips` bucket
- Track upload progress per chunk

**Step 3d — Full pose extraction**
- Run MediaPipe `PoseLandmarker` on the full video
- Process every 3rd frame (every ~100ms at 30fps) for efficiency
- Store as `PoseFrame[]` array
- Normalize all coordinates: subtract torso center (midpoint of landmarks 11+12 and 23+24), divide by torso height (distance from shoulder midpoint to hip midpoint). This makes scoring scale-invariant.
- Serialize to JSON, upload to `taal-pose-json` bucket (private)

**Step 3e — Save to Supabase**
- Call `rpc_spend_credit(user_id)` — if returns insufficient_credits, stop and show payment screen
- Call `rpc_create_routine(...)` with thumbnail URL, pose JSON URL, duration
- Call `rpc_save_chunks(routine_id, chunks)` with all chunk data including clip URLs
- Navigate to Routine Detail screen

**If user cancels mid-processing:**
- Clean up any partial uploads from Supabase Storage
- Do NOT charge a credit

**Show this UI during processing:**
```
[✓] Extracting thumbnail
[⟳] Breaking into learnable sections... (Gemini chunking)
[ ] Preparing slow-motion clips
[ ] Extracting your dance movements
[ ] Saving your routine
```

---

### FEATURE 6: Routine Detail Screen

**Shows after processing completes or when tapping a library card.**

**Header section:**
- Thumbnail (full width)
- Title + style tag
- Best overall score (large, center) — shows "--" if never attempted
- "Practice Full Routine" primary button
- "View Progress" secondary button

**Chunks grid:**
- Each chunk as a card showing:
  - Slow-mo clip preview (autoplay muted loop)
  - Chunk index (e.g., "Move 3 of 8")
  - Gemini description ("arm sweep to the right")
  - Best score for this chunk (green if >80, yellow if 50-80, red if <50, gray if never attempted)
  - "Practice This Move" button
- Tapping a chunk card → Chunk Practice Screen

**Progress section:**
- Line chart: overall score over last 10 full-routine attempts
- Weakest chunk highlighted in red: "Your leg timing in Move 4 needs work"
- Strongest chunk highlighted in green

---

### FEATURE 7: Chunk Practice Screen

**This is the core practice experience. Get this exactly right.**

**Layout (both web and mobile):**
- Top half: slow-mo reference clip looping (from Supabase Storage)
- Bottom half: live webcam feed
- Skeleton overlay drawn on canvas over BOTH feeds

**Progressive feedback system (this is mandatory — from research on cognitive load):**

Track attempt count per chunk per session in local state.

- **Attempt 1**: Side-by-side only. No skeleton overlay. No score. Just watch and try. Show: "Watch the move, then try it yourself."
- **Attempt 2**: Skeleton overlay appears on user's webcam feed only. Still no score. Show: "Match the skeleton positions."
- **Attempt 3 and beyond**: Full scoring appears. Per-joint color coding (green/yellow/red). Arm score, leg score, timing score, overall score. Show comparison to best previous attempt.

**Skeleton rendering:**
- Draw bone connections using `POSE_CONNECTIONS` array
- Reference skeleton: white/light gray
- User skeleton: colored per joint accuracy (green/yellow/red based on angle diff vs reference)
- Line width: 3px for bones, 6px filled circles for joints
- On mobile: ensure canvas overlay is GPU-accelerated with `willReadFrequently: false`

**Scoring (runs every frame during attempts 3+):**
1. Get current MediaPipe landmarks from user webcam (using `useRef` not `useState` — critical for performance, learned from DanceCV)
2. Get reference frame at the same relative timestamp (or nearest matching frame)
3. Calculate joint angles for 8 key joints using `calculateAngle()` function
4. Compare user angle vs reference angle for each joint
5. Classify each joint: green (<15°), yellow (15-30°), red (>30°)
6. Arm score = average of 4 arm joint scores, converted to 0-100
7. Leg score = average of 4 leg joint scores, converted to 0-100
8. Timing score = FastDTW alignment distance converted to 0-100 (lower DTW distance = higher timing score)
9. Overall = weighted average: arms 35% + legs 35% + timing 30%

**Anti-cheat:**
- For each frame, check visibility score of key joints
- If more than 40% of the 8 key joints have visibility < 0.5 for more than 40% of the chunk duration → flag the attempt
- Show: "Move further from the camera so your full body is visible"
- Do not save flagged attempts as valid scores

**Voice commands (always listening during practice):**
- "Restart" → restart current chunk clip and user scoring
- "Next" → navigate to next chunk
- "Previous" → navigate to previous chunk
- "Slower" → set reference clip playback rate to 0.5x (already slow-mo, this makes it 0.25x)
- "Score" → speak current score aloud via SpeechSynthesis API
- "Stop" → end practice session

**Seated mode toggle:**
- Button in top right corner: "Seated Mode" (upper body only)
- When active: only score arm joints (11,12,13,14,15,16), ignore leg joints (23-32)
- Show label: "Upper body only"

**Save attempt on chunk completion:**
- User taps "Done with this move" button
- Call `rpc_save_attempt(...)` with all scores
- Show result screen with: score, improvement vs last attempt, "Practice Again" or "Next Move"

---

### FEATURE 8: Full Routine Practice Mode

**Accessed from Routine Detail → "Practice Full Routine"**

On mobile (primary): video plays from device local storage (retrieved from IndexedDB or device gallery path)
On web: video plays from IndexedDB blob URL

**Layout:**
- Reference video plays at full screen
- Small webcam PiP (picture-in-picture) in corner showing user with skeleton overlay
- Running score in top bar (updates every 2 seconds)
- Voice commands active throughout

**Scoring:**
- Same scoring algorithm as chunk practice
- Running scores per chunk segment (auto-detects which chunk is playing based on current timestamp)
- FastDTW runs on accumulated pose sequence at end

**End screen:**
- Overall score (large)
- Arm score / Leg score / Timing score breakdown
- Weakest chunk: "Your arms were off during Move 4 — practice that one"
- Strongest chunk: "Move 7 was your best!"
- Comparison to previous best
- "Share Your Performance" button → Export screen
- Call `rpc_save_attempt(...)` with full routine data

---

### FEATURE 9: Export + Share Screen

**Never export original video. Never export audio. Always export stylized skeleton only.**

**What gets rendered:**
- Dark background (#0a0a0a)
- Two skeleton figures side by side: reference (white) and user (colored by accuracy)
- Motion trail: ghost trails behind fast-moving joints (last 5 frames, decreasing opacity)
- Score overlay in corner
- "Taal" watermark bottom right (small, subtle)
- Duration: matches the routine or selected chunk (max 60 seconds for export)

**Privacy options (toggle buttons):**
- "Skeleton" (default): full 33-point skeleton rendered
- "Silhouette": joints replaced with a glowing neon outline, no individual points
- "Score card only": static image with scores, no motion

**Export engine:**
Web: Use `MediaRecorder` to record the canvas animation in real-time as WebM
Mobile: Use `react-native-view-shot` capturing the canvas frame by frame, then use `ffmpeg-kit-react-native` to encode as MP4

**No audio in export — mandatory.** After export, show:
> "Your clip is ready! Add the original music inside TikTok or Reels after uploading to avoid copyright flags."

**Share targets:**
- Download to device (both platforms)
- Share to TikTok (deep link to TikTok drafts if available)
- Share to Instagram Reels
- Share to WhatsApp (especially important for India — family groups, sangeet groups)
- Copy link (if you build a public profile page in v2)

---

### FEATURE 10: Credits + Payment Screen

**Credit pack options (show both INR and USD based on user location):**

```
FREE TIER (always available, no account needed):
• First 30 seconds of any routine: free
• First chunk of any routine: free
• 1 free routine on account creation

STARTER PACK
India: ₹199   |  Global: $2.99
3 routine unlocks
[Buy with UPI / Pay Now]

PRACTICE PACK  ← recommended badge
India: ₹499   |  Global: $6.99
10 routine unlocks
[Buy with UPI / Pay Now]

EVENT PACK  ← most popular for sangeet/weddings
India: ₹999   |  Global: $12.99
25 routine unlocks
+ Shareable invite link for 5 friends
[Buy with UPI / Pay Now]
```

**Razorpay integration (India):**
- Detect India via `navigator.language === 'hi'` OR IP geolocation (use `ipapi.co/json()` free API)
- Use Razorpay Orders API: create order server-side via Supabase Edge Function
- On payment success: call `rpc_add_credits(user_id, amount, 'purchase_[pack]', razorpay_payment_id)`
- Support: UPI, Credit/Debit cards, Netbanking, Wallets

**Stripe integration (Global):**
- Stripe Payment Intent via Supabase Edge Function
- On success: call `rpc_add_credits(...)`

**Transaction history:**
- List of all credit additions and deductions from `rpc_get_credit_history`
- Shows: date, type, amount, payment ID

---

### FEATURE 11: Progress + History Screen

**Per routine view:**
- Line chart: overall score across all full-routine attempts (chronological)
- Sub-charts: arm score, leg score, timing score trends
- Table: all attempts with date, score, duration

**Streak tracker:**
- "Practiced 4 days this week" (informational, not gamified pressure)
- No aggressive streak warnings

**Milestone badges (display only, no push notifications):**
- First 80+ score
- First complete full routine
- First share
- 10 routines practiced
- 7-day practice streak

---

### FEATURE 12: Instructor Portal (Web only, separate route `/instructor`)

**Gate: only accessible if `is_instructor = true` in profile**

**Upgrade to Instructor button** (shown to all users):
- ₹1,999/month (India) / $24.99/month (global)
- Unlimited routine processing
- Student assignment dashboard
- Sets `is_instructor = true` after payment

**Dashboard (from `rpc_get_instructor_dashboard`):**
- Table: each student, each routine assigned, scores per chunk
- Filter by student or routine
- Color-coded cells: green (>80), yellow (50-80), red (<50), gray (not attempted)
- "This student needs help on Move 4" — auto-generated insight

**Assign routine to students:**
- Select a routine from their library
- Add optional text notes per chunk ("Focus on keeping your elbows bent here")
- Generate invite code (8-character alphanumeric)
- Share via WhatsApp, email, or copy link
- Student enters code in-app → `rpc_accept_assignment()`

**Student view of assigned routine:**
- Same Routine Detail screen but with instructor notes shown above each chunk practice screen
- Notes shown as: "Your instructor says: Focus on keeping your elbows bent here"

---

### FEATURE 13: Settings Screen

**Privacy + Data:**
- "Delete all my data" → calls Supabase delete + removes all storage files. Irreversible. Shows confirmation dialog with "Type DELETE to confirm."
- "Download my data" → generates JSON of all attempts and scores
- Camera permission status + "Re-grant permission" button
- "Your video never leaves this device" — link to full privacy policy

**Performance:**
- "MediaPipe quality": Auto (default) / High / Fast
- Auto mode: monitors FPS, switches FULL→LITE model if below 15fps
- Show current FPS in dev mode toggle

**Display:**
- Dark mode / Light mode / System default
- Language: English / Hindi (v1)

**Account:**
- Edit display name
- Change email
- Sign out
- Delete account

**Offline indicator:**
- If no internet: yellow banner "Offline — scores will sync when reconnected"
- Practice mode continues fully offline (pose extraction is local)
- Sync queue: store pending `rpc_save_attempt` calls in IndexedDB, flush when reconnected

---

## SCORING ALGORITHM — FULL IMPLEMENTATION DETAIL

This is the complete algorithm. Build it exactly.

```typescript
// packages/shared/utils/scoring.ts

// Step 1: Normalize pose to be scale-invariant
function normalizePose(landmarks: PoseLandmark[]): PoseLandmark[] {
  // Torso center = midpoint of shoulders (11,12) and hips (23,24)
  const shoulderMid = midpoint(landmarks[11], landmarks[12]);
  const hipMid = midpoint(landmarks[23], landmarks[24]);
  const torsoHeight = distance(shoulderMid, hipMid);
  const center = midpoint(shoulderMid, hipMid);

  return landmarks.map(lm => ({
    x: (lm.x - center.x) / torsoHeight,
    y: (lm.y - center.y) / torsoHeight,
    z: lm.z / torsoHeight,
    visibility: lm.visibility
  }));
}

// Step 2: Extract pose vector for FastDTW input
function poseToVector(landmarks: PoseLandmark[]): number[] {
  // Calculate the 8 key joint angles
  const angles = [
    calculateAngle(landmarks[11], landmarks[13], landmarks[15]), // L elbow
    calculateAngle(landmarks[12], landmarks[14], landmarks[16]), // R elbow
    calculateAngle(landmarks[13], landmarks[11], landmarks[23]), // L shoulder
    calculateAngle(landmarks[14], landmarks[12], landmarks[24]), // R shoulder
    calculateAngle(landmarks[23], landmarks[25], landmarks[27]), // L knee
    calculateAngle(landmarks[24], landmarks[26], landmarks[28]), // R knee
    calculateAngle(landmarks[11], landmarks[23], landmarks[25]), // L hip
    calculateAngle(landmarks[12], landmarks[24], landmarks[26]), // R hip
  ];
  return angles;
}

// Step 3: Score a single frame
function scoreFrame(
  userLandmarks: PoseLandmark[],
  refLandmarks: PoseLandmark[]
): { joints: JointScore[], armScore: number, legScore: number }  {
  const userNorm = normalizePose(userLandmarks);
  const refNorm = normalizePose(refLandmarks);

  const jointDefinitions = [
    { name: 'left_elbow',    pts: [11,13,15], type: 'arm' },
    { name: 'right_elbow',   pts: [12,14,16], type: 'arm' },
    { name: 'left_shoulder', pts: [13,11,23], type: 'arm' },
    { name: 'right_shoulder',pts: [14,12,24], type: 'arm' },
    { name: 'left_knee',     pts: [23,25,27], type: 'leg' },
    { name: 'right_knee',    pts: [24,26,28], type: 'leg' },
    { name: 'left_hip',      pts: [11,23,25], type: 'leg' },
    { name: 'right_hip',     pts: [12,24,26], type: 'leg' },
  ];

  const joints = jointDefinitions.map(j => {
    const userAngle = calculateAngle(userNorm[j.pts[0]], userNorm[j.pts[1]], userNorm[j.pts[2]]);
    const refAngle  = calculateAngle(refNorm[j.pts[0]],  refNorm[j.pts[1]],  refNorm[j.pts[2]]);
    const diff = Math.abs(userAngle - refAngle);

    return {
      name: j.name,
      type: j.type,
      diff,
      color: diff < 15 ? 'green' : diff < 30 ? 'yellow' : 'red',
      score: Math.max(0, 100 - (diff / 180) * 100)
    };
  });

  const armJoints = joints.filter(j => j.type === 'arm');
  const legJoints = joints.filter(j => j.type === 'leg');
  const armScore  = armJoints.reduce((s,j) => s + j.score, 0) / armJoints.length;
  const legScore  = legJoints.reduce((s,j) => s + j.score, 0) / legJoints.length;

  return { joints, armScore, legScore };
}

// Step 4: Score full sequence with FastDTW timing alignment
function scoreSequence(
  userFrames: PoseFrame[],
  refFrames: PoseFrame[],
  seatedMode: boolean = false
): FinalScore {
  const userVectors = userFrames.map(f => poseToVector(normalizePose(f.landmarks)));
  const refVectors  = refFrames.map(f  => poseToVector(normalizePose(f.landmarks)));

  const { distance, path } = fastDTW(refVectors, userVectors, 10);
  const maxPossibleDistance = 180 * 8 * Math.max(userVectors.length, refVectors.length);
  const timingScore = Math.max(0, 100 - (distance / maxPossibleDistance) * 100);

  // Score each aligned frame pair
  const frameScores = path.map(([refIdx, userIdx]) =>
    scoreFrame(userFrames[userIdx].landmarks, refFrames[refIdx].landmarks)
  );

  const armScore = frameScores.reduce((s,f) => s + f.armScore, 0) / frameScores.length;
  const legScore = seatedMode
    ? 100  // don't penalize legs in seated mode
    : frameScores.reduce((s,f) => s + f.legScore, 0) / frameScores.length;

  const overallScore = armScore * 0.35 + legScore * 0.35 + timingScore * 0.30;

  return { armScore, legScore, timingScore, overallScore };
}

// Step 5: Anti-cheat check
function checkAntiCheat(frames: PoseFrame[]): boolean {
  const KEY_JOINT_INDICES = [11,12,13,14,15,16,23,24,25,26,27,28];
  let missingCount = 0;
  let totalChecks = 0;

  for (const frame of frames) {
    for (const idx of KEY_JOINT_INDICES) {
      totalChecks++;
      if (frame.landmarks[idx].visibility < 0.5) missingCount++;
    }
  }

  const missingRatio = missingCount / totalChecks;
  return missingRatio > 0.40; // returns true if cheating detected
}
```

---

## PERFORMANCE REQUIREMENTS

These are hard requirements, not nice-to-haves.

**Web:**
- MediaPipe inference must run at minimum 15fps on a 2020 MacBook with Chrome
- Use `useRef` for all landmark state inside the webcam loop (never `useState`) — learned from DanceCV's 1fps bug
- Canvas drawing must use `requestAnimationFrame`, never `setInterval`
- Chunk clip uploads must be parallel (Promise.all), not sequential
- Lazy-load MediaPipe WASM only when user enters a practice screen

**Mobile (Android):**
- TFLite inference on Vision Camera frame processor: minimum 20fps on a mid-range 2022 Android (Snapdragon 695 class)
- If fps drops below 15 continuously for 5 seconds: auto-switch from FULL to LITE model and show subtle "Reduced quality mode" indicator
- After 20 minutes continuous camera use: show "Taking a break is good for learning too" prompt
- Never allow process to run hot enough to trigger Android thermal throttling without user awareness

---

## UI / DESIGN REQUIREMENTS

**Color palette:**
- Background: `#0a0a0a` (near black)
- Surface: `#141414`
- Border: `#2a2a2a`
- Primary accent: `#7C3AED` (violet — "Taal" energy, Indian classical arts meet modern)
- Success: `#22c55e` (green — good accuracy)
- Warning: `#eab308` (yellow — close but off)
- Error: `#ef4444` (red — needs work)
- Text primary: `#f5f5f5`
- Text secondary: `#a3a3a3`

**Typography:**
- Display/headings: `Space Grotesk` (Google Fonts — modern, confident, works in Latin and Devanagari adjacently)
- Body: `Inter`
- Score numbers: `JetBrains Mono` (makes scores feel precise and technical)

**Motion:**
- Skeleton animations: 60fps canvas, GPU-accelerated
- Screen transitions: 200ms ease-in-out
- Score counter: animated number count-up on reveal
- No autoplay video with sound anywhere

**Mobile specific:**
- Bottom tab bar (not hamburger menu): Home, Upload, Progress, Settings
- Safe area insets handled for all Android notch/cutout sizes
- Touch targets minimum 48x48dp

---

## THINGS TO NEVER DO

- Never call Supabase `.from('table').select()` directly from client — ALWAYS use `.rpc('function_name', params)` 
- Never store original video on server — ever
- Never store or transmit audio
- Never use `useState` inside a MediaPipe frame processing loop — use `useRef`
- Never hardcode API keys — use `.env` for web, secure storage for mobile
- Never show a loading screen with no progress indication — always show what step is happening
- Never ship with `console.log` statements in production code
- Never build a feature as a "dummy" screen — every screen must be real and functional
- Never use `any` TypeScript type — strict mode is enforced

---

## ENVIRONMENT VARIABLES NEEDED

```env
# Web (.env)
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_GEMINI_API_KEY=
VITE_RAZORPAY_KEY_ID=
VITE_STRIPE_PUBLISHABLE_KEY=

# Mobile (react-native-config or expo-constants)
SUPABASE_URL=
SUPABASE_ANON_KEY=
GEMINI_API_KEY=
RAZORPAY_KEY_ID=
STRIPE_PUBLISHABLE_KEY=
```

---

## BUILD ORDER — DO NOT SKIP STEPS

1. Set up monorepo structure with `packages/shared`
2. Write ALL Supabase migrations (schema + all RPC functions + RLS policies + storage buckets)
3. Build `packages/shared/utils/scoring.ts` — the full scoring algorithm in TypeScript
4. Build `packages/shared/types/` — all TypeScript interfaces
5. Build web app screens in this order:
   a. Age gate
   b. Biometric consent
   c. Auth (sign up / sign in)
   d. Home / Library
   e. Upload + Processing (hardest — build this carefully)
   f. Routine Detail
   g. Chunk Practice
   h. Full Routine Practice
   i. Export + Share
   j. Credits + Payment
   k. Progress + History
   l. Instructor Portal
   m. Settings
6. Build mobile app — reuse all shared types and scoring logic, rebuild UI in React Native components
7. Integration test every RPC call end-to-end
8. Performance test: measure FPS on low-spec hardware, verify anti-cheat works, verify no videos hit server

---

## START HERE

Begin with step 1: set up the monorepo. Show me the complete folder structure with all files created (even if empty with correct types). Then move to step 2: write all Supabase migrations. Show each migration file completely before moving to the next step.

Do not skip ahead. Do not combine steps. Confirm each step is complete before proceeding.
