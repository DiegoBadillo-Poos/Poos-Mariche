"use client";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, LogOut, ShieldCheck, UserCog, Mail, Lock, KeyRound, AlertCircle, FileSpreadsheet, DownloadCloud, UploadCloud, Database, RefreshCcw, MapPin, Hash, ReceiptText, Wrench, Save, PiggyBank, Users, Home, Percent, ShieldAlert, Wallet, Landmark, DollarSign, Smartphone, CreditCard, Banknote, Info, Eye, FileText, MoveHorizontal, Hammer, HandCoins } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useDoc, useFirebase, useMemoFirebase, setDocumentNonBlocking, updateDocumentNonBlocking, useCollection } from "@/firebase";
import { doc, collection, writeBatch } from "firebase/firestore";
import { useEffect, useState, useRef, useMemo } from "react";
import type { AppSettings, UserProfile, Product, RepairJob, Sale, Fiado, UserModule, PaymentMethod, RepairInputMode } from "@/lib/types";
import { Switch } from "@/components/ui/switch";
import { signOut } from "firebase/auth";
import { updateUserEmail, updateUserPassword } from "@/firebase/non-blocking-login";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";
import { format, parseISO } from "date-fns";
import { AdminAuthDialog } from "@/components/admin-auth-dialog";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { SecurityGate } from "@/components/security-gate";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const settingsSchema = z.object({
    bcvRate: z.coerce.number().positive("La tasa debe ser mayor a 0"),
    parallelRate: z.coerce.number().positive("La tasa debe ser mayor a 0"),
    profitMargin: z.coerce.number().min(0, "El margen no puede ser negativo"),
    autoUpdateBcv: z.boolean().default(false),
    lastUpdated: z.string().optional(),
    weeklyRent: z.coerce.number().min(0, "Mínimo 0"),
    investmentPercentage: z.coerce.number().min(0).max(100, "Máximo 100%"),
    partnersCount: z.coerce.number().min(1, "Al menos 1 socio"),
    repairInputMode: z.enum(['inventory', 'manual', 'both']).default('both'),
    initialBalances: z.object({
        'Efectivo USD': z.coerce.number().default(0),
        'Efectivo Bs': z.coerce.number().default(0),
        'Tarjeta / Pago Móvil': z.coerce.number().default(0),
        'Transferencia': z.coerce.number().default(0),
    })
});

const profileSchema = z.object({
    businessName: z.string().min(2, "Mínimo 2 caracteres"),
    businessAddress: z.string().optional(),
    businessRIF: z.string().optional(),
    showInfoOnReceipt: z.boolean().default(false),
    showRateOnReceipt: z.boolean().default(true),
    showTermsOnReceipt: z.boolean().default(true),
    printLeftMargin: z.coerce.number().min(0).max(10).default(0),
    repairWarrantyPolicy: z.string().optional(),
    repairPickupPolicy: z.string().optional(),
    repairDisclaimer: z.string().optional(),
});

const PROTECTABLE_MODULES: { id: UserModule, label: string }[] = [
    { id: 'inventory', label: 'Inventario' },
    { id: 'pos', label: 'Punto de Venta' },
    { id: 'repairs', label: 'Reparaciones' },
    { id: 'expenses', label: 'Gastos / Egresos' },
    { id: 'fiados', label: 'Control de Fiados' },
    { id: 'reports', label: 'Reportes' },
    { id: 'analysis', label: 'Análisis de Negocio' },
];

export default function SettingsPage() {
    return (
        <SecurityGate module="settings">
            <SettingsContent />
        </SecurityGate>
    );
}

function SettingsContent() {
    const { toast } = useToast();
    const { firestore, auth, user } = useFirebase();
    const [isUpdatingCredentials, setIsUpdatingCredentials] = useState(false);
    const [isUpdatingPin, setIsUpdatingPin] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [isSavingSettings, setIsSavingSettings] = useState(false);
    const [isSavingBalances, setIsSavingBalances] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    
    const settingsRef = useMemoFirebase(() => 
        (firestore && user) ? doc(firestore, 'users', user.uid, 'app-settings', 'main') : null,
        [firestore, user?.uid]
    );
    const { data: settings } = useDoc<AppSettings>(settingsRef);

    const userProfileRef = useMemoFirebase(() =>
        (firestore && user) ? doc(firestore, 'users', user.uid) : null,
        [firestore, user?.uid]
    );
    const { data: profile } = useDoc<UserProfile>(userProfileRef);

    const productsCol = useMemoFirebase(() => (firestore && user) ? collection(firestore, 'users', user.uid, 'products') : null, [firestore, user?.uid]);
    const { data: products } = useCollection<Product>(productsCol);

    const settingsForm = useForm<z.infer<typeof settingsSchema>>({
        resolver: zodResolver(settingsSchema),
        defaultValues: { 
            bcvRate: 1, 
            parallelRate: 1, 
            profitMargin: 100, 
            autoUpdateBcv: false,
            weeklyRent: 40,
            investmentPercentage: 30,
            partnersCount: 2,
            repairInputMode: 'both',
            initialBalances: {
                'Efectivo USD': 0,
                'Efectivo Bs': 0,
                'Tarjeta / Pago Móvil': 0,
                'Transferencia': 0,
            }
        }
    });

    const profileForm = useForm<z.infer<typeof profileSchema>>({
        resolver: zodResolver(profileSchema),
        defaultValues: { 
            businessName: "", 
            businessAddress: "", 
            businessRIF: "", 
            showInfoOnReceipt: false,
            showRateOnReceipt: true,
            showTermsOnReceipt: true,
            printLeftMargin: 0,
            repairWarrantyPolicy: "",
            repairPickupPolicy: "",
            repairDisclaimer: ""
        }
    });

    const [newPin, setNewPin] = useState("");
    const [currentPinVerify, setCurrentPinVerify] = useState("");
    const [isPinRequired, setIsPinRequired] = useState(true);
    const [lockedModules, setLockedModules] = useState<UserModule[]>([]);

    const availableProtectableModules = useMemo(() => {
        if (!profile) return [];
        const enabled = profile.enabledModules || ['inventory', 'pos', 'repairs', 'reports', 'analysis', 'expenses', 'fiados'];
        return PROTECTABLE_MODULES.filter(m => enabled.includes(m.id));
    }, [profile]);

    useEffect(() => {
        if (settings && !settingsForm.formState.isDirty) {
            const combinedDigital = (settings.initialBalances?.['Tarjeta'] || 0) + 
                                   (settings.initialBalances?.['Pago Móvil'] || 0) + 
                                   (settings.initialBalances?.['Tarjeta / Pago Móvil'] || 0);

            settingsForm.reset({
                bcvRate: settings.bcvRate,
                parallelRate: settings.parallelRate,
                profitMargin: settings.profitMargin,
                autoUpdateBcv: settings.autoUpdateBcv || false,
                lastUpdated: settings.lastUpdated,
                weeklyRent: settings.weeklyRent ?? 40,
                investmentPercentage: settings.investmentPercentage ?? 30,
                partnersCount: settings.partnersCount ?? 2,
                repairInputMode: settings.repairInputMode || 'both',
                initialBalances: {
                    'Efectivo USD': settings.initialBalances?.['Efectivo USD'] || 0,
                    'Efectivo Bs': settings.initialBalances?.['Efectivo Bs'] || 0,
                    'Tarjeta / Pago Móvil': combinedDigital,
                    'Transferencia': settings.initialBalances?.['Transferencia'] || 0,
                }
            });
        }
    }, [settings, settingsForm]);

    useEffect(() => {
        if (profile && !profileForm.formState.isDirty) {
            profileForm.reset({ 
                businessName: (profile.businessName || "").toUpperCase(),
                businessAddress: (profile.businessAddress || "").toUpperCase(),
                businessRIF: (profile.businessRIF || "").toUpperCase(),
                showInfoOnReceipt: profile.showInfoOnReceipt || false,
                showRateOnReceipt: profile.showRateOnReceipt !== false,
                showTermsOnReceipt: profile.showTermsOnReceipt !== false,
                printLeftMargin: profile.printLeftMargin || 0,
                repairWarrantyPolicy: (profile.repairWarrantyPolicy || "4 DÍAS POR EL SERVICIO REALIZADO.").toUpperCase(),
                repairPickupPolicy: (profile.repairPickupPolicy || "7 DÍAS MÁXIMO UNA VEZ NOTIFICADO...").toUpperCase(),
                repairDisclaimer: (profile.repairDisclaimer || "NO NOS HACEMOS RESPONSABLES POR TELÉFONOS MOJADOS...").toUpperCase()
            });
            setIsPinRequired(profile.isPinRequired !== false);
            setLockedModules(profile.lockedModules || ['reports', 'analysis']);
        }
    }, [profile, profileForm]);

    const handleSaveSettings = async (values: z.infer<typeof settingsSchema>) => {
        if (!settingsRef) return;
        setIsSavingSettings(true);
        try {
            await setDocumentNonBlocking(settingsRef, { ...values, lastUpdated: new Date().toISOString() }, { merge: true });
            toast({ title: "Configuración Guardada" });
            settingsForm.reset(values);
        } catch (e) {
            toast({ variant: "destructive", title: "Error" });
        } finally {
            setIsSavingSettings(false);
        }
    }

    const handleSaveBalances = async (values: z.infer<typeof settingsSchema>) => {
        if (!settingsRef) return;
        setIsSavingBalances(true);
        try {
            await setDocumentNonBlocking(settingsRef, { 
                initialBalances: values.initialBalances,
                balancesUpdatedAt: new Date().toISOString() 
            }, { merge: true });
            toast({ 
                title: "Fondos Sincronizados", 
                description: "El Saldo Real ahora contará desde este momento exacto." 
            });
            settingsForm.reset(values);
        } catch (e) {
            toast({ variant: "destructive", title: "Error al sincronizar" });
        } finally {
            setIsSavingBalances(false);
        }
    }

    const handleSaveProfile = (values: z.infer<typeof profileSchema>) => {
        if (!userProfileRef) return;
        const finalValues = {
            ...values,
            businessName: values.businessName.toUpperCase(),
            businessAddress: values.businessAddress?.toUpperCase(),
            businessRIF: values.businessRIF?.toUpperCase(),
            repairWarrantyPolicy: values.repairWarrantyPolicy?.toUpperCase(),
            repairPickupPolicy: values.repairPickupPolicy?.toUpperCase(),
            repairDisclaimer: values.repairDisclaimer?.toUpperCase(),
        };
        setDocumentNonBlocking(userProfileRef, finalValues, { merge: true });
        toast({ title: "Perfil Actualizado" });
        profileForm.reset(finalValues);
    }

    const toggleModuleLock = (moduleId: UserModule) => {
        setLockedModules(prev => 
            prev.includes(moduleId) ? prev.filter(m => m !== moduleId) : [...prev, moduleId]
        );
    };

    const handleUpdatePinSettings = async () => {
        if (!userProfileRef) return;

        if (profile?.securityPin) {
            if (!currentPinVerify) {
                toast({ variant: "destructive", title: "PIN Actual Requerido" });
                return;
            }
            if (currentPinVerify !== profile.securityPin) {
                toast({ variant: "destructive", title: "PIN Actual Incorrecto" });
                return;
            }
        }

        setIsUpdatingPin(true);
        try {
            const updateData: Partial<UserProfile> = { 
                isPinRequired: isPinRequired,
                lockedModules: lockedModules
            };
            if (newPin) updateData.securityPin = newPin;

            updateDocumentNonBlocking(userProfileRef, updateData);
            toast({ title: "Seguridad Actualizada" });
            sessionStorage.removeItem('mm_security_unlocked');
            setNewPin("");
            setCurrentPinVerify("");
        } catch (e) {
            toast({ variant: "destructive", title: "Error" });
        } finally {
            setIsUpdatingPin(false);
        }
    };

    const handleExportSystemBackup = () => {
        const wb = XLSX.utils.book_new();
        const inventoryData = (products || []).map(p => ({ 
            'ID': p.id, 'SKU': p.sku, 'Nombre': p.name, 'Categoria': p.category, 
            'Costo': p.costPrice, 'Stock': p.stockLevel
        }));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(inventoryData), "Inventario");
        XLSX.writeFile(wb, `Respaldo_POSMariche_${format(new Date(), 'dd-MM-yyyy')}.xlsx`);
    };

    const handleSignOut = () => {
        if (auth) {
            localStorage.removeItem('mm_active_session_id');
            signOut(auth).then(() => { window.location.href = '/'; });
        }
    };

    return (
        <>
            <PageHeader title="Configuración y Perfil" />
            <main className="flex-1 p-4 sm:p-6 space-y-8 max-w-4xl mx-auto w-full pb-20">
                
                <Card className="shadow-md border-primary/20 bg-primary/5">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-primary uppercase font-bold text-sm"><ShieldCheck className="w-5 h-5"/> Seguridad de Gerente</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className={cn("flex items-center justify-between p-4 rounded-lg border bg-white")}>
                            <div className="space-y-0.5">
                                <Label className="text-base font-black uppercase tracking-tight">Seguridad Global por PIN</Label>
                                <p className="text-xs text-muted-foreground">Exige PIN para entrar a áreas sensibles.</p>
                            </div>
                            <Switch checked={isPinRequired} onCheckedChange={setIsPinRequired} />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="p-4 bg-white rounded-lg border space-y-3">
                                <Label className="text-xs font-black uppercase text-muted-foreground">Bloquear secciones:</Label>
                                {availableProtectableModules.map(m => (
                                    <div key={m.id} className="flex items-center justify-between py-1">
                                        <Label className="text-xs font-bold" htmlFor={`lock-${m.id}`}>{m.label}</Label>
                                        <Switch id={`lock-${m.id}`} checked={lockedModules.includes(m.id)} onCheckedChange={() => toggleModuleLock(m.id)} />
                                    </div>
                                ))}
                            </div>
                            <div className="p-4 bg-white rounded-lg border space-y-4">
                                {profile?.securityPin && (
                                    <div className="space-y-2">
                                        <Label className="text-[10px] font-black uppercase">PIN Actual</Label>
                                        <Input type="password" value={currentPinVerify} onChange={(e) => setCurrentPinVerify(e.target.value)} className="h-10" />
                                    </div>
                                )}
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-black uppercase">Nuevo PIN</Label>
                                    <Input type="password" value={newPin} onChange={(e) => setNewPin(e.target.value)} placeholder="EJ: 1234" className="h-10" />
                                </div>
                                <Button className="w-full h-10 uppercase font-bold" onClick={handleUpdatePinSettings} disabled={isUpdatingPin}>
                                    {isUpdatingPin ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                                    Guardar Seguridad
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="shadow-md border-amber-100 bg-amber-50/30">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-amber-700 uppercase font-bold text-sm"><Wallet className="w-5 h-5" /> Arqueo de Caja</CardTitle>
                    </CardHeader>
                    <Form {...settingsForm}>
                        <form onSubmit={settingsForm.handleSubmit(handleSaveBalances)}>
                            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <FormField control={settingsForm.control} name="initialBalances.Efectivo USD" render={({ field }) => (
                                    <FormItem><FormLabel className="uppercase text-[10px] font-bold">Fondo USD</FormLabel><FormControl><Input type="number" step="0.01" {...field} className="bg-white" /></FormControl></FormItem>
                                )} />
                                <FormField control={settingsForm.control} name="initialBalances.Efectivo Bs" render={({ field }) => (
                                    <FormItem><FormLabel className="uppercase text-[10px] font-bold">Fondo Bs</FormLabel><FormControl><Input type="number" step="0.01" {...field} className="bg-white" /></FormControl></FormItem>
                                )} />
                                <FormField control={settingsForm.control} name="initialBalances.Tarjeta / Pago Móvil" render={({ field }) => (
                                    <FormItem><FormLabel className="uppercase text-[10px] font-bold">Digital / Pago Móvil</FormLabel><FormControl><Input type="number" step="0.01" {...field} className="bg-white" /></FormControl></FormItem>
                                )} />
                                <FormField control={settingsForm.control} name="initialBalances.Transferencia" render={({ field }) => (
                                    <FormItem><FormLabel className="uppercase text-[10px] font-bold">Saldo Bancos</FormLabel><FormControl><Input type="number" step="0.01" {...field} className="bg-white" /></FormControl></FormItem>
                                )} />
                            </CardContent>
                            <CardFooter className="border-t border-amber-100 pt-4">
                                <Button type="submit" disabled={isSavingBalances} className="bg-amber-600 hover:bg-amber-700 uppercase font-bold">
                                    {isSavingBalances ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCcw className="w-4 h-4 mr-2" />}
                                    Sincronizar Fondo Actual
                                </Button>
                            </CardFooter>
                        </form>
                    </Form>
                </Card>

                <Card className="shadow-md">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 uppercase font-bold text-sm"><UserCog className="w-5 h-5"/> Perfil del Negocio</CardTitle>
                    </CardHeader>
                    <Form {...profileForm}>
                        <form onSubmit={profileForm.handleSubmit(handleSaveProfile)}>
                            <CardContent className="space-y-6">
                                <FormField control={profileForm.control} name="businessName" render={({ field }) => (
                                    <FormItem><FormLabel className="text-[10px] font-bold uppercase">Nombre Comercial</FormLabel><FormControl><Input {...field} className="uppercase" /></FormControl></FormItem>
                                )} />
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <FormField control={profileForm.control} name="businessRIF" render={({ field }) => (
                                        <FormItem><FormLabel className="text-[10px] font-bold uppercase">RIF</FormLabel><FormControl><Input {...field} className="uppercase" /></FormControl></FormItem>
                                    )} />
                                    <FormField control={profileForm.control} name="businessAddress" render={({ field }) => (
                                        <FormItem><FormLabel className="text-[10px] font-bold uppercase">Dirección</FormLabel><FormControl><Input {...field} className="uppercase" /></FormControl></FormItem>
                                    )} />
                                </div>
                                <div className="p-4 rounded-xl border-2 border-primary/10 bg-primary/5 space-y-4">
                                    <div className="flex items-center gap-3">
                                        <MoveHorizontal className="w-5 h-5 text-primary" />
                                        <Label className="text-sm font-black uppercase">Calibración de Impresión (Windows)</Label>
                                    </div>
                                    <FormField control={profileForm.control} name="printLeftMargin" render={({ field }) => (
                                        <FormItem className="space-y-4">
                                            <div className="flex justify-between items-center">
                                                <FormLabel className="text-[10px] font-bold uppercase">Corregir Margen Izquierdo</FormLabel>
                                                <Badge className="bg-primary text-white">{field.value}mm</Badge>
                                            </div>
                                            <FormControl><Slider value={[field.value]} max={10} step={1} onValueChange={(vals) => field.onChange(vals[0])} /></FormControl>
                                        </FormItem>
                                    )} />
                                </div>
                            </CardContent>
                            <CardFooter className="border-t pt-4">
                                <Button type="submit" className="uppercase font-bold">Actualizar Perfil</Button>
                            </CardFooter>
                        </form>
                    </Form>
                </Card>

                <Card className="shadow-md">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 uppercase font-bold text-sm text-primary"><Hammer className="w-5 h-5" /> Configuración de Taller</CardTitle>
                    </CardHeader>
                    <Form {...settingsForm}>
                        <form onSubmit={settingsForm.handleSubmit(handleSaveSettings)}>
                            <CardContent className="space-y-6">
                                <FormField control={settingsForm.control} name="repairInputMode" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[10px] font-bold uppercase text-muted-foreground">Modo de Registro de Repuestos</FormLabel>
                                        <Select value={field.value} onValueChange={field.onChange}>
                                            <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                            <SelectContent>
                                                <SelectItem value="inventory">INVENTARIO (ESTRICTO)</SelectItem>
                                                <SelectItem value="manual">MANUAL (RÁPIDO)</SelectItem>
                                                <SelectItem value="both">MODO MIXTO (RECOMENDADO)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <FormDescription className="text-[10px]">
                                            Elige cómo prefieres registrar las pantallas y piezas en tus órdenes técnicas.
                                        </FormDescription>
                                    </FormItem>
                                )} />
                                
                                <Separator />

                                <div className="space-y-4">
                                    <p className="text-[10px] font-bold uppercase text-primary tracking-widest">Textos Legales de Tickets</p>
                                    <FormField control={profileForm.control} name="showTermsOnReceipt" render={({ field }) => (
                                        <FormItem className="flex items-center justify-between rounded-lg border p-3 bg-slate-50">
                                            <FormLabel className="text-xs font-bold uppercase cursor-pointer">Mostrar términos en nota cliente</FormLabel>
                                            <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                        </FormItem>
                                    )} />
                                    <div className="grid grid-cols-1 gap-4">
                                        <FormField control={profileForm.control} name="repairWarrantyPolicy" render={({ field }) => (
                                            <FormItem><FormLabel className="text-[10px] font-bold uppercase">Política de Garantía</FormLabel><FormControl><Textarea {...field} className="uppercase text-xs" /></FormControl></FormItem>
                                        )} />
                                        <FormField control={profileForm.control} name="repairPickupPolicy" render={({ field }) => (
                                            <FormItem><FormLabel className="text-[10px] font-bold uppercase">Política de Retiro</FormLabel><FormControl><Textarea {...field} className="uppercase text-xs" /></FormControl></FormItem>
                                        )} />
                                        <FormField control={profileForm.control} name="repairDisclaimer" render={({ field }) => (
                                            <FormItem><FormLabel className="text-[10px] font-bold uppercase">Nota de Responsabilidad</FormLabel><FormControl><Textarea {...field} className="uppercase text-xs" /></FormControl></FormItem>
                                        )} />
                                    </div>
                                </div>
                            </CardContent>
                            <CardFooter className="border-t pt-4">
                                <Button type="submit" disabled={isSavingSettings} className="uppercase font-bold">Guardar Ajustes de Taller</Button>
                            </CardFooter>
                        </form>
                    </Form>
                </Card>

                <Card className="shadow-md">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-primary uppercase font-bold text-sm"><PiggyBank className="w-5 h-5" /> Parámetros Financieros</CardTitle>
                    </CardHeader>
                    <Form {...settingsForm}>
                        <form onSubmit={settingsForm.handleSubmit(handleSaveSettings)}>
                            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <FormField control={settingsForm.control} name="bcvRate" render={({ field }) => (
                                    <FormItem><FormLabel className="text-[10px] font-bold uppercase">Tasa BCV</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl></FormItem>
                                )} />
                                <FormField control={settingsForm.control} name="parallelRate" render={({ field }) => (
                                    <FormItem><FormLabel className="text-[10px] font-bold uppercase">Tasa Reposición</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl></FormItem>
                                )} />
                                <FormField control={settingsForm.control} name="profitMargin" render={({ field }) => (
                                    <FormItem><FormLabel className="text-[10px] font-bold uppercase">Margen Global (%)</FormLabel><FormControl><Input type="number" {...field} /></FormControl></FormItem>
                                )} />
                            </CardContent>
                            <CardFooter className="border-t pt-4">
                                <Button type="submit" disabled={isSavingSettings} className="uppercase font-bold">Guardar Tasas y Márgenes</Button>
                            </CardFooter>
                        </form>
                    </Form>
                </Card>

                <div className="flex flex-col items-center gap-4 pt-8">
                    <Button variant="outline" onClick={handleExportSystemBackup} className="uppercase font-bold">
                        <DownloadCloud className="mr-2 h-4 w-4" /> Respaldo de Inventario (Excel)
                    </Button>
                    <Button variant="destructive" onClick={handleSignOut} size="lg" className="uppercase font-bold w-full max-w-xs shadow-xl">
                        <LogOut className="mr-2 h-5 w-5" /> Cerrar Sesión
                    </Button>
                </div>
            </main>
        </>
    );
}
