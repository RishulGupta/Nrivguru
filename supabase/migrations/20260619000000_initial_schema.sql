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

-- RLS Enablement
alter table public.profiles enable row level security;
alter table public.credits enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.routines enable row level security;
alter table public.chunks enable row level security;
alter table public.attempts enable row level security;
alter table public.instructor_assignments enable row level security;
alter table public.instructor_subscriptions enable row level security;

-- Basic RLS Policies (Own data access)
create policy "Users can view own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);
create policy "Users can view own credits" on public.credits for select using (auth.uid() = user_id);
create policy "Users can view own credit transactions" on public.credit_transactions for select using (auth.uid() = user_id);
create policy "Users can view own routines" on public.routines for select using (auth.uid() = user_id);
create policy "Users can view routines assigned to them" on public.routines for select using (
  exists (select 1 from public.instructor_assignments ia where ia.routine_id = id and ia.student_id = auth.uid())
);
create policy "Users can view own chunks" on public.chunks for select using (
  exists (select 1 from public.routines r where r.id = routine_id and r.user_id = auth.uid())
);
create policy "Users can view chunks of assigned routines" on public.chunks for select using (
  exists (select 1 from public.instructor_assignments ia where ia.routine_id = routine_id and ia.student_id = auth.uid())
);
create policy "Users can view own attempts" on public.attempts for select using (auth.uid() = user_id);
create policy "Instructors can view student attempts" on public.attempts for select using (
  exists (select 1 from public.instructor_assignments ia where ia.student_id = user_id and ia.instructor_id = auth.uid() and ia.routine_id = routine_id)
);
create policy "Users can view own instructor assignments" on public.instructor_assignments for select using (auth.uid() = instructor_id or auth.uid() = student_id);
create policy "Users can view own subscriptions" on public.instructor_subscriptions for select using (auth.uid() = user_id);

-- Storage Buckets (if running locally or as init)
insert into storage.buckets (id, name, public) values ('taal-thumbnails', 'taal-thumbnails', true);
insert into storage.buckets (id, name, public) values ('taal-chunk-clips', 'taal-chunk-clips', true);
insert into storage.buckets (id, name, public) values ('taal-pose-json', 'taal-pose-json', false);

-- Storage Policies
-- taal-thumbnails: public read, authenticated write
create policy "Thumbnails are publicly accessible." on storage.objects for select using ( bucket_id = 'taal-thumbnails' );
create policy "Users can upload thumbnails." on storage.objects for insert with check ( bucket_id = 'taal-thumbnails' and auth.role() = 'authenticated' );

-- taal-chunk-clips: public read, authenticated write
create policy "Clips are publicly accessible." on storage.objects for select using ( bucket_id = 'taal-chunk-clips' );
create policy "Users can upload clips." on storage.objects for insert with check ( bucket_id = 'taal-chunk-clips' and auth.role() = 'authenticated' );

-- taal-pose-json: private (authenticated read own files only)
create policy "Users can read own pose json." on storage.objects for select using ( bucket_id = 'taal-pose-json' and auth.uid() = owner );
create policy "Users can upload pose json." on storage.objects for insert with check ( bucket_id = 'taal-pose-json' and auth.role() = 'authenticated' );

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
