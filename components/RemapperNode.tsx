import React, { memo, useMemo, useEffect, useCallback } from 'react';
import { Handle, Position, NodeProps, useEdges, useReactFlow, useNodes } from 'reactflow';
import { PSDNodeData, SerializableLayer, TransformedPayload, TransformedLayer, MAX_BOUNDARY_VIOLATION_PERCENT, LayoutStrategy } from '../types';
import { useProceduralStore } from '../store/ProceduralContext';

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
  };
  target: {
    ready: boolean;
    name?: string;
    bounds?: any;
  };
  payload: TransformedPayload | null;
  strategyUsed?: boolean;
}

export const RemapperNode = memo(({ id, data }: NodeProps<PSDNodeData>) => {
  // Read instance count from persistent data, default to 1 if new/undefined
  const instanceCount = data.instanceCount || 1;
  
  const { setNodes } = useReactFlow();
  const edges = useEdges();
  const nodes = useNodes();
  
  // Consume data from Store
  const { templateRegistry, resolvedRegistry, registerPayload, unregisterNode } = useProceduralStore();

  // Cleanup
  useEffect(() => {
    return () => unregisterNode(id);
  }, [id, unregisterNode]);

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
                        aiStrategy: context.aiStrategy // Extract injected strategy if present
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
            
            payload = {
              status: 'success',
              sourceNodeId: sourceData.nodeId,
              sourceContainer: sourceData.name,
              targetContainer: targetData.name, // Will be originalName (e.g. "BG")
              layers: transformedLayers,
              scaleFactor: scale,
              metrics: {
                source: { w: sourceRect.w, h: sourceRect.h },
                target: { w: targetRect.w, h: targetRect.h }
              }
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
  }, [instanceCount, edges, id, resolvedRegistry, templateRegistry, nodes]);


  // Sync Payloads to Store
  useEffect(() => {
    instances.forEach(instance => {
        if (instance.payload) {
            registerPayload(id, `result-out-${instance.index}`, instance.payload);
        }
    });
  }, [instances, id, registerPayload]);

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
         <span className="text-[10px] text-indigo-400/70 font-mono">TRANSFORMER</span>
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
                             {/* Input Handle - Docked on the specific Input Box */}
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
                             {/* Input Handle - Docked on the specific Input Box */}
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
                <div className="relative mt-2 pt-3 border-t border-slate-700/50 flex items-center justify-between">
                   {instance.payload ? (
                       <div className="flex flex-col w-full pr-4">
                           <div className="flex justify-between items-center">
                               <div className="flex items-center space-x-2">
                                   <span className="text-[10px] text-emerald-400 font-bold tracking-wide">READY</span>
                                   {instance.strategyUsed && (
                                       <span className="text-[8px] bg-pink-500/20 text-pink-300 px-1 rounded border border-pink-500/40">AI ENHANCED</span>
                                   )}
                               </div>
                               <span className="text-[10px] text-slate-400 font-mono">{instance.payload.scaleFactor.toFixed(2)}x Scale</span>
                           </div>
                           <div className={`w-full h-1 rounded overflow-hidden mt-1 ${instance.strategyUsed ? 'bg-pink-900' : 'bg-slate-900'}`}>
                              <div className={`h-full ${instance.strategyUsed ? 'bg-pink-500' : 'bg-emerald-500'}`} style={{ width: '100%' }}></div>
                           </div>
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
                          instance.payload 
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