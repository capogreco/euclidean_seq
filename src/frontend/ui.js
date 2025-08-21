// UI utility functions and DOM manipulation

export function populateMidiDropdown() {
    const noteNames = [
        "C",
        "C#",
        "D",
        "D#",
        "E",
        "F",
        "F#",
        "G",
        "G#",
        "A",
        "A#",
        "B",
    ];
    const select = document.getElementById("rootMidi");
    select.innerHTML = "";

    for (let midi = 24; midi <= 96; midi++) {
        const octave = Math.floor(midi / 12) - 1;
        const noteIndex = midi % 12;
        const option = document.createElement("option");
        option.value = midi;
        option.textContent = `${noteNames[noteIndex]}${octave}`;
        select.appendChild(option);
    }

    select.value = "60";
}

export function displayColumn(columnId, frequencies, activeIndices, playNote) {
    const container = document.getElementById(columnId);
    container.innerHTML = "";

    if (!frequencies || frequencies.length === 0) return;

    // If activeIndices is true, all are active
    // If it's an array, only those indices are active
    const isActive = (index) => {
        if (activeIndices === true) return true;
        if (Array.isArray(activeIndices)) return activeIndices.includes(index);
        return false;
    };

    frequencies.forEach((freq, index) => {
        const item = document.createElement("div");
        item.className = "tone-item";
        if (isActive(index)) {
            item.classList.add("active");
        } else {
            item.classList.add("inactive");
        }

        const freqSpan = document.createElement("span");
        freqSpan.className = "tone-freq";
        freqSpan.textContent = freq > 0 ? freq.toFixed(2) : "";

        const dot = document.createElement("div");
        dot.className = "tone-dot";

        item.appendChild(freqSpan);
        item.appendChild(dot);

        if (freq > 0) {
            item.onclick = () => {
                // Use simple sine wave for individual tone clicks (not selected synthesis mode)
                const osc = window.audioContext.createOscillator();
                const gain = window.audioContext.createGain();
                osc.connect(gain).connect(window.audioContext.destination);
                osc.frequency.value = freq;
                osc.type = "sine";
                gain.gain.setValueAtTime(0.3, window.audioContext.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, window.audioContext.currentTime + 0.2);
                osc.start();
                osc.stop(window.audioContext.currentTime + 0.2);
            };
        }

        container.appendChild(item);
    });
}

// Sequence visualization function (moved from state.js)
export function updateSequenceVisualization(appState) {
    const container = document.querySelector(".sequence-visualization");
    if (!container) {
        return;
    }
    if (
        !appState.playback.sequencePattern.steps ||
        appState.playback.sequencePattern.steps.length === 0
    ) {
        // console.log("No sequence pattern to visualize");
        return;
    }

    // Get unique frequencies from sequence pattern
    const uniqueFreqs = [
        ...new Set(
            appState.playback.sequencePattern.steps.filter(
                (f) => f !== null,
            ),
        ),
    ].sort((a, b) => b - a);

    let html = '';
    
    // Create phoneme sequence table first (if phoneme pattern exists)
    if (appState.playback.phonemePattern.vowels && appState.playback.phonemePattern.vowels.length > 0) {
        const phonemeLength = appState.playback.phonemePattern.vowels.length;
        
        const noteLength = appState.playback.sequencePattern.steps.length;
        const lcm = (a, b) => Math.abs(a * b) / gcd(a, b);
        const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
        const cycleLength = lcm(noteLength, phonemeLength);
        
        html += `<div class="sequence-section-label">Phoneme Sequence (${phonemeLength} steps • ${cycleLength}-step cycle)</div>`;
        html += '<table class="sequence-grid phoneme-sequence">';
        
        // Phoneme step headers
        html += '<tr><td class="freq-label"></td>';
        for (let i = 0; i < phonemeLength; i++) {
            html += `<td class="step-header">${i + 1}</td>`;
        }
        html += '</tr>';
        
        // Phoneme vowels row
        html += '<tr><td class="freq-label phoneme-label">Vowel</td>';
        const currentPhonemeStep = appState.playback.phonemePattern.currentStep;
        for (let i = 0; i < phonemeLength; i++) {
            const vowel = appState.playback.phonemePattern.vowels[i];
            const isCurrent = appState.playback.isPlaying && i === currentPhonemeStep;
            
            html += `<td class="phoneme-cell ${isCurrent ? "current-column" : ""}">`;
            html += `<div class="phoneme-vowel ${isCurrent ? "current-phoneme" : ""}">${vowel}</div>`;
            html += '</td>';
        }
        html += '</tr>';
        
        html += '</table>';
        html += '<div class="sequence-spacer"></div>';
    }

    // Create note sequence grid table
    const noteLength = appState.playback.sequencePattern.steps.length;
    html += `<div class="sequence-section-label">Note Sequence (${noteLength} steps)</div>`;
    html += '<table class="sequence-grid note-sequence">';

    // Step headers row
    html += '<tr><td class="freq-label"></td>';
    for (
        let i = 0;
        i < appState.playback.sequencePattern.steps.length;
        i++
    ) {
        html += `<td class="step-header">${i + 1}</td>`;
    }
    html += "</tr>";

    // Portamento row
    html += '<tr><td class="freq-label porta-label">Porta</td>';
    for (
        let i = 0;
        i < appState.playback.sequencePattern.portamento.length;
        i++
    ) {
        const isActive = appState.playback.sequencePattern.portamento[i];
        const isCurrent =
            i === appState.playback.sequencePattern.currentStep;
        html += `<td class="porta-cell ${isCurrent ? "current-column" : ""}">`;
        if (isActive) {
            html += '<div class="porta-active"></div>';
        }
        html += "</td>";
    }
    html += "</tr>";

    // Frequency rows
    uniqueFreqs.forEach((freq) => {
        html += `<tr><td class="freq-label">${freq.toFixed(2)}</td>`;
        for (
            let i = 0;
            i < appState.playback.sequencePattern.steps.length;
            i++
        ) {
            const isActive =
                appState.playback.sequencePattern.steps[i] === freq;
            // Only highlight current step if playing
            const isCurrent =
                appState.playback.isPlaying &&
                i === appState.playback.sequencePattern.currentStep;
            html += `<td class="note-cell ${isCurrent ? "current-column" : ""}">`;
            if (isActive) {
                html += `<div class="active-note ${isCurrent ? "current-note" : ""}"></div>`;
            }
            html += "</td>";
        }
        html += "</tr>";
    });

    html += "</table>";
    container.innerHTML = html;
}

export function updateSequenceNotesMax(currentData) {
    // Calculate max based on chord tones × octaves
    const chordCount = currentData.chordIndices
        ? currentData.chordIndices.filter(
              (idx) =>
                  idx <
                  (currentData.baseTones
                      ? currentData.baseTones.length - 1
                      : 12),
          ).length
        : 3;
    const octaves = parseInt(
        document.getElementById("sequenceOctavesValue").textContent,
    );
    const maxNotes = chordCount * octaves;

    const sequenceNotesDisplay = document.getElementById("sequenceNotesValue");
    sequenceNotesDisplay.dataset.max = maxNotes;

    // Adjust current value if it exceeds new max
    const currentNotes = parseInt(sequenceNotesDisplay.textContent);
    if (currentNotes > maxNotes) {
        sequenceNotesDisplay.textContent = maxNotes;
    }

    // Also update rotation max
    const newNotesValue = parseInt(sequenceNotesDisplay.textContent);
    document.getElementById("sequenceRotationValue").dataset.max = Math.max(
        0,
        newNotesValue - 1,
    );
}

// Value control system with improved event delegation
export function setupValueControls(handleValueChange) {
    // Event delegation for value buttons
    const sequenceControls = document.querySelector('.sequence-controls');
    if (sequenceControls) {
        sequenceControls.addEventListener('click', (e) => {
            if (e.target.classList.contains('value-btn')) {
                handleValueButtonClick(e.target, handleValueChange);
            }
        });
    }

    // Also handle buttons in main container (for settings and tone controls)
    const mainContainer = document.querySelector('.main-container');
    if (mainContainer) {
        mainContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('value-btn')) {
                handleValueButtonClick(e.target, handleValueChange);
            }
        });
    }

    // Drag functionality for value displays (still needs individual listeners for mousemove)
    document.querySelectorAll(".value-display").forEach((display) => {
        let isDragging = false;
        let startY = 0;
        let startValue = 0;

        display.addEventListener("mousedown", (e) => {
            isDragging = true;
            startY = e.clientY;
            startValue = parseInt(display.textContent);
            display.classList.add("dragging");
            document.body.style.cursor = "ns-resize";
            e.preventDefault();
        });

        document.addEventListener("mousemove", (e) => {
            if (!isDragging) return;

            const delta = Math.floor((startY - e.clientY) / 5); // 5 pixels per increment
            const min = parseInt(display.dataset.min);
            const max = parseInt(display.dataset.max);
            const multiplier = e.shiftKey ? 0.1 : 1; // Fine control with shift

            let value = startValue + Math.floor(delta * multiplier);
            
            // Check if this is a rotation control for circular behavior
            const isRotationControl = display.id.toLowerCase().includes('rotation');
            
            if (isRotationControl) {
                // Circular rotation logic for rotation controls
                const range = max - min + 1;
                value = ((value - min) % range + range) % range + min;
            } else {
                // Standard clamping behavior for non-rotation controls
                value = Math.max(min, Math.min(max, value));
            }

            if (display.textContent !== value.toString()) {
                display.textContent = value;
                handleValueChange(display, value);
            }
        });

        document.addEventListener("mouseup", () => {
            if (isDragging) {
                isDragging = false;
                display.classList.remove("dragging");
                document.body.style.cursor = "";
            }
        });

        // Double-click to reset
        display.addEventListener("dblclick", () => {
            display.textContent = display.dataset.default;
            const value = parseInt(display.textContent);
            handleValueChange(display, value);
        });
    });
}

function handleValueButtonClick(btn, handleValueChange) {
    const target = btn.dataset.target;
    const delta = parseFloat(btn.dataset.delta);
    const display = document.getElementById(target + "Value");
    const min = parseFloat(display.dataset.min);
    const max = parseFloat(display.dataset.max);
    const precision = parseInt(display.dataset.precision) || 0;
    let value = parseFloat(display.textContent);

    // Check if this is a rotation control for circular behavior
    const isRotationControl = target.toLowerCase().includes('rotation');
    
    if (isRotationControl) {
        // Circular rotation logic for rotation controls
        value = value + delta;
        if (value > max) {
            value = min; // Wrap around to minimum when exceeding maximum
        } else if (value < min) {
            value = max; // Wrap around to maximum when below minimum
        }
    } else {
        // Standard clamping behavior for non-rotation controls
        value = Math.max(min, Math.min(max, value + delta));
    }
    
    // Round to specified precision
    if (precision > 0) {
        value = parseFloat(value.toFixed(precision));
    } else {
        value = Math.round(value);
    }
    
    display.textContent = value;
    handleValueChange(display, value);
}