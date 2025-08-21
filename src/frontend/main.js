// Import modules
import { AppState } from './state.js';
import { TonePipeline } from './toneGenerator.js';
import { generateToneData, orderTones } from './toneEngine.js';
import { euclideanRhythm, patternToIntervals, intervalsToPattern } from './euclidean.js';
import { audioContext, playNote, togglePlay, playSequence, getRootFrequency, midiToFreq, freqToMidi, triggerMonoStep, triggerPolyStep } from './audio.js';
import { populateMidiDropdown, displayColumn, updateSequenceVisualization, updateSequenceNotesMax, setupValueControls } from './ui.js';
import { initializeAudioWorklet, getSchedulerNode, sendToScheduler, isSchedulerReady, updateSchedulerCpm, updateSchedulerPattern } from './audio-worklet-service.js';

// Pattern utility functions are now imported from euclidean.js

// Global instances
const appState = new AppState();
const pipeline = new TonePipeline();

// Make globally available for compatibility
window.appState = appState;
window.pipeline = pipeline;
window.updateSequenceVisualization = () => updateSequenceVisualization(appState);

// Central coordination function (moved from AppState)
function triggerSequenceStep(step) {
    const freq = appState.playback.sequencePattern.steps[step];
    const mode = appState.params.synthMode;
    
    console.log(`🎵 STEP ${step}: mode=${mode}, freq=${freq}, pattern length=${appState.playback.sequencePattern.steps.length}`);
    
    if (!freq) return; // No frequency for this step
    
    if (mode === 'mono') {
        triggerMonoStep(appState, step, freq);
    } else {
        triggerPolyStep(appState, step, freq);
    }
}

// Controller functions (moved from ui.js)
function handleValueChange(display, value) {
    const target = display.id.replace('Value', '');
    
    // Update max values for dependent controls
    updateDependentControls(target, value);

    // Handle parameter changes
    handleControlChange(target, value);

    // Sync real-time parameters that don't need full tone regeneration
    if (['portamentoTime', 'attackTime', 'decayTime'].includes(target)) {
        appState.set(target, value);
    }

    // Only call generateTones for parameters that affect tone generation
    // Rotations and base/octaves are handled by handleControlChange -> updateTonesOnly
    if (
        ![
            'portamentoSteps',
            'portamentoRotation',
            'portamentoTime',
            'attackTime',
            'decayTime',
            'cpm',
            'scaleRotation',
            'chordRotation',
            'sequenceRotation',
            'sequenceBase',
            'sequenceOctaves',
        ].includes(target)
    ) {
        generateTones();
    }
}

function updateDependentControls(target, value) {
    if (target === "edo") {
        document.getElementById("scaleNotesValue").dataset.max = value;
        const scaleNotes = parseInt(
            document.getElementById("scaleNotesValue").textContent,
        );
        if (scaleNotes > value) {
            document.getElementById("scaleNotesValue").textContent = value;
        }
    } else if (target === "scaleNotes") {
        document.getElementById("scaleRotationValue").dataset.max = value - 1;
        document.getElementById("chordNotesValue").dataset.max = value;
        const rotation = parseInt(
            document.getElementById("scaleRotationValue").textContent,
        );
        if (rotation >= value) {
            document.getElementById("scaleRotationValue").textContent = 0;
        }
        const chordNotes = parseInt(
            document.getElementById("chordNotesValue").textContent,
        );
        if (chordNotes > value) {
            document.getElementById("chordNotesValue").textContent = value;
        }
    } else if (target === "chordNotes") {
        document.getElementById("chordRotationValue").dataset.max = value - 1;
        const rotation = parseInt(
            document.getElementById("chordRotationValue").textContent,
        );
        if (rotation >= value) {
            document.getElementById("chordRotationValue").textContent = 0;
        }
    } else if (target === "sequenceNotes") {
        document.getElementById("sequenceRotationValue").dataset.max = value - 1;
        const rotation = parseInt(
            document.getElementById("sequenceRotationValue").textContent,
        );
        if (rotation >= value) {
            document.getElementById("sequenceRotationValue").textContent = 0;
        }
    }
}

// Simplified parameter change handler using pure functions
function handleControlChange(paramName, newValue) {
    // Update the parameter immediately
    appState.set(paramName, newValue);
    
    if (paramName === 'cpm') {
        // ---- Tempo changes: Update AudioWorklet only ----
        updateSchedulerCpm(newValue);
    } else if (['portamentoSteps', 'portamentoRotation'].includes(paramName)) {
        // ---- Portamento: Update pattern only ----
        updatePortamentoPattern();
        updateSequenceVisualization(appState);
    } else {
        // ---- All other changes: Regenerate using pure functions ----
        regenerateEverything();
    }
}

// Regenerate all tone data and patterns using pure functions
function regenerateEverything() {
    // Get fresh tone data using pure functions
    const toneData = generateToneData(appState.params);
    
    // Update the old pipeline for compatibility (we'll remove this later)
    currentData = toneData;
    
    // Update display
    updateTonesDisplay(toneData);
    
    // Generate sequence pattern
    generateSequencePattern();
    updateSequenceVisualization(appState);
    
    // If playing, update the AudioWorklet with the new pattern
    if (appState.playback.isPlaying && appState.playback.sequencePattern.steps) {
        updateSchedulerPattern(
            appState.playback.sequencePattern.steps.length,
            appState.playback.sequencePattern.rhythm,
            appState.playback.sequencePattern.portamento
        );
    }
}


// Event-driven coordination - set up step change listener
appState.onChange('stepChange', (currentStep) => {
    triggerSequenceStep(currentStep);
    updateSequenceVisualization(appState);
});

// Compatibility layer - acts like the old currentData
let currentData = new Proxy(
    {},
    {
        get(target, prop) {
            if (prop === "sequenceIndices") {
                return pipeline.getCurrentData().sequenceIndices;
            }
            return pipeline.getCurrentData()[prop];
        },
    },
);

// Global variables replaced by appState.playback
// Compatibility getters for existing code
let playIntervals = {
    get base() {
        return appState.playback.playIntervals.base;
    },
    set base(val) {
        appState.playback.playIntervals.base = val;
    },
    get scale() {
        return appState.playback.playIntervals.scale;
    },
    set scale(val) {
        appState.playback.playIntervals.scale = val;
    },
    get chord() {
        return appState.playback.playIntervals.chord;
    },
    set chord(val) {
        appState.playback.playIntervals.chord = val;
    },
    get sequence() {
        return appState.playback.playIntervals.sequence;
    },
    set sequence(val) {
        appState.playback.playIntervals.sequence = val;
    },
};

let playIndices = {
    get base() {
        return appState.playback.playIndices.base;
    },
    set base(val) {
        appState.playback.playIndices.base = val;
    },
    get scale() {
        return appState.playback.playIndices.scale;
    },
    set scale(val) {
        appState.playback.playIndices.scale = val;
    },
    get chord() {
        return appState.playback.playIndices.chord;
    },
    set chord(val) {
        appState.playback.playIndices.chord = val;
    },
    get sequence() {
        return appState.playback.playIndices.sequence;
    },
    set sequence(val) {
        appState.playback.playIndices.sequence = val;
    },
};

// Direct references to appState - using property descriptors
Object.defineProperty(window, "sequencePattern", {
    get: () => appState.playback.sequencePattern,
    set: (val) => (appState.playback.sequencePattern = val),
});
Object.defineProperty(window, "sequenceInterval", {
    get: () => (appState.playback.isPlaying ? "playing" : null),
    set: (val) => {
        // Legacy compatibility - setting sequenceInterval doesn't make sense with AudioWorklet timing
        // This property now reflects the playing state
    },
});
Object.defineProperty(window, "monoOsc", {
    get: () => appState.playback.monoOsc,
    set: (val) => (appState.playback.monoOsc = val),
});
Object.defineProperty(window, "monoGain", {
    get: () => appState.playback.monoGain,
    set: (val) => (appState.playback.monoGain = val),
});
Object.defineProperty(window, "currentMonoFreq", {
    get: () => appState.playback.currentMonoFreq,
    set: (val) => (appState.playback.currentMonoFreq = val),
});

// Sequence generation functions
function generateSequencePattern() {
    const mode = document.getElementById("synthMode").value;
    const order = document.getElementById("sequenceOrder").value;

    let patternSteps, rhythmPulses, rhythmRotation, portamentoSteps, portamentoRotation;

    if (mode === "mono") {
        // Mono mode: steps = number of sequence tones, no rhythm pattern
        const activeToneCount = currentData.sequenceIndices
            ? currentData.sequenceIndices.length
            : 0;
        patternSteps = activeToneCount;
        rhythmPulses = patternSteps; // All steps active in mono
        rhythmRotation = 0;
        portamentoSteps = parseInt(
            document.getElementById("portamentoStepsValue").textContent,
        );
        portamentoRotation = parseInt(
            document.getElementById("portamentoRotationValue").textContent,
        );
    } else {
        // Poly mode: use UI values
        patternSteps = parseInt(
            document.getElementById("patternStepsValue").textContent,
        );
        rhythmPulses = parseInt(
            document.getElementById("rhythmPulsesValue").textContent,
        );
        rhythmRotation = parseInt(
            document.getElementById("rhythmRotationValue").textContent,
        );
        portamentoSteps = 0; // No portamento in poly mode
        portamentoRotation = 0;
    }

    // --- Start of new code ---
    // Dynamically update the max value of the portamento rotation control
    const portaRotationControl = document.getElementById('portamentoRotationValue');
    const newMax = Math.max(0, patternSteps - 1);
    portaRotationControl.dataset.max = newMax;

    // Clamp the current value if it's now out of bounds
    if (parseInt(portaRotationControl.textContent) > newMax) {
        portaRotationControl.textContent = newMax;
    }
    // --- End of new code ---

    // Get fresh sequence data using pure functions
    const freshData = currentData || generateToneData(appState.params);
    
    // Get active sequence tones (the selected subset from the expanded pool)
    const activeTones = [];
    if (freshData.sequenceTones && freshData.sequenceIndices) {
        // Collect tones in the order of sequenceIndices (preserves random selection order)
        freshData.sequenceIndices.forEach(index => {
            if (index < freshData.sequenceTones.length && freshData.sequenceTones[index] > 0) {
                activeTones.push(freshData.sequenceTones[index]);
            }
        });
    }

    if (activeTones.length === 0) {
        console.log(
            "No active tones found. Make sure to generate tones first.",
        );
        return;
    }

    console.log(
        `Generating pattern with ${activeTones.length} tones, mode: ${mode}`,
    );

    // Generate rhythm pattern using euclidean function
    let rhythm = euclideanRhythm(rhythmPulses, patternSteps);
    if (rhythmRotation > 0) {
        const canonicalIntervals = patternToIntervals(rhythm);
        if (canonicalIntervals.length > 0) {
            const rot = rhythmRotation % canonicalIntervals.length;
            const rotatedIntervals = [
                ...canonicalIntervals.slice(rot),
                ...canonicalIntervals.slice(0, rot)
            ];
            rhythm = intervalsToPattern(rotatedIntervals, patternSteps);
        }
    }

    // Generate portamento pattern using pattern shift rotation
    let portamento = new Array(patternSteps).fill(false);
    if (portamentoSteps > 0 && patternSteps > 0) {
        // Ensure portamento steps don't exceed pattern steps
        const actualPortamentoSteps = Math.min(
            portamentoSteps,
            patternSteps,
        );
        
        // 1. Generate the canonical, unrotated pattern
        const canonicalPattern = euclideanRhythm(
            actualPortamentoSteps,
            patternSteps,
        );

        if (portamentoRotation > 0 && canonicalPattern.length > 0) {
            // 2. This is the new "pattern shift" logic.
            // It slices the array at the rotation point and stitches it back together.
            const rot = portamentoRotation % canonicalPattern.length;
            portamento = [
                ...canonicalPattern.slice(rot),
                ...canonicalPattern.slice(0, rot)
            ];
        } else {
            // If rotation is 0, just use the original pattern
            portamento = canonicalPattern;
        }
    }

    // Generate note order
    const steps = [];
    let noteCounter = 0;

    if (mode === "mono") {
        // Mono: simple ordering of tones
        let orderedTones = [...activeTones];

        // Use pure ordering function with deterministic seed
        const seed = appState.get('randomSeed') + appState.get('synthMode').charCodeAt(0);
        orderedTones = orderTones(activeTones, order, seed);

        // In mono, all steps have notes (no rests)
        for (let i = 0; i < patternSteps; i++) {
            steps.push(orderedTones[i % orderedTones.length]);
        }

        // Update portamento steps max based on actual pattern steps
        document.getElementById("portamentoStepsValue").dataset.max =
            patternSteps;
        const currentPortamentoSteps = parseInt(
            document.getElementById("portamentoStepsValue").textContent,
        );
        if (currentPortamentoSteps > patternSteps) {
            document.getElementById("portamentoStepsValue").textContent =
                patternSteps;
        }
    } else {
        // Poly mode: use pure ordering function with deterministic seed
        const seed = appState.get('randomSeed') + appState.get('synthMode').charCodeAt(0);
        const orderedTones = orderTones(activeTones, order, seed);

        for (let i = 0; i < patternSteps; i++) {
            if (rhythm[i]) {
                // Use ordered tones cycling through the pattern
                const noteIndex = noteCounter % orderedTones.length;
                steps.push(orderedTones[noteIndex]);
                noteCounter++;
            } else {
                steps.push(null); // Rest
            }
        }
    }

    // Write directly to single source of truth
    appState.playback.sequencePattern = {
        steps,
        rhythm,
        portamento,
        currentStep: appState.playback.sequencePattern
            ? appState.playback.sequencePattern.currentStep
            : 0,
    };
    
    console.log(`🎵 PATTERN GENERATED: mode=${mode}, steps=[${steps.map(s => s ? s.toFixed(1) : 'null').join(', ')}], rhythm=[${rhythm.join(', ')}]`);
}

// Update only the portamento pattern without changing the note order
function updatePortamentoPattern() {
    if (
        !appState.playback.sequencePattern.steps ||
        appState.playback.sequencePattern.steps.length === 0
    ) {
        // If no sequence pattern exists yet, generate it first
        generateSequencePattern();
        if (
            !appState.playback.sequencePattern.steps ||
            appState.playback.sequencePattern.steps.length === 0
        ) {
            return;
        }
    }

    const patternSteps = appState.playback.sequencePattern.steps.length;
    const portamentoSteps = parseInt(
        document.getElementById("portamentoStepsValue").textContent,
    );
    const portamentoRotation = parseInt(
        document.getElementById("portamentoRotationValue").textContent,
    );

    // Generate new portamento pattern using pattern shift rotation
    let portamento = new Array(patternSteps).fill(false);
    if (portamentoSteps > 0 && patternSteps > 0) {
        // Ensure portamento steps don't exceed pattern steps
        const actualPortamentoSteps = Math.min(
            portamentoSteps,
            patternSteps,
        );
        
        // 1. Generate the canonical, unrotated pattern
        const canonicalPattern = euclideanRhythm(
            actualPortamentoSteps,
            patternSteps,
        );

        if (portamentoRotation > 0 && canonicalPattern.length > 0) {
            // 2. This is the new "pattern shift" logic.
            // It slices the array at the rotation point and stitches it back together.
            const rot = portamentoRotation % canonicalPattern.length;
            portamento = [
                ...canonicalPattern.slice(rot),
                ...canonicalPattern.slice(0, rot)
            ];
        } else {
            // If rotation is 0, just use the original pattern
            portamento = canonicalPattern;
        }
    }

    // Update only the portamento pattern, keep existing steps and rhythm
    appState.playback.sequencePattern.portamento = portamento;
}

// Function to update sequence playback when parameters change
function updateSequencePlayback() {
    // With AudioWorklet timing, changes are sent as messages to the scheduler
    // The AudioWorklet processor handles timing updates sample-accurately
    // No need to restart playback - timing updates smoothly in real-time
    if (appState.playback.isPlaying) {
        console.log("Sequence playback updated for new timing");
    }
}

// This function is no longer needed - we use regenerateEverything() instead

// These functions are no longer needed with the pure function approach

// Legacy function for compatibility - now uses pure functions
function generateTones() {
    // Sync all parameters from DOM to state
    appState.syncFromDOM();
    
    // Update root frequency from UI
    appState.set('rootFreq', getRootFrequency());

    // Use the new pure function approach
    regenerateEverything();
}

function updateTonesDisplay(data = null) {
    // Use provided data or generate fresh data
    if (!data) {
        data = generateToneData(appState.params);
    }

    // Reset play indices if the number of tones changed
    if (data.scaleIndices && playIndices.scale >= data.scaleIndices.length) {
        playIndices.scale = 0;
    }
    if (data.chordIndices && playIndices.chord >= data.chordIndices.length) {
        playIndices.chord = 0;
    }

    displayColumn("baseTones", data.baseTones, true, playNote);
    displayColumn("scaleTones", data.scaleTones, data.scaleIndices, playNote);
    displayColumn("chordTones", data.chordTones, data.chordIndices, playNote);
    displayColumn("sequenceTones", data.sequenceTones, data.sequenceIndices, playNote);

    // Update sequence notes max when chord tones change
    updateSequenceNotesMax(data);
}

function updateParams(params) {
    if (params.edo !== undefined) {
        document.getElementById("edoValue").textContent = params.edo;
    }
    if (params.rootFreq !== undefined) {
        document.getElementById("rootFreq").value = params.rootFreq;
    }
}

// Unified parameter update system
function updateParameter(paramName, value) {
    // Update AppState
    appState.set(paramName, value);

    // Update pipeline for tone-affecting parameters
    const toneParams = [
        "edo",
        "scaleNotes",
        "scaleRotation",
        "chordNotes",
        "chordRotation",
        "rootFreq",
        "sequenceNotes",
        "sequenceMethod",
        "sequenceBase",
        "sequenceOctaves",
        "sequenceRotation",
    ];
    if (toneParams.includes(paramName)) {
        pipeline.updateParam(paramName, value);
        updateTonesDisplay();
    }

    // Handle parameter updates that affect patterns/visualization
    if (
        [
            "cpm",
            "rhythmPulses",
            "rhythmRotation",
            "patternSteps",
            "portamentoSteps",
            "portamentoRotation",
            "sequenceOrder",
        ].includes(paramName)
    ) {
        handleControlChange(paramName, value);
    }
}


// Event listeners setup
document.getElementById("rootMode").onchange = (e) => {
    const mode = e.target.value;
    if (mode === "hz") {
        document.getElementById("rootFreq").style.display = "inline";
        document.getElementById("rootMidi").style.display = "none";
        const midiNote = parseInt(document.getElementById("rootMidi").value);
        document.getElementById("rootFreq").value =
            midiToFreq(midiNote).toFixed(2);
    } else {
        document.getElementById("rootFreq").style.display = "none";
        document.getElementById("rootMidi").style.display = "inline";
        const freq = parseFloat(document.getElementById("rootFreq").value);
        const midiNote = freqToMidi(freq);
        document.getElementById("rootMidi").value = midiNote;
    }
    generateTones();
};

document.getElementById("rootFreq").oninput = (e) => {
    generateTones();
};

document.getElementById("rootMidi").onchange = (e) => {
    generateTones();
};

document.getElementById("sequenceMethod").onchange = (e) => {
    const method = e.target.value;
    const rotationControl = document.getElementById("sequenceRotationControl");
    const randomizeControl = document.getElementById(
        "sequenceRandomizeControl",
    );

    if (method === "euclidean") {
        rotationControl.style.display = "block";
        randomizeControl.style.display = "none";
    } else if (method === "random") {
        rotationControl.style.display = "none";
        randomizeControl.style.display = "block";
    }
    generateTones();
};

// Update sequence pattern when order changes
document.getElementById("sequenceOrder").onchange = (e) => {
    const order = e.target.value;
    // Show/hide reshuffle button
    const reshuffleControl = document.getElementById("sequenceShuffleControl");
    if (order === "shuffle") {
        reshuffleControl.style.display = "block";
    } else {
        reshuffleControl.style.display = "none";
    }

    if (appState.playback.isPlaying) {
        generateSequencePattern();
        updateSequenceVisualization(appState);
    }
};

document.getElementById("synthMode").onchange = (e) => {
    const mode = e.target.value;

    // Show/hide appropriate controls
    document.querySelectorAll(".mono-only").forEach((el) => {
        el.style.display = mode === "mono" ? "block" : "none";
    });
    document.querySelectorAll(".poly-only").forEach((el) => {
        el.style.display = mode === "poly" ? "block" : "none";
    });

    // Hide pattern steps for mono (automatic)
    document.getElementById("patternStepsControl").style.display =
        mode === "mono" ? "none" : "block";

    // Stop any playing sequence and clean up mono oscillator
    if (appState.playback.isPlaying) {
        // Force stop the AudioWorklet
        sendToScheduler('stop');
        appState.playback.isPlaying = false;
        
        // Clean up mono oscillator if it exists
        if (appState.playback.monoOsc) {
            appState.playback.monoOsc.stop();
            appState.playback.monoOsc = null;
            appState.playback.monoGain = null;
            appState.playback.currentMonoFreq = null;
        }
        
        // Update UI
        const button = document.getElementById("playSequence");
        button.textContent = "▶ Play";
        button.classList.remove("playing");
    }
    
    // Always regenerate and update visualization when switching modes
    generateTones();
    generateSequencePattern();
    updateSequenceVisualization(appState);
};

// Button event listeners
document.getElementById("playBase").onclick = () => 
    togglePlay("base", appState, currentData, playIntervals, playIndices);
document.getElementById("playScale").onclick = () => 
    togglePlay("scale", appState, currentData, playIntervals, playIndices);
document.getElementById("playChord").onclick = () => 
    togglePlay("chord", appState, currentData, playIntervals, playIndices);
document.getElementById("playSequenceTones").onclick = () =>
    togglePlay("sequence", appState, currentData, playIntervals, playIndices);

document.getElementById("playSequence").onclick = () =>
    playSequence(appState, generateSequencePattern, () => updateSequenceVisualization(appState));

// Reshuffle button
document.getElementById("reshuffleButton").onclick = () => {
    // Generate new random seed for fresh shuffle
    const newSeed = Math.floor(Math.random() * 1000000);
    appState.set('randomSeed', newSeed);

    // Always regenerate pattern and visualization
    generateSequencePattern();
    updateSequenceVisualization(appState);
};

// Randomize button for random sequence method
document.getElementById("randomizeSequence").onclick = () => {
    // Generate new random seed for fresh randomization
    const newSeed = Math.floor(Math.random() * 1000000);
    appState.set('randomSeed', newSeed);

    // Regenerate everything with the new seed
    regenerateEverything();
};

// Initialize application with state synchronization
async function initializeApp() {
    // Sync state from DOM
    appState.syncFromDOM();

    // Initialize AudioWorklet scheduler
    await initializeAudioWorklet();
    
    // Set up worklet message handling
    const schedulerNode = getSchedulerNode();
    if (schedulerNode) {
        schedulerNode.port.onmessage = (event) => {
            const { type, payload } = event.data;
            if (type === 'stepChange') {
                // console.log(`🎵 WORKLET STEP: ${payload.step} at audio time ${payload.audioTimeElapsed.toFixed(3)}s (phasor: ${payload.phasor.toFixed(3)})`);
                
                // Update state and trigger audio/visual updates
                appState.playback.sequencePattern.currentStep = payload.step;
                triggerSequenceStep(payload.step);
                updateSequenceVisualization(appState);
            }
        };
        console.log('🎵 AudioWorklet message handler set up');
    } else {
        console.warn('⚠️ AudioWorklet not available, falling back to animation frame timing');
    }

    // Generate initial tone data using pure functions
    currentData = generateToneData(appState.params);

    // Initialize reshuffle button visibility
    const sequenceOrder = document.getElementById("sequenceOrder").value;
    const reshuffleControl = document.getElementById("sequenceShuffleControl");
    if (sequenceOrder === "shuffle") {
        reshuffleControl.style.display = "block";
    } else {
        reshuffleControl.style.display = "none";
    }

    // Initialize randomize button visibility based on sequence method
    const sequenceMethod = document.getElementById("sequenceMethod").value;
    const rotationControl = document.getElementById("sequenceRotationControl");
    const randomizeControl = document.getElementById(
        "sequenceRandomizeControl",
    );
    if (sequenceMethod === "euclidean") {
        rotationControl.style.display = "block";
        randomizeControl.style.display = "none";
    } else if (sequenceMethod === "random") {
        rotationControl.style.display = "none";
        randomizeControl.style.display = "block";
    }

    updateTonesDisplay();

    // Generate initial sequence pattern and visualization
    generateSequencePattern();
    updateSequenceVisualization(appState);
}

// Initialize everything
populateMidiDropdown();
setupValueControls(handleValueChange);

// Initialize mode display
document.getElementById("synthMode").dispatchEvent(new Event("change"));

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
        setTimeout(initializeApp, 100);
    });
} else {
    setTimeout(initializeApp, 100);
}