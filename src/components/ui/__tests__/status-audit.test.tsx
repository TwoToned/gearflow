// @vitest-environment jsdom
import React from 'react';
import {render,screen,cleanup} from '@testing-library/react';
import {expect,it,afterEach} from 'vitest';
import {StatusIndicator} from '../status-indicator';
afterEach(cleanup);
it('F13 supports canonical live size glow and forwards span attributes',()=>{
 render(<StatusIndicator intent={'live' as never} size={'lg' as never} label='Live' data-testid='state' title='Connection'/>);
 const el=screen.getByTestId('state');expect(el.title).toBe('Connection');expect(el.innerHTML).toContain('size-2.5');expect(el.innerHTML).toContain('animate-pulse');
});
it('F13 keeps domain status and legacy pill contract',()=>{
 render(<StatusIndicator category='asset' value='CHECKED_OUT' label='Deployed' variant='pill' data-testid='state'/>);
 const el=screen.getByTestId('state');expect(el.className).toContain('rounded-full');expect(el.className).toContain('bg-primary');
});
it('F13 domain adapter preserves success and active red semantics',()=>{
 const {rerender}=render(<StatusIndicator category='asset' value='AVAILABLE' label='Ready' data-testid='state'/>);
 expect(screen.getByTestId('state').innerHTML).toContain('bg-ok');
 rerender(<StatusIndicator category='asset' value='CHECKED_OUT' label='Deployed' data-testid='state'/>);
 expect(screen.getByTestId('state').innerHTML).toContain('bg-red');
});
it('F13 domain glow opt-in is forwarded without suppressing the canonical shadow',()=>{
 const {container}=render(<StatusIndicator category='asset' value='AVAILABLE' label='Ready' glow/>);
 expect(container.innerHTML).not.toContain('!shadow-none');expect(container.innerHTML).toContain('ok-soft');
});
it('preserves legacy neutral and label-only repair rendering',()=>{
 const {rerender}=render(<StatusIndicator label='Idle' data-testid='state'/>);
 expect(screen.getByTestId('state').innerHTML).toContain('bg-rep');
 rerender(<StatusIndicator intent='neutral' label='Idle' data-testid='state'/>);
 expect(screen.getByTestId('state').innerHTML).toContain('bg-rep');
});
