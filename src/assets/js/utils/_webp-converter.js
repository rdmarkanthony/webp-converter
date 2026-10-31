import { zipSync } from "fflate";

const WEBP = "image/webp";

export const _webp = {
    // true if the browser can encode webp from a canvas
    isSupported() {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        return canvas.toDataURL(WEBP).startsWith(`data:${WEBP}`);
    },

    async decode(file) {
        // createImageBitmap honours EXIF orientation but can't read SVG in every browser
        if (file.type !== "image/svg+xml" && "createImageBitmap" in window) {
            try {
                return await createImageBitmap(file, { imageOrientation: "from-image" });
            } catch (e) {
                // fall through to <img>
            }
        }

        const url = URL.createObjectURL(file);
        try {
            const img = new Image();
            img.decoding = "async";
            img.src = url;
            await img.decode();
            return img;
        } finally {
            URL.revokeObjectURL(url);
        }
    },

    async convert(file, { quality = 0.8, maxWidth = 0, maxHeight = 0 } = {}) {
        const source = await this.decode(file);
        const srcW = source.naturalWidth || source.width;
        const srcH = source.naturalHeight || source.height;
        if (!srcW || !srcH) throw new Error("Could not read image dimensions");

        const scale = Math.min(1, maxWidth ? maxWidth / srcW : 1, maxHeight ? maxHeight / srcH : 1);
        const width = Math.max(1, Math.round(srcW * scale));
        const height = Math.max(1, Math.round(srcH * scale));

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(source, 0, 0, width, height);
        source.close?.();

        const blob = await new Promise((resolve) => canvas.toBlob(resolve, WEBP, quality));
        canvas.width = canvas.height = 0;

        if (!blob || blob.type !== WEBP) throw new Error("WebP encoding is not supported in this browser");
        return { blob, width, height };
    },

    rename(name) {
        return name.replace(/\.[^./\\]+$/, "") + ".webp";
    },

    formatBytes(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        const units = ["KB", "MB", "GB"];
        let i = -1;
        do {
            bytes /= 1024;
            i++;
        } while (bytes >= 1024 && i < units.length - 1);
        return `${bytes.toFixed(bytes < 10 ? 1 : 0)} ${units[i]}`;
    },

    async zip(entries) {
        const files = {};
        for (const { name, blob } of entries) {
            // de-duplicate names: photo.webp, photo-1.webp, ...
            let unique = name;
            for (let n = 1; unique in files; n++) unique = name.replace(/\.webp$/, `-${n}.webp`);
            // webp is already compressed, so store without deflate
            files[unique] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
        }
        return new Blob([zipSync(files)], { type: "application/zip" });
    },

    download(blob, name) {
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement("a"), { href: url, download: name });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
};
