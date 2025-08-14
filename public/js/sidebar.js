// Robust sidebar initialization shared across pages
// Rebinds automatically if DOM changes.

function bindSidebar() {
  const sidebar = document.getElementById('sidebar');
  const toggleBtn = document.getElementById('sidebar-toggle');
  const overlay = document.getElementById('sidebar-overlay');
  if (!sidebar || !toggleBtn || !overlay) return false;
  if (toggleBtn.dataset.sbBound === '1') return true;
  toggleBtn.dataset.sbBound = '1';

  // Ensure button visible on init (in case another script hid it earlier)
  toggleBtn.classList.remove('hidden');

  const openSidebar = () => {
    sidebar.classList.add('transform');
    sidebar.classList.remove('-translate-x-full');
    overlay.classList.remove('hidden');
    document.body.classList.add('sidebar-open');
    toggleBtn.classList.add('hidden');
  };
  const closeSidebar = () => {
    sidebar.classList.add('-translate-x-full');
    overlay.classList.add('hidden');
    document.body.classList.remove('sidebar-open');
    toggleBtn.classList.remove('hidden');
  };
  toggleBtn.addEventListener('click', openSidebar);
  overlay.addEventListener('click', closeSidebar);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSidebar(); });
  window.addEventListener('resize', () => {
    if (window.innerWidth >= 768) {
      sidebar.classList.remove('-translate-x-full');
      overlay.classList.add('hidden');
      document.body.classList.remove('sidebar-open');
    } else if (!document.body.classList.contains('sidebar-open')) {
      sidebar.classList.add('-translate-x-full');
    }
  });
  return true;
}

function initSidebar() {
  if (!bindSidebar()) setTimeout(initSidebar, 150);
}

const observer = new MutationObserver(() => { bindSidebar(); });

document.addEventListener('DOMContentLoaded', () => {
  initSidebar();
  observer.observe(document.body, { childList: true, subtree: true });
});

export {};
