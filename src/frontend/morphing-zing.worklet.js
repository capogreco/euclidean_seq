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
            { name: 'sync', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
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
        
        // Performance optimization: pre-allocated buffers
        this.phaseBuffer = new Float32Array(128);
        this.fundamentalBuffer = new Float32Array(128);
        this.harmonicBuffer = new Float32Array(128);
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0][0];
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
        
        for (let i = 0; i < bufferSize; i++) {
            // UPHO: Update master phase for phase coherence
            const phaseIncrement = freq[i] / this.sampleRate;
            this.masterPhase += phaseIncrement;
            
            // Hard sync detection (Zing synthesis core feature)
            let syncTrigger = false;
            if (sync > 0.5) {
                // Detect master phase wrap (equivalent to analog zero-crossing)
                if (this.masterPhase >= 1.0 && this.lastMasterPhase < 1.0) {
                    syncTrigger = true;
                }
            }
            this.lastMasterPhase = this.masterPhase;
            
            // Keep master phase in [0, 1) range
            const fundamentalPhase = this.masterPhase % 1.0;
            
            // Le Brun's Cross-Fade Solution: Two UPHO harmonics with smooth interpolation
            const safeHarmonicRatio = Math.min(harmonicRatio[i], Math.floor((this.sampleRate * 0.45) / freq[i]));
            
            // Determine the two integer harmonics to cross-fade between
            const lowerHarmonic = Math.floor(safeHarmonicRatio);
            const upperHarmonic = lowerHarmonic + 1;
            const crossfadeAmount = safeHarmonicRatio - lowerHarmonic; // 0.0 to 1.0
            
            // UPHO: Phase-locked harmonic oscillators for both harmonics
            let lowerHarmonicPhase = (this.masterPhase * lowerHarmonic) % 1.0;
            let upperHarmonicPhase = (this.masterPhase * upperHarmonic) % 1.0;
            
            // Hard sync: Reset harmonic phases on fundamental zero-crossing
            if (syncTrigger) {
                lowerHarmonicPhase = 0;
                upperHarmonicPhase = 0;
            }
            
            // Apply symmetry control to all oscillators
            const shapedFundPhase = this.applySymmetry(fundamentalPhase, symmetry[i]);
            const shapedLowerPhase = this.applySymmetry(lowerHarmonicPhase, symmetry[i]);
            const shapedUpperPhase = this.applySymmetry(upperHarmonicPhase, symmetry[i]);
            
            // Generate fundamental and both harmonic waveforms
            const fundamental = this.generateWaveform(shapedFundPhase, phaseIncrement);
            const lowerHarmonic_waveform = this.generateWaveform(shapedLowerPhase, phaseIncrement * lowerHarmonic);
            const upperHarmonic_waveform = this.generateWaveform(shapedUpperPhase, phaseIncrement * upperHarmonic);
            
            // Le Brun Cross-Fade: Interpolate between the two harmonics
            const harmonic = lowerHarmonic_waveform * (1.0 - crossfadeAmount) + 
                           upperHarmonic_waveform * crossfadeAmount;
            
            // Morphing Zing Synthesis: Bipolar interpolation between synthesis modes
            const morphValue = morph[i];
            let outputSample;
            
            if (Math.abs(morphValue) < 0.001) {
                // Pure ring modulation (Zing synthesis center position)
                outputSample = fundamental * harmonic;
            } else if (morphValue > 0) {
                // Morph towards AM with fundamental as modulator
                const ringWeight = Math.cos(morphValue * this.halfPi);
                const amWeight = Math.sin(morphValue * this.halfPi);
                const ring = fundamental * harmonic;
                const am = (1 + fundamental * modDepth[i]) * harmonic;
                outputSample = ring * ringWeight + am * amWeight;
            } else {
                // Morph towards AM with harmonic as modulator
                const absMorph = Math.abs(morphValue);
                const ringWeight = Math.cos(absMorph * this.halfPi);
                const amWeight = Math.sin(absMorph * this.halfPi);
                const ring = fundamental * harmonic;
                const am = fundamental * (1 + harmonic * modDepth[i]);
                outputSample = ring * ringWeight + am * amWeight;
            }
            
            // Apply gain and write to output
            output[i] = outputSample * gain[i] * 0.5; // Scale to prevent clipping
        }
        
        return true;
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
    generateWaveform(phase, phaseIncrement) {
        // For now, use sine waves - can be extended to support other waveforms
        // with full PolyBLEP anti-aliasing for sawtooth/square waves
        return Math.sin(this.twoPi * phase);
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