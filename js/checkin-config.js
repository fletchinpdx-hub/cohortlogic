/**
 * checkin-config.js
 * Settings view: schedule profiles, scoring categories, incident types.
 */

const DEFAULT_CATEGORIES = ['Safe', 'Kind', 'Responsible'];

const DEFAULT_INCIDENT_TYPES = [
  { abbreviation: 'PD',    description: 'Property Destruction',                    tracks_minutes: true  },
  { abbreviation: 'RC',    description: 'Room Clear',                               tracks_minutes: true  },
  { abbreviation: 'OoA',   description: 'Running / out of area',                   tracks_minutes: true  },
  { abbreviation: 'AGG/A', description: 'Physical Aggression (towards Adult(s))',   tracks_minutes: true  },
  { abbreviation: 'AGG/S', description: 'Physical Aggression (towards Student(s))', tracks_minutes: true  },
  { abbreviation: 'PPI',   description: 'Protective Physical Int',                 tracks_minutes: true  },
  { abbreviation: 'LIT',   description: 'Lost Instructional Time (minutes)',        tracks_minutes: true  },
  { abbreviation: 'O',     description: 'Other',                                    tracks_minutes: false },
];

// ── Render Settings ────────────────────────────────────────────────────────
async function renderSettings() {
  renderSchedulesList();
  renderCategoriesList();
  renderIncidentTypesList();

  // Auto-populate defaults on first visit (empty state)
  if (!CicoState.categories.length)   await seedDefaultCategories();
  if (!CicoState.incidentTypes.length) await seedDefaultIncidentTypes();
}

// ── Schedule Profiles ──────────────────────────────────────────────────────
function renderSchedulesList() {
  const list = document.getElementById('schedules-list');
  if (!CicoState.schedules.length) {
    list.innerHTML = '<p style="font-size:13px;color:var(--ci-text-3);">No schedules yet. Add one below.</p>';
    return;
  }
  list.innerHTML = CicoState.schedules.map(s => `
    <div class="config-row">
      <span class="config-row-name">${escHtml(s.name)}</span>
      <span class="config-row-meta">${s.period_count} period${s.period_count !== 1 ? 's' : ''}</span>
      ${s.is_default
        ? '<span class="config-row-badge">Default</span>'
        : `<button class="config-row-action" data-act="setDefaultSchedule" data-id="${s.id}">Set default</button>`}
      <button class="config-row-delete" data-act="deleteSchedule" data-id="${s.id}" title="Remove">✕</button>
    </div>
  `).join('');
}

async function addSchedule() {
  const nameInput    = document.getElementById('new-schedule-name');
  const periodsInput = document.getElementById('new-schedule-periods');
  const name         = nameInput.value.trim();
  const period_count = parseInt(periodsInput.value);

  if (!name)                                { showToast('Enter a profile name.', 'error'); return; }
  if (!period_count || period_count < 1 || period_count > 20) {
    showToast('Enter a period count between 1 and 20.', 'error'); return;
  }

  // First schedule added becomes the default automatically
  const isFirst = CicoState.schedules.length === 0;

  try {
    const { data, error } = await SupabaseClient
      .from('cico_settings')
      .insert({ name, period_count, is_default: isFirst, school_id: CicoState.schoolId || null })
      .select()
      .single();
    if (error) throw error;

    CicoState.schedules.push(data);
    if (isFirst) CicoState.activeScheduleId = data.id;

    nameInput.value    = '';
    periodsInput.value = '';
    renderSchedulesList();
    populateEntryScheduleSelector();
    showToast(`"${name}" added.`, 'success');
  } catch (err) {
    console.error('Add schedule error:', err);
    showToast('Failed to add schedule.', 'error');
  }
}

async function setDefaultSchedule(id) {
  try {
    // Clear existing default
    const prev = CicoState.schedules.find(s => s.is_default);
    if (prev) {
      const { error } = await SupabaseClient
        .from('cico_settings').update({ is_default: false }).eq('id', prev.id);
      if (error) throw error;
      prev.is_default = false;
    }
    // Set new default
    const { error } = await SupabaseClient
      .from('cico_settings').update({ is_default: true }).eq('id', id);
    if (error) throw error;
    const sched = CicoState.schedules.find(s => s.id === id);
    if (sched) sched.is_default = true;

    renderSchedulesList();
    populateEntryScheduleSelector();
    showToast('Default schedule updated.', 'success');
  } catch (err) {
    console.error('Set default schedule error:', err);
    showToast('Failed to update default.', 'error');
  }
}

async function deleteSchedule(id) {
  const s = CicoState.schedules.find(x => x.id === id);
  if (!s) return;
  if (CicoState.schedules.length === 1) {
    showToast('You must have at least one schedule profile.', 'error'); return;
  }
  if (!confirm(`Remove schedule "${s.name}"?`)) return;

  try {
    const { error } = await SupabaseClient.from('cico_settings').delete().eq('id', id);
    if (error) throw error;
    CicoState.schedules = CicoState.schedules.filter(x => x.id !== id);

    // If deleted was active, fall back to default or first
    if (CicoState.activeScheduleId === id) {
      const fallback = CicoState.schedules.find(x => x.is_default) || CicoState.schedules[0];
      CicoState.activeScheduleId = fallback ? fallback.id : null;
    }
    // If deleted was default, promote first remaining
    if (s.is_default && CicoState.schedules.length) {
      await setDefaultSchedule(CicoState.schedules[0].id);
    }

    renderSchedulesList();
    populateEntryScheduleSelector();
    showToast(`"${s.name}" removed.`, 'success');
  } catch (err) {
    console.error('Delete schedule error:', err);
    showToast('Failed to remove schedule.', 'error');
  }
}

// ── Categories ─────────────────────────────────────────────────────────────
function renderCategoriesList() {
  const list = document.getElementById('categories-list');
  if (!CicoState.categories.length) {
    list.innerHTML = '<p style="font-size:13px;color:var(--ci-text-3);">No categories yet.</p>';
    return;
  }
  list.innerHTML = CicoState.categories.map(cat => `
    <div class="config-row">
      <span class="config-row-name">${escHtml(cat.name)}</span>
      <span class="config-row-meta">Order ${cat.display_order}</span>
      <button class="config-row-delete" data-act="deleteCategory" data-id="${cat.id}" title="Remove">✕</button>
    </div>
  `).join('');
}

async function addCategory() {
  const input = document.getElementById('new-category-name');
  const name  = input.value.trim();
  if (!name) { showToast('Enter a category name.', 'error'); return; }

  const maxOrder = CicoState.categories.reduce((m, c) => Math.max(m, c.display_order), 0);

  try {
    const { data, error } = await SupabaseClient
      .from('cico_categories')
      .insert({ name, display_order: maxOrder + 1, school_id: CicoState.schoolId || null })
      .select()
      .single();
    if (error) throw error;
    CicoState.categories.push(data);
    input.value = '';
    renderCategoriesList();
    showToast(`"${name}" added.`, 'success');
  } catch (err) {
    console.error('Add category error:', err);
    showToast('Failed to add category.', 'error');
  }
}

async function deleteCategory(id) {
  const cat = CicoState.categories.find(c => c.id === id);
  if (!cat) return;
  if (!confirm(`Remove "${cat.name}"? Existing records are preserved.`)) return;

  try {
    const { error } = await SupabaseClient
      .from('cico_categories').update({ active: false }).eq('id', id);
    if (error) throw error;
    CicoState.categories = CicoState.categories.filter(c => c.id !== id);
    renderCategoriesList();
    showToast(`"${cat.name}" removed.`, 'success');
  } catch (err) {
    console.error('Delete category error:', err);
    showToast('Failed to remove category.', 'error');
  }
}

async function seedDefaultCategories() {
  try {
    const rows = DEFAULT_CATEGORIES.map((name, i) => ({
      name,
      display_order: i + 1,
      school_id: CicoState.schoolId || null,
    }));
    const { data, error } = await SupabaseClient
      .from('cico_categories').insert(rows).select();
    if (error) throw error;
    CicoState.categories = data || [];
    renderCategoriesList();
  } catch (err) {
    console.error('Seed categories error:', err);
  }
}

// ── Incident Types ─────────────────────────────────────────────────────────
function renderIncidentTypesList() {
  const list = document.getElementById('incident-types-list');
  if (!CicoState.incidentTypes.length) {
    list.innerHTML = '<p style="font-size:13px;color:var(--ci-text-3);">No incident types yet.</p>';
    return;
  }
  list.innerHTML = CicoState.incidentTypes.map(t => `
    <div class="config-row">
      <span class="config-row-name">
        <strong>${escHtml(t.abbreviation)}</strong>
        <span style="font-weight:400;margin-left:6px;">${escHtml(t.description)}</span>
      </span>
      <span class="config-row-meta">${t.tracks_minutes ? '⏱ mins' : 'no mins'}</span>
      <button class="config-row-delete" data-act="deleteIncidentType" data-id="${t.id}" title="Remove">✕</button>
    </div>
  `).join('');
}

async function addIncidentType() {
  const abbr    = document.getElementById('new-incident-abbr').value.trim().toUpperCase();
  const desc    = document.getElementById('new-incident-desc').value.trim();
  const minutes = document.getElementById('new-incident-minutes').checked;

  if (!abbr) { showToast('Enter an abbreviation.', 'error'); return; }
  if (!desc) { showToast('Enter a description.', 'error'); return; }

  const maxOrder = CicoState.incidentTypes.reduce((m, t) => Math.max(m, t.display_order), 0);

  try {
    const { data, error } = await SupabaseClient
      .from('cico_incident_types')
      .insert({
        abbreviation:   abbr,
        description:    desc,
        tracks_minutes: minutes,
        display_order:  maxOrder + 1,
        school_id:      CicoState.schoolId || null,
      })
      .select()
      .single();
    if (error) throw error;
    CicoState.incidentTypes.push(data);
    document.getElementById('new-incident-abbr').value = '';
    document.getElementById('new-incident-desc').value = '';
    document.getElementById('new-incident-minutes').checked = true;
    renderIncidentTypesList();
    showToast(`"${abbr}" added.`, 'success');
  } catch (err) {
    console.error('Add incident type error:', err);
    showToast('Failed to add incident type.', 'error');
  }
}

async function deleteIncidentType(id) {
  const t = CicoState.incidentTypes.find(x => x.id === id);
  if (!t) return;
  if (!confirm(`Remove "${t.abbreviation} — ${t.description}"? Existing records will be preserved.`)) return;

  try {
    const { error } = await SupabaseClient
      .from('cico_incident_types').update({ active: false }).eq('id', id);
    if (error) throw error;
    CicoState.incidentTypes = CicoState.incidentTypes.filter(x => x.id !== id);
    renderIncidentTypesList();
    showToast(`"${t.abbreviation}" removed.`, 'success');
  } catch (err) {
    console.error('Delete incident type error:', err);
    showToast('Failed to remove.', 'error');
  }
}

async function seedDefaultIncidentTypes() {
  try {
    const rows = DEFAULT_INCIDENT_TYPES.map((t, i) => ({
      ...t,
      display_order: i + 1,
      school_id: CicoState.schoolId || null,
    }));
    const { data, error } = await SupabaseClient
      .from('cico_incident_types').insert(rows).select();
    if (error) throw error;
    CicoState.incidentTypes = data || [];
    renderIncidentTypesList();
  } catch (err) {
    console.error('Seed incident types error:', err);
  }
}
