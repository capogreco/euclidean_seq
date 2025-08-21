/**
 * Formant Synthesis AudioWorklet Processor
 * 
 * Implements FM vowel synthesis based on Chafe's "Glitch Free FM Vocal Synthesis":
 * - UPHO (Uniform Phase Harmonic Oscillators) with shared phasor
 * - Le Brun's cross-fade solution for glitch-free transitions
 * - Multi-formant structure for realistic vowel sounds
 */

class FormantSynthProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'frequency',
        defaultValue: 220,
        minValue: 20,
        maxValue: 2000,
        automationRate: 'k-rate'
      },
      {
        name: 'vowelX', 
        defaultValue: 0.5,
        minValue: 0,
        maxValue: 1,
        automationRate: 'k-rate'
      },
      {
        name: 'vowelY',
        defaultValue: 0.5, 
        minValue: 0,
        maxValue: 1,
        automationRate: 'k-rate'
      },
      {
        name: 'active',
        defaultValue: 0,
        minValue: 0,
        maxValue: 1,
        automationRate: 'k-rate'
      }
    ];
  }

  constructor() {
    super();
    
    // Shared phasor for all oscillators (UPHO architecture)
    this.masterPhasor = 0.0;
    
    // Current synthesis parameters
    this.fundamentalFreq = 220.0; // Hz
    this.isActive = false;
    
    // Formant definitions (3-formant model)
    this.formants = [
      { 
        targetFreq: 800,   // F1 - First formant
        bandwidth: 80,     // Modulation index
        amplitude: 0.8,
        // Cross-fade carriers
        carrierEven: { harmonicNum: 4, amplitude: 0.0, phasor: 0.0 },
        carrierOdd: { harmonicNum: 3, amplitude: 0.8, phasor: 0.0 }
      },
      { 
        targetFreq: 1150,  // F2 - Second formant
        bandwidth: 90,
        amplitude: 0.6,
        carrierEven: { harmonicNum: 6, amplitude: 0.0, phasor: 0.0 },
        carrierOdd: { harmonicNum: 5, amplitude: 0.6, phasor: 0.0 }
      },
      { 
        targetFreq: 2900,  // F3 - Third formant  
        bandwidth: 120,
        amplitude: 0.2,
        carrierEven: { harmonicNum: 14, amplitude: 0.0, phasor: 0.0 },
        carrierOdd: { harmonicNum: 13, amplitude: 0.2, phasor: 0.0 }
      }
    ];
    
    // Vowel morphing parameters
    this.vowelX = 0.5; // Front/back (0=back, 1=front)
    this.vowelY = 0.5; // Close/open (0=close, 1=open)
    
    // Vowel formant table (F1, F2, F3 in Hz)
    this.vowelTable = {
      'a': [730, 1090, 2440], // /a/ as in "father"
      'e': [530, 1840, 2480], // /e/ as in "bet"
      'i': [270, 2290, 3010], // /i/ as in "beat"
      'o': [570, 840, 2410],  // /o/ as in "bought"
      'u': [300, 870, 2240]   // /u/ as in "boot"
    };
    
    // Handle messages from main thread (only for advanced formant parameters)
    this.port.onmessage = (event) => {
      const { type, payload } = event.data;
      
      switch (type) {
        case 'setFormant':
          // For advanced formant tweaking not covered by AudioParams
          if (payload.formantIndex >= 0 && payload.formantIndex < this.formants.length) {
            const formant = this.formants[payload.formantIndex];
            if (payload.frequency !== undefined) formant.targetFreq = payload.frequency;
            if (payload.bandwidth !== undefined) formant.bandwidth = payload.bandwidth;
            if (payload.amplitude !== undefined) formant.amplitude = payload.amplitude;
            this.updateFormantCarriers();
          }
          break;
      }
    };
    
    // Initialize formant carriers
    this.updateFormantCarriers();
  }
  
  /**
   * Update vowel formants based on morphing position
   * Interpolates between vowel positions in 2D space
   */
  updateVowelFormants() {
    // Define corner vowels for 2D morphing space
    const corners = {
      backClose: this.vowelTable.u,    // [0,0] - /u/
      backOpen: this.vowelTable.a,     // [0,1] - /a/  
      frontClose: this.vowelTable.i,   // [1,0] - /i/
      frontOpen: this.vowelTable.e     // [1,1] - /e/
    };
    
    // Bilinear interpolation
    for (let f = 0; f < 3; f++) {
      const backInterp = corners.backClose[f] * (1 - this.vowelY) + corners.backOpen[f] * this.vowelY;
      const frontInterp = corners.frontClose[f] * (1 - this.vowelY) + corners.frontOpen[f] * this.vowelY;
      const finalFreq = backInterp * (1 - this.vowelX) + frontInterp * this.vowelX;
      
      this.formants[f].targetFreq = finalFreq;
    }
    
    this.updateFormantCarriers();
  }
  
  /**
   * Update carrier assignments using Le Brun's cross-fade method
   * Assigns even/odd harmonic pairs to bracket target formant frequencies
   */
  updateFormantCarriers(fundamentalFreq = this.fundamentalFreq) {
    if (fundamentalFreq <= 0) return;
    
    this.formants.forEach(formant => {
      const targetRatio = formant.targetFreq / fundamentalFreq;
      
      // Find bracketing harmonics
      const lowerHarmonic = Math.floor(targetRatio);
      const upperHarmonic = Math.ceil(targetRatio);
      
      // Determine which carrier gets which harmonic based on even/odd
      let evenHarmonic, oddHarmonic;
      if (lowerHarmonic % 2 === 0) {
        evenHarmonic = lowerHarmonic;
        oddHarmonic = upperHarmonic;
      } else {
        oddHarmonic = lowerHarmonic;  
        evenHarmonic = upperHarmonic;
      }
      
      // Ensure we have valid harmonics (minimum harmonic 1)
      evenHarmonic = Math.max(2, evenHarmonic + (evenHarmonic % 2)); // Ensure even, min 2
      oddHarmonic = Math.max(1, oddHarmonic - ((oddHarmonic + 1) % 2)); // Ensure odd, min 1
      
      // Calculate cross-fade weights based on proximity to target
      const evenFreq = evenHarmonic * this.fundamentalFreq;
      const oddFreq = oddHarmonic * this.fundamentalFreq;
      const evenDistance = Math.abs(formant.targetFreq - evenFreq);
      const oddDistance = Math.abs(formant.targetFreq - oddFreq);
      const totalDistance = evenDistance + oddDistance;
      
      // Cross-fade weights (closer = higher amplitude)
      let evenWeight = 0;
      let oddWeight = 1;
      if (totalDistance > 0) {
        evenWeight = oddDistance / totalDistance;
        oddWeight = evenDistance / totalDistance;
      }
      
      // Update carrier assignments
      formant.carrierEven.harmonicNum = evenHarmonic;
      formant.carrierEven.amplitude = evenWeight * formant.amplitude;
      formant.carrierOdd.harmonicNum = oddHarmonic;
      formant.carrierOdd.amplitude = oddWeight * formant.amplitude;
    });
  }
  
  /**
   * Generate modulator signal (shared by all carriers)
   */
  generateModulator(phasor) {
    return Math.sin(2 * Math.PI * phasor);
  }
  
  /**
   * Generate carrier signal for given harmonic with FM
   */
  generateCarrier(phasor, harmonicNum, amplitude, modulationIndex, modulator) {
    if (amplitude <= 0 || harmonicNum <= 0) return 0;
    
    // UPHO: Carrier phase derived from shared master phasor
    const carrierPhasor = (phasor * harmonicNum) % 1.0;
    
    // FM synthesis: carrier + modulation
    const carrierPhase = 2 * Math.PI * carrierPhasor;
    const modulatedPhase = carrierPhase + modulationIndex * modulator;
    
    return amplitude * Math.sin(modulatedPhase);
  }
  
  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    
    const outputChannel = output[0];
    const blockSize = outputChannel.length;
    
    // Read AudioParam values (k-rate - single value per block)
    const frequency = parameters.frequency[0];
    const vowelX = parameters.vowelX[0];
    const vowelY = parameters.vowelY[0];
    const active = parameters.active[0];
    
    // Update vowel morphing if values changed
    if (vowelX !== this.vowelX || vowelY !== this.vowelY) {
      this.vowelX = vowelX;
      this.vowelY = vowelY;
      this.updateVowelFormants();
    }
    
    // Always update formant carriers for smooth portamento
    // (frequency may be changing smoothly via AudioParam automation)
    if (frequency !== this.fundamentalFreq) {
      this.fundamentalFreq = frequency;
    }
    this.updateFormantCarriers(frequency);
    
    if (!active || frequency <= 0) {
      // Silent output
      outputChannel.fill(0);
      return true;
    }
    
    // Calculate frequency increment per sample
    const freqIncrement = frequency / sampleRate;
    
    for (let sample = 0; sample < blockSize; sample++) {
      // Update shared master phasor (UPHO architecture)
      this.masterPhasor = (this.masterPhasor + freqIncrement) % 1.0;
      
      // Generate shared modulator signal
      const modulator = this.generateModulator(this.masterPhasor);
      
      // Sum all formant outputs
      let totalOutput = 0;
      
      this.formants.forEach(formant => {
        // Generate both cross-faded carriers for this formant
        const evenCarrier = this.generateCarrier(
          this.masterPhasor,
          formant.carrierEven.harmonicNum,
          formant.carrierEven.amplitude,
          formant.bandwidth / 100.0, // Scale bandwidth to reasonable modulation index
          modulator
        );
        
        const oddCarrier = this.generateCarrier(
          this.masterPhasor,
          formant.carrierOdd.harmonicNum,
          formant.carrierOdd.amplitude,
          formant.bandwidth / 100.0,
          modulator
        );
        
        // Sum the cross-faded carriers for this formant
        totalOutput += evenCarrier + oddCarrier;
      });
      
      // Apply overall gain and output
      outputChannel[sample] = totalOutput * 0.1; // Scale to prevent clipping
    }
    
    return true;
  }
}

// Register the processor
registerProcessor('formant-synth-processor', FormantSynthProcessor);