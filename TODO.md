# TODO — Glasslight 開發計劃

分支：`feat/reflection`（三項完成後才合併、發新版）。ani.gamer.com.tw 支援（分支 `feat/ani-gamer`）已於
1.1.0 合併發佈，其紀錄保留在本檔前半部供日後回查；**進行中的計畫是下方三節**：

1. 影片下方的延伸：拉伸 → 倒影（已實作，待真實網站驗收）
2. 靜態模式（Static backdrop）
3. 設定頁（options page）＋抖內按鈕

---

# 已完成：ani.gamer.com.tw 支援（分支 `feat/ani-gamer`）

狀態：2026-10-02 驗證清單全部通過（登入與未登入／含廣告兩種情況），YouTube 與 `main`
比對無退步。已於 1.1.0 發佈。

## 測試方式

1. `git checkout feat/ani-gamer`
2. `chrome://extensions` → 開發人員模式 → 載入未封裝項目 → 專案資料夾
   （未封裝安裝會自動重載，改檔後約 2 秒生效）
3. 開 `https://ani.gamer.com.tw/animeVideo.php?sn=<任一集>`，並在首頁、搜尋頁各看一次

自動化測試與開發工具只放在本機、不進版控（`.dev/`、`.scratch/` 已 gitignore）。

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

## 影片下方的延伸：拉伸 → 倒影

狀態：2026-10-04 已實作（分支 `feat/reflection`），shader 層驗證通過，**待真實網站驗收**。

### 原問題

`hybrid` 在播放器正下方把畫面最底下的帶狀（`SUB = 0.025` 往內縮）往下拉到
標題列，用來蓋掉燒錄字幕。Transparency 拉高時是一條被垂直壓扁的畫面帶，
形狀感明顯，亮度與播放器相同，跟標題／說明文字搶對比。

### 實作（`src/content/ambient.js` 的 hybrid 分支，`t <= 1.0`）

- **鏡像寫在畫面（`d`）空間**：取樣點 `vec2(d.x, 2.0 - d.y)`（程式中寫成
  `1.0 - depth`，`depth = d.y - 1`），直接當貼圖座標用。
  - **更正原規劃**：原本寫「換算回 `n` 是 `2.0 / k.y - n.y`」，這是錯的。
    shader 的貼圖座標本來就是畫面相對座標；box 內用 `n` 取樣，是因為放大層
    的定義就是「螢幕點 `d` 顯示畫面點 `d / k`」。`(2 - d.y) / k.y` 鏡像的是
    **放大層**而不是影片：在播放器底邊（`d.y = 1`）會取到 `1 / k.y`（例如
    0.68）而非畫面最底列，與影片接不起來。只有 `2 - d.y` 在底邊等於影片的最底列。
- **顏色混合，不是座標混合**。
- **淡出目標＝畫面最底列（在放大層的 x，`vec2(n.x, 1.0)`）**：box 底邊上，
  放大層與放射光讀到的都是這一列，所以倒影淡出到它，box 底邊就沒有接縫。
  淡出曲線 `1 - smoothstep(0, L, depth)`，兩端斜率為 0，不留亮邊。
- **長度** `L = min(k.y - 1, REFL_MAX · min(1, aspect))`，`REFL_MAX = 0.6`
  畫面半高；直式畫面再乘寬高比（`aspect` 由 `enlargedBox()` 傳入），Shorts
  的倒影更短。找不到說明區（box 拉到視窗底）時也不會鏡像半張畫面。
- **亮度** `REFL_DIM = 0.7`：在播放器邊緣（標題所在）最暗，隨淡出回到 1，
  不影響與放射光的接續。純 shader 計算，`contrast.js` 的 scrim map 不動
  （它從 display canvas 取樣，自然會看到較暗的倒影）。
- **模糊隨深度增加**：mip lod `min(6, 2.5 + 12 · depth)`。這是藏字幕的主力：
  鏡像後的字幕在 depth ≈ 0.05–0.2 處，lod ≈ 3–5（8–32 texel / 256），
  只剩一條柔和的亮帶、讀不出字形。
- **水平方向**：
  - 倒影本身與畫面同寬（`|d.x|` 0.9–1.1 淡出），兩側是畫面最底列。
  - 整個「正下方」區域只在 box 外側 1/5（`|n.x|` 0.8–1.0，**box 相對**）
    交還放大層，所以 box 側邊（側欄）與放射光的接續跟放大層一樣無縫。
  - 若沿用原本固定的 `|d.x|` 0.8–1.2：觀看頁側欄緊貼播放器時 `k.x ≈ 1.05`，
    box 側邊處倒影權重還有 ~0.6，與放射光之間留下硬邊（見下表）；交接區太靠內
    則會讓放大層自己的字幕半透明露出（Shorts 實測出現 "SU"/"XT"）。
- `SUB` 與字幕迴避偏移已移除。`radial`（純放射）與非 WebGL 的 `enlarged`
  退路不變。效能：box 下方多兩次取樣，仍是同一張 `SRC = 256` 貼圖與既有
  mip level，不新增 mip、不新增 pass。

### 驗證（headless Chromium + SwiftShader，合成測試畫面）

測試畫面：漸層 + 紅色方塊 + 畫面 90% 高度處的白色粗體字幕（最壞情況）。
畫布 768×432（Transparency 100%，CSS 模糊僅 1 px），四種版面：一般觀看頁
（右側欄、說明區在播放器下方 130 px）、劇院、Shorts、找不到說明區。
指標是相鄰像素的最大差（0–255）。「初版」是 `8892655`（`|d.x|` 0.8–1.2
固定交接區），「現版」是本次修正：

| 版面 | box 底接縫 | 欄內逐列最大跳變 | box 側邊（側欄）接縫：改動前 / 初版 / 現版 |
| --- | --- | --- | --- |
| 觀看頁 | 1 | 3 | 12 / **24** / 2 |
| 劇院 | 2 | 2 | 1 / 1 / 1 |
| Shorts | 0 | 2 | 2 / 2 / 2 |
| 無說明區 | 1 | 3 | 17 / **34** / 2 |

- 倒影第一列＝畫面最底列 × 0.7（如設計）；box 底邊與放射光差 ≤ 2。
- 鏡像字幕在 lod 加速後只剩柔和亮帶；這是合成的最壞情況，實際影片需實機看。
- 限制：SwiftShader 與實機 GPU 的 mip 取樣細節可能不同；未經過
  `#lg-ambient` 的 CSS 模糊、scrim 與玻璃層，**實機外觀仍需人工確認**。

### 驗收（真實網站）

- [ ] Transparency 0 / 50 / 100：倒影都不可見形狀變形，且不搶標題文字對比
- [ ] 倒影下緣在標題列處是漸淡，不是硬邊（shader 層已驗證）
- [ ] 倒影與放射光的交界無接縫、無色偏（shader 層已驗證）
- [ ] 燒錄字幕鏡像後不明顯（合成最壞情況已驗證，需實際影片確認）
- [ ] 側欄旁（playlist / 動畫瘋彈幕欄）倒影在邊緣淡出，沒蓋到側欄
- [ ] Shorts（直式）不產生過長倒影
- [ ] theater 模式與全螢幕行為不變
- [ ] `radial` / `enlarged` 兩種 backdrop 無退步（程式路徑未改動）
- [ ] 淺色主題：0.7 的暗化在淺色頁面上是否像陰影；若不自然再調 `REFL_DIM`
- [ ] `tests/perf/suite.mjs` 對 `main` 比較，無效能退步

## 靜態模式（Static backdrop）

狀態：2026-10-04 規劃中（尚未實作）

### 目標

目前的環境光每幀重繪，系統開銷大（筆電耗電、低階裝置可能跑不動）。新增一個
**靜態模式**：只在切換頁面／載入時取一次畫面作為背景，之後完全不重繪。玻璃質感
與透明度效果保留，只是不再跟著影片動。

### 現況：開銷在哪裡

- `ambient.js:629-649` `onFrame()` / `schedule()`：`requestVideoFrameCallback`
  迴圈，每幀 `drawVideo()`。幀率由 `fps()`（`ambient.js:76`）決定，30 fps，
  `performance` 開啟時 15 fps。
- `glass.css:151-154` `@keyframes lg-drift`：全視窗漂移動畫，跑的時候每幀重繪
  全視窗模糊層與其上每個玻璃表面。**但注意現況範圍**：預設 hybrid backdrop
  播放中已有 `lg-radial` 把它關掉（`glass.css:147-149` `animation: none`）、
  沒播放時 `lg-still` 也會 pause（`glass.css:141-143`）；漂移實際只在
  「enlarged backdrop＋播放中」跑。靜態模式**強制 `lg-still` 即可涵蓋全部
  情況，不需新增 class 或 CSS**。
- `tick()` 每 `STATS_MS = 250` ms（`ambient.js:27`）跑一次，做 GPU readback
  ＋ scrim solve。已有 `sampleDirty` / `settled` 提前返回（`ambient.js:981-984`），
  收斂後只剩 `placeGlow()`，應接近零成本——但要實測確認。
- `analyseRawFrame()`（letterbox 裁切／DRM 偵測）：`tick()` 的提前返回讓它
  收斂後自然不再週期執行，不需特別處理；但靜態模式的一發截圖用的是當下的
  `crop`，新載入頁面時還是預設 `{0,0,1,1}`，**擷取當下必須先跑一次**，
  否則黑邊會被烘進色盤。DRM 全黑偵測迴圈可跳過。
- 已存在的現成零件：`drawStill()`（`ambient.js:810-822`，「單張圖 → 模糊 →
  拉滿視窗」）與 `showPixels()`（`ambient.js:792-808`，淡入到 `drawStill`）
  ——**但這兩者是縮圖退路，不是靜態模式的主路徑**（理由見預計修改 3）。
  `onBlocked` → `LG.thumbs.showVideo(videoId())`（`main.js:65`）已經是
  drawImage 失敗時的退路，靜態模式直接沿用。

### 預計修改

1. `LG.DEFAULTS`（`settings.js:4-14`）新增設定 `static: false`。
2. 靜態模式開啟時：
   - `schedule()` 直接 return，不掛 `requestVideoFrameCallback`（涵蓋
     visibilitychange / fullscreenchange / video 事件等所有呼叫點）。
   - `syncMotion()` 強制 `lg-still`（既有 class，已會 pause 漂移），
     不新增 class、不動 CSS。
   - 擷取時機：頁面載入 + `yt-navigate-finish` / `yt-player-updated`
     （`main.js` 的 `route()`）+ 暫停 / seek——這些正是既有 `drawOnce()`
     的觸發點，保留即可。**不做週期性重取**，否則失去意義。
   - **捲動／版面變化必須重新對位**：`#lg-ambient` 是 `position: fixed`
     （`glass.css:112-120`），radial rect 是擷取當下烘進 canvas 的；捲動後
     播放器移動、canvas 不動 → 光與播放器錯位。動態模式靠下一幀自動修正，
     靜態模式沒有下一幀。`placeGlow()` 目前只在 `video.paused` 時重繪
     （`ambient.js:557-563`），靜態模式要放寬這個條件，並**加 debounce**
     （捲動停下來才重繪一次），否則捲動中每幀重繪，靜態就失去意義。
3. 擷取路徑：**一發 `drawVideo(1)`（即既有 `drawOnce()` 路徑），不是
   `showPixels()` / `drawStill()`**。理由：`drawStill()` 是縮圖退路，會
   `setRadialShown(false)` 關掉 hybrid 放射 backdrop、blur 也是照 32×18
   縮圖調的——走它會讓靜態模式的外觀與動態模式不同，直接違反「視覺與動態
   模式一致」的驗收。`drawVideo(1)` 則保留 hybrid radial、glow、scrim
   取樣全部不變，只是不再有 frame loop。**不需新增任何 manifest 權限**；
   失敗（tainted / DRM）時沿用既有 `onBlocked` → 縮圖退路。
4. 若日後想改成 `drawStill()` 那種「單張柔霧」質感，注意其 blur 是照 32×18
   來源調的，影片幀要先降解析（如 64×36）再餵，否則太銳、像凍結的照片。
   這是可選的視覺取捨，不是靜態模式的必要成分。
5. `performance` 與 `static` 的關係：兩者獨立開關。`performance` 仍保留（有人
   要的是省電但仍要活的環境光），不要把它升級成靜態。

### 待決策

- **擷取來源 A（建議）**：直接取 `<video>` 元素 once。免權限、免跨程序、
  跟現有程式碼同一條路徑。缺點：拍不到頁面本身（只拿到影片畫面）——但現有
  模式本來也只拿影片畫面，所以外觀一致。
- **擷取來源 B**：`chrome.tabs.captureVisibleTab` 拍真實頁面像素。必須在
  service worker 執行、要權限、拍不到自己這層 overlay、DRM 影片會是黑塊。
  成本與風險都高，除非有明確需求否則不做。
- 重取節奏：只在導頁與暫停重取，還是加一個很慢的（例如 60 s）保險？加了會讓
  「靜態」不再是真正的靜態，建議不加，改由 popup 手動刷新。
- `thumbs.js`（縮圖來源，非播放頁取色）尚未確認能否直接複用作為備援圖——實作前
  要讀一次。

### 驗收

- [ ] 靜態模式下**沒有每幀排程**：`requestVideoFrameCallback` 完全不掛、
      `drawVideo()` 只在一發擷取／捲動重新對位時被呼叫，播放 30 秒後
      DevTools Performance 記錄為 idle
- [ ] 殘留的 rAF 使用者仍正常且不影響結果：`tick()` 的 scrim 漸層
      (`scrimRaf`)、glow 定位 (`glowRaf`)、縮圖淡入 (`fadeRaf`)、
      指標高光 (`specAngle`, `main.js`)，這些本來就只在需要時排程
- [ ] 漂移動畫停止（enlarged backdrop＋播放中的情況；強制 `lg-still` 即可）
- [ ] 頁面載入、切換影片（SPA 導頁）、暫停／seek 時背景都會更新
- [ ] 捲動停止、theater 切換、視窗 resize 後，backdrop 重新對位到播放器，
      無錯位；捲動進行中不會每幀重繪（debounce 生效）
- [ ] 新載入的 letterbox 影片：擷取前 `analyseRawFrame()` 已跑過一次，
      黑邊沒有被烘進色盤
- [ ] 玻璃質感與 Transparency 0 / 50 / 100 皆保留，視覺與動態模式一致
- [ ] scrim map 仍正確求解，文字對比達到目標（淺色、深色主題）
- [ ] 影片暫停／結束後背景仍是該幀，不退回黑底
- [ ] DRM / tainted 影片正確退到縮圖，不報錯
- [ ] 關閉靜態模式後即時環境光完全恢復，無殘留狀態
- [ ] 效能量測：靜態模式的 CPU 使用與動態模式、關閉插件三者比較
- [ ] README、popup 說明、PRIVACY／`store/listing.md` 補上新的設定項

## 設定頁（options page）＋抖內按鈕

狀態：2026-10-04 規劃中（尚未實作）

兩件事一起做：把設定從小 popup 搬成一完整頁面（每個功能都能直接調，
每個功能下方附完整說明），頁面上放一個抖內按鈕。

### A. 設定頁

**調研結論（已查官方文件與現有做法）**

- 用 `"options_ui": { "page": "src/options/options.html", "open_in_tab": true }`。
  `open_in_tab: false`（內嵌在 `chrome://extensions`）**不適合這裡**：官方文件
  指出內嵌模式會被塞進一個窄框、限制版面寬度，而我們的特色正是「每個控制項
  下方有完整說明」，內嵌會把說明擠掉。內嵌適合「幾個開關」而已。
- popup 加連結 → `await chrome.runtime.openOptionsPage()` 然後 `window.close()`。
  用這個 API 而不是自己 `chrome.tabs.create`，它才會尊重 manifest 的宣告。
  另外實務上都要在開完後把 popup 關掉，否則新分頁取得焦點、popup 留在後面很明顯。
- **不新增任何權限**。

**內容與結構**

- 沿用現有控制項（`popup.html:18-52`）：`enabled` / `intensity` / `blur` /
  `transparency` / `contrastTarget` / `backdrop` / `refraction` /
  `reduceTransparency` / `performance`，之後加上靜態模式的 `static`。
  每個控制項下方一段說明：功能是做什麼的、拉高拉低會怎樣、會不會耗電。
- 分區建議：一般（啟用）→ 外觀（光／模糊／透明度／折射）→ 行為（backdrop／
  效能／靜態模式）→ 進階（對比目標、Reset、抖內）。**Reset 放進階，不要放主頁**，
  避免誤觸。
- 版面：兩欄 grid（標題左、控制項右），寬度 < 600px  collapse 成單欄。
  加 `color-scheme: light dark` 讓捲軸與系統色跟上。鍵盤可操作（Tab 順序、
  toggle 用 Space）。設定筆數不會到需要搜尋的量級，不用做搜尋框。

**必須先修的兩個既有問題（調研時發現，設定頁會把它們放大）**

1. **`DEFAULTS` 重複定義**：`settings.js:4-14` 與 `popup.js:1-11` 各寫一份，
   內容相同但沒有共用機制。這次要加設定，不抽出來必然 drift。抽成共用模組，
   popup 與 options 都 import。
2. **寫入沒有 debounce，會撞上 `chrome.storage.sync` 配額**：
   `popup.js:73-82` 在每個 `input` 事件就 `storage.sync.set`，拖曳滑桿一口氣
   送出幾十次寫入，而 `storage.sync` 約有 **120 writes/minute** 的上限，超過會丟
   `QUOTA_BYTES_PER_MINUTE` 錯誤（現在沒有錯誤處理，會靜默失敗）。加上說明頁
   之後控制項更多、寫入更頻繁，**這次要一併改成 debounce（建議 400 ms）＋
   顯示「已儲存」狀態**，順便處理配額錯誤。
3. **需要 `chrome.storage.onChanged` 監聽**：popup 現在只在載入時讀一次
   （`popup.js:71`）。設定頁開著時改 popup（或反向），不會同步。要補上監聽，
   只更新變動的那欄位。

**i18n**

- 沿用 `popup.js:26-42` 的機制（`chrome.i18n` 只能跟瀏覽器語言，選定的語言要
  自己抓 `_locales/<lang>/messages.json`）。`_locales` 目前已有 **6 種語言**
  （en / es / ja / ko / zh_CN / zh_TW），每段說明都要 × 6。
- 說明文字不要塞進 `messages.json`（會變成又長又難維護的標籤檔）。每個語言
  資料夾另放一份 `descriptions.json`，只用於設定頁說明。
- 首次安裝可選自動開一次設定頁（`chrome.runtime.onInstalled` + 一個 flag），
  符合「安裝後跳出內建頁面」。

### B. 抖內按鈕：形式與金額

- 金額：**固定 NT$100**，單一按鈕，不做多階級、不讓選金額。
- 性質：**純粹樂捐／贊助，與功能毫無關係**。不抖內就完全沒有任何功能差異，
  沒有降級、沒有浮水印、沒有開關限制。
- 實作就是 `chrome.tabs.create({ url: '<託管結帳連結>' })`：**不碰 SDK、不加
  `host_permissions`、不加 `content_script`、不用 webhook、不需要後端**。
  權限清單維持 `storage` + `https://i.ytimg.com/*` 不變。

**技術硬限制（先講清楚，避免日後有人想改回來）**

Apple Pay / Google Pay 無法在 `chrome-extension://` 頁面內執行，這是來源限制
不是難度問題：

- Google Pay：Chromium 直接拒絕非安全來源，錯誤字串為
  `Only localhost, file://, and cryptographic scheme origins allowed.`
  → `canMakePayment` / `hasEnrolledInstrument` 永遠 false，`show()` 丟
  `NotSupportedError`。
- Apple Pay：`ApplePaySession` 需要已註冊的 HTTPS 網域 + merchant ID，同樣受
  來源限制；且 Apple Pay JS SDK 是遠端程式碼，MV3 的 CSP 直接禁止載入。
- Chrome 內建支付（Chrome Web Store Payments）已於 2020 年停止。
- → 只能開一個外部 HTTPS 託管結帳頁，錢包由那一頁提供。
- 另外 Apple Pay 與 Google Pay **不會同時出現**（OS 限制），這是正常行為。

### C. 金流：台灣適用性與註冊方便度

**先排除一個錯誤假設：台灣開不了 Stripe 直接帳戶。** Stripe 支援國家清單中
台灣是「商家所在地 ❌ 不支援」，只能接受台灣客戶付款、不能從台灣簽約收款。
而台灣人繞道開通的實際作法是：香港匯豐帳戶 → Stripe 香港個人戶（3.4% +
**HK$2.35/筆**），或美國 Wyoming LLC（2.9% + **US$0.30/筆**）。

> **關鍵：NT$100 的抖內，海外收單的固定手續費會直接吃掉大部分收入。**
> HK$2.35 ≈ NT$9，約 9%；US$0.30 ≈ NT$9.5，約 9.5%。還沒算匯損與海外所得稅。
> 這是排除 Stripe／境外主體的決定性理由，不是「註冊麻煩」而已。

| 服務 | 註冊方便度 | Apple Pay / Google Pay | 費用（國內卡） | 結論 |
| --- | --- | --- | --- | --- |
| **TapPay Link Pay** | 免費註冊、免技術串接、免建站，批次產生收款連結；支援個人戶 | 皆有（另含 LINE Pay、街口、悠遊付） | 2.75%（國外卡 3.5%） | **建議採** |
| 綠界 ECPay 收款連結 | 免費、免開發工具、支援個人 | Apple Pay TWQR；**未列 Google Pay** | 依方案 | 台灣老牌，可作備案 |
| LINE Pay | **不方便**：需專人聯繫、網路商店須有實際可購買的網站、伺服器 IP 需加白名單 | — | — | 排除 |
| Polar（MoR） | 台灣可註冊（走 Stripe Connect Express，主體在美國） | 待確認 | 較高 | 備案，適合境外卡 |
| crxpay / ExtPay | — | — | — | 排除：只為追蹤訂閱 entitlement，抖內用不到 |
| Stripe（香港／美國） | 需境外銀行帳戶或 LLC | 皆有 | 9%+ | 排除：固定費吃掉 NT$100 |

- TapPay Link Pay 完全命中需求：對每筆訂單產生網址，點開填卡即付，不用寫任何
  後端。台灣使用者還能用 LINE Pay／街口支付，轉換率比純卡好。國外卡也能付
  （3.5%），所以海外使用者不會被排除。
- 需實測確認的三點：
  1. TapPay 的 Apple Pay 是否需另外購買「Apple Pay on the Web（NT$200/月）」
     模組，或一般信用卡流程就自動帶出 Apple Pay／Google Pay（費率表在「信用卡」
     一欄直接註明支援 Apple Pay / Google Pay / Samsung Pay，但需實測）。
  2. NT$100 × 2.75% = NT$2.75，**是否有最低手續費下限**。
  3. Polar 是否讓台灣創作者拿到 Apple Pay / Google Pay（取決於其 Stripe 網域
     註冊狀態）。

### D. 稅務與海外限制

**台灣稅務（TapPay／本國金流情境）**

- **營業稅－小規模營業人三級（2025）**：
  - 每月**勞務**銷售額 < NT$50,000 → **免繳營業稅、免稅籍登記、免開統一發票**
  - NT$50,000–200,000 → 繳 1%、需稅籍登記、免開發票
  - ≥ NT$200,000 → 繳 5%、需稅籍登記、需開立統一發票
  - 以抖內每筆 NT$100 計：**每月 500 筆（每年約 6,000 筆）之前完全免稅**。
    金額很小但結論很明確：初期不需要為此做稅務規劃。
- **海外所得稅**：若走境外主體（Stripe／Polar），在台灣仍屬境外來源所得。
  基本稅額需同時滿足三條件才生效（海外所得 ≥ NT$100 萬、基本所得額 >
  NT$750 萬、且高於綜合所得稅額）；但**海外所得超過 NT$100 萬即使免稅也必須申報**。
  以 NT$100 計要 10,000 筆才可能觸及，實務上可忽略，但要記得「不是境外收就不
  會有這類申報義務」。
- **樂捐的稅務定性不確定**：抖內不對應商品或勞務，究屬營業收入、贈與或其他，
  認定可能因國稅局/專業會計師而異。**金額成長到需要正式處理時再請教會計師**，
  現在不用。
- **境外電商的另一套義務（走 Polar／Stripe 才會遇到）**：若透過境外金流賣
  「數位商品」給台灣消費者，該境外賣方有兩項台灣義務——年度銷售額超過
  **NT$600,000** 須辦理營業稅登記，且**必須透過台灣 eGUI 系統開立電子發票**
  （實務上要再串一個認證服務商）。這是 Polar／Stripe 這條路徑額外背上的一整套
  合規成本，本國金流（TapPay）則不涉及。再次支持選本國金流。

**海外限制**

- Google Pay / Apple Pay 的可用性依使用者所在地而異（台灣可用；中國大陸地區
  Google 服務本身即受限，該市場本來就不在目標內）。
- TapPay、綠界等本國金流**只接受台灣開發者註冊**，但**接受境外信用卡**
  （TapPay 國外卡 3.5%），所以海外使用者仍可付款，不會被鎖死在台灣卡。
- 反過來說：如果未來想讓海外使用者「用當地錢包付款」，本國金流做不到，
  那時才需要考慮 Polar／Stripe（且要重新評估那 9% 的固定費是否划算）。

### E. Google 政策依據（調研結果，方案是合規的）

- **Google Play 付款政策有明文豁免，正好對應這個設計**：
  > 「若使用者支付的 100% 小費或貢獻全數歸開發者，且該付款不授予任何數位內容
  > 或服務的存取權，則視為點對點付款（peer-to-peer），不要求使用 Google Play
  > 計費系統。」
  本案 100% 歸作者、且不控管任何功能，兩個條件都符合。
- Chrome 內建支付已停止，官方明確允許使用任何第三方金流，只需注意不與商店
  體驗整合。
- **CWS「Accepting Payment From Users」政策要求**（即使金流在外部，頁面仍須
  遵守）：
  - 「必須清楚表明賣家是開發者本人，不是 Google」→ 頁面上要寫。
  - 「不得誤導使用者，須誠實描述所販售的內容，並顯著列出銷售條款（含退款與
    退貨政策）」→ 設定頁要寫退款條款（贊助不提供任何商品或服務，故無退款）。
  - 反面做法（明確不可行）：把功能綁在抖內上、用假關閉鈕強迫、每次開啟都跳。
- 另注意：擴充功能**不得公開顯示使用者的付款／財務資訊**（與本案無關，但別在
  設定頁顯示訂單紀錄之類的）。

### F. 文案與商店合規

- 設定頁文案要點：自願贊助、金額 NT$100、與功能無關、付了不會開啟任何東西、
  賣家是開發者本人、透過第三方金流、款項用途。
- `PRIVACY.md`：設定頁只讀寫 `chrome.storage.sync`（既有權限）；抖內連結會
  開到外部網站；擴充功能本身不收集、不傳遞任何付款或財務資料。
- `store/listing.md`：商店頁面本身不放抖內按鈕（避免誤導與加購退費率），只放
  設定頁的說明連結與聯絡信箱。
- 稅務註記：見上面 D 節，前期免稅無需處理。
- README 補上設定頁的說明章節。

### 驗收

- [ ] 商店安裝後，右鍵圖示 → 選項 可開啟設定頁；popup 內的連結也可開啟
- [ ] 首次安裝會自動開一次設定頁（且只開一次）
- [ ] 設定頁可調整所有功能，控制項即時生效（與 popup 雙向同步）
- [ ] 每個功能下方都有說明，內容與實際行為一致（`performance` 說明要與
      15 fps／新增的靜態模式一致）
- [ ] 6 種語言的說明皆完整，沒有漏翻或顯示 key 名
- [ ] 選項「自動」時跟隨瀏覽器語言；選特定語言時設為 `lang` 屬性正確
- [ ] `DEFAULTS` 只剩一份定義，popup 與設定頁共用
- [ ] 抖內按鈕開啟台灣託管結帳頁（TapPay Link Pay），該頁自動提供
      Apple Pay / Google Pay；在 `chrome-extension://` 內不嘗試載入支付 SDK
- [ ] NT$100 固定金額、單一按鈕；不抖內時功能與外觀完全無差異
- [ ] 設定頁明寫賣家是開發者本人（非 Google）、自願贊助、與功能無關、
      無退款（不提供商品或服務）
- [ ] 抖內不需 webhook、不需權限驗證、不控管任何功能（純自願贊助）
- [ ] 權限清單沒有變動（仍只需 `storage` + `https://i.ytimg.com/*`）
- [ ] 境外信用卡也能付款（TapPay 國外卡路徑實測一次）
- [ ] PRIVACY.md、`store/listing.md`、README 已更新並通過商店審查
- [ ] 設定頁在窄視窗（< 600px 單欄）與一般分頁寬度下版面正常
- [ ] Reset 只出現在進階區，不在主頁
- [ ] 鍵盤可完整操作（Tab 順序、Space 切換 toggle）
- [ ] 連續拖曳任一滑桿不會觸發 `storage.sync` 配額錯誤，且有「已儲存」提示

## 已知缺口 / 後續

- [x] 非播放頁縮圖取色：首頁、列表、搜尋、觀看紀錄以滑鼠所在或畫面中央的作品封面點亮背景（`p2.bahamut.com.tw` 有開 CORS，不需新增權限）
- [x] 正式名稱改為 "Glasslight"；網站名稱只出現在說明中，六語系說明、README、PRIVACY、商店文案都附免責與商標聲明
- [x] 重新產生宣傳圖，副標改為 "Glass & ambient light for video"（本機用 `NOTO_DIR=<字型資料夾>` 指定 Noto Sans）
- [x] `PRIVACY.md` 與 `store/listing.md` 補上新增網站（單一用途與權限說明也已更新）
- [x] 合併到 `main`、升版本 1.1.0、`python3 scripts/build.py`、發 Release `v1.1.0`
- [ ] 若選擇器有誤，集中修改 `src/content/ani-gamer.js` 的 `LG.site` 與 `NAV_GLASS`，以及 `src/styles/ani-gamer.css`
