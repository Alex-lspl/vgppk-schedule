'use strict';

const BASE = 'https://rasp.vgppk.ru/';

/**
 * Скачивает страницу с сайта колледжа и правильно декодирует кодировку
 * (старые сайты часто отдают windows-1251).
 */
async function fetchHtml(path) {
  const res = await fetch(BASE + path, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; vgppk-schedule/1.0)',
      Accept: 'text/html',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(9000),
  });

  if (!res.ok) {
    throw new Error(`Сайт колледжа ответил ${res.status} на ${path}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());

  let charset = /charset=([\w-]+)/i.exec(res.headers.get('content-type') || '')?.[1];
  if (!charset) {
    const head = buf.subarray(0, 2048).toString('latin1');
    charset = /charset=["']?([\w-]+)/i.exec(head)?.[1];
  }

  try {
    return new TextDecoder((charset || 'utf-8').toLowerCase()).decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}

module.exports = { fetchHtml, BASE };
