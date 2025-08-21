/**
 * AudioWorklet Service
 * 
 * Main thread interface for the AudioWorklet scheduler.
 * Handles loading, initialization, and communication with the worklet.
 */

import { audioContext } from './audio.js';

let schedulerNode = null;
let isInitialized = false;

/**
 * Initialize the AudioWorklet scheduler
 * @returns {Promise<AudioWorkletNode|null>} The scheduler node or null if failed
 */
export async function initializeAudioWorklet() {
  if (isInitialized || !audioContext) {
    return schedulerNode;
  }
  
  try {
    console.log('🎵 Initializing AudioWorklet scheduler...');
    
    // Load the worklet module
    await audioContext.audioWorklet.addModule('/src/frontend/scheduler.worklet.js');
    
    // Create the worklet node
    schedulerNode = new AudioWorkletNode(audioContext, 'scheduler-processor');
    
    // Connect to destination to keep worklet alive (silent connection)
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 0; // Silent
    schedulerNode.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    isInitialized = true;
    console.log('✅ AudioWorklet scheduler initialized successfully');
    
    return schedulerNode;
  } catch (error) {
    console.error('❌ AudioWorklet initialization failed:', error);
    
    // Fallback logging for debugging
    if (error.name === 'InvalidStateError') {
      console.error('Audio context might not be running. Try clicking to start audio context.');
    } else if (error.message.includes('addModule')) {
      console.error('Failed to load worklet module. Check file path and server serving.');
    }
    
    return null;
  }
}

/**
 * Get the scheduler node (if initialized)
 * @returns {AudioWorkletNode|null} The scheduler node or null
 */
export function getSchedulerNode() {
  return schedulerNode;
}

/**
 * Send a message to the scheduler worklet
 * @param {string} type - Message type
 * @param {Object} payload - Message payload
 */
export function sendToScheduler(type, payload = {}) {
  if (schedulerNode && schedulerNode.port) {
    schedulerNode.port.postMessage({ type, payload });
  } else {
    console.warn(`Cannot send message "${type}" - scheduler not initialized`);
  }
}

/**
 * Check if the AudioWorklet scheduler is ready
 * @returns {boolean} True if initialized and ready
 */
export function isSchedulerReady() {
  return isInitialized && schedulerNode !== null;
}

/**
 * Update the BPM in the scheduler
 * @param {number} bpm - New BPM value
 */
export function updateSchedulerBpm(bpm) {
  sendToScheduler('setBpm', { bpm });
}

/**
 * Update the subdivision in the scheduler
 * @param {number} subdivision - Subdivision (1, 2, 4, 8, 16)
 */
export function updateSchedulerSubdivision(subdivision) {
  sendToScheduler('setSubdivision', { subdivision });
}

/**
 * Update the pattern lengths in the scheduler
 * @param {number} notePatternLength - Number of steps in note pattern
 * @param {number} phonemePatternLength - Number of steps in phoneme pattern
 * @param {boolean[]} rhythm - Rhythm pattern array
 * @param {boolean[]} portamento - Portamento pattern array
 */
export function updateSchedulerPatterns(notePatternLength, phonemePatternLength, rhythm, portamento) {
  sendToScheduler('setPatterns', { 
    notePatternLength,
    phonemePatternLength,
    rhythm,
    portamento
  });
}

/**
 * Cleanup the scheduler (for hot reloading or cleanup)
 */
export function destroyScheduler() {
  if (schedulerNode) {
    sendToScheduler('stop');
    schedulerNode.disconnect();
    schedulerNode = null;
  }
  isInitialized = false;
  console.log('🎵 AudioWorklet scheduler destroyed');
}