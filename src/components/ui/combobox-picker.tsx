"use client"

import * as React from "react"
import { Popover } from "@base-ui/react/popover"
import { cn } from "@/lib/utils"
import { ChevronDownIcon, PlusIcon, CheckIcon, XIcon } from "lucide-react"

interface ComboboxPickerOption {
  value: string
  label: string
  description?: string
  icon?: React.ReactNode
}

interface ComboboxPickerProps {
  value: string
  onChange: (value: string) => void
  options: ComboboxPickerOption[]
  placeholder?: string
  searchPlaceholder?: string
  onCreateNew?: () => void
  createNewLabel?: string
  emptyMessage?: string
  allowClear?: boolean
  className?: string
  disabled?: boolean
  /** When true, allows typing a new value that doesn't exist in options */
  creatable?: boolean
}

function ComboboxPicker({
  value,
  onChange,
  options,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  onCreateNew,
  createNewLabel = "Create new",
  emptyMessage = "No results found.",
  allowClear = false,
  className,
  disabled = false,
  creatable = false,
}: ComboboxPickerProps) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState("")
  const searchInputRef = React.useRef<HTMLInputElement>(null)

  const filtered = React.useMemo(() => {
    if (!search) return options
    const lower = search.toLowerCase()
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(lower) ||
        opt.description?.toLowerCase().includes(lower)
    )
  }, [options, search])

  const selectedOption = options.find((opt) => opt.value === value)
  // For creatable mode, show the raw value even if it's not in options
  const displayLabel = selectedOption?.label || (creatable && value ? value : null)

  function handleSelect(optionValue: string) {
    onChange(optionValue)
    setOpen(false)
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (nextOpen) {
      setSearch("")
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger
        disabled={disabled}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-1.5 rounded-md border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-placeholder:text-muted-foreground dark:bg-input/30 dark:hover:bg-input/50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
          className
        )}
        data-placeholder={!displayLabel ? "" : undefined}
      >
        <span className="flex flex-1 items-center gap-1.5 text-left line-clamp-1">
          {displayLabel || placeholder}
        </span>
        {allowClear && displayLabel ? (
          <span
            role="button"
            className="pointer-events-auto size-4 text-muted-foreground hover:text-foreground"
            onPointerDown={(e) => {
              e.stopPropagation()
              e.preventDefault()
              onChange("")
            }}
          >
            <XIcon className="size-4" />
          </span>
        ) : (
          <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />
        )}
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Positioner side="bottom" sideOffset={4} align="start" className="z-[100]">
          <Popover.Popup
            initialFocus={(interactionType) => {
              if (interactionType === "keyboard") {
                return searchInputRef.current ?? true
              }
              return searchInputRef.current ?? false
            }}
            className="relative isolate z-[100] w-(--anchor-width) min-w-56 origin-(--transform-origin) overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
          >
            <div className="p-2">
              <input
                ref={searchInputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                className="flex h-8 w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setOpen(false)
                  }
                  if (e.key === "Enter") {
                    e.preventDefault()
                    const trimmed = search.trim()
                    if (!trimmed) return
                    // If there's an exact match (case-insensitive), select it
                    const exactMatch = options.find(
                      (opt) => opt.label.toLowerCase() === trimmed.toLowerCase()
                    )
                    if (exactMatch) {
                      onChange(exactMatch.value)
                      setOpen(false)
                      return
                    }
                    // If creatable and no exact match, use the typed value
                    if (creatable) {
                      onChange(trimmed)
                      setOpen(false)
                      return
                    }
                    // If there's exactly one filtered result, select it
                    if (filtered.length === 1) {
                      onChange(filtered[0].value)
                      setOpen(false)
                    }
                  }
                }}
              />
            </div>

            <div className="max-h-60 overflow-y-auto scroll-py-1 p-1">
              {filtered.length === 0 ? (
                <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                  {emptyMessage}
                </div>
              ) : (
                filtered.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handleSelect(option.value)}
                    className={cn(
                      "relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1.5 pr-8 pl-2 text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground",
                      option.value === value &&
                        "bg-accent/50 text-accent-foreground"
                    )}
                  >
                    {option.icon && <span className="shrink-0">{option.icon}</span>}
                    <div className="flex flex-1 flex-col items-start">
                      <span>{option.label}</span>
                      {option.description && (
                        <span className="text-xs text-muted-foreground">
                          {option.description}
                        </span>
                      )}
                    </div>
                    {option.value === value && (
                      <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
                        <CheckIcon className="size-4" />
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>

            {creatable && search.trim() && !options.some((opt) => opt.label.toLowerCase() === search.trim().toLowerCase()) && (
              <>
                <div className="pointer-events-none -mx-0 my-0 h-px bg-border" />
                <div className="p-1">
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      onChange(search.trim())
                      setOpen(false)
                    }}
                    className="flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground"
                  >
                    <PlusIcon className="size-4" />
                    <span>Use &ldquo;{search.trim()}&rdquo;</span>
                  </button>
                </div>
              </>
            )}

            {onCreateNew && (
              <>
                <div className="pointer-events-none -mx-0 my-0 h-px bg-border" />
                <div className="p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false)
                      onCreateNew()
                    }}
                    className="flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground"
                  >
                    <PlusIcon className="size-4" />
                    <span>{createNewLabel}</span>
                  </button>
                </div>
              </>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

// ─── Multi-select variant ────────────────────────────────────────────────────

interface MultiComboboxPickerProps {
  values: string[]
  onChange: (values: string[]) => void
  options: ComboboxPickerOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  className?: string
  disabled?: boolean
}

function MultiComboboxPicker({
  values,
  onChange,
  options,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  emptyMessage = "No results found.",
  className,
  disabled = false,
}: MultiComboboxPickerProps) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState("")
  const searchInputRef = React.useRef<HTMLInputElement>(null)

  const filtered = React.useMemo(() => {
    if (!search) return options
    const lower = search.toLowerCase()
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(lower) ||
        opt.description?.toLowerCase().includes(lower)
    )
  }, [options, search])

  const selectedLabels = values
    .map((v) => options.find((o) => o.value === v)?.label)
    .filter(Boolean)

  function handleToggle(optionValue: string) {
    if (values.includes(optionValue)) {
      onChange(values.filter((v) => v !== optionValue))
    } else {
      onChange([...values, optionValue])
    }
  }

  function handleRemove(optionValue: string) {
    onChange(values.filter((v) => v !== optionValue))
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (nextOpen) {
      setSearch("")
    }
  }

  return (
    <div className="space-y-1.5">
      <Popover.Root open={open} onOpenChange={handleOpenChange}>
        <Popover.Trigger
          disabled={disabled}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-1.5 rounded-md border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-placeholder:text-muted-foreground dark:bg-input/30 dark:hover:bg-input/50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
            className
          )}
          data-placeholder={values.length === 0 ? "" : undefined}
        >
          <span className="flex flex-1 items-center gap-1.5 text-left line-clamp-1">
            {values.length === 0
              ? placeholder
              : `${values.length} selected`}
          </span>
          <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Positioner side="bottom" sideOffset={4} align="start" className="z-[100]">
            <Popover.Popup
              initialFocus={(interactionType) => {
                if (interactionType === "keyboard") {
                  return searchInputRef.current ?? true
                }
                return searchInputRef.current ?? false
              }}
              className="relative isolate z-[100] w-(--anchor-width) min-w-56 origin-(--transform-origin) overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
            >
              <div className="p-2">
                <input
                  ref={searchInputRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="flex h-8 w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setOpen(false)
                    }
                  }}
                />
              </div>

              <div className="max-h-60 overflow-y-auto scroll-py-1 p-1">
                {filtered.length === 0 ? (
                  <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                    {emptyMessage}
                  </div>
                ) : (
                  filtered.map((option) => {
                    const isSelected = values.includes(option.value)
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => handleToggle(option.value)}
                        className={cn(
                          "relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1.5 pr-8 pl-2 text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground",
                          isSelected && "bg-accent/50 text-accent-foreground"
                        )}
                      >
                        {option.icon && <span className="shrink-0">{option.icon}</span>}
                        <div className="flex flex-1 flex-col items-start">
                          <span>{option.label}</span>
                          {option.description && (
                            <span className="text-xs text-muted-foreground">
                              {option.description}
                            </span>
                          )}
                        </div>
                        {isSelected && (
                          <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
                            <CheckIcon className="size-4" />
                          </span>
                        )}
                      </button>
                    )
                  })
                )}
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>

      {selectedLabels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {values.map((v) => {
            const opt = options.find((o) => o.value === v)
            if (!opt) return null
            return (
              <span
                key={v}
                className="inline-flex items-center gap-1 rounded-md bg-accent/50 px-1.5 py-0.5 text-xs"
              >
                {opt.icon && <span className="shrink-0">{opt.icon}</span>}
                {opt.label}
                <button
                  type="button"
                  onClick={() => handleRemove(v)}
                  className="ml-0.5 text-muted-foreground hover:text-foreground"
                >
                  <XIcon className="size-3" />
                </button>
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

export { ComboboxPicker, MultiComboboxPicker }
export type { ComboboxPickerProps, ComboboxPickerOption, MultiComboboxPickerProps }
