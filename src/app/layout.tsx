"use client";

import { Toaster } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';
import { FirebaseClientProvider, useFirebase } from '@/firebase';
import { AuthView } from '@/components/auth-view';
import { useEffect, useState } from 'react';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { Loader2 } from 'lucide-react';
import { SWRConfig } from 'swr';
import { usePathname } from 'next/navigation';
import './globals.css';

const SESSION_KEY = 'mm_session_id';

function AppContent({ children }: { children: React.ReactNode }) {
  const { user, isUserLoading, firestore, auth } = useFirebase();
  const [isInitializing, setIsInitializing] = useState(true);
  const pathname = usePathname();

  useEffect(() => {
    if (isUserLoading) return;

    // Si no hay usuario, no hay nada que validar
    if (!user || !firestore || !auth) {
      setIsInitializing(false);
      return;
    }

    // BLINDAJE: Solo validamos sesión dentro del Dashboard
    const isDashboard = pathname.startsWith('/dashboard');
    if (!isDashboard) {
      setIsInitializing(false);
      return;
    }

    const validateSession = async () => {
      try {
        const profileRef = doc(firestore, 'users', user.uid);
        const profileSnap = await getDoc(profileRef);
        
        if (profileSnap.exists()) {
          const data = profileSnap.data();
          const localSessionId = sessionStorage.getItem(SESSION_KEY);
          
          // CASO 1: No hay sesión local (ej. refresco de página o pestaña nueva)
          // Adoptamos la sesión de la DB para evitar bucles.
          if (!localSessionId && data.lastSessionId) {
            sessionStorage.setItem(SESSION_KEY, data.lastSessionId);
          } 
          // CASO 2: Conflicto de sesión (otro dispositivo entró)
          else if (localSessionId && data.lastSessionId && localSessionId !== data.lastSessionId) {
            console.warn("Sesión conflictiva detectada. Cerrando acceso.");
            sessionStorage.removeItem(SESSION_KEY);
            await signOut(auth);
            window.location.href = '/';
            return;
          }
        }
        setIsInitializing(false);
      } catch (e) {
        console.error("Error validando sesión:", e);
        setIsInitializing(false);
      }
    };

    validateSession();

    // Listener en tiempo real solo para el Dashboard para detectar si abren sesión en otro lado
    const unsubscribe = onSnapshot(doc(firestore, 'users', user.uid), (snap) => {
      if (snap.metadata.hasPendingWrites) return;
      if (snap.exists()) {
        const data = snap.data();
        const localSid = sessionStorage.getItem(SESSION_KEY);
        if (localSid && data.lastSessionId && localSid !== data.lastSessionId) {
          sessionStorage.removeItem(SESSION_KEY);
          signOut(auth).then(() => { window.location.reload(); });
        }
      }
    });

    return () => unsubscribe();
  }, [user, isUserLoading, firestore, auth, pathname]);

  if (isUserLoading || isInitializing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary opacity-50" />
          <p className="text-sm text-muted-foreground animate-pulse font-medium">Sincronizando sesión segura...</p>
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
