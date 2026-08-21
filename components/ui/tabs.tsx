"use client";

import * as React from "react";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";

import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

function TabsList({
    className,
    ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
    return (
        <TabsPrimitive.List
            data-slot="tabs-list"
            className={cn(
                "inline-flex h-9 items-center justify-center rounded-none border-b border-border bg-muted/30 p-0 text-muted-foreground",
                className
            )}
            {...props}
        />
    );
}

function TabsTrigger({
    className,
    ...props
}: React.ComponentProps<typeof TabsPrimitive.Tab>) {
    return (
        <TabsPrimitive.Tab
            data-slot="tabs-trigger"
            className={cn(
                "inline-flex items-center justify-center whitespace-nowrap rounded-none border-b-2 border-transparent px-3 py-1.5 text-[11px] font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-active:border-primary data-active:text-foreground data-active:shadow-none",
                className
            )}
            {...props}
        />
    );
}

function TabsContent({
    className,
    ...props
}: React.ComponentProps<typeof TabsPrimitive.Panel>) {
    return (
        <TabsPrimitive.Panel
            data-slot="tabs-content"
            className={cn(
                "mt-4 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                className
            )}
            {...props}
        />
    );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
