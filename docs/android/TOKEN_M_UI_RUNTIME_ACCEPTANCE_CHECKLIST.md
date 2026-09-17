# TOKEN_M_UI_RUNTIME_ACCEPTANCE_CHECKLIST

Cloud Build由用户执行：HBuilderX → App-Android/iOS-云打包 → 安装APK。请确认使用本轮源码。

- [ ] Login：输入、验证码、登录、错误提示。
- [ ] Register：用户名/密码/验证码、注册跳转。
- [ ] Home：状态真实，正常使用不堆积引导。
- [ ] Tasks：完成状态、电脑、时间、筛选/分页、隐私说明。
- [ ] Task detail：任务、电脑、时间、通知、隐私分组。
- [ ] Desktops：连接/最后在线、重命名、解除绑定确认。
- [ ] Pairing：六位码完整、倒计时、复制、取消返回、成功结果。
- [ ] Settings：通知开关、权限、隐私、关于、退出确认。
- [ ] Permission/onboarding：清单真实，未完成项可操作。
- [ ] 页面上下滚动：尤其权限页、注册页、长任务详情。
- [ ] 4-tab切换：已有内容立即出现，无整页闪空或卡顿回归。
- [ ] Light theme：文字/输入/底部导航清晰，窄屏不溢出、返回不显示方框。
- [ ] 完成一个新的真实Codex task。
- [ ] Android任务列表出现该新任务。
- [ ] Honor系统通知出现，点击后详情正常。

结果反馈前：RUNTIME_UI_ACCEPTANCE=PENDING_USER；Phase3不启动。
