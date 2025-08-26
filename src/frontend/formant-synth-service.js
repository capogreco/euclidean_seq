/**
 * Formant Synthesis AudioWorklet Service
 * 
 * Main thread interface for the FormantSynthAudioWorklet.
 * Handles loading, initialization, and communication with the formant synthesizer.
 */

import { audioContext } from './audio.js';
import { updateVowelParam } from './parameter-coordinator.js';

let formantSynthNode = null;
let isInitialized = false;

/**
 * Initialize the FormantSynth AudioWorklet
 * @returns {Promise<AudioWorkletNode|null>} The formant synth node or null if failed
 */
export async function initializeFormantSynth() {
  if (isInitialized || !audioContext) {
    return formantSynthNode;
  }
  
  try {
    console.log('🎵 Initializing FormantSynth AudioWorklet...');
    
    // Load the worklet module
    await audioContext.audioWorklet.addModule('/src/frontend/formant-synth.worklet.js');
    
    // Create the worklet node but DON'T connect it
    // The new synthesizer-manager.js will handle connections
    formantSynthNode = new AudioWorkletNode(audioContext, 'formant-synth-processor');
    
    // NOTE: We no longer auto-connect to destination here
    // Individual synthesizers are now managed by synthesizer-manager.js
    console.log('📝 FormantSynth worklet node created (not connected)');
    
    isInitialized = true;
    console.log('✅ FormantSynth AudioWorklet initialized successfully');
    
    return formantSynthNode;
  } catch (error) {
    console.error('❌ FormantSynth initialization failed:', error);
    
    // Fallback logging for debugging
    if (error.name === 'InvalidStateError') {
      console.error('Audio context might not be running. Try clicking to start audio context.');
    } else if (error.message.includes('addModule')) {
      console.error('Failed to load formant synth worklet module. Check file path and server serving.');
    }
    
    return null;
  }
}

/**
 * Get the formant synth node (if initialized)
 * @returns {AudioWorkletNode|null} The formant synth node or null
 */
export function getFormantSynthNode() {
  return formantSynthNode;
}

/**
 * Send a message to the formant synth worklet
 * @param {string} type - Message type
 * @param {Object} payload - Message payload
 */
export function sendToFormantSynth(type, payload = {}) {
  if (formantSynthNode && formantSynthNode.port) {
    formantSynthNode.port.postMessage({ type, payload });
  } else {
    console.warn(`Cannot send message "${type}" - FormantSynth not initialized`);
  }
}

/**
 * Check if the FormantSynth is ready
 * @returns {boolean} True if initialized and ready
 */
export function isFormantSynthReady() {
  return isInitialized && formantSynthNode !== null;
}

/**
 * Set the fundamental frequency using AudioParam
 * @param {number} frequency - Frequency in Hz
 */
export function setFormantFrequency(frequency) {
  if (formantSynthNode && formantSynthNode.parameters) {
    formantSynthNode.parameters.get('frequency').value = frequency;
  }
}

/**
 * Set vowel morphing position using AudioParams
 * @param {number} x - Front/back position (0=back, 1=front)
 * @param {number} y - Close/open position (0=close, 1=open)
 */
export function setVowelPosition(x, y) {
  if (formantSynthNode && formantSynthNode.parameters) {
    formantSynthNode.parameters.get('vowelX').value = x;
    formantSynthNode.parameters.get('vowelY').value = y;
  }
}

/**
 * Activate or deactivate the formant synthesizer using AudioParam
 * @param {boolean} active - Whether synthesis should be active
 */
export function setFormantActive(active) {
  if (formantSynthNode && formantSynthNode.parameters) {
    formantSynthNode.parameters.get('active').value = active ? 1 : 0;
  }
}

/**
 * Set individual formant parameters
 * @param {number} formantIndex - Index of formant (0, 1, or 2)
 * @param {Object} params - Formant parameters {frequency?, bandwidth?, amplitude?}
 */
export function setFormantParams(formantIndex, params) {
  sendToFormantSynth('setFormant', { 
    formantIndex, 
    ...params 
  });
}

/**
 * Play a single note using formant synthesis
 * @param {number} frequency - Fundamental frequency in Hz
 * @param {number} duration - Duration in milliseconds
 * @param {number} vowelX - Vowel X position (0-1)
 * @param {number} vowelY - Vowel Y position (0-1)
 */
export function playFormantNote(frequency, duration = 200, vowelX = 0.5, vowelY = 0.5) {
  if (!isFormantSynthReady()) {
    console.warn('FormantSynth not ready - falling back to sine wave');
    return false;
  }
  
  // Set frequency and vowel position
  setFormantFrequency(frequency);
  setVowelPosition(vowelX, vowelY);
  
  // Start synthesis
  setFormantActive(true);
  
  // Stop after duration
  setTimeout(() => {
    setFormantActive(false);
  }, duration);
  
  return true;
}

/**
 * Create a formant-based oscillator for continuous playback (mono mode)
 * @param {number} frequency - Initial frequency
 * @param {number} vowelX - Initial vowel X position  
 * @param {number} vowelY - Initial vowel Y position
 * @returns {AudioWorkletNode|null} The formant synthesizer node with proper AudioParams
 */
export function createFormantOscillator(frequency = 220, vowelX = 0.5, vowelY = 0.5) {
  if (!isFormantSynthReady()) {
    console.warn('FormantSynth not ready - cannot create formant oscillator');
    return null;
  }
  
  // Set initial parameter values using setValueAtTime for proper scheduling
  const now = audioContext.currentTime;
  formantSynthNode.parameters.get('frequency').setValueAtTime(frequency, now);
  formantSynthNode.parameters.get('vowelX').setValueAtTime(vowelX, now);
  formantSynthNode.parameters.get('vowelY').setValueAtTime(vowelY, now);
  formantSynthNode.parameters.get('active').setValueAtTime(0, now); // Start inactive
  
  // Add helper methods for compatibility
  formantSynthNode.setVowel = function(x, y, rampTime = 0.005) {
    // Use parameter coordinator to prevent race conditions
    const vowelXParam = this.parameters.get('vowelX');
    const vowelYParam = this.parameters.get('vowelY');
    
    updateVowelParam(vowelXParam, x, rampTime, 'formant-synth-x');
    updateVowelParam(vowelYParam, y, rampTime, 'formant-synth-y');
  };
  
  formantSynthNode.start = function(time = 0) {
    const now = audioContext.currentTime;
    console.log('🎤 Activating formant synth');
    this.parameters.get('active').setValueAtTime(1, now);
  };
  
  formantSynthNode.stop = function(time = 0) {
    const now = audioContext.currentTime;
    console.log('🎤 Deactivating formant synth');
    this.parameters.get('active').setValueAtTime(0, now);
  };
  
  return formantSynthNode;
}

/**
 * Cleanup the formant synthesizer (for hot reloading or cleanup)
 */
export function destroyFormantSynth() {
  if (formantSynthNode) {
    setFormantActive(false);
    formantSynthNode.disconnect();
    formantSynthNode = null;
  }
  isInitialized = false;
  console.log('🎵 FormantSynth AudioWorklet destroyed');
}