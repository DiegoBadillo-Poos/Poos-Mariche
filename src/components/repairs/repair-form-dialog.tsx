"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import type { RepairJob, RepairStatus, Product, UserProfile, ReservedPart, AppSettings } from "@/lib/types";
import { useState, useEffect, ReactNode, useMemo, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "../ui/textarea";
import { useCurrency } from "@/hooks/use-currency";
import { Label } from "../ui/label";
import { useFirebase, useCollection, useMemoFirebase, useDoc } from "@/firebase";
import { doc, runTransaction, query, orderBy, collection, type DocumentSnapshot } from "firebase/firestore";
import { handlePrintAllTickets } from "./repair-ticket";
import { User, Smartphone, Package, Search, Plus, Trash2, Loader2, DollarSign, Calculator, UserCheck, MapPin, Hammer, Minus, TicketPercent, CheckCircle2, Lock } from "lucide-react";
import { format, addDays } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "../ui/command";
import { cn } from "@/lib/utils";
import { Badge } from "../ui/badge";
import { ProductFormDialog } from "../inventory/product-form-dialog";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";

const DRAFT_KEY = 'mm_repair_draft';

const formSchema = z.object({
  customerName: z.string().min(2, "Nombre obligatorio"),
  customerPhone: z.string().min(10, "Teléfono inválido"),
  customerID: z.string().min(5, "Cédula requerida"),
  customerAddress: z.string().default(""),
  deviceMake: z.string().min(2, "Marca obligatoria"),
  deviceModel: z.string().min(1, "Modelo obligatorio"),
  reportedIssue: z.string().min(5, "Detalla la falla del equipo"),
  status: z.enum(['Pendiente', 'Pagado', 'Completado', 'Garantía']),
  notes: z.string().default(""),
  reservedParts: z.array(z.any()).default([]),
  isPromo: z.boolean().default(false),
  isMinimized: z.boolean().default(false),
});

function cleanObject(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    const cleaned = { ...obj };
    Object.keys(cleaned).forEach(key => {
        if (cleaned[key] === undefined) {
            delete cleaned[key];
        } else if (Array.isArray(cleaned[key])) {
            cleaned[key] = cleaned[key].map((item: any) => 
                (typeof item === 'object' && item !== null) ? cleanObject(item) : item
            );
        } else if (typeof cleaned[key] === 'object' && cleaned[key] !== null) {
            cleaned[key] = cleanObject(cleaned[key]);
        }
    });
    return cleaned;
}

export function RepairFormDialog({ repairJob, children, isOpen, onOpenChange }: { repairJob?: RepairJob | null, children?: ReactNode, isOpen?: boolean, onOpenChange?: (v: boolean) => void }) {
  const { firestore, user } = useFirebase();
  const [internalOpen, setInternalOpen] = useState(false);
  const [partsPopoverOpen, setPartsPopoverOpen] = useState(false);
  const [replenishProduct, setReplenishProduct] = useState<Product | null>(null);
  const [manualQuickAddOpen, setManualQuickAddOpen] = useState(false);
  
  const open = isOpen !== undefined ? isOpen : internalOpen;
  const setOpen = onOpenChange !== undefined ? onOpenChange : setInternalOpen;

  const { toast } = useToast();
  const { getFinalPrice, getDynamicPrice, format: formatCurrency, bcvRate, parallelRate, profitMargin } = useCurrency();
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const isInitialized = useRef(false);
  const isClosingViaMinimize = useRef(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      customerName: "", customerPhone: "", customerID: "", customerAddress: "",
      deviceMake: "", deviceModel: "", reportedIssue: "",
      status: "Pendiente", reservedParts: [],
      isPromo: false, notes: "", isMinimized: false,
    },
  });

  const settingsRef = useMemoFirebase(() => 
    (firestore && user) ? doc(firestore, 'users', user.uid, 'app-settings', 'main') : null,
    [firestore, user?.uid]
  );
  const { data: settings } = useDoc<AppSettings>(settingsRef);

  const profileRef = useMemoFirebase(() => 
    (firestore && user) ? doc(firestore, 'users', user.uid) : null,
    [firestore, user?.uid]
  );
  const { data: profile } = useDoc<UserProfile>(profileRef);

  const productsCol = useMemoFirebase(() => 
    (firestore && user) ? collection(firestore, 'users', user.uid, 'products') : null, 
    [firestore, user?.uid]
  );
  const { data: products } = useCollection<Product>(productsCol);

  const repairsCol = useMemoFirebase(() => 
    (firestore && user) ? query(collection(firestore, 'users', user.uid, 'repair_jobs'), orderBy('createdAt', 'desc')) : null,
    [firestore, user?.uid]
  );
  const { data: allRepairJobs } = useCollection<RepairJob>(repairsCol);

  const reservedParts = form.watch("reservedParts") as (ReservedPart & { isPromo?: boolean, isWarranty?: boolean, isManual?: boolean, isConsumed?: boolean })[];
  const watchedID = form.watch("customerID");
  const watchedName = form.watch("customerName");

  const foundCustomer = useMemo(() => {
    if (!watchedID || watchedID.length < 5 || !allRepairJobs) return null;
    return allRepairJobs.find(job => job.customerID?.toUpperCase().trim() === watchedID.toUpperCase().trim());
  }, [watchedID, allRepairJobs]);

  const handleApplyCustomerData = () => {
    if (foundCustomer) {
        form.setValue("customerName", foundCustomer.customerName.toUpperCase());
        form.setValue("customerPhone", foundCustomer.customerPhone);
        form.setValue("customerAddress", (foundCustomer.customerAddress || "").toUpperCase());
        toast({ title: "Datos cargados" });
    }
  };
  
  const effectiveIsPromo = useMemo(() => {
    return reservedParts.some(p => p.isPromo && !p.isWarranty);
  }, [reservedParts]);

  useEffect(() => {
    if (isInitialized.current) form.setValue("isPromo", effectiveIsPromo);
  }, [effectiveIsPromo, form]);

  useEffect(() => {
    if (!repairJob && open) {
        const subscription = form.watch((value) => {
            if (isInitialized.current && !isClosingViaMinimize.current) {
                localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...value, isMinimized: false }));
            }
        });
        return () => subscription.unsubscribe();
    }
  }, [form, repairJob, open]);

  const partsTotalForClient = useMemo(() => {
    return reservedParts.reduce((sum, part) => {
        if (part.isWarranty) return sum;
        let price = 0;
        if (part.isManual) {
            price = part.isPromo ? (part.manualPriceOffer || 0) : (part.manualPrice || 0);
            if (price === 0) price = getDynamicPrice(part.costPrice);
        } else {
            const product = products?.find(p => p.id === part.productId);
            if (product) {
                price = (part.isPromo && product.promoPrice) ? product.promoPrice : getFinalPrice(product);
            } else price = getDynamicPrice(part.costPrice);
        }
        return sum + (price * part.quantity);
    }, 0);
  }, [reservedParts, products, getFinalPrice, getDynamicPrice]);

  const estimatedTotal = partsTotalForClient;
  const currentPaid = repairJob?.amountPaid || 0;

  useEffect(() => {
    if (!open) { isInitialized.current = false; isClosingViaMinimize.current = false; return; }
    if (open && !isInitialized.current) {
        if (repairJob) {
            const allParts = [
                ...(repairJob.consumedParts || []).map(p => ({ ...p, isConsumed: true })),
                ...(repairJob.reservedParts || []).map(p => ({ ...p, isConsumed: false }))
            ];
            form.reset({ ...repairJob, status: repairJob.status as any, reservedParts: allParts, isMinimized: false });
        } else {
            const savedDraft = localStorage.getItem(DRAFT_KEY);
            if (savedDraft) {
                try { form.reset({ ...JSON.parse(savedDraft), isMinimized: false }); } 
                catch (e) { localStorage.removeItem(DRAFT_KEY); }
            } else {
                form.reset({ customerName: "", customerPhone: "", customerID: "", customerAddress: "", deviceMake: "", deviceModel: "", reportedIssue: "", status: "Pendiente", reservedParts: [], isPromo: false, notes: "", isMinimized: false });
            }
        }
        isInitialized.current = true;
    }
  }, [repairJob, open, form]);

  const handleAddPartFromInventory = (p: Product) => {
      const existing = reservedParts.find(item => item.productId === p.id);
      const qtyInForm = existing ? existing.quantity : 0;
      const originalInJob = repairJob?.reservedParts?.find(rp => rp.productId === p.id)?.quantity || 0;
      const available = (p.stockLevel - (p.reservedStock || 0) - (p.damagedStock || 0)) + originalInJob;
      
      if (available < qtyInForm + 1) {
          setReplenishProduct(p);
          setPartsPopoverOpen(false);
          return;
      }

      if (existing) {
          form.setValue('reservedParts', reservedParts.map(item => item.productId === p.id ? { ...item, quantity: item.quantity + 1 } : item));
      } else {
          form.setValue('reservedParts', [...reservedParts, { productId: p.id!, productName: p.name.toUpperCase(), quantity: 1, costPrice: p.costPrice, isPromo: !!(p.promoPrice && p.promoPrice > 0), isWarranty: false, isManual: false, isConsumed: false }]);
      }
      setPartsPopoverOpen(false);
  };

  const handleAddManualPart = (name: string, cost: number, priceBCV: number, priceOffer: number, isPromo: boolean = true) => {
      const newPart: ReservedPart & { isConsumed: boolean } = {
          productId: `manual-${Date.now()}`,
          productName: name.toUpperCase().trim(),
          quantity: 1,
          costPrice: cost,
          isPromo: isPromo,
          isWarranty: false,
          isManual: true,
          manualPrice: priceBCV,
          manualPriceOffer: priceOffer,
          isConsumed: false
      };
      form.setValue('reservedParts', [...reservedParts, newPart]);
      setManualQuickAddOpen(false);
  };

  const handleRemovePart = (productId: string) => {
      form.setValue('reservedParts', reservedParts.filter(p => p.productId !== productId));
  };

  const handleTogglePartPromo = (productId: string) => {
      form.setValue('reservedParts', reservedParts.map(p => 
          p.productId === productId ? { ...p, isPromo: !p.isPromo } : p
      ));
  };

  const handleMinimize = () => {
      isClosingViaMinimize.current = true;
      isInitialized.current = false;
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...form.getValues(), isMinimized: true }));
      setOpen(false);
  };

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!firestore || !user || isSubmitting) return;
    setIsSubmitting(true);
    try {
        const result = await runTransaction(firestore, async (transaction) => {
            const jobId = repairJob?.id || `R-${format(new Date(), "yyMMdd")}-${Math.floor(1000 + Math.random() * 9000)}`;
            const jobRef = doc(firestore, 'users', user.uid, 'repair_jobs', jobId);

            // Filtrar repuestos del formulario
            const allFormParts = values.reservedParts;
            const newReservedItems = allFormParts.filter(p => !p.isConsumed);
            const newConsumedItems = allFormParts.filter(p => p.isConsumed);

            // Cálculo de deltas de inventario (solo para piezas que NO son manuales)
            const oldInventoryReserved = (repairJob?.reservedParts || []).filter(p => !p.isManual);
            const oldInventoryConsumed = (repairJob?.consumedParts || []).filter(p => !p.isManual);
            const newInventoryReserved = newReservedItems.filter(p => !p.isManual);
            const newInventoryConsumed = newConsumedItems.filter(p => !p.isManual);

            const reservedDeltas = new Map<string, { delta: number, name: string }>();
            for (const old of oldInventoryReserved) {
                const current = reservedDeltas.get(old.productId) || { delta: 0, name: old.productName };
                reservedDeltas.set(old.productId, { delta: current.delta - old.quantity, name: old.productName });
            }
            for (const updated of newInventoryReserved) {
                const current = reservedDeltas.get(updated.productId) || { delta: 0, name: updated.productName };
                reservedDeltas.set(updated.productId, { delta: current.delta + updated.quantity, name: updated.productName });
            }

            const stockReturns = new Map<string, { qty: number, name: string }>();
            for (const old of oldInventoryConsumed) {
                const isStillInForm = newInventoryConsumed.some(n => n.productId === old.productId);
                if (!isStillInForm) {
                    const current = stockReturns.get(old.productId) || { qty: 0, name: old.productName };
                    stockReturns.set(old.productId, { qty: current.qty + old.quantity, name: old.productName });
                }
            }

            // Aplicar cambios en inventario (Firestore)
            for (const [pid, change] of Array.from(reservedDeltas.entries())) {
                if (change.delta === 0) continue;
                const pSnap = await transaction.get(doc(firestore, 'users', user.uid, 'products', pid));
                if (pSnap.exists()) {
                    const data = pSnap.data() as Product;
                    if (change.delta > 0 && ((data.stockLevel - data.reservedStock - (data.damagedStock || 0)) < change.delta)) {
                        throw new Error(`Stock insuficiente para "${change.name}".`);
                    }
                    transaction.update(pSnap.ref, { reservedStock: Math.max(0, (data.reservedStock || 0) + change.delta) });
                }
            }

            for (const [pid, info] of Array.from(stockReturns.entries())) {
                const pSnap = await transaction.get(doc(firestore, 'users', user.uid, 'products', pid));
                if (pSnap.exists()) {
                    const data = pSnap.data() as Product;
                    transaction.update(pSnap.ref, { stockLevel: (data.stockLevel || 0) + info.qty });
                }
            }

            let finalReservedParts = [...newReservedItems];
            let finalConsumedParts = [...newConsumedItems];
            let partsConsumed = !!repairJob?.partsConsumed;
            let completionData: any = {};

            // Si se marca como completado, mover todo lo reservado a consumido (y descontar stock físico)
            if (values.status === 'Completado') {
                for (const part of newInventoryReserved) {
                    const pSnap = await transaction.get(doc(firestore, 'users', user.uid, 'products', part.productId));
                    if (pSnap.exists()) {
                        const pData = pSnap.data() as Product;
                        transaction.update(pSnap.ref, { 
                            stockLevel: (pData.stockLevel || 0) - part.quantity,
                            reservedStock: Math.max(0, (pData.reservedStock || 0) - part.quantity)
                        });
                    }
                }
                const completionDate = new Date();
                completionData = { completedAt: completionDate.toISOString(), warrantyEndDate: addDays(completionDate, 4).toISOString() };
                finalConsumedParts = [...finalConsumedParts, ...newReservedItems];
                finalReservedParts = [];
                partsConsumed = true;
            }

            // Stripping UI flags before saving
            const finalReserved = finalReservedParts.map(({isConsumed, ...p}) => p);
            const finalConsumed = finalConsumedParts.map(({isConsumed, ...p}) => p);

            const finalData = cleanObject({ 
                ...values, id: jobId, 
                estimatedCost: Number(estimatedTotal.toFixed(2)),
                amountPaid: currentPaid,
                isPaid: currentPaid >= (estimatedTotal - 0.01),
                status: (currentPaid >= (estimatedTotal - 0.01) && values.status === 'Pendiente') ? 'Pagado' : values.status,
                createdAt: repairJob?.createdAt || new Date().toISOString(),
                reservedParts: finalReserved, 
                consumedParts: finalConsumed, 
                partsConsumed, isPromo: effectiveIsPromo, ...completionData
            });
            
            transaction.set(jobRef, finalData, { merge: true });
            return finalData;
        });

        localStorage.removeItem(DRAFT_KEY);
        toast({ title: "Orden Sincronizada" });
        if (!repairJob) handlePrintAllTickets({ repairJob: result as RepairJob, businessName: profile?.businessName, profile, bcvRate, parallelRate }, () => {});
        setOpen(false);
    } catch (e: any) {
        toast({ variant: "destructive", title: "Error", description: e.message });
    } finally { setIsSubmitting(false); }
  }

  const inputMode = settings?.repairInputMode || 'both';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent className="sm:max-w-[650px] max-h-[90vh] overflow-hidden flex flex-col p-0">
        <div className="p-4 sm:p-6 pb-2 shrink-0">
            <div className="flex justify-between items-center mb-2 sm:mb-4">
                <DialogHeader className="flex-1">
                    <DialogTitle className="uppercase font-bold text-base sm:text-lg">{repairJob ? 'Gestionar Trabajo' : 'Nueva Recepción Técnica'}</DialogTitle>
                    <DialogDescription className="hidden sm:block">Completa los datos del cliente y el equipo para generar el ticket.</DialogDescription>
                </DialogHeader>
                {!repairJob && (
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={handleMinimize} title="Minimizar registro">
                        <Minus className="h-4 w-4" />
                    </Button>
                )}
            </div>
        </div>
        
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col flex-1 overflow-hidden">
                <div className="flex-1 overflow-y-auto px-4 sm:px-6 space-y-6 pb-6">
                    <div className="space-y-4">
                        <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest flex items-center gap-2 border-b pb-1">
                            <User className="w-3 h-3" /> Información del Cliente
                        </span>
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <FormField control={form.control} name="customerID" render={({field}) => (
                                <FormItem>
                                    <FormLabel className="text-[10px] font-bold uppercase">Cédula / RIF</FormLabel>
                                    <FormControl><Input {...field} onChange={(e) => field.onChange(e.target.value.toUpperCase())} placeholder="V-12345678" className="uppercase h-9" /></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <FormField control={form.control} name="customerPhone" render={({field}) => (
                                <FormItem>
                                    <FormLabel className="text-[10px] font-bold uppercase">Teléfono</FormLabel>
                                    <FormControl><Input {...field} placeholder="0412-0000000" className="h-9" /></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                        </div>

                        {foundCustomer && (watchedName.toUpperCase() !== foundCustomer.customerName.toUpperCase()) && (
                            <Button 
                                type="button" 
                                variant="ghost" 
                                size="sm" 
                                className="h-7 text-[10px] text-blue-600 bg-blue-50 hover:bg-blue-100 flex items-center gap-1 font-bold w-full"
                                onClick={handleApplyCustomerData}
                            >
                                <UserCheck className="w-3.5 h-3.5" />
                                ¿CARGAR DATOS DE {foundCustomer.customerName.toUpperCase()}?
                            </Button>
                        )}

                        <FormField control={form.control} name="customerName" render={({field}) => (
                            <FormItem>
                                <FormLabel className="text-[10px] font-bold uppercase">Nombre Completo</FormLabel>
                                <FormControl><Input {...field} onChange={(e) => field.onChange(e.target.value.toUpperCase())} placeholder="JUAN PÉREZ" className="uppercase h-9" /></FormControl>
                                <FormMessage />
                            </FormItem>
                        )} />

                        <FormField control={form.control} name="customerAddress" render={({field}) => (
                            <FormItem>
                                <FormLabel className="text-[10px] font-bold uppercase flex items-center gap-1.5"><MapPin className="w-3 h-3"/> Dirección</FormLabel>
                                <FormControl><Input {...field} onChange={(e) => field.onChange(e.target.value.toUpperCase())} placeholder="EJ: CALLE 5, CASA 10..." className="uppercase h-9" /></FormControl>
                            </FormItem>
                        )} />
                    </div>

                    <div className="space-y-4">
                        <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest flex items-center gap-2 border-b pb-1">
                            <Smartphone className="w-3 h-3" /> Detalles del Equipo
                        </span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <FormField control={form.control} name="deviceMake" render={({field}) => <FormItem><FormLabel className="text-[10px] font-bold uppercase">Marca</FormLabel><FormControl><Input {...field} className="uppercase placeholder:normal-case h-9" placeholder="EJ: SAMSUNG, HP, DELL..." /></FormControl></FormItem>} />
                            <FormField control={form.control} name="deviceModel" render={({field}) => <FormItem><FormLabel className="text-[10px] font-bold uppercase">Modelo</FormLabel><FormControl><Input {...field} className="uppercase h-9" placeholder="EJ: MODELO, SERIE, VERSIÓN..." /></FormControl></FormItem>} />
                        </div>
                        <FormField control={form.control} name="reportedIssue" render={({field}) => <FormItem><FormLabel className="text-[10px] font-bold uppercase">Falla / Problema</FormLabel><FormControl><Input {...field} className="uppercase h-9" placeholder="EJ: FALLA TÉCNICA O REQUERIMIENTO..." /></FormControl></FormItem>} />
                    </div>

                    <div className="space-y-4">
                        <div className="flex items-center justify-between border-b pb-1">
                            <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest flex items-center gap-2">
                                <Package className="w-3 h-3" /> Materiales y Repuestos
                            </span>
                            <div className="flex gap-1.5">
                                {(inputMode === 'manual' || inputMode === 'both') && (
                                    <Button type="button" variant="outline" size="sm" className="h-7 text-[9px] font-black px-2" onClick={() => setManualQuickAddOpen(true)}>
                                        MANUAL (+)
                                    </Button>
                                )}
                                {(inputMode === 'inventory' || inputMode === 'both') && (
                                    <Popover open={partsPopoverOpen} onOpenChange={setPartsPopoverOpen}>
                                        <PopoverTrigger asChild>
                                            <Button type="button" variant="outline" size="sm" className="h-7 text-[9px] font-black px-2">
                                                <Search className="w-3 h-3 mr-1" /> INVENTARIO
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="p-0 w-[280px] sm:w-[350px]" align="end">
                                            <Command><CommandInput placeholder="BUSCAR REPUESTO..." className="h-9"/><CommandList><CommandEmpty>Sin resultados.</CommandEmpty><CommandGroup>
                                                {(products || []).filter(p => !p.isCombo).map(p => (
                                                    <CommandItem key={p.id} onSelect={() => handleAddPartFromInventory(p)} className="flex justify-between items-center text-xs">
                                                        <span className="font-bold uppercase truncate max-w-[150px]">{p.name}</span>
                                                        <Badge variant="secondary" className="text-[8px] h-4">{p.stockLevel - (p.reservedStock || 0)} DISP.</Badge>
                                                    </CommandItem>
                                                ))}</CommandGroup></CommandList></Command>
                                        </PopoverContent>
                                    </Popover>
                                )}
                            </div>
                        </div>

                        <div className="space-y-2">
                            {reservedParts.length === 0 && (
                                <p className="text-center text-[10px] text-muted-foreground italic py-4 bg-muted/20 rounded-md border border-dashed">
                                    No se han añadido repuestos o servicios aún.
                                </p>
                            )}
                            {reservedParts.map((part) => {
                                const pData = products?.find(p => p.id === part.productId);
                                let price = 0;
                                if (part.isManual) {
                                    price = part.isPromo ? (part.manualPriceOffer || 0) : (part.manualPrice || 0);
                                } else {
                                    price = (part.isPromo && pData?.promoPrice) ? pData.promoPrice : getFinalPrice(pData || { costPrice: part.costPrice } as Product);
                                }
                                if (part.isWarranty) price = 0;

                                return (
                                    <div key={part.productId} className={cn(
                                        "flex justify-between items-center p-2 rounded-md border transition-colors",
                                        part.isConsumed ? "bg-green-50 border-green-100" : "bg-slate-50 border-slate-200"
                                    )}>
                                        <div className="flex flex-col">
                                            <span className="font-bold text-[11px] sm:text-xs uppercase truncate max-w-[180px] sm:max-w-xs">{part.productName}</span>
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-[10px] text-muted-foreground">1x ${price.toFixed(2)}</span>
                                                {part.isConsumed && (
                                                    <Badge className="bg-green-600 text-white text-[8px] h-4 px-1 font-black uppercase flex items-center gap-1">
                                                        <CheckCircle2 className="w-2.5 h-2.5" /> COBRADO / CONSUMIDO
                                                    </Badge>
                                                )}
                                                {part.isManual && !part.isConsumed && <Badge variant="outline" className="text-[8px] h-3 px-1 border-amber-200 text-amber-600 font-bold">MANUAL</Badge>}
                                                {part.isPromo && !part.isWarranty && <Badge className="text-[8px] h-3 px-1 bg-blue-600 font-bold">OFERTA</Badge>}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <TooltipProvider>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <Button 
                                                            type="button"
                                                            variant="ghost" 
                                                            size="icon" 
                                                            className={cn("h-7 w-7", part.isPromo ? "text-blue-600 bg-blue-100" : "text-muted-foreground")}
                                                            onClick={() => handleTogglePartPromo(part.productId)}
                                                            disabled={part.isConsumed}
                                                        >
                                                            <TicketPercent className="h-3.5 w-3.5" />
                                                        </Button>
                                                    </TooltipTrigger>
                                                    <TooltipContent><p>Alternar Tasa de Reposición (Oferta)</p></TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>
                                            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleRemovePart(part.productId)} disabled={part.isConsumed}>
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </Button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className="p-4 rounded-xl bg-slate-900 text-white space-y-2 shadow-lg border-t-4 border-primary">
                        <div className="flex justify-between text-[10px] text-slate-400 font-bold uppercase tracking-tighter">
                            <span>Monto Total de la Orden:</span>
                            <span>Eq: Bs {formatCurrency(estimatedTotal * (effectiveIsPromo ? parallelRate : bcvRate))}</span>
                        </div>
                        <div className="flex justify-between items-end">
                            <div className="flex flex-col">
                                <span className="text-[10px] font-bold text-primary uppercase flex items-center gap-1"><DollarSign className="w-3 h-3" /> Total Estimado</span>
                                {currentPaid > 0 && <span className="text-[9px] text-green-400 font-bold">ABONADO PREVIO: -${currentPaid.toFixed(2)}</span>}
                            </div>
                            <div className="text-right">
                                <span className="text-2xl sm:text-3xl font-black text-white leading-none">${(estimatedTotal - currentPaid).toFixed(2)}</span>
                                <p className="text-[10px] text-slate-500 font-bold">SALDO PENDIENTE</p>
                            </div>
                        </div>
                    </div>
                </div>

                <DialogFooter className="p-4 sm:p-6 border-t bg-white shrink-0">
                    <Button type="submit" disabled={isSubmitting} className="w-full h-11 sm:h-12 text-sm sm:text-base font-bold shadow-lg uppercase tracking-tight">
                        {isSubmitting ? <Loader2 className="animate-spin h-5 w-5" /> : (repairJob ? "GUARDAR CAMBIOS" : "REGISTRAR Y GENERAR TICKET")}
                    </Button>
                </DialogFooter>
            </form>
        </Form>

        <ManualQuickAddDialog isOpen={manualQuickAddOpen} onOpenChange={setManualQuickAddOpen} onAdd={handleAddManualPart} />
        {replenishProduct && <ProductFormDialog product={replenishProduct} isOpen={!!replenishProduct} onOpenChange={(v) => !v && setReplenishProduct(null)} onSaved={handleAddPartFromInventory} />}
      </DialogContent>
    </Dialog>
  );
}

function ManualQuickAddDialog({ isOpen, onOpenChange, onAdd }: { isOpen: boolean, onOpenChange: (v: boolean) => void, onAdd: (name: string, cost: number, bcv: number, offer: number, isPromo?: boolean) => void }) {
    const [name, setName] = useState("");
    const [cost, setCost] = useState("");
    const [priceBCV, setPriceBCV] = useState("");
    const [priceOffer, setPriceOffer] = useState("");
    const [isPromo, setIsPromo] = useState(true);
    const { getDynamicPrice, profitMargin, bcvRate, parallelRate, format: formatCurrency } = useCurrency();

    useEffect(() => {
        const c = parseFloat(cost) || 0;
        if (c > 0) {
            const bcv = getDynamicPrice(c);
            const offer = c * (1 + profitMargin / 100);
            setPriceBCV(bcv.toFixed(2));
            setPriceOffer(offer.toFixed(2));
        } else {
            setPriceBCV("");
            setPriceOffer("");
        }
    }, [cost, getDynamicPrice, profitMargin]);

    const handleConfirm = () => {
        onAdd(
            name, 
            parseFloat(cost) || 0, 
            parseFloat(priceBCV) || 0, 
            parseFloat(priceOffer) || 0, 
            isPromo
        );
        
        setName(""); setCost(""); setPriceBCV(""); setPriceOffer(""); setIsPromo(true);
        onOpenChange(false);
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md p-4 sm:p-6">
                <DialogHeader><DialogTitle className="uppercase font-bold text-base sm:text-lg">Repuesto Manual</DialogTitle></DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="space-y-1.5">
                        <Label className="text-[10px] font-bold uppercase text-muted-foreground">Descripción del Servicio/Pieza</Label>
                        <Input value={name} onChange={(e) => setName(e.target.value.toUpperCase())} placeholder="EJ: DESCRIPCIÓN DEL ARTÍCULO..." className="uppercase h-10" />
                    </div>
                    
                    <div className="space-y-1.5">
                        <Label className="text-[10px] font-bold uppercase text-muted-foreground">Costo Inversión ($)</Label>
                        <Input type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0.00" className="h-10" />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className={cn(
                            "p-3 rounded-xl border-2 transition-all space-y-2",
                            !isPromo ? "bg-blue-50 border-blue-300 shadow-sm" : "bg-white border-slate-100 opacity-60"
                        )}>
                            <Label className="text-[10px] font-black uppercase text-blue-700">Sugerido BCV</Label>
                            <div className="relative">
                                <DollarSign className="absolute left-2 top-2 h-3.5 w-3.5 text-blue-600" />
                                <Input 
                                    type="number" 
                                    value={priceBCV} 
                                    onChange={(e) => setPriceBCV(e.target.value)} 
                                    className="pl-7 h-9 border-blue-200 font-black text-base"
                                    placeholder="0.00"
                                />
                            </div>
                            <p className="text-[8px] font-bold text-blue-600 leading-none">Eq: Bs {formatCurrency((parseFloat(priceBCV) || 0) * bcvRate)}</p>
                        </div>

                        <div className={cn(
                            "p-3 rounded-xl border-2 transition-all space-y-2",
                            isPromo ? "bg-green-50 border-green-300 shadow-sm" : "bg-white border-slate-100 opacity-60"
                        )}>
                            <Label className="text-[10px] font-black uppercase text-green-700">Sugerido Oferta</Label>
                            <div className="relative">
                                <DollarSign className="absolute left-2 top-2 h-3.5 w-3.5 text-green-600" />
                                <Input 
                                    type="number" 
                                    value={priceOffer} 
                                    onChange={(e) => setPriceOffer(e.target.value)} 
                                    className="pl-7 h-9 border-green-200 font-black text-base"
                                    placeholder="0.00"
                                />
                            </div>
                            <p className="text-[8px] font-bold text-green-600 leading-none">Eq: Bs {formatCurrency((parseFloat(priceOffer) || 0) * (parallelRate || 1))}</p>
                        </div>
                    </div>

                    <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                        <div className="flex items-center gap-2">
                            <TicketPercent className={cn("w-4 h-4", isPromo ? "text-blue-600" : "text-slate-400")} />
                            <Label className="text-xs font-black uppercase cursor-pointer" htmlFor="promo-mode">Usar Tasa de Reposición</Label>
                        </div>
                        <Switch id="promo-mode" checked={isPromo} onCheckedChange={setIsPromo} />
                    </div>
                </div>
                <DialogFooter><Button onClick={handleConfirm} disabled={!name || !cost} className="w-full h-11 uppercase font-bold text-sm shadow-md">Confirmar Añadido</Button></DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
