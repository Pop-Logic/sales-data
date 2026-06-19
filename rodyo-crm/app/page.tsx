import { StoreDashboard } from "@/components/store-dashboard";
import { loadDashboardSnapshot } from "@/lib/dashboard-data";

export default async function Home() {
  const snapshot = await loadDashboardSnapshot();
  return <StoreDashboard snapshot={snapshot} />;
}
