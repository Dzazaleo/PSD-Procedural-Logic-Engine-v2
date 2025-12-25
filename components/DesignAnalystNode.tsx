import React, { memo, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Handle, Position, NodeProps, useEdges, NodeResizer, useReactFlow, useUpdateNodeInternals } from 'reactflow';
import { PSDNodeData, LayoutStrategy, SerializableLayer, ChatMessage, AnalystInstanceState, ContainerContext, TemplateMetadata, ContainerDefinition, MappingContext } from '../types';
import { useProceduralStore } from '../store/ProceduralContext';
import { getSemanticThemeObject } from '../services/psdService';
import { GoogleGenAI, Type } from "@google/genai";

// Define the exact union type for model keys to match PSDNodeData
type ModelKey = 'gemini-3-flash' | 'gemini-3-pro' | 'gemini-3-pro-thinking';

interface ModelConfig {
  apiModel: string;
  label: string;
  badgeClass: string;
  headerClass: string;
  thinkingBudget?: number;
}

const MODELS: Record<ModelKey, ModelConfig> = {
  'gemini-3-flash': {
    apiModel: 'gemini-3-flash-preview',
    label: 'FLASH',
    badgeClass: 'bg-yellow-500 text-yellow-950 border-yellow-400',
    headerClass: 'border-yellow-500/50 bg-yellow-900/20'
  },
  'gemini-3-pro': {
    apiModel: 'gemini-3-pro-preview',
    label: 'PRO',
    badgeClass: 'bg-blue-600 text-white border-blue-500',
    headerClass: 'border-blue-500/50 bg-blue-900/20'
  },
  'gemini-3-pro-thinking': {
    apiModel: 'gemini-3-pro-preview',
    label: 'DEEP THINKING',
    badgeClass: 'bg-purple-600 text-white border-purple-500',
    headerClass: 'border-purple-500/50 bg-purple-900/20',
    thinkingBudget: 16384
  }
};

// --- Subcomponent: Strategy Card Renderer ---
const StrategyCard: React.FC<{ strategy: LayoutStrategy, modelConfig: ModelConfig }> = ({ strategy, modelConfig }) => {
    const overrideCount = strategy.overrides?.length || 0;
    
    return (
        <div className={`bg-slate-800/80 border-l-2 p-2 rounded text-[10px] space-y-2 w-full ${modelConfig.badgeClass.replace('bg-', 'border-').split(' ')[2]}`}>
             <div className="flex justify-between border-b border-slate-700 pb-1">
                <span className={`font-bold ${modelConfig.badgeClass.includes('yellow') ? 'text-yellow-400' : 'text-blue-300'}`}>SEMANTIC RECOMPOSITION</span>
                <span className="text-slate-400">{strategy.anchor}</span>
             </div>
             
             <div className="grid grid-cols-2 gap-2 mt-1">
                <div>
                    <span className="block text-slate-500">Global Scale</span>
                    <span className="text-slate-200 font-mono">{strategy.suggestedScale.toFixed(3)}x</span>
                </div>
                <div>
                    <span className="block text-slate-500">Overrides</span>
                    <span className={`${overrideCount > 0 ? 'text-pink-400 font-bold' : 'text-slate-400'}`}>
                        {overrideCount} Layers
                    </span>
                </div>
             </div>

             <div className="italic text-slate-400 leading-relaxed border-l-2 border-slate-600 pl-2 my-1 whitespace-pre-wrap break-words">
                "{strategy.reasoning}"
             </div>

             {strategy.safetyReport && strategy.safetyReport.violationCount > 0 && (
                 <div className="bg-orange-900/30 text-orange-200 p-1 rounded flex items-center space-x-1">
                     <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                     <span>{strategy.safetyReport.violationCount} Boundary Warnings</span>
                 </div>
             )}
        </div>
    );
};

// --- Subcomponent: Instance Row ---
interface InstanceRowProps {
    nodeId: string;
    index: number;
    state: AnalystInstanceState;
    sourceData: {
        container: ContainerContext;
        layers: any[];
    } | null;
    targetData: {
        bounds: { w: number, h: number };
        name: string;
    } | null;
    onAnalyze: (index: number) => void;
    onRefine: (index: number, text: string) => void;
    onModelChange: (index: number, model: ModelKey) => void;
    isAnalyzing: boolean;
    compactMode: boolean;
}

const InstanceRow: React.FC<InstanceRowProps> = ({ 
    nodeId, index, state, sourceData, targetData, onAnalyze, onRefine, onModelChange, isAnalyzing, compactMode 
}) => {
    const [inputText, setInputText] = useState('');
    const chatContainerRef = useRef<HTMLDivElement>(null);
    
    // Auto-scroll chat
    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [state.chatHistory.length, isAnalyzing]);

    const activeModelConfig = MODELS[state.selectedModel];
    const isReady = !!sourceData && !!targetData;
    
    // Theme derivation for UI coloring
    const targetName = targetData?.name || (sourceData?.container.containerName) || 'Unknown';
    // Use procedural palette but darken slightly for background usage
    const theme = getSemanticThemeObject(targetName, index);

    const handleRefineClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!inputText.trim()) return;
        onRefine(index, inputText);
        setInputText('');
    };

    const getPreviewStyle = (w: number, h: number, color: string) => {
        const maxDim = compactMode ? 24 : 32; 
        const ratio = w / h;
        let styleW = maxDim;
        let styleH = maxDim;
        
        if (ratio > 1) { styleH = maxDim / ratio; }
        else { styleW = maxDim * ratio; }
   
        return {
            width: `${styleW}px`,
            height: `${styleH}px`,
            borderColor: color
        };
     };

    return (
        <div className={`relative border-b border-slate-700/50 bg-slate-800/30 first:border-t-0 ${compactMode ? 'py-1' : ''}`}>
            {/* Instance Header */}
            <div className={`px-2 py-1.5 flex items-center justify-between ${theme.bg.replace('/20', '/10')}`}>
                <div className="flex items-center space-x-2">
                    <div className={`w-2 h-2 rounded-full ${theme.dot}`}></div>
                    <span className={`text-[10px] font-bold tracking-wide uppercase ${theme.text}`}>
                        {targetData?.name || `Instance ${index + 1}`}
                    </span>
                </div>
                
                {/* Model Selector */}
                <div className="relative">
                     <select 
                        value={state.selectedModel}
                        onChange={(e) => onModelChange(index, e.target.value as ModelKey)}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        className={`nodrag nopan appearance-none text-[8px] px-1.5 py-0.5 pr-3 rounded font-mono font-bold cursor-pointer outline-none border transition-colors duration-300 ${activeModelConfig.badgeClass}`}
                     >
                         <option value="gemini-3-flash" className="text-black bg-white">FLASH</option>
                         <option value="gemini-3-pro" className="text-black bg-white">PRO</option>
                         <option value="gemini-3-pro-thinking" className="text-black bg-white">DEEP</option>
                     </select>
                </div>
            </div>

            {/* Main Content Area */}
            <div className={`p-2 space-y-2 ${compactMode ? 'text-[9px]' : ''}`}>
                
                {/* Visual Wiring & Preview Row */}
                <div className="flex items-center justify-between bg-slate-900/40 rounded p-2 border border-slate-700/30 relative min-h-[60px] overflow-visible">
                    
                    {/* Left Inputs (Source + Target) */}
                    <div className="flex flex-col gap-4 relative justify-center h-full">
                         {/* SOURCE INPUT */}
                         <div className="relative flex items-center group h-4">
                            <Handle 
                                type="target" 
                                position={Position.Left} 
                                id={`source-in-${index}`} 
                                className="!absolute !-left-6 !w-3 !h-3 !rounded-full !bg-indigo-500 !border-2 !border-slate-800 z-50 transition-transform hover:scale-125"
                                style={{ top: '50%', transform: 'translate(-50%, -50%)' }}
                                title="Input: Source Context"
                            />
                            <span className={`text-[9px] font-mono font-bold leading-none ${sourceData ? 'text-indigo-300' : 'text-slate-600'} ml-1`}>
                                SRC
                            </span>
                         </div>
                         
                         {/* TARGET INPUT */}
                         <div className="relative flex items-center group h-4">
                            <Handle 
                                type="target" 
                                position={Position.Left} 
                                id={`target-in-${index}`} 
                                className="!absolute !-left-6 !w-3 !h-3 !rounded-full !bg-emerald-500 !border-2 !border-slate-800 z-50 transition-transform hover:scale-125"
                                style={{ top: '50%', transform: 'translate(-50%, -50%)' }}
                                title="Input: Target Definition"
                            />
                            <span className={`text-[9px] font-mono font-bold leading-none ${targetData ? 'text-emerald-300' : 'text-slate-600'} ml-1`}>
                                TGT
                            </span>
                         </div>
                    </div>

                    {/* Center Preview */}
                    <div className="flex items-center justify-center space-x-3 mx-4 border-x border-slate-700/20 px-4 flex-1">
                        {/* Source Preview */}
                        <div className="flex flex-col items-center gap-1">
                            <div className="border-2 border-dashed flex items-center justify-center bg-indigo-500/10 transition-all duration-300" 
                                    style={sourceData ? getPreviewStyle(sourceData.container.bounds.w, sourceData.container.bounds.h, '#6366f1') : { width: 24, height: 24, borderColor: '#334155' }}>
                            </div>
                            {sourceData && (
                                <span className="text-[7px] font-mono text-slate-500 leading-none">
                                    {Math.round(sourceData.container.bounds.w)}x{Math.round(sourceData.container.bounds.h)}
                                </span>
                            )}
                        </div>

                        {/* Arrow */}
                        <div className="">
                            <svg className="w-3 h-3 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                            </svg>
                        </div>
                        
                        {/* Target Preview */}
                        <div className="flex flex-col items-center gap-1">
                            <div className="border-2 border-dashed flex items-center justify-center bg-emerald-500/10 transition-all duration-300" 
                                    style={targetData ? getPreviewStyle(targetData.bounds.w, targetData.bounds.h, '#10b981') : { width: 24, height: 24, borderColor: '#334155' }}>
                            </div>
                             {targetData && (
                                <span className="text-[7px] font-mono text-slate-500 leading-none">
                                    {Math.round(targetData.bounds.w)}x{Math.round(targetData.bounds.h)}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Right Outputs (Source Relay, Target Relay) */}
                    <div className="flex flex-col gap-4 items-end relative justify-center h-full">
                        {/* SOURCE RELAY */}
                        <div className="relative flex items-center justify-end group h-4">
                            <span className="text-[9px] font-mono font-bold leading-none text-slate-500 mr-1">SOURCE</span>
                            <Handle 
                                type="source" 
                                position={Position.Right} 
                                id={`source-out-${index}`} 
                                className="!absolute !-right-6 !w-3 !h-3 !rounded-full !bg-indigo-500 !border-2 !border-white z-50 transition-transform hover:scale-125" 
                                style={{ top: '50%', transform: 'translate(50%, -50%)' }}
                                title="Relay: Source Data + AI Strategy"
                            />
                        </div>

                        {/* TARGET RELAY */}
                        <div className="relative flex items-center justify-end group h-4">
                            <span className="text-[9px] font-mono font-bold leading-none text-slate-500 mr-1">TARGET</span>
                            <Handle 
                                type="source" 
                                position={Position.Right} 
                                id={`target-out-${index}`} 
                                className="!absolute !-right-6 !w-3 !h-3 !rounded-full !bg-emerald-500 !border-2 !border-white z-50 transition-transform hover:scale-125" 
                                style={{ top: '50%', transform: 'translate(50%, -50%)' }}
                                title="Relay: Target Definition"
                            />
                        </div>
                    </div>
                </div>

                {/* Chat Console */}
                <div 
                    ref={chatContainerRef}
                    className={`nodrag nopan ${compactMode ? 'h-24' : 'h-32'} overflow-y-auto border border-slate-700 bg-slate-900 rounded p-2 space-y-2 custom-scrollbar transition-all`}
                    onWheel={(e) => e.stopPropagation()} 
                    onMouseDown={(e) => e.stopPropagation()}
                >
                    {state.chatHistory.length === 0 && (
                        <div className="h-full flex flex-col items-center justify-center text-slate-600 italic text-[10px] opacity-50">
                            <span>Ready to analyze {targetData?.name || 'slot'}</span>
                        </div>
                    )}
                    {state.chatHistory.map((msg, idx) => (
                        <div key={msg.id || idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                            <div className={`max-w-[95%] rounded border p-1.5 text-[10px] leading-relaxed
                                ${msg.role === 'user' 
                                     ? 'bg-slate-800 border-slate-600 text-slate-200' 
                                     : `bg-slate-800/50 ${activeModelConfig.badgeClass.replace('bg-', 'border-').split(' ')[0]} text-slate-300`
                                }`}
                            >
                                {msg.parts?.[0]?.text && msg.role === 'user' && (
                                    <div className="whitespace-pre-wrap break-words">{msg.parts[0].text}</div>
                                )}
                                {msg.strategySnapshot && (
                                    <div className="mt-1">
                                        <StrategyCard strategy={msg.strategySnapshot} modelConfig={activeModelConfig} />
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                    {isAnalyzing && (
                        <div className="flex items-center space-x-2 text-[10px] text-slate-400 animate-pulse">
                            <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"></div>
                            <span>Analyst is thinking...</span>
                        </div>
                    )}
                </div>

                {/* Control Footer */}
                <div className="flex space-x-1">
                     <textarea
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        onWheel={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        placeholder="Refinement instructions..."
                        disabled={!isReady || isAnalyzing}
                        className="nodrag nopan flex-1 bg-slate-900 border border-slate-700 rounded p-1.5 text-[10px] text-slate-200 focus:outline-none focus:border-indigo-500 resize-none h-8"
                     />
                     <div className="flex flex-col space-y-0.5 w-16">
                        <button
                            onClick={(e) => { e.stopPropagation(); onAnalyze(index); }}
                            onMouseDown={(e) => e.stopPropagation()}
                            disabled={!isReady || isAnalyzing}
                            className={`nodrag nopan flex-1 rounded text-[8px] font-bold uppercase transition-all shadow-sm
                                ${isReady && !isAnalyzing 
                                    ? 'bg-slate-700 hover:bg-slate-600 text-white border border-slate-600'
                                    : 'bg-slate-800 text-slate-600 cursor-not-allowed border border-slate-700'
                                }`}
                        >
                            Analyze
                        </button>
                        <button
                            onClick={handleRefineClick}
                            onMouseDown={(e) => e.stopPropagation()}
                            disabled={!isReady || isAnalyzing || inputText.trim().length === 0}
                            className={`nodrag nopan flex-1 rounded text-[8px] font-bold uppercase transition-all shadow-sm
                                ${inputText.trim().length > 0 && !isAnalyzing
                                    ? 'bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-400'
                                    : 'bg-slate-800 text-slate-600 cursor-not-allowed border border-slate-700'
                                }`}
                        >
                            Refine
                        </button>
                     </div>
                </div>
            </div>
        </div>
    );
};

export const DesignAnalystNode = memo(({ id, data }: NodeProps<PSDNodeData>) => {
  const [analyzingInstances, setAnalyzingInstances] = useState<Record<number, boolean>>({});
  const instanceCount = data.instanceCount || 1;
  const analystInstances = data.analystInstances || {};

  const edges = useEdges();
  const { setNodes } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  
  const { resolvedRegistry, templateRegistry, registerResolved, registerTemplate, unregisterNode } = useProceduralStore();

  useEffect(() => {
    return () => unregisterNode(id);
  }, [id, unregisterNode]);

  // Handle Updates: Notify React Flow of internal layout changes when instances are added/removed
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, instanceCount, updateNodeInternals]);

  // Derived Title: Dynamically resolve connected container names via source inputs
  const activeContainerNames = useMemo(() => {
    const names: string[] = [];
    for (let i = 0; i < instanceCount; i++) {
        // Find edge connected to source-in-${i}
        const sourceEdge = edges.find(e => e.target === id && e.targetHandle === `source-in-${i}`);
        if (sourceEdge) {
            // Retrieve MappingContext from Registry
            const registry = resolvedRegistry[sourceEdge.source];
            const context = registry ? registry[sourceEdge.sourceHandle || ''] : null;
            
            if (context?.container?.containerName) {
                names.push(context.container.containerName);
            }
        }
    }
    return names;
  }, [edges, id, instanceCount, resolvedRegistry]);
    
  const titleSuffix = activeContainerNames.length > 0 
    ? `(${activeContainerNames.join(', ')})` 
    : '(Waiting...)';

  // --- Helpers to resolve connection data per instance ---
  const getSourceData = useCallback((index: number) => {
    const edge = edges.find(e => e.target === id && e.targetHandle === `source-in-${index}`);
    if (!edge || !edge.sourceHandle) return null;
    const registry = resolvedRegistry[edge.source];
    return registry ? registry[edge.sourceHandle] : null;
  }, [edges, id, resolvedRegistry]);

  const getTargetData = useCallback((index: number) => {
    const edge = edges.find(e => e.target === id && e.targetHandle === `target-in-${index}`);
    if (!edge) return null;
    
    const template = templateRegistry[edge.source];
    if (!template) return null;

    let containerName = edge.sourceHandle;
    if (containerName?.startsWith('slot-bounds-')) {
        containerName = containerName.replace('slot-bounds-', '');
    }

    const container = template.containers.find(c => c.name === containerName);
    return container ? { bounds: container.bounds, name: container.name } : null;
  }, [edges, id, templateRegistry]);

  // --- Store Synchronization Effect ---
  // Registers source/target relays and injects metadata for EACH instance
  useEffect(() => {
    const syntheticContainers: ContainerDefinition[] = [];
    let canvasDims = { width: 0, height: 0 };

    for (let i = 0; i < instanceCount; i++) {
        const sourceData = getSourceData(i);
        const targetData = getTargetData(i);
        const instanceState = analystInstances[i];

        // 1. Source Relay with Metadata Injection (ResolvedRegistry)
        // Pass-through layer data to source-out handle but inject the AI Strategy into the context
        if (sourceData) {
            // Clone the context to avoid mutating the original reference from upstream
            const augmentedContext: MappingContext = {
                ...sourceData,
                // Inject the strategy if it exists for this instance
                aiStrategy: instanceState?.layoutStrategy || undefined
            };
            
            registerResolved(id, `source-out-${i}`, augmentedContext);
        }

        // 2. Target Relay (TemplateRegistry Construction)
        // Collect target definitions to create a synthetic template for downstream consumption
        if (targetData) {
            // Only capture dimensions from the first valid target connected
            if (canvasDims.width === 0) {
                const edge = edges.find(e => e.target === id && e.targetHandle === `target-in-${i}`);
                if (edge) {
                    const t = templateRegistry[edge.source];
                    if (t) canvasDims = t.canvas;
                }
            }

            // Map the opaque handle ID 'target-out-${i}' to the actual container definition
            // This allows RemapperNode to find 'target-out-0' in the registry and get the correct 'BG' container
            syntheticContainers.push({
                id: `proxy-target-${i}`,
                name: `target-out-${i}`, // CRITICAL: This MUST match the handle ID connected to Remapper
                originalName: targetData.name, // Preserve original semantic name
                bounds: targetData.bounds,
                normalized: {
                    x: canvasDims.width ? targetData.bounds.x / canvasDims.width : 0,
                    y: canvasDims.height ? targetData.bounds.y / canvasDims.height : 0,
                    w: canvasDims.width ? targetData.bounds.w / canvasDims.width : 0,
                    h: canvasDims.height ? targetData.bounds.h / canvasDims.height : 0,
                }
            });
        }
    }

    // Register the aggregated synthetic template if we have data
    if (syntheticContainers.length > 0) {
        const syntheticTemplate: TemplateMetadata = {
            canvas: canvasDims.width > 0 ? canvasDims : { width: 1024, height: 1024 },
            containers: syntheticContainers
        };
        registerTemplate(id, syntheticTemplate);
    }

  }, [id, instanceCount, analystInstances, getSourceData, getTargetData, registerResolved, registerTemplate, edges, templateRegistry]);


  // --- Action Handlers ---

  const addInstance = useCallback(() => {
    setNodes((nds) => nds.map((n) => {
        if (n.id === id) {
            return {
                ...n,
                data: {
                    ...n.data,
                    instanceCount: (n.data.instanceCount || 0) + 1
                }
            };
        }
        return n;
    }));
  }, [id, setNodes]);

  const updateInstanceState = useCallback((index: number, updates: Partial<AnalystInstanceState>) => {
    setNodes((nds) => nds.map((n) => {
        if (n.id === id) {
            const currentInstances = n.data.analystInstances || {};
            const oldState = currentInstances[index] || {
                chatHistory: [],
                layoutStrategy: null,
                selectedModel: 'gemini-3-flash'
            };
            
            return {
                ...n,
                data: {
                    ...n.data,
                    analystInstances: {
                        ...currentInstances,
                        [index]: { ...oldState, ...updates }
                    }
                }
            };
        }
        return n;
    }));
  }, [id, setNodes]);

  const handleModelChange = (index: number, model: ModelKey) => {
      updateInstanceState(index, { selectedModel: model });
  };

  // --- AI Logic ---
  
  const generateSystemInstruction = (sourceData: any, targetData: any, isRefining: boolean) => {
    const sourceW = sourceData.container.bounds.w;
    const sourceH = sourceData.container.bounds.h;
    const targetW = targetData.bounds.w;
    const targetH = targetData.bounds.h;

    // Flatten layers for context
    const flattenLayers = (layers: SerializableLayer[], depth = 0): any[] => {
        let flat: any[] = [];
        layers.forEach(l => {
            flat.push({
                id: l.id,
                name: l.name,
                type: l.type,
                depth: depth,
                relX: (l.coords.x - sourceData.container.bounds.x) / sourceW,
                relY: (l.coords.y - sourceData.container.bounds.y) / sourceH,
                width: l.coords.w,
                height: l.coords.h
            });
            if (l.children) {
                flat = flat.concat(flattenLayers(l.children, depth + 1));
            }
        });
        return flat;
    };

    const layerAnalysisData = flattenLayers(sourceData.layers as SerializableLayer[]);

    let prompt = `
        ROLE: Precision Drafting Engine & Senior PSD Compositor.
        GOAL: Perform "Geometry-First Semantic Recomposition" using a STRICT GRID SYSTEM.
        
        CONTAINER CONTEXT:
        - Source: ${sourceData.container.containerName} (${sourceW}x${sourceH})
        - Target: ${targetData.name} (${targetW}x${targetH})
        
        LAYER HIERARCHY (JSON):
        ${JSON.stringify(layerAnalysisData.slice(0, 40))} ... (Truncated)

        CRITICAL GRID LOGIC:
        1. Analyze the Target Aspect Ratio (${(targetW/targetH).toFixed(2)}) vs Source (${(sourceW/sourceH).toFixed(2)}).
        2. If Target is narrower/taller, STACK elements vertically.
        3. If Target is wider, distribute horizontally.
        4. Calculate integer 'yOffset' and 'xOffset' relative to Target Top-Left (0,0).
        5. Maintain visual hierarchy: Key elements (Titles) must be prominent.
    `;
    
    if (isRefining) {
        prompt += `\n\nUSER FEEDBACK RECEIVED. Adjust the 'overrides' array to satisfy the user request while maintaining valid JSON structure and boundary safety.`;
    }

    return prompt;
  };

  const performAnalysis = async (index: number, history: ChatMessage[]) => {
      const sourceData = getSourceData(index);
      const targetData = getTargetData(index);
      
      if (!sourceData || !targetData) return;
      
      const instanceState = analystInstances[index] || { selectedModel: 'gemini-3-flash' };
      const modelConfig = MODELS[instanceState.selectedModel as ModelKey];
      
      setAnalyzingInstances(prev => ({ ...prev, [index]: true }));

      try {
        const apiKey = process.env.API_KEY;
        if (!apiKey) throw new Error("API_KEY missing");

        const ai = new GoogleGenAI({ apiKey });
        const systemInstruction = generateSystemInstruction(sourceData, targetData, history.length > 1);

        const contents = history.map(msg => ({ role: msg.role, parts: msg.parts }));

        const requestConfig: any = {
            systemInstruction,
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    suggestedScale: { type: Type.NUMBER },
                    anchor: { type: Type.STRING, enum: ['TOP', 'CENTER', 'BOTTOM', 'STRETCH'] },
                    generativePrompt: { type: Type.STRING },
                    reasoning: { type: Type.STRING },
                    overrides: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                layerId: { type: Type.STRING },
                                xOffset: { type: Type.NUMBER },
                                yOffset: { type: Type.NUMBER },
                                individualScale: { type: Type.NUMBER }
                            },
                            required: ['layerId', 'xOffset', 'yOffset', 'individualScale']
                        }
                    },
                    safetyReport: {
                        type: Type.OBJECT,
                        properties: {
                            allowedBleed: { type: Type.BOOLEAN },
                            violationCount: { type: Type.INTEGER }
                        },
                        required: ['allowedBleed', 'violationCount']
                    }
                },
                required: ['suggestedScale', 'anchor', 'generativePrompt', 'reasoning', 'overrides', 'safetyReport']
            }
        };
        
        if (modelConfig.thinkingBudget) {
            requestConfig.thinkingConfig = { thinkingBudget: modelConfig.thinkingBudget };
        }

        const response = await ai.models.generateContent({
            model: modelConfig.apiModel,
            contents,
            config: requestConfig
        });

        const json = JSON.parse(response.text || '{}');
        
        const newAiMessage: ChatMessage = {
            id: Date.now().toString(),
            role: 'model',
            parts: [{ text: response.text || '' }],
            strategySnapshot: json,
            timestamp: Date.now()
        };

        const finalHistory = [...history, newAiMessage];
        
        updateInstanceState(index, {
            chatHistory: finalHistory,
            layoutStrategy: json
        });

      } catch (e: any) {
          console.error("Analysis Failed:", e);
          // Optional: Add error message to chat
      } finally {
          setAnalyzingInstances(prev => ({ ...prev, [index]: false }));
      }
  };

  const handleAnalyze = (index: number) => {
      const initialMsg: ChatMessage = {
          id: Date.now().toString(),
          role: 'user',
          parts: [{ text: "Generate grid layout." }],
          timestamp: Date.now()
      };
      
      updateInstanceState(index, { chatHistory: [initialMsg] });
      performAnalysis(index, [initialMsg]);
  };

  const handleRefine = (index: number, text: string) => {
      const currentHistory = analystInstances[index]?.chatHistory || [];
      const userMsg: ChatMessage = {
          id: Date.now().toString(),
          role: 'user',
          parts: [{ text }],
          timestamp: Date.now()
      };
      
      const updatedHistory = [...currentHistory, userMsg];
      updateInstanceState(index, { chatHistory: updatedHistory });
      performAnalysis(index, updatedHistory);
  };

  return (
    <div className="w-full min-w-[320px] bg-slate-800 rounded-lg shadow-2xl border border-slate-600 font-sans flex flex-col transition-colors duration-300">
      <NodeResizer 
          minWidth={450} 
          minHeight={300} 
          isVisible={true} 
          handleStyle={{ background: 'transparent', border: 'none' }}
          lineStyle={{ border: 'none' }}
      />

      {/* Main Header */}
      <div className="bg-slate-900 p-2 border-b border-slate-700 flex items-center justify-between shrink-0 rounded-t-lg">
         <div className="flex items-center space-x-2">
           <svg className="w-4 h-4 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
           </svg>
           <div className="flex flex-col leading-none">
             <span className="text-sm font-bold text-purple-100">Design Analyst</span>
             <span className="text-[9px] text-purple-400 max-w-[200px] truncate">{titleSuffix}</span>
           </div>
         </div>
      </div>

      {/* Instances Container */}
      <div className="flex flex-col">
          {Array.from({ length: instanceCount }).map((_, i) => {
              const state = analystInstances[i] || { 
                  chatHistory: [], 
                  layoutStrategy: null, 
                  selectedModel: 'gemini-3-flash' 
              };
              
              return (
                  <InstanceRow 
                      key={i}
                      nodeId={id}
                      index={i}
                      state={state}
                      sourceData={getSourceData(i)}
                      targetData={getTargetData(i)}
                      onAnalyze={handleAnalyze}
                      onRefine={handleRefine}
                      onModelChange={handleModelChange}
                      isAnalyzing={!!analyzingInstances[i]}
                      compactMode={instanceCount > 1}
                  />
              );
          })}
      </div>

      {/* Footer Action */}
      <button 
        onClick={addInstance}
        className="w-full py-2 bg-slate-800 hover:bg-slate-700 border-t border-slate-700 text-slate-400 hover:text-slate-200 transition-colors flex items-center justify-center space-x-1 rounded-b-lg"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        <span className="text-[10px] font-medium uppercase tracking-wider">Add Analysis Instance</span>
      </button>

    </div>
  );
});