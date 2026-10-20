import {expect,it} from 'vitest';
import {API_REGISTRY_BY_OPERATION} from './registry.generated';

it('published scan commit requires captured version while denying agents',()=>{
 const commit=API_REGISTRY_BY_OPERATION.get('scanIntake.commit')!;
 expect(commit).toBeTruthy();
 expect(commit.args).toContainEqual({name:'expectedVersionId',optional:false,type:'string'});
 expect(commit.args).toContainEqual({name:'effect',optional:false,type:'object'});
 for(const name of ['scanIntake.commit','scanIntake.verifyContext']){
  const op=API_REGISTRY_BY_OPERATION.get(name)!;
  expect(op.agentAccess).toBe('denied');expect(op.agentReachable).toBe(false);expect(op.deniedReason).toMatch(/browser user/);
 }
});
