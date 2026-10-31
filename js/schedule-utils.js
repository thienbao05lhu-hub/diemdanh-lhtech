(function (root) {
  'use strict';
  const days = [{ key:'t2', label:'Thứ hai' },{ key:'t3', label:'Thứ ba' },{ key:'t4', label:'Thứ tư' },{ key:'t5', label:'Thứ năm' },{ key:'t6', label:'Thứ sáu' },{ key:'t7', label:'Thứ bảy' },{ key:'cn', label:'Chủ nhật' }];
  const shifts = ['Sáng','Chiều','Tối'];
  const empty = () => Object.fromEntries(days.map(day => [day.key, []]));
  function today() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(part=>[part.type,part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
  function parse(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) throw new Error('APP_INVALID_INPUT');
    const date = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value) throw new Error('APP_INVALID_INPUT');
    return date;
  }
  function weekStart(value) {
    const date = parse(value); date.setUTCDate(date.getUTCDate() - (date.getUTCDay()+6)%7);
    return date.toISOString().slice(0,10);
  }
  function shiftWeek(value, difference) { const date=parse(value); date.setUTCDate(date.getUTCDate()+difference*7); return date.toISOString().slice(0,10); }
  function range(value) {
    const first=parse(value), last=new Date(first); last.setUTCDate(last.getUTCDate()+6);
    const fmt = new Intl.DateTimeFormat('vi-VN',{timeZone:'UTC',dateStyle:'short'});
    return `${fmt.format(first)} – ${fmt.format(last)}`;
  }
  function grid(container, schedule = empty(), readOnly = false) {
    container.replaceChildren();
    const table=document.createElement('table'); table.className='schedule-grid';
    const caption=document.createElement('caption'); caption.className='sr-only'; caption.textContent='Các ca lên xưởng trong tuần'; table.append(caption);
    const head=document.createElement('thead'), header=document.createElement('tr');
    const first=document.createElement('th'); first.textContent='Ca'; first.scope='col'; header.append(first);
    days.forEach(day=>{const th=document.createElement('th'); th.scope='col'; th.textContent=day.label; header.append(th);});
    head.append(header); table.append(head); const body=document.createElement('tbody');
    shifts.forEach(shift=>{
      const tr=document.createElement('tr'), th=document.createElement('th'); th.scope='row'; th.textContent=shift; tr.append(th);
      days.forEach(day=>{
        const cell=document.createElement('td'), label=document.createElement('label'); label.className='shift-cell';
        const input=document.createElement('input'); input.type='checkbox'; input.dataset.day=day.key; input.dataset.shift=shift;
        input.setAttribute('aria-label', `${day.label}, ${shift}`); input.checked=Array.isArray(schedule?.[day.key]) && schedule[day.key].includes(shift); input.disabled=readOnly;
        label.append(input); cell.append(label); tr.append(cell);
      }); body.append(tr);
    }); table.append(body); container.append(table);
  }
  function read(container) {
    const schedule=empty(); container.querySelectorAll('input[type=checkbox]:checked').forEach(input=>schedule[input.dataset.day].push(input.dataset.shift));
    return schedule;
  }
  root.WeekSchedule = Object.freeze({days,shifts,empty,today,weekStart,shiftWeek,range,grid,read});
})(globalThis);
