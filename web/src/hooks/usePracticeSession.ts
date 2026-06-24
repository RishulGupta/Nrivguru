import { useMachine } from '@xstate/react';
import { setup } from 'xstate';

export type PracticeMode = 'full_body' | 'upper_body' | 'lower_body' | 'full_speed';

export const lessonMachine = setup({
  types: {
    context: {} as {
      chunkIndex: number;
      attemptCount: number;
      isSeatedMode: boolean;
      mode: PracticeMode;
    },
    events: {} as
      | { type: 'START_CHUNK'; chunkIndex: number }
      | { type: 'SET_MODE'; mode: PracticeMode }
      | { type: 'PHASE_COMPLETE' }
      | { type: 'PREPARATION_DONE' }
      | { type: 'GO_TO_IMPROVEMENT' }
      | { type: 'PREV_PHASE' }
      | { type: 'TOGGLE_SEATED' }
      | { type: 'RESTART_CHUNK' }
      | { type: 'SKIP_TO_FULL' }
      | { type: 'RETURN_TO_PRACTICE' }
  },
  actions: {
    incrementAttempt: ({ context }) => {
      context.attemptCount++;
    },
    resetAttempt: ({ context }) => {
      context.attemptCount = 0;
    }
  }
}).createMachine({
  id: 'lesson',
  initial: 'idle',
  context: {
    chunkIndex: 0,
    attemptCount: 0,
    isSeatedMode: false,
    mode: 'full_body'
  },
  states: {
    idle: {
      on: {
        SET_MODE: {
          actions: ({ context, event }) => { context.mode = event.mode; }
        },
        START_CHUNK: [
          {
            guard: ({ context }) => context.mode === 'full_speed',
            target: 'prep_full',
            actions: [({ context, event }) => { context.chunkIndex = event.chunkIndex; }, 'resetAttempt']
          },
          {
            guard: ({ context }) => context.mode === 'lower_body',
            target: 'prep_legs',
            actions: [({ context, event }) => { context.chunkIndex = event.chunkIndex; }, 'resetAttempt']
          },
          {
            target: 'teach',
            actions: [({ context, event }) => { context.chunkIndex = event.chunkIndex; }, 'resetAttempt']
          }
        ]
      }
    },
    teach: {
      // Phase 0: Keyframe visualization, no playback, no scoring
      on: {
        PHASE_COMPLETE: 'watch',
        PREV_PHASE: 'idle'
      }
    },
    watch: {
      // Phase 1: Watch reference at slow-motion with keyframe highlights
      on: {
        PHASE_COMPLETE: {
          target: 'prep_arms',
          actions: 'incrementAttempt'
        },
        SKIP_TO_FULL: {
          target: 'prep_full',
          actions: 'incrementAttempt'
        },
        PREV_PHASE: 'teach'
      }
    },
    // ── Preparation states (Step 1) ──
    prep_arms: {
      on: {
        PREPARATION_DONE: 'arms',
        PREV_PHASE: 'watch'
      }
    },
    prep_legs: {
      on: {
        PREPARATION_DONE: 'legs',
        PREV_PHASE: 'arms'
      }
    },
    prep_combine: {
      on: {
        PREPARATION_DONE: 'combine',
        PREV_PHASE: 'legs'
      }
    },
    prep_full: {
      on: {
        PREPARATION_DONE: 'full',
        PREV_PHASE: 'combine'
      }
    },
    arms: {
      // Step 3: Arms focus, 0.5x speed, dim lower body
      on: {
        PHASE_COMPLETE: [
          {
            guard: ({ context }) => context.mode === 'upper_body',
            target: 'improvement',
            actions: 'incrementAttempt'
          },
          {
            target: 'prep_legs',
            actions: 'incrementAttempt'
          }
        ],
        PREV_PHASE: 'watch',
        RESTART_CHUNK: 'prep_arms'
      }
    },
    legs: {
      // Step 4: Legs focus, 0.5x speed, dim upper body
      always: {
        guard: ({ context }) => context.isSeatedMode,
        target: 'prep_combine'
      },
      on: {
        PHASE_COMPLETE: [
          {
            guard: ({ context }) => context.mode === 'lower_body',
            target: 'improvement',
            actions: 'incrementAttempt'
          },
          {
            target: 'prep_combine',
            actions: 'incrementAttempt'
          }
        ],
        PREV_PHASE: 'prep_arms',
        RESTART_CHUNK: 'prep_legs'
      }
    },
    combine: {
      // Step 5: Full body practice, 0.75x speed
      on: {
        PHASE_COMPLETE: {
          target: 'improvement',
          actions: 'incrementAttempt'
        },
        SKIP_TO_FULL: {
          target: 'prep_full',
          actions: 'incrementAttempt'
        },
        PREV_PHASE: 'prep_legs',
        RESTART_CHUNK: 'prep_combine'
      }
    },
    full: {
      // Full speed rehearsal
      on: {
        PHASE_COMPLETE: {
          target: 'improvement',
          actions: 'incrementAttempt'
        },
        PREV_PHASE: 'prep_combine',
        RESTART_CHUNK: 'prep_full'
      }
    },
    improvement: {
      // Step 6: AI Coach — after-action review, coaching, proprioception
      on: {
        RETURN_TO_PRACTICE: [
          { guard: ({ context }) => context.mode === 'upper_body', target: 'prep_arms' },
          { guard: ({ context }) => context.mode === 'lower_body', target: 'prep_legs' },
          { guard: ({ context }) => context.mode === 'full_speed', target: 'prep_full' },
          { target: 'prep_combine' }
        ],
        PREV_PHASE: [
          { guard: ({ context }) => context.mode === 'full_body', target: 'combine' },
          { target: 'improvement' }
        ]
      }
    }
  },
  on: {
    SET_MODE: {
      actions: ({ context, event }) => { context.mode = event.mode; }
    },
    TOGGLE_SEATED: {
      actions: ({ context }) => { context.isSeatedMode = !context.isSeatedMode; }
    },
    // START_CHUNK works from any state (global) — used for chunk navigation
    START_CHUNK: {
      target: '.teach',
      actions: [
        ({ context, event }) => { context.chunkIndex = event.chunkIndex; },
        'resetAttempt'
      ]
    }
  }
});

export function usePracticeSession() {
  const [state, send] = useMachine(lessonMachine);

  const phase = state.value as string;
  const { chunkIndex, attemptCount, isSeatedMode, mode } = state.context;

  // Is this a preparation phase?
  const isPreparation = phase === 'prep_arms' || phase === 'prep_legs' ||
                        phase === 'prep_combine' || phase === 'prep_full';

  // Is this a practice/scored phase?
  const isPractice = phase === 'arms' || phase === 'legs' ||
                     phase === 'combine' || phase === 'full';

  // Derived properties based on phase
  const playbackRate = phase === 'watch' ? 0.75 :
                       phase === 'arms' || phase === 'legs' ? 0.5 :
                       phase === 'combine' ? 0.75 :
                       phase === 'full' ? 1.0 : 1.0;

  const focusArea = phase === 'arms' ? 'arms' as const :
                    phase === 'legs' ? 'legs' as const :
                    'full' as const;

  // Phase label for display
  const phaseLabel = phase === 'teach' ? '👀 Study the Moves' :
                     phase === 'watch' ? '👀 Watch & Learn' :
                     phase === 'prep_arms' || phase === 'arms' ? '💪 Upper Body' :
                     phase === 'prep_legs' || phase === 'legs' ? '🦵 Legs' :
                     phase === 'prep_combine' || phase === 'combine' ? '🕺 Put It Together' :
                     phase === 'prep_full' || phase === 'full' ? '⚡ Full Speed' :
                     phase === 'improvement' ? '🤖 AI Coach' : '';

  return {
    state,
    phase,
    chunkIndex,
    attemptCount,
    isSeatedMode,
    mode,
    playbackRate,
    focusArea,
    isPreparation,
    isPractice,
    phaseLabel,
    send
  };
}
