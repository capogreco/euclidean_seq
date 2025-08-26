// Import AudioWorklet services
import { sendToScheduler, isSchedulerReady } from './audio-worklet-service.js';
import { 
    initializeFormantSynth, 
    playFormantNote, 
    createFormantOscillator, 
    isFormantSynthReady,
    setFormantActive 
} from './formant-synth-service.js';
import { updateFrequencyParam, updateVowelParam } from './parameter-coordinator.js';

// Audio context initialization
export const audioContext = new (window.AudioContext || window.webkitAudioContext)();

// Make audioContext globally available
window.audioContext = audioContext;

// NOTE: Morphing Zing initialization is now handled by synthesizer-manager.js
// This eliminates the complex race condition handling and lazy initialization

// NOTE: createMorphingZingOscillator is replaced by synthesizer-manager.js

// NOTE: Individual note playing and parameter updates are now handled by synthesizer-manager.js

// Simple tone playback (always sine wave, for tone column auditioning)
function playSimpleTone(frequency, duration = 200) {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.connect(gain);
    gain.connect(audioContext.destination);

    osc.frequency.value = frequency;
    osc.type = "sine";

    gain.gain.setValueAtTime(0.3, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(
        0.01,
        audioContext.currentTime + duration / 1000,
    );

    osc.start(audioContext.currentTime);
    osc.stop(audioContext.currentTime + duration / 1000);
}

// Audio utility functions
export function midiToFreq(midiNote) {
    return 440 * Math.pow(2, (midiNote - 69) / 12);
}

export function freqToMidi(freq) {
    return Math.round(69 + 12 * Math.log2(freq / 440));
}

export function getRootFrequency() {
    const mode = document.getElementById("rootMode").value;
    if (mode === "hz") {
        return parseFloat(document.getElementById("rootFreq").value);
    } else {
        const midiNote = parseInt(document.getElementById("rootMidi").value);
        return midiToFreq(midiNote);
    }
}

export async function playNote(
    frequency,
    duration = 200,
    portamentoTime = 0,
    previousFreq = null,
    appState = null
) {
    // Check synthesis mode preference
    const synthMode = appState?.params?.synthType || 'zing';
    
    // Use the selected synthesis mode
    if (synthMode === 'zing' && appState) {
        const morph = appState.params.morph || 0;
        const harmonicRatio = appState.params.harmonicRatio || 2;
        
        if (await playMorphingZingNote(frequency, duration, morph, harmonicRatio)) {
            return; // Successfully used Morphing Zing synthesis
        }
    } else if (synthMode === 'formant' && isFormantSynthReady() && appState) {
        const vowelX = appState.params.vowelX || 0.5;
        const vowelY = appState.params.vowelY || 0.5;
        
        if (playFormantNote(frequency, duration, vowelX, vowelY)) {
            return; // Successfully used formant synthesis
        }
    }
    
    // Fallback to sine wave synthesis
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.connect(gain);
    gain.connect(audioContext.destination);

    if (portamentoTime > 0 && previousFreq) {
        osc.frequency.setValueAtTime(previousFreq, audioContext.currentTime);
        osc.frequency.exponentialRampToValueAtTime(
            frequency,
            audioContext.currentTime + portamentoTime / 1000,
        );
    } else {
        osc.frequency.value = frequency;
    }
    osc.type = "sine";

    gain.gain.setValueAtTime(0.3, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(
        0.01,
        audioContext.currentTime + duration / 1000,
    );

    osc.start(audioContext.currentTime);
    osc.stop(audioContext.currentTime + duration / 1000);
}

// Playback functionality for individual tone columns
export function togglePlay(type, appState, currentData, playIntervals, playIndices) {
    const button = document.getElementById(
        `play${type.charAt(0).toUpperCase() + type.slice(1)}`,
    );

    if (playIntervals[type]) {
        clearInterval(playIntervals[type]);
        playIntervals[type] = null;
        playIndices[type] = 0;
        button.textContent = "|>";
        button.classList.remove("playing");
        document
            .querySelectorAll(`#${type}Tones .tone-item`)
            .forEach((item) => {
                item.classList.remove("playing");
            });
    } else {
        const tones = currentData[`${type}Tones`];
        const indices =
            type === "base"
                ? tones.map((_, i) => i)
                : type === "scale"
                  ? currentData.scaleIndices
                  : type === "chord"
                    ? currentData.chordIndices
                    : currentData.sequenceIndices;

        if (!tones || !indices || indices.length === 0) return;

        button.textContent = "||";
        button.classList.add("playing");

        const playNext = () => {
            // Get fresh data each time
            const currentTones = currentData[`${type}Tones`];
            const currentIndices =
                type === "base"
                    ? currentTones.map((_, i) => i)
                    : type === "scale"
                      ? currentData.scaleIndices
                      : type === "chord"
                        ? currentData.chordIndices
                        : currentData.sequenceIndices;

            if (!currentIndices || currentIndices.length === 0) {
                clearInterval(playIntervals[type]);
                playIntervals[type] = null;
                button.textContent = "|>";
                button.classList.remove("playing");
                return;
            }

            // Ensure index is within bounds
            if (playIndices[type] >= currentIndices.length) {
                playIndices[type] = 0;
            }

            const items = document.querySelectorAll(`#${type}Tones .tone-item`);
            items.forEach((item) => item.classList.remove("playing"));

            const currentIndex = currentIndices[playIndices[type]];
            if (items[currentIndex]) {
                items[currentIndex].classList.add("playing");
            }

            const freq = currentTones[currentIndex];
            if (freq > 0) {
                // Use simple sine wave for tone column playback (not the selected synthesis mode)
                playSimpleTone(freq, 180);
            }

            playIndices[type] =
                (playIndices[type] + 1) % currentIndices.length;
        };

        playNext();
        playIntervals[type] = setInterval(playNext, 200);
    }
}

// Helper function to calculate portamento time
export function calculatePortamentoTime(appState, step) {
    const hasPortamento = appState.playback.sequencePattern.portamento[step];
    if (!hasPortamento) return 0; // Immediate change for non-portamento steps
    
    const bpm = appState.params.bpm;
    const subdivision = appState.params.subdivision;
    const stepTimeSeconds = 60 / (bpm * subdivision);
    const portamentoPercentage = appState.params.portamentoTime / 100;
    let portamentoTime = stepTimeSeconds * portamentoPercentage;
    
    // Ensure the slide has time to finish before the next step begins
    const maxPortamentoTime = stepTimeSeconds - 0.01; // 10ms safety buffer
    return Math.min(portamentoTime, maxPortamentoTime);
}

// Real-time vowel updates for synthesizer
export function updateSynthVowel(appState, vowelPosition, rampTime = 0.005) {
    if (!vowelPosition) return;
    
    const { x: vowelX, y: vowelY } = vowelPosition;
    
    // Update mono oscillator if active (works for both formant and zing synths)
    if (appState.playback.monoOsc && appState.playback.monoOsc.setVowel && typeof appState.playback.monoOsc.setVowel === 'function') {
        appState.playback.monoOsc.setVowel(vowelX, vowelY, rampTime);
    }
    
    // Update formant synthesis parameters
    if (isFormantSynthReady()) {
        setFormantActive(vowelX, vowelY);
    }
}

// Audio step trigger functions (moved from state.js)
export function triggerMonoStep(appState, step, freq) {
    if (!appState.playback.monoOsc) return;

    const previousFreq = appState.playback.currentMonoFreq;
    const hasPortamento = appState.playback.sequencePattern.portamento[step];
    const now = window.audioContext.currentTime;

    // Get the frequency parameter from the new synthesizer manager interface
    let frequencyParam = null;
    
    if (appState.playback.monoOsc.node?.parameters) {
        // New synthesizer manager interface - access the underlying AudioWorkletNode
        frequencyParam = appState.playback.monoOsc.node.parameters.get('frequency');
    } else if (appState.playback.monoOsc.parameters) {
        // Legacy AudioWorkletNode interface
        frequencyParam = appState.playback.monoOsc.parameters.get('frequency');
    } else if (appState.playback.monoOsc.frequency) {
        // Standard OscillatorNode interface
        frequencyParam = appState.playback.monoOsc.frequency;
    }
    
    if (!frequencyParam) {
        console.warn('Unable to access frequency parameter for mono oscillator');
        return;
    }


    // Calculate portamento time using helper function
    const portamentoTime = calculatePortamentoTime(appState, step);
    
    // Use parameter coordinator for all frequency changes
    if (portamentoTime > 0) {
        updateFrequencyParam(frequencyParam, freq, portamentoTime, `portamento-step${step}`);
    } else {
        updateFrequencyParam(frequencyParam, freq, 0, `direct-step${step}`);
    }
    
    // Finally, update the application's state with the new target frequency.
    // This will be used as the starting point for the *next* step.
    appState.playback.currentMonoFreq = freq;
}


// Main sequence playback function using AudioWorklet scheduler
import { switchToSynthesizer, stopCurrentSynthesizer } from './synthesizer-manager.js';

// Simplified sequence playback using the new synthesizer manager
export async function playSequence(appState, generateSequencePattern, updateSequenceVisualization) {
    const button = document.getElementById("playSequence");
    
    // --- STOP LOGIC ---
    if (appState.playback.isPlaying) {
        sendToScheduler('stop');
        appState.playback.isPlaying = false;
        button.textContent = "|>";
        button.classList.remove("playing");

        // Clean shutdown with new system
        stopCurrentSynthesizer();
        appState.playback.monoOsc = null;
        appState.playback.currentMonoFreq = null;
        return;
    }

    // --- START LOGIC ---
    if (appState.playback.isInitializing) {
        console.warn("Already initializing, please wait.");
        return;
    }

    appState.playback.isInitializing = true;
    button.textContent = "Loading...";
    button.disabled = true;

    try {
        generateSequencePattern();
        if (!appState.playback.sequencePattern.steps || appState.playback.sequencePattern.steps.length === 0) {
            throw new Error("No sequence pattern generated.");
        }

        // --- SYNTHESIZER SWITCHING ---
        // Always mono mode - create sustained oscillator for portamento
        {
            const step0Freq = appState.playback.sequencePattern.steps[0] || 220;
            const synthType = 'vowel'; // Always use unified vowel synthesizer

            // Get vowel synthesizer parameters
            const synthParams = {
                vowelX: appState.params.vowelX || 0.5,
                vowelY: appState.params.vowelY || 0.5,
                synthBlend: appState.params.synthBlend || 0.5,
                morph: appState.params.morph || 0,
                symmetry: appState.params.symmetry || 0.5
            };

            // This single call replaces all the complex oscillator creation logic
            const monoOscillator = switchToSynthesizer(synthType, step0Freq, synthParams);
            
            // Auto-reconnect oscilloscope when synthesizer changes
            if (window.reconnectOscilloscopeIfNeeded) {
                window.reconnectOscilloscopeIfNeeded();
            }
            
            if (monoOscillator) {
                monoOscillator.start();
                appState.playback.monoOsc = monoOscillator;
                appState.playback.currentMonoFreq = step0Freq;
            } else {
                throw new Error(`Failed to create ${synthType} synthesizer`);
            }
        }

        // --- START THE SCHEDULER ---
        if (audioContext.state === 'suspended') await audioContext.resume();
        
        if (isSchedulerReady()) {
            sendToScheduler('play', {
                notePatternLength: appState.playback.sequencePattern.steps.length,
                phonemePatternLength: appState.playback.phonemePattern.vowels.length,
                bpm: appState.params.bpm,
                subdivision: appState.params.subdivision
            });
            appState.playback.isPlaying = true;
            button.textContent = "||";
        } else {
            throw new Error("AudioWorklet scheduler not ready.");
        }

    } catch (error) {
        console.error("Failed to start playback:", error);
        appState.playback.isPlaying = false;
        stopCurrentSynthesizer();
        appState.playback.monoOsc = null;
        button.textContent = "|>";
    } finally {
        appState.playback.isInitializing = false;
        button.disabled = false;
    }
}