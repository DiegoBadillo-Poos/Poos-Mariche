"use client";

import type { UserProfile } from '@/lib/types';
import { SidebarNav } from '@/components/sidebar-nav';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';
import { useFirebase, useDoc, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Lock, LogOut, Smartphone } from 'lucide-react';
import { signOut } from 'firebase/auth';
import { isAfter, parseISO, differenceInMinutes } from 'date-fns';
import { GlobalAnnouncement } from '@/components/dashboard/global-announcement';
import { RepairDraftPill } from '@/components/repairs/repair-draft-pill';
import type { ReactNode } from 'react';

const ExchangeRateReminder = dynamic(
    () => import('@/components/dashboard/exchange-rate-reminder').then(mod => mod.ExchangeRateReminder),
    { 
        ssr: false,
        loading: () => (
             <div className="p-4 border-b">
                <Skeleton className="h-24 w-full" />
            </div>
        )
    }
);

function LicenseExpiredScreen({ profile }: { profile: UserProfile | null }) {
    const { auth } = useFirebase();
    const whatsappNumber = "584241765136";
    
    // Determinamos si es una cuenta nueva (registrada hace menos de 10 min y sin activar) o una licencia vencida
    const isNewAccount = profile && profile.createdAt && 
                         differenceInMinutes(new Date(), parseISO(profile.createdAt)) < 1440 && 
                         profile.licenseStatus === 'expired';

    const message = encodeURIComponent(
        isNewAccount 
        ? `Hola, acabo de registrar mi negocio (${profile?.email}) en Poos Mariche. Deseo activar mi periodo de prueba de 7 días.`
        : `Hola, mi licencia de Poos Mariche (${profile?.email}) ha expirado o requiere renovación. Deseo activarla.`
    );
    
    const handleSignOut = () => {
        localStorage.removeItem('mm_session_id');
        sessionStorage.removeItem('mm_active_session_id');
        auth && signOut(auth);
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
            <Card className="max-w-md w-full shadow-2xl border-t-4 border-primary">
                <CardHeader className="text-center">
                    <div className="flex justify-center mb-4">
                        <div className="p-3 bg-primary/10 rounded-full">
                            {isNewAccount ? <Smartphone className="w-12 h-12 text-primary" /> : <Lock className="w-12 h-12 text-destructive" />}
                        </div>
                    </div>
                    <CardTitle className="text-2xl">
                        {isNewAccount ? "Activación Requerida" : "Licencia Expirada"}
                    </CardTitle>
                    <CardDescription>
                        {isNewAccount 
                            ? "¡Gracias por registrarte! Para garantizar la seguridad, todas las cuentas deben ser activadas manualmente." 
                            : "Tu acceso al sistema ha sido suspendido temporalmente por vencimiento de licencia."}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-center">
                    <p className="text-sm text-muted-foreground">
                        {isNewAccount 
                            ? "Por favor, comunícate con nosotros vía WhatsApp para habilitar tu negocio y comenzar tus 7 días de prueba gratuita."
                            : "Para reactivar tu negocio y recuperar el acceso a tus datos, por favor contacta con el administrador del sistema."}
                    </p>
                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3 text-left">
                        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-800 font-medium">
                            Tus datos están protegidos. Una vez el administrador te active, podrás entrar y ver toda tu información de inmediato.
                        </p>
                    </div>
                    <div className="flex flex-col gap-2">
                        <Button className="w-full bg-green-600 hover:bg-green-700 h-12 text-base font-bold" onClick={() => window.open(`https://wa.me/${whatsappNumber}?text=${message}`, '_blank')}>
                            Activar por WhatsApp
                        </Button>
                        <Button variant="ghost" onClick={handleSignOut}>
                            <LogOut className="w-4 h-4 mr-2" /> Cerrar Sesión
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { firestore, user, isUserLoading } = useFirebase();
  
  const profileRef = useMemoFirebase(() => 
    (firestore && user) ? doc(firestore, 'users', user.uid) : null,
    [firestore, user?.uid]
  );
  const { data: profile, isLoading: isProfileLoading } = useDoc<UserProfile>(profileRef);

  if (isUserLoading || isProfileLoading) {
      return (
          <div className="flex h-screen items-center justify-center">
              <div className="flex flex-col items-center gap-4">
                  <Skeleton className="h-12 w-12 rounded-full" />
                  <Skeleton className="h-4 w-32" />
              </div>
          </div>
      );
  }

  // Lógica de validación de Licencia
  const isExpired = profile && 
                    !profile.isAdmin && 
                    (profile.licenseStatus === 'expired' || (profile.licenseExpiry && isAfter(new Date(), parseISO(profile.licenseExpiry))));

  if (isExpired) {
      return <LicenseExpiredScreen profile={profile} />;
  }

  return (
    <SidebarProvider>
      <SidebarNav />
      <SidebarInset>
          <GlobalAnnouncement />
          <ExchangeRateReminder />
          {children}
          <RepairDraftPill />
      </SidebarInset>
    </SidebarProvider>
  );
}
