# Changelog

## 1.0.5 — 2026-11-13

长对话导出增强：应对 ChatGPT 自动卸载屏幕外内容。自动滚动收集当前分支、逐轮合并并去重，明确区分弹窗局部数量与完整扫描后的实际收集总数。

- Scope temporary message identifiers to their conversation round so virtualized, remounted turns cannot overwrite earlier turns.
- Clarify that popup counts describe currently loaded page content; export preview scans the conversation before reporting collected totals.
- Keep the source tab active during capture, return to the preview afterward, and stop explicitly if the source goes into the background during a full scan.
- Preserve responsive position anchors so desktop decorations do not stretch mobile exports beyond the screen.
- Add browser regression coverage for top, middle and bottom starting positions, stable message IDs and recycled slots, repeated prompts, images, tables and scroll restoration.

## 1.0.4 — 2026-11-12

Initial public release of KeepChat.

- Export the rendered ChatGPT conversation branch to self-contained HTML, Markdown, or browser-printed PDF.
- Support ordinary conversations and shared pages, long-conversation scanning, local preview recovery and cancellation.
- Embed readable images and fonts, with cropped screenshot fallback for eligible visible images and explicit missing-resource reports.
- Recognize current conversation containers, message roles, reasoning summaries and image-only replies; deduplicate remounted messages.
- Keep table columns readable in mobile previews and exported HTML, with horizontal scrolling inside wide tables.
- Include synthetic browser regression tests for extraction, sanitization, downloads, image capture and responsive layout.

See the README for snapshot limitations and the privacy policy for local storage and resource requests.
