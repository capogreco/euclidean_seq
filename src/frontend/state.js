// Centralized Application State
export class AppState {
    constructor() {
        // UI Parameters - single source of truth
        this.params = {
            edo: 12,
            scaleNotes: 7,
            scaleRotation: 0,
            chordNotes: 4,
            chordRotation: 0,
            rootFreq: 261.63,
            sequenceNotes: 8,
            sequenceMethod: "euclidean",
            sequenceBase: 0,
            sequenceOctaves: 2,
            sequenceRotation: 0,
            cpm: 30,
            portamentoSteps: 4,
            portamentoRotation: 0,
            portamentoTime: 50, // Percentage of step length (0-100%)
            rhythmPulses: 4,
            rhythmRotation: 0,
            patternSteps: 8,
            attackTime: 10,
            decayTime: 100,
            synthMode: "mono",
            sequenceOrder: "forward",
        };

        // Playback State
        this.playback = {
            sequenceInterval: null,
            sequencePattern: {
                steps: [],
                rhythm: [],
                portamento: [],
                currentStep: 0,
            },
            playIntervals: {
                base: null,
                scale: null,
                chord: null,
                sequence: null,
            },
            playIndices: {
                base: 0,
                scale: 0,
                chord: 0,
                sequence: 0,
            },
            monoOsc: null,
            monoGain: null,
            currentMonoFreq: null,
            isPlaying: false, // Whether sequence is actively playing
        };

        // Event listeners for parameter changes
        this.listeners = new Map();
    }

    // Get parameter value
    get(paramName) {
        return this.params[paramName];
    }

    // Set parameter value and notify listeners
    set(paramName, value) {
        if (this.params[paramName] !== value) {
            const oldValue = this.params[paramName];
            this.params[paramName] = value;
            this.notifyChange(paramName, value, oldValue);
        }
    }

    // Update multiple parameters at once
    update(updates) {
        const changes = [];
        for (const [key, value] of Object.entries(updates)) {
            if (this.params[key] !== value) {
                changes.push({
                    param: key,
                    value,
                    oldValue: this.params[key],
                });
                this.params[key] = value;
            }
        }
        changes.forEach(({ param, value, oldValue }) =>
            this.notifyChange(param, value, oldValue),
        );
    }

    // Add change listener
    onChange(paramName, callback) {
        if (!this.listeners.has(paramName)) {
            this.listeners.set(paramName, []);
        }
        this.listeners.get(paramName).push(callback);
    }

    // Notify parameter change
    notifyChange(paramName, newValue, oldValue) {
        const callbacks = this.listeners.get(paramName) || [];
        callbacks.forEach((callback) =>
            callback(newValue, oldValue, paramName),
        );
    }

    // Sync with DOM elements (for initialization)
    syncFromDOM() {
        const elements = [
            "edo",
            "scaleNotes",
            "scaleRotation",
            "chordNotes",
            "chordRotation",
            "sequenceNotes",
            "sequenceBase",
            "sequenceOctaves",
            "sequenceRotation",
            "cpm",
            "portamentoSteps",
            "portamentoRotation",
            "portamentoTime",
            "rhythmPulses",
            "rhythmRotation",
            "patternSteps",
            "attackTime",
            "decayTime",
        ];

        elements.forEach((param) => {
            const element = document.getElementById(param + "Value");
            if (element) {
                this.params[param] =
                    parseInt(element.textContent) || this.params[param];
            }
        });

        // Special cases
        const modeElement = document.getElementById("synthMode");
        if (modeElement) this.params.synthMode = modeElement.value;

        const orderElement = document.getElementById("sequenceOrder");
        if (orderElement) this.params.sequenceOrder = orderElement.value;

        const methodElement = document.getElementById("sequenceMethod");
        if (methodElement) this.params.sequenceMethod = methodElement.value;
    }

    // Sync to DOM elements
    syncToDOM() {
        Object.entries(this.params).forEach(([param, value]) => {
            const element = document.getElementById(param + "Value");
            if (element) {
                element.textContent = value;
            }
        });

        // Special cases
        document.getElementById("synthMode").value = this.params.synthMode;
        document.getElementById("sequenceOrder").value =
            this.params.sequenceOrder;
        document.getElementById("sequenceMethod").value =
            this.params.sequenceMethod;
    }


}