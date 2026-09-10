'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Query,
  getDocs,
  DocumentData,
  FirestoreError,
  CollectionReference,
} from 'firebase/firestore';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { useDashboardStore } from '@/contexts/dashboard-context';

export type WithId<T> = T & { id: string };

export interface UseCollectionResult<T> {
  data: WithId<T>[] | null;
  isLoading: boolean;
  error: FirestoreError | Error | null;
  refetch: () => Promise<void>;
  mutate: (updater: WithId<T>[] | ((prev: WithId<T>[] | null) => WithId<T>[] | null)) => void;
}

export interface InternalQuery extends Query<DocumentData> {
  _query: {
    path: {
      canonicalString(): string;
      toString(): string;
    }
  }
}

/**
 * Función para generar una clave de caché única basada en la consulta de Firestore.
 */
function getQueryCacheKey(query: any): string {
    if (!query) return '';
    try {
        // Intentamos extraer la ruta canónica y los filtros para crear una firma única
        const path = query.type === 'collection' 
            ? (query as CollectionReference).path 
            : (query as unknown as InternalQuery)._query.path.canonicalString();
        
        // Serializamos parte de la estructura interna para diferenciar queries con filtros/orden
        const queryInternal = (query as any)._query || {};
        const signature = JSON.stringify({
            filters: queryInternal.filters || [],
            orders: queryInternal.explicitOrderBy || [],
            limit: queryInternal.limit || null
        });

        return `collection_cache:${path}:${signature}`;
    } catch (e) {
        return 'unknown_query_key';
    }
}

/**
 * useCollection - Hook Inteligente con Memoria Global
 * Implementa una arquitectura Cache-First: Si los datos están en el DashboardStore,
 * los devuelve al instante consumiendo 0 lecturas adicionales de Firestore.
 */
export function useCollection<T = any>(
    memoizedTargetRefOrQuery: ((CollectionReference<DocumentData> | Query<DocumentData>) & {__memo?: boolean})  | null | undefined,
): UseCollectionResult<T> {
  type ResultItemType = WithId<T>;
  const { dataCache, setCachedData } = useDashboardStore();
  
  // Generamos la clave única para esta consulta específica
  const queryKey = useMemo(() => getQueryCacheKey(memoizedTargetRefOrQuery), [memoizedTargetRefOrQuery]);

  // Sincronizamos el estado local con la memoria global
  const data = (queryKey ? dataCache[queryKey] : null) as ResultItemType[] | null;
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<FirestoreError | Error | null>(null);

  /**
   * Mutate - Actualización Optimista Global
   * Actualiza la memoria compartida para que el cambio sea visible en otros módulos al instante.
   */
  const mutate = useCallback((updater: ResultItemType[] | ((prev: ResultItemType[] | null) => ResultItemType[] | null)) => {
    if (!queryKey) return;
    const newData = typeof updater === 'function' ? updater(data) : updater;
    setCachedData(queryKey, newData);
  }, [queryKey, data, setCachedData]);

  const fetchData = useCallback(async () => {
    if (!memoizedTargetRefOrQuery || !queryKey) {
      setIsLoading(false);
      return;
    }

    // REGLA DE ORO: Si ya tenemos datos en memoria, saltamos el getDocs (0 LECTURAS)
    if (dataCache[queryKey] !== undefined && dataCache[queryKey] !== null) {
        return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const snapshot = await getDocs(memoizedTargetRefOrQuery);
      const results: ResultItemType[] = [];
      snapshot.forEach((doc) => {
        results.push({ ...(doc.data() as T), id: doc.id });
      });
      
      // Guardamos en la memoria global
      setCachedData(queryKey, results);
    } catch (err: any) {
      const path = memoizedTargetRefOrQuery.type === 'collection'
        ? (memoizedTargetRefOrQuery as CollectionReference).path
        : (memoizedTargetRefOrQuery as unknown as InternalQuery)._query.path.canonicalString();

      const contextualError = new FirestorePermissionError({
        operation: 'list',
        path,
      });

      setError(contextualError);
      errorEmitter.emit('permission-error', contextualError);
    } finally {
      setIsLoading(false);
    }
  }, [memoizedTargetRefOrQuery, queryKey, dataCache, setCachedData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if(memoizedTargetRefOrQuery && !memoizedTargetRefOrQuery.__memo) {
    throw new Error(memoizedTargetRefOrQuery + ' was not properly memoized using useMemoFirebase');
  }

  return { data, isLoading, error, refetch: fetchData, mutate };
}
