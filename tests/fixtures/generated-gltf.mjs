import { Document, WebIO } from '@gltf-transform/core';
export async function fixture(count = 3, animated = true) {
  const document = new Document(), buffer = document.createBuffer();
  const scene = document.createScene('Assembly');
  for (let index = 0; index < count; index++) {
    const material = document.createMaterial(`Material ${index}`).setBaseColorFactor([0.2, 0.4, 0.8, 1]);
    const position = document.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buffer);
    const indices = document.createAccessor().setType('SCALAR').setArray(new Uint16Array([0, 1, 2])).setBuffer(buffer);
    const mesh = document.createMesh(`Mesh ${index}`).addPrimitive(document.createPrimitive().setAttribute('POSITION', position).setIndices(indices).setMaterial(material));
    const node = document.createNode(`Part ${index}`).setMesh(mesh).setTranslation([index, 0, 0]);
    const group = document.createNode(`Group ${index}`).addChild(node); scene.addChild(group);
    if (animated && index === 0) {
      const input = document.createAccessor().setType('SCALAR').setArray(new Float32Array([0, 1])).setBuffer(buffer);
      const output = document.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 0, 0, 1])).setBuffer(buffer);
      const sampler = document.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
      const channel = document.createAnimationChannel().setTargetNode(node).setTargetPath('translation').setSampler(sampler);
      document.createAnimation('Move part').addSampler(sampler).addChannel(channel);
    }
  }
  return new WebIO().writeBinary(document);
}
