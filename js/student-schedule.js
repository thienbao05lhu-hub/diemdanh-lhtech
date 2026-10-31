(function () {
  'use strict';
  const api=window.Attendance,week=window.WeekSchedule;if(!api || !week)return;
  const panel=document.getElementById('student-schedule-panel'),date=document.getElementById('student-week'),button=document.getElementById('load-student-week'),status=document.getElementById('student-week-status'),container=document.getElementById('student-week-grid');
  let busy=false;date.value=week.weekStart(week.today());
  async function load(){
    if(busy)return;busy=true;button.disabled=true;
    try{
      const identity=await api.requireIdentity();if(!identity)return;
      panel.hidden=false;container.replaceChildren();api.setStatus(status,'Đang tải lịch tuần…');
      date.value=week.weekStart(date.value);
      const result=api.checkResult(await api.client.from('weekly_schedules').select('schedule,revision').eq('profile_id',identity.profile.id).eq('week_start',date.value).maybeSingle());
      document.getElementById('student-week-range').textContent=week.range(date.value);
      if(result.data){week.grid(container,result.data.schedule,true);api.setStatus(status,`Lịch đã được cập nhật ${result.data.revision} lần.`);}
      else api.setStatus(status,'Chưa được thiết lập lịch cho tuần này. Vui lòng liên hệ quản trị viên.');
    }catch(error){api.setStatus(status,api.message(error),true);}finally{busy=false;button.disabled=false;}
  }
  button.addEventListener('click',load);date.addEventListener('change',load);load();
})();
