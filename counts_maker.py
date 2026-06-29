#!/usr/bin/env python3
"""
counts_maker.py — Beat-aligned 8-count segment generator for NrivGuru dance clips.

Fuses audio beats (librosa, when music is present) with motion-derived beats from
pre-extracted MediaPipe pose landmarks (always available). Works with zero audio.

Usage:
    python counts_maker.py video.mp4 [--landmarks path.npy] [--fps 30] [--plot] [--mode energy_peak]

Tune the DEFAULTS section when counts look wrong:
  - Counts feel LATE on sharp hip-hop hits  →  MOTION_MODE = 'velocity_minima'
  - Counts are NOISY / erratic              →  increase SMOOTH_WINDOW_SEC (e.g. 0.2)
  - Beats are MISSED                        →  decrease PEAK_DELTA_STD_MULT (e.g. 0.15)
  - BPM estimate is WRONG                   →  widen BPM_RANGE (e.g. (50, 200))
  - Too many IRREGULAR segments flagged     →  increase IRREGULAR_TEMPO_DEVIATION (e.g. 0.20)
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from typing import Optional

import numpy as np

# ── Tunable defaults ──────────────────────────────────────────────────────────

# Audio
SILENCE_RMS_THRESHOLD: float = 0.01   # mean RMS below this → no music detected
BPM_RANGE: tuple[int, int] = (60, 180)
AUDIO_ONSET_HOP: int = 512            # librosa hop_length for onset detection

# Motion
SMOOTH_WINDOW_SEC: float = 0.12       # Gaussian smooth σ for motion energy curve (tighter for dance)
MIN_BEAT_INTERVAL_SEC: float = 0.20   # minimum gap between detected motion beats
MOTION_MODE: str = 'energy_peak'      # 'energy_peak' | 'velocity_minima' | 'auto'
PEAK_DELTA_STD_MULT: float = 0.20     # threshold = mean + MULT × std of energy curve (slightly lower)

# Landmark weights — real dancers count on the "hit" (accent) + "land" (foot-strike).
# Comprehensive weighting: hips & shoulders drive core, wrists add sharp accents.
JOINT_WEIGHTS: dict[int, float] = {
    23: 3.0, 24: 3.0,   # left_hip, right_hip              ← primary weight shift
    11: 2.0, 12: 2.0,   # left_shoulder, right_shoulder   ← upper vody accents
    13: 1.5, 14: 1.5,   # left_elbow, right_elbow        ← arm extension
    15: 2.0, 16: 2.0,   # left_wrist, right_wrist        ← fast accent / sharp gestures
    25: 1.0, 26: 1.0,   # left_knee, right_knee          ← leg lift / step
    27: 1.0, 28: 1.0,   # left_ankle, right_ankle        ← footwork impact
}

# Fusion
FUSION_TOLERANCE_SEC: float = 0.12    # audio ↔ motion snap window (seconds)

# Count chunking (dynamic — not always 8; see chunk_into_counts)
CHUNK_BEATS: int = 8  # default for long sequences; short clips use actual count
IRREGULAR_TEMPO_DEVIATION: float = 0.15   # >15% local BPM deviation → flag irregular
TEMPO_WINDOW_SEC: float = 6.0             # rolling window for local tempo estimate


# ── Data classes ──────────────────────────────────────────────────────────────

@dataclass
class CountSegment:
    start: float
    end: float
    counts: int
    regular: bool


@dataclass
class CountsResult:
    has_audio_music: bool
    overall_tempo_bpm: float
    beat_timestamps: list[float]
    beat_sources: list[str]          # 'audio' | 'motion' | 'fused'
    count_segments: list[CountSegment]
    confidence_per_beat: list[float]


# ── Audio beats ───────────────────────────────────────────────────────────────

def extract_audio_beats(video_path: str, sr: int = 22050) -> tuple[list[float], float, bool]:
    """Return (beat_times_sec, tempo_bpm, has_music)."""
    try:
        import librosa
    except ImportError:
        print("WARNING: librosa not installed — audio path disabled. Install: pip install librosa")
        return [], 0.0, False

    try:
        y, sr_actual = librosa.load(video_path, sr=sr, mono=True)
    except Exception as exc:
        print(f"WARNING: Could not load audio from {video_path}: {exc}")
        return [], 0.0, False

    if float(np.sqrt(np.mean(y ** 2))) < SILENCE_RMS_THRESHOLD:
        return [], 0.0, False

    onset_env = librosa.onset.onset_strength(y=y, sr=sr_actual, hop_length=AUDIO_ONSET_HOP)
    tempo, beat_frames = librosa.beat.beat_track(
        onset_envelope=onset_env,
        sr=sr_actual,
        hop_length=AUDIO_ONSET_HOP,
        start_bpm=120.0,
        units='frames',
    )
    beat_times = librosa.frames_to_time(
        beat_frames, sr=sr_actual, hop_length=AUDIO_ONSET_HOP
    ).tolist()
    return beat_times, float(np.atleast_1d(tempo)[0]), True


# ── Motion energy ─────────────────────────────────────────────────────────────

def compute_motion_energy(landmarks: np.ndarray, fps: float) -> np.ndarray:
    """
    Compute a 1-D motion energy curve from pose landmark velocities.

    landmarks shape: [frames, n_landmarks, C] where C >= 3 (x, y, z[, visibility]).
    x/y are normalised image coordinates (0-1).
    Returns float64 array of length `frames`.
    """
    n_frames, n_lm, n_ch = landmarks.shape
    has_vis = n_ch >= 4

    # Build velocity, foot-strike, and arm-snap curves separately
    velocity = np.zeros(n_frames, dtype=np.float64)
    foot_strike = np.zeros(n_frames, dtype=np.float64)
    arm_snap = np.zeros(n_frames, dtype=np.float64)

    for i in range(1, n_frames):
        delta = landmarks[i, :, :2] - landmarks[i - 1, :, :2]  # (n_lm, 2)
        vel = np.sqrt((delta ** 2).sum(axis=1))                  # (n_lm,)
        e_vel, e_foot, e_arm = 0.0, 0.0, 0.0
        for lm_idx, w in JOINT_WEIGHTS.items():
            if lm_idx >= n_lm:
                continue
            vis = float(landmarks[i, lm_idx, 3]) if has_vis else 1.0
            if vis < 0.25:
                continue
            speed = float(vel[lm_idx])
            e_vel += w * vis * speed
            # Foot-strike: sharp downward deceleration on ankles (27,28)
            if lm_idx in (27, 28):
                dy = float(landmarks[i, lm_idx, 1] - landmarks[i - 1, lm_idx, 1])
                if dy > 0 and speed > 0.008:
                    e_foot += w * vis * dy
            # Arm snap: fast wrist movements (15,16)
            if lm_idx in (15, 16):
                e_arm += w * vis * speed
        velocity[i] = e_vel
        foot_strike[i] = e_foot
        arm_snap[i] = e_arm

    # Compute acceleration (change in velocity)
    acceleration = np.zeros(n_frames, dtype=np.float64)
    for i in range(2, n_frames):
        acceleration[i] = abs(velocity[i] - velocity[i - 1])

    # Multi-signal energy: weight the components like a real dancer would
    # "hit" = velocity majority, "land" = foot-strike, "accent" = arm-snap + acceleration
    energy = velocity * 0.45 + acceleration * 0.25 + foot_strike * 0.20 + arm_snap * 0.10

    # Adaptive Gaussian smooth — tighter for fast movement, wider for slow
    avg_vel = float(np.mean(velocity[velocity > 0]) if np.any(velocity > 0) else 0.001)
    std_vel = float(np.std(velocity))
    motion_intensity = (std_vel / avg_vel) if avg_vel > 0 else 1.0
    sigma = max(1.5, min(5.0, 7.0 - motion_intensity * 4.0))
    win = max(1, int(SMOOTH_WINDOW_SEC * fps))
    kernel_x = np.linspace(-3.0, 3.0, 2 * win + 1)
    kernel = np.exp(-0.5 * (kernel_x / (sigma / 2)) ** 2)
    kernel /= kernel.sum()
    return np.convolve(energy, kernel, mode='same')


def _simple_peaks(energy: np.ndarray, min_dist: int, threshold: float) -> np.ndarray:
    peaks: list[int] = []
    last = -min_dist
    for i in range(1, len(energy) - 1):
        if energy[i] < threshold:
            continue
        if energy[i] <= energy[i - 1] or energy[i] < energy[i + 1]:
            continue
        if i - last < min_dist:
            if peaks and energy[i] > energy[peaks[-1]]:
                peaks[-1] = i
                last = i
            continue
        peaks.append(i)
        last = i
    return np.array(peaks, dtype=int)


def find_energy_peaks(energy: np.ndarray, fps: float) -> np.ndarray:
    """Peak-pick motion energy (beats on movement accent)."""
    min_frames = max(1, int(MIN_BEAT_INTERVAL_SEC * fps))
    threshold = float(energy.mean() + PEAK_DELTA_STD_MULT * energy.std())
    try:
        from librosa.util import peak_pick
        return peak_pick(
            energy.astype(np.float32),
            pre_max=max(1, min_frames // 2),
            post_max=max(1, min_frames // 2),
            pre_avg=min_frames,
            post_avg=min_frames,
            delta=float(energy.std() * PEAK_DELTA_STD_MULT),
            wait=min_frames,
        )
    except ImportError:
        return _simple_peaks(energy, min_frames, threshold)


def find_velocity_minima(energy: np.ndarray, fps: float) -> np.ndarray:
    """Find stillness points (beats on HOLD/LAND — good for sharp hip-hop)."""
    min_dist = max(1, int(MIN_BEAT_INTERVAL_SEC * fps))
    ceil = float(energy.mean() - 0.05 * energy.std())
    minima: list[int] = []
    last = -min_dist
    for i in range(1, len(energy) - 1):
        if energy[i] > ceil:
            continue
        if energy[i] >= energy[i - 1] or energy[i] > energy[i + 1]:
            continue
        if i - last < min_dist:
            if minima and energy[i] < energy[minima[-1]]:
                minima[-1] = i
                last = i
            continue
        minima.append(i)
        last = i
    return np.array(minima, dtype=int)


def periodicity_score(frame_indices: np.ndarray, n_frames: int) -> float:
    """Autocorrelation-based periodicity score (higher = more regular)."""
    if len(frame_indices) < 3:
        return 0.0
    pulse = np.zeros(n_frames)
    valid = frame_indices[frame_indices < n_frames]
    pulse[valid] = 1.0
    ac = np.correlate(pulse, pulse, mode='full')[n_frames - 1:]
    if ac[0] == 0:
        return 0.0
    ac = ac / ac[0]
    med_interval = int(np.median(np.diff(frame_indices)))
    if med_interval == 0:
        return 0.0
    lags = np.arange(med_interval, min(len(ac), med_interval * 6), med_interval)
    return float(ac[lags].mean()) if len(lags) > 0 else 0.0


def extract_motion_beats(landmarks: np.ndarray, fps: float) -> tuple[list[float], float]:
    """Return (beat_times_sec, tempo_bpm_estimate)."""
    energy = compute_motion_energy(landmarks, fps)
    peaks_e = find_energy_peaks(energy, fps)
    peaks_m = find_velocity_minima(energy, fps)

    if MOTION_MODE == 'energy_peak':
        peaks = peaks_e
    elif MOTION_MODE == 'velocity_minima':
        peaks = peaks_m
    else:  # 'auto'
        se = periodicity_score(peaks_e, len(energy))
        sm = periodicity_score(peaks_m, len(energy))
        peaks = peaks_e if se >= sm else peaks_m

    beat_times = [float(p / fps) for p in peaks if p < len(energy)]
    tempo = 0.0
    if len(peaks) >= 3:
        med = float(np.median(np.diff(peaks) / fps))
        tempo = 60.0 / med if med > 0 else 0.0
    return beat_times, tempo


# ── Fusion ────────────────────────────────────────────────────────────────────

def fuse_beats(
    audio_beats: list[float],
    motion_beats: list[float],
    has_audio: bool,
) -> tuple[list[float], list[str], list[float]]:
    if not has_audio:
        return motion_beats[:], ['motion'] * len(motion_beats), [0.60] * len(motion_beats)

    timestamps: list[float] = []
    sources: list[str] = []
    confidences: list[float] = []
    matched: set[int] = set()

    for at in audio_beats:
        best_idx, best_dist = -1, float('inf')
        for mi, mt in enumerate(motion_beats):
            d = abs(at - mt)
            if d <= FUSION_TOLERANCE_SEC and d < best_dist:
                best_dist, best_idx = d, mi
        if best_idx >= 0 and best_idx not in matched:
            timestamps.append(at); sources.append('fused'); confidences.append(0.95)
            matched.add(best_idx)
        else:
            timestamps.append(at); sources.append('audio'); confidences.append(0.85)

    for mi, mt in enumerate(motion_beats):
        if mi not in matched:
            timestamps.append(mt); sources.append('motion'); confidences.append(0.40)

    order = sorted(range(len(timestamps)), key=lambda i: timestamps[i])
    return (
        [timestamps[i] for i in order],
        [sources[i] for i in order],
        [confidences[i] for i in order],
    )


# ── Tempo helpers ─────────────────────────────────────────────────────────────

def _local_tempo(beat_times: list[float], t: float) -> float:
    half = TEMPO_WINDOW_SEC / 2
    window = sorted(b for b in beat_times if abs(b - t) <= half)
    if len(window) < 2:
        return 0.0
    med = float(np.median(np.diff(window)))
    return 60.0 / med if med > 0 else 0.0


def _overall_tempo(beat_times: list[float]) -> float:
    if len(beat_times) < 2:
        return 0.0
    med = float(np.median(np.diff(beat_times)))
    return 60.0 / med if med > 0 else 0.0


# ── Count chunking ────────────────────────────────────────────────────────────

def chunk_into_counts(beat_times: list[float], overall_bpm: float, chunk_beats: int = CHUNK_BEATS) -> list[CountSegment]:
    """
    Group beat_times into chunk_beats-count segments. Mark segments where local
    BPM deviates > IRREGULAR_TEMPO_DEVIATION from the overall BPM as irregular —
    these may be freestyle, holds, or tempo changes that need special handling.
    """
    segments: list[CountSegment] = []
    for gs in range(0, len(beat_times), chunk_beats):
        group = beat_times[gs: gs + chunk_beats]
        if len(group) < 2:
            continue
        mid = (group[0] + group[-1]) / 2
        local_bpm = _local_tempo(beat_times, mid)
        regular = True
        if overall_bpm > 0 and local_bpm > 0:
            regular = abs(local_bpm - overall_bpm) / overall_bpm <= IRREGULAR_TEMPO_DEVIATION
        segments.append(CountSegment(
            start=round(group[0], 4),
            end=round(group[-1], 4),
            counts=len(group),
            regular=regular,
        ))
    return segments


# ── Main pipeline ─────────────────────────────────────────────────────────────

def analyze(
    video_path: str,
    landmarks: Optional[np.ndarray] = None,
    fps: Optional[float] = None,
) -> CountsResult:
    """
    Full analysis pipeline.

    Args:
        video_path: Path to the video file (used for audio extraction).
        landmarks: Pre-extracted MediaPipe pose data, shape [frames, n_landmarks, 3 or 4].
                   Channels: x, y, z[, visibility] — normalised 0-1.
                   Pass None to run audio-only mode.
        fps: Frame rate of the landmark array. Auto-detected from video if None.
    """
    if fps is None and landmarks is not None:
        try:
            import cv2
            cap = cv2.VideoCapture(video_path)
            fps = float(cap.get(cv2.CAP_PROP_FPS)) or 30.0
            cap.release()
        except Exception:
            fps = 30.0

    audio_beats, audio_tempo, has_audio = extract_audio_beats(video_path)

    motion_beats: list[float] = []
    motion_tempo = 0.0
    if landmarks is not None and fps:
        motion_beats, motion_tempo = extract_motion_beats(landmarks, fps)

    beat_times, sources, confidences = fuse_beats(audio_beats, motion_beats, has_audio)

    # Ensure first beat is offset from chunk start so count-1 shows visible movement
    # (mirrors the frontend ensureCounts firstOffset logic)
    if beat_times and len(beat_times) > 1:
        first = beat_times[0]
        if first < 0.05:
            offset = min(0.12, (beat_times[-1] - first) * 0.05)
            beat_times = [t + offset for t in beat_times]
    elif beat_times and len(beat_times) > 0 and beat_times[0] < 0.05:
        beat_times[0] = 0.12

    if not beat_times:
        return CountsResult(
            has_audio_music=has_audio,
            overall_tempo_bpm=round(audio_tempo or motion_tempo, 2),
            beat_timestamps=[],
            beat_sources=[],
            count_segments=[],
            confidence_per_beat=[],
        )

    overall_bpm = (audio_tempo if has_audio else motion_tempo) or _overall_tempo(beat_times)

    # Dynamic chunk beats: short clips use actual detected count; long ones use standard 8
    detect_counts = len(beat_times)
    chunk_beats = max(4, min(detect_counts, 8)) if detect_counts <= 12 else 8

    return CountsResult(
        has_audio_music=has_audio,
        overall_tempo_bpm=round(overall_bpm, 2),
        beat_timestamps=[round(t, 4) for t in beat_times],
        beat_sources=sources,
        count_segments=chunk_into_counts(beat_times, overall_bpm, chunk_beats=chunk_beats),
        confidence_per_beat=[round(c, 3) for c in confidences],
    )


# ── Diagnostic plot ───────────────────────────────────────────────────────────

def plot_result(video_path: str, landmarks: Optional[np.ndarray], result: CountsResult, fps: float) -> None:
    try:
        import matplotlib.pyplot as plt
    except ImportError:
        print("matplotlib not installed — install with: pip install matplotlib")
        return

    fig, axes = plt.subplots(2, 1, figsize=(14, 6), sharex=True)
    fig.suptitle(
        f"{video_path}  |  BPM: {result.overall_tempo_bpm:.1f}  |  "
        f"Beats: {len(result.beat_timestamps)}  |  "
        f"{'Audio+Motion' if result.has_audio_music else 'Motion-only'}",
        fontsize=10,
    )

    try:
        import librosa
        y, sr = librosa.load(video_path, sr=22050, mono=True)
        env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=AUDIO_ONSET_HOP)
        t_a = librosa.frames_to_time(np.arange(len(env)), sr=sr, hop_length=AUDIO_ONSET_HOP)
        axes[0].plot(t_a, env, color='steelblue', lw=0.7, label='Audio onset strength')
    except Exception:
        axes[0].text(0.5, 0.5, 'Audio unavailable', transform=axes[0].transAxes, ha='center')
    axes[0].set_ylabel('Audio onset')
    axes[0].legend(loc='upper right', fontsize=8)

    if landmarks is not None:
        energy = compute_motion_energy(landmarks, fps)
        t_m = np.arange(len(energy)) / fps
        axes[1].plot(t_m, energy, color='darkorange', lw=0.7, label='Motion energy')
    axes[1].set_ylabel('Motion energy')
    axes[1].set_xlabel('Time (s)')
    axes[1].legend(loc='upper right', fontsize=8)

    COLORS = {'audio': 'royalblue', 'motion': 'tomato', 'fused': 'limegreen'}
    for t, src in zip(result.beat_timestamps, result.beat_sources):
        c = COLORS.get(src, 'white')
        for ax in axes:
            ax.axvline(t, color=c, alpha=0.5, lw=0.8)

    from matplotlib.lines import Line2D
    axes[0].legend(
        handles=[Line2D([0], [0], color=c, label=s) for s, c in COLORS.items()],
        fontsize=8, loc='upper right',
    )
    plt.tight_layout()
    plt.show()


# ── CLI ───────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description='Beat-aligned 8-count generator for dance clips.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument('video', help='Path to video file')
    parser.add_argument('--landmarks', metavar='PATH',
                        help='.npy file — shape [frames, n_landmarks, 3 or 4]')
    parser.add_argument('--fps', type=float, default=None,
                        help='Frame rate of landmark array (auto from video if omitted)')
    parser.add_argument('--plot', action='store_true',
                        help='Show matplotlib diagnostic overlay after analysis')
    parser.add_argument('--mode', choices=['energy_peak', 'velocity_minima', 'auto'],
                        default=MOTION_MODE,
                        help='Motion beat detection strategy (default: %(default)s)')
    args = parser.parse_args()

    # Override module-level MOTION_MODE directly in this module's globals.
    globals()['MOTION_MODE'] = args.mode

    landmarks: Optional[np.ndarray] = None
    fps = args.fps

    if args.landmarks:
        landmarks = np.load(args.landmarks)
        if landmarks.ndim != 3:
            parser.error(f"Expected 3-D array [frames, n_lm, C], got {landmarks.shape}")
        print(f"Landmarks: {landmarks.shape}  dtype={landmarks.dtype}")
        if fps is None:
            try:
                import cv2
                cap = cv2.VideoCapture(args.video)
                fps = float(cap.get(cv2.CAP_PROP_FPS)) or 30.0
                cap.release()
                print(f"Detected fps: {fps}")
            except Exception:
                fps = 30.0
                print(f"cv2 unavailable — assuming fps={fps}")

    result = analyze(args.video, landmarks=landmarks, fps=fps)
    print(json.dumps(asdict(result), indent=2))

    if args.plot:
        plot_result(args.video, landmarks, result, fps or 30.0)


if __name__ == '__main__':
    main()
