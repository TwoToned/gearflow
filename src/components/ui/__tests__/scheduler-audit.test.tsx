// @vitest-environment jsdom
import React from 'react';
import {render,screen,fireEvent} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {CrewScheduler} from '../crew-scheduler';
it('F14 agenda and full assignment targets retain overlapping and short calls',()=>{
 const click=vi.fn();const row={id:'synthetic',name:'Synthetic crew',shifts:[{id:'a',label:'Short',startHour:9,endHour:9.1},{id:'b',label:'Overlap',startHour:9,endHour:10}]};
 const {container}=render(<CrewScheduler rows={[row]} onShiftClick={click}/>);
 expect(container.querySelector('[data-scheduler-agenda]')).not.toBeNull();
 const marks=container.querySelectorAll('[aria-hidden="true"][title]');expect(marks.length).toBe(2);expect((marks[0] as HTMLElement).style.top).not.toBe((marks[1] as HTMLElement).style.top);
 const target=screen.getAllByRole('button',{name:/Synthetic crew:.*Short/})[0];fireEvent.click(target);expect(click).toHaveBeenCalledWith(row.shifts[0],row);
 expect(target.className).toContain('min-h-11');
});
