/** Kisa sureli bildirim baloncuklari. */

let host = null;

function ensureHost() {
    if (host) return host;
    host = document.createElement('div');
    host.className = 'vm-toasts';
    document.body.appendChild(host);
    return host;
}

/**
 * @param {string} message
 * @param {'success'|'error'|'warn'|'info'} kind
 * @param {number} duration ms — 0 ise elle kapatilana kadar kalir.
 */
export function toast(message, kind = 'info', duration = 4000) {
    const el = document.createElement('div');
    el.className = `vm-toast vm-toast--${kind}`;
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');

    const text = document.createElement('span');
    text.className = 'vm-toast__text';
    text.textContent = message;
    el.appendChild(text);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'vm-toast__close';
    close.setAttribute('aria-label', 'Kapat');
    close.textContent = '×';
    close.addEventListener('click', () => dismiss(el));
    el.appendChild(close);

    ensureHost().appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-in'));

    if (duration > 0) setTimeout(() => dismiss(el), duration);
    return () => dismiss(el);
}

function dismiss(el) {
    if (!el.isConnected) return;
    el.classList.remove('is-in');
    setTimeout(() => el.remove(), 200);
}
