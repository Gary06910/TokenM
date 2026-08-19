# 平台配置模板

本目录只保存可提交的空值模板和声明式部署清单，不保存任何部署实例的 AppID、EnvID、Template ID、pepper、设备 credential 或公网 origin。

- `miniprogram-runtime.example.json`：填值后把两个字段同步到 `miniprogram/config/runtime.js` 的同名键；真实运行文件由部署者本地管理。
- `cloudfunction.env.example.json`：云函数环境变量键集合。复制到仓库外填写，不要提交。
- `template-keyword-mapping.example.json`：把稳定语义字段映射到后台真实模板 keyword。`keyword` 必须来自模板详情，例如 `thing1`，不能凭示例猜测。
- `cloudbase-deployment.example.json`：部署审计清单，不冒充 CloudBase CLI 的一键导入格式。控制台变化时以官方界面为准。
- `database/`：collection、index 与逐 collection 默认拒绝规则。collection/index 清单用于控制台逐项创建和复核；rule 文件内容可逐项粘贴到安全规则编辑器。

本地校验：

```text
node wechat-miniapp/config/validate-platform-config.mjs
node wechat-miniapp/config/scan-secrets.mjs --self-test
node wechat-miniapp/config/scan-secrets.mjs
```

合并 UI 与云函数后追加打包闭包检查：

```text
node wechat-miniapp/config/validate-platform-config.mjs --integrated
```

若要校验仓库外的真实生产环境 JSON 与真实 keyword mapping，两个参数必须一起提供：

```text
node wechat-miniapp/config/validate-platform-config.mjs --production-env D:\\private\\tokenm-env.json --production-template D:\\private\\tokenm-template.json
```

生产校验要求 HTTPS origin、非 loopback、真实 mapping、两个不同且至少 32 字符的 pepper、完整正整数限制项，并要求环境中的 mapping 是真实 mapping 文件的单行 JSON 序列化结果。
