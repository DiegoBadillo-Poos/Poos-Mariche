"use client";

import { PageHeader } from "@/components/page-header";
import { AnalysisView } from "@/components/analysis/analysis-view";
import { useCollection, useFirebase, useMemoFirebase } from "@/firebase";
import type { Product } from "@/lib/types";
import { collection, query, orderBy, limit, where } from "firebase/firestore";
import { SecurityGate } from "@/components/security-gate";

export default function AnalysisPage() {
    return (
        <SecurityGate module="analysis">
            <AnalysisContent />
        </SecurityGate>
    );
}

function AnalysisContent() {
    const { firestore, user } = useFirebase();

    // Consulta 1: Top 10 más vendidos (Por contador de ventas)
    const topProductsQuery = useMemoFirebase(() => 
        (firestore && user) ? query(
            collection(firestore, "users", user.uid, "products"), 
            orderBy("salesCount", "desc"), 
            limit(10)
        ) : null, 
        [firestore, user?.uid]
    );
    const { data: topProducts, isLoading: topLoading } = useCollection<Product>(topProductsQuery);

    // Consulta 2: Productos estancados (Con stock pero sin salida)
    // Ordenamos por stockLevel descendente para ver dónde hay más capital parado
    const stagnantProductsQuery = useMemoFirebase(() => 
        (firestore && user) ? query(
            collection(firestore, "users", user.uid, "products"), 
            where("stockLevel", ">", 0),
            orderBy("stockLevel", "desc"), 
            limit(15)
        ) : null,
        [firestore, user?.uid]
    );
    const { data: stagnantProducts, isLoading: stagnantLoading } = useCollection<Product>(stagnantProductsQuery);

    return (
        <>
            <PageHeader title="Inteligencia de Inventario" />
            <main className="flex-1 p-4 sm:p-6">
                <AnalysisView 
                    topProducts={topProducts || []} 
                    stagnantProducts={stagnantProducts || []}
                    isLoading={topLoading || stagnantLoading}
                />
            </main>
        </>
    )
}
