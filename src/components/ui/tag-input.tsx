"use client"

import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"

/**
 * TagInput — chip input with autocomplete suggestions.
 *
 * The suggestion dropdown is a **Radix** Popover (anchored to the input box).
 * It used to be a hand-rolled `createPortal(..., document.body)` dropdown, which
 * broke inside Radix modal Dialogs (used in category-manager, equipment-add,
 * warehouse, etc.): a body-portaled element inherits the dialog's
 * `pointer-events: none` lock so suggestions were unclickable, and — being
 * outside the dialog's layer stack — a click on a suggestion registered as an
 * outside-click that closed the dialog. Radix Popover puts the dropdown in the
 * same DismissableLayer stack as the dialog, fixing both. Do NOT revert to a
 * raw body portal. See FEATUREDOCS/07.
 */

interface TagInputProps {
  value: string[]
  onChange: (tags: string[]) => void
  suggestions?: string[]
  placeholder?: string
  disabled?: boolean
  className?: string
}

function TagInput({
  value,
  onChange,
  suggestions,
  placeholder = "Add a tag...",
  disabled = false,
  className,
}: TagInputProps) {
  const [inputValue, setInputValue] = React.useState("")
  const [showSuggestions, setShowSuggestions] = React.useState(false)
  const [highlightedIndex, setHighlightedIndex] = React.useState(-1)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const filteredSuggestions = React.useMemo(() => {
    if (!suggestions || !inputValue.trim()) return []
    const search = inputValue.toLowerCase()
    return suggestions.filter(
      (s) =>
        s.toLowerCase().includes(search) &&
        !value.includes(s.toLowerCase())
    )
  }, [suggestions, inputValue, value])

  const addTag = React.useCallback(
    (tag: string) => {
      const normalized = tag.trim().toLowerCase()
      if (!normalized || value.includes(normalized)) return
      onChange([...value, normalized])
      setInputValue("")
      setShowSuggestions(false)
      setHighlightedIndex(-1)
    },
    [value, onChange]
  )

  const removeTag = React.useCallback(
    (tagToRemove: string) => {
      onChange(value.filter((t) => t !== tagToRemove))
    },
    [value, onChange]
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault()
      if (
        highlightedIndex >= 0 &&
        highlightedIndex < filteredSuggestions.length
      ) {
        addTag(filteredSuggestions[highlightedIndex])
      } else if (inputValue.trim()) {
        addTag(inputValue)
      }
    } else if (
      e.key === "Backspace" &&
      !inputValue &&
      value.length > 0
    ) {
      removeTag(value[value.length - 1])
    } else if (e.key === "ArrowDown") {
      e.preventDefault()
      if (filteredSuggestions.length > 0) {
        setHighlightedIndex((prev) =>
          prev < filteredSuggestions.length - 1 ? prev + 1 : 0
        )
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      if (filteredSuggestions.length > 0) {
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : filteredSuggestions.length - 1
        )
      }
    } else if (e.key === "Escape") {
      setShowSuggestions(false)
      setHighlightedIndex(-1)
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    if (val.includes(",")) {
      const parts = val.split(",")
      for (const part of parts.slice(0, -1)) {
        if (part.trim()) addTag(part)
      }
      setInputValue(parts[parts.length - 1])
    } else {
      setInputValue(val)
    }
    setShowSuggestions(true)
    setHighlightedIndex(-1)
  }

  const showDropdown = showSuggestions && filteredSuggestions.length > 0

  return (
    <PopoverPrimitive.Root
      open={showDropdown}
      onOpenChange={(o) => {
        if (!o) {
          setShowSuggestions(false)
          setHighlightedIndex(-1)
        }
      }}
    >
      <PopoverPrimitive.Anchor asChild>
        <div ref={containerRef} className={cn("relative", className)}>
          <div
            className={cn(
              "flex min-h-8 flex-wrap items-center gap-1 rounded-lg border border-input bg-transparent px-2 py-1 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
              disabled && "pointer-events-none opacity-50"
            )}
            onClick={() => inputRef.current?.focus()}
          >
            {value.map((tag) => (
              <Badge key={tag} status="neutral" className="gap-0.5">
                {tag}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeTag(tag)
                  }}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-fg-3/20"
                  disabled={disabled}
                  aria-label={`Remove ${tag}`}
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
            <Input
              ref={inputRef}
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onFocus={() => {
                if (inputValue.trim() && filteredSuggestions.length > 0) {
                  setShowSuggestions(true)
                }
              }}
              placeholder={value.length === 0 ? placeholder : ""}
              disabled={disabled}
              className="h-6 min-w-[80px] flex-1 border-0 px-0 py-0 shadow-none focus-visible:border-0 focus-visible:ring-0"
            />
          </div>
        </div>
      </PopoverPrimitive.Anchor>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          style={{ width: "var(--radix-popover-trigger-width)" }}
          className="z-50 max-h-48 overflow-auto rounded-lg border border-border bg-popover p-1 shadow-md"
          // Keep focus in the input — never steal it into the popup.
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          // Typing in the anchored input must not close the dropdown; genuine
          // outside interaction still closes it (Radix default).
          onFocusOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            if (containerRef.current?.contains(e.target as Node)) {
              e.preventDefault()
            }
          }}
          // Don't let a press inside the popup move focus off the input.
          onMouseDown={(e) => e.preventDefault()}
        >
          {filteredSuggestions.map((suggestion, index) => (
            <button
              key={suggestion}
              type="button"
              className={cn(
                "w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                index === highlightedIndex
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent hover:text-accent-foreground"
              )}
              onMouseDown={(e) => {
                e.preventDefault()
                addTag(suggestion)
              }}
            >
              {suggestion}
            </button>
          ))}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

export { TagInput }
export type { TagInputProps }
