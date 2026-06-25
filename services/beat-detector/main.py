import os
import tempfile
import subprocess
from typing import Annotated

import numpy as np
import librosa
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="TAAL Beat Detector")

ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "*").split(",")
API_KEY = os.environ.get("BEAT_API_KEY", "")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/detect")
async def detect_beats(
    file: Annotated[UploadFile, File(description="Video or audio file")],
    api_key: Annotated[str, Form()] = "",
    count_grouping: Annotated[int, Form()] = 8,
):
    if API_KEY and api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    if count_grouping < 2 or count_grouping > 32:
        raise HTTPException(status_code=422, detail="count_grouping must be 2–32")

    content = await file.read()
    if len(content) == 0:
        raise HTTPException(status_code=422, detail="Empty file")

    video_suffix = os.path.splitext(file.filename or "video.mp4")[1] or ".mp4"

    with tempfile.NamedTemporaryFile(suffix=video_suffix, delete=False) as tmp_video:
        tmp_video.write(content)
        video_path = tmp_video.name

    audio_path = video_path + ".wav"

    try:
        # Extract mono audio at 22050 Hz via ffmpeg (handles video and audio inputs)
        result = subprocess.run(
            [
                "ffmpeg", "-i", video_path,
                "-ac", "1", "-ar", "22050",
                "-vn",           # no video
                audio_path,
                "-y",
                "-loglevel", "error",
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise HTTPException(
                status_code=422,
                detail=f"Audio extraction failed: {result.stderr[:300]}",
            )

        y, sr = librosa.load(audio_path, sr=22050, mono=True)
        if len(y) == 0:
            raise HTTPException(status_code=422, detail="No audio data found in file")

        tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
        beat_times: list[float] = librosa.frames_to_time(beat_frames, sr=sr).tolist()
        bpm = float(np.atleast_1d(tempo)[0])

        if len(beat_times) == 0:
            raise HTTPException(status_code=422, detail="No beats detected — check audio quality")

        # Build count objects (1-based count within each phrase)
        counts = [
            {"count": (i % count_grouping) + 1, "time": round(t, 3)}
            for i, t in enumerate(beat_times)
        ]

        # Group beats into count_grouping-beat chunks
        beat_duration = 60.0 / bpm  # duration of one beat in seconds
        chunks = []
        for group_start in range(0, len(beat_times), count_grouping):
            group = beat_times[group_start : group_start + count_grouping]
            if len(group) < max(2, count_grouping // 2):
                break  # skip trailing group smaller than half the phrase
            chunk_id = len(chunks) + 1
            chunks.append(
                {
                    "chunkId": chunk_id,
                    "startCount": group_start + 1,
                    "endCount": group_start + len(group),
                    "startTime": round(group[0], 3),
                    # end = last beat + one beat duration (so the final note has space)
                    "endTime": round(group[-1] + beat_duration, 3),
                }
            )

        return {
            "bpm": round(bpm, 2),
            "beats": [round(b, 3) for b in beat_times],
            "counts": counts,
            "chunks": chunks,
        }

    finally:
        for path in (video_path, audio_path):
            try:
                os.unlink(path)
            except OSError:
                pass
