// Import modules
import { AppState } from './state.js';
import { TonePipeline, euclideanRhythm } from './toneGenerator.js';
import { audioContext, playNote, togglePlay, playSequence, getRootFrequency, midiToFreq, freqToMidi, triggerMonoStep, triggerPolyStep } from './audio.js';
import { populateMidiDropdown, displayColumn, updateSequenceVisualization, updateSequenceNotesMax, setupValueControls } from './ui.js';
import { initializeAudioWorklet, getSchedulerNode, sendToScheduler, isSchedulerReady, updateSchedulerCpm, updateSchedulerPattern } from './audio-worklet-service.js';

// Import interval-based rotation utilities
// Note: In JavaScript, we need to work around the .ts import limitation
const patternToIntervals = (pattern) => {
    const trueIndices = pattern.map((val, idx) => val ? idx : -1)
                             .filter(idx => idx !== -1);
    
    if (trueIndices.length < 2) return [];
    
    const intervals = [];
    for (let i = 0; i < trueIndices.length - 1; i++) {
        intervals.push(trueIndices[i + 1] - trueIndices[i]);
    }
    
    const lastIndex = trueIndices[trueIndices.length - 1];
    const firstIndex = trueIndices[0];
    const wrapInterval = (pattern.length - lastIndex) + firstIndex;
    intervals.push(wrapInterval);
    
    return intervals;
};

const intervalsToPattern = (intervals, steps) => {
    const pattern = new Array(steps).fill(false);
    
    if (intervals.length === 0) return pattern;
    
    pattern[0] = true;
    let currentPos = 0;
    
    for (let i = 0; i < intervals.length - 1; i++) {
        currentPos = (currentPos + intervals[i]) % steps;
        pattern[currentPos] = true;
    }
    
    return pattern;
};

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
    if (
        ![
            'portamentoSteps',
            'portamentoRotation',
            'portamentoTime',
            'attackTime',
            'decayTime',
            'cpm',
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

// Unified parameter change handler - all changes are immediate!
function handleControlChange(paramName, newValue) {
    // Update the parameter immediately
    appState.set(paramName, newValue);
    
    if (paramName === 'cpm') {
        // ---- Tempo changes: Update AudioWorklet ----
        updateSchedulerCpm(newValue);
        console.log(`🎵 CPM: ${newValue}`);
        
    } else if (['scaleRotation', 'chordRotation', 'sequenceRotation'].includes(paramName)) {
        // ---- Tuning rotations: Update tones without reshuffling sequence ----
        updateTonesOnly();
        updateSequenceVisualization(appState);
        console.log(`🎵 TUNING: ${paramName} = ${newValue}`);
        
    } else if (['portamentoSteps', 'portamentoRotation'].includes(paramName)) {
        // ---- Portamento: Update pattern without reshuffling sequence ----
        updatePortamentoPattern();
        updateSequenceVisualization(appState);
        console.log(`🎵 PORTAMENTO: ${paramName} = ${newValue}`);
        
    } else {
        // ---- All other changes: Full regeneration ----
        generateTones();
        generateSequencePattern();
        updateSequenceVisualization(appState);
        
        // If playing, update the AudioWorklet with the new pattern length
        if (appState.playback.isPlaying && appState.playback.sequencePattern.steps) {
            updateSchedulerPattern(
                appState.playback.sequencePattern.steps.length,
                appState.playback.sequencePattern.rhythm,
                appState.playback.sequencePattern.portamento
            );
        }
        console.log(`🎵 REGENERATED: ${paramName} = ${newValue}`);
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

    // Get active sequence tones (the selected subset from the expanded pool)
    const activeTones = [];
    if (currentData.sequenceTones && currentData.sequenceIndices) {
        // Collect all non-zero tones in order
        for (let i = 0; i < currentData.sequenceTones.length; i++) {
            if (
                currentData.sequenceTones[i] > 0 &&
                currentData.sequenceIndices.includes(i)
            ) {
                activeTones.push(currentData.sequenceTones[i]);
            }
        }
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

    // Generate rhythm pattern using interval-based rotation
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

        // Use pipeline ordering method
        orderedTones = pipeline.orderTones(activeTones, order);

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
        // Poly mode: use pipeline ordering
        const orderedTones = pipeline.orderTones(activeTones, order);

        for (let i = 0; i < patternSteps; i++) {
            if (rhythm[i]) {
                // Use ordered tones for all modes (except random which needs special handling)
                let noteIndex;
                if (order === "random") {
                    noteIndex = Math.floor(
                        Math.random() * orderedTones.length,
                    );
                    steps.push(orderedTones[noteIndex]);
                } else {
                    noteIndex = noteCounter % orderedTones.length;
                    steps.push(orderedTones[noteIndex]);
                    noteCounter++;
                }
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

// Update tones only without regenerating sequence pattern (avoids reshuffling)
function updateTonesOnly() {
    // Update pipeline with current state
    pipeline.updateParam("edo", appState.get("edo"));
    pipeline.updateParam("scaleNotes", appState.get("scaleNotes"));
    pipeline.updateParam("scaleRotation", appState.get("scaleRotation"));
    pipeline.updateParam("chordNotes", appState.get("chordNotes"));
    pipeline.updateParam("chordRotation", appState.get("chordRotation"));
    pipeline.updateParam("rootFreq", getRootFrequency());
    pipeline.updateParam("sequenceNotes", appState.get("sequenceNotes"));
    pipeline.updateParam("sequenceMethod", appState.get("sequenceMethod"));
    pipeline.updateParam("sequenceBase", appState.get("sequenceBase"));
    pipeline.updateParam("sequenceOctaves", appState.get("sequenceOctaves"));
    pipeline.updateParam("sequenceRotation", appState.get("sequenceRotation"));

    updateTonesDisplay();
    
    // Update sequence pattern frequencies without changing note order
    updateSequenceFrequencies();
}

// Update the frequencies in the existing sequence pattern without changing the order
function updateSequenceFrequencies() {
    if (!appState.playback.sequencePattern.steps || appState.playback.sequencePattern.steps.length === 0) {
        return; // No pattern to update
    }
    
    // Get the current sequence data from pipeline to get updated frequencies
    const data = pipeline.getCurrentData();
    
    if (!data.sequenceTones || !data.sequenceIndices) {
        return; // No sequence data available
    }
    
    // Get the currently playing sequence
    const currentSteps = appState.playback.sequencePattern.steps;
    
    // Get active sequence tones (the selected subset with updated tuning)
    const activeTones = [];
    for (let i = 0; i < data.sequenceTones.length; i++) {
        if (data.sequenceTones[i] > 0 && data.sequenceIndices.includes(i)) {
            activeTones.push(data.sequenceTones[i]);
        }
    }
    
    if (activeTones.length === 0) {
        return; // No tones to work with
    }
    
    // Update each step: if it was a note, keep it as a note from the new tone set
    // The key insight: preserve the rhythmic pattern and note succession, just update pitches
    const updatedSteps = [];
    let noteCounter = 0;
    
    for (let i = 0; i < currentSteps.length; i++) {
        const currentStep = currentSteps[i];
        if (currentStep === null || currentStep === 0) {
            // Keep rests as rests
            updatedSteps.push(currentStep);
        } else {
            // Replace with new tone, maintaining the same position in the sequence
            const toneIndex = noteCounter % activeTones.length;
            updatedSteps.push(activeTones[toneIndex]);
            noteCounter++;
        }
    }
    
    // Update the pattern with new frequencies, preserving rhythm and portamento
    appState.playback.sequencePattern.steps = updatedSteps;
    
    console.log(`🎵 UPDATED FREQUENCIES: Preserved pattern structure, updated ${noteCounter} notes to new tuning`);
}

// Legacy function for compatibility
function generateTones() {
    // Sync all parameters from DOM to state and pipeline
    appState.syncFromDOM();

    // Update pipeline with current state
    pipeline.updateParam("edo", appState.get("edo"));
    pipeline.updateParam("scaleNotes", appState.get("scaleNotes"));
    pipeline.updateParam("scaleRotation", appState.get("scaleRotation"));
    pipeline.updateParam("chordNotes", appState.get("chordNotes"));
    pipeline.updateParam("chordRotation", appState.get("chordRotation"));
    pipeline.updateParam("rootFreq", getRootFrequency());
    pipeline.updateParam("sequenceNotes", appState.get("sequenceNotes"));
    pipeline.updateParam("sequenceMethod", appState.get("sequenceMethod"));
    pipeline.updateParam("sequenceBase", appState.get("sequenceBase"));
    pipeline.updateParam("sequenceOctaves", appState.get("sequenceOctaves"));
    pipeline.updateParam("sequenceRotation", appState.get("sequenceRotation"));

    updateTonesDisplay();

    // Always generate and visualize the sequence pattern
    const currentStep = appState.playback.sequencePattern
        ? appState.playback.sequencePattern.currentStep
        : 0;
    generateSequencePattern();
    updateSequenceVisualization(appState);
}

function updateTonesDisplay() {
    const data = pipeline.getCurrentData();

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
    // Force a new shuffle using pipeline method
    pipeline.reshuffle();

    // Always regenerate pattern and visualization
    generateSequencePattern();
    updateSequenceVisualization(appState);
};

// Randomize button for random sequence method
document.getElementById("randomizeSequence").onclick = () => {
    // Force regeneration of random sequence tones by clearing any cached selections
    pipeline.clearShuffleCache();

    // Regenerate the sequence tones - this will automatically update pattern and visualization
    generateTones();
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
                console.log(`🎵 WORKLET STEP: ${payload.step} at audio time ${payload.audioTimeElapsed.toFixed(3)}s (phasor: ${payload.phasor.toFixed(3)})`);
                
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

    // Update pipeline with initial parameters
    pipeline.updateParam("edo", appState.get("edo"));
    pipeline.updateParam("scaleNotes", appState.get("scaleNotes"));
    pipeline.updateParam("scaleRotation", appState.get("scaleRotation"));
    pipeline.updateParam("chordNotes", appState.get("chordNotes"));
    pipeline.updateParam("chordRotation", appState.get("chordRotation"));
    pipeline.updateParam("rootFreq", appState.get("rootFreq"));
    pipeline.updateParam("sequenceNotes", appState.get("sequenceNotes"));
    pipeline.updateParam("sequenceMethod", appState.get("sequenceMethod"));
    pipeline.updateParam("sequenceBase", appState.get("sequenceBase"));
    pipeline.updateParam("sequenceOctaves", appState.get("sequenceOctaves"));
    pipeline.updateParam("sequenceRotation", appState.get("sequenceRotation"));

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