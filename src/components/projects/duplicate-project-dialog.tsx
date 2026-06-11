"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { duplicateProject, saveAsTemplate } from "@/server/projects";

interface DuplicateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceProject: {
    id: string;
    projectNumber: string;
    name: string;
  };
  mode: "duplicate" | "template";
}

export function DuplicateProjectDialog({
  open,
  onOpenChange,
  sourceProject,
  mode,
}: DuplicateProjectDialogProps) {
  const router = useRouter();
  const isTemplate = mode === "template";

  const [projectNumber, setProjectNumber] = useState(
    `${sourceProject.projectNumber}-COPY`
  );
  const [name, setName] = useState(
    isTemplate ? `${sourceProject.name} (Template)` : `${sourceProject.name} (Copy)`
  );

  const mutation = useMutation({
    mutationFn: () =>
      isTemplate
        ? saveAsTemplate(sourceProject.id, name)
        : duplicateProject(sourceProject.id, projectNumber, name),
    onSuccess: (result) => {
      toast.success(isTemplate ? "Template created" : "Project duplicated");
      onOpenChange(false);
      router.push(`/projects/${result.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isTemplate ? "Save as Template" : "Duplicate Project"}
          </DialogTitle>
          <DialogDescription>
            {isTemplate
              ? "Create a reusable template from this project. Dates and deployment status will not be copied."
              : "Create a copy of this project with all line items. Dates will be cleared and status set to Enquiry."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <div className="space-y-4 py-4">
            {!isTemplate && (
              <div className="space-y-2">
                <Label htmlFor="dup-number">Project Code *</Label>
                <Input
                  id="dup-number"
                  value={projectNumber}
                  onChange={(e) => setProjectNumber(e.target.value)}
                  required
                  className="font-mono"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="dup-name">Name *</Label>
              <Input
                id="dup-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {isTemplate ? "Create Template" : "Duplicate"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
