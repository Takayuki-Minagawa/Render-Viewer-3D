import * as THREE from "three";

export interface PngExportOptions {
  width: number;
  height: number;
  transparent?: boolean;
  includeHelpers?: boolean;
}
type ExportCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;
// Three retains transmission targets by camera.id. Reusing cameras bounds those
// renderer-owned targets even when a glass scene is exported repeatedly.
const exportCameras = new WeakMap<THREE.WebGLRenderer, Map<string, ExportCamera>>();
export const PNG_MAX_EDGE = 4096;
export const PNG_MAX_PIXELS = 16_777_216;

export function validatePngSize(width: number, height: number, gpuLimit = PNG_MAX_EDGE): void {
  const edge = Math.min(PNG_MAX_EDGE, gpuLimit);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > edge || height > edge || width * height > PNG_MAX_PIXELS) {
    throw new Error(`PNG: 1–${edge} px per side; maximum ${PNG_MAX_PIXELS.toLocaleString()} pixels.`);
  }
}

/** Preserve vertical framing; a different aspect ratio reveals/crops the sides. */
export function createPngCamera(camera: ExportCamera, width: number, height: number, cached?: ExportCamera): ExportCamera {
  const copy = cached ?? camera.clone();
  if (copy instanceof THREE.PerspectiveCamera && camera instanceof THREE.PerspectiveCamera) copy.copy(camera, false);
  else if (copy instanceof THREE.OrthographicCamera && camera instanceof THREE.OrthographicCamera) copy.copy(camera, false);
  else throw new Error("PNG camera projection mismatch.");
  if (copy instanceof THREE.PerspectiveCamera) copy.aspect = width / height;
  else {
    const halfWidth = (copy.top - copy.bottom) * width / height / 2;
    const center = (copy.left + copy.right) / 2;
    copy.left = center - halfWidth; copy.right = center + halfWidth;
  }
  copy.updateProjectionMatrix(); copy.updateMatrixWorld(true);
  return copy;
}

/** Capture synchronously before restoring the live drawing buffer. Using the
 * renderer's canvas preserves its per-material tone mapping/blending order,
 * including toneMapped=false helpers and overlapping transparent materials.
 * The renderer must have been constructed with alpha:true.
 */
export function renderPng(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: ExportCamera,
  helpers: readonly THREE.Object3D[],
  options: PngExportOptions,
  render: (camera: THREE.Camera) => void = camera => renderer.render(scene, camera),
): Promise<Blob> {
  const gl = renderer.getContext();
  validatePngSize(options.width, options.height, Math.min(renderer.capabilities.maxTextureSize, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number));
  if (options.transparent && !gl.getContextAttributes()?.alpha) throw new Error("PNG: transparent output requires an alpha-enabled renderer.");
  const { width, height } = options;
  const previous = {
    target: renderer.getRenderTarget(), face: renderer.getActiveCubeFace(), level: renderer.getActiveMipmapLevel(),
    viewport: renderer.getViewport(new THREE.Vector4()), scissor: renderer.getScissor(new THREE.Vector4()),
    scissorTest: renderer.getScissorTest(), clear: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(),
    autoClear: renderer.autoClear, background: scene.background,
    size: renderer.getSize(new THREE.Vector2()), pixelRatio: renderer.getPixelRatio(),
    helpers: helpers.map(helper => helper.visible),
  };
  try {
    if (!options.includeHelpers) helpers.forEach(helper => { helper.visible = false; });
    if (options.transparent) { scene.background = null; renderer.setClearColor(0x000000, 0); }
    renderer.autoClear = true; renderer.setRenderTarget(null); renderer.setScissorTest(false);
    renderer.setPixelRatio(1); renderer.setSize(width, height, false);
    let cameras = exportCameras.get(renderer);
    if (!cameras) { cameras = new Map(); exportCameras.set(renderer, cameras); }
    const exportCamera = createPngCamera(camera, width, height, cameras.get(camera.type));
    cameras.set(camera.type, exportCamera);
    render(exportCamera);
    // HTMLCanvasElement.toBlob snapshots its bitmap at the call, even though
    // encoding completes asynchronously after the finally block restores it.
    return new Promise<Blob>((resolve, reject) => renderer.domElement.toBlob(blob => {
      if (blob) resolve(blob); else reject(new Error("PNG encoding failed."));
    }, "image/png"));
  } finally {
    helpers.forEach((helper, i) => { helper.visible = previous.helpers[i]!; });
    scene.background = previous.background;
    renderer.setClearColor(previous.clear, previous.alpha); renderer.autoClear = previous.autoClear;
    // Restore logical size first: reversing this order could allocate an export
    // width multiplied by the display pixel ratio, exceeding the checked limit.
    renderer.setSize(previous.size.x, previous.size.y, false); renderer.setPixelRatio(previous.pixelRatio);
    renderer.setRenderTarget(previous.target, previous.face, previous.level);
    renderer.setViewport(previous.viewport); renderer.setScissor(previous.scissor); renderer.setScissorTest(previous.scissorTest);
  }
}
