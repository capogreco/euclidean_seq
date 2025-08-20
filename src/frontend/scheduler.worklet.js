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
    this.phasor = 0; // 0-1 representing position in cycle
    this.lastStep = -1;
    this.cycleTimeMs = 2000; // Default: 30 CPM (60000 / 30)
    this.patternLength = 6; // Number of steps in pattern
    
    // Timing tracking for debugging
    this.blockCount = 0;
    this.startTime = null;
    
    // Handle messages from main thread
    this.port.onmessage = (event) => {
      const { type, payload } = event.data;
      
      switch (type) {
        case 'play':
          this.isPlaying = true;
          this.phasor = 0;
          this.lastStep = -1;
          this.blockCount = 0;
          this.startTime = currentTime;
          
          if (payload.patternLength) {
            this.patternLength = payload.patternLength;
          }
          if (payload.cpm) {
            this.cycleTimeMs = 60000 / payload.cpm;
          }
          
          console.log(`🎵 AudioWorklet START: CPM=${payload.cpm}, pattern=${this.patternLength}, cycle=${this.cycleTimeMs}ms`);
          break;
          
        case 'stop':
          this.isPlaying = false;
          this.phasor = 0;
          this.lastStep = -1;
          console.log('🎵 AudioWorklet STOP');
          break;
          
        case 'setCpm':
          this.cycleTimeMs = 60000 / payload.cpm;
          console.log(`🎵 AudioWorklet CPM: ${payload.cpm} (cycle: ${this.cycleTimeMs}ms)`);
          break;
          
        case 'setPattern':
          this.patternLength = payload.patternLength;
          console.log(`🎵 AudioWorklet PATTERN: ${this.patternLength} steps`);
          break;
      }
    };
  }

  process(inputs, outputs, parameters) {
    if (!this.isPlaying) {
      return true; // Keep processor alive
    }

    // Debug: Log every 100 blocks to see if process is running
    if (this.blockCount % 100 === 0) {
      console.log(`🎵 WORKLET PROCESS: block ${this.blockCount}, phasor: ${this.phasor.toFixed(3)}, playing: ${this.isPlaying}`);
    }

    // Calculate sample-accurate time elapsed for this audio block
    const blockSamples = outputs[0][0].length;
    const blockTimeMs = (blockSamples / sampleRate) * 1000;
    
    // Advance phasor based on precise audio timing
    this.phasor += blockTimeMs / this.cycleTimeMs;
    
    // Handle phasor wraparound (cycle completion)
    if (this.phasor >= 1.0) {
      this.phasor -= 1.0;
    }
    
    // Calculate current step from phasor position
    const currentStep = Math.floor(this.phasor * this.patternLength);
    
    // Detect step changes and notify main thread
    if (currentStep !== this.lastStep) {
      const audioTimeElapsed = currentTime - (this.startTime || currentTime);
      
      console.log(`🎵 WORKLET STEP CHANGE: ${this.lastStep} -> ${currentStep}, phasor: ${this.phasor.toFixed(3)}`);
      
      this.port.postMessage({
        type: 'stepChange',
        payload: {
          step: currentStep,
          phasor: this.phasor,
          audioTime: currentTime,
          audioTimeElapsed: audioTimeElapsed,
          blockCount: this.blockCount
        }
      });
      
      this.lastStep = currentStep;
    }
    
    this.blockCount++;
    return true; // Keep processor alive
  }
}

// Register the processor
registerProcessor('scheduler-processor', SchedulerProcessor);