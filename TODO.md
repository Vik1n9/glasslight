# TODO — ani.gamer.com.tw 支援（分支 `feat/ani-gamer`）

狀態：程式已寫好，**尚未在實際瀏覽器驗證**。選擇器是從網站 HTML 與 CSS
（`animeplayer.css`、`anime.css`、`anime_player.js`）推得，可能需要修正。

## 測試方式

1. `git checkout feat/ani-gamer`
2. `chrome://extensions` → 開發人員模式 → 載入未封裝項目 → 專案資料夾
   （未封裝安裝會自動重載，改檔後約 2 秒生效）
3. 開 `https://ani.gamer.com.tw/animeVideo.php?sn=<任一集>`，並在首頁、搜尋頁各看一次

## 驗證清單

- [ ] 擴充功能有在動畫瘋載入（`html` 有 `lg-on`、`lg-ani` class）
- [ ] 播放頁背景有隨影片變色的環境光（`#lg-ambient` 存在）
- [ ] 影片綁定正確：`#video-container video.vjs-tech` 抓得到，播放／暫停／拖曳都會更新光
- [ ] 廣告播放與廣告結束切回正片時，光與綁定正常
- [ ] 頂欄 `.sky` 與主選單 `.mainmenu` 是玻璃，仍固定在頂端（不是 `position: relative`）
- [ ] 控制列 `.vjs-control-bar` 是 Clear 玻璃，左右邊距與圓角正常，點擊不縮小
- [ ] 彈出選單（`.user-setting-toolbox`、搜尋建議 `.anime_search-content`、`.app-download-toolbox`）有玻璃
- [ ] 站內切換深淺色（`html[data-theme]`）後，`html[dark]` 同步，樣式與對比正常
- [ ] 文字可讀：標題、說明在亮畫面上有被遮罩壓暗
- [ ] Transparency 滑桿 0 / 50 / 100 都正常，Reduce Transparency 與 Performance 有效
- [ ] 全螢幕時環境光隱藏、黑邊為純黑，退出後恢復
- [ ] 側欄（彈幕／集數欄 `.container-player .subtitle`）旁的光暈在邊緣淡出，沒有蓋到側欄
- [ ] 首頁、搜尋頁沒有版面跑掉或內容被透明化蓋住
- [ ] YouTube 沒有退步（`ambient.js` 的選擇器改成可覆寫，預設值未變）

## 已知缺口 / 後續

- [ ] 非播放頁沒有縮圖取色，背景只有底色（需另外抓動畫瘋封面圖）
- [ ] 商店名稱與文案仍是 "for YouTube™"（`_locales/*/messages.json`、`store/listing.md`）
- [ ] `PRIVACY.md` 與 `store/listing.md` 補上新增網站
- [ ] 驗證通過後：合併到 `main`、升版本、`python3 scripts/build.py`、發 Release
- [ ] 若選擇器有誤，集中修改 `src/content/ani-gamer.js` 的 `LG.site` 與 `NAV_GLASS`，以及 `src/styles/ani-gamer.css`
