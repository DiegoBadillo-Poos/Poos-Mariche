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
import { AlertTriangle, Lock, LogOut, MessageCircle } from 'lucide-react';
import { signOut } from 'firebase/auth';
import { isAfter, parseISO, differenceInMinutes } from 'date-fns';
import { GlobalAnnouncement } from '@/components/dashboard/global-announcement';
import { RepairDraftPill } from '@/components/repairs/repair-draft-pill';
import { DashboardProvider } from '@/contexts/dashboard-context';
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
    
    const isNewAccount = profile && profile.createdAt && 
                         differenceInMinutes(new Date(), parseISO(profile.createdAt)) < 1440 && 
                         profile.licenseStatus === 'expired';

    const message = encodeURIComponent(
        isNewAccount 
        ? `Hola, acabo de registrar mi negocio (${profile?.email}) en POS Mariche. Deseo activar mi periodo de prueba de 7 días.`
        : `Hola, mi cuenta de POS Mariche (${profile?.email}) ha sido suspendida o la licencia ha expirado. Deseo gestionar la renovación de mi acceso.`
    );
    
    const handleSignOut = () => {
        sessionStorage.removeItem('mm_session_id');
        sessionStorage.removeItem('mm_security_unlocked');
        auth && signOut(auth);
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
            <Card className="max-w-md w-full shadow-2xl border-t-8 border-destructive">
                <CardHeader className="text-center">
                    <div className="flex justify-center mb-4">
                        <div className="p-4 bg-destructive/10 rounded-full">
                            <Lock className="w-12 h-12 text-destructive" />
                        </div>
                    </div>
                    <CardTitle className="text-2xl font-black uppercase tracking-tight text-slate-800">
                        {isNewAccount ? "Activación Requerida" : "Acceso Suspendido"}
                    </CardTitle>
                    <CardDescription className="font-bold text-slate-500">
                        {isNewAccount 
                            ? "¡Bienvenido a POS Mariche! Tu cuenta está siendo verificada." 
                            : "Tu acceso al sistema ha sido revocado temporalmente."}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6 text-center">
                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-left space-y-2">
                        <div className="flex items-center gap-2 text-amber-700 font-black text-[10px] uppercase">
                            <AlertTriangle className="w-4 h-4" /> Nota del Administrador
                        </div>
                        <p className="text-xs text-amber-900 leading-relaxed font-medium">
                            {isNewAccount 
                                ? "Por seguridad, todas las cuentas nuevas deben ser activadas manualmente por el administrador para iniciar los 7 días de prueba gratuita."
                                : "Tu licencia ha expirado o el administrador ha suspendido tu acceso por falta de pago o incumplimiento de términos."}
                        </p>
                    </div>

                    <div className="space-y-3">
                        <Button 
                            className="w-full bg-green-600 hover:bg-green-700 h-14 text-base font-black shadow-xl" 
                            onClick={() => window.open(`https://wa.me/${whatsappNumber}?text=${message}`, '_blank')}
                        >
                            <MessageCircle className="mr-2 h-5 w-5 fill-white" />
                            CONTACTAR PARA ACTIVAR
                        </Button>
                        <Button variant="ghost" className="w-full text-slate-400 font-bold" onClick={handleSignOut}>
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
          <div className="flex h-screen items-center justify-center bg-slate-50">
              <div className="flex flex-col items-center gap-4">
                  <div className="relative">
                      <div className="h-16 w-16 rounded-full border-4 border-primary/10 animate-spin border-t-primary" />
                      <Lock className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 text-primary/30" />
                  </div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-primary animate-pulse">Validando Credenciales...</p>
              </div>
          </div>
      );
  }

  const isExpired = profile && 
                    !profile.isAdmin && 
                    (profile.licenseStatus === 'expired' || (profile.licenseExpiry && isAfter(new Date(), parseISO(profile.licenseExpiry))));

  if (isExpired) {
      return <LicenseExpiredScreen profile={profile} />;
  }

  return (
    <DashboardProvider>
        <SidebarProvider>
        <SidebarNav />
        <SidebarInset>
            <GlobalAnnouncement />
            <ExchangeRateReminder />
            {children}
            <RepairDraftPill />
        </SidebarInset>
        </SidebarProvider>
    </DashboardProvider>
  );
}
