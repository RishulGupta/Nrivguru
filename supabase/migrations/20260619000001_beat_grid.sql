-- Beat grid storage on routines
ALTER TABLE public.routines
  ADD COLUMN IF NOT EXISTS beat_grid_json jsonb,
  ADD COLUMN IF NOT EXISTS count_grouping  integer DEFAULT 8;   -- 8 counts per chunk; override for odd phrasing

-- Per-chunk count range (derived from beat grid; null for non-beat chunks)
ALTER TABLE public.chunks
  ADD COLUMN IF NOT EXISTS beat_start_count integer,
  ADD COLUMN IF NOT EXISTS beat_end_count   integer;

-- ── Updated rpc_create_routine ─────────────────────────────────────────────────
-- Adds p_beat_grid_json parameter; stores it on the routine row.
CREATE OR REPLACE FUNCTION rpc_create_routine(
  p_user_id          uuid,
  p_title            text,
  p_style_tag        text,
  p_thumbnail_url    text,
  p_pose_json_url    text,
  p_duration_seconds integer,
  p_beat_grid_json   jsonb DEFAULT NULL
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  new_routine_id uuid;
BEGIN
  INSERT INTO public.routines(
    user_id, title, style_tag, thumbnail_url,
    pose_json_url, duration_seconds, beat_grid_json
  )
  VALUES (
    p_user_id, p_title, p_style_tag, p_thumbnail_url,
    p_pose_json_url, p_duration_seconds, p_beat_grid_json
  )
  RETURNING id INTO new_routine_id;

  RETURN json_build_object('id', new_routine_id, 'success', true);
END;
$$;

-- ── Updated rpc_save_chunks ────────────────────────────────────────────────────
-- Accepts beat_start_count / beat_end_count per chunk.
CREATE OR REPLACE FUNCTION rpc_save_chunks(
  p_routine_id uuid,
  p_chunks     jsonb   -- array of chunk objects
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  chunk jsonb;
BEGIN
  FOR chunk IN SELECT * FROM jsonb_array_elements(p_chunks)
  LOOP
    INSERT INTO public.chunks(
      routine_id, chunk_index, start_time_ms, end_time_ms,
      clip_url, pose_slice_json, description,
      beat_start_count, beat_end_count
    ) VALUES (
      p_routine_id,
      (chunk->>'chunk_index')::integer,
      (chunk->>'start_time_ms')::integer,
      (chunk->>'end_time_ms')::integer,
      COALESCE(chunk->>'clip_url', ''),
      chunk->'pose_slice_json',
      chunk->>'description',
      (chunk->>'beat_start_count')::integer,
      (chunk->>'beat_end_count')::integer
    );
  END LOOP;

  UPDATE public.routines
  SET total_chunks = (SELECT COUNT(*) FROM public.chunks WHERE routine_id = p_routine_id)
  WHERE id = p_routine_id;
END;
$$;

-- ── rpc_save_beat_grid ─────────────────────────────────────────────────────────
-- Upserts the beat grid for a routine (called after detection, before or after chunk save).
CREATE OR REPLACE FUNCTION rpc_save_beat_grid(
  p_routine_id     uuid,
  p_beat_grid_json jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.routines
  SET beat_grid_json = p_beat_grid_json
  WHERE id = p_routine_id;
END;
$$;
