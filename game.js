let THREE;
try { THREE = await import('https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js'); }
catch { THREE = await import('https://unpkg.com/three@0.180.0/build/three.module.js'); }

(() => {
'use strict';
const $ = (id) => document.getElementById(id);
const canvas = $('game');
const mini = $('minimap');
const mctx = mini.getContext('2d');
const WORLD = 3200;
const HALF = WORLD / 2;
const CITY_LENGTH = 1600;
const COAST_ROAD_Z = 980;
const BEACH_START_Z = 1035;
const BEACH_END_Z = 1260;
const WATER_START_Z = 1260;
const PARKING_LOT = { x: 1050, z: 300, width: 220, depth: 150 };
// A dedicated airport occupies the open land east of the city grid.
const AIRPORT = { x: 900, z: -875, runwayStartX: 80, runwayEndX: 1580, runwayZ: -1000, runwayWidth: 58, terminalX: 1050, terminalZ: -754 };
const ROAD_WIDTH = 27;
const ROAD_STEP = 150;
const ROAD_LINES = [];
for (let v = -750; v <= 750; v += ROAD_STEP) ROAD_LINES.push(v); // kept only for legacy region bounds
// Organic road graph: winding old-town lanes, contour-following arterials and diagonal shortcuts.
const CITY_STREET_PATHS = [
  {name:'DIAGONAL BOULEVARD',kind:'boulevard',width:28,points:[[-820,760],[-700,610],[-620,440],[-470,300],[-335,200],[-185,70],[-40,-60],[100,-190],[245,-320],[390,-470],[550,-620],[740,-790]]},
  {name:'OLD TOWN',kind:'oldtown',width:16,points:[[-650,560],[-560,510],[-465,540],[-390,480],[-415,400],[-340,350],[-270,390],[-210,315],[-245,240],[-160,175],[-90,190],[-25,115],[15,35],[95,0]]},
  {name:'RIVERSIDE CRESCENT',kind:'arterial',width:22,points:[[-780,150],[-630,60],[-520,-15],[-390,-45],[-250,-120],[-160,-210],[0,-260],[140,-220],[280,-155],[405,-95],[540,-20],[720,35]]},
  {name:'NORTH MARKET ROAD',kind:'market',width:18,points:[[-720,-760],[-690,-590],[-610,-430],[-560,-280],[-585,-120],[-520,45],[-470,230],[-420,410],[-350,600],[-280,800]]},
  {name:'EASTERN HILLS ROAD',kind:'hills',width:17,points:[[740,-760],[630,-620],[670,-450],[590,-300],[640,-140],[570,40],[610,220],[530,410],[610,600],[700,760]]},
  {name:'SOUTH WORKS ROAD',kind:'industrial',width:20,points:[[-780,-300],[-620,-360],[-460,-320],[-315,-370],[-150,-420],[15,-390],[190,-440],[350,-520],[515,-555],[700,-500]]},
  {name:'CIVIC LOOP',kind:'arterial',width:23,points:[[-560,690],[-360,720],[-165,655],[10,580],[210,585],[395,650],[575,630],[760,520]]},
  {name:'STATION AVENUE',kind:'boulevard',width:24,points:[[-305,-790],[-260,-635],[-205,-505],[-185,-395],[-122,-300],[-82,-195],[-35,-95],[18,20]]},
  {name:'OLD MARKET CONNECTOR',kind:'market',width:17,points:[[70,10],[145,-25],[238,-28],[320,12],[392,58],[480,48],[565,38],[630,65]]},
  {name:'WEST TERRACE ROAD',kind:'arterial',width:18,points:[[-845,320],[-745,300],[-645,265],[-550,220],[-462,190],[-365,205],[-275,180]]},
  {name:'OLD RAIL CUT',kind:'rail',width:8,points:[[-820,-650],[-650,-480],[-480,-300],[-280,-100],[-60,120],[140,320],[350,520],[590,750]]}
];
const CITY_RIVER_PATH=[[-160,-850],[-80,-690],[30,-520],[20,-360],[-55,-205],[10,-40],[135,120],[175,290],[240,465],[350,650],[405,820]];
const CITY_BRIDGE_SEEDS=[[-20,-330],[-25,-80],[150,150],[255,500]];
const CITY_BRIDGE_POINTS=[];
const CITY_BRIDGES=[];
const BRIDGE_SIDE_CLEARANCE=1.1; // extra width for vehicle/player clearance only
const BRIDGE_APPROACH_CLEARANCE=1.7; // invisible pass-through margin beyond visible deck
const cityRoadSamples=[];
const cityRoadPaths=[];
const cityRiverSamples=[];
const enterableBuildings=[];
const garagePillars=[];
const helicopters=[];
let currentInterior=null, currentHelicopter=null, currentAirplane=null, garageSite=null;
// Six-lane divided freeway running along the southern edge of the city grid.
const HIGHWAY_Z = 825;
const HIGHWAY_WIDTH = 42;
const HIGHWAY_HEIGHT = 10;
const HIGHWAY_RAMP_BASE_Z = 750;
const HIGHWAY_RAMP_TOP_Z = HIGHWAY_Z - HIGHWAY_WIDTH / 2;
const HIGHWAY_RAMP_XS = [-520, 505];

function highwayElevationAtX(x) {
  // The expressway gradually rises from grade, stays on a viaduct, then descends.
  return HIGHWAY_HEIGHT * clamp((1480 - Math.abs(x)) / 660, 0, 1);
}
function highwayRampElevation(z) {
  return HIGHWAY_HEIGHT * clamp((z - HIGHWAY_RAMP_BASE_Z) / (HIGHWAY_RAMP_TOP_Z - HIGHWAY_RAMP_BASE_Z), 0, 1);
}

function mountainHeight(x, z) {
  const peak = (cx, cz, sx, sz, h) => h * Math.exp(-0.5 * (((x-cx)/sx)**2 + ((z-cz)/sz)**2));
  const base = peak(-1280,-1110,245,310,190) + peak(-1030,-1370,210,240,225) + peak(-1480,-850,190,260,150) + peak(-920,-930,180,190,95)
    // Rolling countryside east of town: separate from the airport runway corridor.
    + peak(1280,220,190,160,64) + peak(1480,300,220,150,34);
  const roughness = (Math.sin(x*.019 + z*.014) * Math.cos(z*.023 - x*.009) * 5.5 + Math.sin(x*.047 + z*.031) * 2.2) * Math.min(1, base/35);
  return Math.max(0, base + roughness);
}
function cityGroundHeight(x,z) {
  if(Math.abs(x)>900||Math.abs(z)>900) return 0;
  const peak=(cx,cz,sx,sz,h)=>h*Math.exp(-.5*(((x-cx)/sx)**2+((z-cz)/sz)**2));
  // Low ridges and old river terraces: gentle on the downtown, stronger near the suburbs.
  const hills=peak(-570,-500,260,230,22)+peak(430,430,245,210,29)+peak(-470,650,210,145,16)+peak(170,-520,290,180,12)+peak(640,-320,190,260,10);
  // Several broad ridges and shallow basins create visible elevation changes across the city.
  const basins=-peak(-70,110,360,280,3.2)-peak(585,-80,250,300,2.0);
  const rolling=(Math.sin(x*.009+z*.004)*2.0+Math.cos(z*.011-x*.003)*1.7+Math.sin((x+z)*.021)*.55);
  const relief=basins+rolling;
  return Math.max(0,hills+relief);
}
function bridgeAt(x,z) {
  for (const b of CITY_BRIDGES) {
    const dx=x-b.x,dz=z-b.z,c=Math.cos(b.yaw),sn=Math.sin(b.yaw);
    const lx=dx*c-dz*sn,lz=dx*sn+dz*c;
    // This is an invisible traversal volume, not a physical obstacle. Keep it aligned
    // with the road and tight to the bridge so it never blocks a nearby road junction.
    if(Math.abs(lx)<=b.halfWidth+BRIDGE_SIDE_CLEARANCE && Math.abs(lz)<=b.halfDepth) return b;
  }
  return null;
}
function terrainHeight(x, z) {
  // The public parking apron remains a level slab; surrounding districts inherit real relief.
  if(Math.abs(x-PARKING_LOT.x)<PARKING_LOT.width/2+12&&Math.abs(z-PARKING_LOT.z)<PARKING_LOT.depth/2+12) return 0;
  const cityArea=Math.abs(x)<=900&&Math.abs(z)<=900;
  const base=cityArea?cityGroundHeight(x,z):mountainHeight(x,z);
  const bridge=bridgeAt(x,z);
  if(bridge) return cityGroundHeight(x,z)+.61;
  // Check the exit ramps first so the player follows their actual inclined surface.
  if (z >= HIGHWAY_RAMP_BASE_Z - 1 && z <= HIGHWAY_RAMP_TOP_Z + 1 && HIGHWAY_RAMP_XS.some(rx => Math.abs(x-rx) <= 7.4)) return Math.max(base, highwayRampElevation(z));
  if (Math.abs(z-HIGHWAY_Z) <= HIGHWAY_WIDTH/2 && Math.abs(x) <= 1555) return Math.max(base, highwayElevationAtX(x));
  return base;
}

function isOverWater(x, z) { return z > WATER_START_Z + 2; }
const clock = new THREE.Clock();
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8c9da4);
scene.fog = new THREE.FogExp2(0x8c9da4, 0.00105);
const camera = new THREE.PerspectiveCamera(67, 1, 0.1, 2400);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
// Adaptive render resolution: preserve crisp output on fast systems and lower GPU
// pixel cost gradually when the scene becomes expensive. DPR is never allowed to
// exceed 1.6, and hysteresis avoids quality oscillation around the target frame rate.
const maxRenderPixelRatio = Math.min(window.devicePixelRatio || 1, 1.6);
const minRenderPixelRatio = Math.min(maxRenderPixelRatio, 0.85);
let renderPixelRatio = maxRenderPixelRatio;
let renderSampleTime = 0, renderSampleFrames = 0;
let renderQualityCooldown = 0;
renderer.setPixelRatio(renderPixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
function updateAdaptiveRenderQuality(dt) {
  renderSampleTime += dt;
  renderSampleFrames++;
  renderQualityCooldown = Math.max(0, renderQualityCooldown - dt);
  if (renderSampleTime < 2.5 || renderQualityCooldown > 0) return;
  const fps = renderSampleFrames / Math.max(.001, renderSampleTime);
  let nextRatio = renderPixelRatio;
  if (fps < 42) nextRatio = Math.max(minRenderPixelRatio, renderPixelRatio - .16);
  else if (fps < 50) nextRatio = Math.max(minRenderPixelRatio, renderPixelRatio - .08);
  else if (fps > 59) nextRatio = Math.min(maxRenderPixelRatio, renderPixelRatio + .05);
  if (Math.abs(nextRatio - renderPixelRatio) >= .015) {
    renderPixelRatio = nextRatio;
    renderer.setPixelRatio(renderPixelRatio);
    renderQualityCooldown = 3.5;
  }
  renderSampleTime = 0;
  renderSampleFrames = 0;
}
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;

const hemi = new THREE.HemisphereLight(0xb9d8ed, 0x27323a, 1.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffdfbb, 2.1);
sun.position.set(-250, 420, 180);
sun.castShadow = true;
sun.shadow.mapSize.set(1536, 1536);
sun.shadow.camera.left = -520; sun.shadow.camera.right = 520;
sun.shadow.camera.top = 520; sun.shadow.camera.bottom = -520;
sun.shadow.camera.near = 10; sun.shadow.camera.far = 1050;
sun.shadow.bias = -0.00025;
scene.add(sun);
const fill = new THREE.DirectionalLight(0x75c9e2, 0.65);
fill.position.set(270, 180, -350); scene.add(fill);

let started = false, paused = false, gameTime = 0, lastShotAt = 0, toastTimer = 0;
let cameraYaw = Math.PI / 2, cameraPitch = 0.25, cameraFreeLookTimer = 0, cameraManualLook = false;
const keys = Object.create(null);
let mouseDown = false, cameraDrag = false, lastMouseX = 0, lastMouseY = 0, reloading = false, reloadTimer = 0;
let weaponRecoil = 0, muzzleFlash = null, muzzleFlashTimer = 0;
let cash = 2500, rep = 1, jobsDone = 0, wanted = 0, wantedCool = 0;
let player, playerVisual, currentVehicle = null, mission, marker, markerBeam;
const buildings = [], buildingMeshes = [], enemies = [], pedestrians = [], cars = [], tracers = [], particles = [], aircraft = [], airportAirliners = [], policeUnits = [], bombs = [], explosions = [];
let policeSpawnTimer = 0, wantedClearTimer = 0;
const aimObjects = [];
const rng = (() => { let s = 0x6f31ab47; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
const rand = (a,b) => a + (b-a)*rng();
const pick = (a) => a[Math.floor(rng()*a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const v3 = (x=0,y=0,z=0) => new THREE.Vector3(x,y,z);
const colors = [0xd5ded8,0xb64d3d,0x436e7c,0xd1a04c,0x7183a9,0xc7c9bf,0x43565b,0xa4b6ae,0x894c5a,0x69905d,0x997cbe];

const mat = (color, roughness=.8, metalness=.04, extra={}) => new THREE.MeshStandardMaterial({color, roughness, metalness, ...extra});
const mats = {
  ground: mat(0x536057), road: mat(0x30383e, .95), sidewalk: mat(0x818a88, .94),
  lane: new THREE.MeshBasicMaterial({color:0xb9c0b7}), curb: mat(0xb1b6ae),
  park: mat(0x3c634f), path: mat(0xb7ad91), tree: mat(0x285542), trunk: mat(0x5d4c3b),
  glass: mat(0x182d37,.25,.45,{metalness:.45}), rubber: mat(0x161b1e), light: new THREE.MeshBasicMaterial({color:0xffe2a3}),
  redLight: new THREE.MeshBasicMaterial({color:0xff493d}), cyanGlow: new THREE.MeshStandardMaterial({color:0x4cdef1,emissive:0x28a8c4,emissiveIntensity:2.2}),
  neonLime: new THREE.MeshStandardMaterial({color:0xd4ff4f,emissive:0x749b16,emissiveIntensity:1.3}),
  targetRed: new THREE.MeshStandardMaterial({color:0x9e3040,roughness:.66}),
  targetGold: new THREE.MeshStandardMaterial({color:0xf3bb48,emissive:0x5d3607,emissiveIntensity:.45}),
};

function makeWindowTexture(seed) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  const base = ['#18232d','#202c35','#263039','#1a252c','#273238'][seed % 5];
  g.fillStyle = base; g.fillRect(0,0,c.width,c.height);
  g.strokeStyle = 'rgba(5,11,16,.8)'; g.lineWidth = 3;
  for (let x=0;x<c.width;x+=16) { g.beginPath(); g.moveTo(x,0); g.lineTo(x,c.height); g.stroke(); }
  for (let y=0;y<c.height;y+=20) { g.beginPath(); g.moveTo(0,y); g.lineTo(c.width,y); g.stroke(); }
  for (let y=4;y<c.height-6;y+=20) for (let x=4;x<c.width-5;x+=16) {
    const t = rng();
    if (t < .59) { g.fillStyle = pick(['#c99f5c','#d5c48d','#7cc6cf','#bfad78','#6c9da8']); g.globalAlpha = rand(.32,.82); }
    else { g.fillStyle = '#07121a'; g.globalAlpha = .86; }
    g.fillRect(x,y,8,11);
  }
  g.globalAlpha=1;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}
const windowTextures = Array.from({length:5},(_,i)=>makeWindowTexture(i));
const roofMat = mat(0x48545b,.86);

function addGroundAndRoads() {
  const groundGeo=new THREE.PlaneGeometry(WORLD+160,WORLD+160);
  const ground=new THREE.Mesh(groundGeo,mats.ground);ground.rotation.x=-Math.PI/2;ground.position.y=-.24;ground.receiveShadow=true;scene.add(ground);
  // Low-poly urban terrain connects the hills visually; roads and buildings sit on this same height field.
  const min=-900,max=900,steps=50,positions=[],colours=[],indices=[];
  const low=new THREE.Color(0x566457),mid=new THREE.Color(0x747764),high=new THREE.Color(0x8c8876);
  for(let iz=0;iz<=steps;iz++)for(let ix=0;ix<=steps;ix++){
    const x=min+(max-min)*ix/steps,z=min+(max-min)*iz/steps,h=cityGroundHeight(x,z);
    positions.push(x,h-.12,z);const blend=clamp(h/22,0,1),c=low.clone().lerp(mid,blend*.7).lerp(high,Math.max(0,(h-13)/22));
    const n=.965+.035*Math.sin(x*.035+z*.027);colours.push(c.r*n,c.g*n,c.b*n);
  }
  for(let iz=0;iz<steps;iz++)for(let ix=0;ix<steps;ix++){const a=iz*(steps+1)+ix,b=a+1,c=a+steps+1,d=c+1;indices.push(a,c,b,b,c,d);}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(colours,3));geo.setIndex(indices);geo.computeVertexNormals();
  const mesh=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,side:THREE.DoubleSide}));mesh.receiveShadow=true;scene.add(mesh);
}
function addOffsetPolyline(points,offset) {
  return points.map((pt,i)=>{const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz)||1;return [pt[0]-dz/len*offset,pt[1]+dx/len*offset];});
}
function sampleStreetPath(route) {
  const controls=route.points.map(([x,z])=>new THREE.Vector3(x,cityGroundHeight(x,z),z));
  const curve=new THREE.CatmullRomCurve3(controls,false,'catmullrom',.16);
  const pts=curve.getPoints(Math.max(40,route.points.length*4)).map(v=>[v.x,v.z]);
  cityRoadPaths.push({name:route.name,kind:route.kind,width:route.width,points:pts});
  const step=Math.max(1,Math.floor(pts.length/140));
  for(let i=0;i<pts.length;i+=step){const a=pts[Math.max(0,i-1)],b=pts[Math.min(pts.length-1,i+1)];cityRoadSamples.push({x:pts[i][0],z:pts[i][1],yaw:Math.atan2(b[0]-a[0],b[1]-a[1]),width:route.width,route:cityRoadPaths.length-1,index:i});}
  return pts;
}
function addOrganicStreets() {
  const roadMat=new THREE.MeshStandardMaterial({color:0x30373a,roughness:.97,side:THREE.DoubleSide});
  const oldRoadMat=new THREE.MeshStandardMaterial({color:0x3b3d3a,roughness:.98,side:THREE.DoubleSide});
  const railBedMat=new THREE.MeshStandardMaterial({color:0x575851,roughness:1,side:THREE.DoubleSide});
  const sidewalkMat=mat(0x92958c,.98),edgeMat=mat(0x6d7672,.95);
  cityRoadPaths.length=0;cityRoadSamples.length=0;cityRiverSamples.length=0;
  const lampPlaces=[];
  for(const route of CITY_STREET_PATHS){
    const pts=sampleStreetPath(route),material=route.kind==='rail'?railBedMat:(route.kind==='oldtown'||route.kind==='market'?oldRoadMat:roadMat);
    addRoadRibbon(pts,route.width,material,cityGroundHeight,.18,route.kind!=='rail');
    if(route.kind!=='rail'){
      for(const side of [-1,1]) addRoadRibbon(addOffsetPolyline(pts,side*(route.width/2+2.4)),2.8,sidewalkMat,cityGroundHeight,.17,false);
      // Lamps are instanced later so the organic street network stays inexpensive to render.
      for(let i=6;i<pts.length-4;i+=11){
        const [x,z]=pts[i],q=pts[i+1],yaw=Math.atan2(q[0]-x,q[1]-z);
        for(const side of [-1,1]){
          const pos=addOffsetPolyline([pts[Math.max(0,i-1)],pts[i],pts[Math.min(pts.length-1,i+1)]],side*(route.width/2+4.2))[1];
          lampPlaces.push({x:pos[0],z:pos[1],yaw,ground:cityGroundHeight(pos[0],pos[1])});
        }
      }
    }
  }
  if(lampPlaces.length){
    const poleMat=mat(0x515c5e,.5,.5),poleGeo=new THREE.CylinderGeometry(.09,.13,5.4,6),poles=new THREE.InstancedMesh(poleGeo,poleMat,lampPlaces.length);
    const headGeo=new THREE.BoxGeometry(.8,.15,.3),heads=new THREE.InstancedMesh(headGeo,mats.light,lampPlaces.length),dummy=new THREE.Object3D();
    lampPlaces.forEach((p,i)=>{
      dummy.position.set(p.x,p.ground+2.7,p.z);dummy.rotation.set(0,p.yaw,0);dummy.updateMatrix();poles.setMatrixAt(i,dummy.matrix);
      dummy.position.set(p.x+Math.cos(p.yaw)*.25+Math.sin(p.yaw)*.12,p.ground+5.25,p.z-Math.sin(p.yaw)*.25+Math.cos(p.yaw)*.12);dummy.rotation.set(0,p.yaw,0);dummy.updateMatrix();heads.setMatrixAt(i,dummy.matrix);
    });
    poles.instanceMatrix.needsUpdate=true;heads.instanceMatrix.needsUpdate=true;poles.castShadow=true;heads.castShadow=true;scene.add(poles,heads);
  }
  // A narrow river bends with the valley. Four broad bridges keep the route graph connected.
  const riverControls=CITY_RIVER_PATH.map(([x,z])=>new THREE.Vector3(x,cityGroundHeight(x,z)+.05,z));
  const riverCurve=new THREE.CatmullRomCurve3(riverControls,false,'catmullrom',.12);
  const riverPts=riverCurve.getPoints(100).map(v=>[v.x,v.z]);cityRiverSamples.push(...riverPts);
  const waterMat=new THREE.MeshStandardMaterial({color:0x236b7c,roughness:.28,metalness:.16,transparent:true,opacity:.94,side:THREE.DoubleSide});
  addRoadRibbon(riverPts,24,waterMat,cityGroundHeight,.05,false);
  for(let i=0;i<riverPts.length;i+=10){const [x,z]=riverPts[i];const bank=new THREE.Mesh(new THREE.DodecahedronGeometry(rand(2.2,4.2),0),mat(0x7e8976,.98));bank.scale.set(1,.28,1.6);bank.position.set(x,cityGroundHeight(x,z)+.1,z);bank.rotation.y=rand(0,Math.PI);scene.add(bank);}
  // Build road-aligned bridges at actual road/river crossings. The deck's long axis follows
  // the road (local +Z), not the river; this makes the asphalt, bridge mesh and collision
  // footprint line up so vehicles do not hit an invisible water wall at the approach.
  CITY_BRIDGE_POINTS.length=0;CITY_BRIDGES.length=0;
  const riverNearest=(x,z)=>{let best={d:Infinity,i:0};for(let i=1;i<riverPts.length-1;i++){const d=Math.hypot(x-riverPts[i][0],z-riverPts[i][1]);if(d<best.d)best={d,i};}return best;};
  const candidates=[];
  for(const sample of cityRoadSamples){
    const route=cityRoadPaths[sample.route];if(!route||route.kind==='rail')continue;
    const near=riverNearest(sample.x,sample.z);if(near.d>19)continue;
    const i=near.i,a=riverPts[i-1],b=riverPts[i+1],tx=b[0]-a[0],tz=b[1]-a[1],tl=Math.hypot(tx,tz)||1;
    const rx=Math.sin(sample.yaw),rz=Math.cos(sample.yaw);
    const crossing=Math.abs(rx*tx/tl+rz*tz/tl);
    if(crossing>.70)continue; // road must cross, not run parallel to, the river
    candidates.push({x:riverPts[i][0],z:riverPts[i][1],yaw:sample.yaw,score:near.d,route:route.name,width:route.width,riverAlignment:crossing});
  }
  candidates.sort((a,b)=>a.score-b.score);
  // Fallback seeds are accepted only where a real road sample crosses the river,
  // not where the nearest road happens to run parallel to the bank.
  for(const seed of CITY_BRIDGE_SEEDS){
    const near=riverNearest(seed[0],seed[1]);
    let road=null,rd=Infinity;
    for(const q of cityRoadSamples){const d=Math.hypot(q.x-riverPts[near.i][0],q.z-riverPts[near.i][1]);if(d<rd){rd=d;road=q;}}
    if(road&&rd<32){
      const a=riverPts[Math.max(0,near.i-1)],b=riverPts[Math.min(riverPts.length-1,near.i+1)];
      const tx=b[0]-a[0],tz=b[1]-a[1],tl=Math.hypot(tx,tz)||1;
      const alignment=Math.abs(Math.sin(road.yaw)*tx/tl+Math.cos(road.yaw)*tz/tl);
      const route=cityRoadPaths[road.route];
      if(route&&route.kind!=='rail'&&alignment<=.70)candidates.push({x:riverPts[near.i][0],z:riverPts[near.i][1],yaw:road.yaw,score:near.d,route:'fallback',width:route.width,riverAlignment:alignment});
    }
  }
  for(const q of candidates){
    if(CITY_BRIDGES.some(b=>Math.hypot(b.x-q.x,b.z-q.z)<92))continue;
    const alignment=clamp(q.riverAlignment||0,0,.70);
    // The river is 24 m wide. Compute the visible span from its crossing angle instead
    // of using a fixed 64 m deck that sticks far out onto ordinary road surfaces.
    const visibleHalfDepth=clamp(12/Math.sqrt(Math.max(.51,1-alignment*alignment))+1.4,13.4,19.0);
    const halfWidth=clamp((q.width||20)*.5+1.0,8.5,15.0);
    const bridge={x:q.x,z:q.z,yaw:q.yaw,halfWidth,visualHalfDepth:visibleHalfDepth,halfDepth:visibleHalfDepth+BRIDGE_APPROACH_CLEARANCE};
    CITY_BRIDGES.push(bridge);CITY_BRIDGE_POINTS.push([bridge.x,bridge.z]);
    const y=cityGroundHeight(bridge.x,bridge.z)+.33;
    // Visible deck covers the water crossing only; the slightly larger traversal box is
    // purely logical, invisible, and used only to let pedestrians/vehicles cross the river.
    const deck=new THREE.Mesh(new THREE.BoxGeometry(bridge.halfWidth*2,.55,bridge.visualHalfDepth*2),mat(0x777f7c,.88));
    deck.position.set(bridge.x,y,bridge.z);deck.rotation.y=bridge.yaw;deck.receiveShadow=true;deck.castShadow=true;scene.add(deck);
    const edgeMatBridge=mat(0x69736f,.9);
    // Short side rails stop at the banks rather than extending along city roads.
    for(const side of [-1,1]){
      const rail=new THREE.Mesh(new THREE.BoxGeometry(.16,.58,bridge.visualHalfDepth*2),edgeMatBridge);
      rail.position.set(bridge.x+Math.cos(bridge.yaw)*side*(bridge.halfWidth-.12),y+.43,bridge.z-Math.sin(bridge.yaw)*side*(bridge.halfWidth-.12));
      rail.rotation.y=bridge.yaw;scene.add(rail);
    }
    // Lane markings stop with the visible deck; no extra mesh is placed on the approaches.
    for(const side of [-1,1]){
      const stripe=new THREE.Mesh(new THREE.BoxGeometry(.14,.035,bridge.visualHalfDepth*1.65),mats.lane);
      stripe.position.set(bridge.x+Math.cos(bridge.yaw)*side*5.5,y+.3,bridge.z-Math.sin(bridge.yaw)*side*5.5);
      stripe.rotation.y=bridge.yaw;scene.add(stripe);
    }
    // Small piers stay under the deck span, not out on the road approaches.
    for(const side of [-1,1]){
      const along=Math.min(9.5,bridge.visualHalfDepth*.55);
      const px=bridge.x+Math.sin(bridge.yaw)*side*along,pz=bridge.z+Math.cos(bridge.yaw)*side*along;
      const ground=cityGroundHeight(px,pz),pierHeight=Math.max(1,ground);
      const pier=new THREE.Mesh(new THREE.BoxGeometry(1.7,pierHeight,1.7),mat(0x666e6c,.96));
      pier.position.set(px,Math.max(0,ground/2),pz);scene.add(pier);
    }
  }
  // An elevated rail cut slices the blocks diagonally and creates triangular parcels.
  const railRoute=cityRoadPaths.find(r=>r.kind==='rail');
  if(railRoute){
    const railMat=mat(0x9aa4a4,.38,.75),tieMat=mat(0x484b46,.92),railGeo=new THREE.BoxGeometry(.22,.16,1),tieGeo=new THREE.BoxGeometry(4.4,.18,.6),railTransforms=[],tieTransforms=[],dummy=new THREE.Object3D();
    for(let i=0;i<railRoute.points.length-1;i++){
      const a=railRoute.points[i],b=railRoute.points[i+1],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz)||1,angle=Math.atan2(dx,dz),midX=(a[0]+b[0])/2,midZ=(a[1]+b[1])/2,ground=cityGroundHeight(midX,midZ)+.55;
      for(const off of [-1.3,1.3])railTransforms.push({x:midX+dz/len*off,y:ground,z:midZ-dx/len*off,yaw:angle,sz:len});
      for(let d=4;d<len;d+=4.3){const t=d/len,x=a[0]+dx*t,z=a[1]+dz*t;tieTransforms.push({x,y:cityGroundHeight(x,z)+.34,z,yaw:angle});}
    }
    const rails=new THREE.InstancedMesh(railGeo,railMat,railTransforms.length);railTransforms.forEach((q,i)=>{dummy.position.set(q.x,q.y,q.z);dummy.rotation.set(0,q.yaw,0);dummy.scale.set(1,1,q.sz);dummy.updateMatrix();rails.setMatrixAt(i,dummy.matrix);});rails.instanceMatrix.needsUpdate=true;rails.castShadow=true;scene.add(rails);
    const ties=new THREE.InstancedMesh(tieGeo,tieMat,tieTransforms.length);tieTransforms.forEach((q,i)=>{dummy.position.set(q.x,q.y,q.z);dummy.rotation.set(0,q.yaw,0);dummy.scale.set(1,1,1);dummy.updateMatrix();ties.setMatrixAt(i,dummy.matrix);});ties.instanceMatrix.needsUpdate=true;scene.add(ties);
  }
  // Irregular pocket parks and public squares, not rectangular filler blocks.
  addOrganicPark(-180,300,[[0,0],[28,-9],[51,5],[46,31],[22,46],[-8,39],[-31,18],[-28,-7]],17);
  addOrganicPark(405,155,[[0,0],[32,-19],[61,-8],[69,22],[46,47],[12,42],[-19,26],[-25,5]],19);
  addOrganicPark(-540,-190,[[0,0],[24,-12],[41,4],[34,28],[7,36],[-18,21],[-25,2]],12);
}
function addOrganicPark(x,z,outline,treeCount=12){
  const shape=new THREE.Shape();shape.moveTo(outline[0][0],outline[0][1]);for(let i=1;i<outline.length;i++)shape.lineTo(outline[i][0],outline[i][1]);shape.closePath();
  const ground=new THREE.Mesh(new THREE.ShapeGeometry(shape),mats.park);ground.rotation.x=-Math.PI/2;ground.position.set(x,cityGroundHeight(x,z)+.03,z);ground.receiveShadow=true;scene.add(ground);
  const pathMat=mats.path;
  for(let i=0;i<outline.length;i+=2){const a=outline[i],b=outline[(i+2)%outline.length],dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz);const path=new THREE.Mesh(new THREE.BoxGeometry(2.4,.05,l),pathMat);path.position.set(x+(a[0]+b[0])/2,cityGroundHeight(x+(a[0]+b[0])/2,z+(a[1]+b[1])/2)+.1,z+(a[1]+b[1])/2);path.rotation.y=Math.atan2(dx,dz);scene.add(path);}
  for(let i=0;i<treeCount;i++){const angle=rand(0,Math.PI*2),r=rand(7,28),tx=x+Math.cos(angle)*r,tz=z+Math.sin(angle)*r;if(Math.hypot(tx-x,tz-z)>30)continue;addTree(tx,tz,rand(.65,1.1));}
  for(let i=0;i<4;i++){const bench=new THREE.Mesh(new THREE.BoxGeometry(2,.22,.5),mat(0x76624d,.9));bench.position.set(x+rand(-15,15),cityGroundHeight(x,z)+.45,z+rand(-15,15));bench.rotation.y=rand(0,Math.PI);scene.add(bench);}
}

function addBuilding(x,z,bw,bd,height,index,options={}) {
  const baseY=terrainHeight(x,z),yaw=options.yaw||0,style=options.style||pick(['glass','concrete','brick','modern','historic','slab','cylindrical','artdeco']);
  const group=new THREE.Group();group.position.set(x,baseY,z);group.rotation.y=yaw;scene.add(group);
  const tex=windowTextures[index%windowTextures.length];
  const palette={glass:[0x8faab4,0x7899a6,0xb1cbd0],concrete:[0xc0beb3,0x9aabae,0xb4b0a6],brick:[0x9d6551,0xb78366,0x75665d],modern:[0xc8d2d2,0x88989d,0xaebbb9],historic:[0xc9bba2,0xb9aa90,0x8e897c],slab:[0x919da1,0xabb7b6,0x74888d],cylindrical:[0x83a8b5,0x95b7c1,0x6b8a95],artdeco:[0xb8b3a5,0xc6c5b7,0x8f9c9b]};
  const chosen=pick(palette[style]||palette.modern);
  const buildingMaterial=new THREE.MeshStandardMaterial({map:tex,color:chosen,roughness:.84,metalness:style==='glass'?.2:.08,emissive:0x0c1a20,emissiveIntensity:.24});
  let mesh;
  if(style==='cylindrical') mesh=new THREE.Mesh(new THREE.CylinderGeometry(Math.min(bw,bd)*.46,Math.min(bw,bd)*.5,height,12),buildingMaterial);
  else if(style==='historic'&&height<32) mesh=new THREE.Mesh(new THREE.BoxGeometry(bw,height,bd),new THREE.MeshStandardMaterial({color:chosen,roughness:.94}));
  else mesh=new THREE.Mesh(new THREE.BoxGeometry(bw,height,bd),buildingMaterial);
  mesh.position.y=height/2;mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
  // Distinct podium, facade piers, floor bands and entrances create different building silhouettes.
  if(style!=='cylindrical'){
    const podiumH=Math.min(4.2,height*.16),podium=new THREE.Mesh(new THREE.BoxGeometry(bw*1.035,podiumH,bd*1.035),mat(style==='brick'?0x6f5146:0x697477,.9,.08));podium.position.y=podiumH/2+.05;group.add(podium);
    const pierCount=clamp(Math.floor(bw/8),2,6);
    for(let i=0;i<pierCount;i++){
      const px=-bw*.43+i*(bw*.86/Math.max(1,pierCount-1));const pier=new THREE.Mesh(new THREE.BoxGeometry(.32,Math.min(height*.9,45),.35),mat(style==='historic'?0xe0d5bd:0x566a70,.75,.12));pier.position.set(px,Math.min(height*.48,22),bd/2+.12);group.add(pier);
    }
    if(height>35)for(let y=12;y<height-8;y+=12){const band=new THREE.Mesh(new THREE.BoxGeometry(bw+.45,.34,bd+.45),mat(style==='artdeco'?0xc2ac82:0x5c6e73,.72,.18));band.position.y=y;group.add(band);}
  }
  // Ground-floor glazing and a readable canopy; enterable buildings use an open door bay.
  const frontZ=bd/2+.12;
  for(let i=0;i<Math.max(2,Math.floor(bw/9));i++){
    const wx=-bw*.38+i*(bw*.76/Math.max(1,Math.floor(bw/9)-1));const pane=new THREE.Mesh(new THREE.BoxGeometry(Math.min(5,bw*.15),2.2,.08),mats.glass);pane.position.set(wx,2.0,frontZ);group.add(pane);
  }
  const canopy=new THREE.Mesh(new THREE.BoxGeometry(Math.min(bw*.62,18),.3,2.2),mat(0x45575c,.55,.2));canopy.position.set(0,3.9,frontZ+1);group.add(canopy);
  if(height>42&&style!=='cylindrical'){
    // Setbacks make high-rises taper instead of ending as identical flat boxes.
    if(style==='artdeco'||style==='glass'||rng()<.58){
      const topW=bw*rand(.48,.72),topD=bd*rand(.48,.72),topH=rand(5,12);const cap=new THREE.Mesh(new THREE.BoxGeometry(topW,topH,topD),buildingMaterial);cap.position.set(rand(-2,2),height+topH/2-.2,rand(-2,2));group.add(cap);
      if(height>90){const crown=new THREE.Mesh(new THREE.CylinderGeometry(.45,.8,rand(8,18),7),mat(0x5d747b,.46,.55));crown.position.y=height+topH+5;group.add(crown);}
    }
    if(style==='artdeco')for(const side of [-1,1]){const fin=new THREE.Mesh(new THREE.BoxGeometry(.8,height*.78,1.0),mat(0xc4b18a,.52,.25));fin.position.set(side*(bw/2+.2),height*.48,0);group.add(fin);}
  }
  // Roof clutter: HVAC boxes, antennas, water tanks and occasional helipad markings.
  const roofY=height+.16;
  if(height>18){for(let i=0;i<Math.min(5,Math.ceil(bw/12));i++){const w=rand(2.2,5.3),h=rand(1.4,3.6);const unit=new THREE.Mesh(new THREE.BoxGeometry(w,h,rand(2,4)),mat(pick([0x626c6b,0x818b87,0x4d5d60]),.92));unit.position.set(rand(-bw*.34,bw*.34),roofY+h/2,rand(-bd*.32,bd*.32));group.add(unit);}}
  if(height>68&&rng()<.76){const antenna=new THREE.Mesh(new THREE.CylinderGeometry(.12,.24,rand(5,15),6),mat(0x566a70,.48,.45));antenna.position.set(rand(-bw*.22,bw*.22),height+8,rand(-bd*.22,bd*.22));group.add(antenna);}
  if(style==='historic'){
    const towerBase=new THREE.Mesh(new THREE.BoxGeometry(Math.min(9,bw*.25),Math.min(17,height*.65),Math.min(9,bd*.25)),mat(0xd1c5aa,.94));towerBase.position.set(-bw*.22,height+Math.min(17,height*.65)/2-.2,0);group.add(towerBase);
    const spire=new THREE.Mesh(new THREE.ConeGeometry(5.3,10,8),mat(0x485e60,.8));spire.position.set(-bw*.22,height+Math.min(17,height*.65)+4.5,0);group.add(spire);
    const clock=new THREE.Mesh(new THREE.CircleGeometry(1.55,20),mat(0xe2d8bd,.86));clock.position.set(-bw*.22,height+Math.min(17,height*.65)*.7,bd/2+.22);group.add(clock);
  }
  if(options.name){const board=new THREE.Mesh(new THREE.BoxGeometry(Math.min(bw*.65,16),1.25,.2),mat(0x263d42,.6,.2));board.position.set(0,5.2,bd/2+.25);group.add(board);const stripe=new THREE.Mesh(new THREE.BoxGeometry(Math.min(bw*.46,11),.1,.24),mats.neonLime);stripe.position.set(0,5.2,bd/2+.38);group.add(stripe);}
  const record={x,z,w:bw,d:bd,height,baseY,yaw,mesh,visual:group,style,name:options.name||style,enterable:!!options.enterable};
  buildings.push(record);buildingMeshes.push(mesh);aimObjects.push(mesh);
  if(record.enterable){record.doorX=x+Math.sin(yaw)*(bd/2+3);record.doorZ=z+Math.cos(yaw)*(bd/2+3);record.interior=createBuildingInterior(record);enterableBuildings.push(record);}
  return record;
}
function createBuildingInterior(building){
  const group=new THREE.Group();group.position.set(building.x,building.baseY,building.z);group.rotation.y=building.yaw||0;scene.add(group);group.visible=false;
  const w=building.w-5,d=building.d-5,h=7.3,wallMat=mat(building.style==='historic'?0xd7c6a6:0x9ca9a8,.9),floorMat=mat(0x5a6060,.95),doorGap=4.2;
  const floor=new THREE.Mesh(new THREE.BoxGeometry(w,.3,d),floorMat);floor.position.y=.15;floor.receiveShadow=true;group.add(floor);
  const back=new THREE.Mesh(new THREE.BoxGeometry(w,h,.45),wallMat);back.position.set(0,h/2,-d/2);group.add(back);
  for(const side of [-1,1]){const wall=new THREE.Mesh(new THREE.BoxGeometry(.45,h,d),wallMat);wall.position.set(side*w/2,h/2,0);group.add(wall);}
  const sideWidth=(w-doorGap)/2;
  for(const side of [-1,1]){const wall=new THREE.Mesh(new THREE.BoxGeometry(sideWidth,h,.45),wallMat);wall.position.set(side*(doorGap/2+sideWidth/2),h/2,d/2);group.add(wall);}
  const lintel=new THREE.Mesh(new THREE.BoxGeometry(doorGap,1.1,.45),wallMat);lintel.position.set(0,h-.55,d/2);group.add(lintel);
  const ceilingLamp=new THREE.Mesh(new THREE.BoxGeometry(4,.12,1.2),new THREE.MeshBasicMaterial({color:0xffe3a0}));ceilingLamp.position.set(0,h-.2,0);group.add(ceilingLamp);
  if(building.name==='OLD TOWN HOTEL'){
    const counter=new THREE.Mesh(new THREE.BoxGeometry(w*.55,1.3,2.2),mat(0x6e4a35,.8));counter.position.set(0,.85,-d*.18);group.add(counter);
    for(let i=-1;i<=1;i++){const seat=new THREE.Mesh(new THREE.BoxGeometry(1.2,.7,1.1),mat(0x697f76,.85));seat.position.set(i*4,.48,2);group.add(seat);}
  }else if(building.name==='CIVIC ARCHIVE'){
    for(let i=0;i<3;i++){const desk=new THREE.Mesh(new THREE.BoxGeometry(4,.8,1.6),mat(0x765941,.85));desk.position.set((i-1)*7,.7,-d*.17);group.add(desk);}
    const pillarMat=mat(0xc8c4b8,.8);for(let x of [-w*.35,w*.35]){const pil=new THREE.Mesh(new THREE.CylinderGeometry(.35,.45,5.4,8),pillarMat);pil.position.set(x,2.9,0);group.add(pil);}
  }else{
    const couch=new THREE.Mesh(new THREE.BoxGeometry(5,1.1,1.8),mat(0x526c68,.88));couch.position.set(-w*.22,.65,-d*.15);group.add(couch);
    for(let i=0;i<4;i++){const shelf=new THREE.Mesh(new THREE.BoxGeometry(1.8,2.4,.65),mat(0x6e7471,.9));shelf.position.set(w*.28,.2+i*.01,-d*.25+i*3);group.add(shelf);}
  }
  return group;
}


function addTree(x,z,scale=1) {
  const group=new THREE.Group();
  const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.35*scale,.52*scale,2.7*scale,7),mats.trunk); trunk.position.y=1.25*scale; group.add(trunk);
  const crown=new THREE.Mesh(new THREE.IcosahedronGeometry(2.05*scale,1),pick([mats.tree,mat(0x326b52),mat(0x244e42)])); crown.position.y=3.1*scale; crown.castShadow=true; group.add(crown);
  group.position.set(x,0,z); scene.add(group);
}

function addCityLandmarks(){
  // Art-deco civic tower, deliberately offset from the road centerline.
  addBuilding(250,-105,62,50,146,110,{style:'artdeco',yaw:.08,name:'METRO TOWER'});
  // Enterable historic inn and civic archive; their shells can be hidden while inside.
  addBuilding(-330,302,48,42,19,111,{style:'historic',yaw:.18,enterable:true,name:'OLD TOWN HOTEL'});
  addBuilding(-545,102,45,39,15,112,{style:'brick',yaw:-.18,enterable:true,name:'CIVIC ARCHIVE'});
  addBuilding(452,130,70,57,98,113,{style:'glass',yaw:.25,name:'FINANCIAL PLAZA'});
  // A radio mast with a lattice shaft and cross arms on the western ridge.
  const mast=new THREE.Group(),metal=mat(0x566565,.45,.65),red=new THREE.MeshBasicMaterial({color:0xff5750});
  for(const sx of [-1,1])for(const sz of [-1,1]){const leg=new THREE.Mesh(new THREE.CylinderGeometry(.18,.28,42,5),metal);leg.position.set(sx*4,21,sz*4);leg.rotation.z=sx*.12;mast.add(leg);}
  for(let y=5;y<=40;y+=5){const beam=new THREE.Mesh(new THREE.BoxGeometry(9,.16,9),metal);beam.position.y=y;mast.add(beam);}
  for(const y of [18,30,41]){const arm=new THREE.Mesh(new THREE.BoxGeometry(17,.22,.25),metal);arm.position.set(0,y,0);mast.add(arm);}
  const lamp=new THREE.Mesh(new THREE.SphereGeometry(.6,8,6),red);lamp.position.y=44;mast.add(lamp);mast.position.set(-825,terrainHeight(-825,-205),-205);scene.add(mast);
  // Landmark clock tower beside the old road; its geometry is unmistakably different from office blocks.
  const civic=new THREE.Group(),stone=mat(0xb8b5a5,.94),roof=mat(0x475e5b,.76);
  const plinth=new THREE.Mesh(new THREE.BoxGeometry(25,28,24),stone);plinth.position.y=14;civic.add(plinth);
  const cap=new THREE.Mesh(new THREE.BoxGeometry(18,11,18),stone);cap.position.y=32;civic.add(cap);
  for(const side of [-1,1]){const face=new THREE.Mesh(new THREE.CircleGeometry(3.1,24),mat(0xe7ddc1,.8));face.position.set(side*9,31,12.2);face.rotation.y=side*Math.PI/2;civic.add(face);}
  const spire=new THREE.Mesh(new THREE.ConeGeometry(11,20,8),roof);spire.position.y=47;civic.add(spire);civic.position.set(-385,terrainHeight(-385,440),440);civic.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});scene.add(civic);
  buildings.push({x:-385,z:440,w:25,d:24,height:57,baseY:terrainHeight(-385,440),yaw:0,mesh:plinth,visual:civic,style:'clocktower'});buildingMeshes.push(plinth);aimObjects.push(plinth);
  // Waterfront beacon, distinct from the high-rise silhouette.
  const lighthouse=new THREE.Group(),white=mat(0xd9d6c5,.78),redBand=mat(0x934c40,.78),lampMat=new THREE.MeshBasicMaterial({color:0xfff2bf});
  const shaft=new THREE.Mesh(new THREE.CylinderGeometry(4.2,6.3,25,12),white);shaft.position.y=12.5;lighthouse.add(shaft);const band=new THREE.Mesh(new THREE.CylinderGeometry(4.35,4.35,2,12),redBand);band.position.y=12;lighthouse.add(band);
  const room=new THREE.Mesh(new THREE.CylinderGeometry(5.4,5,4.2,10),mat(0x35474c,.32,.3));room.position.y=26;lighthouse.add(room);const beam=new THREE.Mesh(new THREE.SphereGeometry(1.2,8,6),lampMat);beam.position.y=26;lighthouse.add(beam);const roofCone=new THREE.Mesh(new THREE.ConeGeometry(5.8,4.2,10),redBand);roofCone.position.y=30;lighthouse.add(roofCone);lighthouse.position.set(910,0,1088);scene.add(lighthouse);
}
function addParkingGarageAndHelicopter(){
  // Open-sided three-level garage: cars can drive and park inside the ground level.
  const x=610,z=520,baseY=terrainHeight(x,z),width=132,depth=94,floorMat=mat(0x656d6f,.94),pillarMat=mat(0x9aa19e,.86),railMat=mat(0x75827f,.66,.3);
  garageSite={x,z,baseY,width,depth,topY:baseY+17.1,liftX:x-52,liftZ:z+32};
  for(const level of [0,8.2,16.4]){
    const slab=new THREE.Mesh(new THREE.BoxGeometry(width,.65,depth),floorMat);slab.position.set(x,baseY+level,z);slab.receiveShadow=true;scene.add(slab);
    if(level<16.4)for(const px of [-width/2+3,0,width/2-3])for(const pz of [-depth/2+3,0,depth/2-3]){
      const pillar=new THREE.Mesh(new THREE.BoxGeometry(1.8,8.2,1.8),pillarMat);pillar.position.set(x+px,baseY+level+4.1,z+pz);pillar.castShadow=true;scene.add(pillar);
      if(level===0)garagePillars.push({x:x+px,z:z+pz,r:1.25});
    }
    for(const side of [-1,1]){const rail=new THREE.Mesh(new THREE.BoxGeometry(width,.8,.45),railMat);rail.position.set(x,baseY+level+1,z+side*(depth/2-.25));scene.add(rail);}
    // Deliberately varied bay lengths and arrows on each deck.
    const white=new THREE.MeshBasicMaterial({color:0xd3d9d2});for(let i=-5;i<=5;i++){const line=new THREE.Mesh(new THREE.BoxGeometry(.12,.035,10),white);line.position.set(x+i*10.5,baseY+level+.37,z-18);scene.add(line);}
  }
  // Switchback ramp, with a visible slope and guardrails between the decks.
  for(const level of [0,8.2]){
    const ramp=new THREE.Mesh(new THREE.BoxGeometry(15,.45,38),floorMat);ramp.position.set(x+width/2-14,baseY+level+4.2,z-8);ramp.rotation.x=-.215;scene.add(ramp);
    for(const side of [-1,1]){const rail=new THREE.Mesh(new THREE.BoxGeometry(.2,1.1,38),railMat);rail.position.set(x+width/2-14+side*7.4,baseY+level+4.9,z-8);rail.rotation.x=-.215;scene.add(rail);}
  }
  // Lift/stair core is a visible landmark and E teleports between grade and the roof deck.
  const core=new THREE.Mesh(new THREE.BoxGeometry(9,17,10),mat(0x8a999b,.6,.2));core.position.set(garageSite.liftX,baseY+8.5,garageSite.liftZ);scene.add(core);
  const windows=new THREE.Mesh(new THREE.BoxGeometry(9.2,13,.15),mats.glass);windows.position.set(garageSite.liftX,baseY+8.8,garageSite.liftZ+5.08);scene.add(windows);
  for(let floor=0;floor<2;floor++){const sign=new THREE.Mesh(new THREE.BoxGeometry(6,.7,.12),mat(0x1c3639,.65,.15));sign.position.set(garageSite.liftX,baseY+3+floor*8,garageSite.liftZ+5.2);scene.add(sign);}
  // Roof helipad with a marked H, perimeter lights, and a flyable helicopter.
  const pad=new THREE.Mesh(new THREE.CylinderGeometry(22,22,.22,32),mat(0x515b5d,.92));pad.position.set(x,garageSite.topY,z);scene.add(pad);
  const hMaterial=new THREE.MeshBasicMaterial({color:0xe8eee5});for(const [bx,bz,w,d] of [[x,z,2,22],[x,z,22,2]]){const mark=new THREE.Mesh(new THREE.BoxGeometry(w,.055,d),hMaterial);mark.position.set(bx,garageSite.topY+.15,bz);scene.add(mark);}
  for(let i=0;i<16;i++){const a=i*Math.PI/8,light=new THREE.Mesh(new THREE.SphereGeometry(.4,7,5),new THREE.MeshBasicMaterial({color:0xd4ff4f}));light.position.set(x+Math.cos(a)*24,garageSite.topY+.25,z+Math.sin(a)*24);scene.add(light);}
  createHelicopter(x+4,z-3,garageSite.topY+.18);
}
function createHelicopter(x,z,y){
  const group=new THREE.Group(),bodyMat=mat(0x4a625f,.52,.26),glass=mat(0x183c48,.2,.4),metal=mat(0x263234,.62,.4);
  const body=new THREE.Mesh(new THREE.SphereGeometry(1,12,9),bodyMat);body.scale.set(1.05,.8,2.0);body.position.y=1.2;group.add(body);
  const nose=new THREE.Mesh(new THREE.SphereGeometry(.68,10,8),glass);nose.scale.set(.86,.66,.8);nose.position.set(0,1.26,1.65);group.add(nose);
  const tail=new THREE.Mesh(new THREE.CylinderGeometry(.18,.32,4.3,8),bodyMat);tail.rotation.x=Math.PI/2;tail.position.set(0,1.45,-3.45);group.add(tail);
  const fin=new THREE.Mesh(new THREE.BoxGeometry(.18,1.2,1.1),bodyMat);fin.position.set(0,2,-5.35);group.add(fin);
  for(const side of [-1,1]){const skid=new THREE.Mesh(new THREE.CylinderGeometry(.08,.08,3.3,7),metal);skid.rotation.z=Math.PI/2;skid.position.set(side*.9,.38,.1);group.add(skid);const support=new THREE.Mesh(new THREE.CylinderGeometry(.06,.06,.85,6),metal);support.position.set(side*.72,.62,.65);group.add(support);}
  const mast=new THREE.Mesh(new THREE.CylinderGeometry(.08,.12,.9,8),metal);mast.position.y=2.15;group.add(mast);
  const rotor=new THREE.Group();rotor.position.y=2.65;group.add(rotor);for(let i=0;i<4;i++){const blade=new THREE.Mesh(new THREE.BoxGeometry(.23,.06,7.1),mat(0x252f30,.7,.3));blade.rotation.y=i*Math.PI/2;blade.position.z=2.2;rotor.add(blade);}
  const tailRotor=new THREE.Group();tailRotor.position.set(0,1.9,-5.2);group.add(tailRotor);for(let i=0;i<3;i++){const blade=new THREE.Mesh(new THREE.BoxGeometry(.11,.1,1.1),metal);blade.rotation.z=i*Math.PI/3;tailRotor.add(blade);}
  for(const o of [group])o.traverse(m=>{if(m.isMesh){m.castShadow=true;m.receiveShadow=true;}});group.position.set(x,y,z);group.rotation.y=Math.PI;scene.add(group);
  const h={group,x,z,yaw:Math.PI,speed:0,verticalSpeed:0,occupied:false,rotor,tailRotor,kind:'HELICOPTER'};helicopters.push(h);return h;
}

function generateCity() {
  addGroundAndRoads();
  addOrganicStreets();
  let index=0;
  const landmarks=[
    {x:250,z:-105,r:105},{x:-340,z:300,r:88},{x:-545,z:105,r:78},{x:465,z:130,r:110},{x:610,z:520,r:145}
  ];
  const isReserved=(x,z)=>landmarks.some(q=>Math.hypot(x-q.x,z-q.z)<q.r);
  const lotFree=(x,z,w,d,yaw=0)=>{
    // Boundary test uses rotated half-extents, preventing corner clipping at city edges.
    const ex=Math.abs(Math.cos(yaw))*w*.5+Math.abs(Math.sin(yaw))*d*.5;
    const ez=Math.abs(Math.sin(yaw))*w*.5+Math.abs(Math.cos(yaw))*d*.5;
    if(x-ex<-850||x+ex>850||z-ez<-850||z+ez>850||isReserved(x,z))return false;
    const nearRoad=cityRoadSamples.reduce((best,q)=>Math.min(best,Math.hypot(x-q.x,z-q.z)-q.width*.5),Infinity);
    if(nearRoad<Math.max(w,d)*.42+3.0)return false;
    if(cityRiverSamples.length){const riverNear=cityRiverSamples.reduce((best,q)=>Math.min(best,Math.hypot(x-q[0],z-q[1])),Infinity);if(riverNear<Math.max(w,d)*.50+13)return false;}
    // Bounding-circle clearance is deliberately compact; old .48 spacing left canyon-like gaps.
    const radius=Math.hypot(w,d)*.36;
    return buildings.every(b=>Math.hypot(x-b.x,z-b.z)>radius+Math.hypot(b.w||18,b.d||18)*.34+1.0);
  };
  // Buildings front organic streets; lot depth/orientation changes with the route and district.
  for(const route of cityRoadPaths){
    if(route.kind==='rail')continue;
    const pts=route.points;
    const stride=route.kind==='oldtown'?3:route.kind==='market'?4:5;
    for(let i=3;i<pts.length-3;i+=stride){
      const a=pts[i-1],b=pts[i+1],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz)||1,yaw=Math.atan2(dx,dz);
      for(const side of [-1,1]){
        const along=rand(-10,10),depth=route.kind==='oldtown'?rand(18,29):rand(23,42),width=route.kind==='oldtown'?rand(16,28):rand(22,42);
        const offset=route.width*.5+depth*.5+rand(5,13),x=pts[i][0]-dz/len*offset*side+dx/len*along,z=pts[i][1]+dx/len*offset*side+dz/len*along;
        if(!lotFree(x,z,width,depth,yaw))continue;
        const radius=Math.hypot(x,z);let h;
        if(route.kind==='oldtown')h=rand(8,25);
        else if(radius<420)h=rand(32,105);
        else h=rand(10,47);
        if(radius<320&&rng()<.22)h=rand(105,175);
        if(route.kind==='market'&&rng()<.48)h=rand(8,20);
        const styles=route.kind==='oldtown'?['historic','brick','concrete']:radius<420?['glass','modern','artdeco','cylindrical','slab']:['concrete','brick','modern','slab'];
        const style=pick(styles);
        addBuilding(x,z,width,depth,h,index++,{yaw,style});
      }
    }
  }
  // Irregular wedge parcels fill selected gaps between streets without reinstating a grid.
  let attempts=0,placed=0;
  while(placed<220&&attempts<3200){attempts++;const x=rand(-800,800),z=rand(-790,790),rad=Math.hypot(x,z);const w=rand(17,38),d=rand(18,40);
    const nearest=cityRoadSamples.reduce((best,q)=>Math.hypot(x-q.x,z-q.z)<best.d?{d:Math.hypot(x-q.x,z-q.z),q}:best,{d:Infinity,q:null});
    if(!lotFree(x,z,w,d,nearest.q?nearest.q.yaw:0))continue;
    if(!nearest.q||nearest.d>145)continue;
    const h=rad<400?rand(35,125):rand(10,44),style=pick(rad<400?['glass','modern','artdeco','cylindrical','slab']:['brick','concrete','modern','historic']);
    addBuilding(x,z,w,d,h,index++,{yaw:nearest.q.yaw+rand(-.35,.35),style});placed++;
  }
  // Close sparse city-edge gaps with compact, varied perimeter blocks. Keep the whole footprint inside bounds.
  let edgePlaced=0,edgeAttempts=0;
  while(edgePlaced<42&&edgeAttempts<1100){edgeAttempts++;const side=Math.floor(rng()*4),t=rand(-760,760);let x,z,yaw;
    if(side===0){x=-760+rand(-8,8);z=t;yaw=Math.PI/2;}
    else if(side===1){x=760+rand(-8,8);z=t;yaw=-Math.PI/2;}
    else if(side===2){x=t;z=-760+rand(-8,8);yaw=0;}
    else{x=t;z=760+rand(-8,8);yaw=Math.PI;}
    const w=rand(18,30),d=rand(18,32);if(!lotFree(x,z,w,d,yaw))continue;
    const style=pick(['brick','concrete','historic','modern']);addBuilding(x,z,w,d,rand(9,30),index++,{yaw:yaw+rand(-.16,.16),style});edgePlaced++;
  }
  addCityLandmarks();
  addOutskirts();
  addEastTerrainPatch();
  addAirport();
  addParkingGarageAndHelicopter();
}

function texFor(i){ return windowTextures[i%windowTextures.length]; }

function addTerrainPatch() {
  const minX=-1600, maxX=-650, minZ=-1600, maxZ=-440, nx=58, nz=68;
  const positions=[], colors=[], indices=[];
  const cA=new THREE.Color(0x536b57), cB=new THREE.Color(0x77776c), cC=new THREE.Color(0x9b9b8e);
  for(let iz=0;iz<=nz;iz++) for(let ix=0;ix<=nx;ix++) {
    const x=minX+(maxX-minX)*ix/nx, z=minZ+(maxZ-minZ)*iz/nz, h=mountainHeight(x,z);
    positions.push(x,h-0.04,z);
    const mix=Math.min(1,h/225); const c=cA.clone().lerp(cB,mix*.72).lerp(cC,Math.max(0,(h-145)/145));
    const noise=.94 + .06*Math.sin(x*.04+z*.026); colors.push(c.r*noise,c.g*noise,c.b*noise);
  }
  for(let iz=0;iz<nz;iz++) for(let ix=0;ix<nx;ix++) { const a=iz*(nx+1)+ix,b=a+1,c=a+nx+1,d=c+1; indices.push(a,c,b,b,c,d); }
  const geo=new THREE.BufferGeometry(); geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3)); geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3)); geo.setIndex(indices); geo.computeVertexNormals();
  const terrain=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,side:THREE.DoubleSide})); terrain.receiveShadow=true; terrain.castShadow=false; scene.add(terrain);
  // Rock outcrops accent the silhouettes while leaving the route drivable.
  for(let i=0;i<54;i++) {
    const x=rand(-1570,-760), z=rand(-1530,-520), h=mountainHeight(x,z);
    if(h<28 || rng()<.2) continue;
    const rock=new THREE.Mesh(new THREE.DodecahedronGeometry(rand(3,10),0),mat(pick([0x606762,0x74766e,0x555e5a]),.98));
    rock.scale.set(rand(.7,1.8),rand(.5,2.4),rand(.7,1.6)); rock.position.set(x,h+rock.scale.y*3,z); rock.rotation.set(rand(-.3,.3),rand(0,Math.PI),rand(-.25,.25)); rock.castShadow=true; scene.add(rock);
  }
  for(let i=0;i<100;i++) {
    const x=rand(-1560,-770), z=rand(-1560,-490), h=mountainHeight(x,z);
    if(h<4 || rng()<.36 || (x<-1420 && z>-960)) continue;
    const scale=rand(.45,1.05), trunk=new THREE.Mesh(new THREE.CylinderGeometry(.17*scale,.29*scale,1.8*scale,6),mats.trunk);
    trunk.position.set(x,h+.9*scale,z); const crown=new THREE.Mesh(new THREE.ConeGeometry(1.15*scale,3.2*scale,7),mats.tree); crown.position.set(x,h+2.7*scale,z); crown.castShadow=true; scene.add(trunk,crown);
  }
}
function addEastTerrainPatch() {
  // Low-poly hills make the eastern outskirts visibly uneven without lifting the city streets or airport.
  const minX=780,maxX=1600,minZ=-700,maxZ=1000,nx=44,nz=48;
  const positions=[],colors=[],indices=[];
  const low=new THREE.Color(0x566b50),mid=new THREE.Color(0x777969),high=new THREE.Color(0x969486);
  for(let iz=0;iz<=nz;iz++) for(let ix=0;ix<=nx;ix++) {
    const x=minX+(maxX-minX)*ix/nx,z=minZ+(maxZ-minZ)*iz/nz;
    const lotEdge=Math.max(Math.abs(x-PARKING_LOT.x)-PARKING_LOT.width/2,Math.abs(z-PARKING_LOT.z)-PARKING_LOT.depth/2);
    const h=mountainHeight(x,z)*clamp(lotEdge/38,0,1);
    positions.push(x,h-.055,z);
    const mix=clamp(h/75,0,1),c=low.clone().lerp(mid,mix*.75).lerp(high,Math.max(0,(h-42)/50));
    const n=.95+.05*Math.sin(x*.036-z*.027);colors.push(c.r*n,c.g*n,c.b*n);
  }
  for(let iz=0;iz<nz;iz++)for(let ix=0;ix<nx;ix++){const a=iz*(nx+1)+ix,b=a+1,c=a+nx+1,d=c+1;indices.push(a,c,b,b,c,d);}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geo.setIndex(indices);geo.computeVertexNormals();
  const mesh=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,side:THREE.DoubleSide}));mesh.receiveShadow=true;scene.add(mesh);
  for(let i=0;i<46;i++){
    const x=rand(820,1570),z=rand(-640,930),h=mountainHeight(x,z);
    const inLot=Math.abs(x-PARKING_LOT.x)<PARKING_LOT.width/2+28&&Math.abs(z-PARKING_LOT.z)<PARKING_LOT.depth/2+28;
    if(h<5||inLot|| (z>-1060&&z<-700&&x>100&&x<1600) || rng()<.32)continue;
    const treeScale=rand(.55,1.1),trunk=new THREE.Mesh(new THREE.CylinderGeometry(.16*treeScale,.26*treeScale,1.8*treeScale,6),mats.trunk);
    trunk.position.set(x,h+.9*treeScale,z);const crown=new THREE.Mesh(new THREE.ConeGeometry(1.25*treeScale,3.4*treeScale,7),mats.tree);crown.position.set(x,h+2.8*treeScale,z);trunk.castShadow=true;crown.castShadow=true;scene.add(trunk,crown);
  }
  // A few boulders accent the undulating ridges.
  for(let i=0;i<18;i++){
    const x=rand(900,1570),z=rand(-570,920),h=mountainHeight(x,z);if(h<12||(Math.abs(x-PARKING_LOT.x)<PARKING_LOT.width/2+28&&Math.abs(z-PARKING_LOT.z)<PARKING_LOT.depth/2+28))continue;
    const rock=new THREE.Mesh(new THREE.DodecahedronGeometry(rand(2.5,7),0),mat(pick([0x656b63,0x77796e,0x5c665b]),.98));
    rock.scale.set(rand(.8,1.7),rand(.6,1.8),rand(.8,1.5));rock.position.set(x,h+rock.scale.y*2.1,z);rock.rotation.set(rand(-.3,.3),rand(0,Math.PI),rand(-.25,.25));scene.add(rock);
  }
}

function addRoadRibbon(points,width,material,heightFn=()=>0,yOffset=.18,markings=false) {
  if(points.length<2)return;
  const vertices=[],indices=[];let totalLength=0;const cumulative=[0];
  for(let i=0;i<points.length-1;i++){
    const a=points[i],b=points[i+1],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz)||1;
    const px=dz/len*width/2,pz=-dx/len*width/2;
    const start=vertices.length/3;
    vertices.push(
      a[0]+px,heightFn(a[0]+px,a[1]+pz)+yOffset,a[1]+pz,
      a[0]-px,heightFn(a[0]-px,a[1]-pz)+yOffset,a[1]-pz,
      b[0]+px,heightFn(b[0]+px,b[1]+pz)+yOffset,b[1]+pz,
      b[0]-px,heightFn(b[0]-px,b[1]-pz)+yOffset,b[1]-pz
    );
    indices.push(start,start+2,start+1,start+1,start+2,start+3);
    totalLength+=len;cumulative.push(totalLength);
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.setIndex(indices);geo.computeVertexNormals();
  const ribbon=new THREE.Mesh(geo,material);ribbon.receiveShadow=true;scene.add(ribbon);
  if(markings){
    const marks=[];let nextAt=10;
    for(let i=0;i<points.length-1&&nextAt<totalLength-3;i++){
      const a=points[i],b=points[i+1],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz)||1;
      while(nextAt<=cumulative[i+1]&&nextAt<totalLength-3){
        if(nextAt>=cumulative[i]-1e-6){const t=clamp((nextAt-cumulative[i])/len,0,1),x=a[0]+dx*t,z=a[1]+dz*t,y=heightFn(x,z)+yOffset+.035;marks.push({x,y,z,yaw:Math.atan2(dx,dz),slope:Math.atan2(-(heightFn(b[0],b[1])-heightFn(a[0],a[1])),len)});}
        nextAt+=27;
      }
    }
    if(marks.length){const dashGeo=new THREE.BoxGeometry(.18,.035,3.5),dashMesh=new THREE.InstancedMesh(dashGeo,mats.lane,marks.length),dummy=new THREE.Object3D();marks.forEach((m,i)=>{dummy.position.set(m.x,m.y,m.z);dummy.rotation.set(m.slope,m.yaw,0);dummy.updateMatrix();dashMesh.setMatrixAt(i,dummy.matrix);});dashMesh.instanceMatrix.needsUpdate=true;dashMesh.computeBoundingSphere();scene.add(dashMesh);}
  }
}
function addParkingLot() {
  const {x,z,width,depth}=PARKING_LOT;
  const slab=new THREE.Mesh(new THREE.BoxGeometry(width,.2,depth),mats.road); slab.position.set(x,0,z); slab.receiveShadow=true; scene.add(slab);
  const white=new THREE.MeshBasicMaterial({color:0xd1d6d1});
  for(let i=-12;i<=12;i++) { const line=new THREE.Mesh(new THREE.BoxGeometry(.17,.035,12),white); line.position.set(x+i*7, .125,z-34); scene.add(line); const line2=line.clone(); line2.position.z=z+34; scene.add(line2); }
  for(const zz of [z-41,z-13,z+13,z+41]) { const line=new THREE.Mesh(new THREE.BoxGeometry(width-18,.035,.18),white); line.position.set(x,.126,zz); scene.add(line); }
  const curbMat=mat(0xaab4b1,.88);
  for(const [cx,cz,w,d] of [[x,z-depth/2,width,.7],[x,z+depth/2,width,.7],[x-width/2,z,.7,depth],[x+width/2,z,.7,depth]]) { const curb=new THREE.Mesh(new THREE.BoxGeometry(w,.32,d),curbMat); curb.position.set(cx,.05,cz); scene.add(curb); }
  // Driveway links the parking lot to the edge of the city grid and the coast route.
  addRoadRibbon([[770,820],[840,740],[910,625],[970,505]],12,mats.road,()=>0,.13,true);
}
function addHighway() {
  const freewayMat = new THREE.MeshStandardMaterial({color:0x242c31, roughness:.96, side:THREE.DoubleSide});
  const concrete = mat(0x737d7f,.88,.08);
  const railMat = mat(0xaab4b5,.56,.42);
  const paint = new THREE.MeshBasicMaterial({color:0xd6ddd8});
  // A long, multi-segment deck lets the freeway smoothly climb onto a viaduct.
  const path=[];
  for(let x=-1540;x<=1540;x+=100) path.push([x,HIGHWAY_Z]);
  if(path[path.length-1][0]!==1540) path.push([1540,HIGHWAY_Z]);
  addRoadRibbon(path,HIGHWAY_WIDTH,freewayMat,highwayElevationAtX,.18,false);

  // Highway lane separators and edge lines (shared geometry via instancing).
  const laneOffsets=[-13,-6,6,13];
  const laneGeo=new THREE.BoxGeometry(5.2,.035,.17);
  const laneCount=Math.ceil(3080/18)*laneOffsets.length;
  const laneMarks=new THREE.InstancedMesh(laneGeo,paint,laneCount);
  const dummy=new THREE.Object3D();let n=0;
  for(let x=-1530;x<=1530;x+=18) for(const off of laneOffsets) {
    dummy.position.set(x,highwayElevationAtX(x)+.235,HIGHWAY_Z+off);dummy.rotation.set(0,0,0);dummy.updateMatrix();laneMarks.setMatrixAt(n++,dummy.matrix);
  }
  laneMarks.count=n;laneMarks.instanceMatrix.needsUpdate=true;scene.add(laneMarks);
  const edgeGeo=new THREE.BoxGeometry(10,.04,.22);
  const edgeCount=Math.ceil(3080/10)*2;
  const edges=new THREE.InstancedMesh(edgeGeo,paint,edgeCount);let en=0;
  for(let x=-1535;x<=1535;x+=10) for(const off of [-19.5,19.5]) {
    dummy.position.set(x,highwayElevationAtX(x)+.235,HIGHWAY_Z+off);dummy.updateMatrix();edges.setMatrixAt(en++,dummy.matrix);
  }
  edges.count=en;edges.instanceMatrix.needsUpdate=true;scene.add(edges);

  // Continuous concrete median and roadside guardrails, broken into short pieces to follow slopes.
  for(let x=-1535;x<1535;x+=24) {
    const mid=x+12,h=highwayElevationAtX(mid),slope=Math.atan2(highwayElevationAtX(x+24)-highwayElevationAtX(x),24);
    const barrier=new THREE.Mesh(new THREE.BoxGeometry(24,1.05,1.05),concrete);
    barrier.position.set(mid,h+.78,HIGHWAY_Z);barrier.rotation.z=slope;barrier.castShadow=true;scene.add(barrier);
    for(const side of [-1,1]) {
      const rail=new THREE.Mesh(new THREE.BoxGeometry(24,.16,.18),railMat);
      rail.position.set(mid,h+1.03,HIGHWAY_Z+side*20.4);rail.rotation.z=slope;scene.add(rail);
      if(Math.round((x+1535)/24)%2===0) {
        const post=new THREE.Mesh(new THREE.BoxGeometry(.18,1.05,.18),railMat);
        post.position.set(mid,h+.62,HIGHWAY_Z+side*20.4);scene.add(post);
      }
    }
    // Concrete bridge columns appear only where the deck is clearly elevated.
    if(Math.abs(x)%96<1 && h>2.2) {
      const pier=new THREE.Mesh(new THREE.BoxGeometry(1.7,h,2.2),concrete);
      pier.position.set(mid,h/2,HIGHWAY_Z);pier.castShadow=true;scene.add(pier);
      const cap=new THREE.Mesh(new THREE.BoxGeometry(6,.65,3.1),concrete);cap.position.set(mid,h-.18,HIGHWAY_Z);scene.add(cap);
    }
  }

  // Two visible entrance/exit ramps connect the elevated freeway back to city-level streets.
  for(const rx of HIGHWAY_RAMP_XS) {
    const rampPath=[[rx,HIGHWAY_RAMP_BASE_Z],[rx,HIGHWAY_RAMP_BASE_Z+14],[rx,HIGHWAY_RAMP_BASE_Z+32],[rx,HIGHWAY_RAMP_TOP_Z]];
    addRoadRibbon(rampPath,12,freewayMat,(_x,z)=>highwayRampElevation(z),.16,true);
    for(const side of [-1,1]) {
      const lineX=rx+side*6.4;
      for(let z=HIGHWAY_RAMP_BASE_Z+5;z<HIGHWAY_RAMP_TOP_Z-4;z+=8) {
        const y=highwayRampElevation(z)+.23;
        const rail=new THREE.Mesh(new THREE.BoxGeometry(.16,.16,8),railMat);
        rail.position.set(lineX,y,z+4);scene.add(rail);
        const post=new THREE.Mesh(new THREE.BoxGeometry(.18,.85,.18),railMat);post.position.set(lineX,y-.25,z+4);scene.add(post);
      }
    }
    // Large green exit signs mark each junction.
    const signGroup=new THREE.Group();
    const board=new THREE.Mesh(new THREE.BoxGeometry(9,2.5,.24),mat(0x176443,.72,.06));board.position.y=6.4;signGroup.add(board);
    const signText=new THREE.Mesh(new THREE.BoxGeometry(6.7,.09,.27),new THREE.MeshBasicMaterial({color:0xe5f4dc}));signText.position.set(0,6.7,.16);signGroup.add(signText);
    for(const sx of [-3.2,3.2]) {const post=new THREE.Mesh(new THREE.BoxGeometry(.2,6,.2),concrete);post.position.set(sx,3,0);signGroup.add(post);}
    signGroup.position.set(rx,highwayElevationAtX(rx)+.2,HIGHWAY_Z+27);scene.add(signGroup);
  }

  // Add a small number of cars laterally distributed along the freeway as traffic scenery.
  const trafficTypes=['SEDAN','SPORT','SUV','VAN','PICKUP','TAXI'];
  for(let i=0;i<8;i++) {
    const dir=i%2===0?1:-1;
    const lane=(i%4<2?7.5:13.5)*(dir>0?1:-1);
    const x=-1320+i*365;
    const car=createCar(x,HIGHWAY_Z+lane,dir>0?Math.PI/2:-Math.PI/2,pick(colors),false,pick(trafficTypes));
    car.ai=true;car.highway=true;car.highwayDirection=dir;car.parked=false;car.speed=rand(14,23);car.yaw=dir>0?Math.PI/2:-Math.PI/2;
    car.group.position.y=terrainHeight(car.group.position.x,car.group.position.z);car.group.rotation.y=car.yaw;
  }
}

function addOutskirts() {
  addTerrainPatch();
  // Sandy beach and low tide line; the water is a separate animated-looking reflective surface.
  const sand=mat(0xc5b58a,.98), water=new THREE.MeshStandardMaterial({color:0x24677c,roughness:.25,metalness:.18,transparent:true,opacity:.96});
  const beach=new THREE.Mesh(new THREE.PlaneGeometry(WORLD+120,235),sand); beach.rotation.x=-Math.PI/2; beach.position.set(0,-.055,1145); beach.receiveShadow=true; scene.add(beach);
  const waterMesh=new THREE.Mesh(new THREE.PlaneGeometry(WORLD+300,1050),water); waterMesh.rotation.x=-Math.PI/2; waterMesh.position.set(0,-.16,1775); scene.add(waterMesh);
  // Curved coastal road, connected to the downtown grid near the waterfront.
  const coastMaterial=new THREE.MeshStandardMaterial({color:0x30383e,roughness:.95,side:THREE.DoubleSide});
  addRoadRibbon([[-1550,1010],[-1280,1025],[-1000,990],[-720,1010],[-420,985],[-120,1000],[180,975],[470,1005],[760,985],[1030,1015],[1300,1000],[1540,1028]],14,coastMaterial,()=>0,.13,true);
  // Winding mountain pass hugs the changing elevation, giving vehicles an uneven road to climb.
  const mountainRoute=[[-1550,-1180],[-1435,-1085],[-1350,-1038],[-1260,-980],[-1175,-918],[-1080,-870],[-1015,-805],[-930,-760],[-850,-710],[-790,-645],[-755,-570]];
  addRoadRibbon(mountainRoute,10,coastMaterial,mountainHeight,.055,true);
  // Cliff-edge guard rails on exposed switchbacks.
  const railMat=mat(0x9aa5a5,.48,.55);
  for(let i=1;i<mountainRoute.length-1;i++) {
    const [x,z]=mountainRoute[i],h=mountainHeight(x,z);
    const post=new THREE.Mesh(new THREE.BoxGeometry(.18,1.3,.18),railMat); post.position.set(x+6,h+1.15,z); scene.add(post);
    if(i<mountainRoute.length-2) {const next=mountainRoute[i+1],dx=next[0]-x,dz=next[1]-z; const rail=new THREE.Mesh(new THREE.BoxGeometry(.14,.14,Math.hypot(dx,dz)),railMat); rail.position.set(x+6,h+1.6,z); rail.rotation.y=Math.atan2(dx,dz); scene.add(rail);}
  }
  // Low dunes, palms and boulders mark the transition from city to shoreline.
  for(let i=0;i<40;i++) {
    const x=rand(-1500,1500),z=rand(1050,1230);
    const dune=new THREE.Mesh(new THREE.SphereGeometry(1,7,5),mat(pick([0xc1b185,0xd1bf94,0xb2a477]),1)); dune.scale.set(rand(7,24),rand(1.1,3.5),rand(5,16)); dune.position.set(x,-.1,z); scene.add(dune);
  }
  for(let i=0;i<20;i++) {
    const x=rand(-1460,1450),z=rand(1070,1200),scale=rand(.7,1.35);
    const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.18*scale,.26*scale,3.2*scale,7),mats.trunk); trunk.position.set(x,1.6*scale,z); trunk.rotation.z=rand(-.15,.15); scene.add(trunk);
    const crown=new THREE.Mesh(new THREE.ConeGeometry(1.6*scale,3.5*scale,7),mat(0x36725a)); crown.position.set(x,3.8*scale,z); crown.rotation.z=rand(-.45,.45); scene.add(crown);
  }
  addParkingLot();
  addHighway();
}

function addAirportBuilding(x,z,w,d,h,color=0x9aa8ad,glass=false) {
  const material=glass?mat(color,.32,.32,{emissive:0x0b2025,emissiveIntensity:.22}):mat(color,.84,.08);
  const baseY=terrainHeight(x,z);const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);mesh.position.set(x,baseY+h/2,z);mesh.castShadow=true;mesh.receiveShadow=true;scene.add(mesh);
  buildings.push({x,z,w,d,height:h,baseY,yaw:0,mesh,visual:mesh,style:'airport'});buildingMeshes.push(mesh);aimObjects.push(mesh);return mesh;
}
function addAirport() {
  const concrete=mat(0x4e595d,.94,.04),taxiMat=mat(0x444d50,.95,.02),paint=new THREE.MeshBasicMaterial({color:0xe4e6d8});
  // Runway is along X, with threshold bars, dashed centre line, edge paint and runway lights.
  const length=AIRPORT.runwayEndX-AIRPORT.runwayStartX,centerX=(AIRPORT.runwayStartX+AIRPORT.runwayEndX)/2,z=AIRPORT.runwayZ;
  const runway=new THREE.Mesh(new THREE.BoxGeometry(length,.22,AIRPORT.runwayWidth),concrete);runway.position.set(centerX,.02,z);runway.receiveShadow=true;scene.add(runway);
  const centerMarks=new THREE.InstancedMesh(new THREE.BoxGeometry(13,.035,.42),paint,Math.floor(length/30));let dummy=new THREE.Object3D(),n=0;
  for(let x=AIRPORT.runwayStartX+20;x<AIRPORT.runwayEndX-12;x+=30){dummy.position.set(x,.145,z);dummy.rotation.set(0,0,0);dummy.updateMatrix();centerMarks.setMatrixAt(n++,dummy.matrix);}centerMarks.count=n;centerMarks.instanceMatrix.needsUpdate=true;scene.add(centerMarks);
  for(const thresholdX of [AIRPORT.runwayStartX+22,AIRPORT.runwayEndX-22]){
    for(let zz=-23;zz<=23;zz+=6){const stripe=new THREE.Mesh(new THREE.BoxGeometry(2.4,.04,4.6),paint);stripe.position.set(thresholdX,.15,z+zz);scene.add(stripe);}
  }
  const edgeGeo=new THREE.BoxGeometry(3,.04,.22),edgeCount=Math.ceil(length/12)*2,edges=new THREE.InstancedMesh(edgeGeo,paint,edgeCount);n=0;
  for(let x=AIRPORT.runwayStartX+4;x<AIRPORT.runwayEndX;x+=12)for(const side of [-1,1]){dummy.position.set(x,.15,z+side*(AIRPORT.runwayWidth/2-1.6));dummy.updateMatrix();edges.setMatrixAt(n++,dummy.matrix);}edges.count=n;edges.instanceMatrix.needsUpdate=true;scene.add(edges);
  for(let x=AIRPORT.runwayStartX+5;x<AIRPORT.runwayEndX;x+=18)for(const side of [-1,1]){const light=new THREE.Mesh(new THREE.SphereGeometry(.38,6,5),new THREE.MeshBasicMaterial({color:side===1?0xe8f7ff:0x77d9ff}));light.position.set(x,.38,z+side*(AIRPORT.runwayWidth/2+2));scene.add(light);}
  // Taxiway and a broad apron connect the runway to terminal stands and hangars.
  const taxiH=new THREE.Mesh(new THREE.BoxGeometry(430,.16,18),taxiMat);taxiH.position.set(1110,.035,-900);taxiH.receiveShadow=true;scene.add(taxiH);
  const taxiV=new THREE.Mesh(new THREE.BoxGeometry(18,.16,170),taxiMat);taxiV.position.set(1320,.035,-915);taxiV.receiveShadow=true;scene.add(taxiV);
  const taxiWest=new THREE.Mesh(new THREE.BoxGeometry(870,.16,18),taxiMat);taxiWest.position.set(890,.035,-830);taxiWest.receiveShadow=true;scene.add(taxiWest);
  const taxiWestLink=new THREE.Mesh(new THREE.BoxGeometry(18,.16,170),taxiMat);taxiWestLink.position.set(460,.035,-915);taxiWestLink.receiveShadow=true;scene.add(taxiWestLink);
  const apron=new THREE.Mesh(new THREE.BoxGeometry(480,.16,120),mat(0x646b6b,.98));apron.position.set(1050,.025,-830);apron.receiveShadow=true;scene.add(apron);
  // Apron taxi lines and parking bays.
  const yellow=new THREE.MeshBasicMaterial({color:0xf0c65c});
  const taxiLine=new THREE.Mesh(new THREE.BoxGeometry(450,.035,.22),yellow);taxiLine.position.set(1050,.13,-830);scene.add(taxiLine);
  for(let i=0;i<12;i++){const bay=new THREE.Mesh(new THREE.BoxGeometry(.18,.025,20),paint);bay.position.set(850+i*35,.13,-800);scene.add(bay);}
  // Main terminal, glass facade, rooftop equipment and a control tower.
  addAirportBuilding(AIRPORT.terminalX,AIRPORT.terminalZ,195,42,13,0x84969c,true);
  const terminalRoof=new THREE.Mesh(new THREE.BoxGeometry(204,1.25,49),mat(0x34434a,.48,.32));terminalRoof.position.set(AIRPORT.terminalX,13.7,AIRPORT.terminalZ);terminalRoof.castShadow=true;scene.add(terminalRoof);
  const frontGlass=new THREE.Mesh(new THREE.BoxGeometry(175,7,.18),new THREE.MeshStandardMaterial({color:0x6ac4d5,metalness:.3,roughness:.25,transparent:true,opacity:.62}));frontGlass.position.set(AIRPORT.terminalX,6.7,AIRPORT.terminalZ-21.2);scene.add(frontGlass);
  for(let i=0;i<8;i++){const post=new THREE.Mesh(new THREE.BoxGeometry(.35,8,.35),mat(0xc7d1d0,.5,.25));post.position.set(AIRPORT.terminalX-84+i*24,4.3,AIRPORT.terminalZ-21.35);scene.add(post);}
  // Terminal concourse / jetways.
  for(const x of [990,1050,1110]){const bridge=new THREE.Mesh(new THREE.BoxGeometry(17,3.5,7),mat(0xaab5b7,.5,.25));bridge.position.set(x,2,-789);scene.add(bridge);const support=new THREE.Mesh(new THREE.BoxGeometry(.7,2,.7),mat(0x7d898b));support.position.set(x,1,-789);scene.add(support);}
  // Hangars and aircraft service buildings are registered as collision geometry too.
  addAirportBuilding(760,-755,82,56,16,0x909b9b,false);
  addAirportBuilding(1370,-758,76,54,14,0x7f8c90,false);
  for(const x of [760,1370]){const roof=new THREE.Mesh(new THREE.BoxGeometry(86,1.4,60),mat(0x536268,.66,.2));roof.position.set(x,16,-755);scene.add(roof);const door=new THREE.Mesh(new THREE.BoxGeometry(21,10,.22),mat(0x39484e,.9));door.position.set(x,5.2,-726.8);scene.add(door);}
  const tower=new THREE.Group();const shaft=new THREE.Mesh(new THREE.CylinderGeometry(5.2,7.2,30,10),mat(0xc5cecb,.75,.08));shaft.position.y=15;tower.add(shaft);const cabin=new THREE.Mesh(new THREE.BoxGeometry(16,7,13),mat(0x365b67,.26,.32));cabin.position.y=31;tower.add(cabin);const cap=new THREE.Mesh(new THREE.BoxGeometry(18,1.1,15),mat(0xbfc9c4,.42,.18));cap.position.y=35;tower.add(cap);tower.position.set(875,0,-740);tower.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});scene.add(tower);buildings.push({x:875,z:-740,w:18,d:18,height:36,mesh:shaft});
  for(let i=0;i<5;i++){const lamp=new THREE.Mesh(new THREE.CylinderGeometry(.12,.12,9,6),mat(0x858e8e));lamp.position.set(820+i*100,4.5,-905);scene.add(lamp);const bulb=new THREE.Mesh(new THREE.SphereGeometry(.65,7,5),new THREE.MeshBasicMaterial({color:0xfff0c0}));bulb.position.set(820+i*100,9,-905);scene.add(bulb);}
  // The terminal now reads as a distinct playable region rather than a waypoint on flat ground.
}

function isBlocked(x,z,r=1) {
  if(Math.abs(x)>HALF-8||Math.abs(z)>HALF-8||isOverWater(x,z))return true;
  // Keep pedestrians/vehicles out of the river except at the purpose-built bridges.
  if(cityRiverSamples.length){let nearest=Infinity;for(const q of cityRiverSamples){const d=Math.hypot(x-q[0],z-q[1]);if(d<nearest)nearest=d;}if(nearest<14&&!bridgeAt(x,z))return true;}
  for(const b of buildings){if(currentInterior===b)continue;const dx=x-b.x,dz=z-b.z,c=Math.cos(b.yaw||0),sn=Math.sin(b.yaw||0),lx=dx*c-dz*sn,lz=dx*sn+dz*c;if(Math.abs(lx)<b.w/2+r&&Math.abs(lz)<b.d/2+r)return true;}
  if(!player?.roofLevel)for(const q of garagePillars)if(Math.abs(x-q.x)<q.r+r&&Math.abs(z-q.z)<q.r+r)return true;
  return false;
}

function collidingCarAt(x,z,radius,ignoreCar=null) {
  for(const c of cars){if(c===ignoreCar||!c.group.visible)continue;const r=radius+(c.type==='BUS'?3.2:2.35);if(Math.hypot(x-c.group.position.x,z-c.group.position.z)<r)return c;}
  return null;
}
function collidingPedestrianAt(x,z,radius=.7) {
  for(const p of pedestrians){if(p.downed)continue;if(Math.hypot(x-p.root.position.x,z-p.root.position.z)<radius+.52)return p;}
  for(const unit of policeUnits){if(unit.officer&&!unit.officer.downed&&Math.hypot(x-unit.officer.root.position.x,z-unit.officer.root.position.z)<radius+.52)return unit.officer;}
  return null;
}
function footPositionBlocked(x,z) {
  return !!collidingCarAt(x,z,.75,null)||!!collidingPedestrianAt(x,z,.45)||enemies.some(e=>e.alive&&Math.hypot(x-e.root.position.x,z-e.root.position.z)<1.0);
}
function strikePedestrian(p,byPolice=false) {
  if(!p||p.downed)return false;
  p.downed=true;p.speed=0;p.pause=9999;
  p.root.rotation.z=Math.PI/2;p.root.position.y=terrainHeight(p.root.position.x,p.root.position.z)+.12;
  wanted=Math.min(5,wanted+(byPolice?0:.82));wantedCool=18;wantedClearTimer=6;
  if(!byPolice){spawnImpact(v3(p.root.position.x,p.root.position.y+.2,p.root.position.z),0xffc66b,7);showToast('歩行者と衝突！ 手配度が上昇');}
  return true;
}

function createCar(x,z,yaw,color=pick(colors),isStarter=false,type=null) {
  const types=[
    {name:'SEDAN',sx:1,sy:1,sz:1}, {name:'SPORT',sx:1.02,sy:.78,sz:1.12},
    {name:'SUV',sx:1.12,sy:1.13,sz:1.04}, {name:'VAN',sx:1.1,sy:1.14,sz:1.18},
    {name:'PICKUP',sx:1.12,sy:1.02,sz:1.14}, {name:'TAXI',sx:1.01,sy:1,sz:1.02},
    {name:'POLICE',sx:1.04,sy:1.02,sz:1.04}, {name:'BUS',sx:1.27,sy:1.38,sz:1.62}
  ];
  const typeDef=typeof type==='string'?types.find(t=>t.name===type)||types[0]:(type||(isStarter?types[0]:pick(types)));
  const group=new THREE.Group();group.userData.sirenLights=[];
  const bodyMat=mat(color,.42,.28);
  const body=new THREE.Mesh(new THREE.BoxGeometry(2.08,.72,4.25),bodyMat); body.position.y=.74; body.castShadow=true; body.receiveShadow=true; group.add(body);
  const hood=new THREE.Mesh(new THREE.BoxGeometry(1.92,.22,1.12),bodyMat); hood.position.set(0,1.1,1.28); group.add(hood);
  const roofMatCar=mat(pick([0x202c33,0x374950,0x27313c,0x617078]),.3,.28);
  const roofDims=typeDef.name==='VAN'?[1.72,.82,2.45]:typeDef.name==='BUS'?[1.9,1.05,3.5]:typeDef.name==='SPORT'?[1.55,.42,1.78]:[1.62,.62,1.95];
  const roof=new THREE.Mesh(new THREE.BoxGeometry(...roofDims),roofMatCar); roof.position.set(0,typeDef.name==='BUS'?1.42:1.26,-.15); roof.castShadow=true; group.add(roof);
  const windshield=new THREE.Mesh(new THREE.BoxGeometry(typeDef.name==='BUS'?1.75:1.52,.43,.06),mats.glass); windshield.position.set(0,typeDef.name==='BUS'?1.55:1.3,.84); windshield.rotation.x=-.2; group.add(windshield);
  const rearGlass=new THREE.Mesh(new THREE.BoxGeometry(1.45,.38,.06),mats.glass); rearGlass.position.set(0,1.31,-1.13); rearGlass.rotation.x=.23; group.add(rearGlass);
  if(typeDef.name==='PICKUP') { const bed=new THREE.Mesh(new THREE.BoxGeometry(1.62,.28,1.25),mat(0x343d41,.8)); bed.position.set(0,.98,-1.35); group.add(bed); for(const side of [-1,1]) {const wall=new THREE.Mesh(new THREE.BoxGeometry(.1,.42,1.5),bodyMat);wall.position.set(side*.82,1.05,-1.35);group.add(wall);} }
  if(typeDef.name==='VAN'||typeDef.name==='BUS') { for(const zz of (typeDef.name==='BUS'?[-1.1,-.25,.6,1.45]:[-.75,.15])) {const pane=new THREE.Mesh(new THREE.BoxGeometry(1.55,.3,.04),mats.glass);pane.position.set(0,1.42,zz);group.add(pane);} }
  const wheelGeo=new THREE.CylinderGeometry(typeDef.name==='BUS'?.45:.39,typeDef.name==='BUS'?.45:.39,.23,12); wheelGeo.rotateZ(Math.PI/2);
  const wheels=[];
  for(const wx of [-1,1]) for(const wz of [-1.35,1.35]) { const wheel=new THREE.Mesh(wheelGeo,mats.rubber); wheel.position.set(wx*1.02,.42,wz*(typeDef.name==='BUS'?1.25:1)); group.add(wheel); wheels.push(wheel); }
  for(const hx of [-.64,.64]) { const light=new THREE.Mesh(new THREE.BoxGeometry(.42,.18,.08),mats.light); light.position.set(hx,.82,2.14); group.add(light); const tail=new THREE.Mesh(new THREE.BoxGeometry(.42,.18,.08),mats.redLight); tail.position.set(hx,.82,-2.14); group.add(tail); }
  if(typeDef.name==='TAXI') { const cap=new THREE.Mesh(new THREE.BoxGeometry(.55,.16,.3),mat(0xf2d24b)); cap.position.set(0,1.62,-.12);group.add(cap); }
  if(typeDef.name==='POLICE') { const bar=new THREE.Mesh(new THREE.BoxGeometry(.78,.13,.22),new THREE.MeshStandardMaterial({color:0x25333a,emissive:0x12232a}));bar.position.set(0,1.62,-.12);group.add(bar);for(const side of [-1,1]){const bl=new THREE.Mesh(new THREE.BoxGeometry(.28,.11,.18),new THREE.MeshBasicMaterial({color:side<0?0x1f75ff:0xff293c}));bl.position.set(side*.22,1.72,-.12);group.add(bl);group.userData.sirenLights.push(bl);} }
  if(typeDef.name==='BUS') { for(let zz=-1.3;zz<=1.3;zz+=.65) {const pane=new THREE.Mesh(new THREE.BoxGeometry(1.72,.02,.05),mat(0x77858a,.6));pane.position.set(0,1.96,zz);group.add(pane);} }
  group.scale.set(typeDef.sx,typeDef.sy,typeDef.sz);
  group.position.set(x,terrainHeight(x,z),z); group.rotation.y=yaw; scene.add(group);
  const car={group,x,z,yaw,speed:0,color,bodyMat,wheels,parked:true,occupied:false,isStarter,health:100,ai:false,cruise:0,type:typeDef.name}; cars.push(car);
  return car;
}
function createHumanoid(color=0x436d80,isEnemy=false) {
  // Stylised realistic 8-head proportions: compact head, long legs and a narrow torso.
  const root=new THREE.Group();
  const shirt=mat(color,.86,.03), pants=mat(isEnemy?0x252a31:0x364149,.92), skin=mat(isEnemy?0x9a6b4d:pick([0xc99b79,0x8d634b,0xe0b18c,0x9f7258]),.84), shoe=mat(0x111820,.8);
  const torso=new THREE.Mesh(new THREE.CapsuleGeometry(.205,.40,4,8),shirt); torso.position.y=1.12; torso.castShadow=true; root.add(torso);
  const neck=new THREE.Mesh(new THREE.CylinderGeometry(.055,.065,.12,8),skin); neck.position.y=1.54; root.add(neck);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.118,12,10),skin); head.position.y=1.675; head.scale.set(1,1.08,.92); head.castShadow=true; root.add(head);
  const hair=new THREE.Mesh(new THREE.SphereGeometry(.122,10,7,0,Math.PI*2,0,Math.PI*.58),mat(isEnemy?0x171b21:pick([0x2c2521,0x201a18,0x4a3428,0x77716a]))); hair.position.y=1.705; root.add(hair);
  const armGeo=new THREE.CapsuleGeometry(.072,.43,3,6);
  const armL=new THREE.Mesh(armGeo,shirt); armL.position.set(-.285,1.14,.015); armL.rotation.z=-.12; root.add(armL);
  const armR=new THREE.Mesh(armGeo,shirt); armR.position.set(.285,1.14,.015); armR.rotation.z=.12; root.add(armR);
  const handL=new THREE.Mesh(new THREE.SphereGeometry(.065,7,6),skin); handL.position.set(-.29,.84,.025); root.add(handL);
  const handR=new THREE.Mesh(new THREE.SphereGeometry(.065,7,6),skin); handR.position.set(.29,.84,.025); root.add(handR);
  const legGeo=new THREE.CapsuleGeometry(.095,.43,3,6), legs=[],feet=[];
  for(const lx of [-.125,.125]) { const leg=new THREE.Mesh(legGeo,pants); leg.position.set(lx,.425,0); root.add(leg); legs.push(leg); const foot=new THREE.Mesh(new THREE.BoxGeometry(.17,.11,.28),shoe); foot.position.set(lx,.095,.055); root.add(foot); feet.push(foot); }
  if(isEnemy) {
    const strap=new THREE.Mesh(new THREE.BoxGeometry(.095,.65,.07),mats.targetRed); strap.position.set(-.14,1.16,.155); strap.rotation.z=-.2; root.add(strap);
  }
  root.userData.limbs={armL,armR,legs,feet,handL,handR}; root.userData.height=1.84;
  root.traverse(o=>{if(o.isMesh){o.castShadow=true;}});
  return root;
}

function addPedestrian(x,z,axis='x',min=-720,max=720,pace=null) {
  const palette=[0x426f7b,0x956d55,0x5b647a,0x8a8c60,0xb16d53,0x554b61,0x65917f,0xbab9ae];
  const root=createHumanoid(pick(palette),false); root.position.set(x,terrainHeight(x,z),z); root.rotation.y=axis==='x'?pick([Math.PI/2,-Math.PI/2]):pick([0,Math.PI]); scene.add(root);
  const person={root,x,z,axis,min,max,dir:rng()<.5?-1:1,speed:pace??rand(.65,1.25),phase:rand(0,Math.PI*2),pause:rand(0,3),downed:false}; pedestrians.push(person); return person;
}
function spawnPedestrians() {
  // People wander along curved sidewalks with offsets measured from sampled street tangents.
  for(let i=0;i<34;i++){
    const footpaths=cityRoadSamples.filter(q=>cityRoadPaths[q.route]?.kind!=='rail');const s=pick(footpaths),side=pick([-1,1]),offset=s.width*.5+rand(3.5,6.3);
    const x=s.x-Math.cos(s.yaw)*offset*side,z=s.z+Math.sin(s.yaw)*offset*side;
    if(isBlocked(x,z,.8))continue;
    addPedestrian(x,z,Math.abs(Math.sin(s.yaw))>.68?'x':'z',-830,830,rand(.5,1.1));
  }
  for(let i=0;i<9;i++){const x=PARKING_LOT.x+rand(-80,80),z=PARKING_LOT.z+rand(-47,47);addPedestrian(x,z,i%2?'x':'z',i%2?PARKING_LOT.x-85:PARKING_LOT.z-48, i%2?PARKING_LOT.x+85:PARKING_LOT.z+48,rand(.45,.9));}
  for(let i=0;i<8;i++){const x=garageSite.x+rand(-48,48),z=garageSite.z+rand(-34,34);addPedestrian(x,z,i%2?'x':'z',garageSite.x-50,garageSite.x+50,rand(.5,.9));}
  for(let i=0;i<6;i++)addPedestrian(rand(-1400,1400),rand(1045,1080),'x',-1500,1500,rand(.4,.8));
}

function updatePedestrians(dt) {
  for(const p of pedestrians) {
    if(p.downed)continue;
    p.pause-=dt;
    if(p.pause<=0) {
      const value=p.axis==='x'?p.root.position.x:p.root.position.z;
      if(value<p.min+2)p.dir=1; if(value>p.max-2)p.dir=-1;
      const delta=p.dir*p.speed*dt;
      if(p.axis==='x')p.root.position.x+=delta; else p.root.position.z+=delta;
      p.phase+=dt*6.5;
      p.root.rotation.y=p.axis==='x'?(p.dir>0?Math.PI/2:-Math.PI/2):(p.dir>0?0:Math.PI);
      const limbs=p.root.userData.limbs;if(limbs){const swing=Math.sin(p.phase)*.33;limbs.legs[0].rotation.x=swing;limbs.legs[1].rotation.x=-swing;limbs.armL.rotation.x=-swing*.65;limbs.armR.rotation.x=swing*.65;}
    } else if(rng()<dt*.2) p.pause=rand(.5,2.2);
    p.root.position.y=terrainHeight(p.root.position.x,p.root.position.z)+Math.abs(Math.sin(p.phase))*.018;
  }
}
function spawnParkingCars() {
  const {x,z}=PARKING_LOT;
  const parkingTypes=['SEDAN','SPORT','SUV','VAN','PICKUP','TAXI','POLICE'];
  for(let i=0;i<11;i++) {
    const px=x-75+i*15, type=pick(parkingTypes), col=pick(colors);
    createCar(px,z-30,pick([0,Math.PI]),col,false,type);
    if(i%3!==1) createCar(px,z+30,pick([0,Math.PI]),pick(colors),false,pick(parkingTypes));
  }
  // Three service vehicles parked by the far entrance.
  createCar(x+79,z+3,Math.PI,0xe4e5df,false,'VAN');
  createCar(x-88,z+3,0,0xe2bd45,false,'TAXI');
  // Vehicles parked inside the open-sided, multi-level garage at grade level.
  if(garageSite){for(let i=0;i<6;i++){const gx=garageSite.x-37+i*14.5,gz=garageSite.z+27; if(!isBlocked(gx,gz,3))createCar(gx,gz,Math.PI,pick(colors),false,pick(['SEDAN','SPORT','SUV','VAN','TAXI']));}}
}
function createAircraft(baseZ,altitude,speed,direction=1,phase=0) {
  const group=new THREE.Group(), fuselageMat=mat(0xd0d8d9,.38,.32), wingMat=mat(0x65747b,.42,.28), glassMat=mat(0x183b4c,.22,.42), engineMat=mat(0x252c31,.55,.35);
  const fuselage=new THREE.Mesh(new THREE.CylinderGeometry(.38,.5,9.2,10),fuselageMat); fuselage.rotation.x=Math.PI/2; group.add(fuselage);
  const nose=new THREE.Mesh(new THREE.ConeGeometry(.37,1.25,10),fuselageMat); nose.rotation.x=Math.PI/2; nose.position.z=5.15; group.add(nose);
  const cockpit=new THREE.Mesh(new THREE.SphereGeometry(.43,10,8),glassMat); cockpit.scale.set(.9,.58,1.45); cockpit.position.set(0,.16,3.35); group.add(cockpit);
  const wing=new THREE.Mesh(new THREE.BoxGeometry(12,.17,1.8),wingMat); wing.position.set(0,-.1,.1); group.add(wing);
  const tailWing=new THREE.Mesh(new THREE.BoxGeometry(3.7,.12,.78),wingMat); tailWing.position.set(0,.05,-3.65); group.add(tailWing);
  const fin=new THREE.Mesh(new THREE.BoxGeometry(.16,1.3,1.2),wingMat); fin.position.set(0,.62,-3.65); group.add(fin);
  for(const side of [-1,1]) {
    const engine=new THREE.Mesh(new THREE.CylinderGeometry(.29,.34,2.1,9),engineMat); engine.rotation.x=Math.PI/2; engine.position.set(side*2.8,-.42,.3); group.add(engine);
    const light=new THREE.Mesh(new THREE.SphereGeometry(.14,7,6),new THREE.MeshBasicMaterial({color:side<0?0xff394b:0x5af6c8})); light.position.set(side*5.5,-.02,.25); group.add(light);
  }
  const x=direction>0?-HALF+70:HALF-70; group.position.set(x,altitude,baseZ); group.rotation.y=direction>0?Math.PI/2:-Math.PI/2; group.traverse(o=>{if(o.isMesh){o.castShadow=false;o.receiveShadow=false;}}); scene.add(group);
  const plane={group,baseZ,altitude,speed,direction,phase,dropTimer:rand(6,11)}; aircraft.push(plane); return plane;
}
function spawnAircraft() {
  createAircraft(570,245,52,1,0.5);
  createAircraft(-170,315,64,-1,2.1);
  createAircraft(1080,210,44,1,4.4);
  createAirportAirliner();
}
function updateAircraft(dt) {
  for(const plane of aircraft) {
    const g=plane.group;
    g.position.x+=plane.speed*plane.direction*dt;
    g.position.z=plane.baseZ+Math.sin(gameTime*.09+plane.phase)*32;
    g.position.y=plane.altitude+Math.sin(gameTime*.17+plane.phase)*5;
    g.rotation.y=plane.direction>0?Math.PI/2:-Math.PI/2;
    plane.dropTimer-=dt;
    if(plane.dropTimer<=0) {dropBomb(plane);plane.dropTimer=rand(8,14);}
    if(g.position.x>HALF-35)g.position.x=-HALF+35;
    if(g.position.x<-HALF+35)g.position.x=HALF-35;
  }
}
function createAirportAirliner() {
  const group=new THREE.Group(),bodyMat=mat(0xe3e9e7,.42,.23),wingMat=mat(0x9ba8ad,.45,.24),dark=mat(0x252e32,.72,.2),glass=mat(0x183f50,.22,.38);
  const body=new THREE.Mesh(new THREE.CylinderGeometry(.42,.5,12.6,14),bodyMat);body.rotation.x=Math.PI/2;group.add(body);
  const nose=new THREE.Mesh(new THREE.ConeGeometry(.43,1.65,14),bodyMat);nose.rotation.x=Math.PI/2;nose.position.z=7.05;group.add(nose);
  const tailCone=new THREE.Mesh(new THREE.ConeGeometry(.42,1.5,12),bodyMat);tailCone.rotation.x=-Math.PI/2;tailCone.position.z=-6.95;group.add(tailCone);
  const wing=new THREE.Mesh(new THREE.BoxGeometry(17,.2,2.5),wingMat);wing.position.set(0,-.18,.15);group.add(wing);
  const tailWing=new THREE.Mesh(new THREE.BoxGeometry(5.5,.14,1.25),wingMat);tailWing.position.set(0,.03,-5.5);group.add(tailWing);
  const fin=new THREE.Mesh(new THREE.BoxGeometry(.22,2.45,2.05),wingMat);fin.position.set(0,1,-5.35);group.add(fin);
  const engines=[];
  for(const side of [-1,1]){
    const engine=new THREE.Mesh(new THREE.CylinderGeometry(.38,.42,2.4,12),dark);engine.rotation.x=Math.PI/2;engine.position.set(side*3.7,-.62,.25);group.add(engine);engines.push(engine);
    const intake=new THREE.Mesh(new THREE.CircleGeometry(.34,12),mat(0x11191e,.75,.25));intake.position.set(side*3.7,-.62,1.47);group.add(intake);
    for(const zz of [-.6,.05,.7,1.35,2,2.65,3.3,3.95,4.6]){const win=new THREE.Mesh(new THREE.BoxGeometry(.07,.13,.2),glass);win.position.set(side*.43,.12,zz);group.add(win);}
  }
  const wheelGeo=new THREE.CylinderGeometry(.16,.16,.18,10);wheelGeo.rotateZ(Math.PI/2);const wheels=[];
  for(const side of [-1,1])for(const zz of [-.7,-1.3]){const wheel=new THREE.Mesh(wheelGeo,dark);wheel.position.set(side*.58,-.79,zz);group.add(wheel);wheels.push(wheel);}
  const noseWheel=new THREE.Mesh(wheelGeo,dark);noseWheel.position.set(0,-.76,3.9);group.add(noseWheel);wheels.push(noseWheel);
  for(const side of [-1,1]){const nav=new THREE.Mesh(new THREE.SphereGeometry(.11,7,5),new THREE.MeshBasicMaterial({color:side<0?0xff3345:0x4df6bf}));nav.position.set(side*8.5,-.1,.2);group.add(nav);}
  group.scale.setScalar(3.05);group.traverse(o=>{if(o.isMesh){o.castShadow=false;o.receiveShadow=false;}});scene.add(group);
  const path=[
    {x:-400,y:105,z:AIRPORT.runwayZ,speed:55},
    {x:100,y:38,z:AIRPORT.runwayZ,speed:48},
    {x:440,y:3.03,z:AIRPORT.runwayZ,speed:38},
    {x:1320,y:3.03,z:AIRPORT.runwayZ,speed:43},
    {x:1320,y:3.03,z:-830,speed:15},
    {x:1050,y:3.03,z:-830,speed:13},
    {x:1050,y:3.03,z:-830,speed:9,wait:30},
    {x:460,y:3.03,z:-830,speed:12},
    {x:460,y:3.03,z:AIRPORT.runwayZ,speed:12},
    {x:240,y:3.03,z:AIRPORT.runwayZ,speed:10},
    {x:650,y:18,z:AIRPORT.runwayZ,speed:38},
    {x:980,y:55,z:AIRPORT.runwayZ,speed:58},
    {x:1430,y:150,z:AIRPORT.runwayZ,speed:70},
    {x:1730,y:250,z:-850,speed:75},
    {x:1700,y:330,z:-250,speed:75},
    {x:1450,y:360,z:320,speed:80},
    {x:1050,y:330,z:550,speed:80},
    {x:650,y:290,z:300,speed:76},
    {x:350,y:230,z:-50,speed:70},
    {x:100,y:170,z:-480,speed:65},
    {x:-250,y:145,z:-850,speed:60},
    {x:-400,y:105,z:AIRPORT.runwayZ,speed:58}
  ];
  const start=path[0];group.position.set(start.x,start.y,start.z);group.rotation.y=Math.PI/2;
  airportAirliners.push({group,path,index:1,waitTimer:0,wheels,speed:0,phase:'approach',yaw:Math.PI/2,pitch:0,roll:0,occupied:false,playerControlled:false});
}
function updateAirportAirliners(dt) {
  for(const plane of airportAirliners){
    // A parked plane is now a usable vehicle, not an obstacle in its old autopilot path.
    if(plane===currentAirplane||plane.phase==='player-parked')continue;
    if(plane.waitTimer>0){plane.speed=0;plane.waitTimer-=dt;if(plane.waitTimer<=0)plane.phase='taxi-out';continue;}
    const target=plane.path[plane.index],g=plane.group;
    const dx=target.x-g.position.x,dy=target.y-g.position.y,dz=target.z-g.position.z,dist=Math.hypot(dx,dy,dz);
    plane.speed=target.speed;
    if(dist<Math.max(1.5,target.speed*dt*.9)){
      g.position.set(target.x,target.y,target.z);
      if(target.wait){plane.waitTimer=target.wait;plane.phase='terminal-stop';}
      else if(plane.index===1||plane.index===2)plane.phase='landing';
      else if(plane.index>=10&&plane.index<=13)plane.phase='takeoff';
      else if(plane.index>=3&&plane.index<=9)plane.phase='taxi';
      else plane.phase='cruise';
      plane.index=(plane.index+1)%plane.path.length;
      continue;
    }
    const step=Math.min(dist,target.speed*dt);g.position.x+=dx/dist*step;g.position.y+=dy/dist*step;g.position.z+=dz/dist*step;
    const horizontal=Math.hypot(dx,dz)||1;
    const yaw=Math.atan2(dx,dz),pitch=-Math.atan2(dy,horizontal);
    // Smooth pitch/yaw transitions and bank into turns instead of snapping at waypoints.
    const yawDelta=Math.atan2(Math.sin(yaw-g.rotation.y),Math.cos(yaw-g.rotation.y));
    const wantedBank=clamp(-yawDelta*.22,-.2,.2);
    const rotT=Math.min(1,dt*2.2);
    g.rotation.x+= (pitch-g.rotation.x)*rotT;
    g.rotation.y+= yawDelta*Math.min(1,dt*1.35);
    g.rotation.z+= (wantedBank-g.rotation.z)*Math.min(1,dt*1.8);
    for(const wheel of plane.wheels)wheel.rotation.x+=dt*plane.speed*.65;
  }
}

function dropBomb(plane) {
  const root=new THREE.Group(), casing=mat(0x20282c,.54,.48), finMat=mat(0x9b4239,.68,.2);
  const body=new THREE.Mesh(new THREE.CylinderGeometry(.18,.24,.92,9),casing); root.add(body);
  const nose=new THREE.Mesh(new THREE.ConeGeometry(.18,.38,9),casing); nose.position.y=-.62; nose.rotation.x=Math.PI; root.add(nose);
  for(const side of [-1,1]) {const fin=new THREE.Mesh(new THREE.BoxGeometry(.36,.08,.18),finMat);fin.position.set(side*.19,.35,0);root.add(fin);}
  const p=plane.group.position;root.position.set(p.x,p.y-3,p.z);root.rotation.set(.2,plane.group.rotation.y,.04);scene.add(root);
  bombs.push({root,velocity:v3(plane.direction*plane.speed*.42,-3,Math.sin(gameTime*.1+plane.phase)*3),life:12});
}
function spawnBombExplosion(pos) {
  const group=new THREE.Group();
  const core=new THREE.Mesh(new THREE.SphereGeometry(1,10,8),new THREE.MeshBasicMaterial({color:0xff7a27,transparent:true,opacity:.9,depthWrite:false}));core.position.y=.7;group.add(core);
  const smoke=new THREE.Mesh(new THREE.SphereGeometry(.8,8,7),new THREE.MeshBasicMaterial({color:0x474744,transparent:true,opacity:.42,depthWrite:false}));smoke.position.y=1.1;group.add(smoke);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(1,.095,6,24),new THREE.MeshBasicMaterial({color:0xffc263,transparent:true,opacity:.9,depthWrite:false}));ring.rotation.x=Math.PI/2;ring.position.y=.15;group.add(ring);
  group.position.copy(pos);scene.add(group);explosions.push({group,core,smoke,ring,life:1.15,maxLife:1.15});
  spawnImpact(v3(pos.x,pos.y+1,pos.z),0xff9a3d,22);
}
function updateBombs(dt) {
  for(let i=bombs.length-1;i>=0;i--) {
    const b=bombs[i];b.life-=dt;b.velocity.y-=24*dt;b.root.position.addScaledVector(b.velocity,dt);b.root.rotation.x+=dt*1.8;
    const p=b.root.position;let ground=isOverWater(p.x,p.z)?-.12:terrainHeight(p.x,p.z);
    // Bombs stop on building rooftops as well as the terrain and water surface.
    if(!isOverWater(p.x,p.z)) for(const building of buildings) { if(Math.abs(p.x-building.x)<building.w/2 && Math.abs(p.z-building.z)<building.d/2 && p.y<=building.baseY+building.height+.25) ground=Math.max(ground,(building.baseY||0)+building.height); }
    if(p.y<=ground+.35||b.life<=0) {
      const impact=v3(p.x,ground,p.z);scene.remove(b.root);b.root.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material&&o.material.dispose)o.material.dispose();});bombs.splice(i,1);spawnBombExplosion(impact);
    }
  }
}
function updateExplosions(dt) {
  for(let i=explosions.length-1;i>=0;i--) {
    const e=explosions[i];e.life-=dt;const t=1-e.life/e.maxLife;
    e.core.scale.setScalar(.3+t*3.2);e.smoke.scale.setScalar(.4+t*2.4);e.ring.scale.setScalar(.6+t*4.8);
    e.core.material.opacity=Math.max(0,e.life/e.maxLife);e.smoke.material.opacity=Math.max(0,e.life/e.maxLife*.44);e.ring.material.opacity=Math.max(0,e.life/e.maxLife);
    if(e.life<=0){scene.remove(e.group);e.group.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material&&o.material.dispose)o.material.dispose();});explosions.splice(i,1);}
  }
}

const weaponDefs = [
  {name:'PISTOL',desc:'SIDEARM / SEMI',glyph:'⌁',magSize:12,reserve:60,ammo:12,damage:35,rate:.29,reload:1.05,pellets:1,spread:.003,range:100,length:.33},
  {name:'SMG',desc:'COMPACT / AUTO',glyph:'≋',magSize:30,reserve:150,ammo:30,damage:14,rate:.085,reload:1.35,pellets:1,spread:.014,range:92,length:.48},
  {name:'SHOTGUN',desc:'CLOSE RANGE / 8 PELLETS',glyph:'╾',magSize:8,reserve:48,ammo:8,damage:10,pellets:8,rate:.74,reload:1.8,spread:.055,range:44,length:.7},
  {name:'RIFLE',desc:'CARBINE / AUTO',glyph:'⌗',magSize:30,reserve:120,ammo:30,damage:24,rate:.12,reload:1.55,pellets:1,spread:.007,range:125,length:.73},
];
let weaponIndex=0;
let weaponModel=null;
function createWeaponVisual(def) {
  const g=new THREE.Group(); const steel=mat(0x202b32,.42,.72), grip=mat(0x10161b,.72,.15), accent=new THREE.MeshStandardMaterial({color:0x9db640,metalness:.48,roughness:.42});
  const len=def.length;
  const body=new THREE.Mesh(new THREE.BoxGeometry(.14,.13,len),steel); body.position.set(.52,1.26,.29+len*.2); g.add(body);
  const barrel=new THREE.Mesh(new THREE.BoxGeometry(.055,.055,len*.64),grip); barrel.position.set(.52,1.3,.38+len*.65); g.add(barrel);
  const handle=new THREE.Mesh(new THREE.BoxGeometry(.105,.22,.13),grip); handle.position.set(.52,1.105,.22); handle.rotation.x=-.16; g.add(handle);
  if(def.name==='SHOTGUN') { const tube=new THREE.Mesh(new THREE.CylinderGeometry(.035,.035,len*.65,8),steel); tube.rotation.x=Math.PI/2; tube.position.set(.6,1.22,.56); g.add(tube); }
  if(def.name==='RIFLE'||def.name==='SMG') { const stock=new THREE.Mesh(new THREE.BoxGeometry(.09,.12,.3),grip); stock.position.set(.52,1.26,.02); g.add(stock); }
  if(def.name==='RIFLE') {const sight=new THREE.Mesh(new THREE.BoxGeometry(.06,.09,.1),accent); sight.position.set(.52,1.36,.39);g.add(sight);}
  const flashMat=new THREE.MeshBasicMaterial({color:0xffe39b,transparent:true,opacity:.95});
  const flash=new THREE.Mesh(new THREE.SphereGeometry(.075,8,6),flashMat);
  flash.position.set(.52,1.30,.38+len*.65+len*.35); flash.visible=false; g.add(flash);
  g.userData.muzzleFlash=flash;
  g.visible=true; return g;
}
function setWeapon(index, quiet=false) {
  weaponIndex=(index+weaponDefs.length)%weaponDefs.length;
  if(weaponModel&&playerVisual) playerVisual.remove(weaponModel);
  weaponModel=createWeaponVisual(weaponDefs[weaponIndex]);
  muzzleFlash=weaponModel.userData.muzzleFlash;
  if(playerVisual) playerVisual.add(weaponModel);
  const d=weaponDefs[weaponIndex];
  $('weapon-name').textContent=d.name; $('weapon-desc').textContent=d.desc; $('weapon-icon').textContent=d.glyph;
  $('weapon-slot').textContent=String(weaponIndex+1).padStart(2,'0');
  document.querySelectorAll('.slot').forEach((s,i)=>s.classList.toggle('active',i===weaponIndex));
  updateAmmo();
  if(!quiet) showToast(`${d.name} に切り替え`);
}
function updateAmmo() {
  const d=weaponDefs[weaponIndex]; $('ammo-count').innerHTML=`${reloading?'…':d.ammo} <i>/ ${d.reserve}</i>`;
  $('ammo-label').textContent=reloading?'RELOADING':'AMMO';
}
function reloadWeapon() {
  const d=weaponDefs[weaponIndex];
  if(reloading||d.ammo===d.magSize||d.reserve<=0) return;
  reloading=true; reloadTimer=d.reload; updateAmmo(); showToast('リロード中…');
}

function addEnemy(x,z) {
  const root=createHumanoid(pick([0x73343b,0x8c353d,0x493f56,0x744a29]),true);
  root.position.set(x,0,z); root.rotation.y=rand(0,Math.PI*2); scene.add(root);
  const enemy={root,x,z,hp:100,maxHp:100,alive:true,moveTimer:rand(1,4),dir:rand(0,Math.PI*2),speed:rand(.5,1.35),flash:0,parts:[]};
  root.traverse(o=>{if(o.isMesh){o.userData.enemy=enemy;enemy.parts.push(o);aimObjects.push(o);}});
  // Small marker above each hostile makes targets readable at city scale.
  const ring=new THREE.Mesh(new THREE.TorusGeometry(.45,.055,5,12),mats.targetRed); ring.position.y=2.17; ring.rotation.x=Math.PI/2; root.add(ring); enemy.ring=ring;
  enemies.push(enemy);
}
function spawnEnemies() {
  let tries=0, placed=0;
  while(placed<22 && tries<1200) {
    tries++;
    const x=rand(-700,700), z=rand(-700,700);
    if(Math.hypot(x+5,z-7)<90 || isBlocked(x,z,2.0)) continue;
    addEnemy(x,z); placed++;
  }
}
function createMarker(x,z) {
  if(marker) scene.remove(marker);
  if(markerBeam) scene.remove(markerBeam);
  marker=new THREE.Group();
  const ring=new THREE.Mesh(new THREE.TorusGeometry(4.6,.22,8,36),mats.neonLime); ring.rotation.x=Math.PI/2; ring.position.y=.32; marker.add(ring);
  const inner=new THREE.Mesh(new THREE.CylinderGeometry(.18,.7,23,10,1,true),new THREE.MeshBasicMaterial({color:0xd4ff4f,transparent:true,opacity:.08,side:THREE.DoubleSide})); inner.position.y=11.5; marker.add(inner);
  const beam=new THREE.Mesh(new THREE.CylinderGeometry(.06,.06,18,8),mats.neonLime); beam.position.y=11; marker.add(beam);
  marker.position.set(x,terrainHeight(x,z),z); scene.add(marker);
  markerBeam=ring;
}
function setNewMission(first=false) {
  let x,z,tries=0;
  do {const sample=pick(cityRoadSamples);x=sample.x;z=sample.z;tries++;}while(tries<60&&Math.hypot(x-actorPosition().x,z-actorPosition().z)<260);
  mission={x,z,originX:actorPosition().x,originZ:actorPosition().z,progress:0,title:first?'街を横断する':pick(['ナイトラン','シティ・エクスプレス','ダウンタウン・ラン','ネオン・デリバリー','ロングウェイ']),desc:first?'黄色いリングの目的地へ向かえ。':'次のマーカーへ向かい、報酬を獲得しよう。'};
  createMarker(x,z); $('mission-title').textContent=mission.title; $('mission-desc').textContent=mission.desc;
}
function actorPosition() { return currentHelicopter?currentHelicopter.group.position:(currentVehicle?currentVehicle.group.position:(currentAirplane?currentAirplane.group.position:player.position)); }
function actorYaw() { return currentHelicopter?currentHelicopter.yaw:(currentVehicle?currentVehicle.yaw:(currentAirplane?currentAirplane.yaw:player.yaw)); }
function showToast(msg) { const t=$('toast'); t.textContent=msg; t.classList.add('show'); toastTimer=2.25; }
function updateCash() { $('cash').textContent='$ '+cash.toLocaleString('en-US'); $('rep').textContent='LV. '+rep; }

function initActors() {
  player={position:v3(-7,terrainHeight(-7,7),7),yaw:Math.PI/2,hp:100,walkPhase:0,speed:0,roofLevel:false};
  playerVisual=createHumanoid(0x426f7b,false);playerVisual.position.copy(player.position);playerVisual.rotation.y=player.yaw;scene.add(playerVisual);
  createCar(0,7,Math.PI/2,0xd8b35b,true,'SEDAN');
  // Ambient traffic spawns on sampled, irregular street paths and follows their curves.
  for(let i=0;i<36;i++){
    const sample=pick(cityRoadSamples),path=cityRoadPaths[sample.route];if(!path||path.kind==='rail')continue;
    const point=path.points[Math.max(0,Math.min(path.points.length-1,sample.index))]||[sample.x,sample.z];
    const yaw=sample.yaw+(rng()<.5?Math.PI:0),lane=pick([-3.5,3.5]);const sideYaw=sample.yaw;
    const x=sample.x+Math.cos(sideYaw)*lane,z=sample.z-Math.sin(sideYaw)*lane;
    if(Math.hypot(x+5,z-7)<45||isBlocked(x,z,3))continue;
    const car=createCar(x,z,yaw,pick(colors));
    if(i<10){car.ai=true;car.cruise=rand(7,12);car.speed=car.cruise;car.parked=false;car.cityRoute=sample.route;car.routeIndex=Math.max(0,Math.min(path.points.length-1,sample.index));car.routeDirection=rng()<.5?1:-1;}
  }
  spawnParkingCars();spawnPedestrians();spawnAircraft();spawnEnemies();setNewMission(true);
}

function updatePlayer(dt) {
  if(currentAirplane){updatePlayerAirplane(dt);if(player.hp<=0)respawnPlayer();return;}
  if(currentHelicopter){updateHelicopter(dt);return;}
  if(currentVehicle) { updateVehicle(dt); return; }
  const forward=(keys.KeyW||keys.ArrowUp?1:0)-(keys.KeyS||keys.ArrowDown?1:0);
  const strafe=(keys.KeyD||keys.ArrowRight?1:0)-(keys.KeyA||keys.ArrowLeft?1:0);
  const inputLen=Math.hypot(forward,strafe);
  const maxSpeed=(keys.ShiftLeft||keys.ShiftRight)?10.5:6.2;
  let vx=0,vz=0;
  if(inputLen>0) {
    const fX=Math.sin(cameraYaw), fZ=Math.cos(cameraYaw);
    // Three.js forward is +Z, so screen-right is (-cos(yaw), +sin(yaw).)
    const rX=-Math.cos(cameraYaw), rZ=Math.sin(cameraYaw);
    vx=(fX*forward+rX*strafe)/inputLen*maxSpeed;
    vz=(fZ*forward+rZ*strafe)/inputLen*maxSpeed;
    const desired=Math.atan2(vx,vz);
    player.yaw=lerpAngle(player.yaw,desired,Math.min(1,dt*12));
    player.walkPhase+=dt*(keys.ShiftLeft||keys.ShiftRight?13:9);
  }
  const nx=player.position.x+vx*dt, nz=player.position.z+vz*dt;
  if(currentInterior){const b=currentInterior;player.position.x=clamp(player.position.x,b.x-b.w/2+2,b.x+b.w/2-2);player.position.z=clamp(player.position.z,b.z-b.d/2+2,b.z+b.d/2-2);}
  else{
    if(!isBlocked(nx,player.position.z,.65)&&!footPositionBlocked(nx,player.position.z))player.position.x=nx;
    if(!isBlocked(player.position.x,nz,.65)&&!footPositionBlocked(player.position.x,nz))player.position.z=nz;
    player.position.x=clamp(player.position.x,-HALF+8,HALF-8);player.position.z=clamp(player.position.z,-HALF+8,WATER_START_Z-5);
    if(player.roofLevel&&garageSite&&Math.abs(player.position.x-garageSite.x)<garageSite.width/2-2&&Math.abs(player.position.z-garageSite.z)<garageSite.depth/2-2)player.position.y=garageSite.topY;
    else{player.roofLevel=false;player.position.y=terrainHeight(player.position.x,player.position.z);}
  }
  playerVisual.position.copy(player.position); playerVisual.rotation.y=player.yaw;
  // Small body bob and a weapon-ready pose keep the character readable in third person.
  playerVisual.position.y+=inputLen>0?Math.abs(Math.sin(player.walkPhase))*.035:0;
  const limbs=playerVisual.userData.limbs;
  if(limbs){
    const swing=inputLen>0?Math.sin(player.walkPhase)*.42:0;
    limbs.legs[0].rotation.x=swing; limbs.legs[1].rotation.x=-swing;
    if(weaponModel){
      const def=weaponDefs[weaponIndex];
      const reloadProgress=reloading?clamp(1-reloadTimer/def.reload,0,1):0;
      const reloadLift=reloading?Math.sin(reloadProgress*Math.PI):0;
      // Both arms stay attached to the weapon rather than swinging through it while walking.
      limbs.armR.position.set(.30,1.25,.10);
      limbs.armR.rotation.set(-.88+reloadLift*.82+weaponRecoil*.15,0,.10);
      limbs.armL.position.set(.02,1.23,.15);
      limbs.armL.rotation.set(-.76+reloadLift*.70,0,-.55);
      limbs.handR.position.set(.49,1.25,.36-reloadLift*.13);
      limbs.handL.position.set(.31,1.14,.47-reloadLift*.09);
      if(weaponModel){weaponModel.position.z=-weaponRecoil*.11;weaponModel.rotation.x=weaponRecoil*.08+reloadLift*.12;}
    } else {
      limbs.armL.position.set(-.285,1.14,.015); limbs.armR.position.set(.285,1.14,.015);
      limbs.armL.rotation.x=-swing*.72; limbs.armR.rotation.x=swing*.72;
    }
  }
  if(mouseDown || keys.KeyF || (!currentVehicle && keys.Space)) { player.yaw=cameraYaw; playerVisual.rotation.y=player.yaw; }
  player.speed=Math.hypot(vx,vz);
  if(player.hp<=0) respawnPlayer();
}
function lerpAngle(a,b,t) { const d=Math.atan2(Math.sin(b-a),Math.cos(b-a)); return a+d*t; }
function updateVehicle(dt) {
  const car=currentVehicle;
  const accel=(keys.KeyW||keys.ArrowUp?1:0)-(keys.KeyS||keys.ArrowDown?1:0);
  const steer=(keys.KeyD||keys.ArrowRight?1:0)-(keys.KeyA||keys.ArrowLeft?1:0);
  if(keys.Space) car.speed*=Math.pow(.035,dt);
  else if(accel!==0) car.speed+=accel*(accel>0?18:13)*dt;
  else car.speed*=Math.pow(.48,dt);
  car.speed=clamp(car.speed,-12,38);
  // Corrected steering mapping: left input rotates the vehicle left, right input rotates right.
  // Do not multiply by speed sign: backing up must not silently swap A/D again.
  const steerPower=clamp(Math.abs(car.speed)/8,.12,1.18);
  car.yaw-=steer*steerPower*1.22*dt;
  const oldX=car.group.position.x, oldZ=car.group.position.z;
  const nx=oldX+Math.sin(car.yaw)*car.speed*dt, nz=oldZ+Math.cos(car.yaw)*car.speed*dt;
  const hitCar=collidingCarAt(nx,nz,2.05,car);
  if(isBlocked(nx,nz,1.8)||hitCar) { car.speed*=-.18; if(Math.abs(car.speed)>2)showToast(hitCar?`${hitCar.type} に衝突`:(isOverWater(nx,nz)?'海岸線：これ以上進めない':'建物に衝突')); }
  else {
    const hitPed=pedestrians.find(p=>!p.downed&&Math.hypot(nx-p.root.position.x,nz-p.root.position.z)<2.65);
    if(hitPed&&Math.abs(car.speed)>2.5)strikePedestrian(hitPed,false);
    const hitOfficer=policeUnits.find(u=>u.officer&&!u.officer.downed&&Math.hypot(nx-u.officer.root.position.x,nz-u.officer.root.position.z)<2.5);
    if(hitOfficer&&Math.abs(car.speed)>2.5){hitOfficer.officer.downed=true;hitOfficer.officer.root.rotation.z=Math.PI/2;hitOfficer.officer.root.position.y=terrainHeight(hitOfficer.officer.root.position.x,hitOfficer.officer.root.position.z)+.12;showToast('警察官と衝突');}
    car.group.position.x=clamp(nx,-HALF+8,HALF-8); car.group.position.z=clamp(nz,-HALF+8,WATER_START_Z-5);
    car.group.position.y=terrainHeight(car.group.position.x,car.group.position.z);
  }
  car.group.rotation.y=car.yaw;
  car.wheels.forEach(w=>w.rotation.x+=car.speed*dt*1.4);
  player.position.copy(car.group.position); player.yaw=car.yaw; player.speed=Math.abs(car.speed);
}
function updateTraffic(dt) {
  for(const c of cars) {
    if(!c.ai||c===currentVehicle||c.policeUnit)continue;
    if(c.cityRoute!==undefined&&!c.highway){
      const path=cityRoadPaths[c.cityRoute];if(!path||path.kind==='rail'||path.points.length<2){c.ai=false;continue;}
      const target=path.points[Math.max(0,Math.min(path.points.length-1,c.routeIndex))];
      if(Math.hypot(c.group.position.x-target[0],c.group.position.z-target[1])<15)c.routeIndex+=c.routeDirection;
      if(c.routeIndex>=path.points.length-1||c.routeIndex<=0){c.routeDirection*=-1;c.routeIndex=clamp(c.routeIndex,0,path.points.length-1);}
      const next=path.points[Math.max(0,Math.min(path.points.length-1,c.routeIndex+c.routeDirection))];const desired=Math.atan2(next[0]-c.group.position.x,next[1]-c.group.position.z);
      c.yaw=lerpAngle(c.yaw,desired,Math.min(1,dt*2.4));c.speed+=(c.cruise-c.speed)*Math.min(1,dt*.8);
      const nx=c.group.position.x+Math.sin(c.yaw)*c.speed*dt,nz=c.group.position.z+Math.cos(c.yaw)*c.speed*dt;
      if(!isBlocked(nx,nz,1.6)&&!collidingCarAt(nx,nz,2.05,c)){c.group.position.x=nx;c.group.position.z=nz;}else c.speed*=.35;
      c.group.position.y=terrainHeight(c.group.position.x,c.group.position.z);c.group.rotation.y=c.yaw;c.wheels.forEach(w=>w.rotation.x+=c.speed*dt*1.25);continue;
    }
    if(c.highway) {
      let nx=c.group.position.x+c.highwayDirection*c.speed*dt;
      if(nx>1515)nx=-1515;
      if(nx< -1515)nx=1515;
      const otherCar=collidingCarAt(nx,c.group.position.z,2.05,c);
      const hitPed=pedestrians.find(p=>!p.downed&&Math.hypot(nx-p.root.position.x,c.group.position.z-p.root.position.z)<2.55);
      if(!otherCar){c.group.position.x=nx;if(hitPed&&c.speed>2.5)strikePedestrian(hitPed,false);}else c.speed*=.78;
      c.group.position.y=terrainHeight(c.group.position.x,c.group.position.z);
      c.group.rotation.y=c.highwayDirection>0?Math.PI/2:-Math.PI/2;
      c.wheels.forEach(w=>w.rotation.x+=c.speed*dt*1.3);
      continue;
    }
    const oldX=c.group.position.x,oldZ=c.group.position.z;
    const nx=oldX+Math.sin(c.yaw)*c.speed*dt,nz=oldZ+Math.cos(c.yaw)*c.speed*dt;
    const hitPed=pedestrians.find(p=>!p.downed&&Math.hypot(nx-p.root.position.x,nz-p.root.position.z)<2.55);
    const otherCar=collidingCarAt(nx,nz,2.05,c);
    if(!isBlocked(nx,nz,1.6)&&!otherCar){c.group.position.x=nx;c.group.position.z=nz;if(hitPed&&c.speed>2.5)strikePedestrian(hitPed,false);}else{c.speed*=.72;}
    const p=c.group.position;
    // Ambient traffic loops along the actual downtown road grid rather than driving into empty terrain.
    if(Math.abs(p.x)>CITY_LENGTH/2-22||Math.abs(p.z)>CITY_LENGTH/2-22) {
      if(Math.abs(Math.sin(c.yaw))>Math.abs(Math.cos(c.yaw))) p.x=Math.sin(c.yaw)>0?-CITY_LENGTH/2+25:CITY_LENGTH/2-25;
      else p.z=Math.cos(c.yaw)>0?-CITY_LENGTH/2+25:CITY_LENGTH/2-25;
      c.group.position.y=terrainHeight(p.x,p.z);
    }
    c.group.rotation.y=c.yaw;
    c.wheels.forEach(w=>w.rotation.x+=c.speed*dt*1.3);
  }
}
function interactVehicle() {
  if(currentAirplane){
    const plane=currentAirplane,g=plane.group;
    const groundY=terrainHeight(g.position.x,g.position.z)+3.03;
    const landed=Math.abs(g.position.y-groundY)<3.6;
    if(!landed||plane.speed>4.8||isOverWater(g.position.x,g.position.z)){
      showToast('陸地・滑走路に着陸し、Sで十分に減速してからEで降機してください');return;
    }
    const yaw=plane.yaw;
    const exits=[
      [g.position.x+Math.cos(yaw)*13,g.position.z-Math.sin(yaw)*13],
      [g.position.x-Math.cos(yaw)*13,g.position.z+Math.sin(yaw)*13],
      [g.position.x+Math.sin(yaw)*18,g.position.z+Math.cos(yaw)*18],
      [g.position.x-Math.sin(yaw)*18,g.position.z-Math.cos(yaw)*18]
    ];
    const exit=exits.find(([x,z])=>!isOverWater(x,z)&&!isBlocked(x,z,1));
    if(!exit){showToast('安全に降りられるスペースがありません');return;}
    currentAirplane=null;plane.occupied=false;plane.playerControlled=false;plane.phase='player-parked';plane.waitTimer=0;plane.speed=0;plane.pitch=0;plane.roll=0;g.position.y=groundY;g.rotation.set(0,yaw,0,'XYZ');
    player.position.set(exit[0],terrainHeight(exit[0],exit[1]),exit[1]);player.yaw=yaw;player.speed=0;playerVisual.visible=true;playerVisual.position.copy(player.position);playerVisual.rotation.y=player.yaw;cameraYaw=player.yaw;cameraPitch=.25;cameraManualLook=false;showToast('旅客機から降りました。機体は駐機しています');return;
  }
  if(currentHelicopter){
    const heli=currentHelicopter,overGarage=!!garageSite&&Math.abs(heli.group.position.x-garageSite.x)<garageSite.width/2+8&&Math.abs(heli.group.position.z-garageSite.z)<garageSite.depth/2+8,groundY=overGarage?garageSite.topY:terrainHeight(heli.group.position.x,heli.group.position.z);
    if(heli.group.position.y>groundY+6){showToast('高度を下げてヘリから降りてください');return;}
    currentHelicopter=null;playerVisual.visible=true;player.roofLevel=!!garageSite&&Math.abs(heli.group.position.x-garageSite.x)<garageSite.width/2+8&&Math.abs(heli.group.position.z-garageSite.z)<garageSite.depth/2+8;
    player.position.set(heli.group.position.x+Math.cos(heli.yaw)*4,player.roofLevel?garageSite.topY:terrainHeight(heli.group.position.x+Math.cos(heli.yaw)*4,heli.group.position.z-Math.sin(heli.yaw)*4),heli.group.position.z-Math.sin(heli.yaw)*4);player.yaw=heli.yaw;playerVisual.position.copy(player.position);playerVisual.rotation.y=player.yaw;cameraYaw=player.yaw;showToast('ヘリコプターから降りました');return;
  }
  if(currentInterior){const b=currentInterior;b.visual.visible=true;b.interior.visible=false;currentInterior=null;player.position.set(b.doorX,terrainHeight(b.doorX,b.doorZ),b.doorZ);player.roofLevel=false;player.yaw=b.yaw||0;playerVisual.position.copy(player.position);playerVisual.rotation.y=player.yaw;cameraYaw=player.yaw;cameraPitch=.25;showToast(`${b.name} から外へ出ました`);return;}
  if(garageSite&&!currentVehicle){
    const nearLift=Math.hypot(player.position.x-garageSite.liftX,player.position.z-(garageSite.liftZ+7))<4.2;
    if(nearLift){if(player.roofLevel){player.roofLevel=false;player.position.set(garageSite.liftX,terrainHeight(garageSite.liftX,garageSite.liftZ+7),garageSite.liftZ+7);showToast('駐車場1階へ移動しました');}else{player.roofLevel=true;player.position.set(garageSite.liftX,garageSite.topY,garageSite.liftZ+7);showToast('屋上ヘリポートへ移動しました');}playerVisual.position.copy(player.position);return;}
  }
  if(!currentVehicle){
    const airliner=airportAirliners.find(p=>!p.occupied&&((p.phase==='terminal-stop'&&p.waitTimer>0)||p.phase==='player-parked')&&Math.hypot(player.position.x-p.group.position.x,player.position.z-p.group.position.z)<48&&Math.abs(player.position.y-p.group.position.y)<16);
    if(airliner){
      currentAirplane=airliner;airliner.occupied=true;airliner.playerControlled=true;airliner.waitTimer=0;airliner.phase='player-controlled';airliner.speed=0;airliner.yaw=airliner.group.rotation.y;airliner.pitch=airliner.group.rotation.x;airliner.roll=airliner.group.rotation.z;
      playerVisual.visible=false;player.position.copy(airliner.group.position);player.yaw=airliner.yaw;player.speed=0;cameraYaw=airliner.yaw;cameraPitch=.20;cameraManualLook=false;
      showToast('旅客機に搭乗 — W加速 / S減速 / A・D旋回 / Space上昇 / Shift下降 / Eで降機');return;
    }
    const heli=helicopters.find(h=>!h.occupied&&Math.hypot(player.position.x-h.group.position.x,player.position.z-h.group.position.z)<8&&Math.abs(player.position.y-h.group.position.y)<9);
    if(heli){currentHelicopter=heli;heli.occupied=true;heli.speed=0;heli.verticalSpeed=0;playerVisual.visible=false;player.position.copy(heli.group.position);player.yaw=heli.yaw;cameraYaw=heli.yaw;cameraPitch=.27;showToast('ヘリコプター搭乗：W/S移動・A/D旋回・Space上昇・Shift下降');return;}
    const b=enterableBuildings.find(q=>Math.hypot(player.position.x-q.doorX,player.position.z-q.doorZ)<13);
    if(b){currentInterior=b;b.visual.visible=false;b.interior.visible=true;player.roofLevel=false;player.position.set(b.x,b.baseY+.25,b.z);player.yaw=b.yaw||0;playerVisual.position.copy(player.position);playerVisual.rotation.y=player.yaw;cameraYaw=player.yaw;cameraPitch=.12;showToast(`${b.name} に入った — Eで外へ出る`);return;}
  }
  if(currentVehicle) {
    const car=currentVehicle; const side=new THREE.Vector3(Math.cos(car.yaw),0,-Math.sin(car.yaw));
    let ex=car.group.position.x+side.x*3.1,ez=car.group.position.z+side.z*3.1;if(isBlocked(ex,ez,1)){ex=car.group.position.x-side.x*3.1;ez=car.group.position.z-side.z*3.1;}
    if(!isBlocked(ex,ez,1)){player.position.set(ex,terrainHeight(ex,ez),ez);player.yaw=car.yaw;playerVisual.position.copy(player.position);playerVisual.rotation.y=player.yaw;}else showToast('降車スペースがありません');
    car.occupied=false;car.parked=false;currentVehicle=null;cameraYaw=player.yaw;cameraPitch=.25;cameraManualLook=false;cameraFreeLookTimer=0;playerVisual.visible=true;showToast('車両から降りた');return;
  }
  let best=null,bestD=5.2;for(const c of cars)if(!c.occupied){const d=player.position.distanceTo(c.group.position);if(d<bestD){bestD=d;best=c;}}
  if(!best){showToast('近くに乗れる車・入れる建物・ヘリがありません');return;}
  currentVehicle=best;best.occupied=true;best.parked=false;best.speed=0;player.position.copy(best.group.position);player.yaw=best.yaw;cameraYaw=best.yaw;cameraPitch=.25;cameraManualLook=false;cameraFreeLookTimer=0;playerVisual.visible=false;showToast(`${best.type} に乗車 — Wで前進 / Sで後退 / A・←で左 / D・→で右`);
}
function updatePlayerAirplane(dt){
  const plane=currentAirplane,g=plane.group;
  // Fixed-wing controls: W builds thrust, S brakes, A/D turn, Space pitches up and Shift pitches down.
  const throttle=(keys.KeyW?1:0)-(keys.KeyS?1:0);
  if(throttle>0)plane.speed=Math.min(92,plane.speed+24*dt);
  else if(throttle<0)plane.speed=Math.max(0,plane.speed-31*dt);
  else plane.speed=Math.max(0,plane.speed-0.55*dt);

  const turn=(keys.KeyD||keys.ArrowRight?1:0)-(keys.KeyA||keys.ArrowLeft?1:0);
  const liftInput=(keys.Space?1:0)-((keys.ShiftLeft||keys.ShiftRight)?1:0);
  const floorBefore=terrainHeight(g.position.x,g.position.z)+3.03;
  const onGround=g.position.y<=floorBefore+0.45;
  if(liftInput>0){
    // A take-off needs runway speed; after lift-off Space pitches the nose upward.
    if(!onGround||plane.speed>=27)plane.pitch=clamp(plane.pitch-0.42*dt,-0.38,0.38);
  }else if(liftInput<0){
    plane.pitch=clamp(plane.pitch+0.42*dt,-0.38,0.38);
  }else{
    plane.pitch+=(0-plane.pitch)*Math.min(1,dt*0.38);
  }
  if(onGround&&plane.speed<24&&plane.pitch<0)plane.pitch+=(0-plane.pitch)*Math.min(1,dt*2.2);

  const turnRate=0.16+Math.min(plane.speed/92,1)*0.42;
  plane.yaw+=turn*turnRate*dt;
  const targetRoll=-turn*0.30;
  plane.roll+=(targetRoll-plane.roll)*Math.min(1,dt*2.6);

  const cp=Math.cos(plane.pitch),sp=Math.sin(plane.pitch);
  g.position.x=clamp(g.position.x+Math.sin(plane.yaw)*cp*plane.speed*dt,-HALF+24,HALF-24);
  g.position.z=clamp(g.position.z+Math.cos(plane.yaw)*cp*plane.speed*dt,-HALF+24,HALF-24);
  g.position.y+=-sp*plane.speed*dt;
  const floor=terrainHeight(g.position.x,g.position.z)+3.03;
  if(g.position.y<floor){
    g.position.y=floor;
    if(plane.pitch>0.2&&plane.speed<26)plane.pitch+=(0-plane.pitch)*Math.min(1,dt*2.0);
  }
  g.position.y=clamp(g.position.y,floor,700);
  g.rotation.set(plane.pitch,plane.yaw,plane.roll,'XYZ');
  plane.phase=g.position.y>floor+4?'player-flight':'player-landing';
  player.position.copy(g.position);player.yaw=plane.yaw;player.speed=plane.speed;
}

function updateHelicopter(dt){
  const h=currentHelicopter,g=h.group;
  const throttle=(keys.KeyW||keys.ArrowUp?1:0)-(keys.KeyS||keys.ArrowDown?1:0);
  const yawInput=(keys.KeyD||keys.ArrowRight?1:0)-(keys.KeyA||keys.ArrowLeft?1:0);
  h.speed=clamp(h.speed+throttle*13*dt,-10,32);if(!throttle)h.speed*=Math.pow(.62,dt);
  h.yaw+=yawInput*1.35*dt;
  const lift=(keys.Space?1:0)-((keys.ShiftLeft||keys.ShiftRight)?1:0);
  h.verticalSpeed=clamp(h.verticalSpeed+lift*8.5*dt+(lift===0?-h.verticalSpeed*.65*dt:0),-9,9);
  const nx=g.position.x+Math.sin(h.yaw)*h.speed*dt,nz=g.position.z+Math.cos(h.yaw)*h.speed*dt;
  g.position.x=clamp(nx,-HALF+18,HALF-18);g.position.z=clamp(nz,-HALF+18,WATER_START_Z-8);
  let minY=terrainHeight(g.position.x,g.position.z)+2.4;
  if(garageSite&&Math.abs(g.position.x-garageSite.x)<garageSite.width/2-2&&Math.abs(g.position.z-garageSite.z)<garageSite.depth/2-2&&g.position.y<garageSite.topY+22)minY=Math.max(minY,garageSite.topY+1.8);
  g.position.y=Math.max(minY,Math.min(220,g.position.y+h.verticalSpeed*dt));
  g.rotation.y=h.yaw;g.rotation.z=-yawInput*.12;g.rotation.x=clamp(-h.speed*.003,-.15,.15);
  h.rotor.rotation.y+=dt*24;h.tailRotor.rotation.x+=dt*28;
  player.position.copy(g.position);player.yaw=h.yaw;player.speed=Math.hypot(h.speed,h.verticalSpeed);
}

function respawnPlayer() {
  cameraManualLook=false;cameraPitch=.25;
  if(currentVehicle){currentVehicle.occupied=false;currentVehicle.speed=0;currentVehicle=null;}if(currentHelicopter){currentHelicopter.occupied=false;currentHelicopter=null;}if(currentAirplane){const plane=currentAirplane;plane.occupied=false;plane.playerControlled=false;plane.phase='player-parked';plane.speed=0;plane.pitch=0;plane.group.position.y=terrainHeight(plane.group.position.x,plane.group.position.z)+3.03;plane.group.rotation.set(0,plane.yaw,0,'XYZ');currentAirplane=null;}if(currentInterior){currentInterior.visual.visible=true;currentInterior.interior.visible=false;currentInterior=null;}
  playerVisual.visible=true;player.hp=100;player.position.set(-7,terrainHeight(-7,7),7);player.yaw=Math.PI/2;cameraYaw=player.yaw;cameraPitch=.25;cameraFreeLookTimer=0;player.speed=0;playerVisual.visible=true;playerVisual.position.copy(player.position);playerVisual.rotation.y=player.yaw;cash=Math.max(0,cash-250);wanted=0;updateCash();showToast('病院で復帰：$250 の治療費');
}

function shoot() {
  const def=weaponDefs[weaponIndex];
  if(reloading||gameTime-lastShotAt<def.rate||paused||!started) return;
  if(def.ammo<=0) {showToast('弾切れ — Rでリロード');lastShotAt=gameTime;return;}
  def.ammo--; lastShotAt=gameTime; updateAmmo();
  weaponRecoil=Math.min(1,weaponRecoil+.72); muzzleFlashTimer=.055; if(muzzleFlash)muzzleFlash.visible=true;
  wanted=Math.min(5,wanted+0.12); wantedCool=13; wantedClearTimer=5;
  camera.updateMatrixWorld();
  const targetHits=[]; let firstPoint=null;
  for(let i=0;i<def.pellets;i++) {
    const nx=(rng()-.5)*def.spread*2, ny=(rng()-.5)*def.spread*2;
    raycaster.setFromCamera(new THREE.Vector2(nx,0.065+ny),camera); raycaster.far=def.range;
    const hit=raycaster.intersectObjects(aimObjects,false)[0];
    if(hit) {
      if(!firstPoint) firstPoint=hit.point.clone();
      if(hit.object.userData.enemy) targetHits.push({enemy:hit.object.userData.enemy,point:hit.point.clone()});
    }
  }
  const from=new THREE.Vector3();
  if(currentVehicle) from.copy(currentVehicle.group.position).add(v3(0,1.1,0));
  else {from.copy(player.position).add(v3(0,1.3,0));from.x+=Math.sin(player.yaw)*.45;from.z+=Math.cos(player.yaw)*.45;}
  let to=firstPoint;
  if(!to) {const dir=new THREE.Vector3();camera.getWorldDirection(dir);to=camera.position.clone().add(dir.multiplyScalar(def.range));}
  const tracerGeo=new THREE.BufferGeometry().setFromPoints([from,to]);
  const tracer=new THREE.Line(tracerGeo,new THREE.LineBasicMaterial({color:def.name==='SHOTGUN'?0xffd47b:0xc9ffdf,transparent:true,opacity:.95}));scene.add(tracer);tracers.push({line:tracer,life:.075});
  for(const {enemy,point} of targetHits) {
    if(!enemy.alive) continue;
    enemy.hp-=def.damage;
    enemy.flash=.12;
    if(enemy.hp<=0) killEnemy(enemy,point);
  }
  if(firstPoint) spawnImpact(firstPoint,def.name==='SHOTGUN'?0xffc16b:0x9bfbef,4);
}
const raycaster=new THREE.Raycaster();
function killEnemy(enemy,point) {
  if(!enemy.alive)return; enemy.alive=false;
  enemy.parts.forEach(p=>{const i=aimObjects.indexOf(p);if(i>=0)aimObjects.splice(i,1);});
  scene.remove(enemy.root); const ei=enemies.indexOf(enemy);if(ei>=0)enemies.splice(ei,1);
  cash+=100;rep=Math.max(1,rep);updateCash();spawnImpact(point,0xff5e6d,16);showToast('ターゲット排除 +$100');
}
function spawnImpact(pos,color,count=6) {
  const m=new THREE.MeshBasicMaterial({color,transparent:true,opacity:.9});
  for(let i=0;i<count;i++) {
    const mesh=new THREE.Mesh(new THREE.IcosahedronGeometry(rand(.035,.11),0),m.clone());mesh.position.copy(pos);scene.add(mesh);
    particles.push({mesh,vel:v3(rand(-4,4),rand(.5,4),rand(-4,4)),life:rand(.2,.48),maxLife:.48});
  }
}
function updateEffects(dt) {
  for(let i=tracers.length-1;i>=0;i--){const t=tracers[i];t.life-=dt;t.line.material.opacity=Math.max(0,t.life/.075);if(t.life<=0){scene.remove(t.line);t.line.geometry.dispose();t.line.material.dispose();tracers.splice(i,1);}}
  for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.life-=dt;p.mesh.position.addScaledVector(p.vel,dt);p.vel.y-=8*dt;p.mesh.material.opacity=Math.max(0,p.life/p.maxLife);if(p.life<=0){scene.remove(p.mesh);p.mesh.geometry.dispose();p.mesh.material.dispose();particles.splice(i,1);}}
}
function updateEnemies(dt) {
  const p=actorPosition();
  for(const e of enemies) {
    if(!e.alive)continue;
    e.moveTimer-=dt;
    if(e.moveTimer<=0){e.moveTimer=rand(1.5,4.5);e.dir=Math.atan2(p.x-e.root.position.x,p.z-e.root.position.z)+(rand(-1,1)*1.9);}
    const distance=Math.hypot(p.x-e.root.position.x,p.z-e.root.position.z);
    const speed=distance<22?e.speed*1.15:e.speed*.42;
    const nx=e.root.position.x+Math.sin(e.dir)*speed*dt,nz=e.root.position.z+Math.cos(e.dir)*speed*dt;
    if(!isBlocked(nx,nz,1.1)&&distance>5){e.root.position.x=nx;e.root.position.z=nz;}
    e.root.rotation.y=e.dir;
    e.ring.material=e.flash>0?mats.targetGold:mats.targetRed;e.flash=Math.max(0,e.flash-dt);
  }
  // No direct damage while inside a vehicle; on-foot contact is deliberately forgiving.
  if(!currentVehicle&&!currentHelicopter&&!currentInterior) for(const e of enemies) if(Math.hypot(p.x-e.root.position.x,p.z-e.root.position.z)<1.15) player.hp=Math.max(0,player.hp-4*dt);
}
function updateMission(dt) {
  marker.rotation.y+=dt*.7;
  const p=actorPosition(), d=Math.hypot(mission.x-p.x,mission.z-p.z);
  $('mission-distance').textContent=d<1000?`${Math.round(d)} m TO DESTINATION`:`${(d/1000).toFixed(1)} km TO DESTINATION`;
  $('mission-progress').style.width=`${clamp(1-d/Math.hypot(mission.x-mission.originX,mission.z-mission.originZ),0,1)*100}%`;
  if(d<10) {
    cash+=Math.round(650+Math.min(2200,distanceAtMissionStart(mission)*.9));jobsDone++;rep=1+Math.floor(jobsDone/2);updateCash();showToast(`仕事完了！ 報酬 +$${Math.round(650+Math.min(2200,distanceAtMissionStart(mission)*.9)).toLocaleString('en-US')}`);setNewMission(false);
  }
}
function distanceAtMissionStart(m) {return Math.hypot(m.x-m.originX,m.z-m.originZ);}
function spawnPoliceOfficer(x,z) {
  const root=createHumanoid(0x263d50,false);root.position.set(x,terrainHeight(x,z),z);root.rotation.y=rand(0,Math.PI*2);
  const badge=new THREE.Mesh(new THREE.BoxGeometry(.11,.13,.035),mat(0xe4c264,.5,.25));badge.position.set(.11,1.25,.205);root.add(badge);scene.add(root);
  return {root,fireTimer:rand(.25,.8),phase:rand(0,8),downed:false};
}
function spawnPoliceUnit() {
  const p=actorPosition();let sx=p.x+80,sz=p.z+60,placed=false;
  for(let i=0;i<40;i++){
    let x,z;
    if(Math.abs(p.x)<760&&Math.abs(p.z)<760&&rng()<.8){
      const sample=pick(cityRoadSamples);x=sample.x+rand(-24,24);z=sample.z+rand(-24,24);
    }else{const a=rand(0,Math.PI*2),r=rand(75,120);x=clamp(p.x+Math.sin(a)*r,-1450,1450);z=clamp(p.z+Math.cos(a)*r,-1500,1110);}
    if(isBlocked(x,z,5)||Math.hypot(x-p.x,z-p.z)<55||collidingCarAt(x,z,2,null))continue;
    sx=x;sz=z;placed=true;break;
  }
  if(!placed){sx=clamp(p.x+95,-1450,1450);sz=clamp(p.z+45,-1500,1100);}
  const yaw=Math.atan2(p.x-sx,p.z-sz),car=createCar(sx,sz,yaw,0xe9ece8,false,'POLICE');
  car.policeUnit=true;car.ai=false;car.parked=false;car.speed=0;car.health=100;car.group.userData.sirenLights.forEach((l,i)=>l.material.color.setHex(i===0?0x287dff:0xff304b));
  policeUnits.push({car,officer:null,fireTimer:rand(.45,1.2),ramCooldown:0,age:0});
  showToast('WANTED — パトカーが急行中！');
}
function policeShoot(unit,origin) {
  const target=actorPosition().clone().add(v3(0,currentVehicle?1.3:1.0,0));
  const delta=target.clone().sub(origin),distance=delta.length();if(distance>54||distance<1)return;
  const dir=delta.normalize();raycaster.set(origin,dir);raycaster.far=distance;
  const cover=raycaster.intersectObjects(buildingMeshes,false)[0];
  const visible=!cover;
  const tracer=new THREE.Line(new THREE.BufferGeometry().setFromPoints([origin.clone(),target.clone()]),new THREE.LineBasicMaterial({color:0xffd28a,transparent:true,opacity:.9}));scene.add(tracer);tracers.push({line:tracer,life:.09});
  if(visible){player.hp=Math.max(0,player.hp-rand(4.5,8.5));if(currentVehicle)currentVehicle.health=Math.max(0,currentVehicle.health-rand(2,5));spawnImpact(target,0xffa85c,3);}
}
function removePoliceUnits() {
  for(const unit of policeUnits){
    if(unit.officer){scene.remove(unit.officer.root);unit.officer.root.traverse(o=>{if(o.geometry)o.geometry.dispose();});}
    scene.remove(unit.car.group);const ci=cars.indexOf(unit.car);if(ci>=0)cars.splice(ci,1);
    unit.car.group.traverse(o=>{if(o.geometry)o.geometry.dispose();});
  }
  policeUnits.length=0;
}
function updatePolice(dt) {
  const p=actorPosition();
  for(const unit of policeUnits){
    const car=unit.car,cp=car.group.position;unit.age+=dt;unit.fireTimer-=dt;unit.ramCooldown=Math.max(0,unit.ramCooldown-dt);
    const dx=p.x-cp.x,dz=p.z-cp.z,distance=Math.hypot(dx,dz),targetYaw=Math.atan2(dx,dz);
    const stopDistance=currentVehicle?8.5:5.4;
    if(distance>stopDistance){
      car.yaw=lerpAngle(car.yaw,targetYaw,Math.min(1,dt*2.15));
      const targetSpeed=distance>26?29:distance>14?20:10;
      car.speed+=clamp(targetSpeed-car.speed,-25*dt,21*dt);
      const nx=cp.x+Math.sin(car.yaw)*car.speed*dt,nz=cp.z+Math.cos(car.yaw)*car.speed*dt;
      if(!isBlocked(nx,nz,2.1)&&!cars.some(other=>other!==car&&other!==currentVehicle&&Math.hypot(nx-other.group.position.x,nz-other.group.position.z)<3.9)){
        const pedestrianHit=pedestrians.find(person=>!person.downed&&Math.hypot(nx-person.root.position.x,nz-person.root.position.z)<2.55);
        if(pedestrianHit)strikePedestrian(pedestrianHit,true);
        cp.x=clamp(nx,-HALF+9,HALF-9);cp.z=clamp(nz,-HALF+9,WATER_START_Z-8);cp.y=terrainHeight(cp.x,cp.z);
      }else{car.speed*=.55;car.yaw=lerpAngle(car.yaw,targetYaw+(Math.sin(gameTime+unit.age)>0?1:-1)*.85,Math.min(1,dt*1.6));}
    }else car.speed*=Math.pow(.04,dt);
    car.group.rotation.y=car.yaw;car.wheels.forEach(w=>w.rotation.x+=car.speed*dt*1.4);
    for(let i=0;i<car.group.userData.sirenLights.length;i++){
      const l=car.group.userData.sirenLights[i],on=(Math.floor(gameTime*8)%2)===(i%2);l.material.color.setHex(on?(i===0?0x287dff:0xff304b):0x25313a);
    }
    if(distance<4.3&&!currentVehicle&&unit.ramCooldown<=0){player.hp=Math.max(0,player.hp-13);unit.ramCooldown=1.4;showToast('パトカーに接触！');}
    // Officers dismount once the response car reaches the player.
    if(!unit.officer&&distance<22&&Math.abs(car.speed)<11){
      const sx=cp.x+Math.cos(car.yaw)*3.1,sz=cp.z-Math.sin(car.yaw)*3.1;unit.officer=spawnPoliceOfficer(sx,sz);
    }
    if(unit.officer&&!unit.officer.downed){
      const officer=unit.officer,root=officer.root;officer.fireTimer-=dt;officer.phase+=dt*7;
      const ox=p.x-root.position.x,oz=p.z-root.position.z,od=Math.hypot(ox,oz);root.rotation.y=Math.atan2(ox,oz);
      if(od>9){const step=Math.min(od-8,3.8*dt),nx=root.position.x+ox/od*step,nz=root.position.z+oz/od*step;if(!isBlocked(nx,nz,.75)&&!collidingCarAt(nx,nz,.6,car)){root.position.x=nx;root.position.z=nz;}}
      root.position.y=terrainHeight(root.position.x,root.position.z);const limbs=root.userData.limbs;if(limbs){limbs.armL.rotation.x=-1.05;limbs.armR.rotation.x=-1.12;limbs.armL.rotation.z=-.25;limbs.armR.rotation.z=.16;}
      if(od<52&&officer.fireTimer<=0){const muzzle=root.position.clone().add(v3(Math.sin(root.rotation.y)*.5,1.32,Math.cos(root.rotation.y)*.5));policeShoot(unit,muzzle);officer.fireTimer=rand(.72,1.15);}
      // The officer remains a physical body: a player vehicle can knock them down.
      if(currentVehicle&&Math.hypot(currentVehicle.group.position.x-root.position.x,currentVehicle.group.position.z-root.position.z)<2.6&&Math.abs(currentVehicle.speed)>2.5){officer.downed=true;root.rotation.z=Math.PI/2;root.position.y=terrainHeight(root.position.x,root.position.z)+.12;showToast('警察官と衝突');}
    }else if(!unit.officer&&distance<48&&unit.fireTimer<=0){const muzzle=cp.clone().add(v3(Math.sin(car.yaw)*1.4,1.65,Math.cos(car.yaw)*1.4));policeShoot(unit,muzzle);unit.fireTimer=rand(.75,1.2);}
  }
}

function updateWanted(dt) {
  if(wanted>0){wantedCool-=dt;if(wantedCool<=0){wanted=Math.max(0,wanted-dt*.055);}}
  const level=Math.min(5,Math.round(wanted));$('stars').textContent='★'.repeat(level)+'☆'.repeat(5-level);
  $('stars').style.color=wanted>0?'#ffbd5b':'#819092';
  const desired=wanted<.45?0:wanted<1.65?1:wanted<3.1?2:3;
  if(wanted>.15)wantedClearTimer=5;else wantedClearTimer-=dt;
  policeSpawnTimer-=dt;
  if(policeUnits.length<desired&&policeSpawnTimer<=0){spawnPoliceUnit();policeSpawnTimer=3.8;}
  if(wanted<.15&&policeUnits.length&&wantedClearTimer<=0)removePoliceUnits();
}
function updateHud() {
  const hp=clamp(player.hp,0,100);$('health-fill').style.width=hp+'%';$('health-text').textContent=Math.round(hp)+'%';$('vehicle-status').textContent=currentAirplane?'IN AIRLINER':(currentHelicopter?'IN HELICOPTER':(currentVehicle?('IN '+currentVehicle.type):(currentInterior?'INDOORS':(player.roofLevel?'ROOFTOP':'ON FOOT'))));
  const speed=Math.round(player.speed*3.6);$('speed-label').innerHTML=`SPEED <b>${speed}</b> km/h`;
  const aircraftHint=$('aircraft-hint');
  if(aircraftHint){
    if(currentAirplane){
      const g=currentAirplane.group,groundY=terrainHeight(g.position.x,g.position.z)+3.03;
      const landed=Math.abs(g.position.y-groundY)<3.6;
      aircraftHint.textContent=`旅客機操縦中  W加速 / S減速 / A・D旋回 / Space上昇 / Shift下降 / E${landed&&currentAirplane.speed<4.8&&!isOverWater(g.position.x,g.position.z)?'降機':'（着陸・減速後に降機）'}`;
      aircraftHint.classList.remove('hidden');
    }else{
      const boarding=airportAirliners.find(q=>!q.occupied&&((q.phase==='terminal-stop'&&q.waitTimer>0)||q.phase==='player-parked')&&Math.hypot(player.position.x-q.group.position.x,player.position.z-q.group.position.z)<76&&Math.abs(player.position.y-q.group.position.y)<20);
      if(boarding){aircraftHint.textContent=boarding.phase==='terminal-stop'?`Eで旅客機に搭乗できます — 出発まで ${Math.ceil(boarding.waitTimer)} 秒`:'Eで駐機中の旅客機に搭乗できます';aircraftHint.classList.remove('hidden');}
      else aircraftHint.classList.add('hidden');
    }
  }
  const p=actorPosition();const center=Math.hypot(p.x,p.z);$('zone-label').textContent=(Math.abs(p.x-AIRPORT.x)<760&&Math.abs(p.z-AIRPORT.z)<265)?'LOS SANTOS AIRPORT':((Math.abs(p.z-HIGHWAY_Z)<HIGHWAY_WIDTH/2+2&&Math.abs(p.x)<1560)?'FREEWAY / HIGHWAY':p.z>900?'COAST / BEACH':(p.x<-780&&p.z<-430?'MOUNTAIN PASS':(Math.hypot(p.x-PARKING_LOT.x,p.z-PARKING_LOT.z)<180?'PARKING LOT':(p.x>800&&p.z>-680?'EASTERN HILLS':(center<340?'DOWNTOWN':center<700?'MIDTOWN':'OUTER CITY')))));
  drawMiniMap(p);
}
function drawMiniMap(p) {
  const W=mini.width,H=mini.height,s=W/WORLD;
  mctx.clearRect(0,0,W,H);mctx.fillStyle='#24362e';mctx.fillRect(0,0,W,H);
  const mz=(z)=>H/2+(z/HALF)*(H/2); const mx=(x)=>W/2+(x/HALF)*(W/2);
  mctx.fillStyle='#c4b489';mctx.fillRect(0,mz(BEACH_START_Z),W,mz(WATER_START_Z)-mz(BEACH_START_Z));
  mctx.fillStyle='#1f6075';mctx.fillRect(0,mz(WATER_START_Z),W,H-mz(WATER_START_Z));
  mctx.fillStyle='#59685b';mctx.beginPath();mctx.moveTo(mx(-1600),mz(-1600));mctx.lineTo(mx(-650),mz(-1600));mctx.lineTo(mx(-650),mz(-440));mctx.lineTo(mx(-1600),mz(-440));mctx.closePath();mctx.fill();
  mctx.fillStyle='#273036';mctx.fillRect(mx(-CITY_LENGTH/2),mz(-CITY_LENGTH/2),W*CITY_LENGTH/WORLD,H*CITY_LENGTH/WORLD);
  for(const route of cityRoadPaths){mctx.beginPath();route.points.forEach(([x,z],i)=>{const px=mx(x),py=mz(z);if(i===0)mctx.moveTo(px,py);else mctx.lineTo(px,py);});mctx.strokeStyle=route.kind==='rail'?'#b7b4a4':(route.kind==='boulevard'?'#68757a':'#465057');mctx.lineWidth=route.kind==='rail'?1:Math.max(1,route.width*s*1.3);mctx.stroke();}
  mctx.strokeStyle='#2c8494';mctx.lineWidth=2.2;mctx.beginPath();cityRiverSamples.forEach(([x,z],i)=>{if(i===0)mctx.moveTo(mx(x),mz(z));else mctx.lineTo(mx(x),mz(z));});mctx.stroke();
  mctx.strokeStyle='#a9c1b5';mctx.lineWidth=1.8;for(const b of CITY_BRIDGES){const dx=Math.cos(b.yaw)*b.halfWidth,dz=-Math.sin(b.yaw)*b.halfWidth;mctx.beginPath();mctx.moveTo(mx(b.x-dx),mz(b.z-dz));mctx.lineTo(mx(b.x+dx),mz(b.z+dz));mctx.stroke();}
  // The airport runway, taxiway and terminal are drawn directly on the minimap.
  const ax0=(AIRPORT.runwayStartX+HALF)*s,ax1=(AIRPORT.runwayEndX+HALF)*s,ay=(AIRPORT.runwayZ+HALF)*s;
  mctx.strokeStyle='#d7e2df';mctx.lineWidth=4;mctx.beginPath();mctx.moveTo(ax0,ay);mctx.lineTo(ax1,ay);mctx.stroke();
  mctx.strokeStyle='#f0c65c';mctx.lineWidth=1.5;mctx.beginPath();mctx.moveTo(mx(1320),mz(-1000));mctx.lineTo(mx(1320),mz(-830));mctx.lineTo(mx(1050),mz(-830));mctx.stroke();
  mctx.fillStyle='#b5c5c3';mctx.fillRect(mx(970),mz(-777),Math.max(4,195*s),Math.max(3,42*s));
  mctx.fillStyle='#d4ff4f';mctx.fillRect(mx(850),mz(-920),3,3);
  // Freeway corridor and exits are shown in a brighter stroke on the minimap.
  const highwayY=(HIGHWAY_Z+HALF)*s;mctx.strokeStyle='#c2d1a0';mctx.lineWidth=3.2;mctx.beginPath();mctx.moveTo(( -1540+HALF)*s,highwayY);mctx.lineTo((1540+HALF)*s,highwayY);mctx.stroke();
  mctx.strokeStyle='#d4ff4f';mctx.lineWidth=1.5;for(const rx of HIGHWAY_RAMP_XS){const q=(rx+HALF)*s;mctx.beginPath();mctx.moveTo(q,(HIGHWAY_RAMP_BASE_Z+HALF)*s);mctx.lineTo(q,(HIGHWAY_RAMP_TOP_Z+HALF)*s);mctx.stroke();}
  const tx=(mission.x+HALF)*s,ty=(mission.z+HALF)*s;mctx.fillStyle='#d4ff4f';mctx.beginPath();mctx.arc(tx,ty,3.5,0,Math.PI*2);mctx.fill();
  const px=(p.x+HALF)*s,py=(p.z+HALF)*s;mctx.save();mctx.translate(px,py);mctx.rotate(Math.PI-actorYaw());mctx.fillStyle='#50e2d0';mctx.beginPath();mctx.moveTo(0,-6);mctx.lineTo(4.4,4);mctx.lineTo(0,2.3);mctx.lineTo(-4.4,4);mctx.closePath();mctx.fill();mctx.restore();
  for(const e of enemies){const ex=(e.root.position.x+HALF)*s,ey=(e.root.position.z+HALF)*s;mctx.fillStyle='#ff5867';mctx.fillRect(ex-1.1,ey-1.1,2.2,2.2);}
}

function updateCamera(dt) {
  const p=actorPosition();
  // Orbit freely while driving/flying; C is the only action that recentres the chase view.
  if((currentVehicle||currentHelicopter||currentAirplane) && !cameraManualLook) cameraYaw=lerpAngle(cameraYaw,actorYaw(),Math.min(1,dt*4.5));
  const dist=currentAirplane?31:(currentHelicopter?19:(currentVehicle?13.2:6.7));
  const lookHeight=currentAirplane?5.8:(currentHelicopter?2.8:(currentVehicle?1.9:2.05));
  const cp=Math.cos(cameraPitch), sp=Math.sin(cameraPitch);
  // Orbit around the actor, with pitch changing the actual camera position instead of only the look point.
  const desired=v3(p.x-Math.sin(cameraYaw)*dist*cp, p.y+lookHeight+dist*sp, p.z-Math.cos(cameraYaw)*dist*cp);
  camera.position.lerp(desired,Math.min(1,dt*10.0));
  const lookDistance=currentAirplane?7.0:(currentHelicopter?4.4:(currentVehicle?3.0:2.4));
  const aimPoint=v3(p.x+Math.sin(cameraYaw)*lookDistance,p.y+lookHeight,p.z+Math.cos(cameraYaw)*lookDistance);
  camera.lookAt(aimPoint); camera.updateMatrixWorld();
}
function applyCameraLook(dx,dy) {
  // Rightward mouse motion rotates the view to the right; drag-look works even without pointer lock.
  // Increasing yaw moves the orbit camera around to the player's right side.
  cameraYaw += dx * .0030;
  const minPitch=(currentVehicle||currentHelicopter)?-.045:-.14;
  cameraPitch=clamp(cameraPitch+dy*.0024,minPitch,.74);
  cameraManualLook=true;
  cameraFreeLookTimer=0;
}
function recenterCamera() {
  cameraYaw=actorYaw(); cameraPitch=.25; cameraManualLook=false; cameraFreeLookTimer=0;
  showToast('カメラを後方視点に戻しました');
}
function animate() {
  requestAnimationFrame(animate);
  const dt=Math.min(clock.getDelta(),.05);
  updateAdaptiveRenderQuality(dt);
  if(started&&!paused) {
    gameTime+=dt;
    updatePlayer(dt);updateTraffic(dt);updatePedestrians(dt);updateAircraft(dt);updateAirportAirliners(dt);updatePolice(dt);updateBombs(dt);updateExplosions(dt);updateEnemies(dt);updateMission(dt);updateWanted(dt);updateEffects(dt);
    if(!currentAirplane && (mouseDown || keys.KeyF || (!currentVehicle && keys.Space)))shoot();
    weaponRecoil=Math.max(0,weaponRecoil-dt*5.8);
    if(muzzleFlashTimer>0){muzzleFlashTimer-=dt;if(muzzleFlashTimer<=0&&muzzleFlash)muzzleFlash.visible=false;}
    if(reloading){reloadTimer-=dt;if(reloadTimer<=0){const d=weaponDefs[weaponIndex],need=d.magSize-d.ammo,amount=Math.min(need,d.reserve);d.ammo+=amount;d.reserve-=amount;reloading=false;updateAmmo();showToast('リロード完了');}}
    if(toastTimer>0){toastTimer-=dt;if(toastTimer<=0)$('toast').classList.remove('show');}
    updateCamera(dt);updateHud();
  }
  renderer.render(scene,camera);
}

function startGame() {
  if(started)return; started=true;paused=false;$('start-overlay').classList.add('hidden');$('loading').classList.add('done');
  showToast('街へようこそ — 画面をクリックしてマウス視点を有効化 / Cで後方視点');
}
function clearInputState() {
  mouseDown=false; cameraDrag=false;
  for(const code of Object.keys(keys)) keys[code]=false;
}
function pauseGame() {
  if(!started)return;paused=true;clearInputState();$('pause-overlay').classList.remove('hidden');
  if(document.pointerLockElement)document.exitPointerLock();
}
function resumeGame() {
  paused=false;$('pause-overlay').classList.add('hidden');
}
function openHelp() {
  $('help-overlay').classList.remove('hidden');clearInputState();
  if(document.pointerLockElement)document.exitPointerLock();
}
function closeHelp() { $('help-overlay').classList.add('hidden'); }
const destinations = {
  'los-santos': {name:'Los Santos', x:0, z:0, yaw:Math.PI/2},
  'old-town': {name:'Old Town / Hotel', x:-326, z:328, yaw:.18},
  'garage': {name:'Downtown Parking Garage', x:558, z:559, yaw:Math.PI/2},
  'vinewood': {name:'Vinewood', x:300, z:-390, yaw:Math.PI/2},
  'del-perro': {name:'Del Perro', x:-480, z:1080, yaw:Math.PI/2},
  'sandy-shores': {name:'Sandy Shores', x:1240, z:110, yaw:Math.PI/2},
  'mount-chiliad': {name:'Mount Chiliad', x:-1280, z:-1110, yaw:Math.PI/2},
  'paleto-bay': {name:'Paleto Bay', x:-720, z:-930, yaw:Math.PI/2},
  'airport': {name:'Los Santos International', x:910, z:-815, yaw:Math.PI/2}
};
let selectedDestination='los-santos', selectedLoadout=weaponIndex;
function releasePointerForMenu(){clearInputState();if(document.pointerLockElement)document.exitPointerLock();}
function openMap(){if(!started)return;paused=true;$('pause-overlay').classList.add('hidden');$('loadout-overlay').classList.add('hidden');$('map-overlay').classList.remove('hidden');releasePointerForMenu();}
function closeMap(){ $('map-overlay').classList.add('hidden'); if(started)resumeGame(); }
function openLoadout(){if(!started)return;paused=true;$('pause-overlay').classList.add('hidden');$('map-overlay').classList.add('hidden');selectedLoadout=weaponIndex;updateLoadoutSelection();$('loadout-overlay').classList.remove('hidden');releasePointerForMenu();}
function closeLoadout(){ $('loadout-overlay').classList.add('hidden'); if(started)resumeGame(); }
function updateLoadoutSelection(){document.querySelectorAll('.loadout-item').forEach((b)=>b.classList.toggle('selected',Number(b.dataset.weapon)===selectedLoadout));const d=weaponDefs[selectedLoadout];$('loadout-selected-label').textContent=`選択中：${d.name} · ${d.ammo} / ${d.reserve}`;}
function selectDestination(id){if(!destinations[id])return;selectedDestination=id;document.querySelectorAll('[data-destination]').forEach(el=>el.classList.toggle('selected',el.dataset.destination===id));}
function travelToDestination(){const d=destinations[selectedDestination];if(!d)return;if(currentVehicle){currentVehicle.occupied=false;currentVehicle.speed=0;currentVehicle=null;}if(currentHelicopter){currentHelicopter.occupied=false;currentHelicopter=null;}if(currentAirplane){currentAirplane.occupied=false;currentAirplane.playerControlled=false;currentAirplane.phase='player-parked';currentAirplane.speed=0;currentAirplane.pitch=0;currentAirplane.group.position.y=terrainHeight(currentAirplane.group.position.x,currentAirplane.group.position.z)+3.03;currentAirplane.group.rotation.set(0,currentAirplane.yaw,0,'XYZ');currentAirplane=null;}if(currentInterior){currentInterior.visual.visible=true;currentInterior.interior.visible=false;currentInterior=null;}playerVisual.visible=true;player.roofLevel=false;player.position.set(d.x,terrainHeight(d.x,d.z),d.z);player.yaw=d.yaw;player.speed=0;playerVisual.position.copy(player.position);playerVisual.rotation.y=player.yaw;playerVisual.visible=true;cameraYaw=d.yaw;cameraPitch=.25;cameraManualLook=false;cameraFreeLookTimer=0;closeMap();showToast(`移動しました：${d.name}`);}

function resetGame() {
  // A full reload is the cleanest way to reset generated city state and weapon ammo.
  location.reload();
}

$('map-btn').addEventListener('click',openMap);
$('loadout-btn').addEventListener('click',openLoadout);
$('map-close').addEventListener('click',closeMap);
$('loadout-close').addEventListener('click',closeLoadout);
$('travel-btn').addEventListener('click',travelToDestination);
document.querySelectorAll('[data-destination]').forEach(el=>el.addEventListener('click',()=>selectDestination(el.dataset.destination)));
document.querySelectorAll('.loadout-item').forEach(el=>el.addEventListener('click',()=>{selectedLoadout=Number(el.dataset.weapon);updateLoadoutSelection();}));
$('equip-btn').addEventListener('click',()=>{setWeapon(selectedLoadout);closeLoadout();});
$('start-btn').addEventListener('click',startGame);
$('pause-btn').addEventListener('click',()=>paused?resumeGame():pauseGame());
$('resume-btn').addEventListener('click',resumeGame);
$('restart-btn').addEventListener('click',resetGame);
$('game').addEventListener('click',()=>{/* Mouse-look is activated by the first in-game click below. */});
$('help-btn').addEventListener('click',openHelp);
$('help-close').addEventListener('click',closeHelp);$('help-ok').addEventListener('click',closeHelp);
canvas.addEventListener('mousedown',e=>{
  if(!started||paused)return;
  if(e.button===0){
    if(!$('help-overlay').classList.contains('hidden'))return;
    // The first click captures relative mouse movement for GTA-style free look; subsequent clicks shoot.
    if(document.pointerLockElement!==canvas&&canvas.requestPointerLock){
      try{const request=canvas.requestPointerLock();if(request&&typeof request.catch==='function')request.catch(()=>showToast('マウス視点を開始できません。右ドラッグでも視点を動かせます'));}
      catch{showToast('マウス視点を開始できません。右ドラッグでも視点を動かせます');}
      return;
    }
    mouseDown=true;
  }
  if(e.button===2){e.preventDefault();if(document.pointerLockElement!==canvas){cameraDrag=true;lastMouseX=e.clientX;lastMouseY=e.clientY;}}
});
window.addEventListener('mouseup',e=>{if(e.button===0)mouseDown=false;if(e.button===2)cameraDrag=false;});
canvas.addEventListener('contextmenu',e=>e.preventDefault());
window.addEventListener('mousemove',e=>{
  if(!started||paused)return;
  if(document.pointerLockElement===canvas){applyCameraLook(e.movementX||0,e.movementY||0);return;}
  if(cameraDrag){const dx=e.clientX-lastMouseX,dy=e.clientY-lastMouseY;lastMouseX=e.clientX;lastMouseY=e.clientY;applyCameraLook(dx,dy);}
});
window.addEventListener('wheel',e=>{if(!started||paused)return;setWeapon(weaponIndex+(e.deltaY>0?1:-1));},{passive:true});
window.addEventListener('keydown',e=>{
  if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Tab'].includes(e.code))e.preventDefault();
  if(started&&!paused)keys[e.code]=true;
  if(e.repeat)return;
  if(e.code==='Escape') {if(!started)return;if(!$('map-overlay').classList.contains('hidden')){closeMap();return;}if(!$('loadout-overlay').classList.contains('hidden')){closeLoadout();return;}if(!$('help-overlay').classList.contains('hidden')){closeHelp();return;}paused?resumeGame():pauseGame();}
  if(e.code==='KeyH'){if(!$('help-overlay').classList.contains('hidden'))closeHelp();else openHelp();}
  if(e.code==='KeyM'&&started&&!paused)openMap();
  if(e.code==='Tab'&&started&&!paused)openLoadout();
  if(e.code==='KeyE'&&started&&!paused)interactVehicle();
  if(e.code==='KeyR'&&started&&!paused)reloadWeapon();
  if(e.code==='KeyC'&&started&&!paused)recenterCamera();
  if(/^Digit[1-4]$/.test(e.code)&&started&&!paused)setWeapon(Number(e.code.slice(-1))-1);
});
window.addEventListener('keyup',e=>{keys[e.code]=false;});
document.addEventListener('pointerlockchange',()=>{
  if(document.pointerLockElement!==canvas){mouseDown=false;cameraDrag=false;}
});
window.addEventListener('blur',clearInputState);
window.addEventListener('pagehide',clearInputState);
// Pause safely when the player switches tabs or minimizes the browser. This prevents
// movement/fire inputs from remaining latched while the game is not visible.
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){
    clearInputState();
    if(started&&!paused)pauseGame();
  }
});
window.addEventListener('resize',()=>{
  const width=Math.max(1,window.innerWidth),height=Math.max(1,window.innerHeight);
  camera.aspect=width/height;camera.updateProjectionMatrix();
  renderer.setSize(width,height);
});

try {
  generateCity(); initActors(); setWeapon(0,true); updateCash(); updateHud(); updateCamera(.016);
  $('loading').classList.add('done');
  animate();
} catch(err) {
  console.error(err); $('loading').innerHTML='<span>ゲームの初期化に失敗しました。README.txt の起動方法とブラウザのコンソールを確認してください。</span>';
}
})();
