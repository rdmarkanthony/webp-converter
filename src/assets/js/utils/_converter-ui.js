import { _webp } from "./_webp-converter";

export class _converterUI {
    constructor(root) {
        this.root = root;

        this.el = {
            dropzone: root.querySelector("[data-dropzone]"),
            input: root.querySelector("[data-file-input]"),
            warning: root.querySelector("[data-support-warning]"),
            quality: root.querySelector("[data-quality]"),
            qualityOutput: root.querySelector("[data-quality-output]"),
            maxWidth: root.querySelector("[data-max-width]"),
            maxHeight: root.querySelector("[data-max-height]"),
            results: root.querySelector("[data-results]"),
            summary: root.querySelector("[data-summary]"),
            list: root.querySelector("[data-list]"),
            clear: root.querySelector("[data-clear]"),
            downloadAll: root.querySelector("[data-download-all]"),
            template: root.querySelector("[data-item-template]"),
        };

        this.items = [];
        this.queue = Promise.resolve();
        this.uid = 0;

        this.init();
    }

    init() {
        if (!_webp.isSupported()) this.el.warning.hidden = false;

        this.el.input.addEventListener("change", () => {
            this.add(this.el.input.files);
            this.el.input.value = "";
        });

        // drag & drop
        ["dragenter", "dragover"].forEach((type) =>
            this.el.dropzone.addEventListener(type, (e) => {
                e.preventDefault();
                this.el.dropzone.dataset.dragging = "";
            })
        );
        ["dragleave", "drop"].forEach((type) =>
            this.el.dropzone.addEventListener(type, (e) => {
                e.preventDefault();
                delete this.el.dropzone.dataset.dragging;
            })
        );
        this.el.dropzone.addEventListener("drop", (e) => this.add(e.dataTransfer.files));

        // paste from clipboard
        window.addEventListener("paste", (e) => {
            if (e.target.closest?.("input:not([type=file]), textarea")) return;
            if (e.clipboardData?.files.length) this.add(e.clipboardData.files);
        });

        // settings: re-convert everything after the user stops adjusting
        let timer;
        const onSettings = () => {
            this.el.qualityOutput.value = this.el.quality.value;
            clearTimeout(timer);
            timer = setTimeout(() => this.items.forEach((item) => this.enqueue(item)), 250);
        };
        [this.el.quality, this.el.maxWidth, this.el.maxHeight].forEach((input) => input.addEventListener("input", onSettings));

        this.el.clear.addEventListener("click", () => [...this.items].forEach((item) => this.remove(item)));
        this.el.downloadAll.addEventListener("click", () => this.downloadAll());
    }

    get settings() {
        return {
            quality: Number(this.el.quality.value) / 100,
            maxWidth: Number(this.el.maxWidth.value) || 0,
            maxHeight: Number(this.el.maxHeight.value) || 0,
        };
    }

    add(fileList) {
        const files = [...fileList].filter((file) => file.type.startsWith("image/"));
        files.forEach((file) => {
            const li = this.el.template.content.firstElementChild.cloneNode(true);
            const item = {
                id: ++this.uid,
                file,
                name: _webp.rename(file.name || "image"),
                li,
                thumbUrl: URL.createObjectURL(file),
                version: 0,
            };

            li.querySelector("[data-thumb]").src = item.thumbUrl;
            li.querySelector("[data-name]").textContent = file.name || "Pasted image";
            li.querySelector("[data-download]").download = item.name;
            li.querySelector("[data-remove]").addEventListener("click", () => this.remove(item));

            this.items.push(item);
            this.el.list.append(li);
            this.enqueue(item);
        });
        this.render();
    }

    remove(item) {
        item.removed = true;
        URL.revokeObjectURL(item.thumbUrl);
        if (item.url) URL.revokeObjectURL(item.url);
        item.li.remove();
        this.items = this.items.filter((i) => i !== item);
        this.render();
    }

    // convert one at a time to keep memory down with large batches
    enqueue(item) {
        const version = ++item.version;
        const settings = this.settings;
        this.setStatus(item, "Waiting…");

        this.queue = this.queue.then(async () => {
            if (item.removed || version !== item.version) return;
            this.setStatus(item, "Converting…");
            try {
                const { blob, width, height } = await _webp.convert(item.file, settings);
                if (item.removed || version !== item.version) return;
                if (item.url) URL.revokeObjectURL(item.url);
                Object.assign(item, { blob, url: URL.createObjectURL(blob), width, height, error: null });
            } catch (err) {
                if (version !== item.version) return;
                Object.assign(item, { blob: null, error: err.message || "Conversion failed" });
            }
            this.renderItem(item);
            this.render();
        });
    }

    setStatus(item, text) {
        item.blob = null;
        item.li.querySelector("[data-meta]").textContent = `${_webp.formatBytes(item.file.size)} · ${text}`;
        const link = item.li.querySelector("[data-download]");
        link.setAttribute("aria-disabled", "true");
        link.removeAttribute("href");
        item.li.querySelector("[data-badge]").textContent = "";
        this.render();
    }

    renderItem(item) {
        const meta = item.li.querySelector("[data-meta]");
        const badge = item.li.querySelector("[data-badge]");
        const link = item.li.querySelector("[data-download]");

        if (item.error) {
            meta.textContent = item.error;
            meta.className = "mt-1 text-xs text-red-600";
            return;
        }

        const before = item.file.size;
        const after = item.blob.size;
        const diff = Math.round(((after - before) / before) * 100);

        meta.className = "mt-1 text-xs text-slate-500";
        meta.textContent = `${_webp.formatBytes(before)} → ${_webp.formatBytes(after)} · ${item.width}×${item.height}`;
        badge.textContent = diff <= 0 ? `−${Math.abs(diff)}%` : `+${diff}%`;
        badge.className = badge.className.replace(/\b(bg|text)-(emerald|amber)-\d+\b/g, "").trim() + (diff <= 0 ? " bg-emerald-50 text-emerald-700" : " bg-amber-50 text-amber-700");

        link.href = item.url;
        link.removeAttribute("aria-disabled");
    }

    render() {
        const done = this.items.filter((item) => item.blob);
        this.el.results.hidden = this.items.length === 0;
        this.el.downloadAll.disabled = done.length === 0;

        const before = done.reduce((sum, item) => sum + item.file.size, 0);
        const after = done.reduce((sum, item) => sum + item.blob.size, 0);
        const saved = before ? Math.round((1 - after / before) * 100) : 0;

        this.el.summary.textContent =
            `${done.length} of ${this.items.length} converted` + (done.length ? ` · ${_webp.formatBytes(before)} → ${_webp.formatBytes(after)} (${saved >= 0 ? `${saved}% smaller` : `${-saved}% larger`})` : "");
    }

    async downloadAll() {
        const done = this.items.filter((item) => item.blob);
        if (done.length === 1) return _webp.download(done[0].blob, done[0].name);

        this.el.downloadAll.disabled = true;
        try {
            const zip = await _webp.zip(done.map(({ name, blob }) => ({ name, blob })));
            _webp.download(zip, "webp-images.zip");
        } finally {
            this.render();
        }
    }
}
