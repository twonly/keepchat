# 留存 · 隐私说明

更新日期：2026-11-12 · 适用于 KeepChat 1.0.4

开发者：twonly · [项目主页](https://github.com/twonly/keepchat) · [联系与反馈](https://github.com/twonly/keepchat/issues)

留存在用户点击扩展时读取当前 ChatGPT 对话的页面内容，用于生成本地文件。不需要 API Key，不提供账户系统，不上传对话，也不发送分析统计。

读取时会访问原页面引用的图片、字体和样式资源，以将它们内嵌到导出文件。同源请求可沿用页面登录状态；扩展不提取、保存或导出 Cookie、访问令牌、浏览历史和账户侧边栏。跨域受限图片优先通过扩展读取已授权的常用图片源；这些请求不携带登录凭据。仍无法读取时，会临时激活原对话标签页，调用浏览器截图并在内存中裁出图片区域。完整截图不保存或上传，仅裁出的图片会进入导出文件和预览缓存。请在截图期间保持原对话标签页，可按 Esc 取消；无法显示或安全裁取的图片会报告失败。

对话快照临时保存在扩展自身的本机 IndexedDB 中，用来恢复刷新后的预览。每份预览有独立 ID。超过 24 小时的记录在下次打开 / 访问缓存时清理；“清除本地预览”可以立即删除当前记录。卸载扩展会删除扩展存储。已经下载的文件由用户自行管理，不随预览清理或扩展卸载而删除。

导出的 HTML 不包含原页脚本，默认离线加载内嵌资源；用户主动点击其中的外部链接时会访问对应网站。来源链接可在导出前关闭，但这不会移除正文里原有的链接、附件地址、姓名或其他私人信息。

权限用途：

- `activeTab`：用户点击插件时临时访问当前标签页，并在必要时截图以保存页面上可见的图片。
- `scripting`：在该标签页执行读取与快照代码。
- `downloads`：打开另存为窗口并确认下载完成或中断。
- `images.openai.com`：读取对话中的公开图片资源。
- `www.google.com`、`*.gstatic.com`：读取 Google 网站图标端点；代码拒绝搜索页及其他非图标路径。

本项目不是 OpenAI 官方产品，不代表 OpenAI。

我们不将对话内容发送给开发者，不出售用户数据，不用于广告、信用评估或与导出无关的用途。上述资源请求仍会连接原资源网站，由这些网站接收处理请求所必需的网络信息；这些访问不是离线发生的。使用 GitHub 反馈问题时，请勿提交私人对话、Cookie 或令牌，GitHub 上主动提交的内容受其自身隐私政策约束。

## English privacy policy

Last updated: November 12, 2026. Applies to KeepChat 1.0.4.

Developer: twonly. [Project](https://github.com/twonly/keepchat) · [Contact / support](https://github.com/twonly/keepchat/issues).

KeepChat reads the current ChatGPT conversation when you invoke the extension, solely to create a local preview and export file. This can include text, images and personal information present in the conversation. KeepChat does not send that content to the developer, operate a backend or account system, collect analytics, sell data, or use it for advertising, credit decisions or unrelated purposes. No API key is required.

During capture, KeepChat requests image, font and stylesheet URLs referenced by the source page so those resources can be embedded. Same-origin requests can use the page's existing login context. Extension-side requests to allowed image and favicon hosts omit credentials. These requests contact the original resource providers, which receive the network information needed to serve them. KeepChat does not extract, store or export cookies, access tokens, browsing history or the account sidebar.

If a visible image cannot be read directly, KeepChat can temporarily activate the source tab, capture its viewport and crop the image in memory. The complete viewport screenshot is never written to a file, cached or uploaded. Only the resulting image crop can be included in the conversation preview and export. Keep the source tab active during capture; press Esc to cancel. Images that cannot be safely captured are reported as missing.

Conversation previews are stored in the extension's local IndexedDB with separate IDs so they survive a page refresh. Records older than 24 hours are removed on the next cache access; this is not a background deletion timer. The clear-preview button immediately deletes the current record. Uninstalling the extension removes its storage. Downloaded files are managed by you and remain after preview deletion or uninstall.

Exported HTML contains no source-page scripts and loads embedded resources offline. Clicking an external link opens the corresponding website. You can omit the conversation's source link before saving; this does not redact links, names, attachment addresses or other private information in the conversation. Review files before sharing them.

Permissions and purposes:

- `activeTab`: temporary access to the tab you invoke KeepChat on, including screenshot capture when needed for visible images.
- `scripting`: run the conversation extraction and snapshot code in that tab.
- `downloads`: save the requested export and track completion or interruption.
- `images.openai.com`: fetch public image resources used in conversations.
- `www.google.com` and `*.gstatic.com`: fetch website favicon resources. Code rejects non-favicon paths.

The extension has no all-sites permission, persistent website content scripts, analytics or remotely executed code. Please do not post private chats, cookies or tokens in public support issues. Information you choose to submit on GitHub is subject to GitHub's own policies.

KeepChat is independently developed and is not affiliated with or endorsed by OpenAI.
