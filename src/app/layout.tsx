"use client";

import { Toaster } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';
import { FirebaseClientProvider, useFirebase, updateDocumentNonBlocking } from '@/firebase';
import { AuthView } from '@/components/auth-view';
import { useEffect, useRef, useState } from 'react';
import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError, type SecurityRuleContext } from '@/firebase/errors';
import { Loader2 } from 'lucide-react';
import './globals.css';

function AppContent({ children }: { children: React.ReactNode }) {
  const { user, isUserLoading, firestore, auth } = useFirebase();
  const [isInitializing, setIsInitializing] = useState(true);
  const [isKickingOut, setIsKickingOut] = useState(false);
  const currentSessionId = useRef<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!user || !firestore || !auth) {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      setIsInitializing(false);
      return;
    }

    const syncProfileAndSession = async () => {
      try {
        await user.getIdToken(true);

        if (!currentSessionId.current) {
          let sid = sessionStorage.getItem('mm_active_session_id');
          if (!sid) {
            sid = Math.random().toString(36).substring(2) + Date.now();
            sessionStorage.setItem('mm_active_session_id', sid);
          }
          currentSessionId.current = sid;
        }

        const sessionId = currentSessionId.current;
        const profileRef = doc(firestore, 'users', user.uid);
        
        const adminRoleRef = doc(firestore, 'roles_admin', user.uid);
        const adminRoleSnap = await getDoc(adminRoleRef);
        const isAdmin = adminRoleSnap.exists();

        const profileSnap = await getDoc(profileRef);
        const existingData = profileSnap.exists() ? profileSnap.data() : {};

        const allAvailableModules = [
            'inventory', 
            'pos', 
            'repairs', 
            'reports', 
            'analysis', 
            'fiados', 
            'loans', 
            'inventory_aging'
        ];

        const profileData = {
          uid: user.uid,
          email: user.email,
          isAdmin: isAdmin,
          lastSessionId: sessionId,
          updatedAt: new Date().toISOString(),
          ...((!profileSnap.exists() || !existingData.enabledModules) ? {
            licenseStatus: isAdmin ? 'active' : 'expired',
            licenseExpiry: isAdmin 
              ? new Date(Date.now() + 3650 * 24 * 60 * 60 * 1000).toISOString() 
              : new Date().toISOString(),
            createdAt: existingData.createdAt || new Date().toISOString(),
            enabledModules: allAvailableModules,
            lockedModules: [],
            isPinRequired: false,
            showInfoOnReceipt: true,
            businessRIF: "",
            businessAddress: ""
          } : {
            ...(!existingData.lockedModules && { lockedModules: [] })
          })
        };

        await setDoc(profileRef, profileData, { merge: true });

        unsubscribeRef.current = onSnapshot(profileRef, (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            if (data.lastSessionId && data.lastSessionId !== sessionId) {
              handleAutoSignOut();
            }
          }
        }, (err) => {
          if (err.code !== 'permission-denied') {
            console.error("Session Watcher Error:", err);
          }
        });

        setIsInitializing(false);
      } catch (serverError: any) {
        console.error("Session sync failed:", serverError);
        if (user) {
            const permissionError = new FirestorePermissionError({
                path: `users/${user.uid}`,
                operation: 'get',
            } satisfies SecurityRuleContext);
            errorEmitter.emit('permission-error', permissionError);
        }
        setIsInitializing(false);
      }
    };

    const handleAutoSignOut = async () => {
      setIsKickingOut(true);
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      try {
        sessionStorage.removeItem('mm_active_session_id');
        await signOut(auth);
        setTimeout(() => { window.location.href = '/'; }, 500);
      } catch (e) {
        window.location.href = '/';
      }
    };

    syncProfileAndSession();

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [user, firestore, auth]);

  useEffect(() => {
    if (!user || !firestore || isInitializing) return;

    const interval = setInterval(() => {
        const profileRef = doc(firestore, 'users', user.uid);
        updateDocumentNonBlocking(profileRef, { updatedAt: new Date().toISOString() });
    }, 120000);

    return () => clearInterval(interval);
  }, [user, firestore, isInitializing]);

  if (isUserLoading || isInitializing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary opacity-50" />
          <p className="text-sm text-muted-foreground animate-pulse font-medium">Validando acceso...</p>
        </div>
      </div>
    );
  }

  if (isKickingOut) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-6 text-center max-w-xs px-4">
          <div className="p-4 bg-amber-50 rounded-full">
            <Loader2 className="h-10 w-10 animate-spin text-amber-600" />
          </div>
          <div className="space-y-2">
            <p className="font-bold text-lg">Sesión iniciada en otro lugar</p>
            <p className="text-sm text-muted-foreground">
              Hemos detectado una nueva conexión con tu cuenta. Por seguridad, esta ventana se cerrará.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthView />;
  }

  return <>{children}</>;
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#2532c2" />
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/favicon.ico" />
        <link rel="manifest" href="/manifest.json" />
        <title>POS MARICHE - Gestión de Negocio</title>
      </head>
      <body className={cn("font-sans antialiased", process.env.NODE_ENV === 'development' ? 'debug-screens' : '')}>
        <FirebaseClientProvider>
          <AppContent>
            {children}
          </AppContent>
          <Toaster />
        </FirebaseClientProvider>
      </body>
    </html>
  );
}