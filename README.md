# 口袋應用

口袋遊樂場（96 款遊戲）與口袋工具箱（76 個工具），每個都是單一 HTML 檔，手機直式優先。

網站：https://timmango123.github.io/pocket-apps/ （遊樂場 `/games/`、工具箱 `/tools/`）

## 資料夾

| 路徑 | 內容 |
|---|---|
| `apps/<名稱>/index.html` | 每款遊戲或工具的原始碼，`demo/` 裡是它的測試 |
| `apps/game-hub/`、`apps/tool-hub/` | 兩個大廳：`build.py` 把各 app 組成目錄頁＋逐款檔案（輸出到 `dist/`） |
| `apps/shared/netplay.js` | 連線對戰模組（只在 claude.ai 版有效），用 `inline-netplay.py` 複製進各遊戲 |
| `apps/pages/index.html` | 網站首頁 |
| `scripts/build_site.py` | 一鍵建置整個網站到 `_site/` |
| `qa/` | 總測試（`smoke/run.js`）、連線對戰測試（`netplay/run.js`）等 |

## 改東西的流程

1. 改 `apps/<名稱>/index.html`。
2. 本機確認：`python3 scripts/build_site.py`，再跑 `node qa/smoke/run.js <名稱>`（或不加名稱跑全部，`--hubs` 連大廳一起測）。
3. 推到分支、開 PR。GitHub Actions 會建置並跑全部測試。
4. 合併到 `main` 後自動部署到 GitHub Pages。

claude.ai 版（Artifact 連結）用同一份 `apps/*-hub/dist` 發佈。

連線對戰（五子棋、四子連線、黑白棋、點格棋）需要 claude.ai 的房間功能，GitHub 版只提供單人模式。
