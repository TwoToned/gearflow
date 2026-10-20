// @vitest-environment jsdom
import React from 'react';
import {render,screen,fireEvent} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {LifecycleStepper} from '../stepper';
it('F11 whole steps announce stage and state and activate',()=>{
 const click=vi.fn();render(<LifecycleStepper steps={[{label:'Quote',state:'done'},{label:'Prep',state:'now'},{label:'Return',state:'future'}]} onStepClick={click}/>);
 expect(screen.getByRole('list',{name:'Project lifecycle'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Quote done'}));expect(click).toHaveBeenCalledWith(0);
 expect(screen.getByRole('button',{name:'Prep current stage'}).getAttribute('aria-current')).toBe('step');
 expect(screen.getByRole('button',{name:'Return not started'}).className).toContain('min-h-11');
});
