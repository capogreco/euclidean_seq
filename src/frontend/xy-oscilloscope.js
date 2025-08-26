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
    constructor(canvasId, appState) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.appState = appState;
        
        // Set up canvas dimensions based on container
        this.setupCanvas();
        
        // Audio analysis nodes
        this.analyserX = null;
        this.analyserY = null;
        this.bufferLengthX = 0;
        this.bufferLengthY = 0;
        this.dataArrayX = null;
        this.dataArrayY = null;
        
        // Alternative: use splitter and connect to main output for debugging
        this.splitterNode = null;
        this.analyserMain = null;
        this.formantSplitter = null;
        
        // DC removal (high-pass filtering) for centering signals
        this.dcRemovalX = { x1: 0, y1: 0, alpha: 0.995 };
        this.dcRemovalY = { x1: 0, y1: 0, alpha: 0.995 };
        
        // Visualization settings
        this.gain = 3.0;
        this.trail = [];
        this.isRunning = false;
        this.samplesPerFrame = 256; // How many sample points to plot per frame
        this.sampleOffset = 0; // Offset into the buffer for time evolution
        // Phase control is now handled at the DSP level in the synthesizers
        
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
        // Match page background
        this.ctx.fillStyle = '#1a1a1a';
        this.ctx.fillRect(0, 0, this.drawWidth, this.drawHeight);
        this.drawGrid();
    }
    
    drawGrid() {
        // Clean background - no grid elements
        // Just a plain black background for minimal distraction
    }
    
    connectToSynthesizer(synthNode) {
        if (!synthNode) {
            console.warn('🔬 Cannot connect oscilloscope - no synth node');
            return false;
        }
        
        console.log('🔬 Connecting oscilloscope to synthesizer:', synthNode);
        
        // Disconnect existing analyzers
        this.disconnect();
        
        // Get current axis assignments from state
        const xAxis = this.appState.get('scopeXAxis'); // 'f1', 'f2', 'f3'
        const yAxis = this.appState.get('scopeYAxis');
        
        // Map formant names to channel indices (Ch2=F1, Ch3=F2, Ch4=F3)
        const channelMap = { f1: 2, f2: 3, f3: 4 };
        const xChannel = channelMap[xAxis];
        const yChannel = channelMap[yAxis];
        
        console.log(`🔬 Mapping axes: X=${xAxis}->Ch${xChannel}, Y=${yAxis}->Ch${yChannel}`);
        
        try {
            // Strategy 1: Try to connect to individual formant channels (2-4)
            // AudioWorkletNodes with 6 channels will have numberOfOutputs = 1
            console.log('🔬 Multi-channel connection attempt...');
            console.log(`🔬 Node outputs: ${synthNode.numberOfOutputs}, Channel count info:`, synthNode.channelCount);
            
            this.analyserX = audioContext.createAnalyser();
            this.analyserY = audioContext.createAnalyser();
            
            this.analyserX.fftSize = 512;
            this.analyserX.smoothingTimeConstant = 0.3;
            this.analyserY.fftSize = 512;
            this.analyserY.smoothingTimeConstant = 0.3;
            
            try {
                // For AudioWorkletNode with multiple channels, we need a splitter
                const splitter = audioContext.createChannelSplitter(6);
                synthNode.connect(splitter, 0, 0); // Connect output 0 to splitter input
                
                // Connect the correct formant channels to analyzers
                splitter.connect(this.analyserX, xChannel, 0); // xChannel -> analyserX
                splitter.connect(this.analyserY, yChannel, 0); // yChannel -> analyserY
                
                this.bufferLengthX = this.analyserX.frequencyBinCount;
                this.bufferLengthY = this.analyserY.frequencyBinCount;
                this.dataArrayX = new Float32Array(this.bufferLengthX);
                this.dataArrayY = new Float32Array(this.bufferLengthY);
                
                // Store splitter reference for cleanup
                this.formantSplitter = splitter;
                
                console.log('✅ Multi-channel connection successful');
                
                // Auto-start the oscilloscope if not already running
                if (!this.isRunning) {
                    this.start();
                    console.log('🔬 Auto-started oscilloscope');
                }
                
                return true;
            } catch (e) {
                console.warn('❌ Multi-channel connection failed:', e);
            }
            
            // Strategy 2: Fallback to main output with channel splitter
            console.log('🔬 Fallback: Connecting to main output with splitter...');
            
            this.splitterNode = audioContext.createChannelSplitter(2);
            this.analyserX = audioContext.createAnalyser();
            this.analyserY = audioContext.createAnalyser();
            
            this.analyserX.fftSize = 512;
            this.analyserX.smoothingTimeConstant = 0.3;
            this.analyserY.fftSize = 512;
            this.analyserY.smoothingTimeConstant = 0.3;
            
            // Connect main output to splitter, then to analyzers
            synthNode.connect(this.splitterNode, 0, 0);
            this.splitterNode.connect(this.analyserX, 0, 0);
            this.splitterNode.connect(this.analyserY, 1, 0);
            
            this.bufferLengthX = this.analyserX.frequencyBinCount;
            this.bufferLengthY = this.analyserY.frequencyBinCount;
            this.dataArrayX = new Float32Array(this.bufferLengthX);
            this.dataArrayY = new Float32Array(this.bufferLengthY);
            
            console.log('✅ Splitter connection successful');
            return true;
            
        } catch (error) {
            console.error('❌ Failed to connect oscilloscope:', error);
            return false;
        }
    }
    
    disconnect() {
        if (this.analyserX) {
            this.analyserX.disconnect();
            this.analyserX = null;
        }
        if (this.analyserY) {
            this.analyserY.disconnect();
            this.analyserY = null;
        }
        if (this.splitterNode) {
            this.splitterNode.disconnect();
            this.splitterNode = null;
        }
        if (this.formantSplitter) {
            this.formantSplitter.disconnect();
            this.formantSplitter = null;
        }
        this.dataArrayX = null;
        this.dataArrayY = null;
    }
    
    start() {
        if (!this.analyserX || !this.analyserY) {
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
    
    
    // Reconnect to synthesizer with updated axis mappings
    reconnectWithNewAxes(synthNode) {
        const wasRunning = this.isRunning;
        if (wasRunning) this.stop();
        
        const connected = this.connectToSynthesizer(synthNode);
        
        if (connected && wasRunning) {
            this.start();
        }
        
        return connected;
    }
    
    setSamplesPerFrame(samples) {
        this.samplesPerFrame = Math.max(2, Math.min(256, Math.floor(samples)));
    }
    
    // Simple DC removal using a high-pass filter
    removeDC(input, filter) {
        // First-order high-pass filter: y[n] = alpha * (y[n-1] + x[n] - x[n-1])
        const output = filter.alpha * (filter.y1 + input - filter.x1);
        filter.x1 = input;
        filter.y1 = output;
        return output;
    }
    
    // Phase control methods have been removed - phase is now controlled at the DSP level
    
    animate() {
        if (!this.isRunning) return;
        
        // Get time domain data (waveform) from both selected axis channels
        this.analyserX.getFloatTimeDomainData(this.dataArrayX);
        this.analyserY.getFloatTimeDomainData(this.dataArrayY);
        
        // Plot consecutive instantaneous sample points per frame
        const maxRadius = Math.min(this.centerX, this.centerY) * 0.8;
        const bufferLength = Math.min(this.bufferLengthX, this.bufferLengthY);
        
        // Ensure we don't try to sample more than the buffer size
        const actualSamplesPerFrame = Math.min(this.samplesPerFrame, bufferLength);

        // --- START of code to replace ---

        // This new block creates a temporary array for the current frame's data.
        const framePoints = [];

        for (let i = 0; i < actualSamplesPerFrame; i++) {
            const baseOffset = Math.floor(this.sampleOffset);
            const sampleIndex = (baseOffset + i) % bufferLength;
            
            let xSample = this.dataArrayX[sampleIndex];
            let ySample = this.dataArrayY[sampleIndex];
            
            // Apply DC removal (high-pass filter) to center signals around zero
            // xSample = this.removeDC(xSample, this.dcRemovalX); // DISABLED: Stage 1 centering
            // ySample = this.removeDC(ySample, this.dcRemovalY); // DISABLED: Stage 1 centering
            
            xSample = Math.max(-1, Math.min(1, xSample));
            ySample = Math.max(-1, Math.min(1, ySample));
            
            // Convert to screen coordinates (bipolar: -1 to +1 maps to full screen range)
            const x = this.centerX + (xSample * this.gain * maxRadius); // Canvas centering enabled
            const y = this.centerY - (ySample * this.gain * maxRadius); // Canvas centering enabled
            
            // Add the point to this frame's temporary array.
            framePoints.push({ x, y });
        }

        // Replace the trail with the current frame (single frame operation)
        this.trail = [framePoints];

        // Evolve sample offset.
        this.sampleOffset = (this.sampleOffset + actualSamplesPerFrame) % bufferLength;

        // --- END of code to replace ---
        
        // Debug output removed for cleaner console
        
        this.draw();
        
        this.animationId = requestAnimationFrame(() => this.animate());
    }
    
    draw() {
        // Clear canvas with page background color
        this.ctx.fillStyle = '#1a1a1a';
        this.ctx.fillRect(0, 0, this.drawWidth, this.drawHeight);
        
        // Redraw grid
        this.drawGrid();
        
        if (this.trail.length === 0 || !this.trail[0]) return;

        // --- SIMPLIFIED SINGLE FRAME DRAWING ---
        const frame = this.trail[0];
        if (frame.length < 2) return;

        this.ctx.strokeStyle = '#ffffff'; // White lines for clean visibility
        this.ctx.lineWidth = 1;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        
        // Draw the current frame as a continuous path
        this.ctx.beginPath();
        this.ctx.moveTo(frame[0].x, frame[0].y);
        
        for (let i = 1; i < frame.length; i++) {
            this.ctx.lineTo(frame[i].x, frame[i].y);
        }
        
        this.ctx.stroke();
        
    }
    
    // Phase display removed - phase values are shown on UI sliders
}

// Export for use in main.js
export { XYOscilloscope };