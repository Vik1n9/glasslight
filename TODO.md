# TODO — ani.gamer.com.tw 支援（分支 `feat/ani-gamer`）

狀態：2026-10-02 驗證清單全部通過（登入與未登入／含廣告兩種情況），YouTube 與 `main`
比對無退步。剩下「待決定」的項目需要使用者拍板（命名、合併與發版）。

## 測試方式

1. `git checkout feat/ani-gamer`
2. `chrome://extensions` → 開發人員模式 → 載入未封裝項目 → 專案資料夾
   （未封裝安裝會自動重載，改檔後約 2 秒生效）
3. 開 `https://ani.gamer.com.tw/animeVideo.php?sn=<任一集>`，並在首頁、搜尋頁各看一次

## 驗證清單

- [x] 擴充功能有在動畫瘋載入（`html` 有 `lg-on`、`lg-ani` class）
- [x] 播放頁背景有隨影片變色的環境光（`#lg-ambient` 存在）
- [x] 影片綁定正確：`#video-container video.vjs-tech` 抓得到，播放／暫停／拖曳都會更新光
- [x] 廣告播放與廣告結束切回正片時，光與綁定正常（廣告與正片共用同一個 `<video>`）
- [x] 頂欄 `.sky` 與主選單 `.mainmenu` 是玻璃，仍固定在頂端（不是 `position: relative`）
- [x] 控制列 `.vjs-control-bar` 是 Clear 玻璃，左右邊距與圓角正常，點擊不縮小
- [x] 彈出選單（`.user-setting-toolbox`、搜尋建議 `.anime_search-content`、`.app-download-toolbox`）有玻璃
- [x] 站內切換深淺色（`html[data-theme]`）後，`html[dark]` 同步，樣式與對比正常
- [x] 文字可讀：標題、說明在亮畫面上有被遮罩壓暗
- [x] Transparency 滑桿 0 / 50 / 100 都正常，Reduce Transparency 與 Performance 有效
- [x] 全螢幕時環境光隱藏、黑邊為純黑，退出後恢復
- [x] 側欄（彈幕／集數欄 `.container-player .subtitle`）旁的光暈在邊緣淡出，沒有蓋到側欄
- [x] 首頁、搜尋頁沒有版面跑掉或內容被透明化蓋住
- [x] YouTube 沒有退步（`ambient.js` 的選擇器改成可覆寫，預設值未變）

## 驗證時修掉的問題

- 光暈：`<video-js>` 是 inline 0×0，光暈縮在左上角 → `playerSelector` 改 `.videoframe .video`
- 彈出選單：頂欄有 `backdrop-filter` 成為 backdrop root，選單背後沒被模糊 → 頂欄 frost 移到 `::before`
- 可讀性：青色強調字在暗畫面只剩 1.2:1、深色主題淺灰標籤低於 AA → 面板加主題底色、強調字調色

## 已知缺口 / 後續

- [ ] 非播放頁沒有縮圖取色，背景只有底色（需另外抓動畫瘋封面圖）
- [x] 正式名稱改為 "Glasslight"；網站名稱只出現在說明中，六語系說明、README、PRIVACY、商店文案都附免責與商標聲明
- [x] 重新產生宣傳圖，副標改為 "Glass & ambient light for video"（本機用 `NOTO_DIR=<字型資料夾>` 指定 Noto Sans）
- [x] `PRIVACY.md` 與 `store/listing.md` 補上新增網站（單一用途與權限說明也已更新）
- [ ] **待決定**：合併到 `main`、升版本、`python3 scripts/build.py`（目前 build 驗證通過）、發 Release
- [ ] 若選擇器有誤，集中修改 `src/content/ani-gamer.js` 的 `LG.site` 與 `NAV_GLASS`，以及 `src/styles/ani-gamer.css`
