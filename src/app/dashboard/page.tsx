"use client";

import { PageHeader } from "@/components/page-header";
import MonthlyActivityOverview from "@/components/dashboard/monthly-activity-overview";
import { useCollection, useFirebase, useMemoFirebase } from "@/firebase";
import { collection, query, where } from "firebase/firestore";
import type { Sale, RepairJob } from "@/lib/types";
import { startOfMonth } from "date-fns";
import { useMemo } from "react";

export default function DashboardPage() {
    const { firestore, user } = useFirebase();

    // Cálculo del primer día del mes actual a las 00:00:00
    const startOfCurrentMonth = useMemo(() => startOfMonth(new Date()).toISOString(), []);

    // VENTAS - Filtrado por servidor para el mes actual
    const salesCollection = useMemoFirebase(() => 
        (firestore && user) ? query(
            collection(firestore, "users", user.uid, "sale_transactions"),
            where("transactionDate", ">=", startOfCurrentMonth)
        ) : null, 
        [firestore, user?.uid, startOfCurrentMonth]
    );
    const { data: sales, isLoading: salesLoading } = useCollection<Sale>(salesCollection);

    // REPARACIONES - Filtrado por servidor para el mes actual
    const repairJobsCollection = useMemoFirebase(() =>
        (firestore && user) ? query(
            collection(firestore, "users", user.uid, "repair_jobs"),
            where("createdAt", ">=", startOfCurrentMonth)
        ) : null,
        [firestore, user?.uid, startOfCurrentMonth]
    );
    const { data: repairJobs, isLoading: repairsLoading } = useCollection<RepairJob>(repairJobsCollection);

    const isLoading = salesLoading || repairsLoading;

    return (
        <>
            <PageHeader title="Panel de Control" />
            <main className="flex-1 p-4 sm:p-6">
                <MonthlyActivityOverview 
                    sales={sales || []} 
                    repairJobs={repairJobs || []} 
                    isLoading={isLoading}
                />
            </main>
        </>
    );
}
