// @vitest-environment jsdom
import React from 'react';
import {render,screen} from '@testing-library/react';
import {expect,it} from 'vitest';
import {SearchInput,Input} from '../input';
it('F20 search shares field states dimensions and native props',()=>{
 const ref=React.createRef<HTMLInputElement>();render(<><Input aria-label='Base'/><SearchInput ref={ref} aria-label='Search' disabled aria-invalid='true'/></>);
 const base=screen.getByLabelText('Base'),search=screen.getByLabelText('Search');expect(ref.current).toBe(search);expect(search.getAttribute('type')).toBe('search');
 for(const cls of base.className.split(' '))expect(search.className.split(' ')).toContain(cls);
 expect((search as HTMLInputElement).disabled).toBe(true);
});
