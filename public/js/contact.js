document.addEventListener('DOMContentLoaded', () => {
  // Pre-select product from URL param: contact.html?interest=schedule
  const params = new URLSearchParams(window.location.search);
  const interest = params.get('interest');
  if (interest === 'schedule') document.getElementById('p-schedule').checked = true;
  if (interest === 'checkin')  document.getElementById('p-checkin').checked  = true;

  document.getElementById('contact-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('contact-submit');
    const errEl = document.getElementById('contact-error');
    errEl.classList.remove('visible');

    const name  = document.getElementById('c-name').value.trim();
    const email = document.getElementById('c-email').value.trim();

    if (!name || !email) {
      errEl.textContent = 'Please fill in your name and email address.';
      errEl.classList.add('visible');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errEl.textContent = 'Please enter a valid email address.';
      errEl.classList.add('visible');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Sending…';

    const products = Array.from(document.querySelectorAll('.check-option:checked')).map(el => el.value);
    const enrollment = (document.querySelector('input[name="enrollment"]:checked') || {}).value || '';
    const payload = {
      name,
      email,
      role:       document.getElementById('c-role').value,
      school:     document.getElementById('c-school').value.trim(),
      enrollment,
      products:   products.join(', '),
      timing:     document.getElementById('c-timing').value,
      message:    document.getElementById('c-message').value.trim(),
      submitted:  new Date().toISOString(),
    };

    try {
      if (typeof SupabaseClient !== 'undefined') {
        await SupabaseClient.from('contact_submissions').insert([payload]);
      }
    } catch(_) { /* silent — form still shows success */ }

    document.getElementById('contact-form-wrap').classList.add('hidden');
    document.getElementById('contact-success').classList.remove('hidden');
  });
});
