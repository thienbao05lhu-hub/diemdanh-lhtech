(() => {
  'use strict';
  const input = document.getElementById('scheduleWeekInput');
  if (!input) return;
  const label = document.getElementById('scheduleWeekLabel');
  const notice = document.getElementById('scheduleWeekNotice');
  const DAYS = { t2: 'T2', t3: 'T3', t4: 'T4', t5: 'T5', t6: 'T6', t7: 'T7', cn: 'CN' };
  const SOURCES = { legacy: 'Lịch chuyển từ dữ liệu cũ', manual: 'Chỉnh thủ công', lhu: 'Đồng bộ LHU', rollback: 'Khôi phục lịch' };
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map(part => [part.type, part.value]));
  let selected = monday(`${parts.year}-${parts.month}-${parts.day}`);
  input.value = selected;

  function monday(value) {
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return null;
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    return date.toISOString().slice(0, 10);
  }

  function dateLabel(value) {
    return value.split('-').reverse().join('/');
  }

  function updateMetadata(metadata = {}, users = []) {
    const week = metadata.week || metadata;
    const start = week.start || selected;
    const end = new Date(`${start}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 6);
    if (label) label.textContent = `Tuần ${dateLabel(start)} – ${dateLabel(week.end || end.toISOString().slice(0, 10))}`;
    const missing = users.filter(user => user.scheduleWeek?.source === 'missing').length;
    if (notice) {
      notice.textContent = missing ? `${missing} sinh viên chưa có lịch tuần này. Đồng bộ LHU hoặc xếp lịch thủ công để cập nhật.` : 'Lịch chỉ áp dụng trong tuần đang chọn; lịch tuần khác được lưu riêng.';
      notice.classList.toggle('text-amber-300', missing > 0);
    }
  }

  input.addEventListener('change', async () => {
    if (window.ScheduleSyncUI?.isBusy() || unsavedScheduleUserIds.size > 0) {
      input.value = selected;
      showToast.warning('Hãy hoàn tất đồng bộ hoặc lưu thay đổi trước khi đổi tuần.');
      return;
    }
    const next = monday(input.value);
    if (!next) { input.value = selected; return; }
    selected = next;
    input.value = selected;
    updateMetadata();
    await fetchScheduleList();
  });

  async function openHistory(userId) {
    const existing = document.getElementById('weeklyScheduleHistoryDialog');
    if (existing) existing.remove();
    const dialog = document.createElement('dialog');
    dialog.id = 'weeklyScheduleHistoryDialog';
    dialog.className = 'w-[calc(100%-2rem)] max-w-2xl max-h-[85vh] p-5 rounded-2xl bg-slate-900 text-slate-100 border border-slate-700 shadow-2xl backdrop:bg-slate-950/80';
    const header = document.createElement('div');
    header.className = 'flex items-start justify-between gap-3 mb-4';
    const title = document.createElement('h2');
    title.className = 'text-sm font-bold';
    title.id = 'weeklyScheduleHistoryTitle';
    title.textContent = `Lịch sử lịch xưởng · ${userId}`;
    dialog.setAttribute('aria-labelledby', title.id);
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Đóng';
    close.className = 'px-3 py-2 rounded-lg bg-slate-800 text-xs';
    close.onclick = () => dialog.close();
    header.append(title, close);
    const content = document.createElement('div');
    content.className = 'space-y-3 overflow-y-auto max-h-[65vh] custom-scrollbar';
    content.textContent = 'Đang tải lịch sử...';
    dialog.append(header, content);
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove());
    dialog.showModal();

    try {
      const response = await fetch(`/api/schedule/history?userId=${encodeURIComponent(userId)}&week=${selected}`, { headers: getAdminHeaders(), cache: 'no-store' });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message || 'Không tải được lịch sử lịch tuần.');
      content.replaceChildren();
      const explanation = document.createElement('p');
      explanation.className = 'text-xs text-slate-400';
      explanation.textContent = `Tuần ${dateLabel(body.data.week.start)} – ${dateLabel(body.data.week.end)}. Hiển thị tối đa 50 phiên bản gần nhất.`;
      content.append(explanation);
      if (!body.data.revisions.length) {
        const empty = document.createElement('p');
        empty.textContent = 'Chưa có phiên bản lịch cho tuần này.';
        content.append(empty);
      }
      for (const revision of body.data.revisions) {
        const card = document.createElement('div');
        card.className = 'p-3 rounded-xl border border-slate-700 space-y-2 text-xs';
        const heading = document.createElement('p');
        heading.className = 'font-semibold text-teal-300';
        heading.textContent = `Phiên bản ${revision.revision} · ${SOURCES[revision.source] || revision.source} · ${new Date(revision.changedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`;
        const who = document.createElement('p');
        who.textContent = `Người cập nhật: ${revision.actorId || 'system'}${revision.reason ? ` · ${revision.reason}` : ''}`;
        const schedule = document.createElement('p');
        schedule.className = 'text-slate-400 leading-relaxed';
        schedule.textContent = Object.entries(DAYS).map(([day, name]) => `${name}: ${(revision.schedule[day] || []).join(', ') || '—'}`).join(' · ');
        const restore = document.createElement('button');
        restore.type = 'button';
        restore.className = 'px-3 py-2 rounded-lg bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed';
        const current = revision.revision === body.data.currentRevision;
        restore.textContent = current ? 'Đang áp dụng' : 'Khôi phục phiên bản này';
        restore.disabled = current || window.ScheduleSyncUI?.isBusy() || unsavedScheduleUserIds.size > 0;
        restore.onclick = async () => {
          if (window.ScheduleSyncUI?.isBusy() || unsavedScheduleUserIds.size > 0) return;
          restore.disabled = true;
          try {
            const response = await fetch('/api/schedule/rollback', { method: 'POST', headers: getAdminHeaders(),
              body: JSON.stringify({ userId, week: selected, revision: revision.revision, expectedRevision: body.data.currentRevision }) });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.message || 'Khôi phục thất bại.');
            showToast.success('Đã khôi phục lịch tuần.');
            dialog.close();
            await fetchScheduleList();
          } catch (error) {
            showToast.error(error.message);
            restore.disabled = false;
          }
        };
        card.append(heading, who, schedule, restore);
        content.append(card);
      }
    } catch (error) {
      content.textContent = error.message;
    }
  }

  window.WeeklyScheduleUI = { selectedWeek: () => selected, updateMetadata, openHistory,
    hasUnsavedChanges: () => unsavedScheduleUserIds.size > 0 };
  updateMetadata();
})();
