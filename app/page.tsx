import Dashboard from "@/components/dashboard";
import QueryProvider from "@/components/query-provider";

export default function Page() {
    return (
        <QueryProvider>
            <Dashboard />
        </QueryProvider>
    );
}
