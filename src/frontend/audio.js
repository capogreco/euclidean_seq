// Import AudioWorklet service for scheduling
import { sendToScheduler, isSchedulerReady } from './audio-worklet-service.js';

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
) {
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
                playNote(freq, 180);
            }

            playIndices[type] =
                (playIndices[type] + 1) % currentIndices.length;
        };

        playNext();
        playIntervals[type] = setInterval(playNext, 200);
    }
}

// Audio step trigger functions (moved from state.js)
export function triggerMonoStep(appState, step, freq) {
    if (!appState.playback.monoOsc) return;

    const hasPortamento = appState.playback.sequencePattern.portamento[step];
    const now = window.audioContext.currentTime;
    
    console.log(`🎶 MONO STEP ${step}: freq=${freq.toFixed(1)}Hz, portamento=${hasPortamento}, audio time: ${now.toFixed(3)}s`);

    if (
        hasPortamento &&
        appState.playback.currentMonoFreq &&
        appState.playback.currentMonoFreq !== freq
    ) {
        appState.playback.monoOsc.frequency.cancelScheduledValues(now);
        const currentFreq = appState.playback.monoOsc.frequency.value;
        appState.playback.monoOsc.frequency.setValueAtTime(currentFreq, now);
        // Calculate portamento time as percentage of step length
        const cpm = appState.params.cpm;
        const patternLength = appState.playback.sequencePattern.steps.length;
        const cycleTimeSeconds = 60 / cpm; // One complete cycle time in seconds
        const stepTimeSeconds = cycleTimeSeconds / patternLength; // Time per step
        const portamentoPercentage = appState.params.portamentoTime / 100; // Convert percentage to decimal
        const portamentoTime = stepTimeSeconds * portamentoPercentage;
        
        console.log(`🎶 PORTAMENTO: ${appState.params.portamentoTime}% of ${stepTimeSeconds.toFixed(3)}s step = ${portamentoTime.toFixed(3)}s`);

        // Use exponential ramp for musical intervals, linear ramp as fallback
        try {
            if (currentFreq > 0 && freq > 0) {
                appState.playback.monoOsc.frequency.exponentialRampToValueAtTime(
                    freq,
                    now + portamentoTime,
                );
            } else {
                appState.playback.monoOsc.frequency.linearRampToValueAtTime(
                    freq,
                    now + portamentoTime,
                );
            }
        } catch (e) {
            // Fallback to linear ramp if exponential fails
            appState.playback.monoOsc.frequency.linearRampToValueAtTime(
                freq,
                now + portamentoTime,
            );
        }
    } else {
        // Non-portamento step: cancel any ongoing portamento and jump immediately
        appState.playback.monoOsc.frequency.cancelScheduledValues(now);
        appState.playback.monoOsc.frequency.setValueAtTime(
            appState.playback.monoOsc.frequency.value,
            now,
        );
        appState.playback.monoOsc.frequency.setValueAtTime(freq, now);
    }
    appState.playback.currentMonoFreq = freq;
}

export function triggerPolyStep(appState, step, freq) {
    const attackTime = appState.params.attackTime;
    const decayTime = appState.params.decayTime;

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
        // Create persistent oscillator for mono mode
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

        console.log(`🎤 MONO OSC CREATED: Starting at audio time ${audioContext.currentTime.toFixed(3)}s with step 0 freq ${monoOsc.frequency.value.toFixed(1)}Hz`);

        monoOsc.start();

        // Store in AppState
        appState.playback.monoOsc = monoOsc;
        appState.playback.monoGain = monoGain;
    }

    // Resume audio context if suspended (required for Chrome)
    if (audioContext.state === 'suspended') {
        console.log('🎵 Resuming suspended audio context...');
        await audioContext.resume();
    }
    
    // Start the AudioWorklet scheduler with pattern parameters
    if (isSchedulerReady()) {
        sendToScheduler('play', {
            patternLength: appState.playback.sequencePattern.steps.length,
            cpm: appState.params.cpm
        });
        appState.playback.isPlaying = true;
        console.log(`🎵 AUDIO WORKLET PLAY: ${appState.playback.sequencePattern.steps.length} steps at ${appState.params.cpm} CPM, context state: ${audioContext.state}`);
    } else {
        console.error('❌ AudioWorklet scheduler not ready, cannot start playback');
        button.textContent = "▶ Play";
        button.classList.remove("playing");
    }
}