import { _webp } from "./_webp-converter";

// item.status: ready -> converting -> done | error, done -> stale when the quality changes
const NEEDS_CONVERT = ["ready", "stale"];
// stale items still have their previous result to download
const HAS_RESULT = ["done", "stale"];
// when the webp is bigger than the original, retry this much lower, but never below MIN_QUALITY
const QUALITY_STEP = 15;
const MIN_QUALITY = 50;

export class _converterUI {
    constructor(root) {
        this.root = root;

        this.el = {
            dropzone: root.querySelector("[data-dropzone]"),
            input: root.querySelector("[data-file-input]"),
            warning: root.querySelector("[data-support-warning]"),
            quality: root.querySelector("[data-quality]"),
            qualityOutput: root.querySelector("[data-quality-output]"),
            results: root.querySelector("[data-results]"),
            summary: root.querySelector("[data-summary]"),
            list: root.querySelector("[data-list]"),
            clear: root.querySelector("[data-clear]"),
            downloadAll: root.querySelector("[data-download-all]"),
            downloadAllLabel: root.querySelector("[data-download-all-label]"),
            template: root.querySelector("[data-item-template]"),
        };

        this.items = [];
        this.busy = false;
        this.uid = 0;

        this.init();
    }

    init() {
        if (!_webp.isSupported()) this.el.warning.hidden = false;

        this.el.input.addEventListener("change", () => {
            this.add(this.el.input.files);
            this.el.input.value = "";
        });

        // drag & drop anywhere on the page, the drop zone lights up while files are over the window
        let depth = 0;
        const isFiles = (e) => e.dataTransfer?.types.includes("Files");
        const setDragging = (on) => (on ? (this.el.dropzone.dataset.dragging = "") : delete this.el.dropzone.dataset.dragging);

        window.addEventListener("dragenter", (e) => {
            if (!isFiles(e)) return;
            e.preventDefault();
            depth++;
            setDragging(true);
        });
        window.addEventListener("dragover", (e) => {
            if (isFiles(e)) e.preventDefault();
        });
        window.addEventListener("dragleave", (e) => {
            if (!isFiles(e)) return;
            depth = Math.max(0, depth - 1);
            if (!depth) setDragging(false);
        });
        window.addEventListener("drop", (e) => {
            if (!isFiles(e)) return;
            // stops the browser opening the image in the tab
            e.preventDefault();
            depth = 0;
            setDragging(false);
            this.add(e.dataTransfer.files);
        });

        // paste from clipboard
        window.addEventListener("paste", (e) => {
            if (e.target.closest?.("input:not([type=file]), textarea")) return;
            if (e.clipboardData?.files.length) this.add(e.clipboardData.files);
        });

        // re-convert everything once the user stops dragging the slider
        let timer;
        this.el.quality.addEventListener("input", () => {
            this.el.qualityOutput.value = this.el.quality.value;
            this.el.quality.style.setProperty("--fill", `${this.el.quality.value}%`);
            clearTimeout(timer);
            timer = setTimeout(() => {
                this.items.filter((item) => item.status === "done").forEach((item) => this.setStatus(item, "stale"));
                this.convert();
            }, 300);
        });

        this.el.clear.addEventListener("click", () => [...this.items].forEach((item) => this.remove(item)));
        this.el.downloadAll.addEventListener("click", () => this.downloadAll());

        this.render();
    }

    // 1-100, like the slider
    get quality() {
        return Number(this.el.quality.value);
    }

    add(fileList) {
        const files = [...fileList].filter((file) => _webp.isImage(file));
        files.forEach((file) => {
            const li = this.el.template.content.firstElementChild.cloneNode(true);
            const item = {
                id: ++this.uid,
                file,
                name: _webp.rename(file.name || "image"),
                li,
                thumbUrl: URL.createObjectURL(file),
            };

            const thumb = li.querySelector("[data-thumb]");
            // e.g. heic outside Safari: a tile with the file type instead of a broken image icon
            thumb.addEventListener(
                "error",
                () => {
                    const tile = Object.assign(document.createElement("span"), {
                        className: `${thumb.className} flex items-center justify-center text-xs font-medium uppercase text-theme-muted`,
                        textContent: file.name.split(".").pop().slice(0, 4) || "?",
                    });
                    thumb.replaceWith(tile);
                },
                { once: true }
            );
            thumb.src = item.thumbUrl;
            li.querySelector("[data-name]").textContent = file.name || "Pasted image";
            li.querySelector("[data-remove]").addEventListener("click", () => this.remove(item));

            this.items.push(item);
            this.el.list.append(li);
            this.setStatus(item, "ready");
        });
        this.render();
        this.convert();
    }

    remove(item) {
        item.removed = true;
        URL.revokeObjectURL(item.thumbUrl);
        if (item.webp) URL.revokeObjectURL(item.webp.url);
        item.li.remove();
        this.items = this.items.filter((i) => i !== item);
        this.render();
    }

    // one at a time to keep memory down with large batches, picks up items added or changed while running
    async convert() {
        if (this.busy) return;

        this.busy = true;
        window.dispatchEvent(new CustomEvent("converter:busy", { detail: true }));

        let item;
        while ((item = this.items.find((i) => NEEDS_CONVERT.includes(i.status)))) {
            const quality = this.quality;
            this.setStatus(item, "converting");
            this.render();
            try {
                const { blob, width, height, quality: used } = await this.encodeSmaller(item.file, quality);
                if (item.removed) continue;
                if (item.webp) URL.revokeObjectURL(item.webp.url);

                // what the download buttons hand out: the webp, or the original when it's still smaller
                const keptOriginal = blob.size >= item.file.size;
                item.webp = { blob, url: URL.createObjectURL(blob) };
                Object.assign(item, {
                    width,
                    height,
                    keptOriginal,
                    loweredQuality: used !== quality ? used : null,
                    blob: keptOriginal ? item.file : blob,
                    url: keptOriginal ? item.thumbUrl : item.webp.url,
                    name: keptOriginal ? item.file.name || "image" : _webp.rename(item.file.name || "image"),
                });
                // the slider moved while this one was converting
                this.setStatus(item, quality === this.quality ? "done" : "stale");
            } catch (err) {
                item.error = err.message || "Conversion failed";
                this.setStatus(item, "error");
            }
        }

        this.busy = false;
        window.dispatchEvent(new CustomEvent("converter:busy", { detail: false }));
        this.render();
    }

    // a bigger webp gets retried at lower quality before giving up
    async encodeSmaller(file, quality) {
        let result = await _webp.convert(file, { quality: quality / 100 });
        let used = quality;
        while (result.blob.size >= file.size && used > MIN_QUALITY) {
            used = Math.max(used - QUALITY_STEP, MIN_QUALITY);
            result = await _webp.convert(file, { quality: used / 100 });
        }
        return { ...result, quality: used };
    }

    setStatus(item, status) {
        item.status = status;

        const meta = item.li.querySelector("[data-meta]");
        const badge = item.li.querySelector("[data-badge]");
        const link = item.li.querySelector("[data-download]");
        const webpLink = item.li.querySelector("[data-download-webp]");
        const size = _webp.formatBytes(item.file.size);

        meta.classList.toggle("text-red-400", status === "error");
        meta.classList.toggle("light:text-red-600", status === "error");
        meta.classList.toggle("text-theme-muted", status !== "error");
        badge.classList.toggle("sm:inline-block", HAS_RESULT.includes(status));

        if (status === "ready") meta.textContent = `${size} · Waiting…`;
        if (status === "converting") meta.textContent = `${size} · Converting…`;
        if (status === "error") meta.textContent = item.error;
        if (status === "stale") meta.textContent = `${size} → ${_webp.formatBytes(item.blob.size)} · Updating…`;

        if (status === "done" && item.keptOriginal) {
            meta.textContent = `${size} · WebP would be ${_webp.formatBytes(item.webp.blob.size)}, keeping the original`;
            badge.textContent = "Original";
        } else if (status === "done") {
            const saved = Math.round((1 - item.blob.size / item.file.size) * 100);
            meta.textContent = `${size} → ${_webp.formatBytes(item.blob.size)} · ${item.width}×${item.height}` + (item.loweredQuality ? ` · quality ${item.loweredQuality}` : "");
            badge.textContent = `−${saved}%`;
        }
        if (status === "done") {
            badge.classList.toggle("bg-theme-accent/15", !item.keptOriginal);
            badge.classList.toggle("text-theme-accent", !item.keptOriginal);
            badge.classList.toggle("bg-theme-line", item.keptOriginal);
            badge.classList.toggle("text-theme-muted", item.keptOriginal);
        }

        // the webp is still there if the user needs that format
        webpLink.hidden = !(status === "done" && item.keptOriginal);
        if (!webpLink.hidden) {
            webpLink.href = item.webp.url;
            webpLink.download = _webp.rename(item.file.name || "image");
        }

        // keep the last result downloadable until it's replaced
        if (item.blob && status !== "error") {
            link.href = item.url;
            link.download = item.name;
            link.removeAttribute("aria-disabled");
        } else {
            link.removeAttribute("href");
            link.setAttribute("aria-disabled", "true");
        }
    }

    render() {
        const done = this.items.filter((item) => HAS_RESULT.includes(item.status));

        this.el.results.hidden = this.items.length === 0;
        this.el.downloadAll.disabled = this.busy || done.length === 0;
        this.el.downloadAllLabel.textContent = this.busy ? "Converting…" : done.length > 1 ? `Download all (${done.length})` : "Download";

        const before = done.reduce((sum, item) => sum + item.file.size, 0);
        const after = done.reduce((sum, item) => sum + item.blob.size, 0);
        const saved = before ? Math.round((1 - after / before) * 100) : 0;

        // only numbers go into the markup, file names never do
        const progress = `${done.length} of ${this.items.length} converted`;
        this.el.summary.innerHTML = done.length
            ? `<span class="block font-display font-semibold text-xl text-theme-text">${_webp.formatBytes(before)} → ${_webp.formatBytes(after)}</span>${progress} · <span class="font-medium text-theme-accent">${saved >= 0 ? `${saved}% smaller` : `${-saved}% larger`}</span>`
            : progress;
    }

    async downloadAll() {
        const done = this.items.filter((item) => HAS_RESULT.includes(item.status));
        if (done.length === 1) return _webp.download(done[0].blob, done[0].name);

        this.el.downloadAll.disabled = true;
        try {
            // originals that beat their webp go in as they are
            const zip = await _webp.zip(done.map(({ name, blob }) => ({ name, blob })));
            _webp.download(zip, "webp-images.zip");
        } finally {
            this.render();
        }
    }
}
