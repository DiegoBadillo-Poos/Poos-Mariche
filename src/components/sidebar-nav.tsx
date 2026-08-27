"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Package,
  Wrench,
  ShoppingCart,
  BarChart2,
  User,
  TrendingUp,
  ShieldCheck,
  HandCoins,
  HandHelping,
  Lock,
  Download,
  Loader2
} from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter
} from '@/components/ui/sidebar';
import { AppLogo } from '@/components/icons';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { useFirebase, useDoc, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';
import type { UserProfile, UserModule } from '@/lib/types';
import { Button } from './ui/button';
import { useState, useEffect } from 'react';

type NavItem = {
    href: string;
    icon: any;
    label: string;
    module?: UserModule;
};

const navItems: NavItem[] = [
  { href: '/dashboard/pos', icon: ShoppingCart, label: 'Punto de Venta', module: 'pos' },
  { href: '/dashboard/inventory', icon: Package, label: 'Inventario', module: 'inventory' },
  { href: '/dashboard/repairs', icon: Wrench, label: 'Reparaciones', module: 'repairs' },
  { href: '/dashboard/reports', icon: BarChart2, label: 'Reportes', module: 'reports' },
  { href: '/dashboard/analysis', icon: TrendingUp, label: 'Análisis', module: 'analysis' },
  { href: '/dashboard/fiados', icon: HandCoins, label: 'Fiados / Créditos', module: 'fiados' },
  { href: '/dashboard/loans', icon: HandHelping, label: 'Préstamos', module: 'loans' },
];

export function SidebarNav() {
  const pathname = usePathname();
  const { firestore, user } = useFirebase();
  const [installPrompt, setInstallPrompt] = useState<any>(null);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: any) => {
        event.preventDefault();
        setInstallPrompt(event);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  const profileRef = useMemoFirebase(() => 
    (firestore && user) ? doc(firestore, 'users', user.uid) : null,
    [firestore, user?.uid]
  );
  const { data: profile } = useDoc<UserProfile>(profileRef);

  const isAdmin = !!profile?.isAdmin;
  
  const filteredNavItems = navItems.filter(item => {
      if (!item.module) return true;
      if (!profile) return false;
      
      const enabledModules = profile.enabledModules || ['inventory', 'pos', 'repairs', 'reports', 'analysis', 'fiados', 'loans'];
      return enabledModules.includes(item.module);
  });

  const isManagerMode = typeof window !== 'undefined' && sessionStorage.getItem('mm_security_unlocked') === 'true';

  const handleLockManager = () => {
      sessionStorage.removeItem('mm_security_unlocked');
      window.location.reload();
  };

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link href="/dashboard/pos" className="flex items-center gap-2">
            <AppLogo className="w-8 h-8 text-sidebar-primary" />
            <span className={cn(
                "text-lg font-semibold text-sidebar-foreground",
                "group-data-[collapsible=icon]:hidden"
            )}>
                POS Mariche
            </span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          {filteredNavItems.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                asChild
                isActive={pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))}
                tooltip={{ children: item.label }}
              >
                <Link href={item.href}>
                  <item.icon />
                  <span>{item.label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}

          {isAdmin && (
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={pathname.startsWith('/dashboard/admin')}
                tooltip={{ children: 'Administración' }}
                className="text-amber-500 hover:text-amber-600"
              >
                <Link href="/dashboard/admin">
                  <ShieldCheck />
                  <span>Administración</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter className='mt-auto p-4 space-y-3'>
        
        {installPrompt ? (
            <Button 
                onClick={handleInstall}
                variant="default" 
                className="w-full justify-start h-10 text-[10px] font-black bg-blue-600 hover:bg-blue-700 text-white shadow-lg animate-in fade-in slide-in-from-bottom-2"
            >
                <Download className="mr-2 h-3.5 w-3.5" />
                INSTALAR EN ESCRITORIO
            </Button>
        ) : (
            <div className="w-full p-2 rounded-md border border-slate-200 bg-slate-50 flex items-center gap-2 opacity-60">
                <Loader2 className="h-3 w-3 animate-spin text-slate-400" />
                <span className="text-[9px] font-black text-slate-500 uppercase">Buscando Navegador...</span>
            </div>
        )}

        {isManagerMode && (
            <Button 
                variant="outline" 
                size="sm" 
                className="w-full justify-start h-9 text-[10px] font-black border-destructive/30 text-destructive hover:bg-destructive/5"
                onClick={handleLockManager}
            >
                <Lock className="w-3 h-3 mr-2" />
                CERRAR SESIÓN GERENTE
            </Button>
        )}
        <Separator className="my-2 bg-sidebar-border/50"/>
        <SidebarMenu>
            <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip={{children: 'Mi Perfil / Ajustes'}} isActive={pathname === '/dashboard/settings'}>
                    <Link href="/dashboard/settings">
                        <User />
                        <span className="truncate">{profile?.email || user?.email || 'Mi Cuenta'}</span>
                    </Link>
                </SidebarMenuButton>
            </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}