import { useMachine } from '@xstate/react';
import { setup } from 'xstate';

export const lessonMachine = setup({
  types: {
    context: {} as {
      chunkIndex: number;
      attemptCount: number;
      isSeatedMode: boolean;
    },
    events: {} as
      | { type: 'START_CHUNK'; chunkIndex: number }
      | { type: 'PHASE_COMPLETE' }
      | { type: 'PREV_PHASE' }
      | { type: 'TOGGLE_SEATED' }
      | { type: 'RESTART_CHUNK' }
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
    isSeatedMode: false
  },
  states: {
    idle: {
      on: {
        START_CHUNK: {
          target: 'teach',
          actions: [
            ({ context, event }) => { context.chunkIndex = event.chunkIndex; },
            'resetAttempt'
          ]
        }
      }
    },
    teach: {
      // Phase 0: Keyframe visualization, no playback, no scoring
      on: {
        PHASE_COMPLETE: 'watch'
      }
    },
    watch: {
      // Phase 1: Watch reference, no user webcam, 1.0x speed
      on: {
        PHASE_COMPLETE: {
          target: 'arms',
          actions: 'incrementAttempt'
        },
        PREV_PHASE: 'teach'
      }
    },
    arms: {
      // Phase 2: Arms only focus, 0.5x speed
      on: {
        PHASE_COMPLETE: {
          target: 'legs',
          actions: 'incrementAttempt'
        },
        PREV_PHASE: 'watch',
        RESTART_CHUNK: 'arms'
      }
    },
    legs: {
      // Phase 3: Legs only focus, 0.5x speed. (If seated, auto-skip or substitute)
      always: {
        guard: ({ context }) => context.isSeatedMode,
        target: 'combine'
      },
      on: {
        PHASE_COMPLETE: {
          target: 'combine',
          actions: 'incrementAttempt'
        },
        PREV_PHASE: 'arms',
        RESTART_CHUNK: 'legs'
      }
    },
    combine: {
      // Phase 4: Full body focus, 0.75x speed
      on: {
        PHASE_COMPLETE: {
          target: 'full',
          actions: 'incrementAttempt'
        },
        PREV_PHASE: 'legs',
        RESTART_CHUNK: 'combine'
      }
    },
    full: {
      // Phase 5: Full body focus, 1.0x speed
      on: {
        PHASE_COMPLETE: {
          target: 'idle' // Move to next chunk via external trigger, or AAR
        },
        PREV_PHASE: 'combine',
        RESTART_CHUNK: 'full'
      }
    }
  },
  on: {
    TOGGLE_SEATED: {
      actions: ({ context }) => { context.isSeatedMode = !context.isSeatedMode; }
    }
  }
});

export function usePracticeSession() {
  const [state, send] = useMachine(lessonMachine);

  const phase = state.value as string;
  const { chunkIndex, attemptCount, isSeatedMode } = state.context;

  // Derived properties based on phase
  const playbackRate = phase === 'arms' || phase === 'legs' ? 0.5 :
                       phase === 'combine' ? 0.75 : 1.0;
                       
  const focusArea = phase === 'arms' ? 'arms' :
                    phase === 'legs' ? 'legs' : 'full';

  return {
    state,
    phase,
    chunkIndex,
    attemptCount,
    isSeatedMode,
    playbackRate,
    focusArea,
    send
  };
}
