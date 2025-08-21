// Import modules
import { AppState } from './state.js';
import { TonePipeline } from './toneGenerator.js';
import { generateToneData, orderTones } from './toneEngine.js';
import { euclideanRhythm, patternToIntervals, intervalsToPattern } from './euclidean.js';
import { audioContext, playNote, togglePlay, playSequence, getRootFrequency, midiToFreq, freqToMidi, triggerMonoStep, triggerPolyStep, updateSynthVowel } from './audio.js';
import { populateMidiDropdown, displayColumn, updateSequenceVisualization, updateSequenceNotesMax, setupValueControls } from './ui.js';
import { initializeAudioWorklet, getSchedulerNode, sendToScheduler, isSchedulerReady, updateSchedulerBpm, updateSchedulerSubdivision, updateSchedulerPatterns } from './audio-worklet-service.js';
import { initializeFormantSynth, setVowelPosition, isFormantSynthReady } from './formant-synth-service.js';

// Pattern utility functions are now imported from euclidean.js

// Global instances
const appState = new AppState();
const pipeline = new TonePipeline();

// Make globally available for compatibility
window.appState = appState;
window.pipeline = pipeline;
window.updateSequenceVisualization = () => updateSequenceVisualization(appState);

// Get vowel position for current step
function getCurrentVowelPosition(step) {
    const vowelPreset = document.getElementById("vowelPreset").value;
    
    // If using manual vowel setting, return that
    if (vowelPreset !== "sequence") {
        const vowelPositions = {
            'a': { x: 0.8, y: 0.9 },  // /a/ - back, open
            'e': { x: 0.7, y: 0.4 },  // /e/ - front-central, mid
            'i': { x: 1.0, y: 0.1 },  // /i/ - front, close
            'o': { x: 0.2, y: 0.4 },  // /o/ - back, mid
            'u': { x: 0.0, y: 0.1 }   // /u/ - back, close
        };
        return vowelPositions[vowelPreset] || { x: 0.5, y: 0.5 };
    }
    
    // Use phoneme sequence
    const phonemePattern = appState.playback.phonemePattern;
    if (!phonemePattern.positions || phonemePattern.positions.length === 0) {
        return { x: 0.5, y: 0.5 }; // Default vowel position
    }
    
    // Map sequence step to phoneme step
    const phonemeStep = step % phonemePattern.positions.length;
    return phonemePattern.positions[phonemeStep];
}

// Legacy function - no longer used (replaced by separate note/phoneme step handling)
// Kept for compatibility with any remaining references
function triggerSequenceStep(step) {
    console.warn('⚠️ triggerSequenceStep is deprecated - using separate note/phoneme step handling');
}

// Controller functions (moved from ui.js)
function handleValueChange(display, value) {
    const target = display.id.replace('Value', '');
    
    // Update max values for dependent controls
    updateDependentControls(target, value);

    // Handle parameter changes
    handleControlChange(target, value);

    // Sync real-time parameters that don't need full tone regeneration
    if (['portamentoTime', 'attackTime', 'decayTime', 'vowelX', 'vowelY', 'phonemeSteps', 'bpm', 'subdivision'].includes(target)) {
        appState.set(target, value);
        
        // Update formant synthesizer for vowel changes
        if (['vowelX', 'vowelY'].includes(target) && isFormantSynthReady()) {
            const vowelX = appState.params.vowelX;
            const vowelY = appState.params.vowelY;
            setVowelPosition(vowelX, vowelY);
            
            // Reset vowel preset to custom when manually adjusting
            document.getElementById("vowelPreset").value = "custom";
        }
        
        // Regenerate phoneme pattern when steps change
        if (target === 'phonemeSteps') {
            generatePhonemePattern();
            updateSequenceVisualization(appState);
        }
        
        // Update scheduler timing when BPM or subdivision changes
        if (target === 'bpm' && isSchedulerReady()) {
            updateSchedulerBpm(value);
        }
        if (target === 'subdivision' && isSchedulerReady()) {
            updateSchedulerSubdivision(value);
        }
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
            'bpm',
            'subdivision',
            'scaleRotation',
            'chordRotation',
            'sequenceRotation',
            'sequenceBase',
            'sequenceOctaves',
            'vowelX',
            'vowelY',
            'phonemeSteps',
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
        updateSchedulerPatterns(
            appState.playback.sequencePattern.steps.length,
            appState.playback.phonemePattern.vowels.length,
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

// Generate random phoneme sequence with no consecutive repeats
function generatePhonemePattern() {
    const phonemeSteps = appState.params.phonemeSteps;
    const vowels = ['a', 'e', 'i', 'o', 'u'];
    
    // Vowel position mappings based on IPA vowel chart
    const vowelPositions = {
        'a': { x: 0.8, y: 0.9 },  // /a/ - back, open
        'e': { x: 0.7, y: 0.4 },  // /e/ - front-central, mid
        'i': { x: 1.0, y: 0.1 },  // /i/ - front, close
        'o': { x: 0.2, y: 0.4 },  // /o/ - back, mid
        'u': { x: 0.05, y: 0.1 }  // /u/ - back, close (avoid exact 0.0)
    };
    
    const selectedVowels = [];
    const selectedPositions = [];
    let lastVowel = null;
    
    // Use seeded random for consistent results
    let seed = appState.params.randomSeed;
    function seededRandom() {
        seed = (seed * 1664525 + 1013904223) % (2**32);
        return seed / (2**32);
    }
    
    for (let i = 0; i < phonemeSteps; i++) {
        // Get available vowels (exclude last vowel to prevent repeats)
        const availableVowels = vowels.filter(v => v !== lastVowel);
        
        // Select random vowel from available options
        const randomIndex = Math.floor(seededRandom() * availableVowels.length);
        const selectedVowel = availableVowels[randomIndex];
        
        selectedVowels.push(selectedVowel);
        selectedPositions.push(vowelPositions[selectedVowel]);
        lastVowel = selectedVowel;
    }
    
    // Store in app state
    appState.playback.phonemePattern.vowels = selectedVowels;
    appState.playback.phonemePattern.positions = selectedPositions;
    appState.playback.phonemePattern.currentStep = 0;
    
    console.log(`🗣️ Generated phoneme pattern: [${selectedVowels.join(', ')}] (${phonemeSteps} steps - polyrhythmic with note sequence)`);
}

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
    
    // Generate phoneme pattern (independent length)
    generatePhonemePattern();
    
    console.log(`🎵 PATTERN GENERATED: mode=${mode}, steps=[${steps.map(s => s ? s.toFixed(1) : 'null').join(', ')}], rhythm=[${rhythm.join(', ')}], portamento=[${portamento.join(', ')}]`);
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

// Vowel preset selector handler
document.getElementById("vowelPreset").onchange = (e) => {
    const preset = e.target.value;
    
    // If "Use Sequence" is selected, no manual vowel override needed
    if (preset === "sequence") {
        // Just update the formant synth to use current sequence vowel if playing
        return;
    }
    
    // Vowel position mappings based on IPA vowel chart
    const vowelPositions = {
        'a': { x: 0.8, y: 0.9 },  // /a/ - back, open
        'e': { x: 0.7, y: 0.4 },  // /e/ - front-central, mid
        'i': { x: 1.0, y: 0.1 },  // /i/ - front, close
        'o': { x: 0.2, y: 0.4 },  // /o/ - back, mid
        'u': { x: 0.0, y: 0.1 }   // /u/ - back, close
    };
    
    if (vowelPositions[preset]) {
        const pos = vowelPositions[preset];
        
        // Update app state for manual vowel override
        appState.set('vowelX', pos.x);
        appState.set('vowelY', pos.y);
        
        // Update formant synth if active
        if (isFormantSynthReady()) {
            setVowelPosition(pos.x, pos.y);
        }
    }
};

// Subdivision is now handled by the value control system via handleValueChange

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

// Regenerate phonemes button
document.getElementById("regeneratePhonemes").onclick = () => {
    // Generate new random seed for fresh phonemes
    const newSeed = Math.floor(Math.random() * 1000000);
    appState.set('randomSeed', newSeed);
    
    // Regenerate phoneme pattern
    generatePhonemePattern();
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

    // Initialize AudioWorklet scheduler and formant synthesizer
    await initializeAudioWorklet();
    await initializeFormantSynth();
    
    // Set up worklet message handling
    const schedulerNode = getSchedulerNode();
    if (schedulerNode) {
        schedulerNode.port.onmessage = (event) => {
            const { type, payload } = event.data;
            
            if (type === 'globalStepChange') {
                // Update current step tracking for visualization
                appState.playback.sequencePattern.currentStep = payload.noteStep;
                appState.playback.phonemePattern.currentStep = payload.phonemeStep;
                
                // Update visualization to show both sequences
                updateSequenceVisualization(appState);
                
                // console.log(`🎵 GLOBAL STEP ${payload.globalStep}: note[${payload.noteStep}] phoneme[${payload.phonemeStep}] time=${payload.elapsedTime.toFixed(3)}s`);
            }
            
            if (type === 'noteStepChange') {
                // Trigger note sequence step (no phoneme coupling)
                const freq = appState.playback.sequencePattern.steps[payload.noteStep];
                if (freq) {
                    const mode = appState.params.synthMode;
                    
                    console.log(`🎵 NOTE STEP ${payload.noteStep}: freq=${freq.toFixed(1)}Hz`);
                    
                    if (mode === 'mono') {
                        triggerMonoStep(appState, payload.noteStep, freq);
                    } else {
                        triggerPolyStep(appState, payload.noteStep, freq);
                    }
                }
            }
            
            if (type === 'phonemeStepChange') {
                // Update synthesizer vowel in real-time (independent of note triggers)
                const vowelPosition = appState.playback.phonemePattern.positions[payload.phonemeStep];
                if (vowelPosition) {
                    updateSynthVowel(appState, vowelPosition);
                }
                console.log(`🗣️ PHONEME STEP ${payload.phonemeStep}: vowel=${appState.playback.phonemePattern.vowels[payload.phonemeStep] || 'none'} -> (${vowelPosition?.x.toFixed(2)}, ${vowelPosition?.y.toFixed(2)})`);
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