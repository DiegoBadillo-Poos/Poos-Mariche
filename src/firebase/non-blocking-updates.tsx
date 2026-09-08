'use client';
    
import {
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  CollectionReference,
  DocumentReference,
  SetOptions,
} from 'firebase/firestore';
import { errorEmitter } from '@/firebase/error-emitter';
import {FirestorePermissionError} from '@/firebase/errors';

/**
 * Realiza un setDoc. Devuelve la promesa para permitir await.
 */
export async function setDocumentNonBlocking(docRef: DocumentReference, data: any, options: SetOptions) {
  try {
    return await setDoc(docRef, data, options);
  } catch (error) {
    errorEmitter.emit(
      'permission-error',
      new FirestorePermissionError({
        path: docRef.path,
        operation: 'write',
        requestResourceData: data,
      })
    );
    throw error;
  }
}

/**
 * Realiza un addDoc. Devuelve la promesa para permitir await.
 */
export async function addDocumentNonBlocking(colRef: CollectionReference, data: any) {
  try {
    return await addDoc(colRef, data);
  } catch (error) {
    errorEmitter.emit(
        'permission-error',
        new FirestorePermissionError({
          path: colRef.path,
          operation: 'create',
          requestResourceData: data,
        })
      );
    throw error;
  }
}

/**
 * Realiza un updateDoc. Devuelve la promesa para permitir await.
 */
export async function updateDocumentNonBlocking(docRef: DocumentReference, data: any) {
  try {
    return await updateDoc(docRef, data);
  } catch (error) {
    errorEmitter.emit(
        'permission-error',
        new FirestorePermissionError({
          path: docRef.path,
          operation: 'update',
          requestResourceData: data,
        })
      );
    throw error;
  }
}

/**
 * Realiza un deleteDoc. Devuelve la promesa para permitir await.
 */
export async function deleteDocumentNonBlocking(docRef: DocumentReference) {
  try {
    return await deleteDoc(docRef);
  } catch (error) {
    errorEmitter.emit(
        'permission-error',
        new FirestorePermissionError({
          path: docRef.path,
          operation: 'delete',
        })
      );
    throw error;
  }
}
