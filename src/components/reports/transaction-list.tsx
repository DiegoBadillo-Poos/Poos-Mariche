"use client"

import type { Sale, Payment, Product, CartItem, RepairJob, UserProfile, PaymentMethod } from "@/lib/types";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { format, parseISO, isWithinInterval, startOfDay, endOfDay } from "date-fns";
import { es } from "date-fns/locale";
import { useCurrency } from "@/hooks/use-currency";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { ReceiptView, handlePrintReceipt } from "../pos/receipt-view";
import { Button } from "../ui/button";
import { Printer, Undo2, AlertTriangle, Calendar as CalendarIcon, Search, X as ClearIcon, Filter, CreditCard, Banknote, Landmark, Smartphone, DollarSign, ArrowDownLeft, ArrowUpRight, Sigma, Loader2, ChevronLeft, ChevronRight, User, Coins } from "lucide-react";
import React, { useState, useMemo, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "../ui/skeleton";
import { AdminAuthDialog } from "../admin-auth-dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../ui/alert-dialog";
import { useFirebase, useDoc, useMemoFirebase } from "@/firebase";
import { doc, runTransaction, getDoc, type DocumentSnapshot } from "firebase/firestore";
import { Badge } from "../ui/badge";
import { Textarea } from "../ui/textarea";
import { Label } from "../ui/label";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Calendar } from "../ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { cn } from "@/lib/utils";
import type { DateRange } from "react-day-picker";
import { Separator } from "../ui/separator";

type TransactionListProps = {
    sales: Sale[];
    isLoading?: boolean;
};

const PAYMENT_METHODS: (PaymentMethod | 'ALL')[] = [
    'ALL',
    'Efectivo USD',
    'Efectivo Bs',
    'Tarjeta',
    'Pago Móvil',
    'Transferencia',
    'USDT / Crypto'
];

const REFUND_METHODS: PaymentMethod[] = [
    'Efectivo USD',
    'Efectivo Bs',
    'Tarjeta / Pago Móvil',
    'Transferencia'
];

const methodIcons: Record<string, any> = {
    'Efectivo USD': DollarSign,
    'Efectivo Bs': Landmark,
    'Tarjeta': CreditCard,
    'Pago Móvil': Smartphone,
    'Transferencia': Banknote,
    'Tarjeta / Pago Móvil': Smartphone,
    'USDT / Crypto': Coins,
};

const ITEMS_PER_PAGE = 5;

const RefundButton = ({ sale }: { sale: Sale }) => {
    const { firestore, user } = useFirebase();
    const { toast } = useToast();
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);
    const [refundReason, setRefundReason] = useState("");
    const [stockAction, setStockAction] = useState<'return' | 'damage'>('return');
    const [refundMethod, setRefundMethod] = useState<PaymentMethod | "">("");
    const [isProcessing, setIsProcessing] = useState(false);
    
    const handleRefund = async () => {
        if (!firestore || !user || !sale.id || !refundReason.trim() || !refundMethod || isProcessing) return;
        
        setIsProcessing(true);
        try {
            await runTransaction(firestore, async (transaction) => {
                const repairJobSnap = sale.repairJobId ? await transaction.get(doc(firestore, 'users', user.uid, 'repair_jobs', sale.repairJobId)) : null;
                const repairJobData = repairJobSnap?.exists() ? repairJobSnap.data() as RepairJob : null;

                const productIdsToReturn = new Map<string, { quantity: number, isFromRepair: boolean }>();

                sale.items.forEach(item => {
                    if (item.isCustom) return;
                    if (item.isRepair) return;
                    
                    const existing = productIdsToReturn.get(item.productId) || { quantity: 0, isFromRepair: false };
                    productIdsToReturn.set(item.productId, { 
                        quantity: existing.quantity + item.quantity, 
                        isFromRepair: false 
                    });
                });

                if (repairJobData?.reservedParts) {
                    repairJobData.reservedParts.forEach(part => {
                        const existing = productIdsToReturn.get(part.productId) || { quantity: 0, isFromRepair: true };
                        productIdsToReturn.set(part.productId, { 
                            quantity: existing.quantity + part.quantity, 
                            isFromRepair: true 
                        });
                    });
                }

                const productSnapshots = new Map<string, DocumentSnapshot>();
                for(const pid of Array.from(productIdsToReturn.keys())) {
                    const snap = await transaction.get(doc(firestore, 'users', user.uid, 'products', pid));
                    productSnapshots.set(pid, snap);
                }

                if (repairJobSnap?.exists() && repairJobData) {
                    transaction.update(repairJobSnap.ref, { 
                        status: 'Pendiente', 
                        isPaid: false, 
                        amountPaid: 0,
                        partsConsumed: false
                    });
                }

                for (const [pid, info] of Array.from(productIdsToReturn.entries())) {
                    const pSnap = productSnapshots.get(pid);
                    if (pSnap?.exists()) {
                        const data = pSnap.data() as Product;
                        const newStock = (data.stockLevel || 0) + info.quantity;
                        const newDamaged = stockAction === 'damage' 
                            ? (data.damagedStock || 0) + info.quantity 
                            : (data.damagedStock || 0);
                        
                        let newReserved = data.reservedStock || 0;
                        if (info.isFromRepair && stockAction === 'return') {
                            newReserved += info.quantity;
                        }

                        transaction.update(pSnap.ref, { 
                            stockLevel: newStock, 
                            damagedStock: newDamaged,
                            reservedStock: newReserved
                        });
                    }
                }

                const saleRef = doc(firestore, 'users', user.uid, 'sale_transactions', sale.id!);
                transaction.update(saleRef, { 
                    status: 'refunded', 
                    refundedAt: new Date().toISOString(), 
                    refundReason,
                    refundPaymentMethod: refundMethod 
                });
            });

            toast({ title: "Reembolso Procesado", description: "El inventario y la caja han sido ajustados." });
        } catch (error: any) {
            console.error("Refund Error:", error);
            toast({ variant: "destructive", title: "Error en el Reembolso", description: error.message || "Error de sincronización." });
        } finally {
            setIsProcessing(false);
            setIsConfirmOpen(false);
        }
    };
    
    if (sale.status === 'refunded') return <Badge variant="secondary">Reembolsado</Badge>;
    
    return (
        <div className="flex items-center gap-2">
            {sale.reconciliationId && <Badge variant="outline" className="border-green-600 text-green-600">Cerrada</Badge>}
            <AdminAuthDialog onAuthorized={() => setIsConfirmOpen(true)}>
                <Button variant="outline" size="sm" className="h-8"><Undo2 className="mr-2 h-4 w-4" /> Reembolsar</Button>
            </AdminAuthDialog>
            <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
                <AlertDialogContent className="sm:max-w-md">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="uppercase font-bold">Procesar Reembolso</AlertDialogTitle>
                    </AlertDialogHeader>
                    <div className="py-4 space-y-6">
                        <div className="space-y-2">
                            <Label className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest">1. ¿Cómo devuelves el dinero?</Label>
                            <Select value={refundMethod} onValueChange={(v: any) => setRefundMethod(v)}>
                                <SelectTrigger className="h-11">
                                    <SelectValue placeholder="Seleccionar método..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {REFUND_METHODS.map(m => (
                                        <SelectItem key={m} value={m} className="uppercase text-xs font-bold">{m}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-[9px] text-muted-foreground italic">El monto se restará de este método en tus reportes de caja.</p>
                        </div>

                        <div className="space-y-2">
                            <Label className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest">2. Motivo de la devolución</Label>
                            <Textarea 
                                placeholder="ESCRIBE EL MOTIVO..." 
                                value={refundReason} 
                                onChange={(e) => setRefundReason(e.target.value.toUpperCase())}
                                className="uppercase text-xs"
                            />
                        </div>

                        <div className="space-y-3">
                            <Label className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest">3. Acción sobre el inventario</Label>
                            <RadioGroup value={stockAction} onValueChange={(v: any) => setStockAction(v)} className="grid grid-cols-1 gap-2">
                                <div className={cn(
                                    "flex items-center space-x-2 p-3 rounded-lg border transition-all",
                                    stockAction === 'return' ? "bg-green-50 border-green-200" : "bg-white border-slate-200"
                                )}>
                                    <RadioGroupItem value="return" id="r1" />
                                    <Label htmlFor="r1" className="font-bold text-xs cursor-pointer">DEVOLVER A STOCK (DISPONIBLE)</Label>
                                </div>
                                <div className={cn(
                                    "flex items-center space-x-2 p-3 rounded-lg border transition-all",
                                    stockAction === 'damage' ? "bg-destructive/5 border-destructive/20" : "bg-white border-slate-200"
                                )}>
                                    <RadioGroupItem value="damage" id="r2" />
                                    <Label htmlFor="r2" className="font-bold text-xs cursor-pointer">MOVER A DAÑADO / GARANTÍA</Label>
                                </div>
                            </RadioGroup>
                        </div>
                    </div>
                    <AlertDialogFooter className="gap-2">
                        <AlertDialogCancel disabled={isProcessing}>Cancelar</AlertDialogCancel>
                        <AlertDialogAction 
                            onClick={handleRefund} 
                            disabled={!refundReason.trim() || !refundMethod || isProcessing} 
                            className="bg-destructive hover:bg-destructive/90 h-11 font-bold"
                        >
                            {isProcessing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Undo2 className="w-4 h-4 mr-2" />}
                            CONFIRMAR REEMBOLSO
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export function TransactionList({ sales, isLoading }: TransactionListProps) {
    const { firestore, user } = useFirebase();
    const { format: formatCurrency, getSymbol, convert, bcvRate: currentBcvRate } = useCurrency();
    const { toast } = useToast();

    const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
    const [methodFilter, setMethodFilter] = useState<PaymentMethod | 'ALL'>('ALL');
    const [searchRef, setSearchRef] = useState("");
    const [currentPage, setCurrentPage] = useState(1);

    const profileRef = useMemoFirebase(() => 
        (firestore && user) ? doc(firestore, 'users', user.uid) : null,
        [firestore, user?.uid]
    );
    const { data: profile } = useDoc<UserProfile>(profileRef);

    const onReprint = async (sale: Sale) => {
        let repairData = null;
        if (sale.repairJobId && firestore && user) {
            const repairRef = doc(firestore, 'users', user.uid, 'repair_jobs', sale.repairJobId);
            const snap = await getDoc(repairRef);
            if (snap.exists()) {
                repairData = { ...snap.data(), id: snap.id } as RepairJob;
            }
        }

        handlePrintReceipt({
            sale,
            currency: { format: formatCurrency, getSymbol, convert },
            businessName: profile?.businessName,
            profile: profile,
            repairData: repairData
        }, (error) => {
            toast({ variant: "destructive", title: "Error de Impresión", description: error });
        });
    };

    const filteredSales = useMemo(() => {
        if (!sales) return [];
        
        return sales.filter(sale => {
            if (dateRange?.from) {
                const saleDate = parseISO(sale.transactionDate);
                const start = startOfDay(dateRange.from);
                const end = dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from);
                if (!isWithinInterval(saleDate, { start, end })) return false;
            }

            if (methodFilter !== 'ALL') {
                const hasMethod = sale.payments.some(p => p.method === methodFilter);
                const hasChangeInMethod = sale.changeGiven?.some(c => c.method === methodFilter);
                const hasRefundInMethod = sale.status === 'refunded' && sale.refundPaymentMethod === methodFilter;
                if (!hasMethod && !hasChangeInMethod && !hasRefundInMethod) return false;
            }

            if (searchRef.trim()) {
                const term = searchRef.toLowerCase();
                const matchesRef = sale.payments.some(p => p.reference?.toLowerCase().includes(term));
                const matchesId = sale.id?.toLowerCase().includes(term);
                const matchesCustomer = sale.customerName?.toLowerCase().includes(term) || sale.customerID?.toLowerCase().includes(term);
                if (!matchesRef && !matchesId && !matchesCustomer) return false;
            }

            return true;
        }).sort((a, b) => {
            const dateA = a.transactionDate ? new Date(a.transactionDate).getTime() : 0;
            const dateB = b.transactionDate ? new Date(b.transactionDate).getTime() : 0;
            return dateB - dateA;
        });
    }, [sales, dateRange, methodFilter, searchRef]);

    useEffect(() => {
        setCurrentPage(1);
    }, [dateRange, methodFilter, searchRef]);

    const totalPages = Math.ceil(filteredSales.length / ITEMS_PER_PAGE);
    const paginatedSales = useMemo(() => {
        const start = (currentPage - 1) * ITEMS_PER_PAGE;
        return filteredSales.slice(start, start + ITEMS_PER_PAGE);
    }, [filteredSales, currentPage]);

    const methodTotals = useMemo(() => {
        if (methodFilter === 'ALL' || !filteredSales) return null;

        let total = 0;
        filteredSales.forEach(sale => {
            if (sale.status === 'refunded') {
                if (sale.refundPaymentMethod === methodFilter) {
                    const refundAmountUSD = sale.actualPaidAmount ?? sale.totalAmount;
                    total -= (methodFilter === 'Efectivo USD' || methodFilter === 'USDT / Crypto') ? refundAmountUSD : refundAmountUSD * (sale.bcvRateAtTime || currentBcvRate);
                }
                return;
            }
            
            sale.payments.forEach(p => {
                if (p.method === methodFilter) {
                    total += p.amount;
                }
            });
            if (sale.changeGiven) {
                sale.changeGiven.forEach(c => {
                    if (c.method === methodFilter) {
                        total -= c.amount;
                    }
                });
            }
        });

        const isBS = methodFilter !== 'Efectivo USD' && methodFilter !== 'USDT / Crypto';
        const amountUSD = isBS ? convert(total, 'Bs', 'USD') : total;
        const amountBS = isBS ? total : convert(total, 'USD', 'Bs');

        return { total, amountUSD, amountBS, isBS };
    }, [filteredSales, methodFilter, convert, currentBcvRate]);

    const resetFilters = () => {
        setDateRange(undefined);
        setMethodFilter('ALL');
        setSearchRef("");
    };

    if (isLoading) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 bg-muted/20 rounded-lg border">
                <div className="space-y-1.5">
                    <Label className="text-xs uppercase font-bold text-muted-foreground">Filtrar Fecha</Label>
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !dateRange && "text-muted-foreground")}>
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {dateRange?.from ? (
                                    dateRange.to ? (
                                        `${format(dateRange.from, "dd/MM/yy")} - ${format(dateRange.to, "dd/MM/yy")}`
                                    ) : format(dateRange.from, "dd/MM/yy")
                                ) : "Seleccionar fecha"}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                            <Calendar mode="range" selected={dateRange} onSelect={setDateRange} locale={es} />
                        </PopoverContent>
                    </Popover>
                </div>

                <div className="space-y-1.5">
                    <Label className="text-xs uppercase font-bold text-muted-foreground">Método de Pago</Label>
                    <Select value={methodFilter} onValueChange={(v: any) => setMethodFilter(v)}>
                        <SelectTrigger>
                            <SelectValue placeholder="Todos los métodos" />
                        </SelectTrigger>
                        <SelectContent>
                            {PAYMENT_METHODS.map(m => (
                                <SelectItem key={m} value={m}>{m === 'ALL' ? 'Todos los métodos' : m}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="space-y-1.5">
                    <Label className="text-xs uppercase font-bold text-muted-foreground">Buscar Cliente / Ref / ID</Label>
                    <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input 
                            placeholder="EJ: CLIENTE, 1234, S-2401..." 
                            className="pl-8 uppercase" 
                            value={searchRef}
                            onChange={(e) => setSearchRef(e.target.value.toUpperCase())}
                        />
                    </div>
                </div>

                <div className="flex items-end">
                    <Button variant="ghost" onClick={resetFilters} className="w-full text-muted-foreground hover:text-primary">
                        <ClearIcon className="mr-2 h-4 w-4" /> Limpiar Filtros
                    </Button>
                </div>
            </div>

            {methodTotals && (
                <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg flex flex-col sm:flex-row items-center justify-between gap-4 animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-primary/10 rounded-full text-primary">
                            {React.createElement(methodIcons[methodFilter as string] || Sigma, { className: "w-6 h-6" })}
                        </div>
                        <div>
                            <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Total Neto Acumulado ({methodFilter})</p>
                            <p className="text-2xl font-black text-primary leading-none">
                                {methodTotals.isBS ? 'Bs ' : '$ '}{formatCurrency(methodTotals.total)}
                            </p>
                            <p className="text-[9px] text-muted-foreground italic mt-1">(Ventas - Vueltos - Reembolsos en este método)</p>
                        </div>
                    </div>
                    <div className="text-center sm:text-right border-t sm:border-t-0 sm:border-l pt-4 sm:pt-0 sm:pl-8 border-primary/10 w-full sm:w-auto">
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-tight">Equivalente Aproximado</p>
                        <p className="text-lg font-bold text-slate-600 leading-tight">
                            {methodTotals.isBS ? `$ ${formatCurrency(methodTotals.amountUSD)}` : `Bs ${formatCurrency(methodTotals.amountBS)}`}
                        </p>
                        <p className="text-[9px] text-muted-foreground uppercase font-medium">Según Tasa BCV Actual</p>
                    </div>
                </div>
            )}

            <div className="space-y-4">
                {paginatedSales.length === 0 ? (
                    <div className="text-center py-12 border-2 border-dashed rounded-xl space-y-2">
                        <Filter className="w-12 h-12 text-muted-foreground/30 mx-auto" />
                        <p className="text-muted-foreground font-medium">No se encontraron transacciones.</p>
                        <Button variant="link" onClick={resetFilters}>Ver todo el registro</Button>
                    </div>
                ) : (
                    <Accordion type="single" collapsible className="w-full">
                        {paginatedSales.map((sale) => (
                            <AccordionItem value={sale.id!} key={sale.id}>
                                <AccordionTrigger className="hover:no-underline">
                                    <div className="flex justify-between w-full pr-4">
                                        <div className="text-left flex flex-col items-start gap-1">
                                            <div className="flex items-center gap-2">
                                                <p className="font-semibold">{sale.transactionDate ? format(parseISO(sale.transactionDate), "dd/MM/yy hh:mm a", { locale: es }) : 'Sin fecha'}</p>
                                                <p className="text-[10px] text-muted-foreground font-mono uppercase bg-muted/50 px-1.5 py-0.5 rounded">{sale.id}</p>
                                            </div>
                                            {(sale.customerName || sale.customerID) && (
                                                <div className="flex items-center gap-1.5 text-[10px] font-black text-primary uppercase">
                                                    <User className="w-3 h-3" />
                                                    <span>{sale.customerName || 'S/N'} {sale.customerID ? `(${sale.customerID})` : ''}</span>
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-4">
                                            {sale.reconciliationId && <Badge variant="outline" className="border-green-600 text-green-600 text-[10px] font-black">CERRADA</Badge>}
                                            {sale.status === 'refunded' && <Badge variant="destructive" className="animate-pulse text-[10px] font-black">REEMBOLSADO</Badge>}
                                            <div className="text-right">
                                                <p className={cn("font-black text-lg leading-none", sale.status === 'refunded' && "text-muted-foreground line-through")}>
                                                    {getSymbol()}{formatCurrency(sale.actualPaidAmount ?? sale.totalAmount)}
                                                </p>
                                                <p className="text-[10px] text-slate-500 mt-1">
                                                    ~ Bs {formatCurrency((sale.actualPaidAmount ?? sale.totalAmount) * (sale.bcvRateAtTime || currentBcvRate))}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent>
                                    <div className="p-4 bg-muted/30 rounded-lg space-y-6">
                                        <div className="flex justify-end gap-2">
                                            <Button variant="outline" size="sm" className="h-8" onClick={() => onReprint(sale)}>
                                                <Printer className="mr-2 h-4 w-4" /> Reimprimir Ticket
                                            </Button>
                                            <RefundButton sale={sale} />
                                        </div>

                                        {(sale.customerName || sale.customerID) && (
                                            <div className="bg-white p-3 rounded-lg border shadow-sm space-y-1">
                                                <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest flex items-center gap-1.5">
                                                    <User className="w-3 h-3" /> Datos del Cliente
                                                </p>
                                                <div className="flex justify-between items-center">
                                                    <span className="font-black text-xs uppercase">{sale.customerName || 'N/A'}</span>
                                                    <span className="font-mono text-xs text-muted-foreground">{sale.customerID || 'N/A'}</span>
                                                </div>
                                            </div>
                                        )}
                                        
                                        <div className="space-y-2">
                                            <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest">Productos y Servicios</p>
                                            <div className="bg-white rounded-md border overflow-hidden">
                                                <Table>
                                                    <TableHeader className="bg-slate-50">
                                                        <TableRow>
                                                            <TableHead className="text-xs">Detalle</TableHead>
                                                            <TableHead className="text-center text-xs">Cant.</TableHead>
                                                            <TableHead className="text-right text-xs">Precio</TableHead>
                                                            <TableHead className="text-right text-xs">Total</TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {sale.items.map((item, idx) => (
                                                            <TableRow key={idx}>
                                                                <TableCell className="font-medium text-xs uppercase">
                                                                    {item.name}
                                                                    {item.isPromo && <Badge variant="outline" className="ml-2 text-[9px] h-4 border-blue-200 text-blue-600 font-bold">OFERTA</Badge>}
                                                                    {item.isGift && <Badge variant="outline" className="ml-2 text-[9px] h-4 border-green-200 text-green-600 font-bold">OBSEQUIO</Badge>}
                                                                    {item.isWarranty && <Badge variant="outline" className="ml-2 text-[9px] h-4 border-orange-200 text-orange-600 font-bold">GARANTÍA</Badge>}
                                                                </TableCell>
                                                                <TableCell className="text-center text-xs">{item.quantity}</TableCell>
                                                                <TableCell className="text-right text-xs">${formatCurrency(item.price)}</TableCell>
                                                                <TableCell className="text-right font-bold text-xs">${formatCurrency(item.price * item.quantity)}</TableCell>
                                                            </TableRow>
                                                        ))}
                                                    </TableBody>
                                                </Table>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                                            <div className="space-y-2">
                                                <p className="text-[10px] font-bold uppercase text-green-700 tracking-widest flex items-center gap-1.5">
                                                    <ArrowUpRight className="w-3 h-3" /> Pagos Recibidos
                                                </p>
                                                <div className="space-y-1.5">
                                                    {sale.payments.map((p, idx) => {
                                                        const Icon = methodIcons[p.method] || DollarSign;
                                                        const isBS = p.method !== 'Efectivo USD' && p.method !== 'USDT / Crypto';
                                                        return (
                                                            <div key={idx} className="flex justify-between items-center p-2 bg-white rounded-md border text-xs shadow-sm">
                                                                <div className="flex items-center gap-2">
                                                                    <div className="p-1 bg-green-50 rounded text-green-600"><Icon className="w-3.5 h-3.5" /></div>
                                                                    <div className="flex flex-col">
                                                                        <span className="font-bold uppercase">{p.method}</span>
                                                                        {p.reference && <span className="text-[10px] text-slate-950 font-black font-mono">Ref: {p.reference}</span>}
                                                                    </div>
                                                                </div>
                                                                <span className="font-black text-green-700">
                                                                    {isBS ? 'Bs' : '$'} {formatCurrency(p.amount)}
                                                                </span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>

                                            <div className="space-y-2">
                                                <p className="text-[10px] font-bold uppercase text-amber-700 tracking-widest flex items-center gap-1.5">
                                                    <ArrowDownLeft className="w-3 h-3" /> Vuelto Entregado
                                                </p>
                                                {sale.changeGiven && sale.changeGiven.length > 0 ? (
                                                    <div className="space-y-1.5">
                                                        {sale.changeGiven.map((c, idx) => {
                                                            const Icon = methodIcons[c.method] || DollarSign;
                                                            const isBS = c.method !== 'Efectivo USD' && c.method !== 'USDT / Crypto';
                                                            return (
                                                                <div key={idx} className="flex justify-between items-center p-2 bg-white rounded-md border text-xs shadow-sm border-amber-100">
                                                                    <div className="flex items-center gap-2">
                                                                        <div className="p-1 bg-amber-50 rounded text-amber-600"><Icon className="w-3.5 h-3.5" /></div>
                                                                        <span className="font-bold uppercase">{c.method}</span>
                                                                    </div>
                                                                    <span className="font-black text-amber-700">
                                                                        {isBS ? 'Bs' : '$'} {formatCurrency(c.amount)}
                                                                    </span>
                                                                </div>
                                                            );
                                                        })}
                                                        <div className="flex justify-between text-[10px] font-bold text-amber-800 px-1 pt-1">
                                                            <span>VUELTO TOTAL EN DIVISAS:</span>
                                                            <span>${formatCurrency(sale.totalChangeInUSD || 0)}</span>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="p-3 bg-slate-50 border rounded-md text-[10px] text-muted-foreground italic text-center uppercase font-bold">
                                                        No se registró entrega de vuelto para esta transacción.
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div className="p-3 bg-primary/5 rounded-md border border-primary/10 flex justify-between items-center">
                                            <div className="flex flex-col">
                                                <span className="text-[10px] font-bold text-primary uppercase">Monto Neto en Caja</span>
                                                <span className="text-[9px] text-muted-foreground italic">(Total Pagos - Vuelto Entregado)</span>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-xl font-black text-primary leading-none">
                                                    ${formatCurrency(sale.actualPaidAmount ?? sale.totalAmount)}
                                                </p>
                                                <p className="text-[10px] font-bold text-slate-500 mt-1">
                                                    ~ Bs {formatCurrency((sale.actualPaidAmount ?? sale.totalAmount) * (sale.bcvRateAtTime || currentBcvRate))}
                                                </p>
                                            </div>
                                        </div>
                                        
                                        <div className="p-2 border rounded-md bg-white text-[9px] text-muted-foreground text-center italic font-bold">
                                            TASA BCV AL MOMENTO: {(sale.bcvRateAtTime || currentBcvRate).toFixed(2)} BS/$
                                        </div>
                                        
                                        {sale.status === 'refunded' && (
                                            <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl space-y-3">
                                                <p className="text-[10px] font-black text-destructive uppercase flex items-center gap-1.5 border-b border-destructive/10 pb-2">
                                                    <AlertTriangle className="w-3.5 h-3.5" /> Detalles del Reembolso
                                                </p>
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div>
                                                        <p className="text-[8px] font-black text-destructive/60 uppercase">Motivo:</p>
                                                        <p className="text-xs text-destructive italic font-bold">"{sale.refundReason}"</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-[8px] font-black text-destructive/60 uppercase">Devuelto por:</p>
                                                        <Badge variant="destructive" className="text-[9px] uppercase font-black">{sale.refundPaymentMethod}</Badge>
                                                    </div>
                                                </div>
                                                <p className="text-[8px] text-destructive/60 text-right uppercase font-bold">Procesado el {sale.refundedAt ? format(parseISO(sale.refundedAt), "dd/MM/yy hh:mm a", { locale: es }) : 'N/A'}</p>
                                            </div>
                                        )}
                                    </div>
                                </AccordionContent>
                            </AccordionItem>
                        ))}
                    </Accordion>
                )}

                {totalPages > 1 && (
                    <div className="flex items-center justify-between py-4 border-t mt-4">
                        <span className="text-[10px] font-black uppercase text-muted-foreground">
                            Página {currentPage} de {totalPages}
                        </span>
                        <div className="flex gap-2">
                            <Button 
                                variant="outline" 
                                size="sm" 
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))} 
                                disabled={currentPage === 1}
                                className="h-8 text-[10px] font-black uppercase"
                            >
                                <ChevronLeft className="w-3 h-3 mr-1" /> Anterior
                            </Button>
                            <Button 
                                variant="outline" 
                                size="sm" 
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} 
                                disabled={currentPage === totalPages}
                                className="h-8 text-[10px] font-black uppercase"
                            >
                                Siguiente <ChevronRight className="w-3 h-3 ml-1" />
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
