"use client";

import React, { createContext, useContext, useState, useCallback } from 'react';

/**
 * DashboardContext - Almacén de Memoria Global
 * Guarda los resultados de las consultas a Firestore para evitar lecturas repetitivas.
 * Ahora incluye funciones para actualizar e inyectar ítems en cualquier colección cacheada.
 */

type DashboardContextType = {
  dataCache: Record<string, any[] | null>;
  setCachedData: (key: string, data: any[] | null) => void;
  updateCachedItem: (id: string, partialData: any) => void;
  removeCachedItem: (id: string) => void;
  addItemToCache: (collectionPathPart: string, item: any) => void;
};

const DashboardContext = createContext<DashboardContextType | undefined>(undefined);

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  // Almacén de colecciones
  const [dataCache, setDataCache] = useState<Record<string, any[] | null>>({});

  // Actualizar una colección completa bajo una clave (QueryKey)
  const setCachedData = useCallback((key: string, data: any[] | null) => {
    setDataCache(prev => {
      if (prev[key] === data) return prev;
      return { ...prev, [key]: data };
    });
  }, []);

  /**
   * addItemToCache - Inyección Atómica Global
   * Inserta un nuevo ítem (ej. una Venta) en todas las colecciones que coincidan
   * con el nombre de la ruta, garantizando actualización instantánea en 0ms.
   */
  const addItemToCache = useCallback((collectionPathPart: string, item: any) => {
    setDataCache(prev => {
      const nextCache = { ...prev };
      let hasChanged = false;

      Object.keys(nextCache).forEach(key => {
        // Buscamos claves que correspondan a la colección (ej. 'sale_transactions')
        if (key.includes(collectionPathPart)) {
          const list = nextCache[key];
          if (Array.isArray(list)) {
            // Evitamos duplicados por si acaso
            if (!list.find(existing => existing.id === item.id)) {
              nextCache[key] = [item, ...list];
              hasChanged = true;
            }
          }
        }
      });

      return hasChanged ? nextCache : prev;
    });
  }, []);

  /**
   * updateCachedItem - Actualización Atómica Global
   * Busca un ID en TODAS las colecciones cacheadas y actualiza sus campos.
   */
  const updateCachedItem = useCallback((id: string, partialData: any) => {
    setDataCache(prev => {
      const nextCache = { ...prev };
      let hasChanged = false;

      Object.keys(nextCache).forEach(key => {
        const list = nextCache[key];
        if (Array.isArray(list)) {
          const index = list.findIndex(item => item.id === id);
          if (index !== -1) {
            const newList = [...list];
            newList[index] = { ...newList[index], ...partialData };
            nextCache[key] = newList;
            hasChanged = true;
          }
        }
      });

      return hasChanged ? nextCache : prev;
    });
  }, []);

  /**
   * removeCachedItem - Eliminación Atómica Global
   */
  const removeCachedItem = useCallback((id: string) => {
    setDataCache(prev => {
      const nextCache = { ...prev };
      let hasChanged = false;

      Object.keys(nextCache).forEach(key => {
        const list = nextCache[key];
        if (Array.isArray(list)) {
          const newList = list.filter(item => item.id !== id);
          if (newList.length !== list.length) {
            nextCache[key] = newList;
            hasChanged = true;
          }
        }
      });

      return hasChanged ? nextCache : prev;
    });
  }, []);

  return (
    <DashboardContext.Provider value={{ dataCache, setCachedData, updateCachedItem, removeCachedItem, addItemToCache }}>
      {children}
    </DashboardContext.Provider>
  );
}

/**
 * Hook para acceder al almacén global.
 */
export function useDashboardStore() {
  const context = useContext(DashboardContext);
  const fallback = { 
    dataCache: {}, 
    setCachedData: () => {}, 
    updateCachedItem: () => {}, 
    removeCachedItem: () => {},
    addItemToCache: () => {} 
  };
  return context || fallback;
}
