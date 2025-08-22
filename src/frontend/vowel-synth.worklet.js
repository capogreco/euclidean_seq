/**
 * Unified Vowel Synthesizer AudioWorklet Processor
 * 
 * Combines FM formant synthesis and Morphing Zing ring modulation synthesis
 * with shared UPL (UPHO Pair Ladder) infrastructure and real-time blending.
 * 
 * Features:
 * - Shared master phasor for phase coherency (UPHO architecture)
 * - Three UPL pairs for F1, F2, F3 formant frequencies
 * - Two parallel synthesis paths: FM formant and ring modulation
 * - Real-time blend parameter for smooth morphing between synthesis types
 * - Unified vowel formant calculation and sequencing
 */

class VowelSynthProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            // Core parameters
            { name: 'frequency', defaultValue: 220, minValue: 20, maxValue: 2000, automationRate: 'k-rate' },
            { name: 'active', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
            
            // Vowel parameters
            { name: 'vowelX', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
            { name: 'vowelY', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
            
            // Synthesis blend and character
            { name: 'synthBlend', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'a-rate' }, // 0=formant, 1=zing
            { name: 'morph', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'a-rate' }, // Zing morph parameter
            { name: 'symmetry', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'a-rate' },
            { name: 'gain', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'a-rate' }
        ];
    }

    constructor() {
        super();
        
        // Shared UPHO master phase for both synthesis paths
        this.masterPhase = 0.0;
        this.lastMasterPhase = 0.0;
        this.fundamentalFreq = 220.0;
        this.sampleRate = 48000; // Will be updated from global scope
        
        // Performance constants
        this.twoPi = 2 * Math.PI;
        this.halfPi = Math.PI / 2;
        
        // Shared vowel formant table (F1, F2, F3 in Hz)
        this.vowelCorners = {
            backClose: [240, 596, 2400],   // 'u' - back, close
            backOpen: [730, 1090, 2440],   // 'ɔ' - back, open  
            frontClose: [270, 2290, 3010], // 'i' - front, close
            frontOpen: [850, 1610, 2850]   // 'æ' - front, open
        };
        
        // Current interpolated formant frequencies
        this.formantFreqs = [800, 1150, 2900]; // Default to neutral vowel
        
        // Formant synthesis parameters (copied from formant synth)
        this.formants = [
            { 
                targetFreq: 800,   // F1
                bandwidth: 80,
                amplitude: 0.8,
                carrierEven: { harmonicNum: 4, amplitude: 0.0 },
                carrierOdd: { harmonicNum: 3, amplitude: 0.8 }
            },
            { 
                targetFreq: 1150,  // F2
                bandwidth: 90,
                amplitude: 0.6,
                carrierEven: { harmonicNum: 6, amplitude: 0.0 },
                carrierOdd: { harmonicNum: 5, amplitude: 0.6 }
            },
            { 
                targetFreq: 2900,  // F3
                bandwidth: 120,
                amplitude: 0.2,
                carrierEven: { harmonicNum: 14, amplitude: 0.0 },
                carrierOdd: { harmonicNum: 13, amplitude: 0.2 }
            }
        ];
        
        // Message handling for advanced formant tweaking
        this.port.onmessage = (event) => {
            const { type, payload } = event.data;
            
            if (type === 'setFormant' && payload.formantIndex >= 0 && payload.formantIndex < this.formants.length) {
                const formant = this.formants[payload.formantIndex];
                if (payload.frequency !== undefined) formant.targetFreq = payload.frequency;
                if (payload.bandwidth !== undefined) formant.bandwidth = payload.bandwidth;
                if (payload.amplitude !== undefined) formant.amplitude = payload.amplitude;
                this.updateFormantCarriers();
            }
        };
        
        // Initialize formant carriers
        this.updateFormantCarriers();
    }
    
    /**
     * Update vowel formants based on morphing position
     * Shared by both synthesis paths
     */
    updateVowelFormants(vowelX, vowelY) {
        const corners = this.vowelCorners;
        
        // Bilinear interpolation between corner vowels
        for (let f = 0; f < 3; f++) { // F1, F2, F3
            const backInterp = corners.backClose[f] * (1 - vowelY) + corners.backOpen[f] * vowelY;
            const frontInterp = corners.frontClose[f] * (1 - vowelY) + corners.frontOpen[f] * vowelY;
            const finalFreq = backInterp * (1 - vowelX) + frontInterp * vowelX;
            
            this.formantFreqs[f] = finalFreq;
            this.formants[f].targetFreq = finalFreq;
        }
        
        this.updateFormantCarriers();
    }
    
    /**
     * Update formant carrier assignments using Le Brun's cross-fade method
     * Shared UPL carrier assignment for both synthesis paths
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
            
            // Ensure valid harmonics
            evenHarmonic = Math.max(2, evenHarmonic + (evenHarmonic % 2));
            oddHarmonic = Math.max(1, oddHarmonic - ((oddHarmonic + 1) % 2));
            
            // Calculate cross-fade weights based on proximity to target
            const evenFreq = evenHarmonic * fundamentalFreq;
            const oddFreq = oddHarmonic * fundamentalFreq;
            const evenDistance = Math.abs(formant.targetFreq - evenFreq);
            const oddDistance = Math.abs(formant.targetFreq - oddFreq);
            const totalDistance = evenDistance + oddDistance;
            
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
     * Generate shared modulator signal (fundamental frequency)
     */
    generateModulator(phasor) {
        return Math.sin(this.twoPi * phasor);
    }
    
    /**
     * Generate formant synthesis output (FM path)
     */
    generateFormantSynthesis(phasor, modulator) {
        let totalOutput = 0;
        
        this.formants.forEach(formant => {
            // Generate both cross-faded carriers for this formant
            const evenCarrier = this.generateFMCarrier(
                phasor,
                formant.carrierEven.harmonicNum,
                formant.carrierEven.amplitude,
                formant.bandwidth / 100.0,
                modulator
            );
            
            const oddCarrier = this.generateFMCarrier(
                phasor,
                formant.carrierOdd.harmonicNum,
                formant.carrierOdd.amplitude,
                formant.bandwidth / 100.0,
                modulator
            );
            
            totalOutput += evenCarrier + oddCarrier;
        });
        
        return totalOutput * 0.1; // Scale to prevent clipping
    }
    
    /**
     * Generate FM carrier for formant synthesis
     */
    generateFMCarrier(phasor, harmonicNum, amplitude, modulationIndex, modulator) {
        if (amplitude <= 0 || harmonicNum <= 0) return 0;
        
        // UPHO: Carrier phase derived from shared master phasor
        const carrierPhasor = (phasor * harmonicNum) % 1.0;
        const carrierPhase = this.twoPi * carrierPhasor;
        const modulatedPhase = carrierPhase + modulationIndex * modulator;
        
        return amplitude * Math.sin(modulatedPhase);
    }
    
    /**
     * Generate zing synthesis output (ring modulation path)
     */
    generateZingSynthesis(phasor, morphValue, modDepthValue, symmetryValue) {
        const fundamental = this.generateWaveform(this.applySymmetry(phasor, symmetryValue));
        
        // Generate three formant-based harmonics for vowel-aware zing
        const f1Harmonic = this.generateFormantUPL(0, symmetryValue);
        const f2Harmonic = this.generateFormantUPL(1, symmetryValue);
        const f3Harmonic = this.generateFormantUPL(2, symmetryValue);
        
        // Ring modulate fundamental with each formant harmonic
        const f1Ring = this.applyMorphingSynthesis(fundamental, f1Harmonic, morphValue, modDepthValue);
        const f2Ring = this.applyMorphingSynthesis(fundamental, f2Harmonic, morphValue, modDepthValue);
        const f3Ring = this.applyMorphingSynthesis(fundamental, f3Harmonic, morphValue, modDepthValue);
        
        // Mix the three formant rings with appropriate amplitudes
        return f1Ring * 0.5 + f2Ring * 0.3 + f3Ring * 0.2;
    }
    
    /**
     * Generate UPL harmonic for specific formant (zing synthesis path)
     */
    generateFormantUPL(formantIndex, symmetryValue) {
        const targetFreq = this.formantFreqs[formantIndex];
        const targetRatio = targetFreq / this.fundamentalFreq;
        
        // Anti-aliasing: limit to Nyquist
        const maxRatio = Math.floor((this.sampleRate * 0.45) / this.fundamentalFreq);
        const safeRatio = Math.min(targetRatio, maxRatio);
        
        const lowerHarmonic = Math.floor(safeRatio);
        const upperHarmonic = lowerHarmonic + 1;
        const crossfadeAmount = safeRatio - lowerHarmonic;
        
        // UPHO: Phase-locked formant harmonics
        let lowerPhase = (this.masterPhase * lowerHarmonic) % 1.0;
        let upperPhase = (this.masterPhase * upperHarmonic) % 1.0;
        
        // Apply symmetry and generate waveforms
        const shapedLowerPhase = this.applySymmetry(lowerPhase, symmetryValue);
        const shapedUpperPhase = this.applySymmetry(upperPhase, symmetryValue);
        
        const lowerWave = this.generateWaveform(shapedLowerPhase);
        const upperWave = this.generateWaveform(shapedUpperPhase);
        
        // UPL cross-fade
        return lowerWave * (1.0 - crossfadeAmount) + upperWave * crossfadeAmount;
    }
    
    /**
     * Apply Morphing Zing synthesis (ring mod + AM morphing)
     */
    applyMorphingSynthesis(fundamental, harmonic, morphValue, modDepthValue) {
        if (Math.abs(morphValue) < 0.001) {
            return fundamental * harmonic;
        } else if (morphValue > 0) {
            const ringWeight = Math.cos(morphValue * this.halfPi);
            const amWeight = Math.sin(morphValue * this.halfPi);
            const ring = fundamental * harmonic;
            const am = (1 + fundamental * modDepthValue) * harmonic;
            return ring * ringWeight + am * amWeight;
        } else {
            const absMorph = Math.abs(morphValue);
            const ringWeight = Math.cos(absMorph * this.halfPi);
            const amWeight = Math.sin(absMorph * this.halfPi);
            const ring = fundamental * harmonic;
            const am = fundamental * (1 + harmonic * modDepthValue);
            return ring * ringWeight + am * amWeight;
        }
    }
    
    /**
     * Symmetry control: morphs waveform from saw down → triangle → saw up
     */
    applySymmetry(phase, symmetry) {
        if (symmetry < 0.5) {
            const skew = symmetry * 2;
            return phase < skew ? 
                (phase / skew) * 0.5 : 
                0.5 + ((phase - skew) / (1 - skew)) * 0.5;
        } else {
            const skew = (symmetry - 0.5) * 2;
            return phase < (1 - skew) ? 
                (phase / (1 - skew)) * 0.5 : 
                0.5 + ((phase - (1 - skew)) / skew) * 0.5;
        }
    }
    
    /**
     * Generate basic waveform (currently sine, can be extended)
     */
    generateWaveform(phase) {
        return Math.sin(this.twoPi * phase);
    }
    
    /**
     * Expand parameter to buffer size if it's a single value
     */
    expandParameter(param, bufferSize) {
        return param.length === 1 ? Array(bufferSize).fill(param[0]) : param;
    }
    
    process(inputs, outputs, parameters) {
        const output = outputs[0];
        if (!output || output.length === 0) return true;
        
        const outputChannel = output[0];
        const blockSize = outputChannel.length;
        
        // Update sample rate from global scope if available
        if (typeof sampleRate !== 'undefined') {
            this.sampleRate = sampleRate;
        }
        
        // Read AudioParam values
        const frequency = parameters.frequency[0];
        const vowelX = parameters.vowelX[0];
        const vowelY = parameters.vowelY[0];
        const active = parameters.active[0];
        
        // Get a-rate parameters
        const synthBlend = this.expandParameter(parameters.synthBlend, blockSize);
        const morph = this.expandParameter(parameters.morph, blockSize);
        const symmetry = this.expandParameter(parameters.symmetry, blockSize);
        const gain = this.expandParameter(parameters.gain, blockSize);
        
        // Fixed parameters for vowel-based synthesis
        const modDepth = 0.5; // Fixed at optimal value for vowel synthesis
        
        // Update vowel formants if changed
        if (frequency !== this.fundamentalFreq) {
            this.fundamentalFreq = frequency;
            this.updateFormantCarriers(frequency);
        }
        
        // Update vowel formants (k-rate calculation)
        this.updateVowelFormants(vowelX, vowelY);
        
        if (!active || frequency <= 0) {
            outputChannel.fill(0);
            return true;
        }
        
        // Calculate frequency increment per sample
        const freqIncrement = frequency / this.sampleRate;
        
        for (let sample = 0; sample < blockSize; sample++) {
            // Update shared master phasor (UPHO architecture)
            this.masterPhase = (this.masterPhase + freqIncrement) % 1.0;
            
            // Generate shared modulator signal
            const modulator = this.generateModulator(this.masterPhase);
            
            // Generate both synthesis paths
            const formantOutput = this.generateFormantSynthesis(this.masterPhase, modulator);
            const zingOutput = this.generateZingSynthesis(
                this.masterPhase, 
                morph[sample], 
                modDepth, 
                symmetry[sample]
            );
            
            // Blend between synthesis paths
            const blend = synthBlend[sample];
            const blendedOutput = formantOutput * (1.0 - blend) + zingOutput * blend;
            
            // Apply gain and output
            outputChannel[sample] = blendedOutput * gain[sample];
        }
        
        return true;
    }
}

registerProcessor('vowel-synth', VowelSynthProcessor);