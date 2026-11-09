(function(){
  'use strict';
  const config=window.SAI_CONFIG,listeners=new Set();let snapshot=null,status='loading',poll=null,clock=null,abort=null,generation=0,refreshing=false,active=false;
  const current=()=>({snapshot,status,refreshing,source:'server'});
  const emit=()=>listeners.forEach(fn=>fn(current()));
  async function refresh(){
    if(!active||refreshing)return;refreshing=true;emit();const version=generation;abort=new AbortController();
    try{const value=await SaiBackend.occupancy(abort.signal);if(version!==generation)return;if(!SaiLiquid.validSnapshot(value))throw new Error('Invalid occupancy');if(snapshot&&value.sequence===snapshot.sequence&&value.count===snapshot.count&&value.referenceCapacity===snapshot.referenceCapacity&&Date.parse(value.observedAt)>=Date.parse(snapshot.observedAt)){snapshot={...snapshot,observedAt:value.observedAt,checkedIn:value.checkedIn};}else{snapshot=SaiLiquid.acceptSnapshot(snapshot,value);}status=Date.now()-Date.parse(snapshot.observedAt)>config.staleAfterMs?'stale':'live';}
    catch{if(version===generation)status=snapshot?'stale':'error';}
    finally{if(version===generation){refreshing=false;emit();}}
  }
  function start(){stop();active=true;status='loading';snapshot=null;const version=++generation;emit();refresh();poll=setInterval(()=>{if(version===generation&&!document.hidden)refresh();},config.pollIntervalMs);clock=setInterval(()=>{if(snapshot&&Date.now()-Date.parse(snapshot.observedAt)>config.staleAfterMs&&status==='live'){status='stale';emit();}},5000);}
  function stop(){active=false;generation++;clearInterval(poll);clearInterval(clock);abort?.abort();refreshing=false;snapshot=null;status='loading';}
  window.addEventListener('offline',()=>{if(active){status='offline';emit();}});
  window.addEventListener('online',()=>{if(active)refresh();});
  document.addEventListener('visibilitychange',()=>{if(active&&!document.hidden)refresh();});
  window.SaiPresence={subscribe(fn){listeners.add(fn);fn(current());return()=>listeners.delete(fn);},current,start,stop,refresh};
})();
