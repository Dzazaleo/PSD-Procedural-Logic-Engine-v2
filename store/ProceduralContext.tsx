import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { Psd } from 'ag-psd';
import { TemplateMetadata, MappingContext, TransformedPayload, LayoutStrategy } from '../types';

interface ProceduralState {
  // Maps NodeID -> Raw PSD Object (Binary/Structure)
  psdRegistry: Record<string, Psd>;
  
  // Maps NodeID -> Lightweight Template Metadata
  templateRegistry: Record<string, TemplateMetadata>;
  
  // Maps NodeID -> HandleID -> Resolved Context (Layers + Bounds)
  resolvedRegistry: Record<string, Record<string, MappingContext>>;

  // Maps NodeID -> HandleID -> Transformed Payload (Ready for Assembly)
  payloadRegistry: Record<string, Record<string, TransformedPayload>>;

  // Maps NodeID -> HandleID -> LayoutStrategy (AI Analysis)
  analysisRegistry: Record<string, Record<string, LayoutStrategy>>;

  // Global counter to force re-evaluation of downstream nodes upon binary re-hydration
  globalVersion: number;

  // Credit Management
  userCredits: number;
  isPro: boolean;
}

interface ProceduralContextType extends ProceduralState {
  registerPsd: (nodeId: string, psd: Psd) => void;
  registerTemplate: (nodeId: string, template: TemplateMetadata) => void;
  registerResolved: (nodeId: string, handleId: string, context: MappingContext) => void;
  registerPayload: (nodeId: string, handleId: string, payload: TransformedPayload) => void;
  registerAnalysis: (nodeId: string, handleId: string, strategy: LayoutStrategy) => void;
  unregisterNode: (nodeId: string) => void;
  triggerGlobalRefresh: () => void;
  
  // Credit Actions
  consumeCredit: (amount: number) => boolean;
  addCredits: (amount: number) => void;
  setCredits: (amount: number) => void; // New method for restoration
  setProStatus: (status: boolean) => void;
}

const ProceduralContext = createContext<ProceduralContextType | null>(null);

export const ProceduralStoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [psdRegistry, setPsdRegistry] = useState<Record<string, Psd>>({});
  const [templateRegistry, setTemplateRegistry] = useState<Record<string, TemplateMetadata>>({});
  const [resolvedRegistry, setResolvedRegistry] = useState<Record<string, Record<string, MappingContext>>>({});
  const [payloadRegistry, setPayloadRegistry] = useState<Record<string, Record<string, TransformedPayload>>>({});
  const [analysisRegistry, setAnalysisRegistry] = useState<Record<string, Record<string, LayoutStrategy>>>({});
  const [globalVersion, setGlobalVersion] = useState<number>(0);

  // Credit State
  const [userCredits, setUserCredits] = useState<number>(5);
  const [isPro, setIsPro] = useState<boolean>(false);

  const registerPsd = useCallback((nodeId: string, psd: Psd) => {
    setPsdRegistry(prev => ({ ...prev, [nodeId]: psd }));
  }, []);

  const registerTemplate = useCallback((nodeId: string, template: TemplateMetadata) => {
    setTemplateRegistry(prev => {
      if (prev[nodeId] === template) return prev;
      if (JSON.stringify(prev[nodeId]) === JSON.stringify(template)) return prev;
      return { ...prev, [nodeId]: template };
    });
  }, []);

  const registerResolved = useCallback((nodeId: string, handleId: string, context: MappingContext) => {
    setResolvedRegistry(prev => {
      const nodeRecord = prev[nodeId] || {};
      const currentContext = nodeRecord[handleId];
      if (currentContext === context) return prev;
      if (currentContext && JSON.stringify(currentContext) === JSON.stringify(context)) return prev;
      
      return {
        ...prev,
        [nodeId]: {
          ...nodeRecord,
          [handleId]: context
        }
      };
    });
  }, []);

  const registerPayload = useCallback((nodeId: string, handleId: string, payload: TransformedPayload) => {
    setPayloadRegistry(prev => {
      const nodeRecord = prev[nodeId] || {};
      const currentPayload = nodeRecord[handleId];

      if (currentPayload === payload) return prev;
      if (currentPayload && JSON.stringify(currentPayload) === JSON.stringify(payload)) return prev;

      return { 
        ...prev, 
        [nodeId]: {
            ...nodeRecord,
            [handleId]: payload
        } 
      };
    });
  }, []);

  const registerAnalysis = useCallback((nodeId: string, handleId: string, strategy: LayoutStrategy) => {
    setAnalysisRegistry(prev => {
        const nodeRecord = prev[nodeId] || {};
        const currentStrategy = nodeRecord[handleId];
        
        if (currentStrategy === strategy) return prev;
        if (currentStrategy && JSON.stringify(currentStrategy) === JSON.stringify(strategy)) return prev;
        
        return { 
            ...prev, 
            [nodeId]: {
                ...nodeRecord,
                [handleId]: strategy
            } 
        };
    });
  }, []);

  const unregisterNode = useCallback((nodeId: string) => {
    setPsdRegistry(prev => { const { [nodeId]: _, ...rest } = prev; return rest; });
    setTemplateRegistry(prev => { const { [nodeId]: _, ...rest } = prev; return rest; });
    setResolvedRegistry(prev => { const { [nodeId]: _, ...rest } = prev; return rest; });
    setPayloadRegistry(prev => { const { [nodeId]: _, ...rest } = prev; return rest; });
    setAnalysisRegistry(prev => { const { [nodeId]: _, ...rest } = prev; return rest; });
  }, []);

  const triggerGlobalRefresh = useCallback(() => {
    setGlobalVersion(v => v + 1);
  }, []);

  // Credit Logic
  const consumeCredit = useCallback((amount: number): boolean => {
    if (userCredits >= amount) {
        setUserCredits(prev => prev - amount);
        return true;
    }
    return false;
  }, [userCredits]);

  const addCredits = useCallback((amount: number) => {
    setUserCredits(prev => prev + amount);
  }, []);

  const setCredits = useCallback((amount: number) => {
    setUserCredits(amount);
  }, []);

  const setProStatus = useCallback((status: boolean) => {
    setIsPro(status);
  }, []);

  const value = useMemo(() => ({
    psdRegistry,
    templateRegistry,
    resolvedRegistry,
    payloadRegistry,
    analysisRegistry,
    globalVersion,
    userCredits,
    isPro,
    registerPsd,
    registerTemplate,
    registerResolved,
    registerPayload,
    registerAnalysis,
    unregisterNode,
    triggerGlobalRefresh,
    consumeCredit,
    addCredits,
    setCredits,
    setProStatus
  }), [
    psdRegistry, templateRegistry, resolvedRegistry, payloadRegistry, analysisRegistry, globalVersion,
    userCredits, isPro,
    registerPsd, registerTemplate, registerResolved, registerPayload, registerAnalysis, 
    unregisterNode, triggerGlobalRefresh, consumeCredit, addCredits, setCredits, setProStatus
  ]);

  return (
    <ProceduralContext.Provider value={value}>
      {children}
    </ProceduralContext.Provider>
  );
};

export const useProceduralStore = () => {
  const context = useContext(ProceduralContext);
  if (!context) {
    throw new Error('useProceduralStore must be used within a ProceduralStoreProvider');
  }
  return context;
};