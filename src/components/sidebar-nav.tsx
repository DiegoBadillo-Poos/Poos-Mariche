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
import { PwaInstallButton } from './pwa-install-button';

type NavItem = {
    href: string;
    icon: any;
    label: string;
    module?: UserModule;
};

// Nuevo orden solicitado por el usuario
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
      <SidebarFooter className='mt-auto p-4 space-y-2'>
        <PwaInstallButton />
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
