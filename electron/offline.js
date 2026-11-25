'use strict';

(() => {
  const bridge = window.edallDesktop;
  const list = document.getElementById('downloads');
  const status = document.getElementById('status');
  const video = document.getElementById('video');
  const audio = document.getElementById('audio');
  const nowPlaying = document.getElementById('nowPlaying');
  const refreshButton = document.getElementById('refresh');
  const backButton = document.getElementById('back');

  let selected = null;
  let separateAudio = false;

  const say = message => { status.textContent = String(message || ''); };
  const formatSize = value => {
    const bytes = Number(value) || 0;
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };
  const stopPlayback = () => {
    video.pause();
    audio.pause();
    video.removeAttribute('src');
    audio.removeAttribute('src');
    video.load();
    audio.load();
    separateAudio = false;
  };

  async function play(entry) {
    stopPlayback();
    selected = entry;
    nowPlaying.textContent = entry.title + ' — ' + entry.height + 'p';
    video.src = 'edmedia://offline-v/' + encodeURIComponent(entry.id);
    video.load();
    if (entry.hasSeparateAudio) {
      audio.src = 'edmedia://offline-a/' + encodeURIComponent(entry.id);
      audio.load();
      separateAudio = true;
    }
    say('يتم فتح الملف المشفّر والتحقق من سلامة أجزاء الفيديو...');
    video.play().then(() => say('يعمل الدرس من التخزين المشفّر على هذا الجهاز.'))
      .catch(() => say('اضغط تشغيل لبدء الدرس أو تحقق من سلامة الملف.'));
  }

  function render(items) {
    list.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'لا توجد تنزيلات محفوظة بعد. افتح درساً داخل البرنامج واختر «حفظ مشفّر دون اتصال».';
      list.appendChild(empty);
      return;
    }

    for (const entry of items) {
      const card = document.createElement('article');
      card.className = 'item';
      const title = document.createElement('h3');
      title.textContent = entry.title || 'درس محفوظ';
      const meta = document.createElement('div');
      meta.className = 'meta';
      const date = entry.createdAt ? new Date(entry.createdAt).toLocaleString() : '';
      meta.textContent = [
        String(entry.height || '') + 'p',
        formatSize(entry.sizeBytes),
        date,
        entry.hasSeparateAudio ? 'مسار صوت منفصل مشفّر' : 'صوت مدمج'
      ].filter(Boolean).join(' • ');

      const controls = document.createElement('div');
      controls.className = 'item-actions';
      const playButton = document.createElement('button');
      playButton.className = 'primary';
      playButton.textContent = 'تشغيل';
      playButton.addEventListener('click', () => play(entry).catch(error => say(error.message)));

      const deleteButton = document.createElement('button');
      deleteButton.className = 'danger';
      deleteButton.textContent = 'حذف';
      deleteButton.addEventListener('click', async () => {
        if (!confirm('حذف هذا الملف المشفّر نهائياً من هذا الجهاز؟')) return;
        deleteButton.disabled = true;
        try {
          await bridge.deleteOfflineDownload(entry.id);
          if (selected && selected.id === entry.id) {
            stopPlayback();
            selected = null;
            nowPlaying.textContent = 'اختر درساً محفوظاً لتشغيله';
          }
          await refresh();
          say('تم حذف التنزيل المشفّر.');
        } catch (error) {
          say(error && error.message ? error.message : 'تعذر حذف التنزيل.');
          deleteButton.disabled = false;
        }
      });

      controls.append(playButton, deleteButton);
      card.append(title, meta, controls);
      list.appendChild(card);
    }
  }

  async function refresh() {
    if (!bridge || typeof bridge.listOfflineDownloads !== 'function') {
      say('واجهة مكتبة التنزيلات غير متاحة في هذه الصفحة.');
      return;
    }
    refreshButton.disabled = true;
    try {
      const items = await bridge.listOfflineDownloads();
      render(Array.isArray(items) ? items : []);
      if (!items || !items.length) say('التنزيلات المشفّرة تظهر هنا بعد حفظها من مشغل الكمبيوتر.');
    } catch (error) {
      render([]);
      say(error && error.message ? error.message : 'تعذر قراءة مكتبة التنزيلات.');
    } finally {
      refreshButton.disabled = false;
    }
  }

  video.addEventListener('playing', () => {
    if (!separateAudio) return;
    audio.currentTime = video.currentTime;
    audio.playbackRate = video.playbackRate;
    audio.volume = video.volume;
    audio.muted = video.muted;
    audio.play().catch(() => {
      video.pause();
      say('تعذر تشغيل المسار الصوتي المشفّر.');
    });
  });
  video.addEventListener('pause', () => audio.pause());
  video.addEventListener('waiting', () => audio.pause());
  video.addEventListener('seeking', () => audio.pause());
  video.addEventListener('seeked', () => {
    if (!separateAudio || video.paused) return;
    audio.currentTime = video.currentTime;
    audio.play().catch(() => {});
  });
  video.addEventListener('timeupdate', () => {
    if (separateAudio && !audio.paused && Math.abs(audio.currentTime - video.currentTime) > 0.25) {
      audio.currentTime = video.currentTime;
    }
  });
  video.addEventListener('ratechange', () => { audio.playbackRate = video.playbackRate; });
  video.addEventListener('volumechange', () => { audio.volume = video.volume; audio.muted = video.muted; });
  video.addEventListener('ended', () => audio.pause());
  video.addEventListener('error', () => say('تعذر قراءة الملف المشفّر؛ قد يكون الملف ناقصاً أو تالفاً.'));
  audio.addEventListener('error', () => {
    if (separateAudio) {
      video.pause();
      say('تعذر التحقق من المسار الصوتي المشفّر.');
    }
  });

  refreshButton.addEventListener('click', refresh);
  backButton.addEventListener('click', async () => {
    backButton.disabled = true;
    try {
      await bridge.returnToPlatform();
    } catch (error) {
      say(error && error.message ? error.message : 'تعذر العودة إلى المنصة.');
      backButton.disabled = false;
    }
  });

  refresh();
})();
