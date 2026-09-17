'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {UniCloudRepository}=require('../../apps/tokenm-android/uniCloud-alipay/cloudfunctions/common/tokenm-core/repository-unicloud');
const {MemoryRepository}=require('../../apps/tokenm-android/uniCloud-alipay/cloudfunctions/common/tokenm-core/repository-memory');
const {COLLECTIONS}=require('../../apps/tokenm-android/uniCloud-alipay/cloudfunctions/common/tokenm-core/repository-contract');
test('cloud task history query excludes absent/null tombstones and issues one conditional update',async()=>{
  const op=(key,value)=>({kind:key,value,or(other){return op('or',[this,other]);},and(other){return op('and',[this,other]);}});
  const command=Object.fromEntries(['exists','eq','gt','lte','gte','lt'].map(key=>[key,value=>op(key,value)]));
  const calls=[];const database={command,collection(name){return {where(criteria){calls.push({name,criteria});return {async update(patch){calls.push(patch);return {updated:1200};},async count(){return {total:1200};}};}};}};
  const repo=new UniCloudRepository({database});const criteria=repo.taskHistoryCriteria('owner',{through:500});
  assert.equal(criteria.ownerId,'owner');assert.equal(criteria.createdAtMs.value,500);
  assert.equal(criteria.userDeletedAtMs.value[0].value,false);assert.equal(criteria.userDeletedAtMs.value[1].value,null);
  assert.equal(await repo.updateWhere(COLLECTIONS.tasks,criteria,{userDeletedAtMs:500}),1200);
  assert.equal(calls.length,2);
  assert.equal(await repo.countWhere(COLLECTIONS.tasks,criteria),1200);
});
test('legacy absent/null are visible; more than 500 tombstones never starve visible queries',async()=>{
  const repo=new MemoryRepository();for(let i=0;i<510;i++)await repo.insert(COLLECTIONS.tasks,{_id:String(i),ownerId:'owner',desktopId:'d',eventId:String(i),userDeletedAtMs:10});
  await repo.insert(COLLECTIONS.tasks,{_id:'absent',ownerId:'owner',desktopId:'d',eventId:'absent'});
  await repo.insert(COLLECTIONS.tasks,{_id:'null',ownerId:'owner',desktopId:'d',eventId:'null',userDeletedAtMs:null});
  assert.equal(await repo.countWhere(COLLECTIONS.tasks,repo.taskHistoryCriteria('owner')),2);
  assert.deepEqual((await repo.findMany(COLLECTIONS.tasks,repo.taskHistoryCriteria('owner'))).map(t=>t._id),['absent','null']);
});
