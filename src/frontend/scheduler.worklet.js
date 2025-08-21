/**
 * AudioWorklet Scheduler Processor
 * 
 * Provides sample-accurate timing for the Euclidean sequencer.
 * Runs in the high-priority audio thread, immune to main thread blocking.
 */
class SchedulerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    
    // Scheduler state
    this.isPlaying = false;
    this.startTime = null;
    this.lastGlobalStep = -1;
    this.lastNoteStep = -1;
    this.lastPhonemeStep = -1;
    
    // Timing parameters
    this.bpm = 120; // Beats per minute
    this.subdivision = 4; // 4 = quarter notes, 8 = 8th notes, 16 = 16th notes
    this.stepDuration = 60 / (this.bpm * this.subdivision); // Duration of each step in seconds
    
    // Pattern lengths
    this.notePatternLength = 8; // Note sequence length
    this.phonemePatternLength = 5; // Phoneme sequence length
    
    // Timing tracking for debugging
    this.blockCount = 0;
    
    // Handle messages from main thread
    this.port.onmessage = (event) => {
      const { type, payload } = event.data;
      
      switch (type) {
        case 'play':
          this.isPlaying = true;
          this.lastGlobalStep = -1;
          this.lastNoteStep = -1;
          this.lastPhonemeStep = -1;
          this.blockCount = 0;
          this.startTime = currentTime;
          
          if (payload.notePatternLength) {
            this.notePatternLength = payload.notePatternLength;
          }
          if (payload.phonemePatternLength) {
            this.phonemePatternLength = payload.phonemePatternLength;
          }
          if (payload.bpm) {
            this.bpm = payload.bpm;
            this.stepDuration = 60 / (this.bpm * this.subdivision);
          }
          if (payload.subdivision) {
            this.subdivision = payload.subdivision;
            this.stepDuration = 60 / (this.bpm * this.subdivision);
          }
          
          // console.log(`🎵 AudioWorklet START: BPM=${this.bpm}, subdivision=${this.subdivision}, stepDuration=${this.stepDuration.toFixed(3)}s, notePattern=${this.notePatternLength}, phonemePattern=${this.phonemePatternLength}`);
          break;
          
        case 'stop':
          this.isPlaying = false;
          this.lastGlobalStep = -1;
          this.lastNoteStep = -1;
          this.lastPhonemeStep = -1;
          // console.log('🎵 AudioWorklet STOP');
          break;
          
        case 'setBpm':
          this.bpm = payload.bpm;
          this.stepDuration = 60 / (this.bpm * this.subdivision);
          // console.log(`🎵 AudioWorklet BPM: ${this.bpm} (stepDuration: ${this.stepDuration.toFixed(3)}s)`);
          break;
          
        case 'setSubdivision':
          this.subdivision = payload.subdivision;
          this.stepDuration = 60 / (this.bpm * this.subdivision);
          // console.log(`🎵 AudioWorklet SUBDIVISION: ${this.subdivision} (stepDuration: ${this.stepDuration.toFixed(3)}s)`);
          break;
          
        case 'setPatterns':
          if (payload.notePatternLength) {
            this.notePatternLength = payload.notePatternLength;
          }
          if (payload.phonemePatternLength) {
            this.phonemePatternLength = payload.phonemePatternLength;
          }
          // console.log(`🎵 AudioWorklet PATTERNS: note=${this.notePatternLength}, phoneme=${this.phonemePatternLength}`);
          break;
      }
    };
  }

  process(inputs, outputs, parameters) {
    if (!this.isPlaying || !this.startTime) {
      return true; // Keep processor alive
    }

    // Calculate elapsed time since start (in seconds)
    const elapsedTime = currentTime - this.startTime;
    
    // Calculate global step counter (0, 1, 2, 3, 4, ... infinity)
    const globalStep = Math.floor(elapsedTime / this.stepDuration);
    
    // Map global step to individual sequence steps
    const noteStep = globalStep % this.notePatternLength;
    const phonemeStep = globalStep % this.phonemePatternLength;

    // Debug: Log every 100 blocks to see if process is running
    if (this.blockCount % 100 === 0) {
      // console.log(`🎵 WORKLET PROCESS: block ${this.blockCount}, globalStep: ${globalStep}, noteStep: ${noteStep}, phonemeStep: ${phonemeStep}, playing: ${this.isPlaying}`);
    }
    
    // Detect global step changes
    if (globalStep !== this.lastGlobalStep) {
      // Always send global step change
      this.port.postMessage({
        type: 'globalStepChange',
        payload: {
          globalStep: globalStep,
          noteStep: noteStep,
          phonemeStep: phonemeStep,
          elapsedTime: elapsedTime,
          audioTime: currentTime,
          blockCount: this.blockCount
        }
      });
      
      this.lastGlobalStep = globalStep;
    }
    
    // Detect note sequence step changes
    if (noteStep !== this.lastNoteStep) {
      this.port.postMessage({
        type: 'noteStepChange',
        payload: {
          noteStep: noteStep,
          globalStep: globalStep,
          elapsedTime: elapsedTime
        }
      });
      
      this.lastNoteStep = noteStep;
    }
    
    // Detect phoneme sequence step changes
    if (phonemeStep !== this.lastPhonemeStep) {
      this.port.postMessage({
        type: 'phonemeStepChange',
        payload: {
          phonemeStep: phonemeStep,
          globalStep: globalStep,
          elapsedTime: elapsedTime
        }
      });
      
      this.lastPhonemeStep = phonemeStep;
    }
    
    this.blockCount++;
    return true; // Keep processor alive
  }
}

// Register the processor
registerProcessor('scheduler-processor', SchedulerProcessor);