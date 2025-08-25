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
    'vowel-synth': false,
    'morphing-zing': false,
    'formant-synth-processor': false
};

/**
 * Initialize all AudioWorklet modules at startup
 */
export async function initializeSynthesizers() {
    try {
        console.log('🎵 Initializing synthesizer worklets...');
        
        // Load new unified Vowel Synth worklet
        if (!workletStatus['vowel-synth']) {
            await audioContext.audioWorklet.addModule('src/frontend/vowel-synth.worklet.js');
            workletStatus['vowel-synth'] = true;
            console.log('✅ Vowel Synth worklet loaded');
        }
        
        // Keep legacy worklets for fallback (optional)
        if (!workletStatus['morphing-zing']) {
            await audioContext.audioWorklet.addModule('src/frontend/morphing-zing.worklet.js');
            workletStatus['morphing-zing'] = true;
            console.log('✅ Morphing Zing worklet loaded (legacy)');
        }
        
        if (!workletStatus['formant-synth-processor']) {
            await audioContext.audioWorklet.addModule('/src/frontend/formant-synth.worklet.js');
            workletStatus['formant-synth-processor'] = true;
            console.log('✅ Formant Synth worklet loaded (legacy)');
        }
        
        console.log('✅ All synthesizer worklets initialized');
        return true;
    } catch (error) {
        console.error('❌ Failed to initialize synthesizers:', error);
        return false;
    }
}

/**
 * Create unified Vowel synthesizer (combines formant + zing)
 */
function createVowelSynthesizer(frequency, params = {}) {
    const { 
        vowelX = 0.5,
        vowelY = 0.5,
        synthBlend = 0.5, // 0=formant, 1=zing
        morph = 0,
        symmetry = 0.5,
        f1PhaseOffset = 0, // degrees
        f2PhaseOffset = 90 // degrees
    } = params;
    
    const vowelNode = new AudioWorkletNode(audioContext, 'vowel-synth', {
        outputChannelCount: [6], // Ch0: Main audio, Ch1: Main duplicate, Ch2: F1 full, Ch3: F2 full, Ch4: F3 full, Ch5: Reserved
        channelCount: 6,
        channelCountMode: 'explicit',
        channelInterpretation: 'discrete'
    });
    vowelNode.connect(audioContext.destination, 0, 0); // Main output only
    
    // Set initial parameters
    const now = audioContext.currentTime;
    vowelNode.parameters.get('frequency').setValueAtTime(frequency, now);
    vowelNode.parameters.get('vowelX').setValueAtTime(vowelX, now);
    vowelNode.parameters.get('vowelY').setValueAtTime(vowelY, now);
    vowelNode.parameters.get('synthBlend').setValueAtTime(synthBlend, now);
    vowelNode.parameters.get('morph').setValueAtTime(morph, now);
    vowelNode.parameters.get('symmetry').setValueAtTime(symmetry, now);
    vowelNode.parameters.get('active').setValueAtTime(0, now); // Start inactive
    vowelNode.parameters.get('gain').setValueAtTime(0.5, now);
    
    // Set initial gain compensation (empirically balanced)
    vowelNode.parameters.get('formantGain').setValueAtTime(3.0, now);
    vowelNode.parameters.get('zingGain').setValueAtTime(0.4, now);
    
    // Set initial phase offsets (convert degrees to radians)
    vowelNode.parameters.get('f1PhaseOffset').setValueAtTime(f1PhaseOffset * Math.PI / 180, now);
    vowelNode.parameters.get('f2PhaseOffset').setValueAtTime(f2PhaseOffset * Math.PI / 180, now);
    
    return {
        type: 'vowel',
        node: vowelNode,
        start() {
            vowelNode.parameters.get('active').setValueAtTime(1, audioContext.currentTime);
        },
        stop() {
            vowelNode.parameters.get('active').setValueAtTime(0, audioContext.currentTime);
        },
        setFrequency(freq) {
            vowelNode.parameters.get('frequency').setValueAtTime(freq, audioContext.currentTime);
        },
        setParams(newParams) {
            const now = audioContext.currentTime;
            if (newParams.vowelX !== undefined) vowelNode.parameters.get('vowelX').setValueAtTime(newParams.vowelX, now);
            if (newParams.vowelY !== undefined) vowelNode.parameters.get('vowelY').setValueAtTime(newParams.vowelY, now);
            if (newParams.synthBlend !== undefined) vowelNode.parameters.get('synthBlend').setValueAtTime(newParams.synthBlend, now);
            if (newParams.morph !== undefined) vowelNode.parameters.get('morph').setValueAtTime(newParams.morph, now);
            if (newParams.symmetry !== undefined) vowelNode.parameters.get('symmetry').setValueAtTime(newParams.symmetry, now);
            if (newParams.gain !== undefined) vowelNode.parameters.get('gain').setValueAtTime(newParams.gain, now);
            if (newParams.formantGain !== undefined) vowelNode.parameters.get('formantGain').setValueAtTime(newParams.formantGain, now);
            if (newParams.zingGain !== undefined) vowelNode.parameters.get('zingGain').setValueAtTime(newParams.zingGain, now);
            if (newParams.f1PhaseOffset !== undefined) vowelNode.parameters.get('f1PhaseOffset').setValueAtTime(newParams.f1PhaseOffset * Math.PI / 180, now);
            if (newParams.f2PhaseOffset !== undefined) vowelNode.parameters.get('f2PhaseOffset').setValueAtTime(newParams.f2PhaseOffset * Math.PI / 180, now);
        },
        setVowel(x, y) {
            const now = audioContext.currentTime;
            vowelNode.parameters.get('vowelX').setValueAtTime(x, now);
            vowelNode.parameters.get('vowelY').setValueAtTime(y, now);
        },
        disconnect() {
            vowelNode.disconnect();
        }
    };
}

/**
 * Create a Morphing Zing synthesizer (legacy)
 */
function createZingSynthesizer(frequency, params = {}) {
    const { 
        morph = 0, 
        harmonicRatio = 2, 
        modDepth = 0.5, 
        symmetry = 0.5,
        vowelX = 0.5,
        vowelY = 0.5,
        vowelBlend = 0.0,
        f1PhaseOffset = 0, // degrees
        f2PhaseOffset = 90 // degrees
    } = params;
    
    const zingNode = new AudioWorkletNode(audioContext, 'morphing-zing', {
        outputChannelCount: [6], // Ch0: Main audio, Ch1: Main duplicate, Ch2: F1 full, Ch3: F2 full, Ch4: F3 full, Ch5: Reserved
        channelCount: 6,
        channelCountMode: 'explicit',
        channelInterpretation: 'discrete'
    });
    zingNode.connect(audioContext.destination, 0, 0); // Main output only
    
    // Set initial parameters
    const now = audioContext.currentTime;
    zingNode.parameters.get('frequency').setValueAtTime(frequency, now);
    zingNode.parameters.get('morph').setValueAtTime(morph, now);
    zingNode.parameters.get('harmonicRatio').setValueAtTime(harmonicRatio, now);
    zingNode.parameters.get('modDepth').setValueAtTime(modDepth, now);
    zingNode.parameters.get('symmetry').setValueAtTime(symmetry, now);
    zingNode.parameters.get('vowelX').setValueAtTime(vowelX, now);
    zingNode.parameters.get('vowelY').setValueAtTime(vowelY, now);
    zingNode.parameters.get('vowelBlend').setValueAtTime(vowelBlend, now);
    zingNode.parameters.get('gain').setValueAtTime(0, now); // Start silent
    
    // Set initial phase offsets (convert degrees to radians)
    zingNode.parameters.get('f1PhaseOffset').setValueAtTime(f1PhaseOffset * Math.PI / 180, now);
    zingNode.parameters.get('f2PhaseOffset').setValueAtTime(f2PhaseOffset * Math.PI / 180, now);
    
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
            if (newParams.vowelX !== undefined) zingNode.parameters.get('vowelX').setValueAtTime(newParams.vowelX, now);
            if (newParams.vowelY !== undefined) zingNode.parameters.get('vowelY').setValueAtTime(newParams.vowelY, now);
            if (newParams.vowelBlend !== undefined) zingNode.parameters.get('vowelBlend').setValueAtTime(newParams.vowelBlend, now);
            if (newParams.f1PhaseOffset !== undefined) zingNode.parameters.get('f1PhaseOffset').setValueAtTime(newParams.f1PhaseOffset * Math.PI / 180, now);
            if (newParams.f2PhaseOffset !== undefined) zingNode.parameters.get('f2PhaseOffset').setValueAtTime(newParams.f2PhaseOffset * Math.PI / 180, now);
        },
        setVowel(x, y) {
            const now = audioContext.currentTime;
            zingNode.parameters.get('vowelX').setValueAtTime(x, now);
            zingNode.parameters.get('vowelY').setValueAtTime(y, now);
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
    const { 
        vowelX = 0.5, 
        vowelY = 0.5,
        f1PhaseOffset = 0, // degrees
        f2PhaseOffset = 90 // degrees
    } = params;
    
    const formantNode = new AudioWorkletNode(audioContext, 'formant-synth-processor', {
        outputChannelCount: [6], // Ch0: Main audio, Ch1: Main duplicate, Ch2: F1 full, Ch3: F2 full, Ch4: F3 full, Ch5: Reserved
        channelCount: 6,
        channelCountMode: 'explicit',
        channelInterpretation: 'discrete'
    });
    formantNode.connect(audioContext.destination, 0, 0); // Main output only
    
    // Set initial parameters
    const now = audioContext.currentTime;
    formantNode.parameters.get('frequency').setValueAtTime(frequency, now);
    formantNode.parameters.get('vowelX').setValueAtTime(vowelX, now);
    formantNode.parameters.get('vowelY').setValueAtTime(vowelY, now);
    formantNode.parameters.get('active').setValueAtTime(0, now); // Start inactive
    
    // Set initial phase offsets (convert degrees to radians)
    formantNode.parameters.get('f1PhaseOffset').setValueAtTime(f1PhaseOffset * Math.PI / 180, now);
    formantNode.parameters.get('f2PhaseOffset').setValueAtTime(f2PhaseOffset * Math.PI / 180, now);
    
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
            if (newParams.f1PhaseOffset !== undefined) formantNode.parameters.get('f1PhaseOffset').setValueAtTime(newParams.f1PhaseOffset * Math.PI / 180, now);
            if (newParams.f2PhaseOffset !== undefined) formantNode.parameters.get('f2PhaseOffset').setValueAtTime(newParams.f2PhaseOffset * Math.PI / 180, now);
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
            case 'vowel':
                if (!workletStatus['vowel-synth']) {
                    throw new Error('Vowel Synth worklet not loaded');
                }
                currentSynthesizer = createVowelSynthesizer(frequency, params);
                break;
                
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