# Chrome Web Store review notes

Package: `keepchat-1.0.4.zip`. Primary language: Simplified Chinese. Category: Tools / Productivity, according to the dashboard's available taxonomy. No payments, subscriptions, ads or account with the developer.

## Single purpose

Save a user-selected, rendered ChatGPT conversation as a local file for offline reading and sharing, with an export preview. HTML, Markdown and browser-printed PDF are alternative formats for this same purpose.

## Permission justifications

- **activeTab:** After the user invokes KeepChat, read the selected ChatGPT tab's rendered conversation and source URL. It also enables captureVisibleTab for visible image crops if direct image reads fail. No background monitoring of other sites or browser history.
- **scripting:** Inject the packaged extraction code into the user-authorized ChatGPT tab to identify message containers, collect the current branch, copy rendered styles, inline readable resources and restore scrolling after capture. All executable code is bundled.
- **downloads:** Save the user's chosen HTML/Markdown export with the browser's Save As flow and report completion/interruption. No unrelated download management.
- **Host permissions:** `images.openai.com` provides public image resources used in conversations. `www.google.com` is restricted in code to `/s2/favicons`, and `*.gstatic.com` to favicon endpoints, to embed cited-site icons. `src/assets.js` validates HTTPS hosts/paths and omits credentials. These permissions support resource embedding only; no content scripts run automatically on these hosts.
- **Remote code:** None. Remote images, fonts and stylesheets are processed only as snapshot resources; no remote JavaScript or WebAssembly is executed. The archive is script-free and the preview iframe is sandboxed.

## Data handling

Website content and personal communications (the selected conversation) are processed locally for preview/export. The current source URL may be included in the file at the user's choice. No browser-history API, tracking, developer backend, analytics or sale of data. Resource fetches go to the original resource hosts. See [PRIVACY.md](../PRIVACY.md) for retention, deletion, screenshot cropping and external links. Dashboard disclosures must include local processing, not just transmissions.

## Test instructions

1. Use Chrome 120+ and open `https://chatgpt.com/`. Use your own ChatGPT account and create a short, non-sensitive conversation with at least two user messages. Ask for a small table and code block; an image is optional. Wait for responses to finish. KeepChat has no separate account, subscription, API key or paywall.
2. Click the KeepChat toolbar action. The popup should show the conversation title and message count. Click **打开导出预览** (Open export preview).
3. Wait until **保存为 HTML** (Save as HTML) is enabled. Check the desktop preview and click **手机** for the narrow preview; wide tables scroll horizontally inside the table. **桌面** returns to desktop preview.
4. Click **保存为 HTML**, choose a destination, and open the saved file with the network disconnected. Text and successfully embedded images should remain readable. Click **Markdown** to save editable text. **打印 / PDF** opens the browser's print flow.
5. Reload the workbench tab to restore the local preview. **清除本地预览** deletes that preview. Already downloaded files are not deleted.
6. Shared conversation pages under `/share/` and `/s/t_…` are also supported when accessible in the browser. Some pages require login or may be unavailable depending on their owner's settings.
7. During image screenshot fallback, keep the source tab active; Esc cancels. Missing or uncapturable resources are explicitly reported. Other branches, unloaded content, attachment files and dynamic media are outside the static snapshot's scope.

Public screenshots are generated from the fictional [demo](demo.html) in an isolated browser with the real extension. Reproduce with `node scripts/screenshots.mjs` after installing development dependencies and Playwright Chromium. They contain no real user conversation.
