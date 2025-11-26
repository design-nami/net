async function loadThree(){
  try{ return await import('https://unpkg.com/three@0.160.1/build/three.module.js'); }
  catch(e){
    await new Promise((res,rej)=>{ const s=document.createElement('script'); s.src='https://unpkg.com/three@0.160.1/build/three.min.js'; s.onload=res; s.onerror=rej; document.head.appendChild(s); });
    if(!window.THREE) throw new Error('THREE not available'); return window.THREE;
  }
}
const THREE = await loadThree();

(function() {
  const container = document.getElementById('palindrome-glass-root');
  if (!container) return;

// =========================================
    //  定数定義（見た目に関わるパラメータ）
    // =========================================

    // グラス寸法
    const GLASS_HEIGHT          = 2.4;  // 高さ
    const GLASS_DIAMETER_TOP    = 1.4;  // 上面の直径
    const GLASS_DIAMETER_BOTTOM = 1.1;  // 底面の直径
    const GLASS_RADIUS_TOP      = GLASS_DIAMETER_TOP    / 2.0;
    const GLASS_RADIUS_BOTTOM   = GLASS_DIAMETER_BOTTOM / 2.0;

    // グラス輪郭の線
    const LINE_WIDTH_BODY = 1.0;  // 側面
    const RIM_LINE_LEVEL  = 2;    // 飲み口ダブルライン
    const RIM_GAP         = 0.02; // 飲み口の二重輪の間隔

    // XYZ ガイド軸
    const AXIS_LENGTH     = 0.3;
    const LINE_WIDTH_AXIS = 1.0;

    // 文字関連
    const TEXT_INDICES = [14, 12, 10, 8, 6, 4, 2, 0];                  // や・す・ら・ぐ・グ・ラ・ス・や
    const TEXT_CHARS   = ["や", "す", "ら", "ぐ", "グ", "ラ", "ス", "や"];
    const TEXT_PLANE_SIZE = 0.4;                                       // 一文字あたりのプレーン一辺
    const RESAMPLED_COUNT = 15;                                        // レール上のスロット数（や〜や）

    // レイアウト
    const BASE_SIZE = 720;   // これ以上は拡大しない基準
    const MIN_SIZE  = 480;   // 最小想定

    // 自動回転とカメラアングル
    const FOV               = 40;
    const ROT_X_MIN_DEG     = -10;
    const ROT_X_MAX_DEG     =  55;
    const degToRad          = (deg) => deg * Math.PI / 180;
    const ROT_X_MIN         = degToRad(ROT_X_MIN_DEG);
    const ROT_X_MAX         = degToRad(ROT_X_MAX_DEG);
    const AUTO_ROTATE_SPEED = 0.01;
    const DRAG_ROTATE_SPEED = 0.005;

    // 背景色
    const BG_COLOR = 0x0070FF;

    // nami がつくった 16点（ガイド紐の原型）
    const ORIGINAL_POINTS_16 = [
      new THREE.Vector3( 0.6786, 0.6141, -0.0804),
      new THREE.Vector3( 0.6554, 0.3849,  0.1343),
      new THREE.Vector3( 0.5432, 0.1898,  0.3694),
      new THREE.Vector3( 0.3582, 0.0629,  0.5411),
      new THREE.Vector3( 0.0347,-0.0258,  0.6425),
      new THREE.Vector3(-0.3212,-0.0400,  0.5564),
      new THREE.Vector3(-0.5230, 0.0240,  0.3800),
      new THREE.Vector3(-0.6274, 0.0908,  0.1725),
      new THREE.Vector3(-0.6402, 0.1520, -0.1361),
      new THREE.Vector3(-0.5327, 0.2160, -0.3871),
      new THREE.Vector3(-0.3313, 0.2800, -0.5737),
      new THREE.Vector3(-0.0697, 0.3440, -0.6628),
      new THREE.Vector3( 0.2072, 0.4080, -0.6377),
      new THREE.Vector3( 0.4513, 0.4720, -0.5013),
      new THREE.Vector3( 0.6198, 0.5360, -0.2760),
      new THREE.Vector3( 0.6825, 0.6000,  0.0000)
    ];

    // =========================================
    //  THREE.js 基本セットアップ
    // =========================================

    let scene, camera, renderer;
    let glassGroup;
    let autoRotate = true;
    let isDragging = false;
    const prevMouse = { x: 0, y: 0 };

    init();
    animate();

    function init() {
      initSceneAndCamera();
      initRenderer();
      initGlassGroup();
      addGlassWireframe();
      addInnerAxes();
      addTextAlongGuide();

      // 初期姿勢：やや鳥瞰＋30度傾け
      glassGroup.rotation.z = degToRad(30);
      glassGroup.rotation.x = degToRad(20);

      updateLayout();
      initMouseControls();
      window.addEventListener("resize", onWindowResize);
    }

    function initSceneAndCamera() {
      scene = new THREE.Scene();

      let aspect;
      if (container) {
        const rect = container.getBoundingClientRect();
        aspect = rect.width / rect.width; // 正方形前提
      } else {
        aspect = window.innerWidth / window.innerHeight;
      }
      camera = new THREE.PerspectiveCamera(FOV, aspect, 0.1, 100);
      camera.position.set(0, 1.2, 6);
      camera.lookAt(0, 0, 0);
    }

    function initRenderer() {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      // A-3 の箱にだけ描画し、背景はページの青に透かす
      renderer.setClearColor(BG_COLOR, 0);
      if (container) {
        container.appendChild(renderer.domElement);
      } else {
        document.body.appendChild(renderer.domElement);
      }
    }

    function initGlassGroup() {
      glassGroup = new THREE.Group();
      scene.add(glassGroup);
    }

    // =========================================
    //  グラス本体
    // =========================================

    function radiusAtY(y) {
      const t = (y + GLASS_HEIGHT / 2) / GLASS_HEIGHT; // 0〜1
      return GLASS_RADIUS_BOTTOM + t * (GLASS_RADIUS_TOP - GLASS_RADIUS_BOTTOM);
    }

    function addGlassWireframe() {
      const radialSegments = 32;
      const heightSegments = 1;
      const openEnded = true;

      // 側面
      const cylGeo = new THREE.CylinderGeometry(
        GLASS_RADIUS_TOP,
        GLASS_RADIUS_BOTTOM,
        GLASS_HEIGHT,
        radialSegments,
        heightSegments,
        openEnded
      );

      const sideEdges = new THREE.EdgesGeometry(cylGeo);
      const sideMat = new THREE.LineBasicMaterial({
        color: 0xffffff,
        linewidth: LINE_WIDTH_BODY
      });
      const sideWire = new THREE.LineSegments(sideEdges, sideMat);

      const group = new THREE.Group();
      group.add(sideWire);

      // 飲み口（上面輪郭）
      const topY = GLASS_HEIGHT / 2;
      const radialSegs = radialSegments;
      const rimMat = new THREE.LineBasicMaterial({
        color: 0xffffff,
        linewidth: 1.0
      });

      if (RIM_LINE_LEVEL === 1) {
        const topRimGeo = new THREE.CircleGeometry(GLASS_RADIUS_TOP, radialSegs);
        topRimGeo.rotateX(-Math.PI / 2);
        const topRimEdges = new THREE.EdgesGeometry(topRimGeo);
        const topRim = new THREE.LineSegments(topRimEdges, rimMat);
        topRim.position.y = topY;
        group.add(topRim);
      } else {
        const outerGeo = new THREE.CircleGeometry(GLASS_RADIUS_TOP, radialSegs);
        outerGeo.rotateX(-Math.PI / 2);
        const outerEdges = new THREE.EdgesGeometry(outerGeo);
        const outerRim = new THREE.LineSegments(outerEdges, rimMat);
        outerRim.position.y = topY;
        group.add(outerRim);

        const innerRadius = Math.max(0, GLASS_RADIUS_TOP - RIM_GAP);
        const innerGeo = new THREE.CircleGeometry(innerRadius, radialSegs);
        innerGeo.rotateX(-Math.PI / 2);
        const innerEdges = new THREE.EdgesGeometry(innerGeo);
        const innerRim = new THREE.LineSegments(innerEdges, rimMat);
        innerRim.position.y = topY;
        group.add(innerRim);
      }

      // 底面輪郭
      const bottomRimGeo = new THREE.CircleGeometry(GLASS_RADIUS_BOTTOM, radialSegments);
      bottomRimGeo.rotateX(-Math.PI / 2);
      const bottomRimEdges = new THREE.EdgesGeometry(bottomRimGeo);
      const bottomRim = new THREE.LineSegments(bottomRimEdges, sideMat);
      bottomRim.position.y = -GLASS_HEIGHT / 2 + 0.1;
      group.add(bottomRim);

      glassGroup.add(group);
    }

    // =========================================
    //  XYZ 軸
    // =========================================

    function addInnerAxes() {
      const size = AXIS_LENGTH;
      const axisGroup = new THREE.Group();
      const axisMat = new THREE.LineBasicMaterial({
        color: 0xffffff,
        linewidth: LINE_WIDTH_AXIS
      });

      function addAxis(from, to) {
        const geo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3().fromArray(from),
          new THREE.Vector3().fromArray(to)
        ]);
        axisGroup.add(new THREE.Line(geo, axisMat));
      }

      addAxis([-size, 0, 0], [ size, 0, 0]);
      addAxis([0, -size, 0], [0,  size, 0]);
      addAxis([0, 0, -size], [0,  0,  size]);

      glassGroup.add(axisGroup);
    }

    // =========================================
    //  ガイド紐（等距離15点）と文字配置
    // =========================================

    function createGuideEqualArcLength() {
      const baseCurve = new THREE.CatmullRomCurve3(ORIGINAL_POINTS_16, false, "centripetal");

      const SAMPLE_STEPS = 400;
      const ts      = [];
      const cumLen  = [];
      let totalLen  = 0;
      let prevPoint = baseCurve.getPoint(0);

      ts.push(0);
      cumLen.push(0);

      for (let i = 1; i <= SAMPLE_STEPS; i++) {
        const t = i / SAMPLE_STEPS;
        const p = baseCurve.getPoint(t);
        const dx = p.x - prevPoint.x;
        const dy = p.y - prevPoint.y;
        const dz = p.z - prevPoint.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        totalLen += dist;

        ts.push(t);
        cumLen.push(totalLen);
        prevPoint = p;
      }

      function findTforDistance(target) {
        if (target <= 0) return 0;
        if (target >= totalLen) return 1;

        let low = 0;
        let high = cumLen.length - 1;

        while (low < high) {
          const mid = (low + high) >> 1;
          if (cumLen[mid] < target) {
            low = mid + 1;
          } else {
            high = mid;
          }
        }

        const i       = Math.max(1, low);
        const prevLen = cumLen[i - 1];
        const nextLen = cumLen[i];
        const span    = nextLen - prevLen || 1;
        const ratio   = (target - prevLen) / span;

        const tPrev = ts[i - 1];
        const tNext = ts[i];
        return tPrev + (tNext - tPrev) * ratio;
      }

      const anchorPoints = [];
      for (let i = 0; i < RESAMPLED_COUNT; i++) {
        const d = totalLen * (i / (RESAMPLED_COUNT - 1));
        const t = findTforDistance(d);
        anchorPoints.push(baseCurve.getPoint(t));
      }

      return anchorPoints;
    }

    function addTextAlongGuide() {
      const anchorPoints = createGuideEqualArcLength();

      for (let i = 0; i < TEXT_INDICES.length; i++) {
        const slotIndex = TEXT_INDICES[i];
        const ch        = TEXT_CHARS[i];
        const guidePos  = anchorPoints[slotIndex];

        // 高さと角度からグラス側面上の位置に投影
        const y     = guidePos.y;
        const angle = Math.atan2(guidePos.z, guidePos.x);
        const r     = radiusAtY(y);

        const textPos = new THREE.Vector3(
          Math.cos(angle) * r,
          y,
          Math.sin(angle) * r
        );

        // 紐の方向ベクトル（両側の線分の平均）
        const prevIndex = (slotIndex === 0) ? 0 : slotIndex - 1;
        const nextIndex = (slotIndex === anchorPoints.length - 1)
          ? anchorPoints.length - 1
          : slotIndex + 1;

        const prev = anchorPoints[prevIndex];
        const next = anchorPoints[nextIndex];

        const vPrev = new THREE.Vector3().subVectors(guidePos, prev);
        const vNext = new THREE.Vector3().subVectors(next, guidePos);
        const tangent = new THREE.Vector3().addVectors(vPrev, vNext);

        if (tangent.lengthSq() === 0) {
          tangent.set(0, 0, 1);
        } else {
          tangent.normalize();
        }

        // グラス外側の法線（半径方向）
        const normal = new THREE.Vector3(textPos.x, 0, textPos.z);
        if (normal.lengthSq() === 0) {
          normal.set(1, 0, 0);
        } else {
          normal.normalize();
        }

        // 紐方向をグラス面の接平面上に投影したもの → X軸
        const xAxis = tangent.clone().sub(
          normal.clone().multiplyScalar(tangent.dot(normal))
        );
        if (xAxis.lengthSq() === 0) {
          xAxis.set(0, 0, 1);
        } else {
          xAxis.normalize();
        }

        const zAxis = normal.clone(); // グラス外側方向
        let yAxis   = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();

        // 上下が反転しないように Y軸の向きを調整
        if (yAxis.y < 0) {
          yAxis.multiplyScalar(-1);
          xAxis.multiplyScalar(-1);
        }

        const planeGeo = new THREE.PlaneGeometry(TEXT_PLANE_SIZE, TEXT_PLANE_SIZE);
        const texture  = createTextTexture(ch);
        const material = new THREE.MeshBasicMaterial({
          map:        texture,
          transparent: true,
          color:       0xffffff,
          side:        THREE.DoubleSide,
          depthTest:   false,
          depthWrite:  false
        });

        const mesh = new THREE.Mesh(planeGeo, material);
        mesh.position.copy(textPos);

        const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
        mesh.setRotationFromMatrix(basis);

        glassGroup.add(mesh);
      }
    }

    function createTextTexture(ch) {
      const size = 512;
      const canvas = document.createElement("canvas");
      canvas.width  = size;
      canvas.height = size;

      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, size, size);

      ctx.fillStyle   = "#FFFFFF";
      const fontSize  = size * 0.55;
      ctx.font        = fontSize + 'px "Yu Mincho", "游明朝", "Hiragino Mincho ProN", serif';
      ctx.textBaseline = "middle";
      ctx.textAlign    = "center";

      const x = size / 2;
      const y = size / 2 + size * 0.02;
      ctx.fillText(ch, x, y);

      const texture = new THREE.CanvasTexture(canvas);
      texture.anisotropy       = renderer.capabilities.getMaxAnisotropy();
      texture.needsUpdate      = true;
      texture.minFilter        = THREE.LinearFilter;
      texture.magFilter        = THREE.LinearFilter;
      texture.generateMipmaps  = false;

      return texture;
    }

    // =========================================
    //  レイアウト・インタラクション
    // =========================================

    function updateLayout() {
      let w, h;

      if (container) {
        const rect = container.getBoundingClientRect();
        // 正方形レイアウト: 幅 = 高さ
        w = rect.width;
        h = rect.width;
        container.style.height = h + "px";
      } else {
        w = window.innerWidth;
        h = window.innerHeight;
      }

      renderer.setSize(w, h);
      renderer.setClearColor(BG_COLOR, container ? 0 : 1);

      camera.aspect = w / h;
      camera.updateProjectionMatrix();

      const shortSide = Math.min(w, h);
      const S         = Math.max(MIN_SIZE, shortSide);

      const scale = (S <= BASE_SIZE) ? 1.0 : (BASE_SIZE / S);
      glassGroup.scale.set(scale, scale, scale);
    }

    function initMouseControls() {
      const dom = renderer.domElement;

      dom.addEventListener("pointerdown", (e) => {
        isDragging   = true;
        autoRotate   = false;
        prevMouse.x  = e.clientX;
        prevMouse.y  = e.clientY;
      });

      window.addEventListener("pointermove", (e) => {
        if (!isDragging) return;

        const deltaX = e.clientX - prevMouse.x;
        const deltaY = e.clientY - prevMouse.y;
        prevMouse.x  = e.clientX;
        prevMouse.y  = e.clientY;

        glassGroup.rotation.y += deltaX * DRAG_ROTATE_SPEED;
        glassGroup.rotation.x += deltaY * DRAG_ROTATE_SPEED;

        // 煽りアングル制限
        if (glassGroup.rotation.x < ROT_X_MIN) glassGroup.rotation.x = ROT_X_MIN;
        if (glassGroup.rotation.x > ROT_X_MAX) glassGroup.rotation.x = ROT_X_MAX;
      });

      window.addEventListener("pointerup", () => {
        isDragging = false;
        autoRotate = true;
      });

      window.addEventListener("pointerleave", () => {
        isDragging = false;
        autoRotate = true;
      });
    }

    function animate() {
      requestAnimationFrame(animate);

      if (autoRotate && !isDragging) {
        glassGroup.rotation.y -= AUTO_ROTATE_SPEED;
      }

      renderer.render(scene, camera);
    }

    function onWindowResize() {
      updateLayout();
    }
})();
