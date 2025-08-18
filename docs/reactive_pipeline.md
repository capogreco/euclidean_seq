# Current Pipeline Understanding:

EDO (equal divisions)
  → Base Tones (all chromatic frequencies)
    → Scale Tones (Euclidean selection from base)
      → Chord Tones (Euclidean selection from scale)
        → Sequence Tones (expanded across octaves, then Euclidean/random selection)
          → Sequence Pattern (ordering + rhythm/portamento)
            → Playback (actual audio generation)

# The Elegant Solution: Reactive Pipeline Pattern

Here's how I'd structure this for real-time updates:

```js
class TonePipeline {
  constructor() {
    // Each stage is a pure function that depends only on its inputs
    this.stages = {
      baseTones: (params) => generateBaseTones(params.edo, params.rootFreq),
      scaleTones: (baseTones, params) => selectEuclidean(baseTones, params.scaleNotes, params.scaleRotation),
      chordTones: (scaleTones, params) => selectEuclidean(scaleTones, params.chordNotes, params.chordRotation),
      sequenceTones: (chordTones, params) => expandAndSelect(chordTones, params),
      pattern: (sequenceTones, params) => generatePattern(sequenceTones, params),
    };

    // Memoization for each stage
    this.cache = new Map();

    // Dependencies graph
    this.dependencies = {
      baseTones: ['edo', 'rootFreq'],
      scaleTones: ['baseTones', 'scaleNotes', 'scaleRotation'],
      chordTones: ['scaleTones', 'chordNotes', 'chordRotation'],
      sequenceTones: ['chordTones', 'sequenceNotes', 'sequenceMethod', 'sequenceBase', 'sequenceOctaves'],
      pattern: ['sequenceTones', 'sequenceOrder', 'portamentoSteps', 'rhythmPulses', ...],
    };
  }

  // Smart invalidation - only recompute what changed
  updateParam(paramName, value) {
    // Find which stages need recomputation
    const invalidatedStages = this.findAffectedStages(paramName);

    // Clear cache for affected stages
    invalidatedStages.forEach(stage => this.cache.delete(stage));

    // If playing, update just the changed parts
    if (this.isPlaying) {
      this.recomputeFrom(invalidatedStages[0]);
    }
  }

  // Lazy evaluation with caching
  getStage(stageName) {
    if (!this.cache.has(stageName)) {
      const computed = this.computeStage(stageName);
      this.cache.set(stageName, computed);
    }
    return this.cache.get(stageName);
  }
}
```

# Key Design Principles:

1. Pure Functions: Each stage is a pure function - given the same inputs, it always produces the same
outputs. This makes caching and invalidation simple.
2. Dependency Graph: Explicitly declare what each stage depends on. This lets us know exactly what needs
  recomputation when a parameter changes.
3. Memoization: Cache results at each stage. When scale rotation changes, we only recompute from scale
tones onward, not base tones.
4. Minimal Recomputation: The pattern structure (when notes play) can often stay the same even when the
tones change. We just remap the pattern indices to new frequencies.
5. Separation of Concerns:
  - Tone Generation: What frequencies exist
  - Pattern Generation: When to play (rhythm, order)
  - Performance: How to play (portamento, envelopes)

Implementation Strategy:

```js
// Single source of truth for all parameters
const params = {
  edo: 12,
  rootFreq: 261.63,
  scaleNotes: 7,
  scaleRotation: 0,
  // ... etc
};

// Reactive update system
function updateParameter(name, value) {
  const oldValue = params[name];
  params[name] = value;

  // Determine what changed
  const changes = pipeline.whatChanges(name);

  // Update only what's needed
  if (changes.includes('pattern')) {
    // Keep playback position, update frequencies
    const currentStep = sequencer.currentStep;
    sequencer.updatePattern(pipeline.getStage('pattern'));
    sequencer.currentStep = currentStep;
  } else if (changes.includes('performance')) {
    // Just update performance parameters, no pattern change
    sequencer.updatePerformance(params);
  }
}
```

Benefits:

1. Predictable: You always know what will update when you change a parameter
2. Efficient: Only recomputes what's necessary
3. Testable: Each stage is a pure function that's easy to test
4. Maintainable: Clear data flow and dependencies
5. Real-time: Updates can happen during playback without interruption
