function nodes(children) {
  return children.flat(Infinity).filter((child) => child != null && child !== false);
}

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'value') el.value = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  el.append(...nodes(children));
  return el;
}

export function fill(el, ...children) {
  el.replaceChildren(...nodes(children));
}

export function toast(message, kind = 'info') {
  const el = h('div', { class: `toast ${kind}`, role: 'status' }, message);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3000);
}

export async function attempt(task) {
  try {
    await task();
  } catch (err) {
    toast(err.message, 'error');
  }
}
