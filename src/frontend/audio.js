// Import AudioWorklet services
import { sendToScheduler, isSchedulerReady } from './audio-worklet-service.js';
import { 
    initializeFormantSynth, 
    playFormantNote, 
    createFormantOscillator, 
    isFormantSynthReady,
    setFormantActive 
} from './formant-synth-service.js';

// Audio context initialization
export const audioContext = new (window.AudioContext || window.webkitAudioContext)();

// Make audioContext globally available
window.audioContext = audioContext;

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

export function playNote(
    frequency,
    duration = 200,
    portamentoTime = 0,
    previousFreq = null,
    appState = null
) {
    // Try to use formant synthesis if available
    if (isFormantSynthReady() && appState) {
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
        button.textContent = "▶ Play";
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

        button.textContent = "■ Stop";
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
                button.textContent = "▶ Play";
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
                playNote(freq, 180, 0, null, appState);
            }

            playIndices[type] =
                (playIndices[type] + 1) % currentIndices.length;
        };

        playNext();
        playIntervals[type] = setInterval(playNext, 200);
    }
}

// Real-time vowel updates for synthesizer
export function updateSynthVowel(appState, vowelPosition) {
    if (!vowelPosition) return;
    
    const { x: vowelX, y: vowelY } = vowelPosition;
    
    // Update mono oscillator if active
    if (appState.playback.monoOsc && appState.playback.monoOsc.setVowel && typeof appState.playback.monoOsc.setVowel === 'function') {
        appState.playback.monoOsc.setVowel(vowelX, vowelY);
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

    // Determine the correct AudioParam for frequency based on the oscillator type.
    const frequencyParam = appState.playback.monoOsc.parameters 
        ? appState.playback.monoOsc.parameters.get('frequency')  // For AudioWorkletNode
        : appState.playback.monoOsc.frequency;                   // For standard OscillatorNode

    if (hasPortamento && previousFreq && previousFreq !== freq) {
        // --- CORRECT PORTAMENTO IMPLEMENTATION ---

        // 1. Clear any scheduled changes from this point forward. This creates a clean slate.
        frequencyParam.cancelScheduledValues(now);
        
        // 2. Explicitly set the starting point of the ramp to the previous note's frequency.
        // This is the most critical step: it anchors the slide's start, preventing the audible "jump".
        frequencyParam.setValueAtTime(previousFreq, now);

        // 3. Calculate the duration of the portamento slide based on BPM and subdivision.
        const bpm = appState.params.bpm;
        const subdivision = appState.params.subdivision;
        const stepTimeSeconds = 60 / (bpm * subdivision);
        const portamentoPercentage = appState.params.portamentoTime / 100;
        let portamentoTime = stepTimeSeconds * portamentoPercentage;
        
        // 4. Ensure the slide has time to finish before the next step begins.
        const maxPortamentoTime = stepTimeSeconds - 0.01; // 10ms safety buffer
        portamentoTime = Math.min(portamentoTime, maxPortamentoTime);
        
        // 5. Schedule the smooth pitch slide to the new target frequency.
        frequencyParam.linearRampToValueAtTime(freq, now + portamentoTime);

    } else {
        // --- NON-PORTAMENTO IMPLEMENTATION ---
        // For notes without portamento, cancel any ongoing slides and jump immediately to the new frequency.
        frequencyParam.cancelScheduledValues(now);
        frequencyParam.setValueAtTime(freq, now);
    }
    
    // Finally, update the application's state with the new target frequency.
    // This will be used as the starting point for the *next* step.
    appState.playback.currentMonoFreq = freq;
}

export function triggerPolyStep(appState, step, freq) {
    const attackTime = appState.params.attackTime;
    const decayTime = appState.params.decayTime;
    
    // Try to use formant synthesis for poly steps
    if (isFormantSynthReady()) {
        // Use fallback vowel values for poly steps (current app state)
        const vowelX = appState.params.vowelX || 0.5;
        const vowelY = appState.params.vowelY || 0.5;
        
        const duration = attackTime + decayTime;
        
        if (playFormantNote(freq, duration, vowelX, vowelY)) {
            return; // Successfully used formant synthesis
        }
    }
    
    // Fallback to sine wave synthesis
    const osc = window.audioContext.createOscillator();
    const gain = window.audioContext.createGain();

    osc.connect(gain);
    gain.connect(window.audioContext.destination);

    osc.frequency.value = freq;
    osc.type = "sine";

    gain.gain.setValueAtTime(0, window.audioContext.currentTime);
    gain.gain.linearRampToValueAtTime(
        0.3,
        window.audioContext.currentTime + attackTime / 1000,
    );
    gain.gain.exponentialRampToValueAtTime(
        0.01,
        window.audioContext.currentTime + (attackTime + decayTime) / 1000,
    );

    osc.start(window.audioContext.currentTime);
    osc.stop(
        window.audioContext.currentTime + (attackTime + decayTime) / 1000,
    );
}

// Main sequence playback function using AudioWorklet scheduler
export async function playSequence(appState, generateSequencePattern, updateSequenceVisualization) {
    const button = document.getElementById("playSequence");
    const mode = document.getElementById("synthMode").value;

    // Check if we're currently playing
    if (appState.playback.isPlaying) {
        // Stop the AudioWorklet scheduler
        sendToScheduler('stop');
        appState.playback.isPlaying = false;

        // Clean up UI
        button.textContent = "▶ Play";
        button.classList.remove("playing");
        updateSequenceVisualization();

        // Stop mono oscillator if running
        if (mode === "mono" && appState.playback.monoOsc) {
            appState.playback.monoOsc.stop();
            appState.playback.monoOsc = null;
            appState.playback.monoGain = null;
            appState.playback.currentMonoFreq = null;
        }
        return;
    }

    // Generate sequence pattern
    generateSequencePattern();

    if (
        !appState.playback.sequencePattern.steps ||
        appState.playback.sequencePattern.steps.length === 0
    ) {
        console.log("No sequence pattern generated");
        return;
    }

    button.textContent = "■ Stop";
    button.classList.add("playing");

    if (mode === "mono") {
        // Try to use formant synthesis for mono mode
        if (isFormantSynthReady()) {
            const step0Freq = appState.playback.sequencePattern.steps[0] || 220;
            const vowelX = appState.params.vowelX || 0.5;
            const vowelY = appState.params.vowelY || 0.5;
            
            // Create formant oscillator interface
            const formantOsc = createFormantOscillator(step0Freq, vowelX, vowelY);
            if (formantOsc) {
                formantOsc.start();
                appState.playback.monoOsc = formantOsc;
                appState.playback.currentMonoFreq = step0Freq;
                
                console.log(`🎤 FORMANT OSC CREATED: Starting at audio time ${audioContext.currentTime.toFixed(3)}s with step 0 freq ${step0Freq.toFixed(1)}Hz`);
            } else {
                // Fallback to sine if formant creation failed
                createSineOscillator();
            }
        } else {
            // Fallback to sine oscillator
            createSineOscillator();
        }
        
        function createSineOscillator() {
            const monoOsc = audioContext.createOscillator();
            const monoGain = audioContext.createGain();

            monoOsc.connect(monoGain);
            monoGain.connect(audioContext.destination);

            monoOsc.type = "sine";
            monoGain.gain.value = 0.3;

            // Set initial frequency to step 0 frequency immediately
            const step0Freq = appState.playback.sequencePattern.steps[0];
            if (step0Freq) {
                monoOsc.frequency.value = step0Freq;
                appState.playback.currentMonoFreq = step0Freq;
            }

            console.log(`🎤 SINE OSC CREATED: Starting at audio time ${audioContext.currentTime.toFixed(3)}s with step 0 freq ${monoOsc.frequency.value.toFixed(1)}Hz`);

            monoOsc.start();

            // Store in AppState
            appState.playback.monoOsc = monoOsc;
            appState.playback.monoGain = monoGain;
        }
    }

    // Resume audio context if suspended (required for Chrome)
    if (audioContext.state === 'suspended') {
        console.log('🎵 Resuming suspended audio context...');
        await audioContext.resume();
    }
    
    // Start the AudioWorklet scheduler with pattern parameters
    if (isSchedulerReady()) {
        sendToScheduler('play', {
            notePatternLength: appState.playback.sequencePattern.steps.length,
            phonemePatternLength: appState.playback.phonemePattern.vowels.length,
            bpm: appState.params.bpm,
            subdivision: appState.params.subdivision
        });
        appState.playback.isPlaying = true;
        console.log(`🎵 AUDIO WORKLET PLAY: note=${appState.playback.sequencePattern.steps.length} steps, phoneme=${appState.playback.phonemePattern.vowels.length} steps at ${appState.params.bpm} BPM (${appState.params.subdivision} subdivision), context state: ${audioContext.state}`);
    } else {
        console.error('❌ AudioWorklet scheduler not ready, cannot start playback');
        button.textContent = "▶ Play";
        button.classList.remove("playing");
    }
}