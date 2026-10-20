// @vitest-environment jsdom
import * as React from 'react';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {Button} from '../button';
afterEach(cleanup);
it.each(['disabled','loading'] as const)('F05 %s child blocks child and parent activation before handlers', state=>{
 const child=vi.fn(),parent=vi.fn(),capture=vi.fn();
 render(<Button asChild {...{[state]:true}} onClick={parent} onClickCapture={capture}><a href='/secret' onClick={child} onClickCapture={child} onKeyDown={child} onPointerDownCapture={child}>Deploy</a></Button>);
 const el=screen.getByText('Deploy');
 expect(el.getAttribute('aria-disabled')).toBe('true'); expect(el.tabIndex).toBe(-1);
 expect(fireEvent.click(el)).toBe(false); fireEvent.keyDown(el,{key:'Enter'}); fireEvent.pointerDown(el);
 expect(child).not.toHaveBeenCalled();expect(parent).not.toHaveBeenCalled();expect(capture).not.toHaveBeenCalled();
 expect(el.getAttribute('href')).toBeNull();
 if(state==='loading')expect(el.getAttribute('aria-busy')).toBe('true');
});
it('F05 enabled child keeps handler before parent and navigation',()=>{
 const calls:string[]=[];render(<Button asChild onClick={()=>calls.push('parent')}><a href='#ok' onClick={()=>calls.push('child')}>Continue</a></Button>);
 fireEvent.click(screen.getByText('Continue'));expect(calls).toEqual(['child','parent']);
});
it('F06 native loading preserves accessible label and blocks submission',()=>{
 render(<Button loading>Return equipment</Button>);
 const el=screen.getByRole('button',{name:'Return equipment'});
 expect((el as HTMLButtonElement).disabled).toBe(true);expect(el.getAttribute('aria-busy')).toBe('true');
 expect(el.querySelector('.invisible')).toBeNull(); expect(el.querySelector('.opacity-0')).not.toBeNull();
});
it('F05 loading asChild supports Next Link without a missing-href runtime error',async()=>{
 const {default:Link}=await import('next/link');
 render(<Button asChild loading><Link href='/protected'>Next destination</Link></Button>);
 const el=screen.getByText('Next destination');expect(el.getAttribute('aria-busy')).toBe('true');expect(fireEvent.click(el)).toBe(false);
});
it('F05 loading line links retain an appropriate decorative spinner tone',()=>{
 const {container}=render(<Button asChild variant='line' loading><a href='/next'>Next</a></Button>);
 expect(container.querySelector('[aria-hidden="true"]')?.className).toContain('text-ink');
});
it('F05 inactive native links retain their accessible role and loading name',()=>{
 render(<Button asChild loading><a href='/synthetic-warehouse'>Save scan</a></Button>);
 expect(screen.getByRole('link',{name:'Save scan'}).getAttribute('aria-busy')).toBe('true');
});
