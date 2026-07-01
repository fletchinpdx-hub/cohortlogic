if (typeof trackSession === 'function') trackSession();

// Delegated handler for data-nav buttons rendered inside view innerHTML
const VIEW_RENDERERS = {
  school:   () => { navigateTo('school');   renderSchoolInfo(); },
  staff:    () => { navigateTo('staff');    renderStaff(); },
  blocks:   () => { navigateTo('blocks');   renderBlocks(); },
  master:   () => { navigateTo('master');   renderMasterSchedule(); },
  specials: () => { navigateTo('specials'); renderSpecialsPlaceholder(); },
  ia:       () => { navigateTo('ia');       renderIAPlaceholder(); },
  export:   () => { navigateTo('export');   renderExportPlaceholder(); },
};

document.getElementById('main').addEventListener('click', e => {
  const btn = e.target.closest('[data-nav]');
  if (btn && VIEW_RENDERERS[btn.dataset.nav]) VIEW_RENDERERS[btn.dataset.nav]();
});

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    const view = item.dataset.view;
    navigateTo(view);
    if (VIEW_RENDERERS[view]) VIEW_RENDERERS[view]();
  });
});

// ── Download button (always visible in sidebar) ───────────────────────────────
document.getElementById('download-sched-btn').addEventListener('click', () => {
  if (!SchedState.school.name) {
    alert('Nothing to download yet — fill in School Info first.');
    return;
  }
  downloadScheduleFile();
});

// ── Load file (hidden input triggered by sidebar link) ────────────────────────
const fileInput = document.getElementById('load-sched-file');
document.getElementById('load-sched-link').addEventListener('click', e => {
  e.preventDefault();
  fileInput.click();
});
fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;
  try {
    const result = await loadScheduleFromFile(file);
    updateSidebarStatus();
    updateDownloadBadge();
    navigateTo('school');
    renderSchoolInfo();
    if (result.crossProduct) {
      alert(`School profile imported from Class Builder file.\nSchool: ${result.schoolName || '(unnamed)'}\n\nFill in the rest of School Info to continue.`);
    }
  } catch (err) {
    alert(err.message);
  }
  fileInput.value = '';
});

// ── Import from Class Builder (.cohort) ───────────────────────────────────────
const cohortInput = document.getElementById('load-cohort-input');
document.getElementById('load-cohort-link').addEventListener('click', e => {
  e.preventDefault();
  cohortInput.click();
});
cohortInput.addEventListener('change', async () => {
  const file = cohortInput.files[0];
  if (!file) return;
  try {
    const result = await loadScheduleFromFile(file);
    updateSidebarStatus();
    updateDownloadBadge();
    navigateTo('school');
    renderSchoolInfo();
    if (result.crossProduct) {
      alert(`School profile imported!\nSchool: ${result.schoolName || '(unnamed)'}\n\nFill in School Info to set your schedule times, then continue to Staff Roster.`);
    }
  } catch (err) {
    alert(err.message);
  }
  cohortInput.value = '';
});

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  const { data: { session } } = await SupabaseClient.auth.getSession();
  if (!session) { window.location.replace('login.html'); return; }

  const { data: profile } = await SupabaseClient
    .from('profiles')
    .select('school_id, approved')
    .eq('id', session.user.id)
    .single();
  if (!profile?.approved) { window.location.replace('login.html'); return; }

  if (profile.school_id) {
    const { data: school } = await SupabaseClient
      .from('schools')
      .select('enabled_products')
      .eq('id', profile.school_id)
      .single();
    if (!school?.enabled_products?.includes('schedule_builder')) {
      window.location.replace('dashboard.html');
      return;
    }
  }

  document.body.style.visibility = '';

  const hasLocal = loadFromLocal();
  updateSidebarStatus();
  updateDownloadBadge();

  if (hasLocal && SchedState.school.name) {
    // Resume previous session
    navigateTo('school');
    renderSchoolInfo();
  } else {
    // No prior data — show landing screen
    renderLanding();
  }
}

function renderLanding() {
  navigateTo('school');
  document.getElementById('view-school').innerHTML = `
    <div class="landing-wrap">
      <div class="landing-card">
        <div class="landing-icon">📅</div>
        <h1 class="landing-title">Building Schedule Builder</h1>
        <p class="landing-sub">Create master instructional schedules for your school. Your data stays on your device — download a file to save and share it.</p>
        <div class="landing-actions">
          <button class="btn btn-primary btn-lg" id="landing-new-btn">Start a New Schedule</button>
          <div class="landing-divider">or</div>
          <label class="btn btn-outline btn-lg landing-load-label" for="load-sched-file">
            Load an Existing File
          </label>
        </div>
        <p class="landing-hint">Files are saved as <code>.clsched</code> — load one from your computer or school drive to continue where you left off.</p>
      </div>
    </div>
  `;
  document.getElementById('landing-new-btn').addEventListener('click', () => {
    renderSchoolInfo();
  });
}

boot();
