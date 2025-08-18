import { ScaleGenerator, ScaleParams } from "./modules/scaleGenerator.ts";
import { euclideanRhythm } from "./modules/euclidean.ts";

const sockets = new Set<WebSocket>();

function broadcast(data: any) {
  const message = JSON.stringify(data);
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(message);
    }
  }
}

async function handleWebSocket(request: Request): Promise<Response> {
  const { socket, response } = Deno.upgradeWebSocket(request);
  
  sockets.add(socket);
  
  socket.onopen = () => {
    console.log("WebSocket connected");
    socket.send(JSON.stringify({ 
      type: "connected",
      defaultParams: {
        edo: 12,
        noteCount: 7,
        rotation: 0,
        rootFreq: 261.63
      }
    }));
  };
  
  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case "generateScale": {
          const generator = new ScaleGenerator(data.params);
          const scale = generator.generateScale();
          
          const modes = [];
          for (let i = 0; i < scale.steps.length; i++) {
            modes.push(generator.getMode(scale, i));
          }
          
          socket.send(JSON.stringify({
            type: "scale",
            scale,
            modes
          }));
          break;
        }
        
        case "generateRhythm": {
          const { pulses, steps } = data.params;
          const pattern = euclideanRhythm(pulses, steps);
          
          socket.send(JSON.stringify({
            type: "rhythm",
            pattern,
            pulses,
            steps
          }));
          break;
        }
        
        case "generateTones": {
          const { edo, scaleNotes, scaleRotation, chordNotes, chordRotation, rootFreq, sequenceNotes, sequenceMethod, sequenceBase, sequenceOctaves, sequenceRotation } = data.params;
          
          // Generate base tones (all EDO frequencies)
          const baseTones: number[] = [];
          for (let i = 0; i <= edo; i++) {
            baseTones.push(rootFreq * Math.pow(2, i / edo));
          }
          
          // Generate scale using first Euclidean
          const scaleGenerator = new ScaleGenerator({
            edo,
            noteCount: scaleNotes,
            rotation: scaleRotation,
            rootFreq
          });
          const scale = scaleGenerator.generateScale();
          
          // Create array with same length as base tones, but only scale frequencies
          const scaleTones: number[] = new Array(edo + 1).fill(0);
          const scaleIndices: number[] = [];
          scale.steps.forEach(step => {
            if (step <= edo) {
              scaleTones[step] = baseTones[step];
              scaleIndices.push(step);
            }
          });
          
          // Generate chord tones using second Euclidean on scale tones
          // This works exactly like scale generation, but operating on scale space instead of EDO space
          const activeScaleTones = scale.steps.filter(s => s < edo);
          
          // Generate Euclidean pattern for selecting from scale
          const chordPattern = euclideanRhythm(chordNotes, activeScaleTones.length);
          
          // Convert pattern to positions in scale space
          const originalPositions: number[] = [];
          chordPattern.forEach((hasNote, index) => {
            if (hasNote) {
              originalPositions.push(index);
            }
          });
          
          // Calculate intervals in the original chord pattern
          const originalIntervals: number[] = [];
          for (let i = 0; i < originalPositions.length; i++) {
            const current = originalPositions[i];
            const next = originalPositions[(i + 1) % originalPositions.length];
            const interval = next > current ? next - current : activeScaleTones.length - current + next;
            originalIntervals.push(interval);
          }
          
          // Rotate through chord voicings (same approach as scale modes)
          const rotatedIntervals = [];
          if (chordRotation > 0 && originalIntervals.length > 0) {
            const rot = chordRotation % originalIntervals.length;
            rotatedIntervals.push(...originalIntervals.slice(rot));
            rotatedIntervals.push(...originalIntervals.slice(0, rot));
          } else {
            rotatedIntervals.push(...originalIntervals);
          }
          
          // Build the new chord from rotated intervals, starting from position 0
          const chordPositions: number[] = [0];
          let currentPosition = 0;
          for (let i = 0; i < rotatedIntervals.length - 1; i++) {
            currentPosition += rotatedIntervals[i];
            if (currentPosition < activeScaleTones.length) {
              chordPositions.push(currentPosition);
            }
          }
          
          // Map positions to actual chord tones
          const chordTones: number[] = new Array(edo + 1).fill(0);
          const chordIndices: number[] = [];
          
          chordPositions.forEach(position => {
            const step = activeScaleTones[position];
            chordTones[step] = baseTones[step];
            chordIndices.push(step);
          });
          
          // Add octave if it was in the scale
          if (scale.steps.includes(edo)) {
            chordTones[edo] = baseTones[edo];
            if (!chordIndices.includes(edo)) {
              chordIndices.push(edo);
            }
          }
          
          // Generate sequence tones
          let sequenceTones: number[] = new Array(edo + 1).fill(0);
          let sequenceIndices: number[] = [];
          
          if (sequenceNotes !== undefined && sequenceBase !== undefined && sequenceOctaves !== undefined) {
            // Calculate the octave range from base and octaves count
            const minOctave = sequenceBase;
            const maxOctave = sequenceBase + sequenceOctaves - 1;
            
            // Expand chord tones across octaves
            const expandedTones: number[] = [];
            const expandedPositions: number[] = [];
            
            for (let octave = minOctave; octave <= maxOctave; octave++) {
              chordIndices.forEach(index => {
                if (index < edo) { // Don't duplicate the octave boundary
                  const freq = baseTones[index] * Math.pow(2, octave);
                  expandedTones.push(freq);
                  expandedPositions.push(expandedTones.length - 1);
                }
              });
            }
            
            // Select subset using chosen method
            let selectedIndices: number[] = [];
            
            if (sequenceMethod === 'euclidean' && expandedTones.length > 0) {
              // Use Euclidean algorithm to select from expanded tones
              const numToSelect = Math.min(sequenceNotes, expandedTones.length);
              const pattern = euclideanRhythm(numToSelect, expandedTones.length);
              
              // Apply rotation if specified
              let rotatedPattern = [...pattern];
              if (sequenceRotation && sequenceRotation > 0) {
                const rot = sequenceRotation % expandedTones.length;
                rotatedPattern = [
                  ...pattern.slice(rot),
                  ...pattern.slice(0, rot)
                ];
              }
              
              rotatedPattern.forEach((select, i) => {
                if (select) {
                  selectedIndices.push(i);
                }
              });
            } else if (sequenceMethod === 'random' && expandedTones.length > 0) {
              // Random selection without replacement
              const numToSelect = Math.min(sequenceNotes, expandedTones.length);
              const available = [...Array(expandedTones.length).keys()];
              for (let i = 0; i < numToSelect; i++) {
                const randomIndex = Math.floor(Math.random() * available.length);
                selectedIndices.push(available[randomIndex]);
                available.splice(randomIndex, 1);
              }
              selectedIndices.sort((a, b) => a - b);
            }
            
            // Map selected indices to frequencies
            sequenceTones = expandedTones.map((freq, i) => 
              selectedIndices.includes(i) ? freq : 0
            );
            sequenceIndices = selectedIndices;
          }
          
          socket.send(JSON.stringify({
            type: "tones",
            baseTones,
            scaleTones,
            scaleIndices,
            chordTones,
            chordIndices,
            sequenceTones,
            sequenceIndices
          }));
          break;
        }
        
        case "playNote": {
          broadcast({
            type: "noteEvent",
            frequency: data.frequency,
            duration: data.duration || 200
          });
          break;
        }
      }
    } catch (error) {
      console.error("WebSocket message error:", error);
      socket.send(JSON.stringify({ 
        type: "error", 
        message: error.message 
      }));
    }
  };
  
  socket.onclose = () => {
    sockets.delete(socket);
    console.log("WebSocket disconnected");
  };
  
  return response;
}

async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  
  if (url.pathname === "/ws") {
    return handleWebSocket(request);
  }
  
  if (url.pathname === "/") {
    const html = await Deno.readTextFile("./index.html");
    return new Response(html, {
      headers: { "content-type": "text/html" }
    });
  }
  
  if (url.pathname === "/api/scale") {
    const params: ScaleParams = {
      edo: Number(url.searchParams.get("edo") || 12),
      noteCount: Number(url.searchParams.get("notes") || 7),
      rotation: Number(url.searchParams.get("rotation") || 0),
      rootFreq: Number(url.searchParams.get("freq") || 261.63)
    };
    
    const generator = new ScaleGenerator(params);
    const scale = generator.generateScale();
    
    return new Response(JSON.stringify(scale), {
      headers: { "content-type": "application/json" }
    });
  }
  
  return new Response("Not Found", { status: 404 });
}

const port = 8000;
console.log(`Euclidean Sequencer running on http://localhost:${port}`);

Deno.serve({ port }, handleRequest);