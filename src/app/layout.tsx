"use client";

import { Toaster } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';
import { FirebaseClientProvider, useFirebase } from '@/firebase';
import { AuthView } from '@/components/auth-view';
import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
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

    /**
     * MOTOR DE VIGILANCIA DE SESIÓN ÚNICA
     * Usamos onSnapshot con metadatos para resolver condiciones de carrera.
     */
    const unsubscribe = onSnapshot(doc(firestore, 'users', user.uid), async (snap) => {
      // Ignorar cambios locales que aún no se han confirmado en el servidor
      // Esto evita que el sistema se expulse a sí mismo durante el proceso de login
      if (snap.metadata.hasPendingWrites) return;

      if (snap.exists()) {
        const data = snap.data();
        const localSessionId = localStorage.getItem(SESSION_KEY);
        
        // CASO 1: No hay ID local (ej. Limpieza de caché o navegador nuevo tras login previo)
        // Adoptamos el ID de la DB para mantener la sesión viva.
        if (!localSessionId && data.lastSessionId) {
          localStorage.setItem(SESSION_KEY, data.lastSessionId);
        } 
        // CASO 2: Conflicto real (Otro dispositivo tomó el mando de la cuenta)
        else if (localSessionId && data.lastSessionId && localSessionId !== data.lastSessionId) {
          console.warn("Conflicto de sesión: Acceso desde otro dispositivo detectado.");
          localStorage.removeItem(SESSION_KEY);
          sessionStorage.removeItem('mm_security_unlocked');
          await signOut(auth);
          window.location.href = '/';
          return;
        }
      }
      
      // Una vez recibimos el primer snapshot válido, permitimos la entrada
      setIsInitializing(false);
    }, (error) => {
      console.error("Error en vigilancia de sesión:", error);
      setIsInitializing(false);
    });

    return () => unsubscribe();
  }, [user, isUserLoading, firestore, auth, pathname]);

  if (isUserLoading || isInitializing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary opacity-50" />
          <p className="text-sm text-muted-foreground animate-pulse font-medium">Validando integridad de sesión...</p>
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
