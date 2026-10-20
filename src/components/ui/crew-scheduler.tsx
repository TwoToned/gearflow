"use client";
import * as React from "react";
import {cn} from "@/lib/utils";
import {layoutShifts,formatHour} from "@/lib/scheduler";
import {PersonAvatar,avatarHue,type AvatarHue} from "@/components/ui/avatar";

export interface SchedulerShift {
 id:string; label:string; startHour:number; endHour:number; color?:AvatarHue; isOpen?:boolean;
}
export interface SchedulerRow { id:string; name:string; src?:string; shifts:SchedulerShift[]; unavailable?:boolean }
export interface CrewSchedulerProps extends React.HTMLAttributes<HTMLDivElement> {
 rows:SchedulerRow[]; label?:string; startHour?:number; endHour?:number; hourWidth?:number;
 onShiftClick?:(shift:SchedulerShift,row:SchedulerRow)=>void;
 /** Consumer changes the selected date and rows together. */
 onDayChange?:(direction:-1|1)=>void;
}
const hueBg:Record<AvatarHue,string>={blue:'bg-blue',amber:'bg-amber',green:'bg-green',purple:'bg-purple',coral:'bg-coral',teal:'bg-teal',pink:'bg-pink',lime:'bg-lime'};
const onFill:Record<AvatarHue,string>={blue:'text-dark [.light_&]:text-primary-foreground',amber:'text-dark',green:'text-dark [.light_&]:text-primary-foreground',purple:'text-dark [.light_&]:text-primary-foreground',coral:'text-dark [.light_&]:text-primary-foreground',teal:'text-dark [.light_&]:text-primary-foreground',pink:'text-dark [.light_&]:text-primary-foreground',lime:'text-dark'};
const focus='focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-card';
function CrewScheduler({rows,label='Crew schedule',startHour=8,endHour=20,hourWidth=64,onShiftClick,onDayChange,className,...props}:CrewSchedulerProps) {
 const end=endHour<=startHour ? endHour+24 : endHour;
 const trackW=(end-startHour)*hourWidth;
 function detail(row:SchedulerRow,shift:SchedulerShift,clash:boolean,shiftEnd:number) {
  return `${row.name}: ${shift.label}, ${formatHour(shift.startHour)} to ${formatHour(shiftEnd)}${clash?', Clash. Review both assignments.':row.unavailable?', Unavailable. Review assignment.':''}${clash&&row.unavailable?', Unavailable':''}${shift.isOpen?', Open call':''}`;
 }
 return <section aria-label={label} className={cn('rounded-[var(--radius)] border-2 border-border bg-card text-ink',className)} {...props}>
  <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-3">
   <h3 className="font-display font-bold">{label}</h3>
   {onDayChange && <div className="flex gap-2"><button type="button" className={cn('min-h-11 rounded border-2 border-input px-3',focus)} onClick={()=>onDayChange(-1)} aria-label="Previous day">Previous</button><button type="button" className={cn('min-h-11 rounded border-2 border-input px-3',focus)} onClick={()=>onDayChange(1)} aria-label="Next day">Next</button></div>}
  </header>
  <div data-scheduler-agenda className="space-y-5 p-3 md:hidden">
   {rows.map(row=><section key={row.id} aria-label={row.name} className="space-y-2">
    <h4 className="break-words font-semibold">{row.name}</h4>
    {row.unavailable && <p className="text-t-out">Unavailable. Reassign any listed calls.</p>}
    {!row.shifts.length && <p className="text-muted">{row.unavailable?'No assignments':'Available, no assignments'}</p>}
    {layoutShifts(row.shifts).map(({shift,end:shiftEnd,clash})=><div key={shift.id} className="border-t border-line pt-2">
     {onShiftClick ? <button type="button" onClick={()=>onShiftClick(shift,row)} className={cn('min-h-11 w-full rounded p-2 text-left',focus)}>
      <span className="sr-only">{row.name}: </span>
      <span className="block break-words font-semibold">{shift.label}</span>{" "}<span className="block text-muted">{formatHour(shift.startHour)} to {formatHour(shiftEnd)}</span>
      {" "}{(clash||row.unavailable) && <span className="block text-t-out">{clash?'Clash. Review both assignments.':'Unavailable. Review assignment.'}</span>}{" "}{clash&&row.unavailable && <span className="block text-t-out">Unavailable. Review assignment.</span>}{" "}{shift.isOpen && <span className="block">Open call</span>}
     </button> : <p className="break-words py-2">{detail(row,shift,clash,shiftEnd)}</p>}
    </div>)}
   </section>)}
  </div>
  <div data-scheduler-timeline className="hidden overflow-x-auto md:block" role="region" aria-label="Crew timeline. Short calls also appear in the full assignment list." tabIndex={0}>
   <div style={{minWidth:`calc(12rem + ${trackW}px)`}}>
    <div className="flex border-b border-line"><div className="w-48 shrink-0 p-3 text-muted">Crew member</div><div className="relative h-11" style={{width:trackW}}>{Array.from({length:Math.ceil(end-startHour)},(_,i)=><span key={i} className="absolute top-3 text-xs text-muted" style={{left:i*hourWidth}}>{formatHour(startHour+i)}</span>)}</div></div>
    {rows.map(row=>{
     const shifts=layoutShifts(row.shifts), lanes=Math.max(1,...shifts.map(s=>s.lane+1));
     return <div key={row.id} className="flex border-b border-line last:border-0">
      <div className="sticky left-0 z-10 flex w-48 shrink-0 flex-col justify-center gap-2 border-r border-line bg-card p-3"><div className="flex items-center gap-2"><PersonAvatar name={row.name} src={row.src} className="size-7 shrink-0"/><span className="break-words text-sm">{row.name}</span></div>{row.unavailable&&<span className="text-t-out">Unavailable</span>}</div>
      <div className="relative" style={{width:trackW,minHeight:lanes*56}}>
       {shifts.map(({shift,start,end:shiftEnd,lane,clash})=>{
        const left=Math.max(start,startHour),right=Math.min(shiftEnd,end); if(right<=left)return null;
        const hue=shift.color??avatarHue(row.name), text=detail(row,shift,clash,shiftEnd);
        const cls=cn('absolute flex h-11 items-center overflow-hidden rounded border-2 px-2 text-xs font-semibold',focus,clash||row.unavailable?'border-t-out bg-out-soft text-t-out':shift.isOpen?'border-input border-dashed text-ink':cn('border-transparent',hueBg[hue],onFill[hue]));
        const style={left:(left-startHour)*hourWidth,top:lane*56+6,width:Math.max(1,(right-left)*hourWidth-4)};
        // A short bar is a visual mark. Its separate full-width assignment button below
        // provides an accurate target without overlapping adjacent calls.
        return <div key={shift.id} aria-hidden="true" title={text} className={cls} style={style}>{clash?'Clash: ':''}{shift.label}</div>;
       })}
      </div>
     </div>;
    })}
   </div>
  </div>
  <details className="hidden border-t border-line p-3 md:block"><summary className={cn('min-h-11 cursor-pointer py-3 font-semibold',focus)}>Full assignment list and clash details</summary>
   <ul className="space-y-2">{rows.flatMap(row=>layoutShifts(row.shifts).map(({shift,end:shiftEnd,clash})=><li key={`${row.id}-${shift.id}`}>{onShiftClick?<button type="button" className={cn('min-h-11 w-full rounded p-2 text-left',focus)} onClick={()=>onShiftClick(shift,row)}>{detail(row,shift,clash,shiftEnd)}</button>:<p>{detail(row,shift,clash,shiftEnd)}</p>}</li>))}</ul>
  </details>
 </section>;
}
export {CrewScheduler};
