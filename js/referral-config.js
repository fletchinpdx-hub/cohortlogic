/**
 * referral-config.js
 * Settings view: manage the school-configurable dropdown lists that feed the
 * referral form (locations, behaviors, motivations, actions, others involved).
 */

// Find the REF_LISTS entry whose table matches, for state lookups.
function _listByTable(table) { return REF_LISTS.find(l => l.table === table); }
function _listByKey(key)     { return REF_LISTS.find(l => l.key === key); }

function renderRefSettings() {
  const container = document.getElementById('settings-container');
  container.innerHTML = REF_LISTS.map(l => {
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
}

// ── Add / edit modal ────────────────────────────────────────────────────────
function openCfgModal(table, id) {
  document.getElementById('cfg-edit-table').value = table;
  document.getElementById('cfg-edit-id').value = id || '';
  const list = _listByTable(table);
  if (id) {
    const item = (RefState[list.key] || []).find(i => i.id === id);
    document.getElementById('cfg-modal-title').textContent = `Edit ${list.title.replace(/s$/, '')}`;
    document.getElementById('cfg-label').value = item ? item.label : '';
  } else {
    document.getElementById('cfg-modal-title').textContent = `Add ${list.title.replace(/s$/, '')}`;
    document.getElementById('cfg-label').value = '';
  }
  document.getElementById('cfg-modal').classList.remove('hidden');
  document.getElementById('cfg-label').focus();
}

function closeCfgModal() {
  document.getElementById('cfg-modal').classList.add('hidden');
}

async function saveCfgItem() {
  const table = document.getElementById('cfg-edit-table').value;
  const id    = document.getElementById('cfg-edit-id').value;
  const label = document.getElementById('cfg-label').value.trim();
  if (!label) { refToast('Please enter a label.', 'error'); return; }

  const list = _listByTable(table);
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

// ── Event binding ───────────────────────────────────────────────────────────
function bindConfigEvents() {
  document.querySelector('#cfg-modal .cico-modal-backdrop').addEventListener('click', closeCfgModal);
  document.getElementById('cfg-modal-close').addEventListener('click', closeCfgModal);
  document.getElementById('cfg-modal-cancel').addEventListener('click', closeCfgModal);
  document.getElementById('cfg-modal-save').addEventListener('click', saveCfgItem);

  document.getElementById('settings-container').addEventListener('click', e => {
    const addBtn  = e.target.closest('[data-cfg-add]');
    const editBtn = e.target.closest('[data-cfg-edit]');
    const rmBtn   = e.target.closest('[data-cfg-deactivate]');
    if (addBtn)  openCfgModal(addBtn.getAttribute('data-cfg-add'));
    if (editBtn) openCfgModal(editBtn.getAttribute('data-cfg-table'), editBtn.getAttribute('data-cfg-edit'));
    if (rmBtn)   deactivateCfgItem(rmBtn.getAttribute('data-cfg-table'), rmBtn.getAttribute('data-cfg-deactivate'));
  });
}
