/**
 * Szene, Licht und Renderer.
 *
 * Der Schattenwurf folgt dem Auto: eine feste Schattenkamera ueber der ganzen
 * Strecke haette viel zu grobe Texel. Stattdessen wandert ein kleines
 * Schattenvolumen mit.
 */
import * as THREE from 'three';
import { makeSkyTexture } from './textures.js';

export const QUALITY_PRESETS = {
  low: { shadows: false, pixelRatio: 1.0, shadowSize: 1024, fogFar: 700, antialias: false },
  medium: { shadows: true, pixelRatio: 1.25, shadowSize: 1024, fogFar: 1100, antialias: true },
  high: { shadows: true, pixelRatio: 2.0, shadowSize: 2048, fogFar: 1600, antialias: true },
};

export class Renderer {
  constructor(canvas, quality = 'medium') {
    this.quality = quality;
    const preset = QUALITY_PRESETS[quality];

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: preset.antialias,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.pixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = preset.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();

    // Himmel
    const sky = makeSkyTexture(quality === 'low' ? 256 : 512);
    this.scene.background = sky;
    this.scene.environment = sky;
    this.scene.environmentIntensity = 0.55;
    this.scene.fog = new THREE.Fog(0xbcc8d2, 220, preset.fogFar);

    // Sonne
    this.sun = new THREE.DirectionalLight(0xfff3e0, 2.6);
    this.sun.position.set(-160, 190, 120);
    if (preset.shadows) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(preset.shadowSize, preset.shadowSize);
      const d = 45;
      this.sun.shadow.camera.left = -d;
      this.sun.shadow.camera.right = d;
      this.sun.shadow.camera.top = d;
      this.sun.shadow.camera.bottom = -d;
      this.sun.shadow.camera.near = 1;
      this.sun.shadow.camera.far = 400;
      this.sun.shadow.bias = -0.0008;
      this.sun.shadow.normalBias = 0.03;
    }
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.scene.add(new THREE.HemisphereLight(0xbcd6f0, 0x4a5236, 0.85));

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.22, 3000);
    this.resize();
  }

  /** Schattenvolumen dem Auto nachfuehren. */
  followShadow(x, y, z) {
    if (!this.sun.castShadow) return;
    this.sun.target.position.set(x, y, z);
    this.sun.position.set(x - 90, y + 110, z + 70);
    this.sun.target.updateMatrixWorld();
  }

  resize() {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  setQuality(quality) {
    const preset = QUALITY_PRESETS[quality];
    if (!preset) return;
    this.quality = quality;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.pixelRatio));
    this.renderer.shadowMap.enabled = preset.shadows;
    this.sun.castShadow = preset.shadows;
    this.scene.fog.far = preset.fogFar;
    this.resize();
  }
}
