import { StoreDashboard } from "@/components/store-dashboard";
import { loadDashboardSnapshot } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";

type HomeProps = {
  searchParams?: Promise<{
    view?: string | string[];
  }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const snapshot = await loadDashboardSnapshot();
  const params = searchParams ? await searchParams : {};
  const view = Array.isArray(params.view) ? params.view[0] : params.view;
  return <StoreDashboard snapshot={snapshot} initialView={view} />;
}
