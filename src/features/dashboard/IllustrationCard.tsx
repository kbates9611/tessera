import type { CSSProperties } from "react";
import { useMemo } from "react";
import {
  decodeIllustrationMaskBits,
  getIllustrationPreset,
  ILLUSTRATION_ALPHA_MASK_ENCODING,
  illustrationMaskPixelIsOn,
} from "../../domain/illustrations";
import type { IllustrationBitmapMask } from "../../domain/illustrations";
import type { DashboardBlock } from "../../domain/types";

export function IllustrationCard({ block }: { block: DashboardBlock }) {
  const showCaption = block.illustration.showCaption === true;
  return (
    <article
      className={`illustration-card${showCaption ? " has-caption" : ""}`}
    >
      {showCaption && (
        <header>
          <div>
            <small>{block.eyebrow || "ILLUSTRATION"}</small>
            <h3>{block.title}</h3>
          </div>
          <span>
            <i aria-hidden="true" />
            {block.illustration.preset === "custom" &&
            block.illustration.bitmapMask
              ? "Generated bitmap"
              : "Approved artwork"}
          </span>
        </header>
      )}
      <div className="illustration-stage">
        <IllustrationArtwork block={block} />
      </div>
      {showCaption && block.subtitle && <p>{block.subtitle}</p>}
    </article>
  );
}

export function IllustrationArtwork({
  block,
  preview = false,
}: {
  block: DashboardBlock;
  preview?: boolean;
}) {
  const settings = block.illustration;
  const bitmapUrl = useMemo(
    () =>
      settings.preset === "custom" &&
      settings.bitmapMask &&
      settings.bitmapMask.encoding !== ILLUSTRATION_ALPHA_MASK_ENCODING
        ? bitmapMaskDataUrl(settings.bitmapMask, settings.primaryColor)
        : null,
    [settings.bitmapMask, settings.preset, settings.primaryColor],
  );
  if (
    settings.preset === "custom" &&
    settings.bitmapMask?.encoding === ILLUSTRATION_ALPHA_MASK_ENCODING
  ) {
    const maskUrl = `data:image/png;base64,${settings.bitmapMask.bits}`;
    const style = {
      backgroundColor: settings.primaryColor,
      maskImage: `url("${maskUrl}")`,
      WebkitMaskImage: `url("${maskUrl}")`,
    } as CSSProperties;
    return (
      <div
        className={
          preview
            ? "illustration-artwork-mask illustration-alpha-artwork is-preview"
            : "illustration-artwork-mask illustration-alpha-artwork"
        }
        style={style}
        role={preview ? undefined : "img"}
        aria-hidden={preview ? true : undefined}
        aria-label={preview ? undefined : settings.altText || block.title}
        data-illustration-preset="custom"
        data-mask-encoding={settings.bitmapMask.encoding}
        data-mask-width={settings.bitmapMask.width}
        data-mask-height={settings.bitmapMask.height}
        data-illustration-color={settings.primaryColor}
      />
    );
  }
  if (bitmapUrl && settings.bitmapMask)
    return (
      <img
        className={
          preview
            ? "illustration-bitmap-artwork is-preview"
            : "illustration-bitmap-artwork"
        }
        src={bitmapUrl}
        alt={preview ? "" : settings.altText || block.title}
        aria-hidden={preview ? true : undefined}
        data-illustration-preset="custom"
        data-mask-encoding={settings.bitmapMask.encoding}
        data-mask-width={settings.bitmapMask.width}
        data-mask-height={settings.bitmapMask.height}
        data-illustration-color={settings.primaryColor}
      />
    );
  const preset =
    getIllustrationPreset(settings.preset) ??
    getIllustrationPreset("people-at-desks")!;
  const style = {
    backgroundColor: settings.primaryColor,
    maskImage: `url("${preset.assetPath}")`,
    WebkitMaskImage: `url("${preset.assetPath}")`,
  } as CSSProperties;

  return (
    <div
      className={
        preview
          ? "illustration-artwork-mask is-preview"
          : "illustration-artwork-mask"
      }
      style={style}
      role={preview ? undefined : "img"}
      aria-hidden={preview ? true : undefined}
      aria-label={preview ? undefined : settings.altText || block.title}
      data-illustration-preset={preset.value}
      data-illustration-asset={preset.assetPath}
    />
  );
}

function bitmapMaskDataUrl(mask: IllustrationBitmapMask, color: string) {
  try {
    const bytes = decodeIllustrationMaskBits(mask);
    const canvas = document.createElement("canvas");
    canvas.width = mask.width;
    canvas.height = mask.height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    const image = context.createImageData(mask.width, mask.height);
    const [red, green, blue] = hexToRgb(color);
    for (let pixel = 0; pixel < mask.width * mask.height; pixel += 1) {
      if (!illustrationMaskPixelIsOn(bytes, pixel)) continue;
      const offset = pixel * 4;
      image.data[offset] = red;
      image.data[offset + 1] = green;
      image.data[offset + 2] = blue;
      image.data[offset + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

function hexToRgb(value: string): [number, number, number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (!match) return [17, 17, 17];
  return [
    Number.parseInt(match[1], 16),
    Number.parseInt(match[2], 16),
    Number.parseInt(match[3], 16),
  ];
}
