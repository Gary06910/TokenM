# Token M 微信小程序 Design System

状态：`FROZEN v1`  
视觉目标：premium developer utility；calm、precise、high information clarity。

## 1. Taste Skill 调用与平台适配

安装命令：

```text
npx --yes skills add https://github.com/Leonxlnx/taste-skill --skill gpt-taste
```

安装位置：主仓库 `.agents/skills/gpt-taste/SKILL.md`。该 skill 的强层级、宽标题、按钮对比、卡片克制、去模板化和交互反馈原则适用；AIDA 营销页、巨大 section spacing、远程 stock image、React/Tailwind 和 GSAP 强制项不适用于原生工具型微信小程序，依据用户要求明确排除。

<design_plan>
Python RNG mock: seed=len("Token M WeChat utility")=22 -> Hero="Editorial Split", Font="Geist".
Python RNG mock: components=["Horizontal Accordion", "Inline Typography Image", "Feedback Carousel"].
Python RNG mock: motion=["Scrubbing Text Reveal", "Card Stacking"] -> platform gate rejects GSAP; maps only to native pressed feedback and bounded list transitions.
AIDA check: marketing AIDA is intentionally not used. Onboarding keeps only concise identity, one explanation, primary/secondary actions.
Hero math: onboarding title max-width 620rpx, 52rpx type, maximum 2 lines; no badges, stamps, stats or image hero.
Bento density: no bento grid is used; dashboard has one quota focus row plus plain sections, preventing empty grid cells and card overuse.
Label/button check: no SECTION/QUESTION meta-labels; primary button #EAF2FF on #2878FF exceeds contrast target, disabled text remains readable.
</design_plan>

UI Worker 在实现前必须再次完整读取 skill；Lead 在最终截图/preview 审核再次按下方 audit checklist 执行。

## 2. Color tokens

```css
--tm-bg: #07111f;
--tm-bg-raised: #0a1727;
--tm-surface-1: #0d1b2b;
--tm-surface-2: #122238;
--tm-line: #20344d;
--tm-line-strong: #315071;
--tm-text-1: #f2f7ff;
--tm-text-2: #b4c2d4;
--tm-text-3: #7f91a7;
--tm-accent: #3f86ff;
--tm-accent-pressed: #2f6fd8;
--tm-accent-soft: #132e55;
--tm-success: #47c99a;
--tm-warning: #f0b95b;
--tm-danger: #ef7181;
--tm-info: #69a5ff;
--tm-skeleton: #15263a;
```

只允许 accent blue 作为品牌高亮；背景不使用渐变。Semantic colors 只用于状态点、短标签、notice 边线，不铺满大面积卡片。所有组合需通过 contrast audit。

## 3. Typography

微信原生不远程加载 Geist；使用平台高质量 system stack，视觉指标取 Geist 的紧凑、清晰特征：

```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
  "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
```

| Token | Size | Line height | Weight | Use |
|---|---:|---:|---:|---|
| display | 52rpx | 1.18 | 650/700 | onboarding title，最多 2 行 |
| metric | 64rpx | 1.0 | 700 | quota number only |
| title-1 | 40rpx | 1.3 | 650 | page title |
| title-2 | 32rpx | 1.4 | 600 | section/row title |
| body | 28rpx | 1.65 | 400 | primary body |
| label | 26rpx | 1.45 | 500 | buttons/status |
| meta | 24rpx | 1.5 | 400 | timestamps/help |
| code | 48rpx | 1.1 | 650 | pairing code; tabular numbers |

中文正文不使用全大写；英文 ID/状态保持短。字距默认，pair code `letter-spacing: 8rpx`。

## 4. Spacing and layout

Base unit 4rpx。Scale：`4, 8, 12, 16, 24, 32, 40, 48, 64rpx`。

- Page horizontal padding：32rpx（<=340px viewport 时 24rpx）。
- Major section gap：40rpx；related rows 16/24rpx。
- Bottom safe padding：`calc(32rpx + env(safe-area-inset-bottom))`。
- Content max width：750rpx；无横向 overflow。
- Dashboard 不把每个 section 放 card；页面最多 2 个 raised surfaces 同时抢占视觉。

## 5. Radius, border, elevation

Radius scale：8rpx（small control）、16rpx（button/input）、24rpx（primary surface）。禁止随意 30–40rpx pill；只有 status chip 可 pill。

Surface hierarchy 主要靠 background + 1rpx border，不靠阴影。允许浮层阴影：`0 16rpx 48rpx rgba(0,0,0,.28)`；常规 card 无 shadow。

## 6. Components

- Primary button：至少 96rpx 高，全宽仅在关键 action；accent background，浅色文字，pressed scale .985。
- Secondary button：透明 + strong line；不与 primary 同等饱和。
- Destructive button：默认 outline danger，确认弹层才可 solid danger。
- Row：最小 96rpx，左内容/右状态或 chevron；整行 click，pressed surface-2。
- Status marker：8–12rpx dot + 文本；不只颜色。
- Quota focus：数字、单位、状态、单个 CTA；避免 gauge/环形图。
- Notice：左 4rpx semantic border + plain background；最多两行主说明，可展开详情。
- Skeleton：与最终布局同尺寸，1.2s opacity pulse；尊重 reduced motion（如果基础能力不可检测则保持低幅度）。
- Empty/error：不使用 emoji；允许由 CSS line/icon 或本地 SVG 构成的 48rpx 标记。

## 7. Interaction and motion

- Pressed：120ms；modal/notice enter：160–200ms opacity + 8rpx translate；skeleton pulse 1200ms。
- 不使用 scroll hijack、parallax、card stacking、infinite marquee、carousel、自动轮播或 GSAP。
- 倒计时每秒更新数字，不做跳动 scale。
- Loading 不阻断返回导航；提交按钮防 double tap并显示短状态。

## 8. Iconography

Token M 自有 1.5–2px 等效线性 icon，24px viewBox，round cap 但非可爱化。功能 icon：home/tasks/computer/bell/settings/chevron/close/retry/check/warning。禁止 emoji、第三方品牌图标和不明许可证素材。Tab/navigation icon 与文本同时出现。

## 9. Responsive and long text

- 320px 宽：header action 可缩为 icon+accessible label，metric/CTA 可上下排列。
- 375–430px：默认单列。
- Pair code 不换行；空间不足降低 letter spacing，不降低触控区。
- Device/project 单行 ellipsis；summary/detail 正常换行并使用 `word-break: break-word`。
- 大字体下按钮允许两行，minimum height 而非固定 height。

## 10. Final visual audit

逐页检查：hierarchy、32rpx rhythm、card 数量、CTA 唯一性、accent 使用、中文断行、quota 状态、pair code 对齐、privacy detail、skeleton 尺寸、empty/error realism、pressed/disabled、safe area、小屏无横滚。

任何主要页面出现以下项即 Major：营销 Hero、渐变背景、glassmorphism、emoji icon、三层以上 card 嵌套、每个区块 card、低对比辅助文字、CTA 同级竞争、无 error/empty/loading、隐私任务泄露内容。
