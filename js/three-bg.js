// ============================================================
// IANF - Cena 3D de fundo: globo wireframe, partículas e anéis
// ============================================================
import * as THREE from 'three';

export function initBackground(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xfff3e2, 0.0009);

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
  camera.position.set(0, 0, 26);

  // ---------- Grupo do globo ----------
  const globeGroup = new THREE.Group();
  scene.add(globeGroup);

  // Esfera interna com gradiente roxo
  const innerGeo = new THREE.IcosahedronGeometry(7.2, 3);
  const innerMat = new THREE.MeshBasicMaterial({ color: 0x7c3aed, wireframe: true, transparent: true, opacity: 0.3 });
  const inner = new THREE.Mesh(innerGeo, innerMat);
  globeGroup.add(inner);

  // Malha externa laranja/púrpura
  const outerGeo = new THREE.IcosahedronGeometry(8.6, 2);
  const outerMat = new THREE.MeshBasicMaterial({ color: 0xff6b00, wireframe: true, transparent: true, opacity: 0.3 });
  const outer = new THREE.Mesh(outerGeo, outerMat);
  globeGroup.add(outer);

  // Pontos de "dados" na superfície (nós do globo)
  const nodesCount = 900;
  const nodesPositions = new Float32Array(nodesCount * 3);
  const radius = 8.6;
  for (let i = 0; i < nodesCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    nodesPositions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    nodesPositions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
    nodesPositions[i * 3 + 2] = radius * Math.cos(phi);
  }
  const nodesGeo = new THREE.BufferGeometry();
  nodesGeo.setAttribute('position', new THREE.BufferAttribute(nodesPositions, 3));
  const nodesMat = new THREE.PointsMaterial({
    size: 0.12,
    color: 0xea580c,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  const nodes = new THREE.Points(nodesGeo, nodesMat);
  globeGroup.add(nodes);

  // Anéis orbitais
  const ringGroup = new THREE.Group();
  scene.add(ringGroup);
  const rings = [];
  const ringConfigs = [
    { r: 11.5, color: 0xea580c, opacity: 0.6, tiltX: 0.4, tiltZ: 0.1, speed: 0.0006 },
    { r: 13.2, color: 0x7c3aed, opacity: 0.45, tiltX: 0.9, tiltZ: 0.35, speed: -0.0004 },
    { r: 15.0, color: 0x2563eb, opacity: 0.4, tiltX: 1.3, tiltZ: 0.6, speed: 0.00025 },
  ];
  for (const cfg of ringConfigs) {
    const geo = new THREE.TorusGeometry(cfg.r, 0.035, 8, 220);
    const mat = new THREE.MeshBasicMaterial({
      color: cfg.color, transparent: true, opacity: cfg.opacity, depthWrite: false,
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = cfg.tiltX;
    ring.rotation.z = cfg.tiltZ;
    ring.userData.speed = cfg.speed;
    ringGroup.add(ring);
    rings.push(ring);
  }

  // Satélites orbitando nos anéis
  const sats = [];
  for (let i = 0; i < 3; i++) {
    const geo = new THREE.SphereGeometry(0.14, 10, 10);
    const mat = new THREE.MeshBasicMaterial({
      color: i === 0 ? 0xea580c : i === 1 ? 0x7c3aed : 0x2563eb,
    });
    const sat = new THREE.Mesh(geo, mat);
    sat.userData = { ringRadius: ringConfigs[i].r, speed: ringConfigs[i].speed * 10, offset: (i * Math.PI * 2) / 3 };
    scene.add(sat);
    sats.push(sat);
  }

  // Partículas de fundo (poeira escura sobre fundo claro)
  const starCount = 1400;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    starPos[i * 3] = (Math.random() - 0.5) * 90;
    starPos[i * 3 + 1] = (Math.random() - 0.5) * 60;
    starPos[i * 3 + 2] = (Math.random() - 0.5) * 60 - 20;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({
    size: 0.06,
    color: 0x334155,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  // Luzes coloridas suaves
  const purpleLight = new THREE.PointLight(0x8b5cf6, 500, 60);
  purpleLight.position.set(-14, 8, 10);
  scene.add(purpleLight);
  const orangeLight = new THREE.PointLight(0xff6b00, 450, 60);
  orangeLight.position.set(14, -6, 12);
  scene.add(orangeLight);
  const blueLight = new THREE.PointLight(0x2563eb, 380, 60);
  blueLight.position.set(0, 16, -8);
  scene.add(blueLight);

  // ---------- Interação com o mouse ----------
  const mouse = { x: 0, y: 0 };
  window.addEventListener('pointermove', (e) => {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
  });

  // ---------- Loop ----------
  const clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    const t = clock.getElapsedTime();

    globeGroup.rotation.y += 0.0022;
    globeGroup.rotation.x = Math.sin(t * 0.18) * 0.15;
    globeGroup.position.y = Math.sin(t * 0.5) * 0.6;

    for (const ring of rings) ring.rotation.z += ring.userData.speed;

    for (const sat of sats) {
      const { ringRadius, speed, offset } = sat.userData;
      const angle = t * speed + offset;
      sat.position.set(Math.cos(angle) * ringRadius, Math.sin(angle * 0.7) * 2.4, Math.sin(angle) * ringRadius);
    }

    stars.rotation.y += 0.0003;
    nodes.rotation.y += 0.0008;

    camera.position.x += (mouse.x * 4.5 - camera.position.x) * 0.04;
    camera.position.y += (-mouse.y * 3 - camera.position.y) * 0.04;
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
  }
  animate();

  // ---------- Resize ----------
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}
