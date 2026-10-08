# TODO — Glasslight 開發計劃

分支：`feat/reflection`（三項完成後才合併、發新版）。ani.gamer.com.tw 支援（分支 `feat/ani-gamer`）已於
1.1.0 合併發佈，其紀錄保留在本檔前半部供日後回查；**進行中的計畫是下方三節**：

1. 影片下方的延伸：拉伸 → 倒影（已實作；2026-10-08 實機驗收 8/9，剩淺色主題）
2. 靜態模式（Static backdrop）（已實作；2026-10-08 實機驗收 6/14，其餘需特定情境或基準）
3. 設定頁（options page）＋抖內按鈕（已實作；抖內為測試連結，待接 TapPay）
4. PR #7 效能測試未通過項目的驗證（見下方「PR #7 效能測試：待驗證」）

2026-10-08 本機效能測試（`tests/perf/suite.mjs --debug` 對 `main`）：YouTube 四格通過，
動畫瘋 `ani/light` 的 `max-glass/ani-battle` 未過，`ani/dark` 與第 2 輪未跑到。
完整報告與原始結果在 [`docs/perf/2026-10-08-pr7/`](docs/perf/2026-10-08-pr7/REPORT.md)；
待查事項見下方「效能測試發現」。

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

2026-10-08 本機實機驗證（Chromium + 本分支未封裝、已登入；腳本與截圖在 `.scratch/verify/`，
不進版控）：

- [x] Transparency 0 / 50 / 100：倒影都不可見形狀變形，且不搶標題文字對比
      （YouTube 深色，三張截圖：只有模糊色光，標題與按鈕清楚）
- [x] 倒影下緣在標題列處是漸淡，不是硬邊（YouTube 深色整頁截圖，無可見邊界）
- [x] 倒影與放射光的交界無接縫、無色偏（同上，含右側推薦欄旁）
- [x] 燒錄字幕鏡像後不明顯（動畫瘋，畫面底部有燒錄字幕「怎麼會這樣」，播放器下方
      看不出鏡像字；淺色頁面上倒影本身也很淡）
- [x] 側欄旁（playlist / 動畫瘋彈幕欄）倒影在邊緣淡出，沒蓋到側欄
      （動畫瘋彈幕欄、YouTube 推薦欄已看；YouTube 播放清單頁未另測）
- [x] Shorts（直式）不產生過長倒影（實測 Shorts 影片佔滿可視高度，下方沒有倒影空間；
      倒影長度上限 `REFL_MAX × aspect` 這次沒有情境可驗）
- [x] theater 模式與全螢幕行為不變（theater 正常；全螢幕 `#lg-ambient` 為
      `display:none`，退出後恢復 `block`）
- [x] `radial` / `enlarged` 兩種 backdrop 無退步（三種模式截圖外觀正常；
      與 `main` 的逐像素比較只有效能測試的 hybrid）
- [ ] 淺色主題：0.7 的暗化在淺色頁面上是否像陰影；若不自然再調 `REFL_DIM`
      （已登入帳號的外觀設定會蓋過 `prefers-color-scheme`，改用未登入 profile 測；
      截圖當下影片在緩衝、畫面全黑，**沒驗成**，需再看一次）
- [ ] `tests/perf/suite.mjs` 對 `main` 比較，無效能退步
      （2026-10-08：YouTube 4 格通過；`ani/light` 未過，見下節；`ani/dark`、第 2 輪未跑到）

### 效能測試發現（2026-10-08，報告：`docs/perf/2026-10-08-pr7/REPORT.md`）

- [x] 測試腳本隔離與畫面無關的分頁：設定頁首次安裝會自動開啟，而每次測試都是新 profile，
      cand 因此多一個 renderer，RAM 被算成 cand 的成本（動畫瘋 6 組設定 ×1.2）。
      `run.mjs` 改以 targetId 認出測試分頁、關掉其他分頁並記錄在 `result.strayPages`。
      隔離後 ×1.2 的 RAM 警告消失。
- [ ] `max-glass/ani-battle` 場景切換後（frame 0 @1201s），動畫瘋頂欄後方的環境光與
      `main` 不同（cand 4 次中 3 次 Δ≈31；畫面與播放器 Δ≈0）。`main` 仍是上一幕的暗色，
      cand 已跟上新畫面。**待判斷是否為預期行為**：是 → 該片段的凍結畫面改在切換後
      留足夠穩定時間或換擷取點；不是 → 找出 max-glass 路徑在切換時的差異。
- [ ] 同一格「量測期間 RAM 持續上升（leak?）」警告（cand 4 次中 2 次，含隔離後；
      `main` 未出現）。查 max-glass 路徑在高動態片段是否有保留畫面或畫布。
- [ ] 補跑 `ani/dark` 與第 2 輪（除錯模式停在 `ani/light`，需上面兩項有結論）
- [x] 無人在場時螢幕睡眠會讓 Chromium 停止繪製、動畫瘋格子卡在 `waitPlayable`；
      以 `caffeinate -d -i -u node tests/perf/suite.mjs …` 執行即可。可考慮讓 `suite.mjs`
      自己持有不睡眠的 assertion。

## 靜態模式（Static backdrop）

狀態：2026-10-07 已實作（分支 `feat/reflection`），headless 功能測試通過，**待真實網站驗收**。

### 目標

環境光每幀重繪，開銷大（筆電耗電、低階裝置可能跑不動）。靜態模式：只在影片載入、
暫停、跳轉時取一個畫面當背景，之後不重繪。玻璃質感與透明度效果保留，只是不跟著影片動。

### 實作（`src/content/ambient.js`）

- 設定 `static: false`（`settings.js`、`popup.js` 的 `DEFAULTS`；popup 加一個
  toggle，滑過顯示說明，6 語系 `optStatic` / `optStaticHint`）。
- **沒有影格迴圈**：`schedule()` 在靜態模式直接 return，涵蓋所有呼叫點；開啟時
  `cancel()` 掉進行中的 `requestVideoFrameCallback`。
- **漂移**：`syncMotion()` 在靜態模式強制 `lg-still`，未新增 class 或 CSS。
- **擷取時機**：`loadeddata`（含 SPA 導頁換片）、`pause`、`seeked`、綁定新的
  `<video>`、開啟靜態模式當下。事件只標記 `shotWanted`，實際擷取在下一次
  `tick()`（≤ 250 ms）。沒有週期性重取。
- **擷取流程 `takeShot()`**：
  1. 先跑 `analyseRawFrame()`（letterbox 裁切、DRM 計數）→ 黑邊不會烘進背景。
  2. **規劃沒寫到的問題：影片開頭常是全黑**。播放中若整格是黑的就等下一次再試
     （每 2 個 tick 一次，維持既有 DRM 偵測的 8 秒門檻 → 之後沿用
     `onBlocked` → 縮圖退路）。暫停在黑畫面就照實顯示，但 `playing` 時再重取
     一次：影片載入完、autoplay 還沒開始時正是「暫停在黑色第一格」。
  3. 把畫面複製成一張**快照**（`OffscreenCanvas`，寬 ≤ 640 px，保留比例）。
  4. 從快照畫 backdrop（`drawVideo(1)`，hybrid／radial／enlarged、glow、scrim
     取樣全部同一路徑）。同時取消進行中的縮圖淡入（`fadeRaf`），否則淡入的最後
     一格會蓋掉快照——動態模式靠下一幀蓋回去，靜態模式沒有下一幀。
- **規劃沒寫到的問題：重新對位必須從快照畫**。原規劃是捲動停止後 `drawVideo(1)`，
  但那會畫出*當下播放到的*畫面，背景就會在每次捲動後換一張。現在 `drawVideo`
  在靜態模式改從快照取樣；切換 backdrop、Transparency 改變畫布大小時也從快照重畫。
- **捲動／版面變化**：`placeGlow()` 偵測到播放器移動時，靜態模式改成 debounce
  200 ms，停下來才重畫一次（`REALIGN_MS`）；動態模式暫停時的行為不變。
- `tick()` 的週期 `analyseRawFrame()` 在靜態模式停止（播放中每 500 ms 的 GPU
  readback）。代價：播放器控制列的「亮畫面加暗層」（`lg-video-bright`）不再跟著
  影片亮度變化 → 靜態模式下**固定開啟**（寧可多暗一點也要保持可讀）。
- 關閉靜態模式：丟掉快照、重新量一次 letterbox／亮度、立即畫當下畫面、恢復迴圈。
- `performance` 與 `static` 互相獨立（`performance` 仍是 15 fps 的即時光）。

### 已決策

- 擷取來源：**A（`<video>` 元素）**。不需要任何權限；B（`captureVisibleTab`）不做。
- 重取節奏：**不加週期性保險**，只在載入／暫停／跳轉時重取。
- `thumbs.js`：不需要額外複用，DRM／tainted 時既有的 `onBlocked` →
  `LG.thumbs.showVideo()` 已經是備援。
- popup 手動刷新按鈕：沒做。暫停或跳轉就會重取；若實際使用覺得需要再加。

### 驗證（headless Chromium + SwiftShader，真正的 `settings.js` / `contrast.js` / `ambient.js`）

測試影片：ffmpeg 產生，10 秒，前 0.4 秒全黑，上下各 45 px 黑邊，畫面持續變色。
`requestVideoFrameCallback` 與 `drawImage` 都有計數。16 項全部通過：

| 項目 | 結果 |
| --- | --- |
| 黑色開頭後擷取到非黑畫面 | 通過（平均亮度 115） |
| 靜態模式 `requestVideoFrameCallback` 次數 | 0 |
| 播放 2.5 秒內的重繪次數 | 0；背景像素完全不變 |
| `lg-still` | 有 |
| letterbox 黑邊沒烘進背景 | 通過（畫面下緣下方那列平均亮度 84，不是黑） |
| 捲動中重繪 | 0 次 |
| 捲動停止後 | 從快照重畫 1 次，沒有從影片取樣 |
| 跳轉、暫停 | 各重取 1 張新畫面 |
| 關閉靜態模式 | 迴圈恢復、`lg-still` 解除 |
| 播放中再開啟 | 迴圈立即停止 |
| 載入後尚未播放（第一格是黑的）時擷取 | 先顯示黑畫面；開始播放後重取到非黑畫面，仍無迴圈 |
| 縮圖淡入中（`showPixels`）擷取 | 快照勝出（對照：沒取消淡入時，紅色縮圖會蓋掉快照） |

主執行緒時間（播放中，每秒 ms，兩輪一致）：

| 情況 | Task | Script |
| --- | --- | --- |
| 不載入擴充 | 1–1.6 | 0 |
| **靜態模式** | **17–20** | **16–18** |
| 動態模式，暫停中（既有的 idle 狀態） | 20 | 19 |
| 動態模式，播放中 | 524–534 | 512–522 |

- 靜態模式播放中 ≈ 既有的暫停狀態，比動態播放少約 96%。剩下的是每 250 ms 一次的
  `tick()`（停掉計時器後降到 1.2 ms/s）；JS profiler 顯示其中我們的程式碼 5 秒內
  只佔約 1 ms，沒有 readback、沒有 layout。這筆差距是既有的 idle 開銷，不是這次引入的。
- 限制：SwiftShader 是軟體繪圖，GPU 端的開銷（模糊、合成）不在這些數字裡；
  實機耗電要用 DevTools 或 `tests/perf/suite.mjs` 量。

### 驗收（真實網站）

靜態模式背景在播放中不跟著動：實機相隔 6 秒的兩張截圖，播放器外的背景逐像素 Δ = 0，
播放器內 Δ = 76。

- [ ] 靜態模式下**沒有每幀排程**（headless 已驗證），播放 30 秒後 DevTools
      Performance 記錄為 idle
      （2026-10-08 實機：靜態 10 秒內擴充功能的 `requestVideoFrameCallback` 0 次，
      動態 5 秒 120 次；整頁 TaskDuration 靜態 57、動態 219 ms/s，含 YouTube 自己的
      播放開銷，**缺「不載入擴充」的基準**，所以還不能說是 idle）
- [ ] 殘留的 rAF 使用者仍正常且不影響結果：`tick()` 的 scrim 漸層
      (`scrimRaf`)、glow 定位 (`glowRaf`)、縮圖淡入 (`fadeRaf`)、
      指標高光 (`specAngle`, `main.js`)
- [x] 漂移動畫停止（實機 `lg-still` = true）
- [x] 頁面載入、切換影片（SPA 導頁）、暫停／seek 時背景都會更新
      （實機：seek 後背景跟著新畫面；點推薦影片 SPA 換片後背景換成新影片的色調）
- [ ] 捲動停止、theater 切換、視窗 resize 後，backdrop 重新對位到播放器，
      無錯位；捲動進行中不會每幀重繪（實機：捲動、resize 後對位正確；
      靜態模式下的 theater 切換未測）
- [ ] 新載入的 letterbox 影片：黑邊沒有被烘進色盤（headless 已驗證；實機未找片測）
- [ ] YouTube 廣告：廣告結束切回正片時重取（應由 `loadeddata` 觸發，需實機確認；
      測試帳號是 Premium，沒有廣告可測）
- [x] 玻璃質感與 Transparency 0 / 50 / 100 皆保留，視覺與動態模式一致（實機截圖）
- [ ] scrim map 仍正確求解，文字對比達到目標（淺色、深色主題）
- [ ] 影片暫停／結束後背景仍是該幀，不退回黑底（實機：暫停 ✓；播完未測）
- [ ] DRM / tainted 影片正確退到縮圖，不報錯
- [x] 關閉靜態模式後即時環境光完全恢復，無殘留狀態
      （實機：關閉後 4 秒 120 次 rVFC，`lg-still` 解除）
- [ ] 效能量測：實機上靜態模式、動態模式、關閉插件三者比較（只有前兩者，見第一項）
- [x] README、popup 說明、PRIVACY／`store/listing.md` 補上新的設定項
      （PRIVACY 原本也漏列「backdrop mode」，一併補上）
- [x] 動畫瘋：同一套程式路徑，需實機看一次（實機：靜態 8 秒內 rVFC 0 次，畫面正常）

## 設定頁（options page）＋抖內按鈕

狀態：2026-10-07 已實作（分支 `feat/reflection`），headless 端對端測試通過。抖內按鈕目前是
**測試假連結** `https://example.com/glasslight/donate-test`（`src/options/options.js`
的 `DONATE_URL`），頁面上會顯示「測試連結」標籤，`scripts/build.py` 會拒絕打包。
**待辦：申請 TapPay Link Pay，把連結換成正式結帳頁。**

### 實作摘要

- `manifest.json`：`options_ui`（`open_in_tab: true`）。**權限沒有任何變動**。
- `src/shared/defaults.js`：`DEFAULTS` 唯一的定義（含 `clampSettings`），內容腳本、
  popup、設定頁都載入它；`settings.js` 與 `popup.js` 的重複定義已移除。
- `src/shared/prefs.js`（popup 與設定頁共用）：
  - 語系：選定的語言與「跟隨瀏覽器」都自己解析成 6 種之一，標籤與說明來自同一語系
    （順便修正：Chrome 對 zh-HK 沒有 zh 可退，原本會顯示英文，現在顯示繁中）。
  - 控制項與 `storage.sync` 雙向綁定：`storage.onChanged` 只更新變動的欄位，
    本頁還沒寫出的欄位不會被蓋掉。
  - 寫入：最後一次變動後 400 ms 批次寫入；放開滑桿或切換開關時立即寫入，但兩次
    寫入至少間隔 1 秒（按住方向鍵也不會超過配額）；失敗時顯示原因並 20 秒後重試；
    popup 關閉（`pagehide`）時盡力送出。
  - 狀態列：儲存中／已儲存／儲存失敗／太頻繁（`role="status"`）。
- `src/options/`：設定頁。一般（啟用、語言）→ 外觀（光、模糊、透明度、折射、降低透明度）
  → 行為（背景模式、效能模式、靜態背景）→ 進階（對比目標、Reset）→ 支持開發。
  兩欄 grid、600 px 以下單欄、`color-scheme`、深淺色、`prefers-reduced-motion`。
  Reset 只在進階區，**按兩次**才執行（第一次變成「再按一次以重設」，4 秒後還原）。
- 說明文字：`src/options/descriptions/<locale>.json` × 6，內容依程式實際行為撰寫
  （例：效能模式＝15 fps、不漂移、背景模糊上限 10 px、關閉折射；降低透明度＝玻璃
  96% 不透明、環境光約 1/4）。說明中引用的選項名稱都對齊各語系實際標籤。
- popup：改用共用模組，新增「所有設定與說明」（`openOptionsPage()` 後
  `window.close()`）與儲存狀態；保留原本的 Reset。
- `background.js`：首次安裝開一次設定頁。效能測試每次都用新 profile，所以每次都會
  觸發；`tests/perf/run.mjs` 會關掉這類非測試分頁（`result.strayPages`），不影響量測。
- `scripts/build.py`：驗證 `options_ui` 檔案存在、6 語系說明檔齊全且鍵相同、
  `DONATE_URL` 不是測試連結。

### 與規劃不同之處（及理由）

1. **說明檔放在 `src/options/descriptions/`，不放 `_locales/<lang>/`**：
   不確定 Chrome／商店審查對 `_locales` 裡的非 `messages.json` 檔案的處理方式，
   放在 `src/` 下沒有這個風險。
2. **抖內獨立成最後一節「支持開發」，不放在「進階」**：付款按鈕和 Reset 放在同一區
   容易混淆，獨立一節也讓「與功能無關」的說明更清楚。
3. **首次安裝除了 `reason === 'install'`，還加了 `storage.local` 旗標**：實測發現
   用指令列載入的未封裝擴充功能每次啟動都會回報 `install`；商店安裝不會，但旗標
   能讓「只開一次」在所有情況下成立。
4. **抖內按鈕配色**：用深玫瑰→深橘漸層，白字在兩端皆 ≥ 5.3:1（原本想用的亮橘只有
   約 2.3:1，未達 AA）。

### 驗證（headless Chromium，載入真正的未封裝擴充功能）

32 項全部通過：

| 項目 | 結果 |
| --- | --- |
| 首次安裝自動開啟設定頁 | 1 個分頁 |
| 重新啟動不再開啟 | 0 個（加旗標前會再開一次） |
| 6 語系：所有標籤與說明非空、`lang` 屬性正確 | 12 項通過 |
| 「跟隨瀏覽器」解析 | zh-TW/zh-HK→zh_TW、zh-CN/zh→zh_CN、ja、ko-KR→ko、es-419→es、fr/en-GB→en |
| 滑桿連續 50 次 input | 寫入 1 次，存入最後的值，顯示「已儲存」 |
| 按住方向鍵 20 次 | 寫入 1 次，存入最後的值 |
| 設定頁 → popup、popup → 設定頁、語言跨頁同步 | 通過 |
| Reset 只在進階區；按一次不動作、按第二次才重設（語言保留）；popup 跟著更新 | 通過 |
| 抖內按鈕在新分頁開啟結帳網址；測試標籤可見 | 通過（沙箱無網路，以導向網址判斷） |
| Tab 順序依頁面順序；Space 切換開關；開關有焦點框 | 通過 |
| 1100 px 雙欄、420 px 單欄、無水平捲動 | 通過 |
| popup 的「所有設定」不會開出重複分頁 | 通過 |
| 頁面無 JS 錯誤 | 通過 |

對比（說明文字在卡片上，含角落色暈）：深色 6.9–7.6:1、淺色 6.6–7.1:1；內文 13.7:1 以上。
靜態模式的 16 項回歸測試在改用 `defaults.js` 後重跑，全部通過。
`build.py` 在測試連結下如預期失敗；換成非測試網址的副本可完整打包（37 個檔案）。

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
      （`options_ui` 與 popup 連結 headless 已驗證；右鍵選單需實機）
- [x] 首次安裝會自動開一次設定頁（且只開一次）
- [x] 設定頁可調整所有功能，控制項即時生效（與 popup 雙向同步）
      （寫入 storage 有 400 ms 批次；內容腳本的即時套用需實機看一次）
- [x] 每個功能下方都有說明，內容與實際行為一致（`performance` 說明要與
      15 fps／新增的靜態模式一致）
- [x] 6 種語言的說明皆完整，沒有漏翻或顯示 key 名（翻譯品質建議找母語者看一次）
- [x] 選項「自動」時跟隨瀏覽器語言；選特定語言時設為 `lang` 屬性正確
- [x] `DEFAULTS` 只剩一份定義，popup 與設定頁共用
- [ ] 抖內按鈕開啟台灣託管結帳頁（TapPay Link Pay），該頁自動提供
      Apple Pay / Google Pay；在 `chrome-extension://` 內不嘗試載入支付 SDK
      （開新分頁、不載入 SDK 已完成；**待換成正式 TapPay 連結**並實測錢包）
- [x] NT$100 固定金額、單一按鈕；不抖內時功能與外觀完全無差異
- [x] 設定頁明寫賣家是開發者本人（非 Google）、自願贊助、與功能無關、
      無退款（不提供商品或服務）
- [x] 抖內不需 webhook、不需權限驗證、不控管任何功能（純自願贊助）
- [x] 權限清單沒有變動（仍只需 `storage` + `https://i.ytimg.com/*`）
- [ ] 境外信用卡也能付款（TapPay 國外卡路徑實測一次）
- [ ] PRIVACY.md、`store/listing.md`、README 已更新並通過商店審查
      （文件已更新；商店審查待送出）
- [x] 設定頁在窄視窗（< 600px 單欄）與一般分頁寬度下版面正常
- [x] Reset 只出現在進階區，不在主頁（popup 仍保留原本的 Reset）
- [x] 鍵盤可完整操作（Tab 順序、Space 切換 toggle）
- [x] 連續拖曳任一滑桿不會觸發 `storage.sync` 配額錯誤，且有「已儲存」提示

## PR #7 效能測試：待驗證

狀態：2026-10-08 本機跑 `tests/perf/suite.mjs --debug`（22fe5fc 對 main），結果在
`docs/perf/2026-10-08-pr7/`。YouTube 四格 PASS；**ani/light 在
`max-glass/ani-battle` 第 0 張凍結畫面 FAIL**（頁首 mean Δ 31）；ani/dark 與第 2 輪沒跑到。

### 目前已知（事實）

- 兩邊頁首**背後的畫面相同**：cand ＝ base 均勻疊上一層白（各區 a ≈ 0.42，連兩條玻璃之間
  也有）。差的是可讀性狀態（scrim／玻璃底色），不是畫面、不是倒影（比對範圍止於 y 710，
  影片底邊在 709）。
- **未達對比目標的是 base**：max-glass 目標 1.5:1，base 右半導覽列文字 **1.15:1**，
  cand 3.55:1。
- 為什麼 base 停在過期狀態：**未確認**。沙箱連不到動畫瘋（403），軟體解碼也重現不出
  跳轉競態；兩版有差異的程式路徑都碰不到頁首的 scrim 格與 masthead 求解。

### 推論（未驗證）

- 候選一：暫停＋跳轉之後，最後一次取樣與求解用的畫面和最後顯示的畫面不同。
- 候選二：scrim 的 240 ms 漸變只靠 `requestAnimationFrame` 推進；若當時 rAF 沒有執行
  （例如視窗被遮或螢幕休眠），畫面上的 scrim 會停在舊值，而 `tick()` 在 settled 後提早
  返回、不再重畫。

### 已做（`faaca5d`，只動測試工具）

凍結畫面穩定後強制重新取樣求解（`LG.ambient.tick()`）再拍一張：畫面改變即
`state-current` 失敗（cand FAIL、base WARN），存 `-fresh.png`；base 過期時 cand 改與
base 的 fresh 畫面比，門檻不放寬。離線已驗證判定邏輯與「狀態正確時不誤報」（Δ 0–0.28）。

### 待驗證

- [ ] 在本機重跑完整 debug suite（harness 指紋已變，base 快取會重建）：
      `caffeinate -d -i -u node tests/perf/suite.mjs --debug --base origin/main --cand HEAD --window 0,0`
- [ ] 判讀 `ani/light/max-glass/ani-battle/0@1201s`：
  - [ ] 若 **base** 的 `state-current` 為 WARN、凍結畫面比對 PASS → 證實是 main 既有缺陷
        （凍結後可讀性狀態過期），進行下一項
  - [ ] 若 base `state-current` 正常但仍 DIFF → 上面的推論錯誤，差異是 PR 造成的，
        把新結果（含 `-fresh.png`）交回重查
- [ ] cand 所有凍結畫面的 `state-current` 都通過（cand 若失敗即為本 PR 的問題）
- [ ] 若證實是 main 的缺陷：找出根因（先檢查上面兩個候選），另開 PR 修 main；修好後
      本 PR 再對新的 main 跑一次，該格應無 WARN
- [ ] RAM 成長警告（`max-glass/ani-battle`，cand 4 次中 2 次，base 從未出現）：多跑幾輪看
      是否重現；若只在 cand 出現，比對 heap snapshot 找是否有每幀累積的配置
- [ ] `yt/light/solid-glow` RAM ×1.16 警告：觀察是否重現（軟門檻）
- [ ] ani/dark 與第 2 輪：跑完
- [ ] harness 不涵蓋的部分手動檢查：縮圖光（首頁、搜尋、頻道頁）、popup 與設定頁 UI
- [ ] （可選）`suite.mjs` 自己保持螢幕不休眠，不必依賴外部 `caffeinate`
      （報告：螢幕休眠時 Chromium 停止繪製，動畫瘋那格卡在 `waitPlayable` 2 小時）

## 已知缺口 / 後續

- [x] 非播放頁縮圖取色：首頁、列表、搜尋、觀看紀錄以滑鼠所在或畫面中央的作品封面點亮背景（`p2.bahamut.com.tw` 有開 CORS，不需新增權限）
- [x] 正式名稱改為 "Glasslight"；網站名稱只出現在說明中，六語系說明、README、PRIVACY、商店文案都附免責與商標聲明
- [x] 重新產生宣傳圖，副標改為 "Glass & ambient light for video"（本機用 `NOTO_DIR=<字型資料夾>` 指定 Noto Sans）
- [x] `PRIVACY.md` 與 `store/listing.md` 補上新增網站（單一用途與權限說明也已更新）
- [x] 合併到 `main`、升版本 1.1.0、`python3 scripts/build.py`、發 Release `v1.1.0`
- [ ] 若選擇器有誤，集中修改 `src/content/ani-gamer.js` 的 `LG.site` 與 `NAV_GLASS`，以及 `src/styles/ani-gamer.css`
