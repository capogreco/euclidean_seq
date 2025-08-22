/**
 * X-Y Oscilloscope Visualization for Formant Analysis
 * 
 * Creates a real-time X-Y plot where:
 * - X axis: First formant (F1) amplitude
 * - Y axis: Second formant (F2) amplitude
 * 
 * This provides visual feedback of the vowel formant structure
 * across both PM (formant synthesis) and Zing synthesis modes.
 */

import { audioContext } from './audio.js';

class XYOscilloscope {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        
        // Set up canvas dimensions based on container
        this.setupCanvas();
        
        // Audio analysis nodes
        this.analyserF1 = null;
        this.analyserF2 = null;
        this.bufferLengthF1 = 0;
        this.bufferLengthF2 = 0;
        this.dataArrayF1 = null;
        this.dataArrayF2 = null;
        
        // Alternative: use splitter and connect to main output for debugging
        this.splitterNode = null;
        this.analyserMain = null;
        
        // DC removal (high-pass filtering) for centering signals
        this.dcRemovalF1 = { x1: 0, y1: 0, alpha: 0.995 };
        this.dcRemovalF2 = { x1: 0, y1: 0, alpha: 0.995 };
        
        // Visualization settings
        this.gain = 3.0;
        this.trailLength = 200;
        this.trail = [];
        this.isRunning = false;
        this.samplesPerFrame = 64; // How many sample points to plot per frame
        this.sampleOffset = 0; // Offset into the buffer for time evolution
        
        // Animation frame
        this.animationId = null;
        
        this.drawInitialGrid();
        
        console.log('🔬 Oscilloscope initialized with canvas:', this.width, 'x', this.height);
    }
    
    setupCanvas() {
        // Get the computed width from CSS
        const rect = this.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        
        // Set the internal size based on CSS size and device pixel ratio
        this.width = rect.width * dpr;
        this.height = rect.height * dpr;
        
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        
        // Scale the context to match device pixel ratio
        this.ctx.scale(dpr, dpr);
        
        // Set actual drawing dimensions (CSS pixels)
        this.drawWidth = rect.width;
        this.drawHeight = rect.height;
        this.centerX = this.drawWidth / 2;
        this.centerY = this.drawHeight / 2;
        
        console.log('🔬 Canvas setup:', {
            cssSize: `${rect.width}x${rect.height}`,
            actualSize: `${this.width}x${this.height}`,
            center: `${this.centerX}, ${this.centerY}`
        });
    }
    
    drawInitialGrid() {
        // White background
        this.ctx.fillStyle = '#fff';
        this.ctx.fillRect(0, 0, this.drawWidth, this.drawHeight);
        this.drawGrid();
    }
    
    drawGrid() {
        // Clean background - no grid elements
        // Just a plain white background for minimal distraction
    }
    
    connectToSynthesizer(synthNode) {
        if (!synthNode) {
            console.warn('🔬 Cannot connect oscilloscope - no synth node');
            return false;
        }
        
        console.log('🔬 Connecting oscilloscope to synthesizer:', synthNode);
        
        // Disconnect existing analyzers
        this.disconnect();
        
        try {
            // Strategy 1: Try to connect to individual channels if available
            if (synthNode.numberOfOutputs >= 3) {
                console.log('🔬 Multi-channel connection attempt...');
                
                this.analyserF1 = audioContext.createAnalyser();
                this.analyserF2 = audioContext.createAnalyser();
                
                this.analyserF1.fftSize = 512;
                this.analyserF1.smoothingTimeConstant = 0.3;
                this.analyserF2.fftSize = 512;
                this.analyserF2.smoothingTimeConstant = 0.3;
                
                try {
                    // Try connecting to channels 1 and 2 (F1 and F2)
                    synthNode.connect(this.analyserF1, 1, 0);
                    synthNode.connect(this.analyserF2, 2, 0);
                    
                    this.bufferLengthF1 = this.analyserF1.frequencyBinCount;
                    this.bufferLengthF2 = this.analyserF2.frequencyBinCount;
                    this.dataArrayF1 = new Float32Array(this.bufferLengthF1);
                    this.dataArrayF2 = new Float32Array(this.bufferLengthF2);
                    
                    console.log('✅ Multi-channel connection successful');
                    return true;
                } catch (e) {
                    console.warn('❌ Multi-channel connection failed:', e);
                }
            }
            
            // Strategy 2: Fallback to main output with channel splitter
            console.log('🔬 Fallback: Connecting to main output with splitter...');
            
            this.splitterNode = audioContext.createChannelSplitter(2);
            this.analyserF1 = audioContext.createAnalyser();
            this.analyserF2 = audioContext.createAnalyser();
            
            this.analyserF1.fftSize = 512;
            this.analyserF1.smoothingTimeConstant = 0.3;
            this.analyserF2.fftSize = 512;
            this.analyserF2.smoothingTimeConstant = 0.3;
            
            // Connect main output to splitter, then to analyzers
            synthNode.connect(this.splitterNode, 0, 0);
            this.splitterNode.connect(this.analyserF1, 0, 0);
            this.splitterNode.connect(this.analyserF2, 1, 0);
            
            this.bufferLengthF1 = this.analyserF1.frequencyBinCount;
            this.bufferLengthF2 = this.analyserF2.frequencyBinCount;
            this.dataArrayF1 = new Float32Array(this.bufferLengthF1);
            this.dataArrayF2 = new Float32Array(this.bufferLengthF2);
            
            console.log('✅ Splitter connection successful');
            return true;
            
        } catch (error) {
            console.error('❌ Failed to connect oscilloscope:', error);
            return false;
        }
    }
    
    disconnect() {
        if (this.analyserF1) {
            this.analyserF1.disconnect();
            this.analyserF1 = null;
        }
        if (this.analyserF2) {
            this.analyserF2.disconnect();
            this.analyserF2 = null;
        }
        if (this.splitterNode) {
            this.splitterNode.disconnect();
            this.splitterNode = null;
        }
        this.dataArrayF1 = null;
        this.dataArrayF2 = null;
    }
    
    start() {
        if (!this.analyserF1 || !this.analyserF2) {
            console.warn('🔬 Cannot start oscilloscope - not connected to synthesizer');
            return false;
        }
        
        this.isRunning = true;
        this.trail = []; // Clear trail
        this.animate();
        console.log('🔬 Oscilloscope started');
        return true;
    }
    
    stop() {
        this.isRunning = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        // Clear canvas and redraw grid
        this.drawInitialGrid();
        console.log('🔬 Oscilloscope stopped');
    }
    
    setGain(gain) {
        this.gain = Math.max(0.1, Math.min(20, gain));
    }
    
    setSamplesPerFrame(samples) {
        this.samplesPerFrame = Math.max(2, Math.min(32, Math.floor(samples)));
    }
    
    // Simple DC removal using a high-pass filter
    removeDC(input, filter) {
        // First-order high-pass filter: y[n] = alpha * (y[n-1] + x[n] - x[n-1])
        const output = filter.alpha * (filter.y1 + input - filter.x1);
        filter.x1 = input;
        filter.y1 = output;
        return output;
    }
    
    animate() {
        if (!this.isRunning) return;
        
        // Get time domain data (waveform) from both formant channels
        this.analyserF1.getFloatTimeDomainData(this.dataArrayF1);
        this.analyserF2.getFloatTimeDomainData(this.dataArrayF2);
        
        // Plot consecutive instantaneous sample points per frame
        const maxRadius = Math.min(this.centerX, this.centerY) * 0.8;
        const bufferLength = Math.min(this.bufferLengthF1, this.bufferLengthF2);
        
        // Ensure we don't try to sample more than the buffer size
        const actualSamplesPerFrame = Math.min(this.samplesPerFrame, bufferLength - 1);
        
        for (let i = 0; i < actualSamplesPerFrame; i++) {
            // Take consecutive samples starting from integer offset
            const baseOffset = Math.floor(this.sampleOffset);
            const sampleIndex = (baseOffset + i) % bufferLength;
            
            // Get instantaneous sample values (preserves phase relationship)
            let f1Sample = this.dataArrayF1[sampleIndex];
            let f2Sample = this.dataArrayF2[sampleIndex];
            
            // Apply DC removal (high-pass filter) to center signals around zero
            f1Sample = this.removeDC(f1Sample, this.dcRemovalF1);
            f2Sample = this.removeDC(f2Sample, this.dcRemovalF2);
            
            // Ensure bipolar signals are properly ranged
            f1Sample = Math.max(-1, Math.min(1, f1Sample));
            f2Sample = Math.max(-1, Math.min(1, f2Sample));
            
            // Convert to screen coordinates (bipolar: -1 to +1 maps to full screen range)
            const x = this.centerX + (f1Sample * this.gain * maxRadius);
            const y = this.centerY - (f2Sample * this.gain * maxRadius);
            
            // Add to trail with sample information
            this.trail.push({ 
                x, 
                y, 
                age: 0, 
                f1Sample, 
                f2Sample,
                sampleIndex: i // For color variation
            });
        }
        
        // Evolve sample offset with integer values to avoid index issues
        this.sampleOffset = (this.sampleOffset + 1) % Math.min(this.bufferLengthF1, this.bufferLengthF2);
        
        // Limit trail length
        while (this.trail.length > this.trailLength) {
            this.trail.shift();
        }
        
        // Age the trail points
        this.trail.forEach(point => point.age++);
        
        // Debug output occasionally
        if (Math.random() < 0.01) { // ~1% of frames
            const latest = this.trail[this.trail.length - 1];
            console.log('🔬 Debug:', { 
                bufferLength,
                actualSamplesPerFrame,
                trailPoints: this.trail.length,
                sampleOffset: this.sampleOffset.toFixed(2),
                latestSample: latest ? { F1: latest.f1Sample.toFixed(4), F2: latest.f2Sample.toFixed(4) } : 'none'
            });
        }
        
        this.draw();
        
        this.animationId = requestAnimationFrame(() => this.animate());
    }
    
    draw() {
        // Clear canvas with white background
        this.ctx.fillStyle = '#fff';
        this.ctx.fillRect(0, 0, this.drawWidth, this.drawHeight);
        
        // Redraw grid
        this.drawGrid();
        
        if (this.trail.length === 0) return;
        
        // Draw trail as connected lines
        if (this.trail.length > 1) {
            this.ctx.strokeStyle = '#000';
            this.ctx.lineWidth = 1;
            this.ctx.lineCap = 'round';
            this.ctx.lineJoin = 'round';
            
            // Draw lines connecting consecutive points
            for (let i = 1; i < this.trail.length; i++) {
                const prevPoint = this.trail[i - 1];
                const currentPoint = this.trail[i];
                
                // Calculate alpha based on age for fading trail
                const alpha = Math.max(0.1, 1 - (currentPoint.age / this.trailLength));
                
                this.ctx.globalAlpha = alpha;
                this.ctx.beginPath();
                this.ctx.moveTo(prevPoint.x, prevPoint.y);
                this.ctx.lineTo(currentPoint.x, currentPoint.y);
                this.ctx.stroke();
            }
            
            // Reset global alpha
            this.ctx.globalAlpha = 1.0;
        }
        
        // Draw current sample set as connected line with emphasis
        const recentPoints = this.trail.slice(-this.samplesPerFrame);
        if (recentPoints.length > 1) {
            this.ctx.strokeStyle = '#000';
            this.ctx.lineWidth = 2; // Slightly thicker for current sample set
            this.ctx.globalAlpha = 1.0;
            
            this.ctx.beginPath();
            this.ctx.moveTo(recentPoints[0].x, recentPoints[0].y);
            for (let i = 1; i < recentPoints.length; i++) {
                this.ctx.lineTo(recentPoints[i].x, recentPoints[i].y);
            }
            this.ctx.stroke();
        }
    }
}

// Export for use in main.js
export { XYOscilloscope };