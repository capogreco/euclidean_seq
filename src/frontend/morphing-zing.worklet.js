// Morphing Zing Synthesis AudioWorklet Processor
// Combines Zing synthesis (ring mod + hard sync) with bipolar morphing between AM modes
// Based on Rossum Electro-Music Triton and Chris Chafe's UPHO technique

class MorphingZingProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            { name: 'frequency', defaultValue: 440, minValue: 20, maxValue: 20000, automationRate: 'a-rate' },
            { name: 'harmonicRatio', defaultValue: 2, minValue: 0.5, maxValue: 16, automationRate: 'a-rate' },
            { name: 'morph', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'a-rate' },
            { name: 'modDepth', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'a-rate' },
            { name: 'symmetry', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'a-rate' },
            { name: 'gain', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'a-rate' },
            { name: 'sync', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
            // Vowel formant control parameters
            { name: 'vowelX', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'a-rate' },
            { name: 'vowelY', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'a-rate' },
            { name: 'vowelBlend', defaultValue: 0.0, minValue: 0, maxValue: 1, automationRate: 'a-rate' } // 0=original zing, 1=vowel mode
        ];
    }

    constructor() {
        super();
        
        // UPHO: Single master phase for phase coherence
        this.masterPhase = 0;
        this.lastMasterPhase = 0;
        this.sampleRate = 48000; // Will be updated from global scope if available
        
        // Constants for performance
        this.twoPi = 2 * Math.PI;
        this.halfPi = Math.PI / 2;
        
        // Vowel formant table (F1, F2, F3 in Hz) - copied from formant synth
        this.vowelCorners = {
            backClose: [240, 596, 2400],   // 'u' - back, close
            backOpen: [730, 1090, 2440],   // 'ɔ' - back, open  
            frontClose: [270, 2290, 3010], // 'i' - front, close
            frontOpen: [850, 1610, 2850]   // 'æ' - front, open
        };
        
        // Current vowel formant frequencies (will be calculated)
        this.formantFreqs = [800, 1150, 2900]; // Default to neutral vowel
        
        // Performance optimization: pre-allocated buffers
        this.phaseBuffer = new Float32Array(128);
        this.fundamentalBuffer = new Float32Array(128);
        this.harmonicBuffer = new Float32Array(128);
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0][0];
        const f1Channel = outputs[0].length > 1 ? outputs[0][1] : null;
        const f2Channel = outputs[0].length > 2 ? outputs[0][2] : null;
        const bufferSize = output.length;
        
        // Update sample rate from global scope if available
        if (typeof sampleRate !== 'undefined') {
            this.sampleRate = sampleRate;
        }
        
        // Get parameter arrays (expand single values if needed)
        const freq = this.expandParameter(parameters.frequency, bufferSize);
        const harmonicRatio = this.expandParameter(parameters.harmonicRatio, bufferSize);
        const morph = this.expandParameter(parameters.morph, bufferSize);
        const modDepth = this.expandParameter(parameters.modDepth, bufferSize);
        const symmetry = this.expandParameter(parameters.symmetry, bufferSize);
        const gain = this.expandParameter(parameters.gain, bufferSize);
        const sync = parameters.sync[0]; // k-rate parameter
        
        // New vowel parameters
        const vowelX = this.expandParameter(parameters.vowelX, bufferSize);
        const vowelY = this.expandParameter(parameters.vowelY, bufferSize);
        const vowelBlend = this.expandParameter(parameters.vowelBlend, bufferSize);
        
        // Update vowel formant frequencies (use first sample for k-rate calculation)
        this.updateVowelFormants(vowelX[0], vowelY[0]);
        
        for (let i = 0; i < bufferSize; i++) {
            // UPHO: Update master phase for phase coherence
            const phaseIncrement = freq[i] / this.sampleRate;
            this.masterPhase += phaseIncrement;
            
            // Hard sync detection (Zing synthesis core feature)
            let syncTrigger = false;
            if (sync > 0.5) {
                if (this.masterPhase >= 1.0 && this.lastMasterPhase < 1.0) {
                    syncTrigger = true;
                }
            }
            this.lastMasterPhase = this.masterPhase;
            
            // Keep master phase in [0, 1) range
            const fundamentalPhase = this.masterPhase % 1.0;
            
            // Generate fundamental oscillator
            const shapedFundPhase = this.applySymmetry(fundamentalPhase, symmetry[i]);
            const fundamental = this.generateWaveform(shapedFundPhase, phaseIncrement);
            
            // Blend between original Zing and vowel-based Zing
            const blend = vowelBlend[i];
            let outputSample = 0;
            
            let f1Output = 0;
            let f2Output = 0;
            
            if (blend < 0.001) {
                // Original Zing synthesis: single UPL pair with harmonic ratio
                const safeHarmonicRatio = Math.min(harmonicRatio[i], Math.floor((this.sampleRate * 0.45) / freq[i]));
                const harmonic = this.generateUPLHarmonic(safeHarmonicRatio, syncTrigger, symmetry[i]);
                outputSample = this.applyMorphingSynthesis(fundamental, harmonic, morph[i], modDepth[i]);
                
                // For non-vowel mode, output some reasonable signals for visualization
                f1Output = fundamental * 0.5;
                f2Output = harmonic * 0.5;
                
            } else {
                // Vowel-based Zing synthesis: three UPL pairs for F1, F2, F3
                const f1Harmonic = this.generateFormantUPL(0, freq[i], syncTrigger, symmetry[i]);
                const f2Harmonic = this.generateFormantUPL(1, freq[i], syncTrigger, symmetry[i]);
                const f3Harmonic = this.generateFormantUPL(2, freq[i], syncTrigger, symmetry[i]);
                
                // Ring modulate fundamental with each formant harmonic
                const f1Ring = this.applyMorphingSynthesis(fundamental, f1Harmonic, morph[i], modDepth[i]);
                const f2Ring = this.applyMorphingSynthesis(fundamental, f2Harmonic, morph[i], modDepth[i]);
                const f3Ring = this.applyMorphingSynthesis(fundamental, f3Harmonic, morph[i], modDepth[i]);
                
                // Store individual formant outputs for visualization
                f1Output = f1Ring;
                f2Output = f2Ring;
                
                // Mix the three formant rings with appropriate amplitudes
                const vowelRing = f1Ring * 0.5 + f2Ring * 0.3 + f3Ring * 0.2;
                
                if (blend < 0.999) {
                    // Crossfade between original and vowel modes
                    const originalHarmonic = this.generateUPLHarmonic(harmonicRatio[i], syncTrigger, symmetry[i]);
                    const originalRing = this.applyMorphingSynthesis(fundamental, originalHarmonic, morph[i], modDepth[i]);
                    outputSample = originalRing * (1.0 - blend) + vowelRing * blend;
                } else {
                    outputSample = vowelRing;
                }
            }
            
            // Apply gain and write to output
            output[i] = outputSample * gain[i] * 0.5;
            
            // Output individual formants for visualization if channels available
            if (f1Channel) f1Channel[i] = f1Output * gain[i] * 0.5;
            if (f2Channel) f2Channel[i] = f2Output * gain[i] * 0.5;
        }
        
        return true;
    }
    
    // Update vowel formant frequencies based on vowel position
    updateVowelFormants(vowelX, vowelY) {
        const corners = this.vowelCorners;
        
        for (let f = 0; f < 3; f++) { // F1, F2, F3
            // Bilinear interpolation between the four vowel corners
            const backInterp = corners.backClose[f] * (1 - vowelY) + corners.backOpen[f] * vowelY;
            const frontInterp = corners.frontClose[f] * (1 - vowelY) + corners.frontOpen[f] * vowelY;
            const finalFreq = backInterp * (1 - vowelX) + frontInterp * vowelX;
            
            this.formantFreqs[f] = finalFreq;
        }
    }
    
    // Generate UPL harmonic for original Zing synthesis
    generateUPLHarmonic(harmonicRatio, syncTrigger, symmetryValue) {
        const lowerHarmonic = Math.floor(harmonicRatio);
        const upperHarmonic = lowerHarmonic + 1;
        const crossfadeAmount = harmonicRatio - lowerHarmonic;
        
        // UPHO: Phase-locked harmonic oscillators
        let lowerPhase = (this.masterPhase * lowerHarmonic) % 1.0;
        let upperPhase = (this.masterPhase * upperHarmonic) % 1.0;
        
        // Hard sync: Reset phases on fundamental zero-crossing
        if (syncTrigger) {
            lowerPhase = 0;
            upperPhase = 0;
        }
        
        // Apply symmetry and generate waveforms (use cosine for F2)
        const shapedLowerPhase = this.applySymmetry(lowerPhase, symmetryValue);
        const shapedUpperPhase = this.applySymmetry(upperPhase, symmetryValue);
        const useCosine = formantIndex === 1; // F2 uses cosine
        
        const lowerWave = this.generateWaveform(shapedLowerPhase, 0, useCosine);
        const upperWave = this.generateWaveform(shapedUpperPhase, 0, useCosine);
        
        // UPL cross-fade
        return lowerWave * (1.0 - crossfadeAmount) + upperWave * crossfadeAmount;
    }
    
    // Generate UPL harmonic for specific formant (F1, F2, or F3)
    generateFormantUPL(formantIndex, fundamentalFreq, syncTrigger, symmetryValue) {
        const targetFreq = this.formantFreqs[formantIndex];
        const targetRatio = targetFreq / fundamentalFreq;
        
        // Anti-aliasing: limit to Nyquist
        const maxRatio = Math.floor((this.sampleRate * 0.45) / fundamentalFreq);
        const safeRatio = Math.min(targetRatio, maxRatio);
        
        const lowerHarmonic = Math.floor(safeRatio);
        const upperHarmonic = lowerHarmonic + 1;
        const crossfadeAmount = safeRatio - lowerHarmonic;
        
        // UPHO: Phase-locked formant harmonics
        let lowerPhase = (this.masterPhase * lowerHarmonic) % 1.0;
        let upperPhase = (this.masterPhase * upperHarmonic) % 1.0;
        
        // Hard sync
        if (syncTrigger) {
            lowerPhase = 0;
            upperPhase = 0;
        }
        
        // Apply symmetry and generate
        const shapedLowerPhase = this.applySymmetry(lowerPhase, symmetryValue);
        const shapedUpperPhase = this.applySymmetry(upperPhase, symmetryValue);
        
        const lowerWave = this.generateWaveform(shapedLowerPhase, 0);
        const upperWave = this.generateWaveform(shapedUpperPhase, 0);
        
        // UPL cross-fade
        return lowerWave * (1.0 - crossfadeAmount) + upperWave * crossfadeAmount;
    }
    
    // Apply Morphing Zing synthesis (ring mod + AM morphing)
    applyMorphingSynthesis(fundamental, harmonic, morphValue, modDepthValue) {
        if (Math.abs(morphValue) < 0.001) {
            // Pure ring modulation
            return fundamental * harmonic;
        } else if (morphValue > 0) {
            // Morph towards AM with fundamental as modulator
            const ringWeight = Math.cos(morphValue * this.halfPi);
            const amWeight = Math.sin(morphValue * this.halfPi);
            const ring = fundamental * harmonic;
            const am = (1 + fundamental * modDepthValue) * harmonic;
            return ring * ringWeight + am * amWeight;
        } else {
            // Morph towards AM with harmonic as modulator
            const absMorph = Math.abs(morphValue);
            const ringWeight = Math.cos(absMorph * this.halfPi);
            const amWeight = Math.sin(absMorph * this.halfPi);
            const ring = fundamental * harmonic;
            const am = fundamental * (1 + harmonic * modDepthValue);
            return ring * ringWeight + am * amWeight;
        }
    }
    
    // Expand parameter to buffer size if it's a single value
    expandParameter(param, bufferSize) {
        return param.length === 1 ? Array(bufferSize).fill(param[0]) : param;
    }
    
    // Symmetry control: morphs waveform from saw down → triangle → saw up
    applySymmetry(phase, symmetry) {
        if (symmetry < 0.5) {
            // Skew toward sawtooth down
            const skew = symmetry * 2;
            return phase < skew ? 
                (phase / skew) * 0.5 : 
                0.5 + ((phase - skew) / (1 - skew)) * 0.5;
        } else {
            // Skew toward sawtooth up
            const skew = (symmetry - 0.5) * 2;
            return phase < (1 - skew) ? 
                (phase / (1 - skew)) * 0.5 : 
                0.5 + ((phase - (1 - skew)) / skew) * 0.5;
        }
    }
    
    // Generate waveform with basic PolyBLEP anti-aliasing
    generateWaveform(phase, phaseIncrement, useCosine = false) {
        // For now, use sine waves - can be extended to support other waveforms
        // with full PolyBLEP anti-aliasing for sawtooth/square waves
        return useCosine ? Math.cos(this.twoPi * phase) : Math.sin(this.twoPi * phase);
    }
    
    // PolyBLEP anti-aliasing correction (for future sawtooth/square implementation)
    polyBLEP(phase, phaseIncrement) {
        const dt = phaseIncrement;
        
        if (phase < dt) {
            const t = phase / dt;
            return t + t - t * t - 1.0;
        } else if (phase > 1.0 - dt) {
            const t = (phase - 1.0) / dt;
            return t * t + t + t + 1.0;
        }
        
        return 0.0;
    }
    
    // Band-limited sawtooth with PolyBLEP (for future extension)
    generateBandLimitedSaw(phase, phaseIncrement) {
        // Basic saw
        let output = 2 * phase - 1;
        
        // Apply PolyBLEP correction at discontinuity
        output += this.polyBLEP(phase, phaseIncrement);
        
        return output;
    }
    
    // Band-limited square with PolyBLEP (for future extension)
    generateBandLimitedSquare(phase, phaseIncrement) {
        // Basic square
        let output = phase < 0.5 ? 1 : -1;
        
        // Apply PolyBLEP at both edges
        output += this.polyBLEP(phase, phaseIncrement);
        output -= this.polyBLEP((phase + 0.5) % 1.0, phaseIncrement);
        
        return output * 0.5; // Scale for unity gain
    }
}

registerProcessor('morphing-zing', MorphingZingProcessor);