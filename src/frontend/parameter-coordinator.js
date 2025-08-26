/**
 * Parameter Update Coordinator
 * 
 * Prevents race conditions between concurrent AudioParam updates by:
 * 1. Batching simultaneous parameter changes
 * 2. Coordinating timing to prevent cancelScheduledValues conflicts
 * 3. Managing smooth transitions without interrupting each other
 */

class ParameterCoordinator {
    constructor() {
        this.pendingUpdates = new Map(); // audioParam -> {value, rampTime, priority}
        this.updateTimeout = null;
        this.isProcessing = false;
    }

    /**
     * Schedule a parameter update with batching and priority
     * @param {AudioParam} audioParam - The parameter to update
     * @param {number} targetValue - Target value
     * @param {number} rampTime - Ramp duration in seconds
     * @param {number} priority - Higher number = higher priority
     * @param {string} source - Source identifier for debugging
     */
    scheduleUpdate(audioParam, targetValue, rampTime = 0.005, priority = 0, source = 'unknown') {
        if (!audioParam) return;

        // Store or update the pending change
        const updateKey = audioParam;
        const existing = this.pendingUpdates.get(updateKey);
        
        // Only override if new update has higher priority or same priority with newer timestamp
        if (!existing || priority > existing.priority || 
            (priority === existing.priority && Date.now() > existing.timestamp + 1)) {
            
            this.pendingUpdates.set(updateKey, {
                targetValue,
                rampTime,
                priority,
                source,
                timestamp: Date.now()
            });
        }

        // Debounce: process updates after a very short delay to batch simultaneous calls
        this.scheduleProcessing();
    }

    /**
     * Schedule processing with debouncing
     */
    scheduleProcessing() {
        if (this.updateTimeout) {
            clearTimeout(this.updateTimeout);
        }
        
        // Very short debounce (1ms) to batch simultaneous updates
        this.updateTimeout = setTimeout(() => {
            this.processUpdates();
        }, 1);
    }

    /**
     * Process all pending updates atomically
     */
    processUpdates() {
        if (this.isProcessing || this.pendingUpdates.size === 0) {
            return;
        }

        this.isProcessing = true;
        const now = window.audioContext?.currentTime || 0;

        try {
            // Group updates by timing to coordinate cancellations
            const updates = Array.from(this.pendingUpdates.entries());
            
            if (updates.length > 1) {
                console.log(`📦 BATCH: Processing ${updates.length} simultaneous parameter updates`);
            }
            
            // Sort by priority (higher first) to process most important updates first
            updates.sort(([,a], [,b]) => b.priority - a.priority);

            // Process each update with proper W3C sequence
            for (const [audioParam, update] of updates) {
                try {
                    this.applySingleUpdate(audioParam, update, now);
                } catch (error) {
                    console.warn(`Parameter update failed for ${update.source}:`, error);
                }
            }

        } finally {
            this.pendingUpdates.clear();
            this.isProcessing = false;
            this.updateTimeout = null;
        }
    }

    /**
     * Apply a single parameter update following W3C recommendations
     */
    applySingleUpdate(audioParam, update, now) {
        const { targetValue, rampTime, source } = update;

        // W3C recommended sequence: cancel -> set current -> ramp
        audioParam.cancelScheduledValues(now);
        audioParam.setValueAtTime(audioParam.value, now);
        
        if (rampTime > 0) {
            audioParam.linearRampToValueAtTime(targetValue, now + rampTime);
        } else {
            // Immediate change
            audioParam.setValueAtTime(targetValue, now);
        }

        // Debug logging for parameter updates
        if (source.includes('frequency') || source.includes('portamento')) {
            console.log(`🎵 FREQ: ${source} -> ${targetValue.toFixed(1)}Hz (ramp: ${(rampTime*1000).toFixed(1)}ms) [current: ${audioParam.value?.toFixed(1) || 'null'}]`);
        }
        if (source.includes('vowel')) {
            console.log(`🗣️ VOWEL: ${source} -> ${targetValue.toFixed(3)} (ramp: ${(rampTime*1000).toFixed(1)}ms) [current: ${audioParam.value?.toFixed(3) || 'null'}]`);
        }
    }

    /**
     * Immediate update without batching (for critical timing)
     */
    updateImmediate(audioParam, targetValue, rampTime = 0.005, source = 'immediate') {
        if (!audioParam) return;

        const now = window.audioContext?.currentTime || 0;
        this.applySingleUpdate(audioParam, { targetValue, rampTime, source }, now);
    }

    /**
     * Clear all pending updates
     */
    clearPending() {
        this.pendingUpdates.clear();
        if (this.updateTimeout) {
            clearTimeout(this.updateTimeout);
            this.updateTimeout = null;
        }
    }
}

// Global instance
export const parameterCoordinator = new ParameterCoordinator();

// Convenience functions for common use cases
export function updateFrequencyParam(audioParam, frequency, rampTime, source = 'frequency') {
    parameterCoordinator.scheduleUpdate(audioParam, frequency, rampTime, 10, source); // High priority
}

export function updateVowelParam(audioParam, value, rampTime = 0.005, source = 'vowel') {
    parameterCoordinator.scheduleUpdate(audioParam, value, rampTime, 5, source); // Medium priority
}

export function updateGeneralParam(audioParam, value, rampTime = 0.005, source = 'general') {
    parameterCoordinator.scheduleUpdate(audioParam, value, rampTime, 1, source); // Low priority
}