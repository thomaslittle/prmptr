import Dashboard from "@/components/dashboard";
import OverlayFeatureController from "@/components/overlay-feature-controller";
import QueryProvider from "@/components/query-provider";

export default function Page() {
    return (
        <QueryProvider>
            <Dashboard />
            <OverlayFeatureController />
        </QueryProvider>
    );
}
