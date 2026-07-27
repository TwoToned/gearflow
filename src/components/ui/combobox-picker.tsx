"use client"

import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"
import { cn } from "@/lib/utils"
import { ChevronDownIcon, PlusIcon, CheckIcon, XIcon } from "lucide-react"

/**
 * ComboboxPicker / MultiComboboxPicker — searchable single/multi selects with
 * optional "create new" affordance.
 *
 * IMPORTANT: built on **Radix** Popover (not Base UI). These pickers are used
 * inside Radix modal `Dialog`s all over the app (service form, add-asset,
 * sub-hire order, move-group, etc.). A Radix modal Dialog sets
 * `pointer-events: none` on `document.body` and only re-enables it on its own
 * DismissableLayer stack. A Base UI popover portals to `body` as a sibling and
 * therefore inherits that lock — every click inside it is swallowed ("can't
 * click crew/models/suppliers in the form"). Keeping this on Radix puts the
 * popup in the same layer stack as the dialog, so clicks work. Do NOT swap this
 * back to `@base-ui/react/popover`.
 */

interface ComboboxPickerOption {
  value: string
  label: string
  description?: string
  icon?: React.ReactNode
  /**
   * Right-aligned, NON-searchable badge (e.g. a `StatusIndicator` conflict
   * dot+label) — unlike `description`, this never participates in the
   * label/value/description text filter above. Use this slot for advisory
   * status hints; `description` stays the searchable metadata slot (WS8 #947).
   */
  badge?: React.ReactNode
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
  /**
   * Async/server-search mode. When provided, the picker STOPS filtering
   * `options` itself and instead reports the search term here on every
   * keystroke — the parent is expected to fetch already-filtered `options`
   * (e.g. a Convex `withSearchIndex` query). Absent = the default in-memory
   * JS filter (unchanged for every existing caller).
   */
  onSearchChange?: (query: string) => void
  /** Show a "Searching…" affordance while async results are in flight. */
  loading?: boolean
  /**
   * Fallback label for the selected `value` when it isn't present in the
   * currently-loaded `options` (unavoidable in async mode — the selected row
   * may not be in the latest search page). Keeps the trigger showing the
   * chosen item's name instead of a blank/raw id.
   */
  selectedLabel?: string
}

const POPUP_CLASS =
  "z-[100] w-[var(--radix-popover-trigger-width)] min-w-56 origin-[var(--radix-popover-content-transform-origin)] overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"

const TRIGGER_CLASS =
  "flex h-9 w-full items-center justify-between gap-1.5 rounded-md border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-fg-3 dark:bg-input/30 dark:hover:bg-input/50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"

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
  onSearchChange,
  loading = false,
  selectedLabel,
}: ComboboxPickerProps) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState("")
  const searchInputRef = React.useRef<HTMLInputElement>(null)

  // Async mode: parent supplies already-filtered options — never re-filter here
  // (double-filtering would hide server hits the parent already narrowed).
  const filtered = React.useMemo(() => {
    if (onSearchChange) return options
    if (!search) return options
    const lower = search.toLowerCase()
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(lower) ||
        opt.value.toLowerCase().includes(lower) ||
        opt.description?.toLowerCase().includes(lower)
    )
  }, [options, search, onSearchChange])

  // Async mode: report the search term to the parent so it can refetch.
  React.useEffect(() => {
    if (onSearchChange) onSearchChange(search)
  }, [search, onSearchChange])

  const selectedOption = options.find((opt) => opt.value === value)
  // For creatable mode, show the raw value even if it's not in options. In async
  // mode fall back to `selectedLabel` when the selected row isn't in this page.
  const displayLabel =
    selectedOption?.label ||
    (value ? selectedLabel : null) ||
    (creatable && value ? value : null)
  const showClear = allowClear && !!displayLabel

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
    <PopoverPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <div className="relative">
        <PopoverPrimitive.Trigger
          disabled={disabled}
          className={cn(TRIGGER_CLASS, showClear && "pr-8", className)}
          data-placeholder={!displayLabel ? "" : undefined}
        >
          <span className="flex flex-1 items-center gap-1.5 text-left line-clamp-1">
            {displayLabel || placeholder}
          </span>
          {!showClear && (
            <ChevronDownIcon className="pointer-events-none size-4 text-fg-3" />
          )}
        </PopoverPrimitive.Trigger>
        {/* Clear sits OUTSIDE the trigger button (sibling) to avoid invalid
            nested-button HTML and to stop the click from toggling the popover. */}
        {showClear && (
          <button
            type="button"
            aria-label="Clear selection"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation()
              onChange("")
            }}
            className="absolute right-2 top-1/2 z-10 -translate-y-1/2 text-fg-3 hover:text-fg disabled:pointer-events-none"
          >
            <XIcon className="size-4" />
          </button>
        )}
      </div>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="bottom"
          sideOffset={4}
          align="start"
          className={POPUP_CLASS}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            searchInputRef.current?.focus()
          }}
        >
          <div className="p-2">
            <input
              ref={searchInputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="flex h-8 w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none transition-colors placeholder:text-fg-3 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
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
              <div className="px-2 py-4 text-center text-sm text-fg-3">
                {loading ? "Searching…" : emptyMessage}
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
                      <span className="text-xs text-fg-3">
                        {option.description}
                      </span>
                    )}
                  </div>
                  {option.badge && <span className="shrink-0">{option.badge}</span>}
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
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
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
  /**
   * Render the selected-items chip row below the trigger. Defaults to true.
   * Set false when the caller already renders the selection elsewhere (e.g.
   * a table listing the same items) — showing both is duplicate information.
   */
  showSelectedTags?: boolean
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
  showSelectedTags = true,
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
        opt.value.toLowerCase().includes(lower) ||
        opt.description?.toLowerCase().includes(lower)
    )
  }, [options, search])

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
      <PopoverPrimitive.Root open={open} onOpenChange={handleOpenChange}>
        <PopoverPrimitive.Trigger
          disabled={disabled}
          className={cn(TRIGGER_CLASS, className)}
          data-placeholder={values.length === 0 ? "" : undefined}
        >
          <span className="flex flex-1 items-center gap-1.5 text-left line-clamp-1">
            {values.length === 0
              ? placeholder
              : `${values.length} selected`}
          </span>
          <ChevronDownIcon className="pointer-events-none size-4 text-fg-3" />
        </PopoverPrimitive.Trigger>

        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            side="bottom"
            sideOffset={4}
            align="start"
            className={POPUP_CLASS}
            onOpenAutoFocus={(e) => {
              e.preventDefault()
              searchInputRef.current?.focus()
            }}
          >
            <div className="p-2">
              <input
                ref={searchInputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                className="flex h-8 w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none transition-colors placeholder:text-fg-3 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setOpen(false)
                  }
                }}
              />
            </div>

            <div className="max-h-60 overflow-y-auto scroll-py-1 p-1">
              {filtered.length === 0 ? (
                <div className="px-2 py-4 text-center text-sm text-fg-3">
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
                          <span className="text-xs text-fg-3">
                            {option.description}
                          </span>
                        )}
                      </div>
                      {option.badge && <span className="shrink-0">{option.badge}</span>}
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
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>

      <SelectedTagsRow show={showSelectedTags} values={values} options={options} onRemove={handleRemove} />
    </div>
  )
}

/** The removable-chip row under a MultiComboboxPicker's trigger — split out so
 *  its `show`/empty-selection checks don't add branches to the (already large)
 *  MultiComboboxPicker function itself (R-3.6 complexity ratchet). */
function SelectedTagsRow({
  show,
  values,
  options,
  onRemove,
}: {
  show: boolean
  values: string[]
  options: ComboboxPickerOption[]
  onRemove: (value: string) => void
}) {
  if (!show) return null
  const selected = values
    .map((v) => ({ value: v, option: options.find((o) => o.value === v) }))
    .filter((entry): entry is { value: string; option: ComboboxPickerOption } => !!entry.option)
  if (selected.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1">
      {selected.map(({ value: v, option }) => (
        <span
          key={v}
          className="inline-flex items-center gap-1 rounded-md bg-accent/50 px-1.5 py-0.5 text-xs"
        >
          {option.icon && <span className="shrink-0">{option.icon}</span>}
          {option.label}
          <button
            type="button"
            onClick={() => onRemove(v)}
            className="ml-0.5 text-fg-3 hover:text-fg"
          >
            <XIcon className="size-3" />
          </button>
        </span>
      ))}
    </div>
  )
}

export { ComboboxPicker, MultiComboboxPicker }
export type { ComboboxPickerProps, ComboboxPickerOption, MultiComboboxPickerProps }
