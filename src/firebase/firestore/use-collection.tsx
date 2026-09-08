'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Query,
  getDocs,
  DocumentData,
  FirestoreError,
  QuerySnapshot,
  CollectionReference,
} from 'firebase/firestore';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

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
 * Hook refactorizado para usar getDocs (Pull) y soporte de Mutación Optimista.
 */
export function useCollection<T = any>(
    memoizedTargetRefOrQuery: ((CollectionReference<DocumentData> | Query<DocumentData>) & {__memo?: boolean})  | null | undefined,
): UseCollectionResult<T> {
  type ResultItemType = WithId<T>;
  const [data, setData] = useState<ResultItemType[] | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<FirestoreError | Error | null>(null);

  const mutate = useCallback((updater: ResultItemType[] | ((prev: ResultItemType[] | null) => ResultItemType[] | null)) => {
    setData(current => typeof updater === 'function' ? updater(current) : updater);
  }, []);

  const fetchData = useCallback(async () => {
    if (!memoizedTargetRefOrQuery) {
      setData(null);
      setIsLoading(false);
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
      setData(results);
    } catch (err: any) {
      const path: string =
          memoizedTargetRefOrQuery.type === 'collection'
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
  }, [memoizedTargetRefOrQuery]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if(memoizedTargetRefOrQuery && !memoizedTargetRefOrQuery.__memo) {
    throw new Error(memoizedTargetRefOrQuery + ' was not properly memoized using useMemoFirebase');
  }

  return { data, isLoading, error, refetch: fetchData, mutate };
}
