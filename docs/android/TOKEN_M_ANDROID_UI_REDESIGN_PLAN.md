# TOKEN_M_ANDROID_UI_REDESIGN_PLAN

BASELINE: TOKEN_M_ANDROID_PHASE2_PERFORMANCE_OPTIMIZED_BASELINE
AUDIT: TOKEN_M_CURRENT_UI_AUDIT.md 已完成，修改前 144/144 focused tests PASS。

CURRENT_UI_PROBLEMS
首页事实堆积；旧 Phase 1 文案；筛选抢首屏；通知与任务状态混淆；配对成功仍展示旧码；设置缺乏分组；长期用户仍看到初始化说明。

DESIGN_DIRECTION
安静、清晰、可信的 Codex 任务通知伴侣。默认 Light，延续已有视觉语言。

VISUAL_LANGUAGE
中性浅背景、白色 surface、深文字、单一克制蓝 CTA，无阴影、无新增动画、无装饰图片。

PAGE_BY_PAGE_PLAN
- Onboarding：收紧顶部留白，保留自动路由。
- Login/Register：统一品牌与表单间距，精简验证码说明，脚本和图片绑定逐字保留。
- Home：状态摘要、最近最多3条任务、电脑最多3台；正常时弱化通知 CTA；关闭通知必须明确说明，绝不仅凭权限显示正常。
- Tasks：保留筛选行为，将次级筛选折叠为本地展示状态；卡片突出已完成、电脑、时间、隐私说明。
- Task detail：任务、电脑与时间、通知、隐私分组；不增加接口或诊断。
- Desktops：原卡内管理，重复时间合并，重命名优先、解绑减弱；不新增详情路由。
- Pairing：六位码加大，成功后显示结果；原轮询/复制/刷新确认不变；取消并返回只离开页面，不声称撤销有效码。
- Settings：账户、通知、隐私、应用分组；保留开关及全部入口/退出确认。
- Permission：移除重复步骤，真实状态清单；已准备时进入 App 最突出；现有滚动与授权行为不变。
- Notifications：修正旧阶段说明，清晰开关状态及恢复入口。
- Privacy/About：同一排版，危险操作减弱，不更改确认行为。

COMPONENTS_TO_REUSE
全部5个现有共享组件：tm-header、tm-tab-bar、status-marker、ui-state、notice-banner。
COMPONENTS_TO_CREATE
NONE。通过全局样式复用，无组件库。
COMPONENTS_TO_REMOVE
NONE。移除页面内重复说明块与无用局部样式。

COLOR_TOKENS
BACKGROUND #f4f7fb；SURFACE #ffffff；SURFACE_SECONDARY #edf3fa；TEXT_PRIMARY #172033；TEXT_SECONDARY #475569；TEXT_MUTED #596b82；BORDER #d7e0ec；ACCENT #2869c9；SUCCESS #197a5a；WARNING #946200；ERROR #c24152。复用现有 tm 命名，accent/info统一。
TYPOGRAPHY
系统字体：Page 24/32，Section/Card 16/24，Body 14/22，Secondary 13/20，Caption 12/18；配对码32/44。只添加6个字号 token。
SPACING
复用现有4/8/12/16/20/24/32刻度。页面16、卡片16、区块24、表单标签16/8。
RADIUS
小6、输入/按钮10、surface16；底部选中状态背景12。保留原几何图标尺寸。
NAVIGATION_STYLE
冻结所有路径、items与switchTab脚本；强化选中文字和浅色选中背景，保留64高及safe-area。
STATUS_STYLE
status-marker统一，点只辅助文字；任务完成与通知发送分开；submitted为通知已发送，详情说明仅代表服务接受请求。
LOADING_STYLE
首次静态骨架；缓存内容不隐藏，后台更新仍由原有缓存逻辑控制；分页保持局部加载。
EMPTY_STYLE
短标题+下一步；区分无任务与筛选无结果；无电脑保留配对CTA。
ERROR_STYLE
保留presentError映射及缓存banner，用户语言，不输出内部错误字段。
PERFORMANCE_RISK
仅template/style/纯展示文案及本地筛选折叠状态；不更改任何读取、生命周期、await、PageSnapshot或导航。直接字节比较冻结服务和页脚本，新增展示状态从比较中明确剔除。
FUNCTIONAL_RISK
模板条件不可替代真实权限或backend状态；成功/过期配对不得更改定时器；Auth/Captcha脚本逐字保留；所有破坏性操作保留确认。
IMPLEMENTATION_ORDER
全局tokens/base与共享组件 → Home/任务 → 电脑/配对 → 设置/权限 → 登录注册 → 结构测试/基线字节对比 → 官方HBuilderX AppResource编译 → 报告。Cloud Build由用户提交。

参考：沿用Android可达触控区域与分组列表惯例；DCloud明确App CSS为子集，采用已验证属性与编译期SCSS变量：[DCloud CSS](https://doc.dcloud.net.cn/uni-app-x/css/)、[uni.scss](https://doc.dcloud.net.cn/uni-app-x/collocation/uni-scss.html)。不借用新版Web CSS能力。
