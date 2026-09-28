/** Draws an SVG layer (Cornerstone's annotations) onto a canvas. */
async function drawSvg(context: CanvasRenderingContext2D, svg: SVGSVGElement, width: number, height: number): Promise<void> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.setAttribute('viewBox', `0 0 ${svg.clientWidth || width} ${svg.clientHeight || height}`);
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    context.drawImage(image, 0, 0, width, height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The viewport as a PNG: the rendered image with its measurements (an SVG layer above the canvas) and a caption
 * line of series, window and slice, so a saved capture keeps its clinical context.
 */
export async function captureViewport(element: HTMLElement, caption: { left: string; right: string }): Promise<Blob> {
  const source = element.querySelector<HTMLCanvasElement>('canvas');
  if (!source) throw new Error('Nothing is displayed in this viewport.');
  const output = document.createElement('canvas');
  output.width = source.width;
  output.height = source.height;
  const context = output.getContext('2d');
  if (!context) throw new Error('Canvas export is unavailable.');
  context.drawImage(source, 0, 0);
  for (const svg of element.querySelectorAll<SVGSVGElement>('svg')) await drawSvg(context, svg, output.width, output.height);
  const scale = Math.max(1, output.width / 1000);
  context.save();
  context.font = `${Math.round(15 * scale)}px ui-monospace, monospace`;
  context.fillStyle = '#55dbc5';
  context.shadowColor = '#000';
  context.shadowBlur = 4 * scale;
  context.fillText(caption.left, 14 * scale, 24 * scale);
  context.textAlign = 'right';
  context.fillText(caption.right, output.width - 14 * scale, 24 * scale);
  context.restore();
  return await new Promise<Blob>((resolve, reject) => output.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG encoding failed.')), 'image/png'));
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
