/** Hours are local to the selected day. Use 24+ for next-day starts; an end before
 * its start crosses midnight. Adjacent assignments do not clash. */
/** @typedef {{id:string, startHour:number, endHour:number}} TimedShift */
/** @template {TimedShift} T
 * @param {T[]} shifts */
export function layoutShifts(shifts) {
 const ordered=shifts.map(shift=>({shift,start:shift.startHour,end:shift.endHour < shift.startHour ? shift.endHour+24 : shift.endHour,lane:0,clash:false}))
  .sort((a,b)=>a.start-b.start || a.end-b.end);
 /** @type {number[]} */
 const ends=[];
 for(const item of ordered) {
  let lane=ends.findIndex(end=>end<=item.start); if(lane<0) lane=ends.length;
  item.lane=lane; ends[lane]=item.end;
  item.clash=ordered.some(other=>other!==item && item.start<other.end && other.start<item.end);
 }
 return ordered;
}
/** @param {number} hour */
export function formatHour(hour) {
 const minutes=Math.round(hour*60), day=Math.floor(minutes/1440), h=Math.floor(minutes/60)%24, m=minutes%60;
 return `${h%12||12}${m ? ':'+String(m).padStart(2,'0') : ''}${h<12?'am':'pm'}${day ? ` (+${day} day)` : ''}`;
}
/** @param {{unavailable?:boolean, shifts:TimedShift[]}} row @param {TimedShift} shift */
export function canAssign(row,shift) {
 if(row.unavailable)return false;
 const target=layoutShifts([shift])[0];
 return !layoutShifts(row.shifts).some(other=>target.start<other.end&&other.start<target.end);
}
