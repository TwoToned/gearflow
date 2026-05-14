"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarClock, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  getReportSchedule,
  updateReportSchedule,
} from "@/server/scheduled-reports";
import {
  DAYS_OF_WEEK,
  reportScheduleSchema,
  type ScheduleFrequency,
} from "@/lib/validations/report-schedule";

interface Props {
  reportId: string;
}

interface FormState {
  enabled: boolean;
  scheduleFrequency: ScheduleFrequency;
  scheduleHour: number;
  scheduleDayOfWeek: number;
  scheduleDayOfMonth: number;
  scheduleRecipients: string[];
  recipientDraft: string;
}

const DEFAULT_FORM: FormState = {
  enabled: false,
  scheduleFrequency: "DAILY",
  scheduleHour: 9,
  scheduleDayOfWeek: 1,
  scheduleDayOfMonth: 1,
  scheduleRecipients: [],
  recipientDraft: "",
};

const FREQ_LABELS: Record<ScheduleFrequency, string> = {
  DAILY: "Daily",
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
};

export function ReportScheduleCard({ reportId }: Props) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>({ ...DEFAULT_FORM });
  const [hydrated, setHydrated] = useState(false);

  const query = useQuery({
    queryKey: ["report-schedule", reportId],
    queryFn: () => getReportSchedule(reportId),
  });

  useEffect(() => {
    if (!query.data || hydrated) return;
    setForm({
      enabled: query.data.scheduleFrequency !== null,
      scheduleFrequency: query.data.scheduleFrequency ?? "DAILY",
      scheduleHour: query.data.scheduleHour ?? 9,
      scheduleDayOfWeek: query.data.scheduleDayOfWeek ?? 1,
      scheduleDayOfMonth: query.data.scheduleDayOfMonth ?? 1,
      scheduleRecipients: query.data.scheduleRecipients ?? [],
      recipientDraft: "",
    });
    setHydrated(true);
  }, [query.data, hydrated]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = form.enabled
        ? {
            scheduleFrequency: form.scheduleFrequency,
            scheduleHour: form.scheduleHour,
            scheduleDayOfWeek:
              form.scheduleFrequency === "WEEKLY" ? form.scheduleDayOfWeek : null,
            scheduleDayOfMonth:
              form.scheduleFrequency === "MONTHLY" ? form.scheduleDayOfMonth : null,
            scheduleRecipients: form.scheduleRecipients,
          }
        : {
            scheduleFrequency: null,
            scheduleHour: null,
            scheduleDayOfWeek: null,
            scheduleDayOfMonth: null,
            scheduleRecipients: [],
          };
      const parsed = reportScheduleSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message || "Invalid schedule");
      }
      await updateReportSchedule(reportId, parsed.data);
    },
    onSuccess: () => {
      toast.success(form.enabled ? "Schedule saved" : "Schedule cleared");
      queryClient.invalidateQueries({ queryKey: ["report-schedule", reportId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addRecipient = () => {
    const trimmed = form.recipientDraft.trim();
    if (!trimmed) return;
    if (form.scheduleRecipients.includes(trimmed)) {
      setForm((p) => ({ ...p, recipientDraft: "" }));
      return;
    }
    setForm((p) => ({
      ...p,
      scheduleRecipients: [...p.scheduleRecipients, trimmed],
      recipientDraft: "",
    }));
  };

  const removeRecipient = (email: string) => {
    setForm((p) => ({
      ...p,
      scheduleRecipients: p.scheduleRecipients.filter((e) => e !== email),
    }));
  };

  if (query.isLoading) {
    return (
      <div className="rounded-md border p-4 flex items-center gap-2 text-sm text-fg-3">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading schedule...
      </div>
    );
  }

  return (
    <section className="rounded-md border p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-fg-3" />
          <h3 className="text-sm font-semibold">Email schedule</h3>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="schedule-enabled" className="text-xs text-fg-3">
            Enabled
          </Label>
          <Switch
            id="schedule-enabled"
            checked={form.enabled}
            onCheckedChange={(checked) =>
              setForm((p) => ({ ...p, enabled: Boolean(checked) }))
            }
          />
        </div>
      </div>

      {form.enabled && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label className="text-xs">Frequency</Label>
              <Select
                value={form.scheduleFrequency}
                onValueChange={(v) =>
                  setForm((p) => ({ ...p, scheduleFrequency: v as ScheduleFrequency }))
                }
              >
                <SelectTrigger>
                  <SelectValue>
                    {FREQ_LABELS[form.scheduleFrequency]}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DAILY">Daily</SelectItem>
                  <SelectItem value="WEEKLY">Weekly</SelectItem>
                  <SelectItem value="MONTHLY">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Hour (UTC, 0-23)</Label>
              <Input
                type="number"
                min={0}
                max={23}
                value={form.scheduleHour}
                onChange={(e) =>
                  setForm((p) => ({ ...p, scheduleHour: Number(e.target.value) }))
                }
              />
            </div>

            {form.scheduleFrequency === "WEEKLY" && (
              <div className="space-y-2">
                <Label className="text-xs">Day of week</Label>
                <Select
                  value={String(form.scheduleDayOfWeek)}
                  onValueChange={(v) =>
                    setForm((p) => ({ ...p, scheduleDayOfWeek: Number(v) }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue>
                      {DAYS_OF_WEEK[form.scheduleDayOfWeek]}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {DAYS_OF_WEEK.map((d, i) => (
                      <SelectItem key={d} value={String(i)}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {form.scheduleFrequency === "MONTHLY" && (
              <div className="space-y-2">
                <Label className="text-xs">Day of month (1-28)</Label>
                <Input
                  type="number"
                  min={1}
                  max={28}
                  value={form.scheduleDayOfMonth}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      scheduleDayOfMonth: Number(e.target.value),
                    }))
                  }
                />
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Recipients</Label>
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="ops@example.com"
                value={form.recipientDraft}
                onChange={(e) =>
                  setForm((p) => ({ ...p, recipientDraft: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addRecipient();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addRecipient}>
                Add
              </Button>
            </div>
            {form.scheduleRecipients.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {form.scheduleRecipients.map((email) => (
                  <Badge key={email} variant="secondary" className="gap-1">
                    {email}
                    <button
                      type="button"
                      onClick={() => removeRecipient(email)}
                      className="hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {!form.enabled && (
        <p className="text-xs text-fg-3">
          Schedule emails of this report to one or more recipients. Reports are
          delivered as CSV attachments.
        </p>
      )}

      <div className="flex justify-end">
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...
            </>
          ) : (
            "Save schedule"
          )}
        </Button>
      </div>
    </section>
  );
}
