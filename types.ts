import { Psd } from 'ag-psd';
import { Node, Edge } from 'reactflow';

export const MAX_BOUNDARY_VIOLATION_PERCENT = 0.03;

export interface ContainerDefinition {
  id: string;
  name: string;
  originalName: string;
  bounds: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
  normalized: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
}

export interface TemplateMetadata {
  canvas: {
    width: number;
    height: number;
  };
  containers: ContainerDefinition[];
}

export interface ContainerContext {
  containerName: string;
  bounds: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
  canvasDimensions: {
    w: number;
    h: number;
  };
}

export interface SerializableLayer {
  id: string;
  name: string;
  type: 'layer' | 'group' | 'generative';
  children?: SerializableLayer[];
  isVisible: boolean;
  opacity: number;
  coords: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
}

export type RemapStrategy = 'STRETCH' | 'UNIFORM_FIT' | 'UNIFORM_FILL' | 'NONE';

export interface LayerOverride {
  layerId: string;
  xOffset: number;
  yOffset: number;
  individualScale: number;
}

export interface LayoutStrategy {
  method?: 'GEOMETRIC' | 'GENERATIVE' | 'HYBRID';
  suggestedScale: number;
  anchor: 'TOP' | 'CENTER' | 'BOTTOM' | 'STRETCH';
  generativePrompt: string;
  reasoning: string;
  overrides?: LayerOverride[];
  safetyReport?: {
    allowedBleed: boolean;
    violationCount: number;
  };
  // Logic Gate Flags
  isExplicitIntent?: boolean;
}

export interface TransformedLayer extends SerializableLayer {
  transform: {
    scaleX: number;
    scaleY: number;
    offsetX: number;
    offsetY: number;
  };
  children?: TransformedLayer[];
  generativePrompt?: string;
}

export interface MappingContext {
  container: ContainerContext;
  layers: SerializableLayer[] | TransformedLayer[];
  status: 'resolved' | 'empty' | 'transformed';
  message?: string;
  // Metadata Injection: AI Strategy travels with the data
  aiStrategy?: LayoutStrategy;
  // Visual Sandboxing: Upstream nodes can pass a draft preview
  previewUrl?: string; 
}

export interface ValidationIssue {
  layerName: string;
  containerName: string;
  type: 'PROCEDURAL_VIOLATION';
  message: string;
}

export interface DesignValidationReport {
  isValid: boolean;
  issues: ValidationIssue[];
}

export interface TargetAssembly {
  targetDimensions: {
    width: number;
    height: number;
  };
  slots: {
    containerName: string;
    isFilled: boolean;
    assignedLayerCount: number;
  }[];
}

export interface TransformedPayload {
  status: 'success' | 'error' | 'idle' | 'awaiting_confirmation';
  sourceNodeId: string;
  sourceContainer: string;
  targetContainer: string;
  layers: TransformedLayer[];
  scaleFactor: number;
  metrics: {
    source: { w: number, h: number };
    target: { w: number, h: number };
  };
  requiresGeneration?: boolean;
  previewUrl?: string;
}

export interface RemapperConfig {
  targetContainerName: string | null;
  strategy?: RemapStrategy;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  parts: { text: string }[];
  strategySnapshot?: LayoutStrategy;
  timestamp: number;
}

export interface AnalystInstanceState {
  chatHistory: ChatMessage[];
  layoutStrategy: LayoutStrategy | null;
  selectedModel: 'gemini-3-flash' | 'gemini-3-pro' | 'gemini-3-pro-thinking';
}

export interface PSDNodeData {
  fileName: string | null;
  template: TemplateMetadata | null;
  validation: DesignValidationReport | null;
  designLayers: SerializableLayer[] | null;
  containerContext?: ContainerContext | null;
  mappingContext?: MappingContext | null; // For downstream nodes consuming resolver output
  targetAssembly?: TargetAssembly | null; // For TargetSplitterNode output
  remapperConfig?: RemapperConfig | null; // For RemapperNode state
  transformedPayload?: TransformedPayload | null; // For RemapperNode output
  
  // Dynamic State Persistence
  channelCount?: number;
  instanceCount?: number;
  
  // Multi-Instance Analysis State
  analystInstances?: Record<number, AnalystInstanceState>;
  
  // Legacy Single-Instance Fields (Kept for backward compatibility if needed, but deprecated)
  layoutStrategy?: LayoutStrategy | null; 
  selectedModel?: 'gemini-3-flash' | 'gemini-3-pro' | 'gemini-3-pro-thinking';
  chatHistory?: ChatMessage[];

  error?: string | null;
}

export interface TargetTemplateData {
  fileName: string | null;
  template: TemplateMetadata | null;
  // Targets act as skeletons, so they don't have design layers or self-validation reports
  validation: null;
  designLayers: null;
  containerContext: null;
  mappingContext: null;
  error?: string | null;
}

// Persistence Schema
export interface ProjectExport {
  version: string;
  timestamp: number;
  nodes: Node<PSDNodeData>[];
  edges: Edge[];
  viewport: { x: number, y: number, zoom: number };
  // Credit Management
  userCredits: number;
  isPro: boolean;
}

// Re-export Psd type for convenience in other files
export type { Psd };