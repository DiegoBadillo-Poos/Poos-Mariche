"use client";

import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

/**
 * DashboardContext - Almacén de Memoria Global
 * Guarda los resultados de las consultas a Firestore para evitar lecturas repetitivas.
 */

type DashboardContextType = {
  dataCache: Record<string, any[] | null>;
  setCachedData: (key: string, data: any[] | null) => void;
};

const DashboardContext = createContext<DashboardContextType | undefined>(undefined);

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  // Usamos un estado para el cache que dispare re-renders en los componentes suscritos
  const [dataCache, setDataCache] = useState<Record<string, any[] | null>>({});

  // Función para actualizar la memoria global desde cualquier módulo
  const setCachedData = useCallback((key: string, data: any[] | null) => {
    setDataCache(prev => {
      // Evitamos actualizaciones de estado si los datos son idénticos por referencia (performance)
      if (prev[key] === data) return prev;
      return { ...prev, [key]: data };
    });
  }, []);

  return (
    <DashboardContext.Provider value={{ dataCache, setCachedData }}>
      {children}
    </DashboardContext.Provider>
  );
}

/**
 * Hook para acceder al almacén global.
 * Si se usa fuera del Dashboard (ej. Auth), retorna un objeto vacío seguro.
 */
export function useDashboardStore() {
  const context = useContext(DashboardContext);
  return context || { dataCache: {}, setCachedData: () => {} };
}
