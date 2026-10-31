import { SidebarProvider } from '@/components/layout/SidebarContext';
import { Sidebar } from '@/components/layout/Sidebar';
import { RouteGuard } from '@/components/layout/RouteGuard';
import { SupportBanner } from '@/components/layout/SupportBanner';
import { InstallPrompt } from '@/components/layout/InstallPrompt';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <div className="flex h-screen overflow-hidden bg-slate-50">
        <Sidebar />
        {/* min-w-0 prevents flex children from overflowing on mobile */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <InstallPrompt />
          <SupportBanner />
          <RouteGuard>{children}</RouteGuard>
        </div>
      </div>
    </SidebarProvider>
  );
}
