"use client";

import type { CartItem, Payment, PaymentMethod, Sale, Product, UserProfile, RepairJob } from "@/lib/types";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "../ui/dialog";
import { useState, type ReactNode, useMemo, useEffect } from "react";
import { CreditCard, Landmark, Smartphone, DollarSign, Printer, Trash2, Banknote, AlertCircle, Loader2, Coins } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ReceiptView, handlePrintReceipt } from "./receipt-view";
import { useCurrency } from "@/hooks/use-currency";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { ScrollArea } from "../ui/scroll-area";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { Checkbox } from "../ui/checkbox";
import { useFirebase, useDoc, useMemoFirebase } from "@/firebase";
import { doc } from "firebase/firestore";
import { Badge } from "../ui/badge";

type CheckoutDialogProps = {
  cart: CartItem[];
  allProducts: Product[];
  total: number;
  children: ReactNode;
  onCheckout: (payments: Payment[], changeGiven: Payment[], totalChangeInUSD: number) => Promise<Sale | null>;
  onClearCart: () => void;
  isRepairSale?: boolean;
  repairData?: RepairJob | null;
};

const paymentMethodOptions: { value: PaymentMethod, label: string, icon: ReactNode, hasReference: boolean, isBs: boolean }[] = [
    { value: 'Efectivo USD', label: 'Efectivo USD', icon: <DollarSign className="w-5 h-5"/>, hasReference: false, isBs: false },
    { value: 'Efectivo Bs', label: 'Efectivo Bs', icon: <Landmark className="w-5 h-5"/>, hasReference: false, isBs: true },
    { value: 'Tarjeta', label: 'Tarjeta', icon: <CreditCard className="w-5 h-5"/>, hasReference: true, isBs: true },
    { value: 'Pago Móvil', label: 'Pago Móvil', icon: <Smartphone className="w-5 h-5"/>, hasReference: true, isBs: true },
    { value: 'Transferencia', label: 'Transferencia', icon: <Banknote className="w-5 h-5"/>, hasReference: true, isBs: true },
    { value: 'USDT / Crypto', label: 'USDT / Crypto', icon: <Coins className="w-5 h-5"/>, hasReference: true, isBs: false },
];

const changeMethodOptions: { value: PaymentMethod, label: string, icon: ReactNode, isBs: boolean }[] = [
    { value: 'Efectivo USD', label: 'Vuelto en USD', icon: <DollarSign className="w-5 h-5"/>, isBs: false },
    { value: 'Efectivo Bs', label: 'Vuelto en Bs', icon: <Landmark className="w-5 h-5"/>, isBs: true },
    { value: 'Pago Móvil', label: 'Vuelto por P. Móvil', icon: <Smartphone className="w-5 h-5"/>, isBs: true },
];

type TempPayment = Payment & { id: number };

export function CheckoutDialog({ cart, allProducts, total, children, onCheckout, onClearCart, isRepairSale, repairData }: CheckoutDialogProps) {
  const [open, setOpen] = useState(false);
  const [completedSale, setCompletedSale] = useState<Sale | null>(null);
  const { toast } = useToast();
  const { firestore, user } = useFirebase();
  const { format: formatCurrency, getSymbol, convert, isLoading: currencyLoading } = useCurrency();
  const [payments, setPayments] = useState<TempPayment[]>([]);
  const [changePayments, setChangePayments] = useState<TempPayment[]>([]);
  const [isGivingChange, setIsGivingChange] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();

  const profileRef = useMemoFirebase(() => 
    (firestore && user) ? doc(firestore, 'users', user.uid) : null,
    [firestore, user?.uid]
  );
  const { data: profile } = useDoc<UserProfile>(profileRef);
  
  // Determinamos si la venta tiene promociones para elegir la tasa
  const hasPromo = useMemo(() => cart.some(item => item.isPromo), [cart]);

  useEffect(() => {
    if (open && !completedSale) {
      setPayments([]);
      setChangePayments([]);
      setIsGivingChange(false);
      setIsSubmitting(false);
    }
  }, [open, completedSale]);

  const totalPaid = useMemo(() => {
    if (currencyLoading) return 0;
    return payments.reduce((acc, payment) => {
      if (payment.method === 'Efectivo USD' || payment.method === 'USDT / Crypto') {
        return acc + payment.amount;
      }
      // CRITICAL: Usamos Tasa de Reposición (Parallel) SOLO si hay promociones, sino BCV
      return acc + convert(payment.amount, 'Bs', 'USD', hasPromo);
    }, 0);
  }, [payments, convert, currencyLoading, hasPromo]);

  const totalGivenInUSD = useMemo(() => {
      if (currencyLoading) return 0;
      return changePayments.reduce((acc, payment) => {
          if (payment.method === 'Efectivo USD' || payment.method === 'USDT / Crypto') {
              return acc + payment.amount;
          }
          return acc + convert(payment.amount, 'Bs', 'USD', hasPromo);
      }, 0);
  }, [changePayments, convert, currencyLoading, hasPromo]);

  const remainingToPayInUSD = useMemo(() => Math.max(0, total - totalPaid), [total, totalPaid]);
  const potentialChangeInUSD = useMemo(() => (totalPaid > total ? totalPaid - total : 0), [totalPaid, total]);
  const isPartialPayment = totalPaid < total - 0.01;
  const requiredChangeInUSD = isGivingChange ? potentialChangeInUSD : 0;
  const changeDifference = useMemo(() => requiredChangeInUSD - totalGivenInUSD, [requiredChangeInUSD, totalGivenInUSD]);
  
  const canConfirm = useMemo(() => {
    if (total <= 0 || payments.length === 0 || currencyLoading || isSubmitting) return false;
    return totalPaid > 0;
  }, [total, totalPaid, payments, currencyLoading, isSubmitting]);

  useEffect(() => {
    if (potentialChangeInUSD <= 0.001) {
      setIsGivingChange(false);
      setChangePayments([]);
    }
  }, [potentialChangeInUSD]);

  const handleAddPayment = (method: PaymentMethod) => {
    setPayments(prev => [...prev, { id: Date.now(), method, amount: 0, reference: '' }]);
  };
  const handleUpdatePayment = (id: number, field: 'amount' | 'reference', value: string | number) => {
    setPayments(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  };
  const handleRemovePayment = (id: number) => {
    setPayments(prev => prev.filter(p => p.id !== id));
  };
  
  const handleAddChangePayment = (method: PaymentMethod) => {
    setChangePayments(prev => [...prev, { id: Date.now(), method, amount: 0, reference: '' }]);
  };
  const handleUpdateChangePayment = (id: number, field: 'amount' | 'reference', value: string | number) => {
    setChangePayments(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  };
  const handleRemoveChangePayment = (id: number) => {
    setChangePayments(prev => prev.filter(p => p.id !== id));
  };

  const handleConfirm = async () => {
    if (!canConfirm || isSubmitting) return;
    
    setIsSubmitting(true);
    const finalChangeGiven = isGivingChange ? changePayments.map(({ id, ...rest }) => rest) : [];
    const finalTotalChangeUSD = isGivingChange ? potentialChangeInUSD : 0;
    
    try {
        const sale = await onCheckout(
            payments.map(({ id, ...rest }) => rest),
            finalChangeGiven,
            finalTotalChangeUSD
        );
        
        if(sale) {
            setCompletedSale(sale);
        }
    } catch (e) {
        toast({ variant: "destructive", title: "Error al procesar" });
    } finally {
        setIsSubmitting(false);
    }
  }

  const handleCloseAndReset = () => {
      if (completedSale) {
          if (isRepairSale) {
            router.push('/dashboard/repairs');
          } else {
            onClearCart();
          }
      }
      setCompletedSale(null);
      setOpen(false);
  }

  const onPrint = () => {
    if (!completedSale) return;
    const receiptProps = {
      sale: completedSale,
      currency: { format: formatCurrency, getSymbol, convert },
      businessName: profile?.businessName,
      profile: profile,
      repairData: repairData
    };
    handlePrintReceipt(receiptProps, (error) => {
      toast({
        variant: "destructive",
        title: "Error de Impresión",
        description: error
      });
    });
  };

  const showRateInfo = profile?.showRateOnReceipt !== false;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
        if (!isOpen) {
            if (completedSale) {
                handleCloseAndReset();
            } else {
                setOpen(false);
            }
        } else {
            setOpen(true);
        }
    }}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className={cn(
          "transition-all duration-300 overflow-hidden",
          completedSale ? "sm:max-w-lg" : (isGivingChange ? "sm:max-w-4xl" : "sm:max-w-lg")
      )}>
        {completedSale ? (
            <div className="flex flex-col h-full">
               <div className="p-4">
                  <DialogTitle>Venta Completada</DialogTitle>
                </div>
              <div className="overflow-y-auto p-4 max-h-[400px] border rounded-md">
                <ReceiptView 
                    sale={completedSale} 
                    currency={{ format: formatCurrency, getSymbol, convert }}
                    businessName={profile?.businessName}
                    profile={profile}
                    repairData={repairData}
                />
              </div>
              <div className="mt-auto p-6 bg-background flex gap-2">
                   <Button onClick={onPrint} variant="outline" className="w-full">
                      <Printer className="mr-2 h-4 w-4" />
                      Imprimir Recibo
                  </Button>
                  <Button onClick={handleCloseAndReset} className="w-full">Cerrar</Button>
              </div>
          </div>
        ) : (
            <>
            <DialogHeader>
                <DialogTitle>Completar Venta</DialogTitle>
            </DialogHeader>
            
            <div className={cn("grid grid-cols-1 gap-6 py-2", isGivingChange && "md:grid-cols-2")}>
                <div className="space-y-4">
                    <div className="text-center p-4 bg-muted rounded-lg relative">
                        <p className="text-sm text-muted-foreground">Monto Total a Pagar</p>
                        <p className="text-4xl font-bold">{getSymbol('USD')}{formatCurrency(total, 'USD')}</p>
                        <p className="text-sm text-muted-foreground font-black">o ~Bs {formatCurrency(convert(total, 'USD', 'Bs', hasPromo), 'Bs')}</p>
                        {isPartialPayment && (
                            <Badge variant="destructive" className="absolute top-2 right-2 animate-pulse">PAGO PARCIAL / ABONO</Badge>
                        )}
                        {hasPromo && (
                            <Badge className="absolute top-2 left-2 bg-blue-600 font-black text-[9px] tracking-tighter">OFERTA ACTIVA</Badge>
                        )}
                    </div>

                    <div className="space-y-2">
                        <p className="font-bold text-xs uppercase text-muted-foreground">Añadir Métodos de Pago</p>
                        <div className="flex flex-wrap gap-2">
                            {paymentMethodOptions.map(method => (
                            <Button key={method.value} variant="outline" size="sm" className="h-8 text-[10px]" onClick={() => handleAddPayment(method.value)} disabled={isSubmitting}>
                                    {method.icon} {method.label}
                            </Button>
                            ))}
                        </div>
                    </div>

                    {payments.length > 0 && (
                        <ScrollArea className="h-[180px] pr-2">
                            <div className="space-y-3">
                                {payments.map(p => {
                                    const option = paymentMethodOptions.find(o => o.value === p.method)!;
                                    const symbol = option.isBs ? getSymbol('Bs') : getSymbol('USD');
                                    
                                    // Calculamos el restante en la moneda del método
                                    const remainingInCurrency = option.isBs ? convert(remainingToPayInUSD, 'USD', 'Bs', hasPromo) : remainingToPayInUSD;

                                    return (
                                    <div key={p.id} className="p-3 border rounded-lg bg-background flex flex-col gap-2 shadow-sm">
                                        <div className="flex justify-between items-center">
                                            <Label className="flex items-center gap-2 text-xs font-bold">{option.icon} {option.label}</Label>
                                            <Button variant="ghost" size="icon" className="w-6 h-6 text-destructive" onClick={() => handleRemovePayment(p.id)} disabled={isSubmitting}>
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </div>
                                        <div className="flex gap-2">
                                            <div className="flex-1 space-y-1">
                                                <div className="relative">
                                                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                                                        <span className="text-gray-500 text-xs font-bold">{symbol}</span>
                                                    </div>
                                                    <Input
                                                        type="number"
                                                        value={p.amount || ''}
                                                        onChange={(e) => handleUpdatePayment(p.id, 'amount', parseFloat(e.target.value) || 0)}
                                                        placeholder="0,00"
                                                        className="pl-8 h-9 text-sm"
                                                        disabled={isSubmitting}
                                                    />
                                                </div>
                                                {remainingToPayInUSD > 0 && (
                                                    <button 
                                                        type="button"
                                                        onClick={() => handleUpdatePayment(p.id, 'amount', parseFloat(remainingInCurrency.toFixed(2)))}
                                                        className="text-[9px] font-black uppercase text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
                                                    >
                                                        PAGAR RESTANTE: {symbol}{formatCurrency(remainingInCurrency)}
                                                    </button>
                                                )}
                                            </div>
                                            {option.hasReference && (
                                                <Input
                                                    type="text"
                                                    value={p.reference || ''}
                                                    onChange={(e) => handleUpdatePayment(p.id, 'reference', e.target.value)}
                                                    placeholder="Ref/Correo."
                                                    className="flex-1 h-9 text-sm font-mono font-bold"
                                                    disabled={isSubmitting}
                                                />
                                            )}
                                        </div>
                                    </div>
                                    );
                                })}
                            </div>
                        </ScrollArea>
                    )}

                    <div className="text-center p-3 rounded-lg bg-secondary/50 text-secondary-foreground border border-secondary">
                        {totalPaid >= total - 0.01 ? (
                            <>
                            <p className="text-xs font-bold text-muted-foreground uppercase">Vuelto Calculado</p>
                            <div className="font-black text-green-600">
                                <p className="text-2xl">{getSymbol('USD')}{formatCurrency(potentialChangeInUSD, 'USD')}</p>
                                <p className="text-[10px] text-green-700/80">
                                o Bs {formatCurrency(convert(potentialChangeInUSD, 'USD', 'Bs', hasPromo), 'Bs')}
                                </p>
                            </div>
                            </>
                        ) : (
                            <>
                            <p className="text-xs font-bold text-muted-foreground uppercase">Monto Restante</p>
                            <div className="font-black text-destructive">
                                <p className="text-2xl">{getSymbol('USD')}{formatCurrency(total - totalPaid, 'USD')}</p>
                                <p className="text-[10px] text-destructive/80 font-black">
                                o Bs {formatCurrency(convert(total - totalPaid, 'USD', 'Bs', hasPromo), 'Bs')}
                                </p>
                            </div>
                            </>
                        )}
                    </div>

                    {showRateInfo && (
                        <div className="p-3 bg-slate-50 border rounded-lg flex items-center gap-2">
                            <div className={cn("w-2 h-2 rounded-full", hasPromo ? "bg-amber-500 animate-pulse" : "bg-green-500")} />
                            <span className="text-[9px] font-black uppercase text-muted-foreground tracking-widest">
                                Tasa de Cobro: <span className="text-slate-800">{hasPromo ? 'REPOSICIÓN (PROMO ACTIVA)' : 'OFICIAL (BCV)'}</span>
                            </span>
                        </div>
                    )}

                    {isPartialPayment && isRepairSale && (
                        <div className="flex items-center gap-2 p-2 bg-blue-50 border border-blue-200 rounded-md text-blue-800 text-[10px] font-bold">
                            <AlertCircle className="w-3 h-3 shrink-0" />
                            <span>ESTE MONTO SE REGISTRARÁ COMO ABONO AL TRABAJO DE REPARACIÓN.</span>
                        </div>
                    )}

                    {potentialChangeInUSD > 0.001 && (
                        <div className="flex items-center space-x-2 pt-2 border-t mt-2">
                            <Checkbox
                                id="give-change-checkbox"
                                checked={isGivingChange}
                                onCheckedChange={(checked) => {
                                    setIsGivingChange(!!checked);
                                    if (!checked) setChangePayments([]);
                                }}
                                disabled={isSubmitting}
                            />
                            <Label htmlFor="give-change-checkbox" className="cursor-pointer font-black text-sm text-primary">
                                REGISTRAR ENTREGA DE VUELTO
                            </Label>
                        </div>
                    )}
                </div>

                {isGivingChange && (
                    <div className="space-y-4 md:border-l md:pl-6 animate-in slide-in-from-right-4 fade-in duration-300">
                        <div className="text-center p-3 rounded-lg bg-primary/10 border border-primary/20">
                            <p className="text-[10px] font-bold text-primary uppercase tracking-widest">Vuelto Requerido</p>
                            <p className="text-3xl font-black text-primary">${formatCurrency(requiredChangeInUSD)}</p>
                            <p className="text-[10px] text-primary/80 font-bold">o Bs {formatCurrency(convert(requiredChangeInUSD, 'USD', 'Bs', hasPromo))}</p>
                        </div>

                        <div className="space-y-2">
                            <p className="font-bold text-[10px] uppercase text-muted-foreground">Métodos de Entrega</p>
                            <div className="flex flex-wrap gap-2">
                                {changeMethodOptions.map(method => (
                                    <Button key={method.value} variant="outline" size="sm" className="h-7 text-[9px]" onClick={() => handleAddChangePayment(method.value)} disabled={isSubmitting}>
                                        {method.icon} {method.label}
                                    </Button>
                                ))}
                            </div>
                        </div>

                        <ScrollArea className="h-[180px] pr-2">
                            <div className="space-y-2">
                                {changePayments.map(p => {
                                    const option = changeMethodOptions.find(o => o.value === p.method)!;
                                    const symbol = option.isBs ? getSymbol('Bs') : getSymbol('USD');
                                    return (
                                    <div key={p.id} className="p-2 border rounded-lg bg-background flex gap-2 items-center shadow-sm">
                                        <span className="text-[10px] font-bold text-muted-foreground w-20 truncate">{p.method}</span>
                                        <div className="relative flex-1">
                                            <span className="absolute left-2.5 top-2 text-muted-foreground text-[10px] font-bold">{symbol}</span>
                                            <Input
                                                type="number"
                                                value={p.amount || ''}
                                                onChange={(e) => handleUpdateChangePayment(p.id, 'amount', parseFloat(e.target.value) || 0)}
                                                placeholder="0,00"
                                                className="pl-7 h-8 text-xs font-bold"
                                                disabled={isSubmitting}
                                            />
                                        </div>
                                        <Button variant="ghost" size="icon" className="w-7 h-7 text-destructive" onClick={() => handleRemoveChangePayment(p.id)} disabled={isSubmitting}>
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </Button>
                                    </div>
                                    );
                                })}
                            </div>
                        </ScrollArea>
                        
                        <div className={cn(
                            "text-center font-black text-[10px] p-3 rounded-md uppercase tracking-tighter border",
                            Math.abs(changeDifference) > 0.01 ? "bg-destructive/10 text-destructive border-destructive/20" : "bg-green-600/10 text-green-700 border-green-600/20"
                        )}>
                            {Math.abs(changeDifference) > 0.01 
                            ? (
                                <div className="flex flex-col gap-0.5">
                                    <span>Faltan devolver: ${formatCurrency(Math.abs(changeDifference))}</span>
                                    <span>o Bs {formatCurrency(convert(Math.abs(changeDifference), 'USD', 'Bs', hasPromo))}</span>
                                </div>
                            )
                            : "Vuelto Correcto ✓"}
                        </div>
                    </div>
                )}
            </div>

            <Button 
                size="lg" 
                onClick={handleConfirm} 
                disabled={!canConfirm || isSubmitting} 
                className="w-full h-12 text-lg font-black mt-2 shadow-md"
            >
                {isSubmitting ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}
                {currencyLoading ? 'Calculando tasa...' : 'FINALIZAR Y FACTURAR'}
            </Button>
            </>
        )}
      </DialogContent>
    </Dialog>
  );
}
