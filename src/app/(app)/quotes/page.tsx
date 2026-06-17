import Link from "next/link";
import { format } from "date-fns";
import { ArrowRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getProjects } from "@/server/projects";

/**
 * Quotes index
 * - Header + primary create action
 * - Status summary cards
 * - Open quote table wired to project quote lifecycle data
 * - Empty state using RVLT registry components
 */
export default async function QuotesPage() {
  const [quoting, quoted] = await Promise.all([
    getProjects({ status: "QUOTING", pageSize: 50, sortBy: "rentalStartDate", sortOrder: "asc" }),
    getProjects({ status: "QUOTED", pageSize: 50, sortBy: "rentalStartDate", sortOrder: "asc" }),
  ]);
  const quotes = [...quoting.projects, ...quoted.projects];

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <p className="t-overline">Commercial desk</p>
          <h1 className="t-display">Quotes</h1>
          <p className="max-w-2xl text-[14px] text-ink-2">
            Drafts, sent numbers, and the jobs waiting for a clean yes or no. No confetti. Just margin.
          </p>
        </div>
        <Button asChild>
          <Link href="/projects/new">New quote</Link>
        </Button>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Open</CardTitle></CardHeader>
          <CardContent className="font-display text-[32px] font-black text-ink">{quotes.length}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Being built</CardTitle></CardHeader>
          <CardContent className="font-display text-[32px] font-black text-warn">{quoting.total}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Sent</CardTitle></CardHeader>
          <CardContent className="font-display text-[32px] font-black text-ok">{quoted.total}</CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Open quotes</CardTitle>
        </CardHeader>
        <CardContent>
          {quotes.length === 0 ? (
            <EmptyState title="No quotes hanging around." description="Suspiciously tidy. Create the next job when sales wakes up." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quote</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quotes.map((project) => (
                  <TableRow key={project.id}>
                    <TableCell>
                      <div className="font-semibold text-ink">{project.name}</div>
                      <div className="font-mono text-[11px] text-muted">{project.projectNumber}</div>
                    </TableCell>
                    <TableCell>{project.client?.name ?? "No client"}</TableCell>
                    <TableCell className="font-mono text-[12px] text-ink-2">
                      {project.rentalStartDate ? format(new Date(project.rentalStartDate), "d MMM") : "TBC"}
                      {project.rentalEndDate ? ` → ${format(new Date(project.rentalEndDate), "d MMM")}` : ""}
                    </TableCell>
                    <TableCell>
                      <Badge status={project.status === "QUOTED" ? "ok" : "warn"}>
                        {project.status === "QUOTED" ? "Sent" : "Draft"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/quotes/${project.id}`}>Build <ArrowRight className="h-4 w-4" /></Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
