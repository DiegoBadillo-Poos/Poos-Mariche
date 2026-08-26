"use client";

import type { DailyReconciliation, PaymentMethod, UserProfile } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../ui/accordion";
import { format, parseISO, isWithinInterval, startOfDay, endOfDay } from "date-fns";
import { es } from "date-fns/locale";
import { useCurrency } from "@/hooks/use-currency";
import { Skeleton } from "../ui/skeleton";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { Minus, Printer, CalendarIcon, X as ClearIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../ui/button";
import { handlePrintReconciliation } from "./reconciliation-ticket";
import { useToast } from "@/hooks/use-toast";
import { useState, useMemo, useEffect } from "react";
import type { DateRange } from "react-day-picker";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Calendar } from "../ui/calendar";
import { useFirebase, useDoc, useMemoFirebase } from "@/firebase";
import { doc } from "firebase/firestore";

type ReconciliationHistoryProps = {
  reconciliations: DailyReconciliation[];
  isLoading?: boolean;
};

const ITEMS_PER_PAGE = 5;
const paymentMethodsOrder: PaymentMethod[] = ['Efectivo USD', 'Efectivo Bs', 'Tarjeta', 'Pago Móvil', 'Transferencia'];

export function ReconciliationHistory({ reconciliations, isLoading }: ReconciliationHistoryProps) {
  const currency = useCurrency();
  const { format: formatCurrency, getSymbol } = currency;
  const { toast } = useToast();
  const { firestore, user } = useFirebase();
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [currentPage, setCurrentPage] = useState(1);

  const profileRef = useMemoFirebase(() => 
    (firestore && user) ? doc(firestore, 'users', user.uid) : null,
    [firestore, user?.uid]
  );
  const { data: profile } = useDoc<UserProfile>(profileRef);

  const onPrint = (reconciliation: DailyReconciliation) => {
    handlePrintReconciliation({ 
        reconciliation, 
        currency,
        businessName: profile?.businessName
    }, (error) => {
      toast({
        variant: "destructive",
        title: "Error de Impresión",
        description: error,
      });
    });
  };

  const filteredReconciliations = useMemo(() => {
    if (!reconciliations) return [];
    
    let filtered = reconciliations;

    if (dateRange?.from) {
        const start = startOfDay(dateRange.from);
        const end = dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from);
        
        filtered = filtered.filter(recon => {
            const reconDate = parseISO(recon.closedAt);
            return isWithinInterval(reconDate, { start, end });
        });
    }

    return [...filtered].sort((a, b) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime());
  }, [reconciliations, dateRange]);

  useEffect(() => {
    setCurrentPage(1);
  }, [dateRange]);

  const totalPages = Math.ceil(filteredReconciliations.length / ITEMS_PER_PAGE);
  const paginatedReconciliations = useMemo(() => {
      const start = (currentPage - 1) * ITEMS_PER_PAGE;
      return filteredReconciliations.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredReconciliations, currentPage]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-4 w-3/4" />
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
     <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
                <CardTitle>Historial de Cierres de Caja</CardTitle>
                <CardDescription>Consulta los detalles de cada cierre de día.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
                <Popover>
                    <PopoverTrigger asChild>
                        <Button variant="outline" className={cn("w-[240px] justify-start text-left font-normal", !dateRange && "text-muted-foreground")}>
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {dateRange?.from ? (
                                dateRange.to ? (
                                    `${format(dateRange.from, "dd/MM/yy")} - ${format(dateRange.to, "dd/MM/yy")}`
                                ) : format(dateRange.from, "dd/MM/yy")
                            ) : "Filtrar por fecha"}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="end">
                        <Calendar mode="range" selected={dateRange} onSelect={setDateRange} locale={es} />
                    </PopoverContent>
                </Popover>
                {dateRange && (
                    <Button variant="ghost" size="icon" onClick={() => setDateRange(undefined)} className="h-9 w-9">
                        <ClearIcon className="h-4 w-4" />
                    </Button>
                )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
            {paginatedReconciliations.length === 0 ? (
                <div className="text-center py-12 border-2 border-dashed rounded-xl space-y-2">
                    <CalendarIcon className="w-12 h-12 text-muted-foreground/30 mx-auto" />
                    <p className="text-muted-foreground font-medium italic">No se encontraron cierres para el periodo seleccionado.</p>
                    {dateRange && (
                        <Button variant="link" onClick={() => setDateRange(undefined)}>Ver todo el historial</Button>
                    )}
                </div>
            ) : (
                <div className="space-y-4">
                    <Accordion type="single" collapsible className="w-full">
                        {paginatedReconciliations.map(recon => (
                            <AccordionItem value={recon.id} key={recon.id}>
                                <AccordionTrigger className="hover:no-underline">
                                    <div className="flex justify-between w-full pr-4">
                                        <div className="text-left">
                                            <p className="font-semibold">{format(parseISO(recon.closedAt), "PPP", { locale: es })}</p>
                                            <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest">ID: {recon.id}</p>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <div className="flex flex-col items-end">
                                                <span className="text-[10px] font-black uppercase text-muted-foreground">Dif. Total ($)</span>
                                                <p className="font-black text-lg">
                                                    {recon.totalDifference >= 0 ? '+' : ''}{getSymbol('USD')}{formatCurrency(recon.totalDifference, 'USD')}
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <span className="text-[10px] font-black uppercase text-primary">Ventas Totales</span>
                                                <p className="font-black text-lg">{getSymbol()}{formatCurrency(recon.totalSales)}</p>
                                            </div>
                                        </div>
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent>
                                <div className="p-4 bg-muted/30 rounded-lg border border-muted-foreground/10">
                                        <div className="flex justify-between items-center mb-4">
                                            <h4 className="font-bold text-xs uppercase text-muted-foreground tracking-widest">Detalles del Cierre</h4>
                                            <Button variant="outline" size="sm" onClick={() => onPrint(recon)} className="h-8">
                                                <Printer className="mr-2 h-3.5 w-3.5" />
                                                Imprimir Ticket
                                            </Button>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
                                            <div className="space-y-1.5 p-3 bg-white rounded-md border shadow-sm">
                                                <p className="text-[10px] font-bold text-muted-foreground uppercase">Flujo de Caja Real</p>
                                                <div className="flex justify-between text-sm">
                                                    <span>Pagos Recibidos:</span>
                                                    <span className="font-medium">+{getSymbol('USD')}{formatCurrency(recon.totalPaymentsReceived ?? 0, 'USD')}</span>
                                                </div>
                                                <div className="flex justify-between text-sm">
                                                    <span>Vueltos Entregados:</span>
                                                    <span className="font-medium">-{getSymbol('USD')}{formatCurrency(recon.totalChangeGiven ?? 0, 'USD')}</span>
                                                </div>
                                                <div className="flex justify-between font-black border-t pt-1.5 mt-1.5 text-primary">
                                                    <span>Neto en Caja ($):</span>
                                                    <span>{getSymbol('USD')}{formatCurrency(recon.totalExpected, 'USD')}</span>
                                                </div>
                                            </div>
                                            <div className="flex flex-col justify-center text-center p-3 bg-primary/5 rounded-md border border-primary/10">
                                                <p className="text-[10px] font-bold text-primary uppercase">Ventas Totales</p>
                                                <p className="text-2xl font-black text-primary">{getSymbol()}{formatCurrency(recon.totalSales)}</p>
                                                <p className="text-[10px] text-muted-foreground uppercase font-medium">{recon.totalTransactions} Transacciones</p>
                                            </div>
                                        </div>
                                        <div className="rounded-md border bg-white overflow-hidden">
                                            <Table>
                                                <TableHeader className="bg-muted/50">
                                                    <TableRow>
                                                        <TableHead className="h-8 text-[10px] font-bold uppercase">Método</TableHead>
                                                        <TableHead className="h-8 text-right text-[10px] font-bold uppercase">Esperado</TableHead>
                                                        <TableHead className="h-8 text-right text-[10px] font-bold uppercase">Contado</TableHead>
                                                        <TableHead className="h-8 text-right text-[10px] font-bold uppercase">Diferencia</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {paymentMethodsOrder.map(method => {
                                                        if (!recon.paymentMethods || !recon.paymentMethods[method]) return null;
                                                        const details = recon.paymentMethods[method]!;
                                                        const symbol = getSymbol(method === 'Efectivo USD' ? 'USD' : 'Bs');
                                                        
                                                        let statusTag = "";
                                                        if (details.difference > 0.01) statusTag = " (SOBRANTE)";
                                                        else if (details.difference < -0.01) statusTag = " (FALTANTE)";

                                                        return (
                                                            <TableRow key={method} className="h-8">
                                                                <TableCell className="py-2 text-xs font-medium">
                                                                    {method}
                                                                    <span className="text-[8px] font-black">{statusTag}</span>
                                                                </TableCell>
                                                                <TableCell className="py-2 text-right text-xs">{symbol}{formatCurrency(details.expected)}</TableCell>
                                                                <TableCell className="py-2 text-right text-xs">{symbol}{formatCurrency(details.counted)}</TableCell>
                                                                <TableCell className={cn("py-2 text-right text-xs font-bold")}>
                                                                    {details.difference >= 0 ? '+' : ''}{symbol}{formatCurrency(details.difference)}
                                                                </TableCell>
                                                            </TableRow>
                                                        )
                                                    })}
                                                    <TableRow className="font-black bg-primary/5 h-10">
                                                        <TableCell colSpan={3} className="text-xs uppercase text-primary">Diferencia Total Consolidada ($)</TableCell>
                                                        <TableCell className={cn("text-right text-base")}>
                                                            {recon.totalDifference >= 0 ? '+' : ''}{getSymbol('USD')}{formatCurrency(recon.totalDifference, 'USD')}
                                                        </TableCell>
                                                    </TableRow>
                                                </TableBody>
                                            </Table>
                                        </div>
                                </div>
                                </AccordionContent>
                            </AccordionItem>
                        ))}
                    </Accordion>

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
            )}
        </CardContent>
     </Card>
  );
}
