// ChatGPT Game Autoplay - the animated list facades drawn over the popup's two selects.
//
// The native <select> stays in the document on purpose: it holds the value popup.js reads and writes,
// and it is the only thing the markup contract knows about. A native dropdown list is painted by the
// browser itself and cannot be animated, so this file paints a button and a list of its own and mirrors
// every pick back into the select as a real `change` event.
(function () {
  'use strict';

  const SHELL = '.select';
  const open = [];

  function optionsOf(select) {
    return select && select.options ? Array.prototype.slice.call(select.options) : [];
  }

  function labelOf(select) {
    const current = select ? select.value : '';
    for (const option of optionsOf(select)) {
      if (option.value === current) return (option.textContent || '').trim();
    }
    return '';
  }

  function enhance(shell) {
    if (!shell || shell.dataset.enhanced === 'true') return null;
    const select = shell.querySelector('select');
    const face = shell.querySelector('.select-face');
    const label = shell.querySelector('.select-label');
    const menu = shell.querySelector('.select-menu');
    if (!select || !face || !label || !menu) return null;
    shell.dataset.enhanced = 'true';

    // The painted button replaces the native control as the click and keyboard target.
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    face.setAttribute('role', 'combobox');
    face.setAttribute('aria-expanded', 'false');

    // popup.js writes `select.value` directly (the stored config and the language switch both do), and
    // assigning to a native select fires no event that could repaint the button. Taking the property
    // over on the instance is what keeps the button honest through every one of those writes.
    const proto = Object.getPrototypeOf(select);
    const descriptor = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
    let value = select.value;
    Object.defineProperty(select, 'value', {
      configurable: true,
      get() {
        return value;
      },
      set(next) {
        if (descriptor && descriptor.set) descriptor.set.call(select, next);
        value = descriptor && descriptor.get ? descriptor.get.call(select) : next;
        render();
      }
    });

    let active = 0;

    function items() {
      return menu.children ? Array.prototype.slice.call(menu.children) : [];
    }

    function highlight(index) {
      const all = items();
      if (!all.length) return;
      active = ((index % all.length) + all.length) % all.length;
      all.forEach((item, at) => {
        if (at === active) item.dataset.active = 'true';
        else delete item.dataset.active;
      });
    }

    function build() {
      while (menu.firstChild) menu.removeChild(menu.firstChild);
      for (const option of optionsOf(select)) {
        const item = document.createElement('div');
        item.className = 'select-option';
        item.setAttribute('role', 'option');
        item.dataset.value = option.value;
        item.textContent = (option.textContent || '').trim();
        item.addEventListener('click', () => choose(option.value));
        menu.appendChild(item);
      }
    }

    function render() {
      label.textContent = labelOf(select);
      face.disabled = !!select.disabled;
      for (const item of items()) {
        const selected = item.dataset.value === value;
        item.setAttribute('aria-selected', selected ? 'true' : 'false');
      }
    }

    function isOpen() {
      return shell.dataset.open === 'true';
    }

    function show() {
      closeAll();
      shell.dataset.open = 'true';
      face.setAttribute('aria-expanded', 'true');
      open.push(control);
      const all = items();
      const at = all.findIndex((item) => item.dataset.value === value);
      highlight(at < 0 ? 0 : at);
    }

    function hide() {
      shell.dataset.open = 'false';
      face.setAttribute('aria-expanded', 'false');
      const at = open.indexOf(control);
      if (at !== -1) open.splice(at, 1);
    }

    function choose(next) {
      hide();
      select.value = next;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      if (typeof face.focus === 'function') face.focus();
    }

    const control = { shell, select, show, hide, render, build, contains: (node) => shell.contains(node) };

    face.addEventListener('click', () => (isOpen() ? hide() : show()));
    face.addEventListener('keydown', (event) => {
      const key = event.key;
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        event.preventDefault();
        if (!isOpen()) show();
        else highlight(active + (key === 'ArrowDown' ? 1 : -1));
      } else if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
        event.preventDefault();
        if (!isOpen()) show();
        else {
          const item = items()[active];
          if (item) choose(item.dataset.value);
        }
      } else if (key === 'Escape' && isOpen()) {
        event.preventDefault();
        hide();
      } else if (key === 'Tab') {
        hide();
      }
    });
    menu.addEventListener('mousedown', (event) => event.preventDefault());

    build();
    render();

    // Translations are written into the <option> elements after load, so the list and the button follow
    // the elements they are a picture of.
    if (typeof MutationObserver === 'function') {
      new MutationObserver(() => {
        build();
        render();
      }).observe(select, { childList: true, subtree: true, characterData: true });
    }
    return control;
  }

  function closeAll() {
    while (open.length) open.pop().hide();
  }

  function boot() {
    if (!document.querySelectorAll) return [];
    return Array.prototype.slice.call(document.querySelectorAll(SHELL)).map(enhance).filter(Boolean);
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('pointerdown', (event) => {
      for (const control of open.slice()) {
        if (!control.contains(event.target)) control.hide();
      }
    });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }

  if (typeof window !== 'undefined') window.SnakePopupUI = { enhance, boot, optionsOf, labelOf };
})();
