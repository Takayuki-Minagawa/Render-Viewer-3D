import * as THREE from "three";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

export interface PngExportOptions {
  width: number;
  height: number;
  transparent?: boolean;
  includeHelpers?: boolean;
}
export const PNG_MAX_EDGE = 4096;
export const PNG_MAX_PIXELS = 16_777_216;

export function validatePngSize(width: number, height: number, gpuLimit = PNG_MAX_EDGE): void {
  const edge = Math.min(PNG_MAX_EDGE, gpuLimit);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > edge || height > edge || width * height > PNG_MAX_PIXELS) {
    throw new Error(`PNG: 1–${edge} px per side; maximum ${PNG_MAX_PIXELS.toLocaleString()} pixels.`);
  }
}

/** Preserve vertical framing; a different aspect ratio reveals/crops the sides. */
export function createPngCamera(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera, width: number, height: number): THREE.PerspectiveCamera | THREE.OrthographicCamera {
  const copy = camera.clone();
  if (copy instanceof THREE.PerspectiveCamera) copy.aspect = width / height;
  else {
    const halfWidth = (copy.top - copy.bottom) * width / height / 2;
    const center = (copy.left + copy.right) / 2;
    copy.left = center - halfWidth; copy.right = center + halfWidth;
  }
  copy.updateProjectionMatrix(); copy.updateMatrixWorld(true);
  return copy;
}

/** Render/read synchronously: the live scene is restored before PNG encoding yields. */
export function renderPng(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  helpers: readonly THREE.Object3D[],
  options: PngExportOptions,
  render: (camera: THREE.Camera) => void = camera => renderer.render(scene, camera),
): Promise<Blob> {
  const gl = renderer.getContext();
  validatePngSize(options.width, options.height, Math.min(renderer.capabilities.maxTextureSize, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number));
  if (!renderer.extensions.has("EXT_color_buffer_float")) throw new Error("PNG: this GPU does not support the floating-point export buffer.");
  const { width, height } = options;
  // 8-byte linear HDR color + depth/stencil + 4-byte output + CPU/canvas buffers.
  // No MSAA: a bounded memory cost independent of the device's sample count.
  const linear = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, stencilBuffer: true });
  const output = new THREE.WebGLRenderTarget(width, height, { depthBuffer: false });
  const pass = new OutputPass();
  // Render targets contain premultiplied linear color. PNG requires straight alpha.
  pass.material.fragmentShader = pass.material.fragmentShader.replace(
    "gl_FragColor = texture2D( tDiffuse, vUv );",
    "gl_FragColor = texture2D( tDiffuse, vUv ); if (gl_FragColor.a > 0.0) gl_FragColor.rgb /= gl_FragColor.a;",
  );
  const previous = {
    target: renderer.getRenderTarget(), face: renderer.getActiveCubeFace(), level: renderer.getActiveMipmapLevel(),
    viewport: renderer.getViewport(new THREE.Vector4()), scissor: renderer.getScissor(new THREE.Vector4()),
    scissorTest: renderer.getScissorTest(), clear: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(),
    autoClear: renderer.autoClear, background: scene.background, clipping: renderer.clippingPlanes,
    helpers: helpers.map(helper => helper.visible),
  };
  const pixels = new Uint8Array(width * height * 4);
  const canvas = document.createElement("canvas");
  try {
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("PNG: unable to create image buffer.");
    if (!options.includeHelpers) helpers.forEach(helper => { helper.visible = false; });
    // Keep HDR lighting, but composite the background after tone mapping, just as
    // the display renderer treats a Color background (it is not tone mapped).
    scene.background = null; renderer.setClearColor(0x000000, 0);
    renderer.autoClear = true; renderer.setScissorTest(false); renderer.setRenderTarget(linear);
    render(createPngCamera(camera, width, height));
    renderer.clippingPlanes = [];
    pass.render(renderer, output, linear, 0, false);
    renderer.readRenderTargetPixels(output, 0, 0, width, height, pixels);
    const image = context.createImageData(width, height);
    const background = previous.background instanceof THREE.Color ? previous.background.clone().convertLinearToSRGB() : previous.clear.clone().convertLinearToSRGB();
    const rgb = [background.r * 255, background.g * 255, background.b * 255];
    for (let y = 0; y < height; y++) {
      const src = (height - 1 - y) * width * 4;
      const dst = y * width * 4;
      image.data.set(pixels.subarray(src, src + width * 4), dst);
      if (!options.transparent) {
        for (let x = 0; x < width; x++) {
          const i = dst + x * 4, a = image.data[i + 3]! / 255;
          for (let c = 0; c < 3; c++) image.data[i + c] = image.data[i + c]! * a + rgb[c]! * (1 - a);
          image.data[i + 3] = 255;
        }
      }
    }
    context.putImageData(image, 0, 0);
  } finally {
    helpers.forEach((helper, i) => { helper.visible = previous.helpers[i]!; });
    scene.background = previous.background; renderer.clippingPlanes = previous.clipping;
    renderer.setClearColor(previous.clear, previous.alpha); renderer.autoClear = previous.autoClear;
    renderer.setRenderTarget(previous.target, previous.face, previous.level);
    renderer.setViewport(previous.viewport); renderer.setScissor(previous.scissor); renderer.setScissorTest(previous.scissorTest);
    linear.dispose(); output.dispose(); pass.dispose();
  }
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => {
    canvas.width = 1; canvas.height = 1;
    if (blob) resolve(blob); else reject(new Error("PNG encoding failed."));
  }, "image/png"));
}
