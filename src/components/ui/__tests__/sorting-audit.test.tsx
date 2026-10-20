// @vitest-environment jsdom
import React from 'react';
import {render,screen,cleanup} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,it,expect} from 'vitest';
import {DataTable} from '../data-table';
afterEach(cleanup);
it('F18 keyboard sorting announces direction on the column header',async()=>{
 function Fixture(){const [sort,setSort]=React.useState<{field:string;direction:'asc'|'desc'}>({field:'',direction:'asc'});return <DataTable sortField={sort.field} sortDirection={sort.direction} onSortChange={field=>setSort(prev=>({field,direction:prev.field===field&&prev.direction==='asc'?'desc':'asc'}))} data={[{id:'b',name:'Beta'},{id:'a',name:'Alpha'}]} columns={[{id:'name',header:'Name',accessorKey:'name',sortable:true}]}/>;}
 const user=userEvent.setup();render(<Fixture/>);
 const sort=screen.getAllByRole('button',{name:'Name'})[0];sort.focus();await user.keyboard('{Enter}');
 expect(sort.closest('th')?.getAttribute('aria-sort')).toBe('ascending');expect(sort.className).toContain('focus-visible:ring-red');
 const next=screen.getAllByRole('button',{name:'Name'})[0];next.focus();await user.keyboard(' ');expect(screen.getByRole('columnheader',{name:'Name'}).getAttribute('aria-sort')).toBe('descending');
});
