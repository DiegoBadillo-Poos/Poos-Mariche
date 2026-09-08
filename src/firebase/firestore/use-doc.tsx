'use client';
    
import { useState, useEffect, useCallback } from 'react';
import {
  DocumentReference,
  getDoc,
  DocumentData,
  FirestoreError,
  DocumentSnapshot,
} from 'firebase/firestore';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

type WithId<T> = T & { id: string };

export interface UseDocResult<T> {
  data: WithId<T> | null;
  isLoading: boolean;
  error: FirestoreError | Error | null;
  refetch: () => Promise<void>;
  mutate: (newData: WithId<T> | ((prev: WithId<T> | null) => WithId<T> | null)) => void;
}

/**
 * Hook refactorizado para usar getDoc (Pull) con soporte de Mutación Optimista.
 */
export function useDoc<T = any>(
  memoizedDocRef: DocumentReference<DocumentData> | null | undefined,
): UseDocResult<T> {
  const [data, setData] = useState<WithId<T> | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<FirestoreError | Error | null>(null);

  const mutate = useCallback((updater: WithId<T> | ((prev: WithId<T> | null) => WithId<T> | null)) => {
    setData(current => typeof updater === 'function' ? updater(current) : updater);
  }, []);

  const fetchData = useCallback(async () => {
    if (!memoizedDocRef) {
      setData(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const snapshot = await getDoc(memoizedDocRef);
      if (snapshot.exists()) {
        setData({ ...(snapshot.data() as T), id: snapshot.id });
      } else {
        setData(null);
      }
    } catch (err: any) {
      const contextualError = new FirestorePermissionError({
        operation: 'get',
        path: memoizedDocRef.path,
      });

      setError(contextualError);
      errorEmitter.emit('permission-error', contextualError);
    } finally {
      setIsLoading(false);
    }
  }, [memoizedDocRef]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, isLoading, error, refetch: fetchData, mutate };
}
