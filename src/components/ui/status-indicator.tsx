import * as React from 'react';
import { StatusIndicator as CanonicalStatusIndicator, type StatusIndicatorProps as CanonicalProps } from './canonical-status-indicator';
import { cn } from '@/lib/utils';
import { StatusWord } from './status-word';
import { type StatusCategory, getStatusIntent, type ColorIntent, intentStyles } from '@/lib/status-colors';
export interface StatusIndicatorProps extends React.HTMLAttributes<HTMLSpanElement> {
    category?: StatusCategory;
    value?: string;
    intent?: ColorIntent | CanonicalProps['intent'];
    size?: CanonicalProps['size'];
    glow?: boolean;
    label?: string;
    /** @deprecated 'pill' is superseded by `StatusWord` (D91: a dot + word, never a filled pill). R-4.4: remove once the last `variant="pill"` consumer has migrated (surface by surface, spec §11). */
    variant?: 'dot' | 'pill';
}
const canonicalIntent: Record<ColorIntent, NonNullable<CanonicalProps['intent']>> = { success: 'ok', warning: 'warn', error: 'overbooked', info: 'neutral', primary: 'neutral', neutral: 'repair' };
/** Explicit product adapter: domain `primary` still means active red, not registry green live. */
function DomainStatusIndicator({ category, value, intent: direct, label, variant = 'dot', size, glow, className, ...props }: StatusIndicatorProps) {
    const intent = direct && direct in intentStyles ? direct as ColorIntent : category && value ? getStatusIntent(category, value) : 'neutral';
    const styles = intentStyles[intent];
    // D91: the dot + word rendering is `StatusWord`; this adapter only resolves
    // the legacy (category, value) / intent props. A bare dot (no label) keeps
    // the canonical glow dot, since StatusWord is always dot AND word.
    if (variant === 'dot' && label && !size && glow === undefined) {
        return <StatusWord status={{ label, intent }} className={className} {...props}/>;
    }
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
