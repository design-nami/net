
  // ========== Core ==========
  async function loadThree(){
    try{ return await import('https://unpkg.com/three@0.160.1/build/three.module.js'); }
    catch(e){
      await new Promise((res,rej)=>{ const s=document.createElement('script'); s.src='https://unpkg.com/three@0.160.1/build/three.min.js'; s.onload=res; s.onerror=rej; document.head.appendChild(s); });
      if(!window.THREE) throw new Error('THREE not available'); return window.THREE;
    }
  }
  const THREE = await loadThree();
  const TUNING = {
    FOAM_INTENSITY: 5.5,          // overall foam emission intensity
    LEFT_BIAS: 0.90,              // how strongly spawn is biased to the left side

    ADV_BASE: 3.2,                // base advection speed along main flow
    ADV_PUSH_SCALE: 0.9,          // how much ppush contributes to extra advection
    ADV_CREST_SCALE: 0.25,        // how much crest amplifies advection
    ADV_GLOBAL_MULT: 1.30,        // global multiplier for advection speed

    BASE_GRAV_Y: -48.0,           // base gravity for airborne foam
    FALL_MULT: 1.60,              // extra gravity when falling

    AIR_VY_MIN: 12.0,             // min initial vertical speed when going airborne
    AIR_VY_MAX: 22.0,             // max initial vertical speed when going airborne
    AIR_HYST: 0.05,               // hysteresis threshold when re-attaching to surface

    AIR_HDRAG_UP: 0.995,          // horizontal drag while moving upward
    AIR_HDRAG_DOWN: 0.993         // horizontal drag while falling
  };


  const app = document.getElementById('app');
  const renderer = new THREE.WebGLRenderer({ antialias:false, alpha:true, powerPreference:'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.setClearColor(new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()||'#0050ff'), 0);
  app.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(10.5, innerWidth/innerHeight, 0.1, 2500);
  camera.position.set(0, 24, 44);
  camera.lookAt(0, 100, -320);

  const rig = new THREE.Group();
  rig.position.y = 80;
  scene.add(rig);

  // ========== Ocean surface (Gerstner mix) ==========
  const G = 9.81;
  const norm2 = (x,z)=>{ const s = Math.hypot(x,z)||1; return [x/s, z/s]; };

  // Five-component spectrum (locked numbers), main flow rotated +15° toward +Z
  const WAVES=[
    { dir:norm2( 1.0, 0.18), A:58, L:1200, Q:0.92 },  // main
    { dir:norm2( 0.7, 0.35), A:38, L: 700, Q:0.90 },
    { dir:norm2( 0.15, 1.0), A:26, L: 420, Q:0.86 },
    { dir:norm2(-1.0, 0.05), A:16, L: 260, Q:0.80 },
    { dir:norm2( 0.9,-0.15), A:10, L: 140, Q:0.72 },
  ].map(w=>{ const k=2*Math.PI/w.L, w0=Math.sqrt(G*k); return {...w,k,w0}; });

  // Rotate main wave (#0) +15° toward +Z
  {
    const baseAng = Math.atan2(0.18, 1.0);
    const ang = baseAng + 15*Math.PI/180;
    WAVES[0].dir[0] = Math.cos(ang);
    WAVES[0].dir[1] = Math.sin(ang);
  }
  const MAIN_DIR = WAVES[0].dir;
  const A_SUM = WAVES.reduce((s,w)=>s+w.A,0);

  // scratch pool (no GC)
  const WPOOL = Array.from({length:8},()=>({y:0,dx:0,dz:0,vx:0,vz:0,crest:0}));
  let wpi=0;

  function wave(x,z,t){
    const out = WPOOL[wpi]; wpi=(wpi+1)&7;
    let y=0,dx=0,dz=0,vx=0,vz=0;

    for(const w of WAVES){
      const phi = (w.dir[0]*x + w.dir[1]*z)*w.k - w.w0*t;
      const s = Math.sin(phi), c = Math.cos(phi);
      y  += w.A * s;
      dx += w.A * w.k * w.dir[0] * c;
      dz += w.A * w.k * w.dir[1] * c;
      const amp = w.Q * w.A * w.w0;
      vx += amp * w.dir[0] * c;
      vz += amp * w.dir[1] * c;
    }

    // local orientation perturbation (break banding)
    const th = 0.6*Math.sin(0.11*t + 0.003*z) + 0.3*Math.sin(0.07*t + 0.002*x);
    const cdx = Math.cos(th), cdz = Math.sin(th);

    // fine ripples
    const k1=2*Math.PI/90, w1=Math.sqrt(G*k1);
    { const ph=(cdx*x+cdz*z)*k1 - w1*t; const s=Math.sin(ph), c=Math.cos(ph);
      y+=2.0*s; dx+=2.0*k1*cdx*c; dz+=2.0*k1*cdz*c; vx+=0.8*w1*cdx*c; vz+=0.8*w1*cdz*c; }

    const k2=2*Math.PI/60, w2=Math.sqrt(G*k2);
    { const ph=(cdx*x+cdz*z)*k2 - w2*(t+0.3); const s=Math.sin(ph), c=Math.cos(ph);
      y+=1.4*s; dx+=1.4*k2*cdx*c; dz+=1.4*k2*cdz*c; vx+=0.6*w2*cdx*c; vz+=0.6*w2*cdz*c; }

    const slope = Math.hypot(dx,dz);
    let crest = ( (y/(A_SUM||1))*0.85 + slope*0.45 );
    crest = (crest - 0.18)/0.17; if(crest<0)crest=0; else if(crest>1)crest=1;

    out.y=y; out.dx=dx; out.dz=dz; out.vx=vx; out.vz=vz; out.crest=crest;
    return out;
  }

  // ========== Particles ==========
  const screenFactor = Math.min(1, (innerWidth*innerHeight)/(1920*1080));
  const FOAM_MAX = Math.floor(140000*(0.7+0.3*screenFactor));

  // typed buffers
  const pos   = new Float32Array(FOAM_MAX*3);
  const vel   = new Float32Array(FOAM_MAX*2);
  const jdir  = new Float32Array(FOAM_MAX*2);
  const jfreq = new Float32Array(FOAM_MAX);
  const jphase= new Float32Array(FOAM_MAX);
  const jamp  = new Float32Array(FOAM_MAX);
  const offx  = new Float32Array(FOAM_MAX);
  const offz  = new Float32Array(FOAM_MAX);
  const offt  = new Float32Array(FOAM_MAX);
  const pfollow=new Float32Array(FOAM_MAX);
  const ppush = new Float32Array(FOAM_MAX);
  const yoff  = new Float32Array(FOAM_MAX);
  const pdir  = new Float32Array(FOAM_MAX);
  const tscale= new Float32Array(FOAM_MAX);
  const arot  = new Float32Array(FOAM_MAX);

  // airborne extras
  const air = new Uint8Array(FOAM_MAX);
  const vy  = new Float32Array(FOAM_MAX);

  let alive=0;

  // geometry/material (pixel-locked size)
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
  geo.setDrawRange(0,0);

  const px = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--grain'))||1.2;
  const mat = new THREE.PointsMaterial({
    color:0xffffff,
    size:px * renderer.getPixelRatio(),
    sizeAttenuation:false,
    depthWrite:false
  });
  const pts = new THREE.Points(geo,mat);
  rig.add(pts);

  // spawn patch & emission
  const PATCH={ xMin:-900, xMax:375, zMin:-700, zMax:-250 };
  let   FOAM_INTENSITY=TUNING.FOAM_INTENSITY, LEFT_BIAS=TUNING.LEFT_BIAS;
  const THIN_START=0.55, THIN_END=0.90, BAND_THIN=0.28, ROGUE_BOOST=0.25, THIN_GRACE=8.0;
  const smoothstep=(a,b,x)=>{ let t=(x-a)/(b-a); if(t<0)t=0; else if(t>1)t=1; return t*t*(3-2*t); };

  const XPPOOL = Array.from({length:32},()=>[0,0]); let xpi=0;
  function sampleXZ(){
    const out=XPPOOL[xpi]; xpi=(xpi+1)&31;
    const w=PATCH.xMax-PATCH.xMin; let x;
    if(Math.random()<LEFT_BIAS){
      const L=PATCH.xMin+w*0.35, u=Math.random();
      x=PATCH.xMin + (L-PATCH.xMin)*(u*u);
    }else{
      x=PATCH.xMin + Math.random()*w;
    }
    const z=PATCH.zMin + (PATCH.zMax-PATCH.zMin) * (Math.random()**1.3);
    out[0]=x; out[1]=z; return out;
  }

  // physics (locked)
  const BASE_GRAV_Y=TUNING.BASE_GRAV_Y, FALL_MULT=TUNING.FALL_MULT;
  const AIR_VY_MIN=TUNING.AIR_VY_MIN, AIR_VY_MAX=TUNING.AIR_VY_MAX, AIR_HYST=TUNING.AIR_HYST;
  const AIR_HDRAG_UP=TUNING.AIR_HDRAG_UP, AIR_HDRAG_DOWN=TUNING.AIR_HDRAG_DOWN;

  function spawn(i,x,z,t,strength,rboost){
    const i3=i*3, ix=i*2, w=wave(x,z,t);

    pos[i3]=x; pos[i3+1]=w.y+0.5; pos[i3+2]=z;

    const base=28+strength*8, kick=(Math.random()-0.5)*24*strength;
    vel[ix]  = w.vx*0.22 + MAIN_DIR[0]*base + kick;
    vel[ix+1]= w.vz*0.22 + MAIN_DIR[1]*base + kick;

    const th=Math.random()*Math.PI*2;
    jdir[ix]=Math.cos(th); jdir[ix+1]=Math.sin(th);
    jfreq[i]=0.25+Math.random()*1.25;
    jphase[i]=Math.random()*Math.PI*2;
    jamp[i]=10+Math.random()*20;

    offx[i]=(Math.random()*2-1)*28;
    offz[i]=(Math.random()*2-1)*28;
    offt[i]=(Math.random()*2-1)*0.6;

    pfollow[i]=0.18+Math.random()*0.14;
    ppush[i]=Math.random()*3.0;
    yoff[i]=Math.random()*0.8;

    pdir[i]=(Math.random()*2-1)*0.105;
    tscale[i]=0.99+Math.random()*0.02;
    arot[i]=(Math.random()*2-1)*0.03;

    // rogue
    let rogue=false;
    if(strength>1.7){
      const prob=Math.min(0.95, 0.60*(strength-1.0)*(rboost||1));
      if(Math.random()<prob){
        rogue=true;
        pfollow[i]=0.08+Math.random()*0.08;
        ppush[i]+=0.8+Math.random()*1.0;
        yoff[i]+=0.4+Math.random()*0.5;
        pdir[i]+=(Math.random()*2-1)*0.21;
        vel[ix]  += (Math.random()-0.5)*22;
        vel[ix+1]+= (Math.random()-0.5)*22;
      }
    }
    if(rogue && Math.random()<0.55){ // airborne
      air[i]=1;
      vy[i]= AIR_VY_MIN + Math.random()*(AIR_VY_MAX - AIR_VY_MIN);
    }else{ air[i]=0; vy[i]=0; }
  }

  function prime(t){
    const tries=7000, ramp=Math.max(0,Math.min(1,(t-t0)/THIN_GRACE));
    for(let s=0; s<tries && alive<FOAM_MAX; s++){
      const p=sampleXZ(), x=p[0], z=p[1], w=wave(x,z,t);
      if(w.crest>0.18){
        const thin=smoothstep(THIN_START,THIN_END,w.crest);
        const thinF = 1.0 - BAND_THIN*thin*ramp;
        const n = 1 + Math.floor(w.crest*6.0*thinF);
        const rboost = 1.0 + ROGUE_BOOST*thin*ramp;
        for(let k=0; k<n && alive<FOAM_MAX; k++){
          spawn(alive, x+(Math.random()-0.5)*8, z+(Math.random()-0.5)*8, t, 1+w.crest, rboost);
          alive++;
        }
      }
    }
    geo.setDrawRange(0,alive);
  }

  function emit(t,dt){
    const BASE=2600, S=Math.floor(BASE*dt*FOAM_INTENSITY*(0.9+0.1*screenFactor));
    const ramp=Math.max(0,Math.min(1,(t-t0)/THIN_GRACE)); let spawned=0;

    for(let s=0; s<S && alive<FOAM_MAX; s++){
      const p=sampleXZ(), x=p[0], z=p[1], w=wave(x,z,t);
      const P=0.42 + w.crest*0.56;
      if(Math.random()<P){
        const thin=smoothstep(THIN_START,THIN_END,w.crest);
        const thinF = 1.0 - BAND_THIN*thin*ramp;
        const n = 1 + Math.floor(w.crest*6.0*thinF);
        const rboost = 1.0 + ROGUE_BOOST*thin*ramp;
        for(let k=0; k<n && alive<FOAM_MAX; k++){
          spawn(alive, x+(Math.random()-0.5)*9, z+(Math.random()-0.5)*9, t, 1+w.crest, rboost);
          alive++; spawned++;
        }
      }
    }
    const MIN=Math.floor(160*dt*FOAM_INTENSITY);
    for(let i=spawned; i<MIN && alive<FOAM_MAX; i++){
      const p=sampleXZ(); spawn(alive, p[0], p[1], t, 1.0, 1.0); alive++;
    }
    geo.setDrawRange(0,alive);
  }

  function step(t,dt){
    let i=0;
    while(i<alive){
      const i3=i*3, ix=i*2;

      let x=pos[i3], z=pos[i3+2];
      let vx=vel[ix], vz=vel[ix+1];

      const w = wave(x+offx[i], z+offz[i], t+offt[i]);

      const aM = 0.08*Math.sin(0.25*t+0.003*z) + 0.05*Math.sin(0.17*t+0.002*x);
      const ang = pdir[i] + aM + arot[i]*(t+offt[i]);
      const ca=Math.cos(ang), sa=Math.sin(ang);

      const advx0 = MAIN_DIR[0]*ca - MAIN_DIR[1]*sa;
      const advz0 = MAIN_DIR[0]*sa + MAIN_DIR[1]*ca;

      const gl=Math.hypot(w.dx,w.dz)||1, gx=w.dx/gl, gz=w.dz/gl;
      const mix = 0.20 + 0.45*w.crest;

      const dirx = advx0*(1-mix) + gx*mix;
      const dirz = advz0*(1-mix) + gz*mix;
      const dn=Math.hypot(dirx,dirz)||1;
      const ax = dirx/dn, az = dirz/dn;

      const adv = (TUNING.ADV_BASE + TUNING.ADV_PUSH_SCALE*ppush[i]) * (1+TUNING.ADV_CREST_SCALE*w.crest) * TUNING.ADV_GLOBAL_MULT; // speed=100%

      vx += (w.vx*pfollow[i]-vx)*0.42 + ax*adv;
      vz += (w.vz*pfollow[i]-vz)*0.42 + az*adv;

      const tl=t*tscale[i]+offt[i];
      const j1=Math.sin(jfreq[i]*tl + jphase[i]) * jamp[i];
      const j2=Math.sin(jfreq[i]*1.732*tl + jphase[i] + 1.234) * jamp[i]*0.55;
      vx += (jdir[ix]*j1 + jdir[ix]*j2) * dt * 1.2;
      vz += (jdir[ix+1]*j1 + jdir[ix+1]*j2) * dt * 1.2;

      x += vx*dt; z += vz*dt;

      const surfY = wave(x+offx[i], z+offz[i], t+offt[i]).y + yoff[i];
      if(air[i]){
        pos[i3+1] += vy[i]*dt;
        const g = BASE_GRAV_Y * (vy[i] < 0 ? FALL_MULT : 1.0);
        vy[i]     += g*dt;
        const drag = vy[i] < 0 ? AIR_HDRAG_DOWN : AIR_HDRAG_UP;
        vx *= drag; vz *= drag;
        if(pos[i3+1] <= surfY + AIR_HYST){ pos[i3+1]=surfY; air[i]=0; vy[i]=0; }
      }else{
        pos[i3+1] = surfY;
      }

      pos[i3]=x; pos[i3+2]=z; vel[ix]=vx; vel[ix+1]=vz;

      // cull
      const out = (x<PATCH.xMin-120||x>PATCH.xMax+120||z<PATCH.zMin-240||z>PATCH.zMax+420);
      if(out){
        const last=alive-1;
        if(i!==last){
          pos[i3]=pos[last*3]; pos[i3+1]=pos[last*3+1]; pos[i3+2]=pos[last*3+2];
          vel[ix]=vel[last*2]; vel[ix+1]=vel[last*2+1];
          jdir[ix]=jdir[last*2]; jdir[ix+1]=jdir[last*2+1];
          jfreq[i]=jfreq[last]; jphase[i]=jphase[last]; jamp[i]=jamp[last];
          offx[i]=offx[last]; offz[i]=offz[last]; offt[i]=offt[last];
          pfollow[i]=pfollow[last]; ppush[i]=ppush[last];
          yoff[i]=yoff[last]; pdir[i]=pdir[last]; tscale[i]=tscale[last]; arot[i]=arot[last];
          air[i]=air[last]; vy[i]=vy[last];
        }
        alive--; geo.setDrawRange(0,alive); continue;
      }
      i++;
    }
    geo.attributes.position.needsUpdate = true;
  }

  // ========== Lifecycle ==========
  addEventListener('resize', ()=>{
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix();
    renderer.setClearColor(new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()||'#0050ff'), 0);
  }, {passive:true});

  let t0=performance.now()*0.001, prev=t0;
  prime(prev); geo.attributes.position.needsUpdate=true; renderer.render(scene,camera);
  function loop(){
    const now=performance.now()*0.001;
    const dt = Math.min(0.033, Math.max(0.001, now-prev)); prev=now;
    emit(now,dt); step(now,dt); renderer.render(scene,camera);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  