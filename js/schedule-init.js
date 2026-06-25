if (typeof trackSession === 'function') trackSession();

// Delegated handler for data-nav buttons rendered inside view innerHTML
const VIEW_RENDERERS = {
  school: () => { navigateTo('school'); renderSchoolInfo(); },
  staff:  () => { navigateTo('staff');  renderStaff(); },
  blocks: () => { navigateTo('blocks'); renderBlocks(); },
  master: () => { navigateTo('master'); renderMasterSchedule(); },
  specials: () => { navigateTo('specials'); renderSpecialsPlaceholder(); },
  ia:     () => { navigateTo('ia');     renderIAPlaceholder(); },
  export: () => { navigateTo('export'); renderExportPlaceholder(); },
};

document.getElementById('main').addEventListener('click', e => {
  const btn = e.target.closest('[data-nav]');
  if (btn && VIEW_RENDERERS[btn.dataset.nav]) VIEW_RENDERERS[btn.dataset.nav]();
});

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    const view = item.dataset.view;
    navigateTo(view);
    if (view === 'school')   renderSchoolInfo();
    if (view === 'staff')    renderStaff();
    if (view === 'blocks')   renderBlocks();
    if (view === 'master')   renderMasterSchedule();
    if (view === 'specials') renderSpecialsPlaceholder();
    if (view === 'ia')       renderIAPlaceholder();
    if (view === 'export')   renderExportPlaceholder();
  });
});

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

  const savedId = localStorage.getItem('cl_schedule_id');
  if (savedId) {
    const result = await loadFromSupabase(savedId);
    if (!result.ok) loadFromLocal();
  } else {
    loadFromLocal();
  }
  updateSidebarStatus();
  renderSchoolInfo();
}

boot();
