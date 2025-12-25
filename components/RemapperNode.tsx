import React, { memo, useMemo, useEffect, useCallback, useState } from 'react';
import { Handle, Position, NodeProps, useEdges, useReactFlow, useNodes } from 'reactflow';
import { PSDNodeData, SerializableLayer, TransformedPayload, TransformedLayer, MAX_BOUNDARY_VIOLATION_PERCENT, LayoutStrategy } from '../types';
import { useProceduralStore } from '../store/ProceduralContext';
import { GoogleGenAI } from "@google/genai";

interface InstanceData {
  index: number;
  source: {
    ready: boolean;
    name?: string;
    nodeId?: string;
    handleId?: string; // Added to track specific source handle
    originalBounds?: any;
    layers?: any[];
    aiStrategy?: LayoutStrategy; // Metadata injection from upstream
    previewUrl?: string; // Draft from Analyst
  };
  target: {
    ready: boolean;
    name?: string;
    bounds?: any;
  };
  payload: TransformedPayload | null;
  strategyUsed?: boolean;
}

// --- SUB-COMPONENT: Generative Preview Overlay ---
const GenerativePreviewOverlay = ({ 
    previewUrl, 
    isGenerating,
    scale 
}: { 
    previewUrl?: string | null; 
    isGenerating: boolean; 
    scale: number;
}) => {
    return (
        <div className={`relative w-full mt-2 rounded-md overflow-hidden bg-slate-900/50 border transition-all duration-500 ${isGenerating ? 'border-indigo-500/30' : 'border-purple-500/50 animate-pulse'} group`}>
             {/* Aspect Ratio Container - Expanded to 160px (h-40) for better visibility */}
             <div className="relative w-full h-40 flex items-center justify-center overflow-hidden">
                 
                 {/* 1. The Ghost Image */}
                 {previewUrl ? (
                     <div className="absolute inset-0 z-10">
                         {/* Stylized "Ghost" Rendering: Grayscale + Opacity + Screen Blend */}
                         <img 
                            src={previewUrl} 
                            alt="AI Ghost" 
                            className="w-full h-full object-cover opacity-50 grayscale-[0.3] mix-blend-screen filter blur-[0.5px] transition-all duration-700 group-hover:blur-0 group-hover:grayscale-0 group-hover:opacity-90"
                         />
                         <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 to-transparent"></div>
                         
                         {/* Tech Grid Overlay */}
                         <div className="absolute inset-0 opacity-20 bg-[linear-gradient(rgba(139,92,246,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(139,92,246,0.1)_1px,transparent_1px)] bg-[size:20px_20px] pointer-events-none"></div>
                     </div>
                 ) : (
                     <div className="absolute inset-0 flex items-center justify-center z-0">
                         <div className="text-[9px] text-purple-400/50 font-mono text-center px-4 animate-pulse">
                             {isGenerating ? 'SYNTHESIZING GHOST...' : 'INITIALIZING PREVIEW...'}
                         </div>
                     </div>
                 )}

                 {/* 2. Scanning Line Animation */}
                 {(isGenerating || previewUrl) && (
                     <div className="absolute inset-0 z-20 pointer-events-none overflow-hidden">
                         <div className="absolute top-0 left-0 w-full h-[2px] bg-purple-400 shadow-[0_0_10px_rgba(168,85,247,0.8)] animate-scan-y"></div>
                     </div>
                 )}

                 {/* 3. Status Badge */}
                 <div className="absolute bottom-2 left-2 z-30 flex items-center space-x-2">
                     <span className="text-[8px] bg-purple-900/80 text-purple-200 px-1.5 py-0.5 rounded border border-purple-500/50 backdrop-blur-sm shadow-[0_0_8px_rgba(168,85,247,0.4)]">
                         AI GHOST
                     </span>
                     {isGenerating && (
                         <span className="flex h-1.5 w-1.5 relative">
                             <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                             <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-purple-500"></span>
                         </span>
                     )}
                 </div>

                 {/* 4. Credit Cost Tooltip (Hover) */}
                 <div className="absolute inset-0 z-40 bg-black/60 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center p-4 text-center cursor-help">
                      <div className="bg-slate-800 border border-slate-600 rounded p-2 shadow-xl transform translate-y-2 group-hover:translate-y-0 transition-transform">
                          <p className="text-[10px] text-slate-200 font-bold mb-1">Confirm Generation?</p>
                          <p className="text-[9px] text-slate-400 leading-tight">
                              Synthesizing this high-res layer will cost <span className="text-emerald-400 font-bold">1 Credit</span>.
                          </p>
                      </div>
                 </div>
             </div>
             
             {/* Inline styles for custom scan animation if tailwind config missing */}
             <style>{`
               @keyframes scan-y {
                 0% { top: 0%; opacity: 0; }
                 10% { opacity: 1; }
                 90% { opacity: 1; }
                 100% { top: 100%; opacity: 0; }
               }
               .animate-scan-y {
                 animation: scan-y 2.5s linear infinite;
               }
             `}</style>
        </div>
    );
};

export const RemapperNode = memo(({ id, data }: NodeProps<PSDNodeData>) => {
  // Read instance count from persistent data, default to 1 if new/undefined
  const instanceCount = data.instanceCount || 1;
  const [confirmations, setConfirmations] = useState<Record<number, boolean>>({});
  
  // Local state for generated draft previews
  const [previews, setPreviews] = useState<Record<number, string>>({});
  const [isGeneratingPreview, setIsGeneratingPreview] = useState<Record<number, boolean>>({});

  const { setNodes } = useReactFlow();
  const edges = useEdges();
  const nodes = useNodes();
  
  // Consume data from Store
  const { templateRegistry, resolvedRegistry, registerPayload, unregisterNode, userCredits } = useProceduralStore();

  // Cleanup
  useEffect(() => {
    return () => unregisterNode(id);
  }, [id, unregisterNode]);

  // Handle Confirmation Toggle
  const handleConfirmGeneration = (index: number) => {
      setConfirmations(prev => ({ ...prev, [index]: true }));
  };

  // Compute Data for ALL Instances
  const instances: InstanceData[] = useMemo(() => {
    const result: InstanceData[] = [];

    // Find original LoadPSDNode to ensure the Export node can find the binary data
    const loadPsdNode = nodes.find(n => n.type === 'loadPsd');

    for (let i = 0; i < instanceCount; i++) {
        const sourceHandleId = `source-in-${i}`;
        const targetHandleId = `target-in-${i}`;

        // 1. Resolve Source
        let sourceData: any = { ready: false };
        const sourceEdge = edges.find(e => e.target === id && e.targetHandle === sourceHandleId);
        
        if (sourceEdge && sourceEdge.sourceHandle) {
             const resolvedData = resolvedRegistry[sourceEdge.source];
             if (resolvedData) {
                 const context = resolvedData[sourceEdge.sourceHandle];
                 if (context) {
                    const binarySourceId = loadPsdNode ? loadPsdNode.id : sourceEdge.source;
                    sourceData = {
                        ready: true,
                        name: context.container.containerName,
                        nodeId: binarySourceId,
                        sourceNodeId: sourceEdge.source,
                        handleId: sourceEdge.sourceHandle, // Important for strategy lookup
                        layers: context.layers,
                        originalBounds: context.container.bounds,
                        aiStrategy: context.aiStrategy, // Extract injected strategy if present
                        previewUrl: context.previewUrl // Extract upstream preview if present
                    };
                 }
             }
        }

        // 2. Resolve Target
        let targetData: any = { ready: false };
        const targetEdge = edges.find(e => e.target === id && e.targetHandle === targetHandleId);

        if (targetEdge && targetEdge.sourceHandle) {
             const template = templateRegistry[targetEdge.source];
             if (template) {
                 const handle = targetEdge.sourceHandle;
                 let containerDefinition;

                 // Strategy A: Exact Name Match (e.g. "BG")
                 containerDefinition = template.containers.find(c => c.name === handle);

                 // Strategy B: Bounds Prefix Match (e.g. "slot-bounds-BG")
                 if (!containerDefinition && handle.startsWith('slot-bounds-')) {
                     const clean = handle.replace('slot-bounds-', '');
                     containerDefinition = template.containers.find(c => c.name === clean);
                 }

                 // Strategy C: Indexed Handle Match (e.g. "target-out-0")
                 // This resolves proxy handles from DesignAnalystNode to the actual container by index
                 if (!containerDefinition) {
                     const indexMatch = handle.match(/^target-out-(\d+)$/);
                     if (indexMatch) {
                         const index = parseInt(indexMatch[1], 10);
                         // Access container by index if valid
                         if (template.containers[index]) {
                             containerDefinition = template.containers[index];
                         }
                     }
                 }

                 // Strategy D: Fallback for Single Container Templates
                 if (!containerDefinition && template.containers.length === 1) {
                     containerDefinition = template.containers[0];
                 }

                 if (containerDefinition) {
                     targetData = {
                         ready: true,
                         // CRITICAL: Prefer originalName (e.g., "BG") over name (e.g., "target-out-0").
                         // This ensures the payload carries the semantic name required by the Export node,
                         // even if the connection comes from a proxy node with synthetic naming.
                         name: containerDefinition.originalName || containerDefinition.name,
                         bounds: containerDefinition.bounds
                     };
                 }
             }
        }

        // 3. Compute Payload
        let payload: TransformedPayload | null = null;
        let strategyUsed = false;

        if (sourceData.ready && targetData.ready) {
            const sourceRect = sourceData.originalBounds;
            const targetRect = targetData.bounds;
            
            // MATH: Default Geometric Logic
            const ratioX = targetRect.w / sourceRect.w;
            const ratioY = targetRect.h / sourceRect.h;
            let scale = Math.min(ratioX, ratioY);
            let anchorX = targetRect.x;
            let anchorY = targetRect.y;

            // AI: Check for Strategy Injected in Source Data
            // This is the metadata injection pattern (Analyst -> Remapper)
            const strategy = sourceData.aiStrategy;
            
            if (strategy) {
                scale = strategy.suggestedScale;
                strategyUsed = true;
                
                const scaledW = sourceRect.w * scale;
                const scaledH = sourceRect.h * scale;

                // Horizontal Centering (Default)
                anchorX = targetRect.x + (targetRect.w - scaledW) / 2;

                // Vertical Anchor Logic
                if (strategy.anchor === 'TOP') {
                    anchorY = targetRect.y;
                } else if (strategy.anchor === 'BOTTOM') {
                    anchorY = targetRect.y + (targetRect.h - scaledH);
                } else {
                    anchorY = targetRect.y + (targetRect.h - scaledH) / 2;
                }
            } else {
                const scaledW = sourceRect.w * scale;
                const scaledH = sourceRect.h * scale;
                anchorX = targetRect.x + (targetRect.w - scaledW) / 2;
                anchorY = targetRect.y + (targetRect.h - scaledH) / 2;
            }

            // --- RECURSIVE TRANSFORMATION ENGINE ---
            const transformLayers = (
                layers: SerializableLayer[], 
                parentDeltaX: number = 0, 
                parentDeltaY: number = 0
            ): TransformedLayer[] => {
              return layers.map(layer => {
                // 1. Calculate Geometric Baseline (Global Relative)
                // This places the layer based on standard scaling/centering rules
                const relX = (layer.coords.x - sourceRect.x) / sourceRect.w;
                const relY = (layer.coords.y - sourceRect.y) / sourceRect.h;

                const geomX = anchorX + (relX * (sourceRect.w * scale));
                const geomY = anchorY + (relY * (sourceRect.h * scale));

                // 2. Apply Inherited Delta (Hierarchy Preservation)
                // If a parent moved, this layer moves with it by default
                let finalX = geomX + parentDeltaX;
                let finalY = geomY + parentDeltaY;
                
                let layerScaleX = scale;
                let layerScaleY = scale;

                // 3. Apply AI Overrides (Local-to-Global Injection)
                const override = strategy?.overrides?.find(o => o.layerId === layer.id);
                let currentDeltaX = parentDeltaX;
                let currentDeltaY = parentDeltaY;

                if (override) {
                   // Semantic Recomposition: AI dictates exact position in Target Context
                   // We switch to absolute anchoring based on Target Top-Left
                   const aiX = targetRect.x + override.xOffset;
                   const aiY = targetRect.y + override.yOffset;

                   // Override dictates the new position
                   finalX = aiX;
                   finalY = aiY;

                   // Calculate the NEW delta created by this override to pass to children
                   // This ensures children of an overridden group follow the group's new location
                   currentDeltaX = finalX - geomX;
                   currentDeltaY = finalY - geomY;

                   // Apply individual scale
                   layerScaleX *= override.individualScale;
                   layerScaleY *= override.individualScale;
                }

                // 4. Boundary Enforcement (Clamping)
                const bleedY = targetRect.h * MAX_BOUNDARY_VIOLATION_PERCENT;
                const minY = targetRect.y - bleedY;
                const maxY = targetRect.y + targetRect.h + bleedY;

                // Clamp Y to prevent flying off canvas
                finalY = Math.max(minY, Math.min(finalY, maxY));

                const newW = layer.coords.w * layerScaleX;
                const newH = layer.coords.h * layerScaleY;

                return {
                  ...layer,
                  coords: { x: finalX, y: finalY, w: newW, h: newH },
                  transform: {
                    scaleX: layerScaleX,
                    scaleY: layerScaleY,
                    offsetX: finalX,
                    offsetY: finalY
                  },
                  children: layer.children 
                    ? transformLayers(layer.children, currentDeltaX, currentDeltaY) 
                    : undefined
                };
              });
            };

            const transformedLayers = transformLayers(sourceData.layers as SerializableLayer[]);

            // --- GENERATIVE INJECTION LOGIC GATE (WITH CREDIT VALIDATION) ---
            let requiresGeneration = false;
            let status: TransformedPayload['status'] = 'success';
            let generativePromptUsed = null;

            if (sourceData.aiStrategy?.generativePrompt) {
                const scaleThreshold = 2.0; // 200% stretch safety limit
                const isExplicit = sourceData.aiStrategy.isExplicitIntent;
                const isHighStretch = scale > scaleThreshold;
                const isConfirmed = confirmations[i];
                const hasCredits = userCredits > 0;

                if (isExplicit) {
                    // Explicit User Intent ("generate", "recreate") -> Trust but Verify Credits
                    if (hasCredits) {
                        requiresGeneration = true;
                        generativePromptUsed = sourceData.aiStrategy.generativePrompt;
                    } else {
                        status = 'error'; // Block generation if no credits
                        // We do not set requiresGeneration to true, forcing fallback to geometric or error display
                    }
                } else if (isHighStretch) {
                    // Implicit Fallback High Stretch -> Require Confirmation
                    if (isConfirmed) {
                        if (hasCredits) {
                            requiresGeneration = true;
                            generativePromptUsed = sourceData.aiStrategy.generativePrompt;
                        } else {
                            status = 'error';
                        }
                    } else {
                        status = 'awaiting_confirmation';
                    }
                }
            }

            // Only inject the layer if the GATE opened (requiresGeneration is true)
            if (requiresGeneration && generativePromptUsed) {
                const genLayer: TransformedLayer = {
                    id: `gen-layer-${sourceData.name || 'unknown'}`,
                    name: `✨ AI Gen: ${generativePromptUsed.substring(0, 20)}...`,
                    type: 'generative',
                    isVisible: true,
                    opacity: 1,
                    coords: {
                        x: targetRect.x,
                        y: targetRect.y,
                        w: targetRect.w,
                        h: targetRect.h
                    },
                    transform: {
                        scaleX: 1,
                        scaleY: 1,
                        offsetX: targetRect.x,
                        offsetY: targetRect.y
                    },
                    generativePrompt: generativePromptUsed
                };
                
                // Prepend to ensure it acts as a background/fill base
                transformedLayers.unshift(genLayer);
            }
            
            payload = {
              status: status,
              sourceNodeId: sourceData.nodeId,
              sourceContainer: sourceData.name,
              targetContainer: targetData.name, // Will be originalName (e.g. "BG")
              layers: transformedLayers,
              scaleFactor: scale,
              metrics: {
                source: { w: sourceRect.w, h: sourceRect.h },
                target: { w: targetRect.w, h: targetRect.h }
              },
              requiresGeneration: requiresGeneration,
              // Attach any generated preview URL for persistence/usage
              // PRIORITIZE UPSTREAM PREVIEW if available
              previewUrl: sourceData.previewUrl || previews[i]
            };
        }

        result.push({
            index: i,
            source: sourceData,
            target: targetData,
            payload,
            strategyUsed
        });
    }

    return result;
  }, [instanceCount, edges, id, resolvedRegistry, templateRegistry, nodes, confirmations, userCredits, previews]);


  // Sync Payloads to Store
  useEffect(() => {
    instances.forEach(instance => {
        if (instance.payload) {
            registerPayload(id, `result-out-${instance.index}`, instance.payload);
        }
    });
  }, [instances, id, registerPayload]);

  // LAZY SYNTHESIS: Generate Drafts when AWAITING_CONFIRMATION
  useEffect(() => {
    instances.forEach(instance => {
        const needsPreview = instance.payload?.status === 'awaiting_confirmation' && 
                             instance.payload.requiresGeneration === false; 
        
        const hasPrompt = !!instance.source.aiStrategy?.generativePrompt;
        const isAwaiting = instance.payload?.status === 'awaiting_confirmation';
        
        // Skip if preview already exists (either from upstream or local)
        const existingPreview = instance.payload?.previewUrl;

        // Only generate if we haven't already and aren't currently generating AND no upstream preview
        if (isAwaiting && hasPrompt && !existingPreview && !isGeneratingPreview[instance.index]) {
             const prompt = instance.source.aiStrategy!.generativePrompt;
             
             const generateDraft = async () => {
                 setIsGeneratingPreview(prev => ({...prev, [instance.index]: true}));
                 
                 try {
                     const apiKey = process.env.API_KEY;
                     if (!apiKey) return;
                     
                     const ai = new GoogleGenAI({ apiKey });
                     // Use gemini-2.5-flash-image for fast drafts
                     const response = await ai.models.generateContent({
                        model: 'gemini-2.5-flash-image',
                        contents: { parts: [{ text: prompt }] },
                        config: {
                             imageConfig: {
                                // Request square aspect ratio for preview box usually
                                aspectRatio: "1:1"
                             }
                        }
                     });
                     
                     // Extract base64
                     let base64Data = null;
                     for (const part of response.candidates?.[0]?.content?.parts || []) {
                        if (part.inlineData) {
                            base64Data = part.inlineData.data;
                            break;
                        }
                     }
                     
                     if (base64Data) {
                         const url = `data:image/png;base64,${base64Data}`;
                         setPreviews(prev => ({...prev, [instance.index]: url}));
                     }

                 } catch (e) {
                     console.error("Draft Generation Failed", e);
                 } finally {
                     setIsGeneratingPreview(prev => ({...prev, [instance.index]: false}));
                 }
             };
             
             generateDraft();
        }
    });
  }, [instances, previews, isGeneratingPreview]);


  const addInstance = useCallback(() => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          return {
            ...node,
            data: {
              ...node.data,
              instanceCount: (node.data.instanceCount || 1) + 1,
            },
          };
        }
        return node;
      })
    );
  }, [id, setNodes]);

  return (
    // Removed overflow-hidden from root to prevent handle clipping
    <div className="min-w-[280px] bg-slate-800 rounded-lg shadow-xl border border-indigo-500/50 font-sans relative flex flex-col">
      
      {/* Header */}
      <div className="bg-indigo-900/80 p-2 border-b border-indigo-800 flex items-center justify-between shrink-0 rounded-t-lg">
         <div className="flex items-center space-x-2">
           <svg className="w-4 h-4 text-indigo-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
           </svg>
           <span className="text-sm font-semibold text-indigo-100">Procedural Remapper</span>
         </div>
         <div className="flex flex-col items-end">
             <span className="text-[10px] text-indigo-400/70 font-mono">TRANSFORMER</span>
             <span className={`text-[9px] font-bold ${userCredits > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                 {userCredits} Credits
             </span>
         </div>
      </div>

      {/* Instances List */}
      <div className="flex flex-col">
          {instances.map((instance) => (
             <div key={instance.index} className="relative p-3 border-b border-slate-700/50 bg-slate-800 space-y-3 hover:bg-slate-700/20 transition-colors first:rounded-t-none">
                
                {/* Inputs Row */}
                <div className="flex flex-col space-y-3">
                   {/* Source Input Row */}
                   <div className="relative flex items-center justify-between group">
                      <div className="flex flex-col w-full">
                          <div className="flex items-center justify-between mb-0.5">
                             <label className="text-[9px] uppercase text-slate-500 font-bold tracking-wider ml-1">Source Input</label>
                             {instance.source.ready && <span className="text-[8px] text-blue-400 font-mono">LINKED</span>}
                          </div>
                          
                          <div className={`relative text-xs px-3 py-1.5 rounded border transition-colors ${
                             instance.source.ready 
                               ? 'bg-indigo-900/30 border-indigo-500/30 text-indigo-200 shadow-sm' 
                               : 'bg-slate-900 border-slate-700 text-slate-500 italic'
                           }`}>
                             <Handle 
                                type="target" 
                                position={Position.Left} 
                                id={`source-in-${instance.index}`} 
                                className={`!w-3 !h-3 !-left-4 !border-2 z-50 transition-colors duration-200 ${
                                    instance.source.ready 
                                    ? '!bg-indigo-500 !border-white' 
                                    : '!bg-slate-700 !border-slate-500 group-hover:!bg-slate-600'
                                }`} 
                                style={{ top: '50%', transform: 'translateY(-50%)' }}
                                title={`Source for Instance ${instance.index}`}
                              />
                             {instance.source.ready ? instance.source.name : 'Connect Source...'}
                          </div>
                      </div>
                   </div>

                   {/* Target Slot Row */}
                   <div className="relative flex items-center justify-between group">
                      <div className="flex flex-col w-full">
                          <div className="flex items-center justify-between mb-0.5">
                             <label className="text-[9px] uppercase text-slate-500 font-bold tracking-wider ml-1">Target Slot</label>
                             {instance.target.ready && <span className="text-[8px] text-emerald-400 font-mono">LINKED</span>}
                          </div>

                          <div className={`relative text-xs px-3 py-1.5 rounded border transition-colors ${
                             instance.target.ready 
                               ? 'bg-emerald-900/20 border-emerald-500/30 text-emerald-300 shadow-sm' 
                               : 'bg-slate-900 border-slate-700 text-slate-500 italic'
                           }`}>
                             <Handle 
                                type="target" 
                                position={Position.Left} 
                                id={`target-in-${instance.index}`} 
                                className={`!w-3 !h-3 !-left-4 !border-2 z-50 transition-colors duration-200 ${
                                    instance.target.ready 
                                    ? '!bg-emerald-500 !border-white' 
                                    : '!bg-slate-700 !border-slate-500 group-hover:!bg-slate-600'
                                }`} 
                                style={{ top: '50%', transform: 'translateY(-50%)' }}
                                title={`Target for Instance ${instance.index}`}
                              />
                             {instance.target.ready ? instance.target.name : 'Connect Target...'}
                          </div>
                      </div>
                   </div>
                </div>

                {/* Status Bar / Output */}
                <div className="relative mt-2 pt-3 border-t border-slate-700/50 flex flex-col space-y-2">
                   {instance.payload ? (
                       <div className="flex flex-col w-full pr-4">
                           <div className="flex justify-between items-center">
                               <div className="flex items-center space-x-2">
                                   <span className="text-[10px] text-emerald-400 font-bold tracking-wide">READY</span>
                                   {instance.strategyUsed && (
                                       <span className="text-[8px] bg-pink-500/20 text-pink-300 px-1 rounded border border-pink-500/40">AI ENHANCED</span>
                                   )}
                                   {instance.payload.requiresGeneration && (
                                       <span className="text-[8px] bg-purple-500/20 text-purple-300 px-1 rounded border border-purple-500/40">GEN</span>
                                   )}
                               </div>
                               <span className="text-[10px] text-slate-400 font-mono">{instance.payload.scaleFactor.toFixed(2)}x Scale</span>
                           </div>
                           
                           <div className={`w-full h-1 rounded overflow-hidden mt-1 ${instance.strategyUsed ? 'bg-pink-900' : 'bg-slate-900'}`}>
                              <div className={`h-full ${instance.strategyUsed ? 'bg-pink-500' : 'bg-emerald-500'}`} style={{ width: '100%' }}></div>
                           </div>
                           
                           {/* Confirmation & Sandboxing UI */}
                           {instance.payload.status === 'awaiting_confirmation' && (
                               <div className="mt-2 p-2 bg-yellow-900/30 border border-yellow-700/50 rounded flex flex-col space-y-2">
                                   <span className="text-[9px] text-yellow-200 font-medium leading-tight">
                                       ⚠️ Extreme stretch detected. Previewing Generative Fill below.
                                   </span>
                                   
                                   {/* Generative Preview Sandbox */}
                                   <GenerativePreviewOverlay 
                                       previewUrl={previews[instance.index]}
                                       isGenerating={!!isGeneratingPreview[instance.index]}
                                       scale={instance.payload.scaleFactor}
                                   />

                                   {userCredits > 0 ? (
                                       <button 
                                          onClick={() => handleConfirmGeneration(instance.index)}
                                          className="py-1 px-2 bg-yellow-600 hover:bg-yellow-500 text-white text-[9px] font-bold rounded uppercase tracking-wider transition-colors shadow-sm mt-1"
                                       >
                                          Confirm AI Generation
                                       </button>
                                   ) : (
                                       <div className="py-1 px-2 bg-red-900/40 border border-red-500 text-red-200 text-[9px] font-bold rounded uppercase tracking-wider text-center shadow-sm flex items-center justify-center space-x-1 mt-1">
                                           <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                           </svg>
                                           <span>INSUFFICIENT CREDITS</span>
                                       </div>
                                   )}
                               </div>
                           )}

                           {/* Credit Error UI (Explicit Intent Failure) */}
                           {instance.payload.status === 'error' && (
                               <div className="mt-2 p-2 bg-red-900/30 border border-red-700/50 rounded flex flex-col space-y-1">
                                    <span className="text-[9px] text-red-200 font-bold uppercase">
                                        Insufficient Credits
                                    </span>
                                    <span className="text-[9px] text-red-300">
                                        Generative fill required but wallet is empty.
                                    </span>
                               </div>
                           )}
                       </div>
                   ) : (
                       <div className="flex items-center space-x-2 opacity-50">
                           <svg className="w-3 h-3 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                           <span className="text-[10px] text-slate-500 italic">Waiting for connection...</span>
                       </div>
                   )}
                   
                   <Handle 
                      type="source" 
                      position={Position.Right} 
                      id={`result-out-${instance.index}`} 
                      className={`!w-3 !h-3 !-right-1.5 !border-2 transition-colors duration-300 z-50 ${
                          instance.payload && instance.payload.status !== 'error' 
                          ? '!bg-emerald-500 !border-white' 
                          : '!bg-slate-700 !border-slate-500'
                      }`} 
                      style={{ top: '50%', transform: 'translateY(-50%)' }}
                      title={`Output Payload ${instance.index}`} 
                   />
                </div>
             </div>
          ))}
      </div>

      <button 
        onClick={addInstance}
        className="w-full py-2 bg-slate-800 hover:bg-slate-700 border-t border-slate-700 text-slate-400 hover:text-slate-200 transition-colors flex items-center justify-center space-x-1 rounded-b-lg"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        <span className="text-[10px] font-medium uppercase tracking-wider">Add Remap Instance</span>
      </button>

    </div>
  );
});