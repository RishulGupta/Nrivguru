# AI Dance Teacher — Deep Research & Implementation Plan

## Mission

Design the world's best AI dance teacher. A system that feels like a real dance instructor standing next to you — not a video player with a score overlay. The user should feel taught, not tested.

## What Already Exists (Context)

A React + TypeScript web app with:
- **MediaPipe PoseLandmarker** (33 landmarks, in-browser via WASM, GPU delegate)
- **Joint angle scoring** — atan2-based calculation for 8 key joints (elbows, shoulders, knees, hips)
- **FastDTW** — temporal alignment between user and reference sequences
- **Scoring** — per-frame comparison with color coding: green (<15°), yellow (15-30°), red (>30°)
- **Canvas 2D skeleton rendering** with 32 bone connections
- **Side-by-side layout**: reference video (left) + webcam feed (right) with skeleton overlays
- **SpeechSynthesis API** for voice feedback
- **SpeechRecognition API** for voice commands
- **5-stage lesson plan**: Observe → Arms focus → Legs focus → Combine → Full scoring
- **Seek-based pose extraction** from uploaded reference videos
- **Chunk system** — videos split into learnable segments with start/end times

## What The Research Agent Must Do

Read this entire prompt. Then research and produce a COMPLETE implementation plan. The agent cannot see the codebase — every answer must be self-contained with enough detail to build from scratch.

---

## SECTION 1: Core Teaching Loop Design

### 1a. The Real-Time Correction Engine

**The core question:** How does the system decide WHAT to say, WHEN to say it, and HOW to say it — every 500-1000ms during an attempt?

**Requirements:**
- Every ~1 second during practice, analyze all 8 joint angles
- Find the joint with the WORST error above threshold (>20°)
- SPEAK a specific verbal correction via SpeechSynthesis
- If the SAME joint was bad last cycle but is now OK, speak encouragement
- Never repeat the same phrase twice in a row
- Max 3 corrections per 5-second chunk (don't overwhelm)
- Prioritize: if user is attempting arms-only mode, only speak about arms

**Research & design these sub-systems:**

**a) Priority Queue:**
How to decide WHICH joint to correct when multiple are bad?
- Worst joint first? Or the one we corrected previously (build on prior feedback)?
- Should the system have a "focus area" per attempt and prioritize that area?
- How to handle the case where ALL joints are bad? (beginner mode vs advanced mode)

**b) Timing & Delivery:**
- How to align the spoken correction with the movement PHASE (not just blurt it out)?
- Given SpeechSynthesis takes ~0.5-1 second to speak a phrase, how to queue corrections without overlapping?
- Should phrases be shortened for faster delivery mid-movement? (e.g., "LEFT arm HIGHER!" vs "Your left arm needs to go higher")
- How to use voice dynamics: volume, pitch, urgency based on error severity?

**c) Positive Reinforcement:**
- How to detect improvement? Track joint angle history per session
- When a joint improves by >20% from its running average, speak: "Better! That's it."
- After 3 consecutive good attempts on a previously-bad joint: "Now you've got it!"
- How to end each attempt on a positive note even if scores are low?

**d) The Correction Phrase Database:**
Design the COMPLETE data structure for mapping joint errors → teacher phrases.

For EACH of the 8 joints, for EACH error level (mild 15-25°, moderate 25-40°, severe 40°+), provide:
- 3-5 different phrase variations (so it doesn't sound robotic)
- 1 ultra-short version (for mid-movement, 1-2 seconds to speak)
- 1 descriptive version (for after-attempt review, 3-4 seconds)
- The "opposite" praise phrase (when the user fixes it)

Example structure:
```typescript
interface CorrectionPhrase {
  joint: string;
  severity: 'mild' | 'moderate' | 'severe';
  midMovement: string[];  // 1-2 sec phrases for DURING practice
  afterAction: string[];   // 3-4 sec phrases for after-attempt review  
  praiseWhenFixed: string[]; // when this joint improves
}
```

Provide the actual content for ALL 8 joints × 3 severities — write the specific phrases a real teacher would say.

**e) The Correction State Machine:**
Design a state machine per practice session:
```
MONITORING → DETECTED_ERROR → CORRECTING → VERIFYING_FIX → PRAISE → MONITORING
```
- How long to stay in CORRECTING before re-checking?
- What triggers VERIFYING_FIX?
- How to handle the case where user never fixes the error?

---

## SECTION 2: The Lesson Plan Architecture

### 2a. Progressive Lesson Flow

For EACH chunk, the system goes through this 6-phase progression:

**Phase 0 — TEACH THE MOVE (NEW)**
- Show the 3-5 most important KEY FRAMES from this chunk as pose thumbnails
- Teacher voiceover explains each part: "First, arm sweeps UP. Second, STEP together. Third, TURN."
- Duration: ~5 seconds, no webcam needed
- **Research:** How to algorithmically find key frames? Local maxima of joint velocity (fastest change points)? Sampling at 25%, 50%, 75% of duration?

**Phase 1 — WATCH (Attempt 1)**
- Full video plays at 1.0x, webcam optional
- Teacher: "Watch the full move. Pay attention to the arm path."
- No scoring, no feedback
- **Duration:** Length of the chunk (typically 3-5 seconds)

**Phase 2 — ARMS ONLY at 0.5x (Attempt 2)**
- Video plays at HALF speed (playbackRate = 0.5)
- Only upper body (joints 11-16) are scored/scored
- Lower body skeleton is visually dimmed
- Continuous audio counting throughout
- During-movement corrections for arm joints only
- After-attempt: arm-specific feedback
- **Duration:** 2× chunk length (because half speed)

**Phase 3 — LEGS ONLY at 0.5x (Attempt 3)**
- Same as Phase 2 but ONLY lower body (joints 23-28)
- Upper body skeleton dimmed
- Leg-specific corrections and feedback

**Phase 4 — COMBINE at 0.75x (Attempt 4)**
- Full speed at 0.75x (playbackRate = 0.75)
- Both arm and leg skeletons visible and scored
- Full corrections across all joints
- Teacher: "Now put it all together"

**Phase 5 — FULL SPEED at 1.0x (Attempt 5)**
- Normal speed
- Everything active
- Teacher: "Final run — your best score counts"

**Research/Design these aspects:**
- How to visually dim non-active body parts? Reduce opacity? Gray out? Remove entirely?
- How does the scoring weight change per phase? (Phase 2: armScore = 100% of total, Phase 3: legScore = 100%)
- How to handle the count timing differently at each speed?
- What if the user wants to skip phases and go straight to full speed?

### 2b. The Counting System

A dance teacher COUNTS. This is essential and missing from most apps.

**Requirements:**
- Audio count: "5... 6... 7... 8... 1... 2... 3... 4... 5... 6... 7... 8..."
- Counts 1 and 5 should be ACCENTED (louder, higher pitch)
- Visual beat indicator: a pulsing circle or bar that syncs with the count
- The count should CONTINUE throughout the entire attempt, not just at the start
- Count speed should adapt to playbackRate (0.5x = half speed counting)

**Research:**
- How to divide a chunk into 8-count phrases? Duration / 8 = time per count
- How to handle chunks that are not exactly 8 counts long? (e.g., 3-second chunk = 6 counts at 0.5s each)
- Should the count be pre-recorded audio (better quality) or live SpeechSynthesis (dynamic)?
- How to sync the visual beat indicator with the audio count?
- What does the visual beat indicator look like? (metronome? pulsing bar? number display?)

### 2c. The After-Action Review Screen

After EACH attempt (not just the last one), show:

**Visual Layout:**
- Left: Reference skeleton in WHITE
- Right: User skeleton in COLOR (green/yellow/red per joint)
- Center: OVERLAID skeletons (reference + user) with diffs visible
- RED arrows pointing to joints with >25° error
- GREEN checkmarks next to joints with <15° error

**Voice Feedback:**
- "Your LEFT arm was your biggest issue — 28° off on average."
- "Your legs improved 15% from last attempt — good work!"
- "Focus on keeping your right knee bent next round."

**Score Progression:**
- Show a small chart: Attempt 1 score → Attempt 2 score → current score
- Highlight if this is your best attempt yet

**Design/Research:**
- How to render overlaid skeletons on Canvas 2D efficiently?
- How to calculate the arrow positions and directions for pointing to specific joints?
- What's the best way to show "improvement from last attempt"? (percentage change? color change?)
- Should the user's skeleton be recorded and replayed, or are the current frame stats enough?
- How to handle the case where the user improved arms but got worse at legs?

---

## SECTION 3: Technical Architecture

### 3a. The Correction Pipeline

Design the full pipeline from webcam frame → spoken correction:

```
Webcam frame → MediaPipe detectForVideo() → 33 landmarks
     ↓
normalizePose() → scale-invariant coordinates
     ↓
scoreFrame() → compare with reference → joint angles + diffs
     ↓
Correction Engine (NEW) → analyze diffs → choose correction
     ↓
SpeechSynthesis.speak(correction)
```

**Research/Design:**
- Should this run on the main thread or in a Web Worker?
- If Web Worker, how to pass MediaPipe results (they can't be transferred)?
- How to DEBOUNCE corrections so the same phrase isn't said every frame?
- What's the minimum viable latency from frame capture → spoken correction?
- How to throttle the correction rate based on error severity? (worse = more urgent = more frequent)

### 3b. The Phrase Selection Algorithm

Design the algorithm that picks WHICH phrase to say:

```typescript
function selectCorrection(
  jointScores: JointScore[],         // current frame scores
  previousCorrections: Correction[], // what was said before
  focusArea: 'arms' | 'legs' | 'full',
  attemptNumber: number
): Correction | null {
  // 1. Filter joints by focus area
  // 2. Filter out joints already corrected this attempt (variety)
  // 3. Find the worst joint above threshold (>20° error)
  // 4. Check if a previously-corrected joint has improved → PRAISE
  // 5. Otherwise, select correction for worst joint
  // 6. Pick a phrase variation that wasn't used recently
}
```

**Research edge cases:**
- What if ALL joints are good (<15°)? → "Good form!" or silence
- What if the same joint is still bad after 3 corrections? → Change strategy, try different phrasing
- What if the user is doing WORSE than last attempt? → Gentle encouragement, not harsh criticism
- What if the webcam loses tracking? → "Step back — I can't see your full body"
- What counts as "improvement"? 5° better? 10% better?

### 3c. Performance Budget

**Real-time constraint:** System must analyze frames, compute corrections, and speak them without dropping below 15fps for the webcam loop.

**Research/Design:**
- What's the CPU cost of the correction selection algorithm?
- Should we pre-compute reference joint angles for each chunk timestamp?
- How often should we re-score? Every frame or every Nth frame?
- What's the memory cost of storing per-frame score history for one session?
- Can the SpeechSynthesis API handle the correction cadence without overlapping?

---

## SECTION 4: User Experience & Psychology

### 4a. Teacher Personality Design

A dance teacher has a PERSONALITY. The app needs one too.

**Design the teacher's personality:**
- Encouraging vs strict? ("Great try!" vs "Again — you can do better")
- Technical vs expressive? ("Your elbow is 20° off" vs "Feel the stretch")
- Talkative vs minimal? (Constant cues vs strategic silence)
- How does the personality ADAPT to the user's progress? (Stricter for advanced, gentler for beginners)

**Provide specific phrase examples for each personality type.**

### 4b. Motivation & Progress

- How to show the user they're IMPROVING across a session, not just in one attempt?
- Visual progress: mini chart showing score per attempt within a chunk
- Session progress: "You've completed 3 of 8 chunks"
- Milestone moments: "Your arm score is the best it's been all session!"
- Streak encouragement: "3 attempts in a row with improving leg scores!"

### 4c. Error Handling UX

Without making the user feel bad:
- Webcam lost: "Camera disconnected — don't worry, your progress is saved"
- No body detected: "Move into frame when you're ready"
- Consistently low scores: "This move is tricky! Let me break it down differently."
- User gives up mid-attempt: "No problem. Want to try a different move?"

---

## SECTION 5: What Else Can We Add?

Research and propose additional features beyond the core loop:

### 5a. Pre-Practice Warm-Up
- Simple movements to prepare the body
- Should the app guide a warm-up or just recommend one?
- What movements help most for dance? Neck rolls, shoulder rolls, hip circles, knee bends, ankle rotations, etc.

### 5b. Difficulty Progression Across Chunks
- The first chunks of a routine should be easier than later ones
- How to score chunk difficulty? (Based on joint angle ranges? Speed of movement?)
- Should the app reorder chunks by difficulty?

### 5c. Cross-Session Memory
- "Last session your left arm was weak. Let's check if it's improved."
- Session 2 should build on Session 1
- How to store and retrieve per-session summaries?
- What data to persist: best score per chunk, worst joints per chunk, practice history

### 5d. Dance Style Adaptation
- Hip-hop vs ballet vs bollywood require different technique focus
- How should the correction phrases change per style?
- Hip-hop: more emphasis on groove, bounce, isolations
- Ballet: more emphasis on turnout, posture, pointed feet
- Bollywood: more emphasis on hand gestures, facial expressions
- How to auto-detect the style or let the user set it?

### 5e. Musicality Coaching
- Hitting the beat is different from matching the pose
- How to measure if the user is ON BEAT vs off-beat?
- Could show a visual beat grid with the user's actual timing overlaid
- Timing-specific corrections: "You're rushing — slow down on count 3"

### 5f. Social / Mirror Mode
- In a dance class, you can watch yourself in the mirror AND see the teacher
- Should the app have a "mirror mode" that flips the webcam?
- Should there be a group practice mode for multiple users?

### 5g. Teaching Different Skill Levels
- Absolute beginner: "Just try to follow along, don't worry about accuracy"
- Intermediate: "Focus on the specific corrections"
- Advanced: "Fine-tune your expression and musicality"
- How to auto-detect the user's level?

---

## SECTION 6: If YOU Were Building The Dance Teacher From Scratch

This is the most important section. Put yourself in the role of the lead architect. You are NOT constrained by the existing codebase. You can build ANYTHING.

### 6a. Your Greenfield Design

If you were given a blank canvas (React + TypeScript + MediaPipe + a voice API), how would you build the COMPLETE dance teacher?

Design it feature-by-feature. For EACH feature, tell me:

1. **What the feature is** — One sentence describing what it does
2. **Why it matters** — How this makes the user feel like they have a real teacher
3. **How to build it** — The specific algorithm, data structure, component, or API call
4. **Edge cases** — What breaks and how to handle it

**Your feature list must include (but is not limited to):**

1. **The Lesson Structure** — How does a complete practice session flow from start to finish? (warm-up → teach → practice → review → cool-down?)
2. **The Real-Time Voice Corrector** — Speak specific corrections while the user dances
3. **The Counting System** — "5, 6, 7, 8" audio and visual beat
4. **The Progress Tracker** — Track improvement across attempts, sessions, and days
5. **The After-Action Review** — Visual + verbal breakdown after each attempt
6. **The Warm-Up Generator** — Guide simple movements before practice
7. **The Difficulty Scaler** — Adapt lesson progression based on user skill
8. **The Correction Memory** — Remember what the user struggled with last time
9. **The Focus Director** — "This round, focus on your arms"
10. **The Motivation Engine** — Encouragement, milestones, streaks
11. **The Musicality Coach** — Beat tracking and timing feedback
12. **The Style Adaptor** — Different teaching for hip-hop vs ballet vs bollywood
13. **The Pose Breakdown** — Show a move decomposed into key frames before practice
14. **The Mirror Mode** — Skeleton overlay that shows what you did vs what it should be
15. **The Mistake Highlighter** — Visual arrows, circles, and annotations on your skeleton

### 6b. For Each Feature, Give Me The SPECIFICS

Don't say "detect wrong arm position." Say:

```
Feature: Real-time left arm height correction

How it works:
- Every 600ms, sample the angle of left_elbow (landmarks 11-13-15)
- Compare to reference frame at same normalized timestamp
- If diff > 25° AND diff worsened since last sample:
  → Speak one of: "Left arm HIGHER" / "Lift your LEFT arm" / "Reach UP with your left"
- If diff was >25° last sample but <15° now:
  → Speak one of: "Good!" / "That's it!" / "Yes, like that!"
- If diff stays >25° for 3 consecutive samples:
  → Change tactic: "Try leading with your ELBOW instead of your hand"

Data structure:
{
  jointId: 'left_elbow',
  landmarks: [11, 13, 15],
  threshold: { mild: 15, moderate: 25, severe: 40 },
  phrases: {
    mild: { up: ["Soften your left arm"], down: ["Straighten your left arm more"] },
    moderate: { up: ["Left arm HIGHER", "Lift your LEFT arm"], down: ["Bend your LEFT arm more", "Soften that elbow"] },
    severe: { up: ["Your left arm is way too low — REACH UP"], down: ["Your left arm is locked — UNBEND IT"] },
    praise: ["Better!", "That's it!", "Yes, like that!"],
    stuck: ["Try leading with your elbow", "Initiate from your shoulder, not your hand"]
  }
}
```

### 6c. What Am I Missing?

Beyond everything listed in this prompt, what OTHER features would a REAL dance teacher have that I haven't thought of? List at least 5.

For each one, explain:
- What it does
- Why a real teacher would do it
- How to build it technically

Examples of things a real teacher does that might not be obvious:
- A teacher will sometimes stand NEXT TO the student and mirror them (reverse orientation)
- A teacher will physically adjust a student's arm (can't do this in an app — what's the digital equivalent?)
- A teacher will ask "Do you feel the difference?" after a correction
- A teacher will sometimes let the student fail and then say "Did you notice what happened there?"
- A teacher will give DIFFERENT corrections to different students based on their learning style

### 6d. The Startup Sequence

Design what happens in the FIRST 2 MINUTES when a new user opens the app for the first time and uploads their first video. Every second, what do they see, hear, and do?

How does the app establish itself as a "teacher" in the user's mind within those first 2 minutes?

---

## SECTION 7: Implementation Priority

Given all the features above, give me:

1. **Build order** — What to build first, second, third. Justify each choice.
2. **Quick wins** — What delivers the most "feels like a real teacher" value with the least code?
3. **Hard problems** — What will take the most effort and should be tackled later?
4. **Moat** — What feature would be hardest for competitors to copy?

---

## SECTION 8: Specific Technical Questions

Answer each of these with implementation-level detail:

1. **The correction timing problem:** If SpeechSynthesis takes 1 second to say "Lift your left arm higher", and we sample every 500ms, how do we avoid overlapping speech? (cancelling previous speech? queueing? timing the correction to the start of a musical phrase?)

2. **The focus-lock problem:** When we tell the user "focus on your arms", should the leg skeleton DISAPPEAR entirely, or just dim? How does this affect the scoring display? If legs disappear, does leg score show as N/A?

3. **The speed transition problem:** When going from 0.5x playback to 0.75x playback, the video duration changes. How does the counting system know to speed up the count? Does the user perceive this as "the teacher is talking faster"?

4. **The improvement detection problem:** How to define "improved"? Is it "last frame's error < previous frame's error" (noisy) or "rolling average over the last N frames" (laggy)? What's the right balance?

5. **The phrase variation problem:** For a 5-attempt session with 8 chunks, the user might hear "bend your left knee" 40 times. How to generate enough variation using a phrase template system vs a lookup table vs LLM?

6. **The emotional tone problem:** How to ensure corrections feel encouraging, not discouraging? What phrase patterns differentiate a "coaching" tone from a "nagging" tone? How to use vocal pitch, speed, and volume to convey warmth?

7. **The skeleton overlay problem:** When showing user + reference skeletons overlaid, how to handle the case where the user's limb is in a COMPLETELY different position than the reference? The skeletons would overlap confusingly. Should there be a threshold where you stop showing the overlay and just show them side-by-side?

---

## Output Format

Please produce a DETAILED report covering ALL 7 sections. For every feature, include:
- **How to build it** (specific algorithms, data structures, code architecture)
- **Edge cases** (what could go wrong and how to handle it)
- **What a real dance teacher would do in this situation** (ground every decision in pedagogy)
- **Priority** (P0/P1/P2)
- **Estimated effort** (hours or days)

Be specific. Don't say "use a machine learning model" — say "a lookup table with 48 entries (8 joints × 3 severities × 2 contexts) mapping to 3-5 phrase variations each". Don't say "detect improvement" — say "rolling window of 10 frames, compare mean error to previous 10-frame window, if improved by 2 standard deviations → praise".
