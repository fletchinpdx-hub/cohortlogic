/**
 * checkin-config.js
 * Settings view: period count, scoring categories, incident types.
 */

// ── Render Settings ────────────────────────────────────────────────────────
function renderSettings() {
  document.getElementById('period-count-input').value = CicoState.settings.period_count || 8;
  renderCategoriesList();
  renderIncidentTypesList();
}

// ── Period Count ───────────────────────────────────────────────────────────
async function savePeriodCount() {
  const val = parseInt(document.getElementById('period-count-input').value);
  if (!val || val < 1 || val > 20) {
    showToast('Please enter a number between 1 and 20.', 'error');
    return;
  }

  try {
    if (CicoState.settings.id) {
      const { error } = await SupabaseClient
        .from('cico_settings')
        .update({ period_count: val, updated_at: new Date().toISOString() })
        .eq('id', CicoState.settings.id);
      if (error) throw error;
    } else {
      const { data, error } = await SupabaseClient
        .from('cico_settings')
        .insert({ period_count: val })
        .select()
        .single();
      if (error) throw error;
      CicoState.settings = data;
    }
    CicoState.settings.period_count = val;
    showToast('Period count saved.', 'success');
  } catch (err) {
    console.error('Save period count error:', err);
    showToast('Failed to save.', 'error');
  }
}

// ── Categories ─────────────────────────────────────────────────────────────
function renderCategoriesList() {
  const list = document.getElementById('categories-list');
  if (!CicoState.categories.length) {
    list.innerHTML = '<p style="font-size:13px;color:var(--ci-text-3);">No categories yet.</p>';
    return;
  }
  list.innerHTML = CicoState.categories.map((cat, idx) => `
    <div class="config-row">
      <span class="config-row-name">${escHtml(cat.name)}</span>
      <span class="config-row-meta">Order ${cat.display_order}</span>
      <button class="config-row-delete" onclick="deleteCategory('${cat.id}')" title="Remove">✕</button>
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
      .insert({ name, display_order: maxOrder + 1 })
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
  if (!confirm(`Remove "${cat.name}"? This will hide it from future check-ins. Existing records are preserved.`)) return;

  try {
    const { error } = await SupabaseClient
      .from('cico_categories')
      .update({ active: false })
      .eq('id', id);
    if (error) throw error;
    CicoState.categories = CicoState.categories.filter(c => c.id !== id);
    renderCategoriesList();
    showToast(`"${cat.name}" removed.`, 'success');
  } catch (err) {
    console.error('Delete category error:', err);
    showToast('Failed to remove category.', 'error');
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
      <button class="config-row-delete" onclick="deleteIncidentType('${t.id}')" title="Remove">✕</button>
    </div>
  `).join('');
}

async function addIncidentType() {
  const abbr    = document.getElementById('new-incident-abbr').value.trim().toUpperCase();
  const desc    = document.getElementById('new-incident-desc').value.trim();
  const minutes = document.getElementById('new-incident-minutes').checked;

  if (!abbr)  { showToast('Enter an abbreviation.', 'error'); return; }
  if (!desc)  { showToast('Enter a description.', 'error'); return; }

  const maxOrder = CicoState.incidentTypes.reduce((m, t) => Math.max(m, t.display_order), 0);

  try {
    const { data, error } = await SupabaseClient
      .from('cico_incident_types')
      .insert({
        abbreviation:   abbr,
        description:    desc,
        tracks_minutes: minutes,
        display_order:  maxOrder + 1
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
  if (!confirm(`Remove "${t.abbreviation} — ${t.description}"? Existing incident records will be preserved.`)) return;

  try {
    const { error } = await SupabaseClient
      .from('cico_incident_types')
      .update({ active: false })
      .eq('id', id);
    if (error) throw error;
    CicoState.incidentTypes = CicoState.incidentTypes.filter(x => x.id !== id);
    renderIncidentTypesList();
    showToast(`"${t.abbreviation}" removed.`, 'success');
  } catch (err) {
    console.error('Delete incident type error:', err);
    showToast('Failed to remove.', 'error');
  }
}
