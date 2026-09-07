"use client";

import type { Product, Sale, RepairJob, UserModule, BusinessStats } from "@/lib/types";
import { useMemo, useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { Skeleton } from "../ui/skeleton";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Progress } from "../ui/progress";
import { subDays, startOfMonth, isAfter, parseISO } from "date-fns";
import { useCurrency } from "@/hooks/use-currency";
import { useFirebase, useDoc, useMemoFirebase } from "@/firebase";
import { doc } from "firebase/firestore";
import { 
    TrendingUp, 
    Flame, 
    Snowflake,
    Target,
    ShieldAlert,
    Lightbulb,
    Sparkles,
    Trash2,
    ChevronLeft,
    ChevronRight,
    Package
} from "lucide-react";

type AnalysisViewProps = {
    sales: Sale[];
    products: Product[];
    repairJobs: RepairJob[];
    isLoading?: boolean;
    enabledModules?: UserModule[];
    isAdmin?: boolean;
};

const ITEMS_PER_PAGE = 10;

export function AnalysisView({ sales, products, repairJobs, isLoading: itemsLoading, enabledModules }: AnalysisViewProps) {
    const { firestore, user } = useFirebase();
    const [dateRange, setDateRange] = useState<'7d' | '30d' | 'this_month'>('30d');
    const [starPage, setStarPage] = useState(1);
    const [coldPage, setColdPage] = useState(1);
    const { format: formatCurrency, getFinalPrice, parallelRate, bcvRate } = useCurrency();

    const statsRef = useMemoFirebase(() => 
        (firestore && user) ? doc(firestore, 'users', user.uid, 'system', 'estadisticas_actuales') : null,
        [firestore, user?.uid]
    );
    const { data: aggregatedStats, isLoading: statsLoading } = useDoc<BusinessStats>(statsRef);

    const showRepairs = enabledModules?.includes('repairs') ?? true;

    useEffect(() => {
        setStarPage(1);
        setColdPage(1);
    }, [dateRange]);

    const stats = useMemo(() => {
        if (itemsLoading || !sales || !products || !repairJobs) return null;

        const now = new Date();
        let currentStart: Date;

        switch (dateRange) {
            case '7d': currentStart = subDays(now, 7); break;
            case 'this_month': currentStart = startOfMonth(now); break;
            case '30d':
            default: currentStart = subDays(now, 30); break;
        }

        const filterByRange = (items: any[], start: Date) => 
            items.filter(item => {
                const dateStr = item.transactionDate || item.createdAt;
                if (!dateStr) return false;
                const itemDate = parseISO(dateStr);
                return isAfter(itemDate, start);
            });

        const currentSales = filterByRange(sales, currentStart).filter(s => s.status === 'completed');

        let currentProfit = 0;
        if (dateRange === '30d' && aggregatedStats) {
            currentProfit = aggregatedStats.totalRealProfit30d;
        } else {
            currentProfit = currentSales.reduce((acc, s) => {
                const nominalIncome = s.actualPaidAmount ?? s.totalAmount;
                const saleBcv = s.bcvRateAtTime || bcvRate;
                const saleParallel = s.parallelRateAtTime || parallelRate;
                const isSalePromo = s.items.some(i => i.isPromo);
                const rateFactor = isSalePromo ? 1 : (saleBcv / saleParallel);
                const realIncome = nominalIncome * rateFactor;

                let cost = 0;
                s.items.forEach(item => {
                    if (item.isCustom) {
                        cost += (item.customCostPrice || 0) * item.quantity;
                    } else {
                        const p = products.find(prod => prod.id === item.productId);
                        cost += (p?.costPrice || 0) * item.quantity;
                    }
                });

                const itemsTotalBillable = s.items.reduce((sum, i) => sum + (i.price * i.quantity), 0);
                const paymentRatio = itemsTotalBillable > 0 ? nominalIncome / itemsTotalBillable : 1;
                return acc + (realIncome - (cost * paymentRatio));
            }, 0);
        }

        // CÁLCULO DE MERCANCÍA FRÍA (Sin ventas en los últimos 5 días)
        const fiveDaysAgo = subDays(now, 5);
        const coldProducts = products.filter(p => {
            const available = p.stockLevel - (p.reservedStock || 0) - (p.damagedStock || 0);
            if (available <= 0) return false;

            // Verificar si el producto se ha vendido en los últimos 5 días
            const soldInLast5Days = sales.some(s => 
                s.status === 'completed' && 
                s.transactionDate && 
                isAfter(parseISO(s.transactionDate), fiveDaysAgo) &&
                s.items.some(i => i.productId === p.id)
            );

            return !soldInLast5Days;
        }).map(p => {
             const available = p.stockLevel - (p.reservedStock || 0) - (p.damagedStock || 0);
             return { ...p, available };
        }).sort((a, b) => b.available - a.available);

        const stagnantCapital = coldProducts.reduce((acc, p) => acc + (p.available * p.costPrice), 0);

        const inventoryData = products.map(p => {
            const soldInPeriod = currentSales.reduce((acc, s) => {
                const item = s.items.find(i => i.productId === p.id);
                return acc + (item?.quantity || 0);
            }, 0);
            const available = p.stockLevel - (p.reservedStock || 0) - (p.damagedStock || 0);
            const nominalRetailPrice = getFinalPrice(p);
            const isProductPromo = !!(p.promoPrice && p.promoPrice > 0);
            const realRetailPrice = isProductPromo ? (p.promoPrice || nominalRetailPrice) : (nominalRetailPrice * (bcvRate / parallelRate));
            const margin = p.costPrice > 0 ? ((realRetailPrice - p.costPrice) / p.costPrice) * 100 : 0;
            return { ...p, soldInPeriod, available, margin, realRetailPrice };
        });

        const workshopMissing: { model: string, part: string, count: number, id: string }[] = [];
        if (showRepairs) {
            repairJobs.filter(j => j.status !== 'Completado').forEach(job => {
                const parts = job.reservedParts || [];
                parts.forEach(pItem => {
                    const pData = products.find(prod => prod.id === pItem.productId);
                    const available = pData ? (pData.stockLevel - (pData.reservedStock || 0) - (pData.damagedStock || 0)) : 0;
                    if (available < 0) {
                        workshopMissing.push({ model: `${job.deviceMake} ${job.deviceModel}`, part: pItem.productName, count: Math.abs(available), id: pItem.productId });
                    }
                });
            });
        }

        const healthScore = products.length > 0 ? ((inventoryData.filter(p => p.soldInPeriod > 0).length / inventoryData.length) * 100) : 0;

        return { 
            currentProfit, 
            healthScore,
            stagnantCapital,
            starProducts: inventoryData.filter(p => p.soldInPeriod > 3).sort((a, b) => b.soldInPeriod - a.soldInPeriod),
            coldProducts,
            workshopMissing: workshopMissing.slice(0, 2)
        };
    }, [sales, products, repairJobs, itemsLoading, dateRange, getFinalPrice, bcvRate, parallelRate, showRepairs, aggregatedStats]);

    const paginatedStars = useMemo(() => {
        if (!stats) return [];
        const start = (starPage - 1) * ITEMS_PER_PAGE;
        return stats.starProducts.slice(start, start + ITEMS_PER_PAGE);
    }, [stats, starPage]);

    const paginatedCold = useMemo(() => {
        if (!stats) return [];
        const start = (coldPage - 1) * ITEMS_PER_PAGE;
        return stats.coldProducts.slice(start, start + ITEMS_PER_PAGE);
    }, [stats, coldPage]);

    if (itemsLoading || statsLoading) return <div className="p-10 space-y-4"><Skeleton className="h-20 w-full" /><Skeleton className="h-64 w-full" /></div>;
    if (!stats) return null;

    return (
        <div className="space-y-8 max-w-6xl mx-auto w-full pb-20">
            <div className="flex justify-between items-center bg-slate-900 text-white p-4 rounded-xl shadow-lg border-b-4 border-primary">
                <div className="flex items-center gap-3">
                    <Target className="w-6 h-6 text-primary" />
                    <h1 className="text-lg font-black uppercase tracking-tighter">Motor de Inteligencia Comercial</h1>
                </div>
                <Select value={dateRange} onValueChange={(v: any) => setDateRange(v)}>
                    <SelectTrigger className="w-[180px] h-9 text-[10px] font-black uppercase bg-white/10 border-white/20">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="7d">Últimos 7 días</SelectItem>
                        <SelectItem value="30d">Últimos 30 días (Optimizado)</SelectItem>
                        <SelectItem value="this_month">Mes actual</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="border-2 border-primary/20 bg-primary/5">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-[10px] font-black uppercase text-primary tracking-widest flex items-center gap-2">
                            <TrendingUp className="w-3.5 h-3.5" /> 📊 Finanzas Express
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div>
                            <p className="text-[9px] font-bold text-muted-foreground uppercase">Utilidad Real (Reposición):</p>
                            <p className="text-2xl font-black text-slate-800">${formatCurrency(stats.currentProfit)}</p>
                        </div>
                        <div className="pt-2 border-t border-primary/10">
                            <div className="flex justify-between items-center mb-1">
                                <span className="text-[9px] font-bold text-muted-foreground uppercase">Salud de Catálogo:</span>
                                <span className="text-[10px] font-black text-primary">{stats.healthScore.toFixed(0)}% Movimiento</span>
                            </div>
                            <Progress value={stats.healthScore} className="h-1.5" />
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-2 border-amber-200 bg-amber-50 md:col-span-2">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-[10px] font-black uppercase text-amber-700 tracking-widest flex items-center gap-2">
                            <ShieldAlert className="w-3.5 h-3.5" /> 🚨 Faltantes Críticos (Taller)
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        {stats.workshopMissing.length === 0 ? (
                            <div className="h-20 flex items-center justify-center text-xs font-bold text-amber-600/50 uppercase italic border-2 border-dashed border-amber-200 rounded-lg">
                                Sin piezas faltantes para reparaciones en curso
                            </div>
                        ) : (
                            stats.workshopMissing.map((m, i) => (
                                <div key={`wm-${i}`} className="flex items-center justify-between p-3 bg-white rounded-lg border border-amber-300 shadow-sm animate-pulse">
                                    <div className="flex items-center gap-3">
                                        <div className="p-1.5 bg-amber-100 rounded text-amber-700"><Flame className="w-4 h-4"/></div>
                                        <div>
                                            <p className="text-[10px] font-black uppercase text-amber-800">FALTANTE PARA {m.model}</p>
                                            <p className="text-xs font-bold">{m.count}un. de {m.part}</p>
                                        </div>
                                    </div>
                                    <Badge variant="destructive" className="animate-bounce">URGENTE</Badge>
                                </div>
                            ))
                        )}
                    </CardContent>
                </Card>
            </div>

            <Card className="border-2 border-green-200 bg-green-50/10 shadow-xl overflow-hidden rounded-2xl">
                <CardHeader className="bg-green-600 text-white py-4 flex flex-row items-center justify-between">
                    <div>
                        <CardTitle className="text-lg font-black uppercase tracking-tight flex items-center gap-2">
                            <Sparkles className="w-5 h-5 fill-white" /> Productos Estrella
                        </CardTitle>
                        <CardDescription className="text-green-100 text-[10px] font-bold uppercase">Los que más rotación y ganancia generan (+3 ventas)</CardDescription>
                    </div>
                    <Badge className="bg-white text-green-700 font-black px-4">{stats.starProducts.length} ÍTEMS</Badge>
                </CardHeader>
                <CardContent className="p-0 bg-white">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-green-50/50 hover:bg-green-50/50">
                                <TableHead className="text-[10px] font-black uppercase py-4">Artículo de Alto Flujo</TableHead>
                                <TableHead className="text-center text-[10px] font-black uppercase">Ventas</TableHead>
                                <TableHead className="text-center text-[10px] font-black uppercase">Rentabilidad</TableHead>
                                <TableHead className="text-right text-[10px] font-black uppercase pr-6">Estrategia Sugerida</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {paginatedStars.length === 0 ? (
                                <TableRow><TableCell colSpan={4} className="h-32 text-center text-muted-foreground font-bold uppercase italic">Aún no hay estrellas este mes.</TableCell></TableRow>
                            ) : (
                                paginatedStars.map(p => (
                                    <TableRow key={p.id} className="group hover:bg-green-50 transition-colors">
                                        <TableCell className="py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-9 h-9 rounded-full bg-green-100 text-green-600 flex items-center justify-center font-black text-xs uppercase shadow-inner border-2 border-white">{p.category.slice(0,2)}</div>
                                                <div>
                                                    <p className="font-black text-xs uppercase text-slate-800">{p.name}</p>
                                                    <p className="text-[8px] text-muted-foreground font-mono uppercase tracking-widest">STOCK: {p.available} {p.unit}</p>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <div className="inline-flex flex-col items-center">
                                                <span className="font-black text-xl text-green-700">{p.soldInPeriod}</span>
                                                <span className="text-[8px] font-bold text-green-600 uppercase">Salidas</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <Badge className="bg-green-100 text-green-700 font-mono text-xs border-green-200">+{p.margin.toFixed(0)}%</Badge>
                                        </TableCell>
                                        <TableCell className="text-right pr-6">
                                            <div className="flex flex-col items-end">
                                                <span className="text-[10px] font-black text-green-700 uppercase">PROTEGER STOCK</span>
                                                <span className="text-[8px] font-bold text-muted-foreground uppercase">Evaluando compra en lote</span>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                    
                    <div className="flex items-center justify-between px-6 py-4 bg-green-50/30 border-t">
                        <p className="text-[9px] font-black uppercase text-green-700/60 tracking-widest">PÁGINA {starPage} / {Math.ceil(stats.starProducts.length / ITEMS_PER_PAGE) || 1}</p>
                        <div className="flex gap-1">
                            <Button variant="outline" size="sm" className="h-8 w-8 p-0 border-2" onClick={() => setStarPage(p => Math.max(1, p - 1))} disabled={starPage === 1}><ChevronLeft className="w-4 h-4" /></Button>
                            <Button variant="outline" size="sm" className="h-8 w-8 p-0 border-2" onClick={() => setStarPage(p => Math.min(Math.ceil(stats.starProducts.length / ITEMS_PER_PAGE), p + 1))} disabled={starPage >= Math.ceil(stats.starProducts.length / ITEMS_PER_PAGE)}><ChevronRight className="w-4 h-4" /></Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card className="border-2 border-red-200 bg-red-50/10 shadow-xl overflow-hidden rounded-2xl">
                <CardHeader className="bg-red-600 text-white py-4 flex flex-row items-center justify-between">
                    <div>
                        <CardTitle className="text-lg font-black uppercase tracking-tight flex items-center gap-2">
                            <Snowflake className="w-5 h-5 fill-white" /> Mercancía Fría
                        </CardTitle>
                        <CardDescription className="text-red-100 text-[10px] font-bold uppercase">Productos sin ventas en los últimos 5 días</CardDescription>
                    </div>
                    <div className="flex flex-col items-end">
                        <Badge className="bg-white text-red-700 font-black px-4">${formatCurrency(stats.stagnantCapital)} EN PAUSA</Badge>
                    </div>
                </CardHeader>
                <CardContent className="p-0 bg-white">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-red-50/50 hover:bg-red-50/50">
                                <TableHead className="text-[10px] font-black uppercase py-4">Artículo Estancado</TableHead>
                                <TableHead className="text-center text-[10px] font-black uppercase">Stock Físico</TableHead>
                                <TableHead className="text-center text-[10px] font-black uppercase">Costo Total ($)</TableHead>
                                <TableHead className="text-right text-[10px] font-black uppercase pr-6">Acción de Rescate</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {paginatedCold.length === 0 ? (
                                <TableRow><TableCell colSpan={4} className="h-32 text-center text-muted-foreground font-bold uppercase italic">¡Felicidades! Todo tu inventario se mueve.</TableCell></TableRow>
                            ) : (
                                paginatedCold.map(p => (
                                    <TableRow key={p.id} className="group hover:bg-red-50 transition-colors">
                                        <TableCell className="py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-9 h-9 rounded bg-red-100 text-red-600 flex items-center justify-center font-black text-xs uppercase border shadow-sm">{p.category.slice(0,2)}</div>
                                                <div>
                                                    <p className="font-black text-xs uppercase text-slate-800">{p.name}</p>
                                                    <p className="text-[8px] text-muted-foreground font-bold uppercase">CATEGORÍA: {p.category}</p>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <span className="font-black text-lg text-slate-600">{p.available}</span>
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <span className="font-black text-xs text-red-600">${formatCurrency(p.available * p.costPrice)}</span>
                                        </TableCell>
                                        <TableCell className="text-right pr-6">
                                            <div className="flex items-center justify-end gap-2">
                                                <div className="flex flex-col items-end">
                                                    <span className="text-[10px] font-black text-red-700 uppercase">LIQUIDAR / PROMO</span>
                                                    <span className="text-[8px] font-bold text-muted-foreground uppercase">Combo en divisas</span>
                                                </div>
                                                <Button variant="ghost" size="icon" className="text-red-500 hover:bg-red-100 h-8 w-8"><Trash2 className="w-4 h-4"/></Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                    
                    <div className="flex items-center justify-between px-6 py-4 bg-red-50/30 border-t">
                        <p className="text-[9px] font-black uppercase text-red-700/60 tracking-widest">PÁGINA {coldPage} / {Math.ceil(stats.coldProducts.length / ITEMS_PER_PAGE) || 1}</p>
                        <div className="flex gap-1">
                            <Button variant="outline" size="sm" className="h-8 w-8 p-0 border-2" onClick={() => setColdPage(p => Math.max(1, p - 1))} disabled={coldPage === 1}><ChevronLeft className="w-4 h-4" /></Button>
                            <Button variant="outline" size="sm" className="h-8 w-8 p-0 border-2" onClick={() => setColdPage(p => Math.min(Math.ceil(stats.coldProducts.length / ITEMS_PER_PAGE), p + 1))} disabled={coldPage >= Math.ceil(stats.coldProducts.length / ITEMS_PER_PAGE)}><ChevronRight className="w-4 h-4" /></Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card className="border-2 border-blue-100 bg-blue-50/30">
                <CardHeader className="pb-2">
                    <CardTitle className="text-[10px] font-black uppercase text-blue-700 tracking-widest flex items-center gap-2">
                        <Lightbulb className="w-3.5 h-3.5" /> 💡 Estrategia de Liquidez Recomendada
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex items-center justify-between">
                    <div className="space-y-1">
                        <p className="text-xs font-bold text-blue-900 uppercase">
                            Liberar capital de la mercancía estancada
                        </p>
                        <p className="text-[10px] font-medium text-blue-700 uppercase tracking-tighter">
                            Sugerencia: Arma packs de accesorios o aplica "Tasa de Oferta" a los {stats.coldProducts.length} artículos fríos.
                        </p>
                    </div>
                    <div className="text-right">
                        <p className="text-[8px] font-black text-blue-400 uppercase">Valor de Rescate:</p>
                        <p className="text-xl font-black text-blue-700">${formatCurrency(stats.stagnantCapital)}</p>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
