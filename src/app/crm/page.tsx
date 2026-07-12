"use client";

import { useEffect, useState } from "react";
import { ApiLoadState } from "@/components/ApiLoadState";
import { CrmDashboard } from "@/components/CrmDashboard";
import { ProtectedPage } from "@/components/ProtectedPage";
import type { MockCohort } from "@/data/mockCohorts";
import type { MockCrmUser } from "@/data/mockCrmUsers";
import { getCrmCohorts, getCrmUsers } from "@/lib/api";

export default function CrmPage() {
  const [cohorts, setCohorts] = useState<MockCohort[]>([]);
  const [users, setUsers] = useState<MockCrmUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFallback, setIsFallback] = useState(false);

  useEffect(() => {
    Promise.all([getCrmCohorts(), getCrmUsers()]).then(
      ([cohortsResult, usersResult]) => {
        setCohorts(cohortsResult.data);
        setUsers(usersResult.data);
        setIsFallback(cohortsResult.isFallback || usersResult.isFallback);
        setIsLoading(false);
      },
    );
  }, []);

  return (
    <ProtectedPage allowedRoles={["admin"]}>
      <div className="space-y-4">
      <ApiLoadState isLoading={isLoading} isFallback={isFallback} />
      <CrmDashboard cohorts={cohorts} users={users} />
      </div>
    </ProtectedPage>
  );
}
