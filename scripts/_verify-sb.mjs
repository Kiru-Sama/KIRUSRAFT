// 沙箱管理三页验证（v0.0.87）：打开 → 列表页 → 详情页 → Files tab → 终端页
// 用法：node scripts/_verify-sb.mjs [cdpPort]
const CDP_PORT = process.argv[2] || '9222';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWs() {
  let lastErr = '';
  for (let i = 0; i < 20; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${CDP_PORT}/json`).then((r) => r.json());
      const page = (Array.isArray(list) ? list : []).find((t) => t.type === 'page');
      if (page) return page;
      lastErr = 'NO_PAGE_IN_LIST: ' + JSON.stringify(list).slice(0, 200);
    } catch (e) {
      lastErr = 'FETCH_ERR: ' + e.message;
    }
    await sleep(400);
  }
  throw new Error('NO_PAGE_TARGET (' + lastErr + ')');
}

async function evalJs(ws, expression) {
  const wsUrl = ws.webSocketDebuggerUrl;
  const sock = new WebSocket(wsUrl);
  await new Promise((res, rej) => { sock.onopen = res; sock.onerror = rej; });
  const result = await new Promise((res) => {
    const id = 1;
    sock.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === id) res(msg);
    };
    sock.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  sock.close();
  if (result.result?.exceptionDetails) {
    throw new Error('EXC: ' + JSON.stringify(result.result.exceptionDetails.exception?.description || result.result.exceptionDetails));
  }
  return result.result?.result?.value;
}

async function main() {
  const ws = await getWs();
  const steps = [];

  // 1. 打开沙箱管理（设置 → 沙箱管理）
  const opened = await evalJs(ws, `(async () => {
    const btn = document.querySelector('[data-ex="sandboxManage"]');
    if (!btn) return { err: 'no sandboxManage btn' };
    btn.click();
    await new Promise(r => setTimeout(r, 300));
    const manage = document.querySelector('.ex-sandbox-manage');
    return {
      shown: manage ? manage.classList.contains('show') : false,
      pageListHidden: (document.querySelector('[data-ex="sb-page-list"]') || {}).hidden,
      pageDetailHidden: (document.querySelector('[data-ex="sb-page-detail"]') || {}).hidden,
      pageTermHidden: (document.querySelector('[data-ex="sb-page-term"]') || {}).hidden,
    };
  })()`);
  steps.push(['打开沙箱管理', opened]);

  // 2. 列表页状态：wslist 内容
  const listState = await evalJs(ws, `(async () => {
    await new Promise(r => setTimeout(r, 400));
    const list = document.querySelector('[data-ex="sandbox-wslist"]');
    const items = list ? list.querySelectorAll('.ex-sandbox-ws-item').length : -1;
    const fab = !!document.querySelector('[data-ex="sb-add"]');
    const text = list ? list.textContent.slice(0, 120) : '';
    return { items, fab, text };
  })()`);
  steps.push(['列表页（工作区卡片数/FAB/内容）', listState]);

  // 3. 点第一个工作区卡片 → 详情页
  const detail = await evalJs(ws, `(async () => {
    const first = document.querySelector('.ex-sandbox-ws-item');
    if (!first) return { err: 'no ws item' };
    first.click();
    await new Promise(r => setTimeout(r, 400));
    const d = document.querySelector('[data-ex="sb-page-detail"]');
    const l = document.querySelector('[data-ex="sb-page-list"]');
    return {
      detailVisible: d ? !d.hidden : false,
      listHidden: l ? l.hidden : null,
      title: (document.querySelector('[data-ex="sb-detail-title"]') || {}).textContent,
      infoName: (document.querySelector('[data-ex="sb-info-name"]') || {}).textContent,
      basicVisible: (document.querySelector('[data-ex="sb-tab-basic"]') || {}).hidden === false,
      filesHidden: (document.querySelector('[data-ex="sb-tab-files"]') || {}).hidden,
    };
  })()`);
  steps.push(['点卡片进详情页', detail]);

  // 4. Files tab 切换 + 路径栏 + 文件行
  const filesTab = await evalJs(ws, `(async () => {
    const btn = document.querySelector('[data-ex="sb-tab-files-btn"]');
    if (btn) btn.click();
    await new Promise(r => setTimeout(r, 500));
    const tree = document.querySelector('[data-ex="sandbox-tree"]');
    const rows = tree ? tree.querySelectorAll('.ex-sandbox-tree-item').length : -1;
    const segFiles = (document.querySelector('[data-ex="sb-seg-files"]') || {}).classList;
    return {
      filesVisible: (document.querySelector('[data-ex="sb-tab-files"]') || {}).hidden === false,
      basicHidden: (document.querySelector('[data-ex="sb-tab-basic"]') || {}).hidden,
      segActive: segFiles ? segFiles.contains('active') : false,
      path: (document.querySelector('[data-ex="sb-path"]') || {}).textContent,
      treeRows: rows,
      treeText: tree ? tree.textContent.slice(0, 150) : '',
    };
  })()`);
  steps.push(['Files tab（分段/路径/文件行）', filesTab]);

  // 5. 终端页
  const term = await evalJs(ws, `(async () => {
    const btn = document.querySelector('[data-ex="sb-terminal"]');
    if (btn) btn.click();
    await new Promise(r => setTimeout(r, 200));
    const t = document.querySelector('[data-ex="sb-page-term"]');
    const title = (document.querySelector('[data-ex="sb-term-title"]') || {}).textContent;
    const input = !!document.querySelector('[data-ex="sb-term-input"]');
    const keys = document.querySelectorAll('[data-ex^="sb-key-"]').length;
    return { termVisible: t ? !t.hidden : false, title, input, keyCount: keys };
  })()`);
  steps.push(['终端页', term]);

  for (const [name, data] of steps) console.log(`[${name}] ${JSON.stringify(data)}`);
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
