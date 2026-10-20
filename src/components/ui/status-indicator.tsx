import * as React from 'react';
import { StatusIndicator as CanonicalStatusIndicator, type StatusIndicatorProps as CanonicalProps } from './canonical-status-indicator';
import { cn } from '@/lib/utils';
import { type StatusCategory, getStatusIntent, type ColorIntent, intentStyles } from '@/lib/status-colors';
export interface StatusIndicatorProps extends React.HTMLAttributes<HTMLSpanElement> {
    category?: StatusCategory;
    value?: string;
    intent?: ColorIntent | CanonicalProps['intent'];
    size?: CanonicalProps['size'];
    glow?: boolean;
    label?: string;
    variant?: 'dot' | 'pill';
}
const canonicalIntent: Record<ColorIntent, NonNullable<CanonicalProps['intent']>> = { success: 'ok', warning: 'warn', error: 'overbooked', info: 'neutral', primary: 'neutral', neutral: 'repair' };
/** Explicit product adapter: domain `primary` still means active red, not registry green live. */
function DomainStatusIndicator({ category, value, intent: direct, label, variant = 'dot', size, glow, className, ...props }: StatusIndicatorProps) {
    const intent = direct && direct in intentStyles ? direct as ColorIntent : category && value ? getStatusIntent(category, value) : 'neutral';
    const styles = intentStyles[intent];
    return <span {...props} className={cn('inline-flex items-center gap-1.5', variant === 'pill' && cn('rounded-full px-2 py-0.5 text-[11px] font-medium leading-none', styles.pill), className)}>
  <CanonicalStatusIndicator intent={canonicalIntent[intent]} size={size} glow={glow ?? variant === "dot"} aria-hidden='true' className={cn(intent === 'primary' && '[&_span]:!bg-red', intent === 'info' && '[&_span]:!bg-info')}/>
  <span className={cn(variant === 'dot' && 'text-[13px] font-medium', variant === 'dot' && styles.text)}>{label}</span>
 </span>;
}
/** Existing import remains source-compatible; canonical examples work unchanged. */
export function StatusIndicator(props: StatusIndicatorProps) {
    const domain = props.category || props.variant || !props.intent || ['neutral', 'success', 'warning', 'error', 'info', 'primary'].includes(props.intent);
    return domain ? <DomainStatusIndicator {...props}/> : <CanonicalStatusIndicator {...props as CanonicalProps}/>;
}

/** Direct canonical API, including canonical neutral semantics. */
export { CanonicalStatusIndicator };
