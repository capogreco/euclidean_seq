// Interval-based rotation utilities (duplicated from main.js for modular use)
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

// Optimized Euclidean algorithm implementation using Björklund's algorithm
export function euclideanRhythm(pulses, steps) {
    // Handle edge cases efficiently
    if (pulses >= steps) return new Array(steps).fill(true);
    if (pulses === 0) return new Array(steps).fill(false);
    
    // Use direct mathematical approach for better performance
    const pattern = new Array(steps).fill(false);
    const bucket = steps - pulses;
    
    for (let i = 0; i < pulses; i++) {
        const position = Math.floor((i * steps) / pulses);
        pattern[position] = true;
    }
    
    return pattern;
}

// Simplified Pipeline - Pure Functions
export class TonePipeline {
    constructor() {
        this.params = {
            edo: 12,
            rootFreq: 261.63,
            scaleNotes: 7,
            scaleRotation: 0,
            chordNotes: 4,
            chordRotation: 0,
            sequenceNotes: 8,
            sequenceMethod: "euclidean",
            sequenceBase: 0,
            sequenceOctaves: 2,
            sequenceRotation: 0,
        };

        // Shuffle cache integrated into pipeline
        this.shuffleCache = {
            mono: null,
            poly: null,
        };
    }

    // Get current data in the old format for compatibility
    getCurrentData() {
        const baseTones = this.generateBaseTones(
            this.params.edo,
            this.params.rootFreq,
        );
        const { scaleTones, scaleIndices } = this.generateScaleTones(
            baseTones,
            this.params.scaleNotes,
            this.params.scaleRotation,
        );
        const { chordTones, chordIndices } = this.generateChordTones(
            scaleTones,
            scaleIndices,
            this.params.chordNotes,
            this.params.chordRotation,
        );
        const { sequenceTones, sequenceIndices } = this.generateSequenceTones(
            chordTones,
            chordIndices,
            this.params.sequenceNotes,
            this.params.sequenceMethod,
            this.params.sequenceBase,
            this.params.sequenceOctaves,
            this.params.sequenceRotation,
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

    updateParam(paramName, value) {
        this.params[paramName] = value;

        // Clear shuffle cache only when pattern structure changes
        // Rotations, base, and octaves preserve pattern structure
        if (
            [
                "edo",
                "rootFreq",
                "scaleNotes",
                "chordNotes",
                "sequenceNotes",
                "sequenceMethod",
            ].includes(paramName)
        ) {
            this.clearShuffleCache();
        }
    }

    // Order tones according to specified method
    orderTones(tones, method) {
        switch (method) {
            case "forward":
                this.shuffleCache.mono = null;
                this.shuffleCache.poly = null;
                return [...tones].sort((a, b) => a - b);

            case "reverse":
                this.shuffleCache.mono = null;
                this.shuffleCache.poly = null;
                return [...tones].sort((a, b) => b - a);

            case "shuffle":
                // Use mode-specific cache
                const cacheKey = window.appState.get("synthMode") || "mono";
                if (
                    !this.shuffleCache[cacheKey] ||
                    this.shuffleCache[cacheKey].length !== tones.length
                ) {
                    this.shuffleCache[cacheKey] = [...tones];
                    // Fisher-Yates shuffle
                    for (
                        let i = this.shuffleCache[cacheKey].length - 1;
                        i > 0;
                        i--
                    ) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [
                            this.shuffleCache[cacheKey][i],
                            this.shuffleCache[cacheKey][j],
                        ] = [
                            this.shuffleCache[cacheKey][j],
                            this.shuffleCache[cacheKey][i],
                        ];
                    }
                }
                return [...this.shuffleCache[cacheKey]];

            case "random":
            default:
                this.shuffleCache.mono = null;
                this.shuffleCache.poly = null;
                return [...tones]; // Keep original order for random
        }
    }

    // Clear shuffle cache
    clearShuffleCache() {
        this.shuffleCache.mono = null;
        this.shuffleCache.poly = null;
    }

    // Reshuffle - force new shuffle
    reshuffle() {
        this.clearShuffleCache();
    }

    // Generate base tones (all EDO frequencies)
    generateBaseTones(edo, rootFreq) {
        const tones = [];
        for (let i = 0; i <= edo; i++) {
            tones.push(rootFreq * Math.pow(2, i / edo));
        }
        return tones;
    }

    // Generate scale tones using Euclidean algorithm
    generateScaleTones(baseTones, scaleNotes, scaleRotation) {
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
            const interval =
                next > current ? next - current : edo - current + next;
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
    generateChordTones(scaleTones, scaleIndices, chordNotes, chordRotation) {
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
    generateSequenceTones(
        chordTones,
        chordIndices,
        sequenceNotes,
        sequenceMethod,
        sequenceBase,
        sequenceOctaves,
        sequenceRotation,
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
            
            for (let i = 0; i < numToSelect; i++) {
                const randomIndex = Math.floor(Math.random() * available.length);
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
}