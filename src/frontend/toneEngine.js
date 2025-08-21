// Pure Functional Tone Engine
// All functions are pure - same inputs always produce same outputs

// Euclidean rhythm algorithm
export function euclideanRhythm(pulses, steps) {
    if (pulses >= steps) return new Array(steps).fill(true);
    if (pulses === 0) return new Array(steps).fill(false);
    
    const pattern = new Array(steps).fill(false);
    for (let i = 0; i < pulses; i++) {
        const position = Math.floor((i * steps) / pulses);
        pattern[position] = true;
    }
    return pattern;
}

// Deterministic shuffle using seed
export function shuffleArray(array, seed) {
    const result = [...array];
    let currentSeed = seed;
    
    // Simple seeded random function
    function seededRandom() {
        currentSeed = (currentSeed * 1664525 + 1013904223) % (2**32);
        return currentSeed / (2**32);
    }
    
    // Fisher-Yates shuffle with seeded random
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(seededRandom() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    
    return result;
}

// Convert pattern to intervals
function patternToIntervals(pattern) {
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
}

// Convert intervals to pattern
function intervalsToPattern(intervals, steps) {
    const pattern = new Array(steps).fill(false);
    
    if (intervals.length === 0) return pattern;
    
    pattern[0] = true;
    let currentPos = 0;
    
    for (let i = 0; i < intervals.length - 1; i++) {
        currentPos = (currentPos + intervals[i]) % steps;
        pattern[currentPos] = true;
    }
    
    return pattern;
}

// Generate base tones (all EDO frequencies)
export function generateBaseTones(edo, rootFreq) {
    const tones = [];
    for (let i = 0; i <= edo; i++) {
        tones.push(rootFreq * Math.pow(2, i / edo));
    }
    return tones;
}

// Generate scale tones using Euclidean algorithm
export function generateScaleTones(baseTones, scaleNotes, scaleRotation) {
    const edo = baseTones.length - 1;
    const pattern = euclideanRhythm(scaleNotes, edo);

    // Get original positions
    const originalPositions = [];
    pattern.forEach((hasNote, index) => {
        if (hasNote) {
            originalPositions.push(index);
        }
    });

    if (originalPositions.length === 0) {
        return {
            scaleTones: new Array(edo + 1).fill(0),
            scaleIndices: [],
        };
    }

    // Calculate intervals
    const originalIntervals = [];
    for (let i = 0; i < originalPositions.length; i++) {
        const current = originalPositions[i];
        const next = originalPositions[(i + 1) % originalPositions.length];
        const interval = next > current ? next - current : edo - current + next;
        originalIntervals.push(interval);
    }

    // Apply rotation
    let rotatedIntervals = [...originalIntervals];
    if (scaleRotation > 0 && originalIntervals.length > 0) {
        const rot = scaleRotation % originalIntervals.length;
        rotatedIntervals = [
            ...originalIntervals.slice(rot),
            ...originalIntervals.slice(0, rot),
        ];
    }

    // Build scale from intervals
    const steps = [0];
    let currentStep = 0;
    for (let i = 0; i < rotatedIntervals.length - 1; i++) {
        currentStep += rotatedIntervals[i];
        steps.push(currentStep);
    }

    // Create scale tones array and indices
    const scaleTones = new Array(edo + 1).fill(0);
    const scaleIndices = [];
    steps.forEach((step) => {
        if (step <= edo) {
            scaleTones[step] = baseTones[step];
            scaleIndices.push(step);
        }
    });

    // Add octave
    scaleTones[edo] = baseTones[edo];
    if (!scaleIndices.includes(edo)) {
        scaleIndices.push(edo);
    }

    return { scaleTones, scaleIndices };
}

// Generate chord tones using Euclidean algorithm on scale
export function generateChordTones(scaleTones, scaleIndices, chordNotes, chordRotation) {
    const edo = scaleTones.length - 1;
    const activeScaleTones = scaleIndices.filter((s) => s < edo);

    if (activeScaleTones.length === 0) {
        return {
            chordTones: new Array(edo + 1).fill(0),
            chordIndices: [],
        };
    }

    // Generate chord pattern from scale using Euclidean algorithm
    const chordPattern = euclideanRhythm(chordNotes, activeScaleTones.length);

    if (chordNotes === 0) {
        return {
            chordTones: new Array(edo + 1).fill(0),
            chordIndices: [],
        };
    }

    // Use interval-based rotation approach
    let rotatedPattern = chordPattern;
    if (chordRotation > 0) {
        const canonicalIntervals = patternToIntervals(chordPattern);
        if (canonicalIntervals.length > 0) {
            const rot = chordRotation % canonicalIntervals.length;
            const rotatedIntervals = [
                ...canonicalIntervals.slice(rot),
                ...canonicalIntervals.slice(0, rot),
            ];
            rotatedPattern = intervalsToPattern(rotatedIntervals, activeScaleTones.length);
        }
    }

    // Build chord positions from rotated pattern
    const chordPositions = [];
    rotatedPattern.forEach((hasNote, index) => {
        if (hasNote) {
            chordPositions.push(index);
        }
    });

    // Map to actual chord tones
    const chordTones = new Array(edo + 1).fill(0);
    const chordIndices = [];

    chordPositions.forEach((position) => {
        const step = activeScaleTones[position];
        chordTones[step] = scaleTones[step];
        chordIndices.push(step);
    });

    // Add octave if it was in the scale
    if (scaleIndices.includes(edo)) {
        chordTones[edo] = scaleTones[edo];
        if (!chordIndices.includes(edo)) {
            chordIndices.push(edo);
        }
    }

    return { chordTones, chordIndices };
}

// Generate sequence tones from chord tones across octaves
export function generateSequenceTones(
    chordTones,
    chordIndices,
    sequenceNotes,
    sequenceMethod,
    sequenceBase,
    sequenceOctaves,
    sequenceRotation,
    randomSeed = 12345 // Default seed for random method
) {
    const edo = chordTones.length - 1;

    if (
        sequenceNotes === undefined ||
        sequenceBase === undefined ||
        sequenceOctaves === undefined
    ) {
        return { sequenceTones: [], sequenceIndices: [] };
    }

    // Expand chord tones across octaves
    const expandedTones = [];
    const minOctave = sequenceBase;
    const maxOctave = sequenceBase + sequenceOctaves - 1;

    for (let octave = minOctave; octave <= maxOctave; octave++) {
        chordIndices.forEach((index) => {
            if (index < edo) {
                const baseTone = chordTones[index];
                if (baseTone > 0) {
                    const freq = baseTone * Math.pow(2, octave);
                    expandedTones.push(freq);
                }
            }
        });
    }

    if (expandedTones.length === 0) {
        return { sequenceTones: [], sequenceIndices: [] };
    }

    // Select subset using chosen method
    let selectedIndices = [];

    if (sequenceMethod === "euclidean") {
        const numToSelect = Math.min(sequenceNotes, expandedTones.length);
        const pattern = euclideanRhythm(numToSelect, expandedTones.length);

        // Apply rotation
        let rotatedPattern = [...pattern];
        if (sequenceRotation && sequenceRotation > 0) {
            const rot = sequenceRotation % expandedTones.length;
            rotatedPattern = [
                ...pattern.slice(rot),
                ...pattern.slice(0, rot),
            ];
        }

        rotatedPattern.forEach((select, i) => {
            if (select) {
                selectedIndices.push(i);
            }
        });
    } else if (sequenceMethod === "random") {
        const numToSelect = Math.min(sequenceNotes, expandedTones.length);
        const available = [...Array(expandedTones.length).keys()];
        
        // Use seeded random for deterministic results
        let currentSeed = randomSeed;
        function seededRandom() {
            currentSeed = (currentSeed * 1664525 + 1013904223) % (2**32);
            return currentSeed / (2**32);
        }
        
        for (let i = 0; i < numToSelect; i++) {
            const randomIndex = Math.floor(seededRandom() * available.length);
            selectedIndices.push(available[randomIndex]);
            available.splice(randomIndex, 1);
        }
        selectedIndices.sort((a, b) => a - b);
    }

    // Return selected tones
    const sequenceTones = expandedTones.map((freq, i) =>
        selectedIndices.includes(i) ? freq : 0,
    );

    return { sequenceTones, sequenceIndices: selectedIndices };
}

// Order tones according to specified method
export function orderTones(tones, method, seed = 12345) {
    switch (method) {
        case "forward":
            return [...tones].sort((a, b) => a - b);
        
        case "reverse":
            return [...tones].sort((a, b) => b - a);
        
        case "shuffle":
            return shuffleArray(tones, seed);
        
        case "random":
        default:
            return [...tones]; // Keep original order for random
    }
}

// Main function: generate all tone data from parameters
export function generateToneData(params) {
    // Generate base tones
    const baseTones = generateBaseTones(params.edo, params.rootFreq);
    
    // Generate scale tones
    const { scaleTones, scaleIndices } = generateScaleTones(
        baseTones,
        params.scaleNotes,
        params.scaleRotation
    );
    
    // Generate chord tones
    const { chordTones, chordIndices } = generateChordTones(
        scaleTones,
        scaleIndices,
        params.chordNotes,
        params.chordRotation
    );
    
    // Generate sequence tones
    const { sequenceTones, sequenceIndices } = generateSequenceTones(
        chordTones,
        chordIndices,
        params.sequenceNotes,
        params.sequenceMethod,
        params.sequenceBase,
        params.sequenceOctaves,
        params.sequenceRotation,
        params.randomSeed || 12345
    );
    
    return {
        baseTones,
        scaleTones,
        scaleIndices,
        chordTones,
        chordIndices,
        sequenceTones,
        sequenceIndices,
    };
}