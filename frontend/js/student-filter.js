function applyCourseCodeFilter() {
  const input = document.getElementById('codeFilter');
  if (!input) return;
  const filter = (input.value || '').toLowerCase();
  const rows = document.querySelectorAll('#availTable tbody tr');
  rows.forEach(tr => {
    const codeCell = tr.children && tr.children[1];
    const code = codeCell ? String(codeCell.textContent || '').toLowerCase() : '';
    tr.style.display = (!filter || code.includes(filter)) ? '' : 'none';
  });
}

window.addEventListener('DOMContentLoaded', () => {
  const codeFilterEl = document.getElementById('codeFilter');
  if (codeFilterEl) {
    codeFilterEl.addEventListener('input', applyCourseCodeFilter);
  }
  const refreshBtn = document.getElementById('refreshAvail');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => setTimeout(applyCourseCodeFilter, 300));
  }
});

