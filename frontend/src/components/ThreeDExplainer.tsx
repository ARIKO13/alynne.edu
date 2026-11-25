/**
 * ThreeDExplainer.tsx  -  Lab 3D: alat peraga interaktif berbasis Three.js
 *
 * Mengubah konsep materi (bangun ruang, struktur sel, ikatan molekul) jadi
 * objek 3D ringan yang bisa diputar 360 derajat, di-zoom, dan "dibedah":
 * bagian-bagiannya terpisah keluar (explode view) dengan label anotasi.
 *
 * 3 model parametrik (dibangun dari kode, tanpa file aset):
 * - Kubus s = 2: 6 sisi terpisah + diagonal ruang + rumus V/L/d
 * - Struktur sel hewan: membran, inti, mitokondria, RE, Golgi, ribosom
 * - Molekul: H2O (bengkok 104,5 derajat), CO2 (linear 180, rangkap dua),
 *   CH4 (tetrahedral 109,5)
 *
 * Interaksi: OrbitControls (drag putar 360, scroll zoom), auto-rotate opsional,
 * toggle label, toggle bedah (explode dianimasikan kecuali prefers-reduced-motion).
 *
 * Catatan warna: warna material 3D = encoding bagian objek (konvensi konten
 * model, seperti warna data-viz), bukan ornamen UI. UI di sekelilingnya
 * tetap pakai token DESIGN.md.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Box, RotateCcw, RotateCw, Scissors, Tag } from 'lucide-react';

type ModelId = 'kubus' | 'sel' | 'molekul';
type MolekulId = 'h2o' | 'co2' | 'ch4';

const MODELS: { id: ModelId; label: string; desc: string }[] = [
  { id: 'kubus', label: 'Kubus', desc: 'Bangun ruang sisi sama: volume, luas, diagonal, jaring-jaring' },
  { id: 'sel', label: 'Struktur Sel', desc: 'Bagian-bagian sel hewan dan fungsinya' },
  { id: 'molekul', label: 'Molekul', desc: 'Bentuk molekul dan jenis ikatan kimia' },
];

const MOLEKUL: { id: MolekulId; label: string }[] = [
  { id: 'h2o', label: 'Air (H2O)' },
  { id: 'co2', label: 'Karbon dioksida (CO2)' },
  { id: 'ch4', label: 'Metana (CH4)' },
];

interface ExplodablePart {
  obj: THREE.Object3D;
  from: THREE.Vector3;
  to: THREE.Vector3;
}

interface BondInfo {
  mesh: THREE.Mesh;
  grow: number; // seberapa memanjang saat explode (0 = statis)
}

interface LabelAnchor {
  anchor: THREE.Object3D;
  el: HTMLDivElement;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return true;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

// Warna material 3D: encoding bagian objek (konten model), bukan ornamen UI.
// Hex literal di sini setara konstanta canvas/SVG di DESIGN.md (var() tak terbaca WebGL).
const C = {
  face: 0xa8a29e,      // sisi kubus (stone)
  edge: 0xe7e5e4,      // rusuk (garis)
  diagonal: 0xc2410c,  // diagonal ruang (aksen, satu-satunya titik aksen di scene)
  membrane: 0xa8a29e,  // membran sel
  nucleus: 0xc2410c,   // inti sel (bagian terpenting)
  mito: 0xb45309,      // mitokondria
  er: 0x78716c,        // retikulum endoplasma
  golgi: 0x57534e,     // badan golgi
  ribosome: 0xd6d3d1,  // ribosom
  oxygen: 0xef4444,    // atom O (konvensi CPK)
  carbon: 0x44403c,    // atom C (konvensi CPK)
  hydrogen: 0xe7e5e4,  // atom H (konvensi CPK)
  bond: 0xa8a29e,      // ikatan
};

const CAM_PRESET: Record<string, { pos: [number, number, number] }> = {
  kubus: { pos: [4.6, 3.4, 5.4] },
  sel: { pos: [5.6, 3.2, 5.6] },
  molekul: { pos: [3.4, 2.2, 4.2] },
};

interface ThreeDExplainerProps {
  open: boolean;
  onClose: () => void;
}

export function ThreeDExplainer({ open, onClose }: ThreeDExplainerProps) {
  const [model, setModel] = useState<ModelId>('kubus');
  const [molekul, setMolekul] = useState<MolekulId>('h2o');
  const [exploded, setExploded] = useState(false);
  const [labelsOn, setLabelsOn] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [ready, setReady] = useState(false);

  const mountRef = useRef<HTMLDivElement | null>(null);
  const labelLayerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const partsRef = useRef<ExplodablePart[]>([]);
  const bondsRef = useRef<BondInfo[]>([]);
  const labelsRef = useRef<LabelAnchor[]>([]);
  const explodeTargetRef = useRef(0);
  const explodeCurRef = useRef(0);
  const rafRef = useRef(0);
  const roRef = useRef<ResizeObserver | null>(null);
  // mirror state utk loop animasi (hindari stale closure di tick)
  const labelsOnRef = useRef(labelsOn);
  labelsOnRef.current = labelsOn;

  // ── helper: buat elemen label HTML di overlay ──
  const addLabel = useCallback((anchor: THREE.Object3D, text: string) => {
    const layer = labelLayerRef.current;
    if (!layer) return;
    const el = document.createElement('div');
    // Token warna via CSS var (DESIGN.md); label UI kecil, pointer-events none.
    el.style.cssText =
      'position:absolute;top:0;left:0;white-space:nowrap;font-size:10px;line-height:1.3;' +
      'padding:2px 7px;border-radius:6px;background:var(--surface-2);color:var(--text-2);' +
      'border:1px solid var(--border);pointer-events:none;will-change:transform;';
    el.textContent = text;
    layer.appendChild(el);
    labelsRef.current.push({ anchor, el });
  }, []);

  // ── helper: tambahkan bagian yang bisa dibedah ──
  const addPart = useCallback(
    (obj: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, label?: string, labelOffset?: THREE.Vector3) => {
      obj.position.copy(from);
      groupRef.current?.add(obj);
      partsRef.current.push({ obj, from, to });
      if (label && labelOffset) {
        const anchor = new THREE.Object3D();
        anchor.position.copy(labelOffset);
        obj.add(anchor);
        addLabel(anchor, label);
      }
    },
    [addLabel]
  );

  // ── Model 1: kubus s = 2 ──
  const buildKubus = useCallback(() => {
    const s = 2, half = s / 2;
    const faceMat = new THREE.MeshLambertMaterial({ color: C.face, transparent: true, opacity: 0.92 });
    const lineMat = new THREE.LineBasicMaterial({ color: C.edge });
    const normal = new THREE.Vector3();

    const faces: { size: [number, number, number]; pos: THREE.Vector3 }[] = [
      { size: [0.07, s, s], pos: new THREE.Vector3(half + 0.035, 0, 0) },
      { size: [0.07, s, s], pos: new THREE.Vector3(-half - 0.035, 0, 0) },
      { size: [s, 0.07, s], pos: new THREE.Vector3(0, half + 0.035, 0) },
      { size: [s, 0.07, s], pos: new THREE.Vector3(0, -half - 0.035, 0) },
      { size: [s, s, 0.07], pos: new THREE.Vector3(0, 0, half + 0.035) },
      { size: [s, s, 0.07], pos: new THREE.Vector3(0, 0, -half - 0.035) },
    ];
    const names = ['sisi kanan', 'sisi kiri', 'sisi atas', 'sisi alas', 'sisi depan', 'sisi belakang'];
    const labelLocal = new THREE.Vector3(0, 0, 0);

    faces.forEach((f, i) => {
      const geo = new THREE.BoxGeometry(f.size[0], f.size[1], f.size[2]);
      const mesh = new THREE.Mesh(geo, faceMat);
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), lineMat));
      normal.copy(f.pos).normalize();
      const to = f.pos.clone().add(normal.multiplyScalar(1.5));
      // label di tengah sisi
      addPart(mesh, f.pos, to, names[i], labelLocal);
    });

    // diagonal ruang (aksen)
    const dGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-half, -half, -half),
      new THREE.Vector3(half, half, half),
    ]);
    groupRef.current?.add(new THREE.Line(dGeo, new THREE.LineBasicMaterial({ color: C.diagonal })));

    // label panjang sisi + diagonal (statik, anchor di group)
    if (groupRef.current) {
      const aS = new THREE.Object3D();
      aS.position.set(half, -half, half + 0.25);
      groupRef.current.add(aS);
      addLabel(aS, 's = 2 (semua rusuk sama panjang)');
      const aD = new THREE.Object3D();
      aD.position.set(half * 0.75, half * 0.75, half * 0.75);
      groupRef.current.add(aD);
      addLabel(aD, 'diagonal ruang d = s√3 ≈ 3,46');
    }
  }, [addPart, addLabel]);

  // ── Model 2: struktur sel hewan ──
  const buildSel = useCallback(() => {
    const spread = (base: THREE.Vector3, dist: number) => {
      const dir = base.clone().normalize();
      if (dir.lengthSq() < 1e-6) dir.set(1, 0.4, 0.3).normalize();
      return base.clone().add(dir.multiplyScalar(dist));
    };

    // membran sel (statis saat dibedah)
    const membrane = new THREE.Mesh(
      new THREE.SphereGeometry(2.6, 48, 32),
      new THREE.MeshLambertMaterial({ color: C.membrane, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide })
    );
    addPart(membrane, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0), 'Membran sel: pengatur keluar-masuk zat', new THREE.Vector3(0, 2.75, 0));

    // inti sel
    const nucleus = new THREE.Mesh(new THREE.SphereGeometry(0.85, 32, 24), new THREE.MeshLambertMaterial({ color: C.nucleus }));
    nucleus.position.set(-0.35, 0.15, 0);
    addPart(nucleus, nucleus.position.clone(), spread(nucleus.position, 1.2), 'Inti sel: pusat kendali & menyimpan DNA', new THREE.Vector3(0, 1.0, 0));

    // retikulum endoplasma (cincin di sekeliling inti)
    const er = new THREE.Mesh(
      new THREE.TorusGeometry(1.55, 0.07, 12, 48),
      new THREE.MeshLambertMaterial({ color: C.er, transparent: true, opacity: 0.75 })
    );
    er.position.set(-0.35, 0.15, 0);
    er.rotation.x = Math.PI / 2.6;
    addPart(er, er.position.clone(), spread(er.position, 0.8), 'Retikulum endoplasma: jalur transport zat', new THREE.Vector3(1.2, -1.0, 0));

    // 3 mitokondria
    const mitoPos = [new THREE.Vector3(1.5, 0.7, 0.5), new THREE.Vector3(-1.3, -1.0, 0.9), new THREE.Vector3(0.5, 1.4, -1.1)];
    mitoPos.forEach((p, i) => {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.62, 6, 14), new THREE.MeshLambertMaterial({ color: C.mito }));
      m.rotation.set(0.6 * i + 0.3, 0.8 * i, 0.4);
      addPart(m, p, spread(p, 1.3), i === 0 ? 'Mitokondria: produksi energi (respirasi sel)' : undefined, new THREE.Vector3(0, 0.5, 0));
    });

    // badan golgi: 3 cisterna bertumpuk
    const golgiBase = new THREE.Vector3(1.6, -0.7, -0.5);
    const golgi = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(1.0 - i * 0.15, 0.1, 0.5),
        new THREE.MeshLambertMaterial({ color: C.golgi })
      );
      slab.position.y = i * 0.16;
      slab.rotation.y = 0.25 * i;
      golgi.add(slab);
    }
    addPart(golgi, golgiBase, spread(golgiBase, 1.4), 'Badan Golgi: kemas & kirim protein', new THREE.Vector3(0, 0.55, 0));

    // 8 ribosom
    const riboOffsets: THREE.Vector3[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      riboOffsets.push(new THREE.Vector3(Math.cos(a) * 1.9, Math.sin(a * 1.7) * 1.6, Math.sin(a) * 1.9));
    }
    riboOffsets.forEach((p, i) => {
      const r = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshLambertMaterial({ color: C.ribosome }));
      addPart(r, p, spread(p, 0.9), i === 0 ? 'Ribosom: tempat sintesis protein' : undefined, new THREE.Vector3(0, 0.22, 0));
    });
  }, [addPart, addLabel]);

  // ── Model 3: molekul ball-and-stick ──
  const buildMolekul = useCallback((mol: MolekulId) => {
    const atomMat = (color: number) => new THREE.MeshLambertMaterial({ color });
    const addAtom = (pos: THREE.Vector3, radius: number, color: number, grow: number, label?: string) => {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 28, 20), atomMat(color));
      const dir = pos.clone().normalize();
      if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
      const to = pos.clone().add(dir.multiplyScalar(0.95));
      addPart(mesh, pos, to, label, new THREE.Vector3(0, radius + 0.12, 0));
      return grow;
    };
    const addBond = (toAtom: THREE.Vector3, double: boolean) => {
      const len = toAtom.length();
      const dir = toAtom.clone().normalize();
      const make = (offset: number) => {
        const mesh = new THREE.Mesh(
          new THREE.CylinderGeometry(0.055, 0.055, len, 10),
          new THREE.MeshLambertMaterial({ color: C.bond })
        );
        mesh.position.copy(dir.clone().multiplyScalar(len / 2));
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        mesh.quaternion.copy(q);
        if (offset !== 0) {
          const perp = new THREE.Vector3(0, 1, 0).cross(dir).normalize();
          if (perp.lengthSq() < 1e-6) perp.set(1, 0, 0);
          mesh.position.add(perp.multiplyScalar(offset));
          mesh.quaternion.copy(q);
        }
        groupRef.current?.add(mesh);
        bondsRef.current.push({ mesh, grow: 0.95 }); // ikut memanjang saat atom menyebar
      };
      if (double) { make(0.07); make(-0.07); } else { make(0); }
    };

    if (mol === 'h2o') {
      const L = 1.0, half = (104.5 / 2) * (Math.PI / 180);
      addAtom(new THREE.Vector3(0, 0, 0), 0.42, C.oxygen, 0, 'O (oksigen, bermuatan negatif)');
      addBond(new THREE.Vector3(Math.sin(half) * L, 0, Math.cos(half) * L), false);
      addBond(new THREE.Vector3(-Math.sin(half) * L, 0, Math.cos(half) * L), false);
      addAtom(new THREE.Vector3(Math.sin(half) * L, 0, Math.cos(half) * L), 0.26, C.hydrogen, 0, 'H');
      addAtom(new THREE.Vector3(-Math.sin(half) * L, 0, Math.cos(half) * L), 0.26, C.hydrogen, 0);
      const aAngle = new THREE.Object3D();
      aAngle.position.set(0, 0.42, 0.15);
      groupRef.current?.add(aAngle);
      addLabel(aAngle, 'Sudut ikatan 104,5°, molekul bengkok, polar');
      const aBond = new THREE.Object3D();
      aBond.position.set(0, -0.28, 0.4);
      groupRef.current?.add(aBond);
      addLabel(aBond, 'Ikatan kovalen tunggal O–H');
    } else if (mol === 'co2') {
      const L = 1.16;
      addAtom(new THREE.Vector3(0, 0, 0), 0.44, C.carbon, 0, 'C (karbon)');
      addBond(new THREE.Vector3(L, 0, 0), true);
      addBond(new THREE.Vector3(-L, 0, 0), true);
      addAtom(new THREE.Vector3(L, 0, 0), 0.42, C.oxygen, 0, 'O');
      addAtom(new THREE.Vector3(-L, 0, 0), 0.42, C.oxygen, 0);
      const aAngle = new THREE.Object3D();
      aAngle.position.set(0, 0.5, 0);
      groupRef.current?.add(aAngle);
      addLabel(aAngle, 'Linear 180°, nonpolar');
      const aBond = new THREE.Object3D();
      aBond.position.set(0, -0.42, 0);
      groupRef.current?.add(aBond);
      addLabel(aBond, 'Ikatan rangkap dua C=O');
    } else {
      const L = 1.09;
      const dirs = [new THREE.Vector3(1, 1, 1), new THREE.Vector3(1, -1, -1), new THREE.Vector3(-1, 1, -1), new THREE.Vector3(-1, -1, 1)];
      addAtom(new THREE.Vector3(0, 0, 0), 0.44, C.carbon, 0, 'C (karbon)');
      dirs.forEach((d, i) => {
        const p = d.clone().normalize().multiplyScalar(L);
        addBond(p, false);
        addAtom(p, 0.26, C.hydrogen, 0, i === 0 ? 'H' : undefined);
      });
      const aAngle = new THREE.Object3D();
      aAngle.position.set(0, -0.75, 0);
      groupRef.current?.add(aAngle);
      addLabel(aAngle, 'Tetrahedral 109,5°, nonpolar');
    }
  }, [addPart, addLabel]);

  // ── bangun ulang model ──
  const rebuild = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (groupRef.current) {
      scene.remove(groupRef.current);
      groupRef.current.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else if (mat) mat.dispose();
      });
      groupRef.current = null;
    }
    // bersihkan label lama
    labelsRef.current.forEach((l) => l.el.remove());
    labelsRef.current = [];
    if (labelLayerRef.current) labelLayerRef.current.innerHTML = '';

    const g = new THREE.Group();
    groupRef.current = g;
    scene.add(g);
    partsRef.current = [];
    bondsRef.current = [];
    explodeCurRef.current = 0;
    explodeTargetRef.current = 0;
    setExploded(false);

    if (model === 'kubus') buildKubus();
    else if (model === 'sel') buildSel();
    else buildMolekul(molekul);

    // kamera ke preset model
    const cam = cameraRef.current;
    const preset = CAM_PRESET[model].pos;
    if (cam) {
      cam.position.set(preset[0], preset[1], preset[2]);
      controlsRef.current?.target.set(0, 0, 0);
      controlsRef.current?.update();
    }
    setReady(true);
  }, [model, molekul, buildKubus, buildSel, buildMolekul]);

  // ── init scene sekali saat dialog terbuka ──
  useEffect(() => {
    if (!open) return;
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.style.cssText = 'position:absolute;inset:0;touch-action:none;';
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x44403a, 1.15));
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(5, 8, 6);
    scene.add(dir);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 2.2;
    controls.maxDistance = 14;
    controls.autoRotateSpeed = 1.6;

    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;
    controlsRef.current = controls;

    const sizeCanvas = () => {
      const w = mount.clientWidth || 1, h = mount.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    sizeCanvas();
    const ro = new ResizeObserver(sizeCanvas);
    ro.observe(mount);
    roRef.current = ro;

    const reduced = prefersReducedMotion();
    const tick = () => {
      rafRef.current = requestAnimationFrame(tick);
      const target = explodeTargetRef.current;
      explodeCurRef.current = reduced ? target : explodeCurRef.current + (target - explodeCurRef.current) * 0.13;
      const cur = explodeCurRef.current;
      partsRef.current.forEach((p) => p.obj.position.lerpVectors(p.from, p.to, cur));
      bondsRef.current.forEach((b) => { b.mesh.scale.y = 1 + cur * b.grow; });
      labelsRef.current.forEach(({ anchor, el }) => {
        if (!labelsOnRef.current) { el.style.display = 'none'; return; }
        const v = new THREE.Vector3().setFromMatrixPosition(anchor.matrixWorld).project(camera);
        if (v.z > 1) { el.style.display = 'none'; return; }
        el.style.display = 'block';
        const w = mount.clientWidth, h = mount.clientHeight;
        const x = (v.x * 0.5 + 0.5) * w;
        const y = (-v.y * 0.5 + 0.5) * h;
        el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
      });
      controls.update();
      renderer.render(scene, camera);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      rendererRef.current = null;
      sceneRef.current = null;
      groupRef.current = null;
      partsRef.current = [];
      bondsRef.current = [];
      labelsRef.current = [];
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // labels on/off langsung tanpa rebuild
  useEffect(() => {
    if (open && labelsOn) labelsRef.current.forEach(({ el }) => { el.style.display = 'block'; });
  }, [labelsOn, open]);

  // bangun model saat scene siap atau pilihan model berubah
  useEffect(() => {
    if (open && sceneRef.current) rebuild();
  }, [open, model, molekul, rebuild]);

  // auto-rotate toggle
  useEffect(() => {
    if (controlsRef.current) controlsRef.current.autoRotate = autoRotate && !prefersReducedMotion();
  }, [autoRotate]);

  const toggleExplode = () => {
    const next = !exploded;
    setExploded(next);
    explodeTargetRef.current = next ? 1 : 0;
  };

  const resetView = () => {
    const preset = CAM_PRESET[model].pos;
    cameraRef.current?.position.set(preset[0], preset[1], preset[2]);
    controlsRef.current?.target.set(0, 0, 0);
    controlsRef.current?.update();
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl w-[calc(100vw-2rem)] max-h-[94vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg">Lab 3D: alat peraga interaktif</DialogTitle>
          <p className="text-sm text-stone-400">
            Geser (drag) untuk memutar 360 derajat, scroll/cubit untuk zoom, tombol Bedah untuk memisahkan bagian.
          </p>
        </DialogHeader>

        {/* pemilih model */}
        <div className="flex flex-wrap gap-2 mb-1" role="tablist" aria-label="Pilih model 3D">
          {MODELS.map((m) => (
            <button
              key={m.id}
              role="tab"
              aria-selected={model === m.id}
              onClick={() => setModel(m.id)}
              className={
                'flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors ' +
                (model === m.id
                  ? 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text)]'
                  : 'border-[var(--border)] bg-transparent text-[var(--text-2)] hover:bg-[var(--surface-2)]')
              }
            >
              <Box className="h-3.5 w-3.5" />
              {m.label}
            </button>
          ))}
        </div>
        {model === 'molekul' && (
          <div className="flex flex-wrap gap-2 mb-1">
            {MOLEKUL.map((m) => (
              <button
                key={m.id}
                aria-pressed={molekul === m.id}
                onClick={() => setMolekul(m.id)}
                className={
                  'rounded-md border px-2.5 py-1 text-xs transition-colors ' +
                  (molekul === m.id
                    ? 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text)]'
                    : 'border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surface-2)]')
                }
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
        <p className="text-xs text-[var(--text-2)] mb-3">{MODELS.find((m) => m.id === model)?.desc}</p>

        {/* kanvas 3D */}
        <div className="relative rounded-xl border border-[var(--border)] bg-[var(--bg)] overflow-hidden">
          <div ref={mountRef} className="relative h-[46vh] md:h-[460px] w-full" />
          <div ref={labelLayerRef} className="absolute inset-0 pointer-events-none" />
          {!ready && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-stone-500">
              Menyiapkan objek 3D...
            </div>
          )}
        </div>

        {/* kontrol */}
        <div className="flex flex-wrap gap-2 mt-3">
          <Button
            onClick={toggleExplode}
            variant={exploded ? 'default' : 'outline'}
            size="sm"
            className={exploded ? 'bg-[var(--accent)] hover:bg-[var(--accent-hover)]' : 'border-[var(--border)]'}
          >
            <Scissors className="h-3.5 w-3.5 mr-1.5" />
            {exploded ? 'Rakit ulang' : 'Bedah bagian'}
          </Button>
          <Button onClick={() => setLabelsOn((v) => !v)} variant="outline" size="sm" className="border-[var(--border)]">
            <Tag className="h-3.5 w-3.5 mr-1.5" />
            {labelsOn ? 'Sembunyikan label' : 'Tampilkan label'}
          </Button>
          <Button onClick={() => setAutoRotate((v) => !v)} variant="outline" size="sm" className="border-[var(--border)]">
            <RotateCw className="h-3.5 w-3.5 mr-1.5" />
            {autoRotate ? 'Hentikan putaran' : 'Putar otomatis'}
          </Button>
          <Button onClick={resetView} variant="outline" size="sm" className="border-[var(--border)]">
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
            Reset tampilan
          </Button>
        </div>

        {/* penjelasan bagian */}
        <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <p className="text-sm font-medium mb-2">Bagian-bagian yang bisa dibedah</p>
          <ul className="space-y-1.5 text-sm text-[var(--text-2)]">
            {model === 'kubus' && (
              <>
                <li>6 sisi persegi kongruen (luas tiap sisi = s² = 4)</li>
                <li>12 rusuk sama panjang dan 8 titik sudut</li>
                <li>Volume V = s³ = 8; luas permukaan L = 6s² = 24</li>
                <li>Diagonal ruang d = s√3 ≈ 3,46 (garis oranye)</li>
                <li>Saat dibedah, 6 sisi terpisah dan terlihat seperti jaring-jaring; kubus punya 11 pola jaring-jaring</li>
              </>
            )}
            {model === 'sel' && (
              <>
                <li>Membran sel: pembatas selektif yang mengatur keluar-masuk zat</li>
                <li>Inti sel: pusat kendali, menyimpan DNA (biru tua kecoklatan)</li>
                <li>Mitokondria: respirasi sel, menghasilkan energi ATP</li>
                <li>Retikulum endoplasma: jalur transportasi zat di dalam sel</li>
                <li>Badan Golgi: mengemas dan mengirim protein</li>
                <li>Ribosom: tempat sintesis protein (titik-titik kecil)</li>
              </>
            )}
            {model === 'molekul' && molekul === 'h2o' && (
              <>
                <li>Bentuk bengkok (V) dengan sudut ikatan 104,5 derajat (teori VSEPR)</li>
                <li>2 ikatan kovalen tunggal O-H</li>
                <li>Molekul polar: muatan negatif di sisi O, positif di sisi H (sebab air pelarut universal)</li>
              </>
            )}
            {model === 'molekul' && molekul === 'co2' && (
              <>
                <li>Bentuk linear, sudut 180 derajat</li>
                <li>2 ikatan rangkap dua C=O</li>
                <li>Nonpolar meski ikatannya polar, karena simetri meniadakan momen dipol</li>
              </>
            )}
            {model === 'molekul' && molekul === 'ch4' && (
              <>
                <li>Bentuk tetrahedral, sudut 109,5 derajat</li>
                <li>4 ikatan kovalen tunggal C-H</li>
                <li>Nonpolar; geometri mengikuti hibridisasi sp3</li>
              </>
            )}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
