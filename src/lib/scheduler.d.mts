interface TimedShift { id: string; startHour: number; endHour: number }
export function layoutShifts<T extends TimedShift>(shifts: T[]): {shift:T;start:number;end:number;lane:number;clash:boolean}[];
export function formatHour(hour:number):string;
export function canAssign(row:{unavailable?:boolean;shifts:TimedShift[]},shift:TimedShift):boolean;
