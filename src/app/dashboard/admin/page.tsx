"use client";

import { PageHeader } from "@/components/page-header";
import { useCollection, useFirebase, useMemoFirebase, updateDocumentNonBlocking, setDocumentNonBlocking, useDoc, deleteDocumentNonBlocking, sendResetEmail } from "@/firebase";
import { collection, doc, writeBatch, getDocs } from "firebase/firestore";
import type { UserProfile, UserModule } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format, parseISO, isAfter, subMinutes } from "date-fns";
import { es } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Edit, Mail, Megaphone, Save, Trash2, Loader2, Circle, Users, LayoutGrid, AlertTriangle, ShieldOff, KeyRound, LockKeyhole, ShieldCheck, Briefcase } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { SecurityGate } from "@/components/security-gate";

const ALL_MODULES: { id: UserModule, label: string }[] = [
    { id: 'inventory', label: 'Inventario' },
    { id: 'pos', label: 'Punto de Venta' },
    { id: 'repairs', label: 'Reparaciones' },
    { id: 'expenses', label: 'Gastos / Egresos' },
    { id: 'reports', label: 'Reportes' },
    { id: 'analysis', label: 'Análisis de Negocio' },
];

export default function AdminPage() {
    return (
        <SecurityGate module="admin">
            <AdminContent />
        </SecurityGate>
    );
}

function AnnouncementEditor() {
    const { firestore } = useFirebase();
    const { toast } = useToast();
    const announcementRef = useMemoFirebase(() => 
        firestore ? doc(firestore, 'system', 'announcements') : null, 
        [firestore]
    );
    const { data: announcement } = useDoc<any>(announcementRef);
    const [message, setMessage] = useState("");
    const [type, setType] = useState("info");
    const [active, setActive] = useState(false);
    const [isDirty, setIsDirty] = useState(false);

    useEffect(() => {
        if (announcement && !isDirty) {
            setMessage(announcement.message || "");
            setType(announcement.type || "info");
            setActive(announcement.active || false);
        }
    }, [announcement, isDirty]);

    const handleSave = () => {
        if (!announcementRef) return;
        setDocumentNonBlocking(announcementRef, {
            message,
            type,
            active,
            updatedAt: new Date().toISOString()
        }, { merge: true });
        toast({ title: "Anuncio Actualizado" });
        setIsDirty(false);
    };

    return (
        <Card className="border-primary/20 shadow-lg">
            <CardHeader className="bg-primary/5">
                <CardTitle className="flex items-center gap-2 text-primary"><Megaphone className="w-5 h-5"/> Anuncio Global</CardTitle>
                <CardDescription>Envía un mensaje a todos los negocios.</CardDescription>
            </CardHeader>
            <CardContent className="pt-6 space-y-4">
                <div className="space-y-2">
                    <Label>Mensaje</Label>
                    <Input 
                        value={message} 
                        onChange={(e) => { setMessage(e.target.value); setIsDirty(true); }} 
                        placeholder="Ej: Nueva función disponible..." 
                    />
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label>Nivel</Label>
                        <Select value={type} onValueChange={(v) => { setType(v); setIsDirty(true); }}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="info">Info</SelectItem>
                                <SelectItem value="warning">Advertencia</SelectItem>
                                <SelectItem value="critical">Crítico</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex items-center gap-2 pt-8">
                        <Switch checked={active} onCheckedChange={(v) => { setActive(v); setIsDirty(true); }} />
                        <Label>Activo</Label>
                    </div>
                </div>
                <Button className="w-full" onClick={handleSave} disabled={!isDirty}><Save className="mr-2 h-4 w-4"/> Publicar</Button>
            </CardContent>
        </Card>
    );
}

function UserEditDialog({ 
    user, 
    onSave, 
    onResetPin, 
    onSendResetEmail,
    isOpen, 
    onOpenChange 
}: { 
    user: UserProfile, 
    onSave: (data: Partial<UserProfile>) => void, 
    onResetPin: (userId: string) => void, 
    onSendResetEmail: (email: string) => void,
    isOpen: boolean, 
    onOpenChange: (val: boolean) => void 
}) {
    const [businessName, setBusinessName] = useState(user.businessName || "");
    const [email, setEmail] = useState(user.email || "");
    const [status, setStatus] = useState(user.licenseStatus);
    const [expiry, setExpiry] = useState(user.licenseExpiry?.split('T')[0] || "");
    const [enabledModules, setEnabledModules] = useState<UserModule[]>(user.enabledModules || ALL_MODULES.map(m => m.id));
    const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);

    const handleToggleModule = (moduleId: UserModule) => {
        setEnabledModules(prev => prev.includes(moduleId) ? prev.filter(m => m !== moduleId) : [...prev, moduleId]);
    };

    const handleSave = () => {
        onSave({ businessName, email, licenseStatus: status, licenseExpiry: expiry ? new Date(expiry).toISOString() : user.licenseExpiry, enabledModules });
        onOpenChange(false);
    };

    return (
        <>
            <Dialog open={isOpen} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto p-0 border-none shadow-2xl">
                    <div className="bg-slate-900 text-white p-6">
                        <DialogHeader>
                            <DialogTitle className="text-xl font-black uppercase flex items-center gap-2">
                                <Briefcase className="w-6 h-6 text-primary-foreground" /> Gestión de Negocio
                            </DialogTitle>
                            <DialogDescription className="text-slate-400 font-bold">
                                Perfil del Cliente: {user.email}
                            </DialogDescription>
                        </DialogHeader>
                    </div>
                    
                    <div className="p-6 space-y-8 bg-white">
                        {/* SECCIÓN 1: DATOS COMERCIALES */}
                        <div className="space-y-4">
                            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 border-b pb-2 flex items-center gap-2">
                                <Users className="w-4 h-4" /> 1. Información Comercial
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-xs font-bold">Nombre del Establecimiento</Label>
                                    <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} className="uppercase font-bold" />
                                </div>
                                <div className="space-y-2 opacity-60">
                                    <Label className="text-xs font-bold">Correo de Acceso (ID)</Label>
                                    <Input value={email} disabled className="bg-slate-50" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-xs font-bold">Estatus de Licencia</Label>
                                    <Select value={status} onValueChange={(val: any) => setStatus(val)}>
                                        <SelectTrigger className="font-bold"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="active" className="text-green-600 font-bold">ACTIVA</SelectItem>
                                            <SelectItem value="trial" className="text-blue-600 font-bold">PRUEBA</SelectItem>
                                            <SelectItem value="expired" className="text-destructive font-bold">EXPIRADA</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-xs font-bold">Vencimiento</Label>
                                    <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className="font-bold" />
                                </div>
                            </div>
                        </div>

                        {/* SECCIÓN 2: SEGURIDAD Y ACCESO */}
                        <div className="space-y-4 p-5 rounded-2xl bg-blue-50 border-2 border-blue-100 shadow-sm">
                            <h3 className="text-[10px] font-black uppercase tracking-widest text-blue-700 flex items-center gap-2">
                                <ShieldCheck className="w-4 h-4" /> 2. Seguridad de Acceso
                            </h3>
                            
                            <div className="bg-white p-4 rounded-xl border border-blue-200 flex justify-between items-center gap-4">
                                <div className="space-y-1">
                                    <p className="text-sm font-black text-slate-800 uppercase tracking-tight">Restablecer Contraseña de Inicio</p>
                                    <p className="text-[11px] text-muted-foreground leading-snug">
                                        Si el usuario olvidó su clave, envía un comando de reseteo. Recibirá un correo con un botón para crear una nueva contraseña.
                                    </p>
                                </div>
                                <Button 
                                    type="button" 
                                    className="shrink-0 h-12 px-6 font-black text-xs bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-200 uppercase tracking-widest"
                                    onClick={() => onSendResetEmail(user.email)}
                                >
                                    <LockKeyhole className="w-4 h-4 mr-2" /> Enviar Comando
                                </Button>
                            </div>

                            <div className="bg-white p-4 rounded-xl border border-blue-200 flex justify-between items-center gap-4">
                                <div className="space-y-1">
                                    <p className="text-sm font-black text-slate-800 uppercase tracking-tight">Seguridad Local (PIN Gerente)</p>
                                    <p className="text-[11px] text-muted-foreground leading-snug">
                                        Borra la clave de 4 dígitos que protege las secciones sensibles dentro de la tienda.
                                    </p>
                                </div>
                                <Button 
                                    type="button" 
                                    variant="outline"
                                    className="shrink-0 h-12 px-6 font-black text-xs border-destructive/20 text-destructive hover:bg-destructive/5 uppercase tracking-widest"
                                    onClick={() => setIsResetConfirmOpen(true)}
                                >
                                    <ShieldOff className="w-4 h-4 mr-2" /> Borrar PIN
                                </Button>
                            </div>
                        </div>

                        {/* SECCIÓN 3: MÓDULOS */}
                        <div className="space-y-4">
                            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 border-b pb-2 flex items-center gap-2">
                                <LayoutGrid className="w-4 h-4" /> 3. Módulos Habilitados
                            </h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {ALL_MODULES.map((m) => (
                                    <div key={m.id} className="flex items-center justify-between p-3 rounded-lg border bg-slate-50 transition-all hover:border-primary/20">
                                        <Label className="text-xs font-bold uppercase text-slate-600">{m.label}</Label>
                                        <Switch checked={enabledModules.includes(m.id)} onCheckedChange={() => handleToggleModule(m.id)} />
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="p-6 bg-slate-50 border-t flex justify-between items-center">
                        <Button variant="ghost" onClick={() => onOpenChange(false)} className="font-bold text-slate-500 uppercase">Cerrar</Button>
                        <Button onClick={handleSave} className="h-12 px-10 font-black shadow-xl uppercase tracking-tighter">Guardar Todos los Cambios</Button>
                    </div>
                </DialogContent>
            </Dialog>

            <AlertDialog open={isResetConfirmOpen} onOpenChange={setIsResetConfirmOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2 uppercase font-black">
                            <KeyRound className="text-destructive w-6 h-6" /> ¿Eliminar PIN de Seguridad?
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-slate-600">
                            Esta acción borrará la clave actual de <span className="font-bold text-slate-900">{user.businessName}</span>. 
                            El usuario deberá configurar una clave nueva para entrar a las áreas restringidas.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction 
                            onClick={() => {
                                onResetPin(user.uid);
                                setIsResetConfirmOpen(false);
                            }}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90 uppercase font-black"
                        >
                            Confirmar Reseteo
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}

function AdminContent() {
    const { firestore, user: currentUser, auth } = useFirebase();
    const { toast } = useToast();
    const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
    const [userToDelete, setUserToDelete] = useState<UserProfile | null>(null);

    const usersCollection = useMemoFirebase(() => 
        (firestore) ? collection(firestore, "users") : null, 
        [firestore]
    );
    const { data: users, isLoading } = useCollection<UserProfile>(usersCollection);

    const handleUpdateUser = (userId: string, data: Partial<UserProfile>) => {
        if (!firestore) return;
        const userRef = doc(firestore, 'users', userId);
        updateDocumentNonBlocking(userRef, data);
        toast({ title: "Cambios guardados con éxito" });
    };

    const handleSendPasswordReset = async (email: string) => {
        if (!auth) return;
        try {
            await sendResetEmail(auth, email);
            toast({ 
                title: "Comando de Seguridad Enviado", 
                description: `Se ha enviado el enlace de recuperación a ${email}.` 
            });
        } catch (e: any) {
            toast({ 
                variant: "destructive", 
                title: "Error al enviar", 
                description: "Verifica que el email sea válido." 
            });
        }
    };

    const handleResetPin = (userId: string) => {
        if (!firestore) return;
        const userRef = doc(firestore, 'users', userId);
        updateDocumentNonBlocking(userRef, { 
            securityPin: "", 
            isPinRequired: false 
        });
        toast({ 
            title: "Seguridad Reiniciada", 
            description: "El PIN ha sido eliminado correctamente." 
        });
    };

    const handleDeleteUser = () => {
        if (!firestore || !userToDelete) return;
        
        if (userToDelete.uid === currentUser?.uid) {
            toast({ title: "Acción Denegada", description: "No puedes eliminar tu propia cuenta.", variant: "destructive" });
            setUserToDelete(null);
            return;
        }

        const userRef = doc(firestore, 'users', userToDelete.uid);
        deleteDocumentNonBlocking(userRef);
        toast({ title: "Cuenta Eliminada permanentemente" });
        setUserToDelete(null);
    };

    const sortedUsers = useMemo(() => {
        if (!users) return [];
        return [...users].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    }, [users]);

    if (isLoading) return <div className="p-20 text-center"><Loader2 className="w-12 h-12 animate-spin mx-auto text-primary opacity-20" /></div>;

    return (
        <>
            <PageHeader title="Administración Central" />
            <main className="flex-1 p-4 sm:p-6 space-y-6 max-w-7xl mx-auto w-full">
                <div className="grid gap-6 md:grid-cols-3">
                    <div className="md:col-span-2 grid gap-4 grid-cols-2">
                        <Card className="shadow-sm border-primary/10">
                            <CardHeader className="pb-2"><CardTitle className="text-[10px] uppercase font-black text-muted-foreground">Total Negocios</CardTitle></CardHeader>
                            <CardContent><div className="text-3xl font-black text-primary">{users?.length || 0}</div></CardContent>
                        </Card>
                        <Card className="shadow-sm border-green-200">
                            <CardHeader className="pb-2"><CardTitle className="text-[10px] uppercase font-black text-muted-foreground">Licencias Activas</CardTitle></CardHeader>
                            <CardContent><div className="text-3xl font-black text-green-600">{users?.filter(u => u.licenseStatus === 'active').length || 0}</div></CardContent>
                        </Card>
                    </div>
                    <div className="md:col-span-1">
                        <AnnouncementEditor />
                    </div>
                </div>
                <Card className="shadow-lg">
                    <CardHeader className="flex flex-row items-center justify-between border-b bg-slate-50/50">
                        <div>
                            <CardTitle className="text-lg font-black uppercase">Directorio de Usuarios</CardTitle>
                            <CardDescription className="text-[10px] font-bold uppercase">Gestión de accesos y licencias del sistema.</CardDescription>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-muted/30">
                                    <TableHead className="text-[10px] font-black uppercase">Negocio / Cliente</TableHead>
                                    <TableHead className="text-[10px] font-black uppercase">Estatus Licencia</TableHead>
                                    <TableHead className="text-[10px] font-black uppercase">Última Conexión</TableHead>
                                    <TableHead className="text-right text-[10px] font-black uppercase">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {sortedUsers.map((u) => (
                                    <TableRow key={u.uid} className="hover:bg-muted/10">
                                        <TableCell>
                                            <div className="font-black text-xs uppercase text-slate-800">{u.businessName || "SIN NOMBRE"}</div>
                                            <div className="text-[10px] text-muted-foreground font-medium">{u.email}</div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={u.licenseStatus === 'active' ? 'default' : 'destructive'} className="text-[9px] font-black uppercase tracking-tighter">
                                                {u.licenseStatus}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-[10px] font-bold text-muted-foreground uppercase">
                                            {u.updatedAt ? format(parseISO(u.updatedAt), "dd/MM/yy HH:mm", { locale: es }) : 'N/A'}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end gap-2">
                                                <Button variant="outline" size="sm" className="h-8 text-[10px] font-black uppercase border-primary/20" onClick={() => setEditingUser(u)}>
                                                    <Edit className="w-3.5 h-3.5 mr-1" /> Gestionar
                                                </Button>
                                                <Button variant="ghost" size="sm" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => setUserToDelete(u)}>
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </main>

            {editingUser && (
                <UserEditDialog 
                    user={editingUser} 
                    isOpen={!!editingUser} 
                    onOpenChange={(o) => !o && setEditingUser(null)} 
                    onSave={(d) => handleUpdateUser(editingUser.uid, d)} 
                    onResetPin={handleResetPin}
                    onSendResetEmail={handleSendPasswordReset}
                />
            )}

            <AlertDialog open={!!userToDelete} onOpenChange={(o) => !o && setUserToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="font-black uppercase">¿Eliminar este negocio?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Esta acción revocará el acceso permanentemente para <span className="font-bold text-foreground">"{userToDelete?.businessName}"</span>. No se puede deshacer.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeleteUser} className="bg-destructive text-destructive-foreground hover:bg-destructive/90 font-black">
                            Eliminar definitivamente
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
