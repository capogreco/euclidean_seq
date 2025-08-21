/**
 * Unified Synthesizer Manager
 * 
 * Simple architecture: Only one synthesizer active at a time.
 * Eliminates stuck notes, race conditions, and complex state management.
 */

import { audioContext } from './audio.js';

// Simple global state
let currentSynthesizer = null;
let currentSynthType = null;

// Worklet initialization status
let workletStatus = {
    'morphing-zing': false,
    'formant-synth-processor': false
};

/**
 * Initialize all AudioWorklet modules at startup
 */
export async function initializeSynthesizers() {
    try {
        console.log('🎵 Initializing synthesizer worklets...');
        
        // Load Morphing Zing worklet
        if (!workletStatus['morphing-zing']) {
            await audioContext.audioWorklet.addModule('src/frontend/morphing-zing.worklet.js');
            workletStatus['morphing-zing'] = true;
            console.log('✅ Morphing Zing worklet loaded');
        }
        
        // Load Formant Synth worklet  
        if (!workletStatus['formant-synth-processor']) {
            await audioContext.audioWorklet.addModule('/src/frontend/formant-synth.worklet.js');
            workletStatus['formant-synth-processor'] = true;
            console.log('✅ Formant Synth worklet loaded');
        }
        
        console.log('✅ All synthesizer worklets initialized');
        return true;
    } catch (error) {
        console.error('❌ Failed to initialize synthesizers:', error);
        return false;
    }
}

/**
 * Create a Morphing Zing synthesizer
 */
function createZingSynthesizer(frequency, params = {}) {
    const { morph = 0, harmonicRatio = 2, modDepth = 0.5, symmetry = 0.5 } = params;
    
    const zingNode = new AudioWorkletNode(audioContext, 'morphing-zing');
    zingNode.connect(audioContext.destination);
    
    // Set initial parameters
    const now = audioContext.currentTime;
    zingNode.parameters.get('frequency').setValueAtTime(frequency, now);
    zingNode.parameters.get('morph').setValueAtTime(morph, now);
    zingNode.parameters.get('harmonicRatio').setValueAtTime(harmonicRatio, now);
    zingNode.parameters.get('modDepth').setValueAtTime(modDepth, now);
    zingNode.parameters.get('symmetry').setValueAtTime(symmetry, now);
    zingNode.parameters.get('gain').setValueAtTime(0, now); // Start silent
    
    return {
        type: 'zing',
        node: zingNode,
        start() {
            zingNode.parameters.get('gain').setValueAtTime(0.3, audioContext.currentTime);
        },
        stop() {
            const now = audioContext.currentTime;
            zingNode.parameters.get('gain').linearRampToValueAtTime(0, now + 0.01);
        },
        setFrequency(freq) {
            zingNode.parameters.get('frequency').setValueAtTime(freq, audioContext.currentTime);
        },
        setParams(newParams) {
            const now = audioContext.currentTime;
            if (newParams.morph !== undefined) zingNode.parameters.get('morph').setValueAtTime(newParams.morph, now);
            if (newParams.harmonicRatio !== undefined) zingNode.parameters.get('harmonicRatio').setValueAtTime(newParams.harmonicRatio, now);
            if (newParams.modDepth !== undefined) zingNode.parameters.get('modDepth').setValueAtTime(newParams.modDepth, now);
            if (newParams.symmetry !== undefined) zingNode.parameters.get('symmetry').setValueAtTime(newParams.symmetry, now);
        },
        disconnect() {
            zingNode.disconnect();
        }
    };
}

/**
 * Create a Formant synthesizer
 */
function createFormantSynthesizer(frequency, params = {}) {
    const { vowelX = 0.5, vowelY = 0.5 } = params;
    
    const formantNode = new AudioWorkletNode(audioContext, 'formant-synth-processor');
    formantNode.connect(audioContext.destination);
    
    // Set initial parameters
    const now = audioContext.currentTime;
    formantNode.parameters.get('frequency').setValueAtTime(frequency, now);
    formantNode.parameters.get('vowelX').setValueAtTime(vowelX, now);
    formantNode.parameters.get('vowelY').setValueAtTime(vowelY, now);
    formantNode.parameters.get('active').setValueAtTime(0, now); // Start inactive
    
    return {
        type: 'formant',
        node: formantNode,
        start() {
            formantNode.parameters.get('active').setValueAtTime(1, audioContext.currentTime);
        },
        stop() {
            formantNode.parameters.get('active').setValueAtTime(0, audioContext.currentTime);
        },
        setFrequency(freq) {
            formantNode.parameters.get('frequency').setValueAtTime(freq, audioContext.currentTime);
        },
        setParams(newParams) {
            const now = audioContext.currentTime;
            if (newParams.vowelX !== undefined) formantNode.parameters.get('vowelX').setValueAtTime(newParams.vowelX, now);
            if (newParams.vowelY !== undefined) formantNode.parameters.get('vowelY').setValueAtTime(newParams.vowelY, now);
        },
        disconnect() {
            formantNode.disconnect();
        }
    };
}

/**
 * Create a simple Sine synthesizer
 */
function createSineSynthesizer(frequency, params = {}) {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    
    osc.connect(gain).connect(audioContext.destination);
    osc.type = 'sine';
    osc.frequency.value = frequency;
    gain.gain.value = 0; // Start silent
    
    return {
        type: 'sine',
        node: osc,
        gain: gain,
        start() {
            osc.start();
            gain.gain.setValueAtTime(0.3, audioContext.currentTime);
        },
        stop() {
            const now = audioContext.currentTime;
            gain.gain.linearRampToValueAtTime(0, now + 0.01);
            setTimeout(() => osc.stop(), 50);
        },
        setFrequency(freq) {
            osc.frequency.setValueAtTime(freq, audioContext.currentTime);
        },
        setParams(newParams) {
            // Sine synth doesn't have additional parameters
        },
        disconnect() {
            gain.disconnect();
            try { osc.stop(); } catch (e) { /* already stopped */ }
        }
    };
}

/**
 * Switch to a specific synthesizer type
 * This is the main function that replaces all the complex oscillator management
 */
export function switchToSynthesizer(synthType, frequency, params = {}) {
    console.log(`🎛️ Switching to ${synthType} synthesizer`);
    
    // Always clean up current synthesizer first
    if (currentSynthesizer) {
        console.log(`🧹 Cleaning up current ${currentSynthType} synthesizer`);
        currentSynthesizer.stop();
        currentSynthesizer.disconnect();
        currentSynthesizer = null;
        currentSynthType = null;
    }
    
    // Create the requested synthesizer
    try {
        switch (synthType) {
            case 'zing':
                if (!workletStatus['morphing-zing']) {
                    throw new Error('Morphing Zing worklet not loaded');
                }
                currentSynthesizer = createZingSynthesizer(frequency, params);
                break;
                
            case 'formant':
                if (!workletStatus['formant-synth-processor']) {
                    throw new Error('Formant Synth worklet not loaded');
                }
                currentSynthesizer = createFormantSynthesizer(frequency, params);
                break;
                
            case 'sine':
                currentSynthesizer = createSineSynthesizer(frequency, params);
                break;
                
            default:
                throw new Error(`Unknown synthesizer type: ${synthType}`);
        }
        
        currentSynthType = synthType;
        console.log(`✅ ${synthType} synthesizer created and ready`);
        return currentSynthesizer;
        
    } catch (error) {
        console.error(`❌ Failed to create ${synthType} synthesizer:`, error);
        
        // Fallback to sine if the requested synth fails
        if (synthType !== 'sine') {
            console.log('🔄 Falling back to sine synthesizer');
            return switchToSynthesizer('sine', frequency, params);
        }
        return null;
    }
}

/**
 * Get the current active synthesizer
 */
export function getCurrentSynthesizer() {
    return currentSynthesizer;
}

/**
 * Get the current synthesizer type
 */
export function getCurrentSynthType() {
    return currentSynthType;
}

/**
 * Stop and clean up current synthesizer
 */
export function stopCurrentSynthesizer() {
    if (currentSynthesizer) {
        console.log(`🛑 Stopping ${currentSynthType} synthesizer`);
        currentSynthesizer.stop();
        currentSynthesizer.disconnect();
        currentSynthesizer = null;
        currentSynthType = null;
    }
}