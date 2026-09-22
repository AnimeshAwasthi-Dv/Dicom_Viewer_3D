import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Box, RotateCcw } from 'lucide-react';
import { selectCurrentSeries, useStudyStore } from '../../store/studyStore';
import { useUiStore } from '../../store/uiStore';
import { buildDicomVolume, planeDimensions, renderPlane, type DicomVolume, type MprPlane } from '../../viewer/mpr/Volume';
import type { Series } from '../../viewer/study/Series';
import { useRemoteControlStore } from '../../store/remoteControlStore';

const planes: Array<{ id: MprPlane; label: string }> = [
  { id: 'axial', label: 'Axial' },
  { id: 'coronal', label: 'Coronal' },
  { id: 'sagittal', label: 'Sagittal' }
];

const volumePresets = {
  lung: { label: 'Lung', low: -780, high: -90, fadeLow: 80, fadeHigh: 420, windowWidth: 1500, windowCenter: -650, opacity: 0.32, slab: 0.18, mode: 4, color: new THREE.Color(0.9, 0.97, 1) },
  soft: { label: 'Soft tissue', low: -80, high: 180, fadeLow: 260, fadeHigh: 460, windowWidth: 420, windowCenter: 45, opacity: 0.42, slab: 0.18, mode: 0, color: new THREE.Color(1, 0.82, 0.68) },
  bone: { label: 'Bone', low: 150, high: 1250, fadeLow: 2400, fadeHigh: 2401, windowWidth: 2200, windowCenter: 450, opacity: 0.62, slab: 0.14, mode: 1, color: new THREE.Color(1, 0.96, 0.88) },
  mip: { label: 'MIP', low: -50, high: 850, fadeLow: 1800, fadeHigh: 1801, windowWidth: 1200, windowCenter: 300, opacity: 0.72, slab: 0.16, mode: 1, color: new THREE.Color(0.96, 0.99, 1) }
} as const;

const renderModes = {
  mpr: { label: '3D MPR', value: 4 },
  dvr: { label: 'Volume', value: 0 },
  mip: { label: 'MIP', value: 1 },
  minip: { label: 'MinIP', value: 2 },
  aip: { label: 'AIP', value: 3 }
} as const;

const volumeQualities = {
  fast: { label: 'Fast', maxDimension: 256, dpr: 1.25 },
  hd: { label: 'HD', maxDimension: 512, dpr: 1.75 },
  ultra: { label: 'Ultra', maxDimension: 768, dpr: 2 }
} as const;

type VolumePresetId = keyof typeof volumePresets;
type VolumeQualityId = keyof typeof volumeQualities;
type RenderModeId = keyof typeof renderModes;
type SlicePlaneRef = {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  texture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
};
type VolumeUniforms = {
  uVolume: { value: THREE.Data3DTexture };
  uCameraLocal: { value: THREE.Vector3 };
  uWindow: { value: THREE.Vector2 };
  uOpacityRange: { value: THREE.Vector2 };
  uOpacityFalloff: { value: THREE.Vector2 };
  uSlabRange: { value: THREE.Vector2 };
  uTint: { value: THREE.Color };
  uOpacity: { value: number };
  uMode: { value: number };
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatNumber(value: number, digits = 0): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '--';
}

function planePhysicalAspect(volume: DicomVolume, plane: MprPlane): number {
  const [spacingX, spacingY, spacingZ] = volume.spacing;
  if (plane === 'axial') return (volume.width * spacingX) / (volume.height * spacingY);
  if (plane === 'coronal') return (volume.width * spacingX) / (volume.depth * spacingZ);
  return (volume.depth * spacingZ) / (volume.height * spacingY);
}

function drawPlane(canvas: HTMLCanvasElement, volume: DicomVolume, plane: MprPlane, index: number, windowWidth: number, windowCenter: number): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const canvasWidth = Math.max(1, Math.floor(rect.width * dpr));
  const canvasHeight = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== canvasWidth || canvas.height !== canvasHeight) {
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
  }

  const planeImage = renderPlane(volume, plane, index, windowWidth, windowCenter);
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = planeImage.width;
  sourceCanvas.height = planeImage.height;
  sourceCanvas.getContext('2d')?.putImageData(planeImage.imageData, 0, 0);

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const imageAspect = planePhysicalAspect(volume, plane);
  const viewportAspect = canvas.width / canvas.height;
  const shouldConstrainByWidth = imageAspect > viewportAspect;
  const drawWidth = shouldConstrainByWidth ? canvas.width : canvas.height * imageAspect;
  const drawHeight = shouldConstrainByWidth ? canvas.width / imageAspect : canvas.height;
  context.drawImage(sourceCanvas, (canvas.width - drawWidth) / 2, (canvas.height - drawHeight) / 2, drawWidth, drawHeight);
}

function paintPlaneTexture(canvas: HTMLCanvasElement, volume: DicomVolume, plane: MprPlane, index: number, windowWidth: number, windowCenter: number): void {
  const planeImage = renderPlane(volume, plane, index, windowWidth, windowCenter);
  canvas.width = planeImage.width;
  canvas.height = planeImage.height;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.putImageData(planeImage.imageData, 0, 0);
}

function midpoint(volume?: DicomVolume): Record<MprPlane, number> {
  if (!volume) return { axial: 0, coronal: 0, sagittal: 0 };
  return {
    axial: Math.floor(volume.depth / 2),
    coronal: Math.floor(volume.height / 2),
    sagittal: Math.floor(volume.width / 2)
  };
}

const volumeVertexShader = `
out vec3 vPosition;
void main() {
  vPosition = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const volumeFragmentShader = `
precision highp float;
precision highp sampler3D;
uniform sampler3D uVolume;
uniform vec3 uCameraLocal;
uniform vec2 uWindow;
uniform vec2 uOpacityRange;
uniform vec2 uOpacityFalloff;
uniform vec2 uSlabRange;
uniform vec3 uTint;
uniform float uOpacity;
uniform int uMode;
in vec3 vPosition;
out vec4 outColor;

vec2 hitBox(vec3 origin, vec3 direction) {
  vec3 boxMin = vec3(-0.5);
  vec3 boxMax = vec3(0.5);
  vec3 invDirection = 1.0 / direction;
  vec3 tMinTmp = (boxMin - origin) * invDirection;
  vec3 tMaxTmp = (boxMax - origin) * invDirection;
  vec3 tMin = min(tMinTmp, tMaxTmp);
  vec3 tMax = max(tMinTmp, tMaxTmp);
  float t0 = max(max(tMin.x, tMin.y), tMin.z);
  float t1 = min(min(tMax.x, tMax.y), tMax.z);
  return vec2(t0, t1);
}

vec3 texturePosition(vec3 position) {
  return vec3(position.x + 0.5, position.z + 0.5, 0.5 - position.y);
}

float sampleVolume(vec3 position) {
  return texture(uVolume, texturePosition(position)).r;
}

void main() {
  if (uMode == 4) discard;
  vec3 rayDirection = normalize(vPosition - uCameraLocal);
  vec2 bounds = hitBox(uCameraLocal, rayDirection);
  if (bounds.x > bounds.y) discard;
  bounds.x = max(bounds.x, 0.0);

  vec3 rayStart = uCameraLocal + bounds.x * rayDirection;
  vec3 rayStop = uCameraLocal + bounds.y * rayDirection;
  vec3 ray = rayStop - rayStart;
  float rayLength = length(ray);
  vec3 rayStep = normalize(ray) * 0.008;
  int steps = int(min(288.0, rayLength / length(rayStep)));
  vec3 position = rayStart;
  vec4 accumulated = vec4(0.0);
  float maximum = 0.0;
  float minimum = 1.0;
  float average = 0.0;
  float averageWeight = 0.0;

  for (int i = 0; i < 288; i++) {
    if (i >= steps) break;
    vec3 tex = texturePosition(position);
    if (tex.z < uSlabRange.x || tex.z > uSlabRange.y) {
      position += rayStep;
      continue;
    }
    float value = sampleVolume(position);
    float windowed = clamp((value - uWindow.x) / max(0.0001, uWindow.y - uWindow.x), 0.0, 1.0);
    float tissue = smoothstep(uOpacityRange.x, uOpacityRange.y, value);
    tissue *= 1.0 - smoothstep(uOpacityFalloff.x, uOpacityFalloff.y, value);
    if (uMode == 1) {
      maximum = max(maximum, windowed * tissue);
    } else if (uMode == 2) {
      minimum = min(minimum, mix(1.0, windowed, tissue));
    } else if (uMode == 3) {
      average += windowed * tissue;
      averageWeight += tissue;
    } else {
      vec3 gradientStep = vec3(0.0045);
      vec3 gradient = vec3(
        sampleVolume(position + vec3(gradientStep.x, 0.0, 0.0)) - sampleVolume(position - vec3(gradientStep.x, 0.0, 0.0)),
        sampleVolume(position + vec3(0.0, gradientStep.y, 0.0)) - sampleVolume(position - vec3(0.0, gradientStep.y, 0.0)),
        sampleVolume(position + vec3(0.0, 0.0, gradientStep.z)) - sampleVolume(position - vec3(0.0, 0.0, gradientStep.z))
      );
      float edge = clamp(length(gradient) * 18.0, 0.2, 1.4);
      vec3 normal = normalize(gradient + vec3(0.0001));
      float light = 0.52 + 0.48 * max(dot(normal, normalize(vec3(-0.4, 0.7, 0.5))), 0.0);
      float alpha = 1.0 - exp(-pow(tissue, 1.22) * uOpacity * edge * 0.2);
      vec3 color = mix(vec3(pow(windowed, 0.82)), uTint, 0.28) * light;
      accumulated.rgb += (1.0 - accumulated.a) * alpha * color;
      accumulated.a += (1.0 - accumulated.a) * alpha;
      if (accumulated.a > 0.96) break;
    }
    position += rayStep;
  }

  if (uMode == 1) {
    accumulated = vec4(mix(vec3(maximum), uTint, 0.32), clamp(maximum * 1.25, 0.0, 1.0));
  } else if (uMode == 2) {
    float air = 1.0 - minimum;
    accumulated = vec4(mix(vec3(air), uTint, 0.22), clamp(air * 1.35, 0.0, 1.0));
  } else if (uMode == 3) {
    float mean = average / max(0.0001, averageWeight);
    accumulated = vec4(mix(vec3(mean), uTint, 0.24), clamp(mean * 1.1, 0.0, 1.0));
  }

  if (accumulated.a < 0.02) discard;
  outColor = accumulated;
}`;

function normalizeValue(volume: DicomVolume, value: number): number {
  return clamp((value - volume.min) / Math.max(1, volume.max - volume.min), 0, 1);
}

function windowRange(volume: DicomVolume, width: number, center: number): THREE.Vector2 {
  const low = center - width / 2;
  const high = center + width / 2;
  return new THREE.Vector2(normalizeValue(volume, low), normalizeValue(volume, high));
}

function createVolumeTexture(volume: DicomVolume, maxDimension: number): { texture: THREE.Data3DTexture; dimensions: THREE.Vector3; scale: THREE.Vector3 } {
  const reduction = Math.max(1, Math.ceil(Math.max(volume.width, volume.height, volume.depth) / maxDimension));
  const width = Math.ceil(volume.width / reduction);
  const height = Math.ceil(volume.height / reduction);
  const depth = Math.ceil(volume.depth / reduction);
  const textureData = new Uint8Array(width * height * depth);
  let output = 0;

  for (let z = 0; z < depth; z += 1) {
    const sourceZ = Math.min(volume.depth - 1, Math.round(z * reduction));
    for (let y = 0; y < height; y += 1) {
      const sourceY = Math.min(volume.height - 1, Math.round(y * reduction));
      for (let x = 0; x < width; x += 1) {
        const sourceX = Math.min(volume.width - 1, Math.round(x * reduction));
        const value = volume.data[sourceZ * volume.width * volume.height + sourceY * volume.width + sourceX];
        textureData[output] = Math.round(normalizeValue(volume, value) * 255);
        output += 1;
      }
    }
  }

  const texture = new THREE.Data3DTexture(textureData, width, height, depth);
  texture.format = THREE.RedFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;

  const [spacingX, spacingY, spacingZ] = volume.spacing;
  const physical = new THREE.Vector3(volume.width * spacingX, volume.depth * spacingZ, volume.height * spacingY);
  const maxPhysical = Math.max(physical.x, physical.y, physical.z);
  return {
    texture,
    dimensions: new THREE.Vector3(width, height, depth),
    scale: physical.multiplyScalar(2 / maxPhysical)
  };
}

export function MprViewer({ series }: { series?: Series }): JSX.Element {
  const { imageSource, studies, selectedSeriesId, addError } = useStudyStore();
  const currentSeries = series ?? selectCurrentSeries(studies, selectedSeriesId);
  const setMprOpen = useUiStore((state) => state.setMprOpen);
  const [volume, setVolume] = useState<DicomVolume>();
  const [progress, setProgress] = useState<{ loaded: number; total: number }>();
  const [error, setError] = useState<string>();
  const [indices, setIndices] = useState<Record<MprPlane, number>>(midpoint());
  const [windowWidth, setWindowWidth] = useState(1);
  const [windowCenter, setWindowCenter] = useState(0);
  const [volumePreset, setVolumePreset] = useState<VolumePresetId>('lung');
  const [renderMode, setRenderMode] = useState<RenderModeId>('mpr');
  const [volumeWindowWidth, setVolumeWindowWidth] = useState<number>(volumePresets.lung.windowWidth);
  const [volumeWindowCenter, setVolumeWindowCenter] = useState<number>(volumePresets.lung.windowCenter);
  const [volumeOpacity, setVolumeOpacity] = useState<number>(volumePresets.lung.opacity);
  const [slabThickness, setSlabThickness] = useState<number>(volumePresets.lung.slab);
  const [volumeQuality, setVolumeQuality] = useState<VolumeQualityId>('hd');
  const [fourDCine, setFourDCine] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);
  const mprRequest = useRemoteControlStore(state => state.mprRequest);
  const orbitRef = useRef<{ camera: THREE.PerspectiveCamera; controls: OrbitControls }>();
  const canvasRefs = useRef<Record<MprPlane, HTMLCanvasElement | null>>({ axial: null, coronal: null, sagittal: null });
  const modelCanvasRef = useRef<HTMLCanvasElement>(null);
  const volumeUniformsRef = useRef<VolumeUniforms>();
  const slicePlanesRef = useRef<Partial<Record<MprPlane, SlicePlaneRef>>>({});
  const volumeTexture = useMemo(() => (volume ? createVolumeTexture(volume, volumeQualities[volumeQuality].maxDimension) : undefined), [volume, volumeQuality]);

  useEffect(() => {
    let cancelled = false;
    const abort = new AbortController();
    if (!imageSource || !currentSeries) return;
    setError(undefined);
    setVolume(undefined);
    setProgress({ loaded: 0, total: currentSeries.instances.length });
    buildDicomVolume(imageSource, currentSeries, (loaded, total) => {
      if (!cancelled) setProgress({ loaded, total });
    }, abort.signal)
      .then((nextVolume) => {
        if (cancelled) return;
        setVolume(nextVolume);
        setIndices(midpoint(nextVolume));
        setWindowWidth(nextVolume.windowWidth);
        setWindowCenter(nextVolume.windowCenter);
        setProgress(undefined);
      })
      .catch((buildError: unknown) => {
        if (cancelled) return;
        const message = buildError instanceof Error ? buildError.message : 'Unable to build 3D MPR volume.';
        setError(message);
        addError(message);
        setProgress(undefined);
      });
    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [addError, currentSeries, imageSource]);

  useEffect(() => {
    if (!volume) return;
    const renderAll = () => {
      planes.forEach((plane) => {
        const canvas = canvasRefs.current[plane.id];
        if (canvas) drawPlane(canvas, volume, plane.id, indices[plane.id], windowWidth, windowCenter);
      });
    };
    renderAll();
    const observer = new ResizeObserver(renderAll);
    planes.forEach((plane) => {
      const canvas = canvasRefs.current[plane.id];
      if (canvas) observer.observe(canvas);
    });
    return () => observer.disconnect();
  }, [indices, volume, windowCenter, windowWidth]);

  useEffect(() => {
    const canvas = modelCanvasRef.current;
    if (!canvas || !volume || !volumeTexture) return;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setClearColor(0x000000, 1);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
    camera.position.set(2.5, 1.8, 2.5);
    const controls = new OrbitControls(camera, canvas);
    orbitRef.current = { camera, controls };
    controls.enableDamping = true;
    controls.target.set(0, 0, 0);
    const preset = volumePresets[volumePreset];
    const uniforms: VolumeUniforms = {
      uVolume: { value: volumeTexture.texture },
      uCameraLocal: { value: new THREE.Vector3() },
      uWindow: { value: windowRange(volume, volumeWindowWidth, volumeWindowCenter) },
      uOpacityRange: { value: new THREE.Vector2(normalizeValue(volume, preset.low), normalizeValue(volume, preset.high)) },
      uOpacityFalloff: { value: new THREE.Vector2(normalizeValue(volume, preset.fadeLow), normalizeValue(volume, preset.fadeHigh)) },
      uSlabRange: { value: new THREE.Vector2(0, 1) },
      uTint: { value: preset.color },
      uOpacity: { value: volumeOpacity },
      uMode: { value: renderModes[renderMode].value }
    };
    volumeUniformsRef.current = uniforms;
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: volumeVertexShader,
      fragmentShader: volumeFragmentShader,
      glslVersion: THREE.GLSL3,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false
    });
    const model = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    model.scale.copy(volumeTexture.scale);
    scene.add(model);
    const box = new THREE.BoxHelper(model, 0x155a77);
    scene.add(box);
    const slicePlanes: Partial<Record<MprPlane, SlicePlaneRef>> = {};
    planes.forEach((plane) => {
      const textureCanvas = document.createElement('canvas');
      paintPlaneTexture(textureCanvas, volume, plane.id, indices[plane.id], windowWidth, windowCenter);
      const texture = new THREE.CanvasTexture(textureCanvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      const planeMaterial = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, transparent: true, opacity: 0.96 });
      const geometry =
        plane.id === 'axial'
          ? new THREE.PlaneGeometry(volumeTexture.scale.x, volumeTexture.scale.z)
          : plane.id === 'coronal'
            ? new THREE.PlaneGeometry(volumeTexture.scale.x, volumeTexture.scale.y)
            : new THREE.PlaneGeometry(volumeTexture.scale.y, volumeTexture.scale.z);
      const mesh = new THREE.Mesh(geometry, planeMaterial);
      if (plane.id === 'axial') mesh.rotation.x = -Math.PI / 2;
      if (plane.id === 'sagittal') mesh.rotation.y = Math.PI / 2;
      mesh.visible = renderMode === 'mpr';
      scene.add(mesh);
      slicePlanes[plane.id] = { mesh, texture, canvas: textureCanvas };
    });
    slicePlanesRef.current = slicePlanes;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(volumeQualities[volumeQuality].dpr, Math.max(1, window.devicePixelRatio || 1));
      renderer.setSize(Math.max(1, Math.floor(rect.width * dpr)), Math.max(1, Math.floor(rect.height * dpr)), false);
      camera.aspect = Math.max(1, rect.width) / Math.max(1, rect.height);
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    let frameId = 0;
    const animate = () => {
      frameId = window.requestAnimationFrame(animate);
      controls.autoRotate = autoRotate;
      controls.autoRotateSpeed = 1.2;
      controls.update();
      model.worldToLocal(uniforms.uCameraLocal.value.copy(camera.position));
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      window.cancelAnimationFrame(frameId);
      observer.disconnect();
      controls.dispose();
      orbitRef.current = undefined;
      model.geometry.dispose();
      material.dispose();
      Object.values(slicePlanes).forEach((slicePlane) => {
        slicePlane.mesh.geometry.dispose();
        slicePlane.mesh.material.dispose();
        slicePlane.texture.dispose();
      });
      slicePlanesRef.current = {};
      volumeTexture.texture.dispose();
      volumeUniformsRef.current = undefined;
      renderer.dispose();
    };
  }, [autoRotate, volume, volumeQuality, volumeTexture]);

  useEffect(() => {
    if (!mprRequest || !volume) return;
    const settings = mprRequest.settings;
    setIndices({ axial: Math.min(settings.indices.axial, volume.depth - 1), coronal: Math.min(settings.indices.coronal, volume.height - 1), sagittal: Math.min(settings.indices.sagittal, volume.width - 1) });
    setWindowWidth(settings.windowWidth);
    setWindowCenter(settings.windowCenter);
    setVolumePreset(settings.volumePreset);
    setRenderMode(settings.renderMode);
    setVolumeWindowWidth(settings.volumeWindowWidth);
    setVolumeWindowCenter(settings.volumeWindowCenter);
    setVolumeOpacity(settings.volumeOpacity);
    setSlabThickness(settings.slabThickness);
    setVolumeQuality(settings.volumeQuality);
    setFourDCine(settings.fourDCine);
    setAutoRotate(settings.autoRotate);
  }, [mprRequest, volume]);

  useEffect(() => {
    const orbit = orbitRef.current;
    const camera = mprRequest?.settings.camera;
    if (!orbit || !camera) return;
    orbit.camera.position.fromArray(camera.position);
    orbit.controls.target.fromArray(camera.target);
    orbit.controls.update();
  }, [mprRequest, volume, volumeTexture, autoRotate, volumeQuality]);

  useEffect(() => {
    const capture = () => {
      const orbit = orbitRef.current;
      useRemoteControlStore.setState({ mprActual: {
        indices, windowWidth, windowCenter, volumePreset, renderMode,
        volumeWindowWidth, volumeWindowCenter, volumeOpacity, slabThickness,
        volumeQuality, fourDCine, autoRotate,
        ...(orbit ? { camera: { position: orbit.camera.position.toArray(), target: orbit.controls.target.toArray() } } : {})
      } });
    };
    capture();
    const interval = window.setInterval(capture, 1000);
    return () => window.clearInterval(interval);
  }, [indices, windowWidth, windowCenter, volumePreset, renderMode, volumeWindowWidth, volumeWindowCenter, volumeOpacity, slabThickness, volumeQuality, fourDCine, autoRotate]);

  useEffect(() => {
    Object.values(slicePlanesRef.current).forEach((slicePlane) => {
      slicePlane.mesh.visible = renderMode === 'mpr';
    });
  }, [renderMode]);

  useEffect(() => {
    if (!volume || !volumeUniformsRef.current) return;
    const preset = volumePresets[volumePreset];
    const slabCenter = 1 - indices.axial / Math.max(1, volume.depth - 1);
    const slabHalf = slabThickness / 2;
    volumeUniformsRef.current.uWindow.value.copy(windowRange(volume, volumeWindowWidth, volumeWindowCenter));
    volumeUniformsRef.current.uOpacityRange.value.set(normalizeValue(volume, preset.low), normalizeValue(volume, preset.high));
    volumeUniformsRef.current.uOpacityFalloff.value.set(normalizeValue(volume, preset.fadeLow), normalizeValue(volume, preset.fadeHigh));
    volumeUniformsRef.current.uSlabRange.value.set(clamp(slabCenter - slabHalf, 0, 1), clamp(slabCenter + slabHalf, 0, 1));
    volumeUniformsRef.current.uTint.value.copy(preset.color);
    volumeUniformsRef.current.uOpacity.value = volumeOpacity;
    volumeUniformsRef.current.uMode.value = renderModes[renderMode].value;
    const slicePlanes = slicePlanesRef.current;
    const axial = slicePlanes.axial;
    const coronal = slicePlanes.coronal;
    const sagittal = slicePlanes.sagittal;
    const showMprPlanes = renderMode === 'mpr';
    const scaleX = axial?.mesh.geometry.parameters.width ?? 1;
    const scaleY = coronal?.mesh.geometry.parameters.height ?? 1;
    const scaleZ = axial?.mesh.geometry.parameters.height ?? 1;
    if (axial) {
      paintPlaneTexture(axial.canvas, volume, 'axial', indices.axial, windowWidth, windowCenter);
      axial.texture.needsUpdate = true;
      axial.mesh.position.set(0, (indices.axial / Math.max(1, volume.depth - 1) - 0.5) * scaleY, 0);
      axial.mesh.visible = showMprPlanes;
    }
    if (coronal) {
      paintPlaneTexture(coronal.canvas, volume, 'coronal', indices.coronal, windowWidth, windowCenter);
      coronal.texture.needsUpdate = true;
      coronal.mesh.position.set(0, 0, (indices.coronal / Math.max(1, volume.height - 1) - 0.5) * scaleZ);
      coronal.mesh.visible = showMprPlanes;
    }
    if (sagittal) {
      paintPlaneTexture(sagittal.canvas, volume, 'sagittal', indices.sagittal, windowWidth, windowCenter);
      sagittal.texture.needsUpdate = true;
      sagittal.mesh.position.set((indices.sagittal / Math.max(1, volume.width - 1) - 0.5) * scaleX, 0, 0);
      sagittal.mesh.visible = showMprPlanes;
    }
  }, [indices, renderMode, slabThickness, volume, volumeOpacity, volumePreset, volumeWindowCenter, volumeWindowWidth, windowCenter, windowWidth]);

  useEffect(() => {
    if (!fourDCine || !volume) return;
    const interval = window.setInterval(() => {
      setIndices((current) => ({ ...current, axial: (current.axial + 1) % volume.depth }));
    }, 70);
    return () => window.clearInterval(interval);
  }, [fourDCine, volume]);

  const dimensions = useMemo(() => (volume ? {
    axial: planeDimensions(volume, 'axial'),
    coronal: planeDimensions(volume, 'coronal'),
    sagittal: planeDimensions(volume, 'sagittal')
  } : undefined), [volume]);

  const updateIndex = (plane: MprPlane, index: number): void => {
    if (!dimensions) return;
    setIndices((current) => ({ ...current, [plane]: clamp(index, 0, dimensions[plane].maxIndex) }));
  };

  const applyVolumePreset = (presetId: VolumePresetId): void => {
    const preset = volumePresets[presetId];
    setVolumePreset(presetId);
    setVolumeWindowWidth(preset.windowWidth);
    setVolumeWindowCenter(preset.windowCenter);
    setVolumeOpacity(preset.opacity);
    setSlabThickness(preset.slab);
    const nextMode = (Object.entries(renderModes).find(([, mode]) => mode.value === preset.mode)?.[0] ?? 'dvr') as RenderModeId;
    setRenderMode(nextMode);
    setWindowWidth(preset.windowWidth);
    setWindowCenter(preset.windowCenter);
  };

  return (
    <div className="mpr-workspace">
      <div className="mpr-header">
        <div>
          <strong>3D MPR</strong>
          <span>{currentSeries?.description ?? 'No series'}{volume ? ` - ${volume.width} x ${volume.height} x ${volume.depth} ` : ''}</span>
        </div>
        <button title="Return to standard viewer" onClick={() => setMprOpen(false)}><RotateCcw size={16} /><span>Viewer</span></button>
      </div>

      {progress && <div className="mpr-loading"><strong>Building volume</strong><span>{progress.loaded} / {progress.total} slices</span></div>}
      {error && <div className="mpr-loading error"><strong>MPR unavailable</strong><span>{error}</span></div>}

      {volume && dimensions && (
        <>
          <div className="mpr-grid">
            <section className="mpr-plane mpr-model">
              <canvas ref={modelCanvasRef} />
              <div className="mpr-plane-overlay">
                <strong>3D Volume</strong>
                <span>{volumePresets[volumePreset].label} - {renderModes[renderMode].label}</span>
              </div>
            </section>
            {planes.map((plane) => (
              <section key={plane.id} className={`mpr-plane mpr-${plane.id}`}>
                <canvas
                  ref={(node) => { canvasRefs.current[plane.id] = node; }}
                  onWheel={(event) => {
                    event.preventDefault();
                    updateIndex(plane.id, indices[plane.id] + (event.deltaY > 0 ? 1 : -1));
                  }}
                />
                <div className="mpr-plane-overlay">
                  <strong>{plane.label}</strong>
                  <span>{indices[plane.id] + 1} / {dimensions[plane.id].maxIndex + 1}</span>
                </div>
                <input
                  className="mpr-plane-slider"
                  type="range"
                  min={0}
                  max={dimensions[plane.id].maxIndex}
                  value={indices[plane.id]}
                  onChange={(event) => updateIndex(plane.id, Number(event.target.value))}
                />
              </section>
            ))}
          </div>

          <div className="mpr-controls">
            <label>WW <input type="number" min={1} value={formatNumber(windowWidth)} onChange={(event) => setWindowWidth(Math.max(1, Number(event.target.value) || 1))} /></label>
            <label>WL <input type="number" value={formatNumber(windowCenter)} onChange={(event) => setWindowCenter(Number(event.target.value) || 0)} /></label>
            <label>3D
              <select value={volumePreset} onChange={(event) => applyVolumePreset(event.target.value as VolumePresetId)}>
                {Object.entries(volumePresets).map(([id, preset]) => <option key={id} value={id}>{preset.label}</option>)}
              </select>
            </label>
            <label>Quality
              <select value={volumeQuality} onChange={(event) => setVolumeQuality(event.target.value as VolumeQualityId)}>
                {Object.entries(volumeQualities).map(([id, quality]) => <option key={id} value={id}>{quality.label}</option>)}
              </select>
            </label>
            <label>Mode
              <select value={renderMode} onChange={(event) => setRenderMode(event.target.value as RenderModeId)}>
                {Object.entries(renderModes).map(([id, mode]) => <option key={id} value={id}>{mode.label}</option>)}
              </select>
            </label>
            <label>3D WW <input type="number" min={1} value={formatNumber(volumeWindowWidth)} onChange={(event) => setVolumeWindowWidth(Math.max(1, Number(event.target.value) || 1))} /></label>
            <label>3D WL <input type="number" value={formatNumber(volumeWindowCenter)} onChange={(event) => setVolumeWindowCenter(Number(event.target.value) || 0)} /></label>
            <label>Opacity <input type="range" min={0.02} max={0.8} step={0.01} value={volumeOpacity} onChange={(event) => setVolumeOpacity(Number(event.target.value))} /></label>
            <label>Slab <input type="range" min={0.03} max={1} step={0.01} value={slabThickness} onChange={(event) => setSlabThickness(Number(event.target.value))} /></label>
            <label><input type="checkbox" checked={fourDCine} onChange={(event) => setFourDCine(event.target.checked)} /> 4D Cine</label>
            <label><input type="checkbox" checked={autoRotate} onChange={(event) => setAutoRotate(event.target.checked)} /> Rotate</label>
            <span><Box size={14} /> Spacing {volume.spacing.map((value) => formatNumber(value, 2)).join(' x ')} mm</span>
          </div>
        </>
      )}
    </div>
  );
}
