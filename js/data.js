/* Initial presentation state only. Member data is always loaded from the server. */
(function(){
  function day(offset=0){
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const get=t=>parts.find(p=>p.type===t).value;
    const d=new Date(`${get('year')}-${get('month')}-${get('day')}T12:00:00+09:00`);d.setUTCDate(d.getUTCDate()+offset);
    return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
  }
  const load=()=>({settings:{theme:'light',gauge:'water',capacity:15},bookings:[],posts:[]});
  window.SaiData={day,load};
})();
