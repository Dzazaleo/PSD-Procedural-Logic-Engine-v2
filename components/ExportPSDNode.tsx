import React, { memo, useState, useMemo } from 'react';
import { Handle, Position, NodeProps, useEdges } from 'reactflow';
import { TransformedLayer, TransformedPayload } from '../types';
import { useProceduralStore } from '../store/ProceduralContext';
import { findLayerByPath, writePsdFile } from '../services/psdService';
import { Layer, Psd } from 'ag-psd';

export const ExportPSDNode = memo(({ id }: NodeProps) => {
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const edges = useEdges();
  
  // Access global registries for binary data (Original PSDs) and Payload Data
  const { psdRegistry, templateRegistry, payloadRegistry } = useProceduralStore();

  // 1. Resolve Connected Target Template from Store via Edge Source
  const templateMetadata = useMemo(() => {
    const edge = edges.find(e => e.target === id && e.targetHandle === 'template-input');
    if (!edge) return null;
    return templateRegistry[edge.source];
  }, [edges, id, templateRegistry]);

  const containers = templateMetadata?.containers || [];

  // 2. Map Connections to Payloads from Store with Strict Validation
  const { slotConnections, validationErrors } = useMemo(() => {
    const map = new Map<string, TransformedPayload>();
    const errors: string[] = [];
    
    edges.forEach(edge => {
      if (edge.target !== id) return;
      
      // Look for edges connected to our dynamic input handles (e.g., input-SYMBOLS)
      if (!edge.targetHandle?.startsWith('input-')) return;

      // Extract container name from handle ID (e.g. "SYMBOLS")
      const slotName = edge.targetHandle.replace('input-', '');
      
      // Fetch payload from store using source node ID AND source Handle ID
      const sourceNodePayloads = payloadRegistry[edge.source];
      const payload = sourceNodePayloads ? sourceNodePayloads[edge.sourceHandle || ''] : undefined;

      if (payload) {
         // SOURCE OF TRUTH: Payload.targetContainer
         // We use the payload's internal intent to validate the visual wiring.
         const semanticTarget = payload.targetContainer;

         if (semanticTarget === slotName) {
             map.set(slotName, payload);
         } else {
             // FALLBACK: Mismatch detected - Strictly enforce procedural integrity
             const msg = `PROCEDURAL VIOLATION: Payload targeting '${semanticTarget}' is miswired to slot '${slotName}'.`;
             console.error(msg);
             errors.push(msg);
         }
      }
    });

    return { slotConnections: map, validationErrors: errors };
  }, [edges, id, payloadRegistry]);

  // 3. Status Calculation
  const totalSlots = containers.length;
  const filledSlots = slotConnections.size;
  const isTemplateReady = !!templateMetadata;
  
  // Enable export only when all slots defined in the template are filled AND no validation errors exist
  const isFullyAssembled = isTemplateReady && filledSlots === totalSlots && totalSlots > 0 && validationErrors.length === 0;
  
  // 4. Export Logic
  const handleExport = async () => {
    if (!templateMetadata || !isFullyAssembled) return;
    
    setIsExporting(true);
    setExportError(null);

    try {
      // A. Initialize New PSD Structure
      const newPsd: Psd = {
        width: templateMetadata.canvas.width,
        height: templateMetadata.canvas.height,
        children: [],
        canvasState: undefined // Clear source canvas state if any
      };

      // B. Helper to recursively clone and transform layers
      const reconstructHierarchy = (
        transformedLayers: TransformedLayer[], 
        sourcePsd: Psd
      ): Layer[] => {
        const resultLayers: Layer[] = [];

        for (const metaLayer of transformedLayers) {
            // Find original heavy layer using the deterministic ID
            const originalLayer = findLayerByPath(sourcePsd, metaLayer.id);
            
            if (originalLayer) {
                const newLayer: Layer = {
                    ...originalLayer, // PRESERVE PROPERTIES: opacity, blendMode, etc.
                    top: metaLayer.coords.y,
                    left: metaLayer.coords.x,
                    bottom: metaLayer.coords.y + metaLayer.coords.h,
                    right: metaLayer.coords.x + metaLayer.coords.w,
                    hidden: !metaLayer.isVisible,
                    opacity: metaLayer.opacity * 255, // Convert back to 0-255
                    children: undefined // Explicitly cleared, repopulated below if group
                };

                // RECURSIVE GROUP DETECTION
                if (metaLayer.type === 'group' && metaLayer.children) {
                    newLayer.children = reconstructHierarchy(metaLayer.children, sourcePsd);
                    newLayer.opened = true; // Ensure groups are expanded in the output
                }

                resultLayers.push(newLayer);
            }
        }
        return resultLayers;
      };

      // C. Process each Payload and Construct Final Hierarchy
      const finalChildren: Layer[] = [];

      // Iterate via template containers to maintain a deterministic order
      for (const container of containers) {
          const payload = slotConnections.get(container.name);
          
          if (payload) {
              const sourcePsd = psdRegistry[payload.sourceNodeId];
              if (!sourcePsd) {
                  throw new Error(`Binary PSD data missing for source node: ${payload.sourceNodeId}. Please reload the source file.`);
              }

              const reconstructedContent = reconstructHierarchy(payload.layers, sourcePsd);
              
              // WRAP IN CONTAINER GROUP
              // Creates a top-level folder (e.g. !!BG) to match source/template structure
              const containerGroup: Layer = {
                  name: container.originalName,
                  children: reconstructedContent,
                  opened: true,
                  top: container.bounds.y,
                  left: container.bounds.x,
                  bottom: container.bounds.y + container.bounds.h,
                  right: container.bounds.x + container.bounds.w,
              };

              finalChildren.push(containerGroup);
          }
      }

      newPsd.children = finalChildren;

      // D. Write to File
      await writePsdFile(newPsd, `PROCEDURAL_EXPORT_${Date.now()}.psd`);

    } catch (e: any) {
        console.error("Export Failed:", e);
        setExportError(e.message || "Unknown export error");
    } finally {
        setIsExporting(false);
    }
  };

  return (
    <div className="min-w-[300px] bg-slate-900 rounded-lg shadow-2xl border border-indigo-500 overflow-hidden font-sans">
      
      {/* Header Area */}
      <div className="relative bg-slate-800/50 p-2 border-b border-slate-700">
         <div className="flex items-center space-x-2 mb-2">
             <div className="p-1.5 bg-indigo-500/20 rounded-full border border-indigo-500/50">
                 <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                 </svg>
             </div>
             <div>
                <h3 className="text-sm font-bold text-slate-100 leading-none">Export PSD</h3>
                <span className="text-[10px] text-slate-400">Synthesis Engine</span>
             </div>
         </div>
         
         {/* Template Input Handle & Status */}
         <div className="relative pl-4 py-1 flex items-center">
             <Handle 
               type="target" 
               position={Position.Left} 
               id="template-input" 
               className="!w-3 !h-3 !-left-1.5 !bg-emerald-500 !border-2 !border-slate-800" 
               title="Target Template Definition"
             />
             <span className={`text-xs font-mono ${isTemplateReady ? 'text-emerald-400' : 'text-slate-500 italic'}`}>
                {isTemplateReady ? `${templateMetadata?.canvas.width}x${templateMetadata?.canvas.height} px` : 'Connect Template...'}
             </span>
         </div>
      </div>

      {/* Dynamic Slots Area */}
      <div className="bg-slate-900 p-2 space-y-1 max-h-64 overflow-y-auto custom-scrollbar">
          {!isTemplateReady ? (
              <div className="text-[10px] text-slate-500 text-center py-4 border border-dashed border-slate-800 rounded mx-2 my-2">
                  Waiting for Target Template...
              </div>
          ) : (
              containers.map(container => {
                  const isFilled = slotConnections.has(container.name);
                  
                  return (
                      <div 
                        key={container.id} 
                        className={`relative flex items-center justify-between p-2 pl-4 rounded border transition-colors ${
                            isFilled 
                            ? 'bg-indigo-900/20 border-indigo-500/30' 
                            : 'bg-slate-800/50 border-slate-700/50'
                        }`}
                      >
                          {/* Dynamic Handle for each container slot */}
                          <Handle 
                            type="target" 
                            position={Position.Left} 
                            id={`input-${container.name}`}
                            className={`!w-3 !h-3 !-left-1.5 !border-2 transition-colors duration-200 ${
                                isFilled 
                                ? '!bg-indigo-500 !border-white' // High contrast white border when active
                                : '!bg-slate-700 !border-slate-500'
                            }`}
                            title={`Input for ${container.name}`} 
                          />
                          
                          <span className={`text-xs font-medium truncate flex-1 mr-2 ${isFilled ? 'text-indigo-200' : 'text-slate-400'}`}>
                              {container.name}
                          </span>
                          
                          {/* Visual Indicator */}
                          {isFilled ? (
                              <svg className="w-3 h-3 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                          ) : (
                              <span className="text-[9px] text-slate-600">Empty</span>
                          )}
                      </div>
                  );
              })
          )}
      </div>

      {/* Footer / Actions */}
      <div className="p-3 bg-slate-800 border-t border-slate-700">
          <div className="flex justify-between text-[10px] text-slate-400 mb-2 font-mono border-b border-slate-700 pb-2">
              <span>ASSEMBLY STATUS</span>
              <span className={isFullyAssembled ? 'text-emerald-400 font-bold' : 'text-orange-400'}>
                  {filledSlots} / {totalSlots} SLOTS
              </span>
          </div>

          {/* Validation Errors Display */}
          {validationErrors.length > 0 && (
               <div className="mb-2 p-2 bg-orange-900/30 border border-orange-800/50 rounded space-y-1">
                   {validationErrors.map((err, i) => (
                       <div key={i} className="text-[9px] text-orange-200 flex items-start space-x-1">
                           <span className="font-bold text-orange-500 shrink-0">!</span>
                           <span className="leading-tight">{err}</span>
                       </div>
                   ))}
               </div>
          )}

          {exportError && (
              <div className="text-[10px] bg-red-900/40 text-red-200 p-2 rounded border border-red-800/50 mb-2">
                  ERROR: {exportError}
              </div>
          )}

          <button
            onClick={handleExport}
            disabled={!isFullyAssembled || isExporting}
            className={`w-full py-2 px-4 rounded text-xs font-bold uppercase tracking-wider transition-all shadow-lg
                ${isFullyAssembled && !isExporting
                    ? 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white cursor-pointer transform hover:-translate-y-0.5' 
                    : 'bg-slate-700 text-slate-500 cursor-not-allowed border border-slate-600'}
            `}
          >
             {isExporting ? (
                 <span className="flex items-center justify-center space-x-2">
                     <svg className="animate-spin h-3 w-3 text-white" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                     <span>Processing...</span>
                 </span>
             ) : (
                 "Export File"
             )}
          </button>
      </div>
    </div>
  );
});