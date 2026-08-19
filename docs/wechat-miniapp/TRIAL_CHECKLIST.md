# Token M 微信小程序体验版真机检查表

每次体验版上传单独复制本表。填写脱敏证据链接；不要粘贴 AppID、EnvID、Template ID、OpenID、配对码、credential、pepper、Authorization 或完整请求体。

## 记录

- 代码版本/上传版本：`<请填写>`
- 小程序体验版版本：`<请填写>`
- 云函数部署时间：`<请填写>`
- 测试日期与时区：`<请填写>`
- 微信客户端/OS/设备：`<请填写>`
- 测试人：`<请填写>`
- 证据位置：`<请填写访问受控的位置>`

## 前置门禁

- [ ] 指定开发版已设为体验版，测试微信号已加入体验成员。
- [ ] 微信后台体验版隐私指引已配置，联系信息真实可用。
- [ ] CloudBase collection/index/rules、函数、HTTPS gateway 与真实模板均已部署。
- [ ] 云函数 `WECHAT_MINIPROGRAM_STATE=trial`；真实 origin、EnvID、Template ID 与 mapping 已由第二人核对。
- [ ] 开发者工具 `urlCheck=true`，未开启域名/TLS/HTTPS 跳过选项；production validators 和 secret scan 通过。

## 真机路径

- [ ] 首次打开完成 bootstrap；没有 OpenID/hash/credential 泄露到 UI 或日志。
- [ ] 后台隐私指引/同意流程正常，数据与隐私页面与真实处理一致。
- [ ] 用户直接点击“补充 1 次通知”后出现真实 `requestSubscribeMessage` 弹窗；没有自动或循环申请。
- [ ] `accept` 只增加 1 次额度；重复 outcome 不重复增加。
- [ ] `reject` 与主开关关闭/受限路径给出明确中文状态且不增加额度。
- [ ] 生成配对码后倒计时、复制、刷新/旧码失效正确；码不进入日志证据。
- [ ] Desktop 输入 code 后成功绑定；renderer 只显示状态，不显示 credential。
- [ ] 错误、过期或已消费 code 返回统一错误，不泄漏 owner/剩余 TTL/attempts。
- [ ] 默认 privacy 完成一个真实 Codex 任务；task 中 project/model/summary/duration 为空，且无 prompt/完整历史/cwd/source/final response。
- [ ] 同一 event retry 三次仍只有一个 task、最多一次 provider attempt、额度最多减 1。
- [ ] 额度为 0 时另一个真实 task 仍保存，状态为 `skipped_no_quota` 且无微信发送。
- [ ] 有额度且 provider `errcode=0` 时，前台/后台/锁屏至少按测试设备支持范围看到真实服务通知。
- [ ] 通知字段符合真实 keyword 类型/长度，privacy 消息只有通用完成状态、时间和可选电脑名。
- [ ] 点击通知以 taskId 打开体验版任务详情，不跳开发版/正式版，也不泄露别人的 task。
- [ ] 成功发送后额度恰好 -1；明确失败释放 reservation；unknown 不自动重发且额度保持 reserved。
- [ ] 关闭任务通知后 task 仍保存但状态 `skipped_disabled`。
- [ ] 解绑后原 credential 的下一次状态/事件请求失败；重新配对产生新 desktop/credential。
- [ ] 清除任务记录后旧记录立即不可见；`cleanupPending` 语义正确。
- [ ] 删除测试账户后所有 desktop 立即撤销，账户 deleting 期间业务读写失败，后台清理可继续。

## 结论

- [ ] 所有必需项通过，Critical/Major 安全问题为 0。
- [ ] 未通过项已记录 owner、修复版本和复测时间。
- [ ] 结论仅为 `trial-ready`；不能据此声称审核通过、正式发布或所有设备锁屏必达。
