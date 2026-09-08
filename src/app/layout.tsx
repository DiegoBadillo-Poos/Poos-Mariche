"use client";

import { Toaster } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';
import { FirebaseClientProvider, useFirebase, updateDocumentNonBlocking } from '@/firebase';
import { AuthView } from '@/components/auth-view';
import { useEffect, useRef, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError, type SecurityRuleContext } from '@/firebase/errors';
import { Loader2 } from 'lucide-react';
import { SWRConfig } from 'swr';
import './globals.css';

/**
 * AppContent gestiona la sesión única.
 * El último en entrar toma el control (Last-In Wins).
 */
function AppContent({ children }: { children: React.ReactNode }) {
  const { user, isUserLoading, firestore, auth } = useFirebase();
  const [isInitializing, setIsInitializing] = useState(true);
  const currentSessionId = useRef<string | null>(null);

  useEffect(() => {
    if (!user || !firestore || !auth) {
      setIsInitializing(false);
      return;
    }

    const syncProfileAndSession = async () => {
      try {
        await user.getIdToken(true);

        if (!currentSessionId.current) {
          // Usamos sessionStorage para que cada pestaña sea una sesión independiente
          let sid = sessionStorage.getItem('mm_session_id');
          if (!sid) {
            sid = Math.random().toString(36).substring(2) + Date.now();
            sessionStorage.setItem('mm_session_id', sid);
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

        const allAvailableModules = ['inventory', 'pos', 'repairs', 'reports', 'expenses', 'analysis', 'fiados', 'inventory_aging', 'loans', 'exchange', 'payroll', 'treasury'];

        const profileData = {
          uid: user.uid,
          email: user.email,
          isAdmin: isAdmin,
          lastSessionId: sessionId, // Esta pestaña toma el control ahora
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

        // Sobrescribimos la sesión vieja con la nueva
        await setDoc(profileRef, profileData, { merge: true });
        setIsInitializing(false);
      } catch (serverError: any) {
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

    syncProfileAndSession();

  }, [user, firestore, auth]);

  // Heartbeat y Validación de Sesión Única (Cierra la vieja si entra una nueva)
  useEffect(() => {
    if (!user || !firestore || isInitializing || !auth) return;

    const interval = setInterval(async () => {
        try {
            const profileRef = doc(firestore, 'users', user.uid);
            const snap = await getDoc(profileRef);
            
            if (snap.exists()) {
                const data = snap.data();
                const mySessionId = sessionStorage.getItem('mm_session_id');
                
                // Si el ID en la DB es distinto al mío, significa que otra pestaña/dispositivo entró después
                if (data.lastSessionId && data.lastSessionId !== mySessionId) {
                    sessionStorage.removeItem('mm_session_id');
                    await signOut(auth);
                    window.location.reload();
                    return;
                }

                // Si soy el dueño actual, solo actualizo mi latido
                updateDocumentNonBlocking(profileRef, { updatedAt: new Date().toISOString() });
            }
        } catch (e) {
            // Error silencioso para no interrumpir la experiencia si falla el internet momentáneamente
        }
    }, 120000); // Cada 2 minutos

    return () => clearInterval(interval);
  }, [user, firestore, isInitializing, auth]);

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
        <link rel="apple-touch-icon" href="/icon.png" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <title>POS MARICHE - Gestión de Negocio</title>
      </head>
      <body className={cn("font-sans antialiased", process.env.NODE_ENV === 'development' ? 'debug-screens' : '')}>
        <SWRConfig 
          value={{
            revalidateOnFocus: false,
            revalidateOnReconnect: false,
            revalidateIfStale: false,
            dedupingInterval: 600000,
          }}
        >
          <FirebaseClientProvider>
            <AppContent>
              {children}
            </AppContent>
            <Toaster />
          </FirebaseClientProvider>
        </SWRConfig>
      </body>
    </html>
  );
}
