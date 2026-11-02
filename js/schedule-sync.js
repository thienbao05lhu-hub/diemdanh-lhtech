// Điều khiển đồng bộ lịch; dùng phiên Admin và bảng lịch của dashboard hiện có.
(() => {
  'use strict';

  const button = document.getElementById('btnAutoSyncSchedule');
  if (!button) return;
  const panel = document.getElementById('scheduleSyncPanel');
  const status = document.getElementById('scheduleSyncStatus');
  const progress = document.getElementById('scheduleSyncProgress');
  const connection = document.getElementById('scheduleSyncConnection');
  const errorDetails = document.getElementById('scheduleSyncErrors');
  const errorList = document.getElementById('scheduleSyncErrorList');
  const endpoint = '/api/admin/sync-schedule';
  let authenticated = Boolean(window.AdminAuth?.isAuthenticated());
  let running = false;
  let starting = false;
  let finishing = false;
  let manualSaves = 0;
  let timer;
  let revision = 0;
  let observedJob = null;
  let handledJob = null;
  let previewJob = null;
  let retries = 0;

  function applicablePreview() {
    return previewJob?.canApply && previewJob.week.start === window.WeeklyScheduleUI?.selectedWeek();
  }

  function isBusy() {
    return running || starting || finishing;
  }

  function updateControls() {
    const busy = isBusy();
    const unsaved = unsavedScheduleUserIds.size > 0;
    button.disabled = !authenticated || busy || manualSaves > 0 || unsaved;
    button.setAttribute('aria-busy', String(busy));
    document.getElementById('scheduleEditor').disabled = busy || manualSaves > 0;
    document.getElementById('btnSaveAllSchedules').disabled = busy || manualSaves > 0;
    const weekInput = document.getElementById('scheduleWeekInput');
    if (weekInput) weekInput.disabled = busy || manualSaves > 0;
    document.getElementById('scheduleSyncUnsaved').classList.toggle('hidden', !unsaved);
    document.getElementById('scheduleSyncButtonText').textContent = starting
      ? 'Đang bắt đầu...' : busy ? 'Đang đồng bộ...' : applicablePreview() ? 'Áp dụng lịch đã xem' : 'Đồng bộ lịch tự động';
    document.getElementById('scheduleSyncIcon').className = busy
      ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-arrows-rotate';
  }

  function retry(message) {
    panel.classList.remove('hidden');
    connection.textContent = message;
    connection.classList.remove('hidden');
    clearTimeout(timer);
    if (authenticated) timer = setTimeout(refresh, 3000);
  }

  function formatDate(value) {
    return value.split('-').reverse().join('/');
  }

  async function showJob(job) {
    connection.classList.add('hidden');
    panel.classList.toggle('hidden', !job);
    running = job?.status === 'running';
    previewJob = job?.mode === 'preview' && job.canApply ? job : null;
    if (!job) {
      updateControls();
      return;
    }

    const week = `${formatDate(job.week.start)} – ${formatDate(job.week.end)}`;
    const counts = `${job.processed}/${job.total} sinh viên · ${job.success} ${job.mode === 'preview' ? 'đã xem trước' : 'đã áp dụng'} · ${job.failed} lỗi · ${job.skipped || 0} giữ nguyên`;
    if (running) {
      observedJob = job.id;
      status.textContent = `Đang đồng bộ tuần ${week}: ${job.total ? counts : 'đang lấy danh sách sinh viên...'}`;
    } else if (job.status === 'failed') {
      status.textContent = `${job.message || 'Lượt đồng bộ đã dừng.'} ${counts}`;
    } else {
      status.textContent = `${job.mode === 'preview' ? 'Chưa thay lịch. Xem chi tiết rồi bấm Áp dụng lịch đã xem.' : 'Đã hoàn tất.'} Tuần ${week}: ${counts}.`;
    }
    progress.max = Math.max(job.total, 1);
    if (running && !job.total) progress.removeAttribute('value');
    else progress.value = job.total ? job.processed : 1;

    errorList.replaceChildren();
    for (const error of job.errors || []) {
      const item = document.createElement('li');
      item.textContent = `${error.userId || '(thiếu MSSV)'}: ${error.message}`;
      errorList.appendChild(item);
    }
    for (const change of job.changes || []) {
      const item = document.createElement('li');
      const describe = value => ['t2','t3','t4','t5','t6','t7','cn'].map(day => `${day}: ${(value?.[day] || []).join(', ') || '—'}`).join('; ');
      item.textContent = `${change.userId} (${change.lessons} buổi học): Trước [${describe(change.before)}] → Lịch rảnh [${describe(change.after)}]`;
      errorList.appendChild(item);
    }
    const summary = errorDetails.querySelector?.('summary');
    if (summary) summary.textContent = job.mode === 'preview' ? 'Chi tiết lịch xem trước và các trường hợp giữ nguyên' : 'Chi tiết lỗi và các trường hợp giữ nguyên';
    errorDetails.classList.toggle('hidden', !(job.errors?.length || job.changes?.length));

    const resultKey = `${job.id}|${job.mode || 'apply'}`;
    if (!running && observedJob === job.id && handledJob !== resultKey) {
      handledJob = resultKey;
      finishing = true;
      updateControls();
      try {
        // Không làm mất bản chỉnh sửa tại tab khác đã có trước khi nhận tiến độ.
        if (job.mode !== 'preview' && unsavedScheduleUserIds.size === 0) {
          const loaded = await fetchScheduleList();
          if (!loaded) showToast.warning('Đồng bộ đã kết thúc nhưng chưa tải lại được bảng lịch. Vui lòng tải lại trang.');
        } else if (unsavedScheduleUserIds.size > 0) {
          showToast.warning('Có lịch chỉnh sửa chưa lưu trên trang này. Bảng lịch được giữ lại để bạn kiểm tra.');
        }
        await fetchTodayAttendance();
        if (job.status === 'failed') showToast.error(job.message || 'Lượt đồng bộ đã dừng. Có thể lấy bản xem trước mới.');
        else if (job.mode === 'preview') showToast.info?.('Đã lấy bản xem trước. Kiểm tra chi tiết trước khi áp dụng lịch.');
        else if (job.failed > 0) showToast.warning(`Đồng bộ xong: ${job.success} thành công, ${job.failed} lỗi. Xem chi tiết bên dưới nút đồng bộ.`);
        else showToast.success(`Đã đồng bộ lịch cho ${job.success} sinh viên.`);
      } finally {
        finishing = false;
      }
    }
    updateControls();
  }

  function checkAuth(response) {
    if (response.status !== 401 && response.status !== 403) return true;
    authenticated = false;
    revision += 1;
    clearTimeout(timer);
    updateControls();
    window.AdminAuth?.expire();
    showAdminOverlay();
    showToast.warning('Vui lòng đăng nhập Admin để đồng bộ lịch.');
    return false;
  }

  async function refresh() {
    clearTimeout(timer);
    if (!authenticated) return;
    const requestRevision = ++revision;
    try {
      const response = await fetch(endpoint, { headers: getAdminHeaders(), cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (requestRevision !== revision || !authenticated || !checkAuth(response)) return;
      const result = await response.json();
      if (requestRevision !== revision || !authenticated) return;
      if (!response.ok || !result.success) {
        running = false;
        starting = false;
        previewJob = null;
        panel.classList.remove('hidden');
        status.textContent = result.message || 'Chưa kết nối được worker đồng bộ LHU.';
        updateControls();
        return;
      }
      retries = 0;
      await showJob(result.data);
      if (authenticated && running) timer = setTimeout(refresh, 1500);
    } catch (error) {
      if (requestRevision !== revision || !authenticated) return;
      if (++retries <= 3) retry('Chưa lấy được trạng thái đồng bộ. Đang tự kết nối lại...');
      else { running = false; connection.textContent = 'Mất kết nối. Tải lại trang để kiểm tra lượt đồng bộ trước khi thử lại.'; updateControls(); }
    }
  }

  async function start() {
    if (!authenticated || isBusy() || manualSaves > 0) return;
    if (unsavedScheduleUserIds.size > 0) {
      showToast.warning('Hãy lưu các thay đổi lịch trước khi đồng bộ tự động.');
      return;
    }
    starting = true;
    const applying = applicablePreview() ? previewJob : null;
    clearTimeout(timer);
    const requestRevision = ++revision;
    updateControls();
    try {
      if (applying && !await showConfirmDialog({title:'Áp dụng lịch LHU đã xem trước',
        message:`Áp dụng lịch tuần ${formatDate(applying.week.start)} – ${formatDate(applying.week.end)} cho tối đa ${Number(applying.success)} sinh viên? Lịch đã sửa sau khi xem trước sẽ được giữ nguyên.`,
        confirmText:'Áp dụng lịch',cancelText:'Hủy'})) return;
      if (requestRevision !== revision || !authenticated) return;
      const response = await fetch(endpoint, {
        method: 'POST', headers: getAdminHeaders(), signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ action: applying ? 'apply' : 'preview', jobId: applying?.id, week: window.WeeklyScheduleUI?.selectedWeek() }),
      });
      if (requestRevision !== revision || !authenticated || !checkAuth(response)) return;
      const result = await response.json();
      if (requestRevision !== revision || !authenticated) return;
      if (!response.ok || !result.success) {
        running = false;
        showToast.warning(result.message || 'Không thể bắt đầu đồng bộ.');
        await refresh();
        return;
      }
      if (!result.data) throw new Error('Chưa nhận được trạng thái đồng bộ.');
      observedJob = result.data.id;
      await showJob(result.data);
      if (running) timer = setTimeout(refresh, 1000);
    } catch (error) {
      if (requestRevision !== revision || !authenticated) return;
      // POST có thể đã được server nhận; đọc trạng thái trước khi cho chạy lại.
      running = true;
      retry('Chưa nhận được phản hồi. Đang kiểm tra lượt đồng bộ trên máy chủ...');
    } finally {
      starting = false;
      updateControls();
    }
  }

  window.ScheduleSyncUI = {
    start, isBusy, updateControls, isManualSaveActive: () => manualSaves > 0,
    beginManualSave() { manualSaves += 1; updateControls(); },
    endManualSave() { manualSaves = Math.max(0, manualSaves - 1); updateControls(); },
  };
  document.addEventListener('admin-auth-changed', event => {
    authenticated = event.detail.authenticated;
    revision += 1;
    clearTimeout(timer);
    previewJob = null;
    running = false;
    retries = 0;
    updateControls();
    if (authenticated) refresh();
  });
  updateControls();
  if (authenticated) refresh();
})();
