"use client";

import { cn } from "@/lib/utils";

interface SparklineProps {
  /** Array of numeric data points */
  data: number[];
  /** Width in px */
  width?: number;
  /** Height in px */
  height?: number;
  /** Stroke color (CSS class or color value) */
  color?: string;
  /** Show area fill below the line */
  fill?: boolean;
  className?: string;
}

export function Sparkline({
  data,
  width = 80,
  height = 24,
  color = "var(--primary)",
  fill = false,
  className,
}: SparklineProps) {
  if (!data || data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padding = 1;

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * (width - padding * 2) + padding;
    const y = height - padding - ((v - min) / range) * (height - padding * 2);
    return `${x},${y}`;
  });

  const linePath = `M${points.join(" L")}`;
  const areaPath = `${linePath} L${width - padding},${height} L${padding},${height} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("shrink-0", className)}
    >
      {fill && (
        <path
          d={areaPath}
          fill={color}
          opacity={0.1}
        />
      )}
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A thin horizontal progress/utilization bar */
interface UtilizationBarProps {
  /** 0–100 percentage */
  value: number;
  /** Bar color */
  color?: string;
  className?: string;
}

export function UtilizationBar({ value, color, className }: UtilizationBarProps) {
  const clampedValue = Math.min(100, Math.max(0, value));
  const barColor = color || (clampedValue > 80 ? "var(--destructive)" : clampedValue > 50 ? "var(--warning)" : "var(--primary)");

  return (
    <div className={cn("h-1.5 w-full rounded-full bg-bg-inset", className)}>
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${clampedValue}%`, backgroundColor: barColor }}
      />
    </div>
  );
}

/** Mini date range bar for showing rental periods inline */
interface DateRangeBarProps {
  /** Start date */
  start: Date;
  /** End date */
  end: Date;
  /** Reference range start (e.g., start of month) */
  rangeStart: Date;
  /** Reference range end (e.g., end of month) */
  rangeEnd: Date;
  color?: string;
  className?: string;
}

export function DateRangeBar({ start, end, rangeStart, rangeEnd, color = "var(--primary)", className }: DateRangeBarProps) {
  const totalMs = rangeEnd.getTime() - rangeStart.getTime();
  if (totalMs <= 0) return null;

  const leftPct = Math.max(0, ((start.getTime() - rangeStart.getTime()) / totalMs) * 100);
  const widthPct = Math.min(100 - leftPct, ((end.getTime() - start.getTime()) / totalMs) * 100);

  return (
    <div className={cn("relative h-1.5 w-full rounded-full bg-bg-inset", className)}>
      <div
        className="absolute h-full rounded-full"
        style={{
          left: `${leftPct}%`,
          width: `${Math.max(widthPct, 2)}%`,
          backgroundColor: color,
          opacity: 0.7,
        }}
      />
    </div>
  );
}
