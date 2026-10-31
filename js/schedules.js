(function () {
  'use strict';
  const api=window.Attendance, week=window.WeekSchedule;
  const status=document.getElementById('page-status'), content=document.getElementById('protected-content'), retry=document.getElementById('retry-page');
  if (!api || !week) { status.textContent='Không tải được hệ thống. Vui lòng tải lại trang.'; return; }
  const member=document.getElementById('schedule-member'), date=document.getElementById('schedule-week'), container=document.getElementById('schedule-grid');
  const reason=document.getElementById('schedule-reason'), history=document.getElementById('history-dialog'), historyStatus=document.getElementById('history-status');
  let current=null, baseline=week.empty(), busy=false, sequence=0;
  let historyRequest=0;
  api.bindLogout(status);
  const dirty=()=>!!current && (JSON.stringify(week.read(container))!==JSON.stringify(baseline) || !!reason.value.trim());
  function controls(value) {
    busy=value;
    for(const id of ['schedule-member','schedule-week','previous-week','next-week','save-schedule','discard-schedule','reload-schedule','schedule-history','schedule-reason','close-history']) document.getElementById(id).disabled=value;
    document.querySelectorAll('#schedule-grid input,#history-list button').forEach(input=>input.disabled=value);
    if(!value) document.getElementById('schedule-history').disabled=!current?.revision;
  }
  function render(row) {
    baseline=Object.fromEntries(week.days.map(day=>[day.key, [...(row?.schedule?.[day.key] || [])]]));
    current={profile_id:member.value,week_start:date.value,revision:row?.revision || 0};
    week.grid(container,baseline); reason.value='';
    document.getElementById('week-range').textContent=week.range(date.value);
    document.getElementById('schedule-revision').textContent=row ? `Phiên bản ${row.revision}` : 'Chưa thiết lập';
    document.getElementById('schedule-empty').hidden=!!row;
    document.getElementById('schedule-history').disabled=!row;
  }
  async function load() {
    if(busy) return;
    if(dirty()) { api.setStatus(status,'Bạn có thay đổi chưa lưu. Lưu lịch hoặc bấm Bỏ thay đổi trước khi tải lại.',true); return; }
    const version=++sequence; controls(true); retry.hidden=true; api.setStatus(status,'Đang tải lịch tuần…');
    try {
      const identity=await api.requireIdentity(api.adminRoles); if(!identity) return;
      document.getElementById('signed-in-name').textContent=`${identity.profile.displayName} (${identity.profile.studentId})`;
      if(!member.options.length) {
        for(let offset=0;;offset+=200) {
          const result=api.checkResult(await api.client.from('profiles').select('id,student_id,display_name').eq('active',true).order('student_id').range(offset,offset+199));
          (result.data || []).forEach(row=>{const option=document.createElement('option');option.value=row.id;option.textContent=`${row.student_id} — ${row.display_name}`;member.append(option);});
          if((result.data || []).length<200) break;
        }
      }
      if(!member.value) throw new Error('APP_PROFILE_NOT_FOUND');
      date.value=week.weekStart(date.value || week.today());
      const result=api.checkResult(await api.client.from('weekly_schedules').select('profile_id,week_start,schedule,revision,source').eq('profile_id',member.value).eq('week_start',date.value).maybeSingle());
      if(version!==sequence) return; render(result.data); content.hidden=false; api.setStatus(status);
    } catch(error) { api.setStatus(status,api.message(error),true); retry.hidden=false; }
    finally { controls(false); }
  }
  function selectionChanged() {
    if(dirty()) { member.value=current.profile_id; date.value=current.week_start; api.setStatus(status,'Bạn có thay đổi chưa lưu. Lưu lịch hoặc bấm Bỏ thay đổi trước khi đổi thành viên hoặc tuần.',true); return; }
    load();
  }
  member.addEventListener('change',selectionChanged); date.addEventListener('change',selectionChanged);
  for(const [id,direction] of [['previous-week',-1],['next-week',1]]) document.getElementById(id).addEventListener('click',()=>{
    if(busy) return;
    if(dirty()) { api.setStatus(status,'Bạn có thay đổi chưa lưu. Lưu lịch hoặc bấm Bỏ thay đổi trước khi đổi tuần.',true); return; }
    try { date.value=week.shiftWeek(date.value,direction); load(); } catch(error) { api.setStatus(status,api.message(error),true); }
  });
  document.getElementById('discard-schedule').addEventListener('click',()=>{if(!busy){week.grid(container,baseline);reason.value='';api.setStatus(status,'Đã bỏ các thay đổi chưa lưu.');}});
  document.getElementById('reload-schedule').addEventListener('click',load); retry.addEventListener('click',load);
  document.getElementById('schedule-form').addEventListener('submit',async event=>{
    event.preventDefault(); if(busy || !current || !event.currentTarget.reportValidity()) return;
    const note=reason.value.trim(); if(!note){api.setStatus(status,'Hãy nhập lý do thay đổi lịch.',true);reason.focus();return;}
    const snapshot={...current}, schedule=week.read(container); controls(true); api.setStatus(status,'Đang lưu lịch tuần…');
    try {
      const identity=await api.requireIdentity(api.adminRoles);if(!identity)return;
      const result=api.checkResult(await api.client.rpc('admin_save_week_schedule',{p_profile_id:snapshot.profile_id,p_week_start:snapshot.week_start,p_schedule:schedule,p_expected_revision:snapshot.revision,p_reason:note}));
      render(result.data);api.setStatus(status,'Đã lưu lịch tuần.');
    } catch(error){api.setStatus(status,api.message(error),true);} finally{controls(false);}
  });
  document.getElementById('schedule-history').addEventListener('click',async()=>{
    if(busy || !current?.revision) return;
    if(dirty()){api.setStatus(status,'Lưu lịch hoặc bấm Bỏ thay đổi trước khi mở lịch sử.',true);return;}
    const snapshot={...current}, request=++historyRequest;
    history.showModal();const list=document.getElementById('history-list');list.replaceChildren();document.getElementById('restore-reason').value='';api.setStatus(historyStatus,'Đang tải lịch sử…');
    try {
      const result=api.checkResult(await api.client.from('weekly_schedule_revisions').select('revision,reason,created_at,source').eq('profile_id',snapshot.profile_id).eq('week_start',snapshot.week_start).order('revision',{ascending:false}).limit(50));
      if(request!==historyRequest || !history.open || current.profile_id!==snapshot.profile_id || current.week_start!==snapshot.week_start)return;
      for(const row of result.data || []) {
        const item=document.createElement('article');item.className='history-item';const title=document.createElement('strong');title.textContent=`Phiên bản ${row.revision}`;
        const note=document.createElement('p');note.textContent=row.reason;const time=document.createElement('p');time.className='muted';time.textContent=new Intl.DateTimeFormat('vi-VN',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Ho_Chi_Minh'}).format(new Date(row.created_at));
        const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Khôi phục';button.setAttribute('aria-label',`Khôi phục phiên bản ${row.revision}`);
        button.addEventListener('click',()=>restore(row.revision,snapshot));item.append(title,time,note,button);list.append(item);
      }
      api.setStatus(historyStatus,result.data?.length ? '' : 'Chưa có lịch sử cho tuần này.');
    } catch(error){if(request===historyRequest && history.open)api.setStatus(historyStatus,api.message(error),true);}
  });
  async function restore(revision, origin) {
    if(busy || !current) return;const note=document.getElementById('restore-reason').value.trim();
    if(current.profile_id!==origin.profile_id || current.week_start!==origin.week_start || current.revision!==origin.revision){api.setStatus(historyStatus,api.message(new Error('APP_SCHEDULE_STALE')),true);return;}
    if(!note){api.setStatus(historyStatus,'Hãy nhập lý do khôi phục.',true);document.getElementById('restore-reason').focus();return;}
    const snapshot={...origin};controls(true);api.setStatus(historyStatus,'Đang khôi phục lịch…');
    try {
      const identity=await api.requireIdentity(api.adminRoles);if(!identity)return;
      const result=api.checkResult(await api.client.rpc('admin_rollback_week_schedule',{p_profile_id:snapshot.profile_id,p_week_start:snapshot.week_start,p_revision:revision,p_expected_revision:snapshot.revision,p_reason:note}));
      render(result.data);history.close();api.setStatus(status,'Đã khôi phục lịch thành một phiên bản mới.');
    } catch(error){api.setStatus(historyStatus,api.message(error),true);} finally{controls(false);}
  }
  document.getElementById('close-history').addEventListener('click',()=>{if(!busy)history.close();});history.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  history.addEventListener('close',()=>{historyRequest++;});
  date.value=week.weekStart(week.today());load();
})();
