import './projects/palindrome-glass/palindrome-glass.js';

document.addEventListener('DOMContentLoaded', () => {
  const cards = document.querySelectorAll('.b-card[data-project]');
  cards.forEach(card => {
    const id = card.getAttribute('data-project');
    const targets = document.querySelectorAll('.hover-item[data-project="' + id + '"]');
    if (!targets.length) return;

    card.addEventListener('mouseenter', () => {
      targets.forEach(t => t.classList.add('is-linked'));
    });

    card.addEventListener('mouseleave', () => {
      targets.forEach(t => t.classList.remove('is-linked'));
    });
  });
});
