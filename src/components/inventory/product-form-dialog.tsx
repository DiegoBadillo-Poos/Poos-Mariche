"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useFieldArray } from "react-hook-form";
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
import { Label } from "@/components/ui/label";
import type { Product, ComboItem, UserProfile, ProductUnit } from "@/lib/types";
import { useState, type ReactNode, useEffect, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { useFirebase, setDocumentNonBlocking, useCollection, useMemoFirebase, useDoc } from "@/firebase";
import { collection, doc } from "firebase/firestore";
import { Checkbox } from "../ui/checkbox";
import { Textarea } from "../ui/textarea";
import { useCurrency } from "@/hooks/use-currency";
import { Separator } from "../ui/separator";
import { Info, PackagePlus, Search, Trash2, Percent, Lock, Check, ChevronsUpDown, CalendarIcon, Gift, Landmark, Scale, AlertTriangle, Hammer, Wrench, Tag, Calculator, TrendingUp, Smartphone, Barcode } from "lucide-react";
import { format } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "../ui/command";
import { cn } from "@/lib/utils";
import { Badge } from "../ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

const comboItemSchema = z.object({
  productId: z.string(),
  productName: z.string(),
  quantity: z.coerce.number().min(0.001, "La cantidad debe ser al menos 0.001."),
});

const formSchema = z.object({
  name: z.string().min(2, { message: "El nombre debe tener al menos 2 caracteres." }),
  category: z.string().min(2, { message: "La categoría es obligatoria." }),
  sku: z.string().min(1, { message: "El SKU o Código es obligatorio." }),
  barcode: z.string().optional().default(""),
  unit: z.enum(['unit', 'kg', 'g', 'lb', 'liter']),
  costPrice: z.coerce.number().min(0),
  isFixedPrice: z.boolean().default(false),
  fixedPrice: z.coerce.number().min(0).default(0),
  hasCustomMargin: z.boolean().default(false),
  customMargin: z.coerce.string().default("0"),
  hasPromoPrice: z.boolean().default(false),
  promoPrice: z.coerce.number().default(0),
  stockLevel: z.coerce.number().min(0, "El stock no puede ser negativo."),
  reservedStock: z.coerce.number().min(0, "Mínimo 0"),
  damagedStock: z.coerce.number().min(0, "Mínimo 0"),
  lowStockThreshold: z.coerce.number().min(0.001, "La alerta debe ser al menos 0.001."),
  compatibleModels: z.string().default(""),
  isCombo: z.boolean().default(false),
  comboItems: z.array(comboItemSchema).default([]),
  isGiftable: z.boolean().default(false),
  hasIVA: z.boolean().default(false),
  createdAt: z.string(),
}).superRefine((data, ctx) => {
  if (data.isFixedPrice) {
    if (data.fixedPrice <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "El precio es obligatorio.",
        path: ["fixedPrice"],
      });
    }
  } else {
    if (data.costPrice <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "El precio es obligatorio.",
        path: ["costPrice"],
      });
    }
  }
});

type ProductFormData = z.infer<typeof formSchema>;

interface ProductFormDialogProps {
    product?: Product;
    children?: ReactNode;
    productCount?: number;
    isOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
    onSaved?: (product: Product) => void;
}

export function ProductFormDialog({ product, children, productCount = 0, isOpen, onOpenChange, onSaved }: ProductFormDialogProps) {
  const { firestore, user } = useFirebase();
  const [internalOpen, setInternalOpen] = useState(false);
  const [categoryPopoverOpen, setCategoryPopoverOpen] = useState(false);
  const { toast } = useToast();
  const { getDynamicPrice, convert, format: formatCurrency, getSymbol, profitMargin, bcvRate, parallelRate } = useCurrency();

  const open = isOpen !== undefined ? isOpen : internalOpen;
  const setOpen = onOpenChange !== undefined ? onOpenChange : setInternalOpen;

  const profileRef = useMemoFirebase(() => 
    (firestore && user) ? doc(firestore, 'users', user.uid) : null,
    [firestore, user?.uid]
  );
  const { data: profile } = useDoc<UserProfile>(profileRef);

  const productsCollection = useMemoFirebase(() => 
    (firestore && user) ? collection(firestore, 'users', user.uid, 'products') : null, 
    [firestore, user?.uid]
  );
  const { data: allProducts } = useCollection<Product>(productsCollection);

  const categories = useMemo(() => {
    if (!allProducts) return [];
    const unique = Array.from(new Set(allProducts.map(p => p.category).filter(Boolean)));
    return unique.sort();
  }, [allProducts]);

  const form = useForm<ProductFormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      category: "GENERAL",
      sku: "",
      barcode: "",
      unit: "unit",
      costPrice: 0,
      isFixedPrice: false,
      fixedPrice: 0,
      hasCustomMargin: false,
      customMargin: "0",
      hasPromoPrice: false,
      promoPrice: 0,
      stockLevel: 1,
      reservedStock: 0,
      damagedStock: 0,
      lowStockThreshold: 1,
      compatibleModels: "",
      isCombo: false,
      comboItems: [],
      isGiftable: false,
      hasIVA: false,
      createdAt: new Date().toISOString().split('T')[0],
    },
  });

  const costPrice = form.watch("costPrice");
  const isFixedPrice = form.watch("isFixedPrice");
  const fixedPrice = form.watch("fixedPrice");
  const hasCustomMargin = form.watch("hasCustomMargin");
  const customMarginValue = form.watch("customMargin");
  const hasIVA = form.watch("hasIVA");
  const hasPromoPrice = form.watch("hasPromoPrice");
  const selectedUnit = form.watch("unit");
  const watchedName = form.watch("name");
  const watchedSku = form.watch("sku");
  const watchedBarcode = form.watch("barcode");
  const isEditing = !!product;
  
  const showRepairsFeature = profile?.enabledModules?.includes('repairs') ?? true;

  useEffect(() => {
    if (!allProducts || !watchedName) return;
    
    const nameExists = allProducts.some(p => 
        p.name.toUpperCase().trim() === watchedName.toUpperCase().trim() && 
        p.id !== product?.id
    );
    if (nameExists) {
        form.setError("name", { type: "manual", message: "¡Este producto ya existe!" });
    } else {
        form.clearErrors("name");
    }

    if (watchedSku) {
        const skuExists = allProducts.some(p => 
            p.sku.toUpperCase().trim() === watchedSku.toUpperCase().trim() && 
            p.id !== product?.id
        );
        if (skuExists) {
            form.setError("sku", { type: "manual", message: "¡Código SKU ya en uso!" });
        } else {
            form.clearErrors("sku");
        }
    }
  }, [watchedName, watchedSku, watchedBarcode, allProducts, product?.id, form]);

  const { suggestedRetailPrice, suggestedPromoPrice } = useMemo(() => {
    const suggestedPromo = costPrice > 0 ? costPrice * (1 + profitMargin / 100) : 0;
    
    let retail = 0;
    if (isFixedPrice) {
        retail = Number(fixedPrice) || 0;
    } else {
        const marginToUse = hasCustomMargin ? Number(customMarginValue || 0) : profitMargin;
        retail = getDynamicPrice(costPrice, marginToUse);
    }

    if (hasIVA) {
        retail = retail * 1.16;
    }
    
    return { 
        suggestedPromoPrice: parseFloat(suggestedPromo.toFixed(2)), 
        suggestedRetailPrice: parseFloat(retail.toFixed(2))
    };
  }, [isFixedPrice, fixedPrice, hasCustomMargin, customMarginValue, costPrice, getDynamicPrice, profitMargin, hasIVA]);

  useEffect(() => {
    if (open) {
        if (product) {
            form.reset({
              ...product,
              name: product.name.toUpperCase(),
              category: product.category.toUpperCase(),
              compatibleModels: product.compatibleModels ? product.compatibleModels.join(", ").toUpperCase() : "",
              sku: product.sku.toUpperCase(),
              barcode: product.barcode || "",
              hasPromoPrice: !!(product.promoPrice && product.promoPrice > 0),
              promoPrice: product.promoPrice || 0,
              isCombo: product.isCombo || false,
              comboItems: product.comboItems || [],
              isGiftable: product.isGiftable || false,
              hasIVA: product.hasIVA || false,
              unit: product.unit || "unit",
              stockLevel: product.stockLevel || 0,
              reservedStock: product.reservedStock || 0,
              damagedStock: product.damagedStock || 0,
              isFixedPrice: product.isFixedPrice || false,
              fixedPrice: product.fixedPrice || 0,
              hasCustomMargin: product.hasCustomMargin || false,
              customMargin: String(product.customMargin || 0),
              createdAt: product.createdAt || new Date().toISOString().split('T')[0],
            });
        } else {
            const now = new Date();
            const datePart = format(now, "ddMMyy");
            const timePart = format(now, "HHmm");
            const autoSKU = `SKU-${datePart}-${timePart}`;

            form.reset({
                name: "",
                category: "GENERAL",
                sku: autoSKU,
                barcode: "",
                unit: "unit",
                costPrice: 0,
                isFixedPrice: false,
                fixedPrice: 0,
                hasCustomMargin: false,
                customMargin: "0",
                hasPromoPrice: false,
                promoPrice: 0,
                stockLevel: 1,
                reservedStock: 0,
                damagedStock: 0,
                lowStockThreshold: 1,
                compatibleModels: "",
                isCombo: false,
                comboItems: [],
                isGiftable: false,
                hasIVA: false,
                createdAt: new Date().toISOString().split('T')[0],
            });
        }
    }
  }, [product, form, open, productCount]);

  async function onSubmit(values: ProductFormData) {
    if (!firestore || !user) return;

    const finalValues: any = {
        name: values.name.toUpperCase().trim(),
        category: values.category.toUpperCase().trim(),
        sku: values.sku.toUpperCase().trim(),
        barcode: values.barcode || "",
        unit: values.unit,
        costPrice: Number(values.costPrice) || 0,
        promoPrice: values.hasPromoPrice ? (Number(values.promoPrice) || 0) : 0,
        stockLevel: Number(values.stockLevel) || 0,
        reservedStock: Number(values.reservedStock) || 0,
        damagedStock: Number(values.damagedStock) || 0,
        lowStockThreshold: Number(values.lowStockThreshold) || 1,
        compatibleModels: values.compatibleModels ? values.compatibleModels.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : [],
        isCombo: !!values.isCombo,
        comboItems: values.isCombo ? (values.comboItems || []) : [],
        isGiftable: !!values.isGiftable,
        isFixedPrice: !!values.isFixedPrice,
        fixedPrice: values.isFixedPrice ? (Number(values.fixedPrice) || 0) : 0,
        hasCustomMargin: !!values.hasCustomMargin,
        customMargin: values.hasCustomMargin ? (Number(values.customMargin) || 0) : 0,
        hasIVA: !!values.hasIVA,
        createdAt: values.createdAt || new Date().toISOString().split('T')[0],
    };

    if (product && product.id) {
      const productRef = doc(firestore, 'users', user.uid, 'products', product.id);
      const updatedProduct = { ...finalValues, id: product.id };
      await setDocumentNonBlocking(productRef, updatedProduct, { merge: true });
      toast({ title: "Producto Actualizado" });
      onSaved?.(updatedProduct as Product);
    } else {
      const productsCollectionRef = collection(firestore, 'users', user.uid, 'products');
      const newDocRef = doc(productsCollectionRef);
      const newProduct = { ...finalValues, id: newDocRef.id };
      await setDocumentNonBlocking(newDocRef, newProduct, { merge: true });
      toast({ title: "Producto Añadido" });
      onSaved?.(newProduct as Product);
    }
    setOpen(false);
  }

  const stockPhysical = form.watch('stockLevel');
  const stockReserved = form.watch('reservedStock');
  const stockDamaged = form.watch('damagedStock');
  const availableReal = stockPhysical - stockReserved - stockDamaged;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent className="sm:max-w-[550px] max-h-[90vh] overflow-hidden flex flex-col p-0">
        <div className="p-4 sm:p-6 pb-2">
            <DialogHeader>
                <DialogTitle className="uppercase font-bold text-base sm:text-lg">{isEditing ? 'Gestionar Producto' : 'Añadir Nuevo Producto'}</DialogTitle>
                <DialogDescription className="hidden sm:block">Configura los precios y asegura que el stock coincida con el inventario real.</DialogDescription>
            </DialogHeader>
        </div>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col flex-1 overflow-hidden">
            <div className="flex-1 overflow-y-auto px-4 sm:px-6 space-y-5 sm:space-y-6">
                <FormField control={form.control} name="name" render={({ field, fieldState }) => (
                    <FormItem className="pt-1">
                        <FormLabel className="text-[10px] font-bold uppercase text-muted-foreground">Nombre del Artículo</FormLabel>
                        <FormControl>
                            <Input 
                                {...field} 
                                onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                                placeholder="EJ: PRODUCTO O SERVICIO..." 
                                className={cn("uppercase h-9 sm:h-10", fieldState.error && "border-destructive")}
                            />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )} />
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField control={form.control} name="category" render={({ field }) => (
                        <FormItem>
                            <FormLabel className="flex items-center gap-2 text-[10px] font-bold uppercase text-muted-foreground"><Tag className="w-3 h-3" /> Categoría</FormLabel>
                            <div className="flex gap-2">
                                <FormControl>
                                    <Input 
                                        {...field} 
                                        onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                                        placeholder="EJ: ACCESORIOS, REPUESTOS..." 
                                        className="flex-1 uppercase h-9 sm:h-10" 
                                    />
                                </FormControl>
                                <Popover open={categoryPopoverOpen} onOpenChange={setCategoryPopoverOpen}>
                                    <PopoverTrigger asChild>
                                        <Button type="button" variant="outline" size="icon" className="shrink-0 h-9 w-9 sm:h-10 sm:w-10">
                                            <ChevronsUpDown className="h-4 w-4 opacity-50" />
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-[200px] sm:w-[250px] p-0" align="end">
                                        <Command>
                                            <CommandInput placeholder="Buscar..." className="h-9" />
                                            <CommandList>
                                                <CommandEmpty>No hay resultados.</CommandEmpty>
                                                <CommandGroup>
                                                    {categories.map((cat) => (
                                                        <CommandItem key={cat} value={cat} onSelect={() => { form.setValue("category", cat.toUpperCase()); setCategoryPopoverOpen(false); }}>
                                                            <Check className={cn("mr-2 h-4 w-4", cat.toUpperCase() === field.value.toUpperCase() ? "opacity-100" : "opacity-0")} />
                                                            {cat.toUpperCase()}
                                                        </CommandItem>
                                                    ))}
                                                </CommandGroup>
                                            </CommandList>
                                        </Command>
                                    </PopoverContent>
                                </Popover>
                            </div>
                        </FormItem>
                    )} />
                    <FormField control={form.control} name="unit" render={({ field }) => (
                        <FormItem>
                            <FormLabel className="flex items-center gap-2 text-[10px] font-bold uppercase text-muted-foreground"><Scale className="w-3 h-3" /> Unidad</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                                <FormControl><SelectTrigger className="h-9 sm:h-10"><SelectValue /></SelectTrigger></FormControl>
                                <SelectContent>
                                    <SelectItem value="unit">Unidad (pza)</SelectItem>
                                    <SelectItem value="kg">Kilogramos (kg)</SelectItem>
                                    <SelectItem value="g">Gramos (g)</SelectItem>
                                    <SelectItem value="liter">Litros (L)</SelectItem>
                                </SelectContent>
                            </Select>
                        </FormItem>
                    )} />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField control={form.control} name="sku" render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-[10px] font-bold uppercase text-muted-foreground">SKU / Código</FormLabel>
                            <FormControl><Input {...field} onChange={(e) => field.onChange(e.target.value.toUpperCase())} className="uppercase font-mono h-9 sm:h-10" /></FormControl>
                            <FormMessage />
                        </FormItem>
                    )} />
                    <FormField control={form.control} name="barcode" render={({ field }) => (
                        <FormItem>
                            <FormLabel className="flex items-center gap-2 text-[10px] font-bold uppercase text-muted-foreground"><Barcode className="w-3 h-3" /> Código de Barras</FormLabel>
                            <FormControl><Input {...field} placeholder="Escanea..." className="h-9 sm:h-10" /></FormControl>
                        </FormItem>
                    )} />
                </div>

                {showRepairsFeature && (
                    <FormField control={form.control} name="compatibleModels" render={({ field }) => (
                        <FormItem className="bg-muted/10 p-3 rounded-lg border border-dashed">
                            <FormLabel className="flex items-center gap-2 text-primary font-bold text-[10px] uppercase"><Smartphone className="w-3.5 h-3.5" /> Modelos Compatibles</FormLabel>
                            <FormControl><Input {...field} onChange={(e) => field.onChange(e.target.value.toUpperCase())} placeholder="EJ: MODELOS, SERIES..." className="uppercase h-9" /></FormControl>
                        </FormItem>
                    )} />
                )}

                <div className="space-y-4">
                    <div className="flex items-center gap-2 text-primary font-bold text-[10px] uppercase tracking-widest border-b pb-1"><Calculator className="w-3.5 h-3.5" /> Estrategia de Precios</div>
                    
                    <div className="flex flex-wrap gap-x-3 gap-y-2 bg-muted/20 p-2 sm:p-3 rounded-lg border">
                        <FormField control={form.control} name="isFixedPrice" render={({ field }) => (
                            <FormItem className="flex items-center space-x-2 space-y-0">
                                <FormControl><Checkbox checked={field.value} onCheckedChange={(v) => { field.onChange(v); if(v) form.setValue('hasCustomMargin', false); }} /></FormControl>
                                <FormLabel className="font-bold cursor-pointer text-[9px] sm:text-[10px] uppercase flex items-center gap-1"><Lock className="w-3 h-3 text-amber-500" /> Fijo</FormLabel>
                            </FormItem>
                        )} />
                        <FormField control={form.control} name="hasCustomMargin" render={({ field }) => (
                            <FormItem className="flex items-center space-x-2 space-y-0">
                                <FormControl><Checkbox checked={field.value} onCheckedChange={(v) => { field.onChange(v); if(v) form.setValue('isFixedPrice', false); }} /></FormControl>
                                <FormLabel className="font-bold cursor-pointer text-[9px] sm:text-[10px] uppercase flex items-center gap-1"><Percent className="w-3 h-3 text-blue-500" /> % Ind.</FormLabel>
                            </FormItem>
                        )} />
                        <FormField control={form.control} name="hasIVA" render={({ field }) => (
                            <FormItem className="flex items-center space-x-2 space-y-0">
                                <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                <FormLabel className="font-bold cursor-pointer text-[9px] sm:text-[10px] uppercase flex items-center gap-1"><Landmark className="w-3 h-3 text-green-600" /> IVA</FormLabel>
                            </FormItem>
                        )} />
                        <FormField control={form.control} name="hasPromoPrice" render={({ field }) => (
                            <FormItem className="flex items-center space-x-2 space-y-0">
                                <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                <FormLabel className="font-bold cursor-pointer text-[9px] sm:text-[10px] uppercase flex items-center gap-1"><Gift className="w-3 h-3 text-pink-500" /> Oferta</FormLabel>
                            </FormItem>
                        )} />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <FormField control={form.control} name="costPrice" render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-[10px] font-bold uppercase">Costo Unitario ($)</FormLabel>
                                <FormControl><Input type="number" step="0.01" {...field} className="h-9 sm:h-10" /></FormControl>
                            </FormItem>
                        )} />
                        {isFixedPrice ? (
                            <FormField control={form.control} name="fixedPrice" render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-[10px] font-bold text-amber-600 uppercase">Precio Fijo ($)</FormLabel>
                                    <FormControl><Input type="number" step="0.01" {...field} className="h-9 sm:h-10 border-amber-200" /></FormControl>
                                </FormItem>
                            )} />
                        ) : hasCustomMargin ? (
                            <FormField control={form.control} name="customMargin" render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-[10px] font-bold text-blue-600 uppercase">Margen Ind. (%)</FormLabel>
                                    <FormControl><Input type="number" {...field} className="h-9 sm:h-10 border-blue-200" /></FormControl>
                                </FormItem>
                            )} />
                        ) : (
                            <div className="space-y-2 opacity-50"><Label className="text-[10px] font-bold uppercase">Margen Global</Label><Input value={`${profitMargin}%`} disabled className="h-9 sm:h-10" /></div>
                        )}
                    </div>

                    {hasPromoPrice && (
                        <FormField control={form.control} name="promoPrice" render={({ field }) => (
                            <FormItem className="bg-pink-50/50 p-2 sm:p-3 rounded-lg border border-pink-100">
                                <FormLabel className="text-[10px] font-bold text-pink-600 uppercase flex items-center gap-2"><Gift className="w-3.5 h-3.5" /> Precio Oferta ($)</FormLabel>
                                <FormControl><Input type="number" step="0.01" {...field} className="h-9 sm:h-10 border-pink-200 text-pink-700 bg-white" /></FormControl>
                            </FormItem>
                        )} />
                    )}

                    <div className="p-3 sm:p-4 rounded-xl bg-slate-900 text-white space-y-3 shadow-lg">
                        <div className="grid grid-cols-2 gap-4">
                            <div><p className="text-[8px] sm:text-[9px] font-bold text-slate-500 uppercase">P. Venta Sugerido</p><p className="text-lg sm:text-xl font-black text-blue-400">${formatCurrency(suggestedRetailPrice)}</p></div>
                            <div className="text-right"><p className="text-[8px] sm:text-[9px] font-bold text-slate-500 uppercase">P. Oferta Sugerido</p><p className="text-lg sm:text-xl font-black text-green-400">${formatCurrency(suggestedPromoPrice)}</p></div>
                        </div>
                    </div>
                </div>

                <div className="space-y-4">
                    <div className="flex items-center gap-2 text-primary font-bold text-[10px] uppercase tracking-widest border-b pb-1"><AlertTriangle className="w-3.5 h-3.5" /> Auditoría de Stock</div>
                    <div className="grid grid-cols-3 gap-2 sm:gap-4">
                        <FormField control={form.control} name="stockLevel" render={({ field }) => <FormItem><FormLabel className="text-[10px] font-bold uppercase">Físico</FormLabel><FormControl><Input type="number" step="any" {...field} className="h-9 sm:h-10" /></FormControl></FormItem>} />
                        <FormField control={form.control} name="reservedStock" render={({ field }) => <FormItem><FormLabel className="text-[10px] font-bold uppercase text-amber-600">Reserv.</FormLabel><FormControl><Input type="number" step="any" {...field} className="h-9 sm:h-10 border-amber-100" /></FormControl></FormItem>} />
                        <FormField control={form.control} name="damagedStock" render={({ field }) => <FormItem><FormLabel className="text-[10px] font-bold uppercase text-destructive">Dañado</FormLabel><FormControl><Input type="number" step="any" {...field} className="h-9 sm:h-10 border-destructive/10" /></FormControl></FormItem>} />
                    </div>
                    <div className={cn("p-2 sm:p-3 rounded-lg flex justify-between items-center border", availableReal <= 0 ? "bg-red-50 border-red-100" : "bg-green-50 border-green-100")}>
                        <span className="text-[10px] font-bold uppercase text-slate-500">Disponible Venta:</span>
                        <span className={cn("text-xl sm:text-2xl font-black", availableReal <= 0 ? "text-destructive" : "text-green-700")}>{availableReal} {selectedUnit.toUpperCase()}</span>
                    </div>
                </div>
                <div className="pb-4"></div>
            </div>

            <div className="px-4 sm:px-6 py-4 border-t bg-white shrink-0">
                <DialogFooter><Button type="submit" className="w-full h-11 sm:h-12 font-bold uppercase tracking-tight" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? "Sincronizando..." : "Guardar Producto"}</Button></DialogFooter>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
