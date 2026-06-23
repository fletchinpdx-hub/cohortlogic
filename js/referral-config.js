/**
 * referral-config.js
 * Settings view:
 *   • the school-configurable dropdown lists that feed the referral form
 *     (locations, behaviors, motivations, actions, others involved)
 *   • (reviewers only) default reviewer + custom fields management
 * The add/edit modal is generic: a hidden `cfg-edit-kind` switches between
 * 'list' | 'field' | 'option'.
 */

function _listByTable(table) { return REF_LISTS.find(l => l.table === table); }
function _listByKey(key)     { return REF_LISTS.find(l => l.key === key); }

function renderRefSettings() {
  const container = document.getElementById('settings-container');
  const lists = REF_LISTS.map(l => {
    const items = RefState[l.key] || [];
    const rows = items.length
      ? items.map(it => `
          <div class="cfg-item">
            <span class="cfg-item-label">${refEsc(it.label)}</span>
            <span class="cfg-item-actions">
              <button class="btn-cico btn-ghost-cico btn-sm-cico" data-cfg-edit="${it.id}" data-cfg-table="${l.table}">Edit</button>
              <button class="btn-cico btn-ghost-cico btn-sm-cico" data-cfg-deactivate="${it.id}" data-cfg-table="${l.table}">Remove</button>
            </span>
          </div>`).join('')
      : '<p class="empty-state" style="padding:12px;">No options yet.</p>';

    return `
      <div class="cfg-section">
        <div class="cfg-section-header">
          <h3>${refEsc(l.title)}</h3>
          <button class="btn-cico btn-outline-cico btn-sm-cico" data-cfg-add="${l.table}">+ Add</button>
        </div>
        <div class="cfg-list">${rows}</div>
      </div>`;
  }).join('');

  container.innerHTML = lists + renderAdminSettings();
}

// Reviewer-only sections: default reviewer + custom fields. Returns '' for
// non-reviewers (RLS would block these writes anyway).
function renderAdminSettings() {
  if (!RefState.isReviewer) return '';

  const staffOpts = (RefState.schoolStaff || []).map(s =>
    `<option value="${s.id}" ${RefState.settings && RefState.settings.default_reviewer_id === s.id ? 'selected' : ''}>${refEsc(s.full_name || s.email)}</option>`).join('');
  const reviewerSection = `
    <div class="cfg-section">
      <div class="cfg-section-header"><h3>Default Reviewer</h3></div>
      <p class="muted" style="margin:0 0 10px;font-size:13px;">Who “Send to reviewer” referrals are routed to.</p>
      <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;">
        <div class="field-group" style="min-width:240px;margin:0;">
          <select id="cfg-default-reviewer" class="cico-input cico-select">
            <option value="">— None —</option>${staffOpts}
          </select>
        </div>
        <button class="btn-cico btn-primary-cico btn-sm-cico" data-reviewer-save>Save</button>
      </div>
    </div>`;

  const fields = RefState.customFields || [];
  const fieldsHtml = fields.length ? fields.map(f => {
    const opts = (f.options || []).length
      ? f.options.map(o => `
          <div class="cfg-item">
            <span class="cfg-item-label">${refEsc(o.label)}</span>
            <span class="cfg-item-actions">
              <button class="btn-cico btn-ghost-cico btn-sm-cico" data-cf-edit-option="${o.id}" data-cf-field="${f.id}">Edit</button>
              <button class="btn-cico btn-ghost-cico btn-sm-cico" data-cf-remove-option="${o.id}">Remove</button>
            </span>
          </div>`).join('')
      : '<p class="empty-state" style="padding:8px;">No options yet.</p>';
    return `
      <div class="cfg-subfield">
        <div class="cfg-section-header">
          <h4 style="margin:0;font-size:14px;">${refEsc(f.label)}</h4>
          <span class="cfg-item-actions">
            <button class="btn-cico btn-ghost-cico btn-sm-cico" data-cf-edit-field="${f.id}">Rename</button>
            <button class="btn-cico btn-ghost-cico btn-sm-cico" data-cf-remove-field="${f.id}">Remove</button>
            <button class="btn-cico btn-outline-cico btn-sm-cico" data-cf-add-option="${f.id}">+ Option</button>
          </span>
        </div>
        <div class="cfg-list">${opts}</div>
      </div>`;
  }).join('') : '<p class="empty-state" style="padding:12px;">No custom fields yet.</p>';

  const customSection = `
    <div class="cfg-section">
      <div class="cfg-section-header">
        <h3>Custom Fields</h3>
        <button class="btn-cico btn-outline-cico btn-sm-cico" data-cf-add-field>+ Add Field</button>
      </div>
      <p class="muted" style="margin:0 0 10px;font-size:13px;">Extra dropdowns on the referral form (e.g. Parent Contact, Technology Violation).</p>
      ${fieldsHtml}
    </div>`;

  return reviewerSection + customSection;
}

// ── Generic add / edit modal ────────────────────────────────────────────────
function _showCfgModal() {
  document.getElementById('cfg-modal').classList.remove('hidden');
  document.getElementById('cfg-label').focus();
}

function openCfgModal(table, id) {
  document.getElementById('cfg-edit-kind').value  = 'list';
  document.getElementById('cfg-edit-table').value = table;
  document.getElementById('cfg-edit-field').value = '';
  document.getElementById('cfg-edit-id').value    = id || '';
  const list = _listByTable(table);
  if (id) {
    const item = (RefState[list.key] || []).find(i => i.id === id);
    document.getElementById('cfg-modal-title').textContent = `Edit ${list.title.replace(/s$/, '')}`;
    document.getElementById('cfg-label').value = item ? item.label : '';
  } else {
    document.getElementById('cfg-modal-title').textContent = `Add ${list.title.replace(/s$/, '')}`;
    document.getElementById('cfg-label').value = '';
  }
  _showCfgModal();
}

function openFieldModal(id) {
  document.getElementById('cfg-edit-kind').value  = 'field';
  document.getElementById('cfg-edit-table').value = 'referral_custom_fields';
  document.getElementById('cfg-edit-field').value = '';
  document.getElementById('cfg-edit-id').value    = id || '';
  const f = id ? (RefState.customFields || []).find(x => x.id === id) : null;
  document.getElementById('cfg-modal-title').textContent = id ? 'Rename Custom Field' : 'Add Custom Field';
  document.getElementById('cfg-label').value = f ? f.label : '';
  _showCfgModal();
}

function openOptionModal(fieldId, id) {
  document.getElementById('cfg-edit-kind').value  = 'option';
  document.getElementById('cfg-edit-table').value = 'referral_custom_field_options';
  document.getElementById('cfg-edit-field').value = fieldId;
  document.getElementById('cfg-edit-id').value    = id || '';
  let opt = null;
  if (id) {
    const f = (RefState.customFields || []).find(x => x.id === fieldId);
    opt = f && f.options.find(o => o.id === id);
  }
  document.getElementById('cfg-modal-title').textContent = id ? 'Edit Option' : 'Add Option';
  document.getElementById('cfg-label').value = opt ? opt.label : '';
  _showCfgModal();
}

function closeCfgModal() {
  document.getElementById('cfg-modal').classList.add('hidden');
}

async function saveCfgItem() {
  const kind  = document.getElementById('cfg-edit-kind').value || 'list';
  const label = document.getElementById('cfg-label').value.trim();
  if (!label) { refToast('Please enter a label.', 'error'); return; }
  if (kind === 'field')  return _saveCustomField(label);
  if (kind === 'option') return _saveCustomOption(label);

  // kind === 'list'
  const table = document.getElementById('cfg-edit-table').value;
  const id    = document.getElementById('cfg-edit-id').value;
  const list  = _listByTable(table);
  try {
    if (id) {
      const { error } = await SupabaseClient.from(table).update({ label }).eq('id', id);
      if (error) throw error;
      const item = (RefState[list.key] || []).find(i => i.id === id);
      if (item) item.label = label;
      refToast('Saved.', 'success');
    } else {
      const maxOrder = (RefState[list.key] || []).reduce((m, i) => Math.max(m, i.sort_order || 0), 0);
      const { data, error } = await SupabaseClient.from(table)
        .insert({ school_id: RefState.schoolId, label, sort_order: maxOrder + 1, active: true })
        .select().single();
      if (error) throw error;
      RefState[list.key].push(data);
      refToast('Added.', 'success');
    }
    closeCfgModal();
    renderRefSettings();
  } catch (err) {
    console.error('Save config item error:', err);
    refToast('Failed to save.', 'error');
  }
}

async function deactivateCfgItem(table, id) {
  const list = _listByTable(table);
  const item = (RefState[list.key] || []).find(i => i.id === id);
  if (!item) return;
  if (!confirm(`Remove “${item.label}” from the ${list.title} list?\n\nExisting referrals that used it are preserved.`)) return;
  try {
    const { error } = await SupabaseClient.from(table).update({ active: false }).eq('id', id);
    if (error) throw error;
    RefState[list.key] = RefState[list.key].filter(i => i.id !== id);
    renderRefSettings();
    refToast('Removed.', 'success');
  } catch (err) {
    console.error('Deactivate config item error:', err);
    refToast('Failed to remove.', 'error');
  }
}

// ── Custom fields ───────────────────────────────────────────────────────────
function _refreshCustomInputs() {
  if (typeof renderCustomFieldInputs === 'function') renderCustomFieldInputs();
}

async function _saveCustomField(label) {
  const id = document.getElementById('cfg-edit-id').value;
  try {
    if (id) {
      const { error } = await SupabaseClient.from('referral_custom_fields').update({ label }).eq('id', id);
      if (error) throw error;
      const f = (RefState.customFields || []).find(x => x.id === id);
      if (f) f.label = label;
    } else {
      const maxOrder = (RefState.customFields || []).reduce((m, f) => Math.max(m, f.sort_order || 0), 0);
      const { data, error } = await SupabaseClient.from('referral_custom_fields')
        .insert({ school_id: RefState.schoolId, label, sort_order: maxOrder + 1, active: true })
        .select().single();
      if (error) throw error;
      data.options = [];
      RefState.customFields.push(data);
    }
    closeCfgModal();
    renderRefSettings();
    _refreshCustomInputs();
    refToast('Saved.', 'success');
  } catch (err) {
    console.error('Save custom field error:', err);
    refToast('Failed to save.', 'error');
  }
}

async function _saveCustomOption(label) {
  const id      = document.getElementById('cfg-edit-id').value;
  const fieldId = document.getElementById('cfg-edit-field').value;
  const f = (RefState.customFields || []).find(x => x.id === fieldId);
  if (!f) return;
  try {
    if (id) {
      const { error } = await SupabaseClient.from('referral_custom_field_options').update({ label }).eq('id', id);
      if (error) throw error;
      const o = f.options.find(x => x.id === id);
      if (o) o.label = label;
    } else {
      const maxOrder = (f.options || []).reduce((m, o) => Math.max(m, o.sort_order || 0), 0);
      const { data, error } = await SupabaseClient.from('referral_custom_field_options')
        .insert({ school_id: RefState.schoolId, field_id: fieldId, label, sort_order: maxOrder + 1, active: true })
        .select().single();
      if (error) throw error;
      f.options.push(data);
    }
    closeCfgModal();
    renderRefSettings();
    _refreshCustomInputs();
    refToast('Saved.', 'success');
  } catch (err) {
    console.error('Save custom option error:', err);
    refToast('Failed to save.', 'error');
  }
}

async function removeCustomField(id) {
  const f = (RefState.customFields || []).find(x => x.id === id);
  if (!f) return;
  if (!confirm(`Remove custom field “${f.label}” and its options?\n\nExisting referrals keep their saved values.`)) return;
  try {
    const { error } = await SupabaseClient.from('referral_custom_fields').update({ active: false }).eq('id', id);
    if (error) throw error;
    RefState.customFields = RefState.customFields.filter(x => x.id !== id);
    renderRefSettings();
    _refreshCustomInputs();
    refToast('Removed.', 'success');
  } catch (err) {
    console.error('Remove custom field error:', err);
    refToast('Failed to remove.', 'error');
  }
}

async function removeCustomOption(id) {
  let field = null, opt = null;
  (RefState.customFields || []).forEach(f => {
    const o = (f.options || []).find(x => x.id === id);
    if (o) { field = f; opt = o; }
  });
  if (!opt) return;
  if (!confirm(`Remove option “${opt.label}”?`)) return;
  try {
    const { error } = await SupabaseClient.from('referral_custom_field_options').update({ active: false }).eq('id', id);
    if (error) throw error;
    field.options = field.options.filter(x => x.id !== id);
    renderRefSettings();
    _refreshCustomInputs();
    refToast('Removed.', 'success');
  } catch (err) {
    console.error('Remove custom option error:', err);
    refToast('Failed to remove.', 'error');
  }
}

// ── Default reviewer ─────────────────────────────────────────────────────────
async function saveDefaultReviewer() {
  const id = document.getElementById('cfg-default-reviewer').value || null;
  try {
    const { error } = await SupabaseClient.from('referral_settings')
      .upsert({ school_id: RefState.schoolId, default_reviewer_id: id, updated_at: new Date().toISOString() },
              { onConflict: 'school_id' });
    if (error) throw error;
    RefState.settings = { ...(RefState.settings || {}), default_reviewer_id: id };
    if (typeof updateReviewerHint === 'function') updateReviewerHint();
    refToast('Default reviewer saved.', 'success');
  } catch (err) {
    console.error('Save default reviewer error:', err);
    refToast('Failed to save reviewer.', 'error');
  }
}

// ── Event binding ───────────────────────────────────────────────────────────
function bindConfigEvents() {
  document.querySelector('#cfg-modal .cico-modal-backdrop').addEventListener('click', closeCfgModal);
  document.getElementById('cfg-modal-close').addEventListener('click', closeCfgModal);
  document.getElementById('cfg-modal-cancel').addEventListener('click', closeCfgModal);
  document.getElementById('cfg-modal-save').addEventListener('click', saveCfgItem);

  document.getElementById('settings-container').addEventListener('click', e => {
    const t = el => e.target.closest(el);
    // Standard lists
    const addBtn  = t('[data-cfg-add]');
    const editBtn = t('[data-cfg-edit]');
    const rmBtn   = t('[data-cfg-deactivate]');
    if (addBtn)  return openCfgModal(addBtn.getAttribute('data-cfg-add'));
    if (editBtn) return openCfgModal(editBtn.getAttribute('data-cfg-table'), editBtn.getAttribute('data-cfg-edit'));
    if (rmBtn)   return deactivateCfgItem(rmBtn.getAttribute('data-cfg-table'), rmBtn.getAttribute('data-cfg-deactivate'));

    // Custom fields
    if (t('[data-cf-add-field]'))    return openFieldModal();
    const ef = t('[data-cf-edit-field]');   if (ef) return openFieldModal(ef.getAttribute('data-cf-edit-field'));
    const rf = t('[data-cf-remove-field]'); if (rf) return removeCustomField(rf.getAttribute('data-cf-remove-field'));
    const ao = t('[data-cf-add-option]');   if (ao) return openOptionModal(ao.getAttribute('data-cf-add-option'));
    const eo = t('[data-cf-edit-option]');  if (eo) return openOptionModal(eo.getAttribute('data-cf-field'), eo.getAttribute('data-cf-edit-option'));
    const ro = t('[data-cf-remove-option]');if (ro) return removeCustomOption(ro.getAttribute('data-cf-remove-option'));

    // Default reviewer
    if (t('[data-reviewer-save]')) return saveDefaultReviewer();
  });
}
